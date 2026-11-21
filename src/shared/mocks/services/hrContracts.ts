import { addMonths, format, parseISO } from 'date-fns'
import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type { ContractInput, ContractStatus, ContractType, EmployeeContract, HrAccess, HrFile, RenewInput } from '@/modules/hr/peopleTypes'
import { CONTRACT_STATUSES, CONTRACT_TYPES } from '@/modules/hr/peopleTypes'
import { ApiError } from '@/shared/lib/apiError'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { companyById } from '@/shared/mocks/data/tenancy'
import { hrContracts, nextHrId, type ContractRecord } from '@/shared/mocks/data/hrPeople'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { delay } from '@/shared/mocks/server'
import { NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertHrFull, companyEmployee, hrAccessOf, isIsoDate, isSelf, logHr, visibleEmployeeIds, type HrActor } from './hrAccess'

/**
 * HR › Employee contracts (docs/API.md › HR › Employee contracts). One contract per employee at a time is
 * `active`; history is kept (renewing creates a new contract and marks the old one `renewed`). Pay (basic +
 * allowances) is visible to HR full and the employee themself only; team viewers get null amounts.
 * Reminders (probation ending in 14 days, end in 60 and 30 days) are stored once per contract and date
 * (services/hrPeopleAlerts.ts).
 */

const bad = (message: string): never => {
  throw new ApiError(message, 422)
}

const plusMonths = (iso: string, months: number) => format(addMonths(parseISO(iso), months), 'yyyy-MM-dd')

export function fileOf(v: unknown): HrFile | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'object') return bad('The file is not valid.')
  const f = v as Record<string, unknown>
  const name = String(f.name ?? '').trim()
  const sizeBytes = Number(f.sizeBytes)
  if (!name || name.length > 200) return bad('The file needs a name (200 characters max).')
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 25 * 1024 * 1024) return bad('Files can be up to 25 MB.')
  const url = typeof f.url === 'string' && f.url.startsWith('data:') && f.url.length <= 360_000 ? f.url : null
  return { name, sizeBytes: Math.round(sizeBytes), mimeType: String(f.mimeType || 'application/octet-stream').slice(0, 100), url }
}

/** Plan storage: only the bytes a new / replaced file adds. */
export function chargeFile(companyId: string, next: HrFile | null, prev: HrFile | null): void {
  const added = (next?.sizeBytes ?? 0) - (prev && next && prev.name === next.name && prev.sizeBytes === next.sizeBytes ? next.sizeBytes : 0)
  if (next && added > 0) assertCapacity(companyId, 'storageMb', added / (1024 * 1024))
}

function money(v: unknown, field: string): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return bad(`${field} must be a positive amount.`)
  return Math.round(n * 100) / 100
}

function wholeIn(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) return bad(`${field} must be a whole number from ${min} to ${max}.`)
  return n
}

export function contractView(c: Tenant<ContractRecord>, viewer: User, access: HrAccess, today = companyDayOf(c.companyId).today): EmployeeContract {
  const e = hrEmployees.find((x) => x.companyId === c.companyId && x.id === c.employeeId)
  const pay = access === 'full' || (!!e && isSelf(viewer, e))
  const total = c.basicSalary + c.housingAllowance + c.transportAllowance + c.otherAllowance
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName: e?.fullName ?? 'Unknown',
    employeeNo: e?.employeeNo ?? '',
    type: c.type,
    startDate: c.startDate,
    endDate: c.endDate,
    probationMonths: c.probationMonths,
    probationEndDate: c.probationEndDate,
    noticeDays: c.noticeDays,
    hoursPerWeek: c.hoursPerWeek,
    salaryVisible: pay,
    basicSalary: pay ? c.basicSalary : null,
    housingAllowance: pay ? c.housingAllowance : null,
    transportAllowance: pay ? c.transportAllowance : null,
    otherAllowance: pay ? c.otherAllowance : null,
    totalSalary: pay ? Math.round(total * 100) / 100 : null,
    currency: c.currency,
    status: c.status,
    signedDate: c.signedDate,
    file: c.file,
    notes: c.notes,
    renewedFromId: c.renewedFromId,
    renewedToId: c.renewedToId,
    inProbation: c.status === 'active' && !!c.probationEndDate && c.probationEndDate >= today,
    daysToEnd: c.status === 'active' && c.endDate ? daysBetweenIso(today, c.endDate) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }
}

/** Contracts of one employee, newest first (detail page). */
export function contractsOfEmployee(viewer: User, access: HrAccess, employee: Tenant<Employee>): EmployeeContract[] {
  const today = companyDayOf(employee.companyId).today
  return hrContracts
    .filter((c) => c.companyId === employee.companyId && c.employeeId === employee.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id))
    .map((c) => contractView(c, viewer, access, today))
}

export interface ContractQuery {
  type?: string | null
  status?: string | null
  /** Active contracts ending within N days. */
  endingWithin?: string | null
  employeeId?: string | null
}

export async function listContracts(user: User, q: ContractQuery = {}): Promise<EmployeeContract[]> {
  const access = hrAccessOf(user)
  const co = tenantOf(user)
  const ids = visibleEmployeeIds(user)
  const today = companyDayOf(co).today
  const within = q.endingWithin ? Number(q.endingWithin) : null
  const rows = hrContracts
    .filter((c) => c.companyId === co && ids.has(c.employeeId))
    .filter((c) => !q.type || c.type === q.type)
    .filter((c) => !q.status || c.status === q.status)
    .filter((c) => !q.employeeId || c.employeeId === q.employeeId)
    .filter((c) => within === null || !Number.isFinite(within) || (c.status === 'active' && !!c.endDate && daysBetweenIso(today, c.endDate) >= 0 && daysBetweenIso(today, c.endDate) <= within))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
  return delay(rows.map((c) => contractView(c, user, access, today)))
}

function visibleContract(user: User, id: string): Tenant<ContractRecord> {
  const co = tenantOf(user)
  const ids = visibleEmployeeIds(user)
  const c = hrContracts.find((x) => x.companyId === co && x.id === id && ids.has(x.employeeId))
  if (!c) throw new ApiError(NOT_FOUND, 404)
  return c
}

export async function getContract(user: User, id: string): Promise<EmployeeContract> {
  const access = hrAccessOf(user)
  return delay(contractView(visibleContract(user, id), user, access))
}

/** Validates the fields present; returns the values to store. */
function clean(companyId: string, input: Partial<ContractInput>, base: ContractRecord | null): Partial<ContractRecord> {
  const out: Partial<ContractRecord> = {}
  if (input.type !== undefined) {
    if (!CONTRACT_TYPES.includes(input.type as ContractType)) bad('Pick a contract type.')
    out.type = input.type
  }
  if (input.startDate !== undefined) {
    if (!isIsoDate(input.startDate)) bad('Enter the start date.')
    out.startDate = input.startDate
  }
  if (input.endDate !== undefined) {
    if (input.endDate !== null && input.endDate !== '' && !isIsoDate(input.endDate)) bad('The end date is not a valid date.')
    out.endDate = input.endDate || null
  }
  if (input.probationMonths !== undefined) out.probationMonths = wholeIn(input.probationMonths, 'Probation', 0, 6)
  if (input.noticeDays !== undefined) out.noticeDays = wholeIn(input.noticeDays, 'Notice period', 0, 180)
  if (input.hoursPerWeek !== undefined) out.hoursPerWeek = wholeIn(input.hoursPerWeek, 'Working hours per week', 1, 60)
  if (input.basicSalary !== undefined) out.basicSalary = money(input.basicSalary, 'Basic salary')
  if (input.housingAllowance !== undefined) out.housingAllowance = money(input.housingAllowance, 'Housing allowance')
  if (input.transportAllowance !== undefined) out.transportAllowance = money(input.transportAllowance, 'Transport allowance')
  if (input.otherAllowance !== undefined) out.otherAllowance = money(input.otherAllowance, 'Other allowances')
  if (input.currency !== undefined) {
    const cur = String(input.currency ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) bad('Pick a currency.')
    out.currency = cur
  }
  if (input.signedDate !== undefined) {
    if (input.signedDate !== null && input.signedDate !== '' && !isIsoDate(input.signedDate)) bad('The signed date is not a valid date.')
    out.signedDate = input.signedDate || null
  }
  if (input.notes !== undefined) out.notes = String(input.notes ?? '').slice(0, 2000)
  if (input.file !== undefined) out.file = fileOf(input.file)
  const merged = { ...(base ?? {}), ...out } as Partial<ContractRecord>
  if (merged.type === 'limited' && !merged.endDate) bad('A limited (fixed-term) contract needs an end date.')
  if (merged.endDate && merged.startDate && merged.endDate <= merged.startDate) bad('The end date must be after the start date.')
  if (merged.startDate && merged.probationMonths !== undefined) {
    out.probationEndDate = merged.probationMonths ? plusMonths(merged.startDate, merged.probationMonths) : null
  }
  void companyId
  return out
}

function otherActive(c: Pick<ContractRecord, 'employeeId' | 'id'> & { companyId: string }): Tenant<ContractRecord> | undefined {
  return hrContracts.find((x) => x.companyId === c.companyId && x.employeeId === c.employeeId && x.status === 'active' && x.id !== c.id)
}

const defaultCurrency = (co: string) => companyById(co)?.regional.currency ?? 'AED'

/** Creates a contract (HR full). Status draft or active; one active contract per employee. */
export function createContractFor(companyId: string, input: Partial<ContractInput>, actor: HrActor): Tenant<ContractRecord> {
  const e = companyEmployee(companyId, input.employeeId)
  if (!e) throw new ApiError(NOT_FOUND, 404)
  if (!input.type || !input.startDate) bad('Contract type and start date are required.')
  const status = (input.status ?? 'draft') as ContractStatus
  if (status !== 'draft' && status !== 'active') bad('A new contract starts as a draft or active.')
  const values = clean(companyId, { probationMonths: 0, noticeDays: 30, hoursPerWeek: 48, basicSalary: 0, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0, currency: defaultCurrency(companyId), ...input }, null)
  const now = new Date().toISOString()
  const c: Tenant<ContractRecord> = {
    companyId,
    id: nextHrId('HCT-', hrContracts),
    employeeId: e.id,
    type: values.type!,
    startDate: values.startDate!,
    endDate: values.endDate ?? null,
    probationMonths: values.probationMonths ?? 0,
    probationEndDate: values.probationEndDate ?? null,
    noticeDays: values.noticeDays ?? 30,
    hoursPerWeek: values.hoursPerWeek ?? 48,
    basicSalary: values.basicSalary ?? 0,
    housingAllowance: values.housingAllowance ?? 0,
    transportAllowance: values.transportAllowance ?? 0,
    otherAllowance: values.otherAllowance ?? 0,
    currency: values.currency ?? defaultCurrency(companyId),
    status,
    signedDate: values.signedDate ?? null,
    file: values.file ?? null,
    notes: values.notes ?? '',
    renewedFromId: null,
    renewedToId: null,
    alertMarks: [],
    createdAt: now,
    updatedAt: now,
  }
  if (status === 'active' && otherActive(c)) bad(`${e.fullName} already has an active contract. End it or renew it instead.`)
  chargeFile(companyId, c.file, null)
  hrContracts.push(c)
  if (c.file) noteUsage(companyId)
  logHr(companyId, e.id, actor, 'contract', `Contract ${c.id} added (${c.type.replace('_', ' ')}, ${status})`, now)
  return c
}

export async function createContract(user: User, input: Partial<ContractInput> | null): Promise<EmployeeContract> {
  assertHrFull(user)
  const c = createContractFor(tenantOf(user), input ?? {}, user)
  return delay(contractView(c, user, 'full'))
}

const ALLOWED_STATUS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['draft', 'active'],
  active: ['active', 'ended', 'terminated'],
  ended: ['ended'],
  terminated: ['terminated'],
  renewed: ['renewed'],
}

export async function updateContract(user: User, id: string, input: Partial<ContractInput> | null): Promise<EmployeeContract> {
  const c = visibleContract(user, id)
  assertHrFull(user)
  const patch = { ...(input ?? {}) }
  delete patch.employeeId
  const values = clean(c.companyId, patch, c)
  if (patch.status !== undefined) {
    if (!CONTRACT_STATUSES.includes(patch.status)) bad('Pick a status.')
    if (!ALLOWED_STATUS[c.status].includes(patch.status)) bad(`A ${c.status} contract can’t become ${patch.status}. Renew it to continue the employment.`)
    if (patch.status === 'active' && otherActive(c)) bad('This employee already has an active contract. End it or renew it first.')
    values.status = patch.status
  }
  const datesChanged = (values.endDate !== undefined && values.endDate !== c.endDate) || (values.probationEndDate !== undefined && values.probationEndDate !== c.probationEndDate)
  if (values.file !== undefined) chargeFile(c.companyId, values.file, c.file)
  const now = new Date().toISOString()
  const statusChanged = values.status && values.status !== c.status
  Object.assign(c, values, { updatedAt: now })
  // A changed end / probation date re-arms its reminders (the marks are keyed by date as well).
  if (datesChanged) c.alertMarks = []
  if (values.file) noteUsage(c.companyId)
  logHr(c.companyId, c.employeeId, user, 'contract', statusChanged ? `Contract ${c.id} is now ${c.status}` : `Contract ${c.id} updated`, now)
  return delay(contractView(c, user, 'full'))
}

/**
 * POST /hr/contracts/:id/renew: a new active contract from the old one's terms (+ overrides). The old one
 * (active or ended) becomes `renewed`. Default start: the day after the old end date (or today).
 */
export async function renewContract(user: User, id: string, input: RenewInput | null): Promise<EmployeeContract> {
  const old = visibleContract(user, id)
  assertHrFull(user)
  if (old.status !== 'active' && old.status !== 'ended') bad('Only an active or ended contract can be renewed.')
  const co = old.companyId
  const today = companyDayOf(co).today
  const start = input?.startDate ?? (old.endDate ? addDaysIso(old.endDate, 1) : today)
  let end: string | null | undefined = input?.endDate
  if (end === undefined && old.endDate) {
    const length = daysBetweenIso(old.startDate, old.endDate)
    end = addDaysIso(start, Math.max(30, length))
  }
  const input2: Partial<ContractInput> = {
    employeeId: old.employeeId,
    type: input?.type ?? old.type,
    startDate: start,
    endDate: end ?? null,
    probationMonths: input?.probationMonths ?? 0,
    noticeDays: input?.noticeDays ?? old.noticeDays,
    hoursPerWeek: input?.hoursPerWeek ?? old.hoursPerWeek,
    basicSalary: input?.basicSalary ?? old.basicSalary,
    housingAllowance: input?.housingAllowance ?? old.housingAllowance,
    transportAllowance: input?.transportAllowance ?? old.transportAllowance,
    otherAllowance: input?.otherAllowance ?? old.otherAllowance,
    currency: input?.currency ?? old.currency,
    signedDate: input?.signedDate ?? today,
    notes: input?.notes ?? '',
    file: input?.file ?? null,
    status: 'draft',
  }
  // Validate before touching the old contract; then flip both.
  const created = createContractFor(co, input2, user)
  const now = new Date().toISOString()
  old.status = 'renewed'
  old.renewedToId = created.id
  old.updatedAt = now
  created.status = 'active'
  created.renewedFromId = old.id
  logHr(co, old.employeeId, user, 'contract', `Contract ${old.id} renewed as ${created.id}`, now)
  return delay(contractView(created, user, 'full'))
}

/** Lifecycle: active contracts past their end date become `ended` (company-local day). */
export function endExpiredContracts(companyId: string, today: string): void {
  for (const c of hrContracts) {
    if (c.companyId === companyId && c.status === 'active' && c.endDate && c.endDate < today) {
      c.status = 'ended'
      c.updatedAt = new Date().toISOString()
      logHr(companyId, c.employeeId, null, 'contract', `Contract ${c.id} ended on ${c.endDate}`)
    }
  }
}
