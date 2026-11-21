import type { User } from '@/shared/types'
import type { Employee, EmploymentStatus, EmploymentType } from '@/modules/hr/types'
import { EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABEL, EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import type {
  DocumentInput,
  DocumentType,
  EmployeeDetail,
  EmployeeDocument,
  EmployeeExportRow,
  EmployeeInput,
  EmployeeRow,
  HrAccess,
  OffboardingState,
  UnlinkedUser,
} from '@/modules/hr/peopleTypes'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from '@/modules/hr/peopleTypes'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrActivity, hrDocuments, hrProfiles, maskLast4, nextHrId, type DocumentRecord, type ProfileRecord } from '@/shared/mocks/data/hrPeople'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { noteUsage } from '@/shared/mocks/services/billing'
import { delay } from '@/shared/mocks/server'
import { NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertHrFull, companyEmployee, hrAccessOf, isIsoDate, isSelf, logHr, visibleEmployee, visibleEmployees, type HrActor } from './hrAccess'
import { chargeFile, contractsOfEmployee, fileOf } from './hrContracts'
import { assetRow, assetsHeldBy } from './hrAssets'
import { documentStatusOf, runHrPeopleAlerts } from './hrPeopleAlerts'
import { offboardingSystemSteps } from './hrJourneySystem'
import { journeyOnEmployeeCreated, journeyOnOffboardingCompleted, journeyOnStatusChanged } from './hrJourney'

/**
 * HR › Employees (docs/API.md › HR › Employees): list / profile / create / edit, documents with expiry
 * status, offboarding, linking a system user. Scope: services/hrAccess.ts. Creating an employee never
 * creates a login (inviting one goes through POST /settings/users, then link-user).
 *
 * `createEmployee(companyId, input, actor)` is the shared entry point (Recruitment's "hire" calls it).
 */

const bad = (message: string): never => {
  throw new ApiError(message, 422)
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TYPES: EmploymentType[] = ['full_time', 'part_time', 'contractor', 'intern']
const LEAVING: EmploymentStatus[] = ['notice', 'terminated']

/* ---------------- profile ---------------- */

export function profileOf(companyId: string, employeeId: string): Tenant<ProfileRecord> {
  let p = hrProfiles.find((x) => x.companyId === companyId && x.employeeId === employeeId)
  if (!p) {
    p = { companyId, employeeId, emergencyContact: { name: '', relation: '', phone: '' }, address: { line1: '', city: '', country: '' }, bankName: '', accountName: '', iban: '', offboarding: null }
    hrProfiles.push(p)
  }
  return p
}

export function applyProfile(p: ProfileRecord, input: Partial<EmployeeInput>): void {
  const s = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
  if (input.emergencyContact) {
    const ec = input.emergencyContact
    p.emergencyContact = { name: ec.name !== undefined ? s(ec.name) : p.emergencyContact.name, relation: ec.relation !== undefined ? s(ec.relation, 60) : p.emergencyContact.relation, phone: ec.phone !== undefined ? s(ec.phone, 30) : p.emergencyContact.phone }
  }
  if (input.address) {
    const a = input.address
    const country = a.country !== undefined ? s(a.country, 2).toUpperCase() : p.address.country
    if (country && !/^[A-Z]{2}$/.test(country)) bad('Address country: use a 2-letter country code.')
    p.address = { line1: a.line1 !== undefined ? s(a.line1, 300) : p.address.line1, city: a.city !== undefined ? s(a.city, 100) : p.address.city, country }
  }
  if (input.bank) {
    const b = input.bank
    if (b.bankName !== undefined) p.bankName = s(b.bankName, 120)
    if (b.accountName !== undefined) p.accountName = s(b.accountName, 120)
    if (b.iban !== undefined) {
      const iban = String(b.iban ?? '').replace(/\s+/g, '').toUpperCase()
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) bad('That doesn’t look like an IBAN (e.g. AE07 0331 2345 6789 0123 456).')
      p.iban = iban
    }
  }
}

/* ---------------- views ---------------- */

const deptName = (co: string, id: string | null) => (id ? departments.find((d) => d.companyId === co && d.id === id)?.name ?? null : null)

export function docView(d: Tenant<DocumentRecord>, today: string): EmployeeDocument {
  const st = documentStatusOf(d.expiryDate, today)
  return {
    id: d.id,
    employeeId: d.employeeId,
    type: d.type,
    numberMasked: maskLast4(d.number),
    issueDate: d.issueDate,
    expiryDate: d.expiryDate,
    issuingCountry: d.issuingCountry,
    file: d.file,
    notes: d.notes,
    status: st.status,
    daysToExpiry: st.days,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

function rowOf(e: Tenant<Employee>, today: string): EmployeeRow {
  const statuses = hrDocuments.filter((d) => d.companyId === e.companyId && d.employeeId === e.id).map((d) => documentStatusOf(d.expiryDate, today).status)
  const expired = statuses.filter((s) => s === 'expired').length
  const expiring = statuses.filter((s) => s === 'expiring').length
  const { companyId: _co, ...base } = e
  return {
    ...base,
    departmentName: deptName(e.companyId, e.departmentId),
    managerName: e.managerId ? hrEmployees.find((x) => x.companyId === e.companyId && x.id === e.managerId)?.fullName ?? null : null,
    hasLogin: !!e.userId,
    docAlert: expired ? 'expired' : expiring ? 'expiring' : null,
    docAlertCount: expired + expiring,
  }
}

function offboardingOf(e: Tenant<Employee>, p: ProfileRecord): OffboardingState | null {
  if (!p.offboarding) return null
  // The system steps (assets / login / settlement) are shared with the offboarding journey (services/hrJourneySystem.ts).
  const steps = offboardingSystemSteps(e)
  return { startedAt: p.offboarding.startedAt, completedAt: p.offboarding.completedAt, steps, canComplete: !p.offboarding.completedAt && steps.every((s) => !s.blocking || s.done) }
}

function detailOf(viewer: User, access: HrAccess, e: Tenant<Employee>): EmployeeDetail {
  const today = companyDayOf(e.companyId).today
  const p = profileOf(e.companyId, e.id)
  const linked = e.userId ? users.find((u) => u.id === e.userId && u.companyId === e.companyId) : undefined
  return {
    ...rowOf(e, today),
    emergencyContact: { ...p.emergencyContact },
    address: { ...p.address },
    bank: access === 'full' || isSelf(viewer, e) ? { bankName: p.bankName, accountName: p.accountName, ibanMasked: maskLast4(p.iban) } : null,
    documents: hrDocuments
      .filter((d) => d.companyId === e.companyId && d.employeeId === e.id)
      .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))
      .map((d) => docView(d, today)),
    contracts: contractsOfEmployee(viewer, access, e),
    assets: assetsHeldBy(e).map(assetRow),
    activity: hrActivity
      .filter((a) => a.companyId === e.companyId && a.employeeId === e.id)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, 100)
      .map(({ id, at, actorName, action, summary }) => ({ id, at, actorName, action, summary })),
    offboarding: offboardingOf(e, p),
    linkedUser: linked ? { id: linked.id, name: linked.name, email: linked.email, role: linked.role, active: linked.active } : null,
    access,
    canManage: access === 'full',
  }
}

/* ---------------- validation ---------------- */

function clean(companyId: string, input: Partial<EmployeeInput>, base: Tenant<Employee> | null): Partial<Employee> {
  const out: Partial<Employee> = {}
  const s = (v: unknown) => String(v ?? '').trim()
  if (input.fullName !== undefined) {
    const name = s(input.fullName).replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 120) bad('Enter the employee’s full name.')
    out.fullName = name
  }
  if (input.jobTitle !== undefined) {
    const t = s(input.jobTitle)
    if (!t || t.length > 120) bad('Enter the job title.')
    out.jobTitle = t
  }
  if (input.email !== undefined) {
    const email = s(input.email).toLowerCase()
    if (email && !EMAIL.test(email)) bad('That doesn’t look like an email address.')
    if (email && hrEmployees.some((e) => e.companyId === companyId && e.id !== base?.id && e.email.toLowerCase() === email)) bad(`${email} already belongs to another employee.`)
    out.email = email
  }
  if (input.mobile !== undefined) out.mobile = s(input.mobile).slice(0, 30)
  if (input.nationality !== undefined) {
    const n = s(input.nationality).toUpperCase()
    if (!/^[A-Z]{2}$/.test(n)) bad('Pick a nationality.')
    out.nationality = n
  }
  if (input.gender !== undefined) {
    if (input.gender !== null && input.gender !== 'male' && input.gender !== 'female') bad('Pick a gender.')
    out.gender = input.gender
  }
  if (input.dateOfBirth !== undefined) {
    if (input.dateOfBirth && !isIsoDate(input.dateOfBirth)) bad('The date of birth is not a valid date.')
    out.dateOfBirth = input.dateOfBirth || null
  }
  if (input.hireDate !== undefined) {
    if (!isIsoDate(input.hireDate)) bad('Enter the hire date.')
    out.hireDate = input.hireDate
  }
  if (input.employmentType !== undefined) {
    if (!TYPES.includes(input.employmentType)) bad('Pick an employment type.')
    out.employmentType = input.employmentType
  }
  if (input.status !== undefined) {
    if (!EMPLOYMENT_STATUSES.includes(input.status)) bad('Pick a status.')
    out.status = input.status
  }
  if (input.exitDate !== undefined) {
    if (input.exitDate && !isIsoDate(input.exitDate)) bad('The exit date is not a valid date.')
    out.exitDate = input.exitDate || null
  }
  if (input.departmentId !== undefined) {
    if (input.departmentId) {
      const d = departments.find((x) => x.companyId === companyId && x.id === input.departmentId)
      if (!d) bad('Pick a department.')
      if (!d!.active && d!.id !== base?.departmentId) bad(`${d!.name} is inactive; pick an active department.`)
    }
    out.departmentId = input.departmentId || null
  }
  if (input.managerId !== undefined) {
    if (input.managerId) {
      const m = companyEmployee(companyId, input.managerId)
      if (!m) bad('That manager doesn’t exist.')
      if (base && m!.id === base.id) bad('An employee can’t be their own manager.')
      if (base) {
        const seen = new Set<string>()
        let cur = m
        while (cur?.managerId && !seen.has(cur.id)) {
          seen.add(cur.id)
          if (cur.managerId === base.id) bad(`${m!.fullName} already reports to ${base.fullName}, so this would create a loop.`)
          cur = companyEmployee(companyId, cur.managerId)
        }
      }
    }
    out.managerId = input.managerId || null
  }
  const merged = { ...(base ?? {}), ...out }
  if (merged.status && LEAVING.includes(merged.status) && !merged.exitDate) bad('Set the exit date (last working day) for an employee who is leaving.')
  if (merged.exitDate && merged.hireDate && merged.exitDate < merged.hireDate) bad('The exit date can’t be before the hire date.')
  return out
}

function nextEmployeeNo(companyId: string): string {
  const own = hrEmployees.filter((e) => e.companyId === companyId)
  const prefix = own[0]?.employeeNo.match(/^([A-Z]+)-/)?.[1] ?? 'EMP'
  const max = Math.max(0, ...own.map((e) => Number(e.employeeNo.replace(/\D/g, '')) || 0))
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

function checkUserLink(companyId: string, userId: unknown, employeeId: string | null): User {
  const u = typeof userId === 'string' ? users.find((x) => x.id === userId && x.companyId === companyId) : undefined
  if (!u) throw new ApiError(NOT_FOUND, 404)
  const holder = hrEmployees.find((e) => e.companyId === companyId && e.userId === u.id && e.id !== employeeId)
  if (holder) bad(`${u.name} is already linked to ${holder.fullName} (${holder.employeeNo}).`)
  return u
}

/**
 * Creates an employee record in `companyId` (no login is created). Validates like the HR form; throws an
 * ApiError (422 / 404) on bad input. The id is `EMP-<userId>` when a user is linked, else `EMP-X<n>`
 * (unique across companies). Recruitment's hire flow calls this with the candidate's data.
 */
export function createEmployee(companyId: string, input: Partial<EmployeeInput>, actor: HrActor): Tenant<Employee> {
  const i = input ?? {}
  if (!i.fullName || !i.jobTitle || !i.hireDate) bad('Full name, job title and hire date are required.')
  const values = clean(companyId, { nationality: 'AE', employmentType: 'full_time', status: 'active', exitDate: null, ...i }, null)
  let userId: string | null = null
  if (i.userId) userId = checkUserLink(companyId, i.userId, null).id
  const id = userId && !hrEmployees.some((e) => e.id === `EMP-${userId}`) ? `EMP-${userId}` : nextHrId('EMP-X', hrEmployees)
  const now = new Date().toISOString()
  const e: Tenant<Employee> = {
    companyId,
    id,
    userId,
    employeeNo: nextEmployeeNo(companyId),
    fullName: values.fullName!,
    jobTitle: values.jobTitle!,
    departmentId: values.departmentId ?? null,
    managerId: values.managerId ?? null,
    email: values.email ?? '',
    mobile: values.mobile ?? '',
    nationality: values.nationality ?? 'AE',
    gender: values.gender ?? null,
    dateOfBirth: values.dateOfBirth ?? null,
    hireDate: values.hireDate!,
    employmentType: values.employmentType ?? 'full_time',
    status: values.status ?? 'active',
    exitDate: values.exitDate ?? null,
    createdAt: now,
    updatedAt: now,
  }
  const p: Tenant<ProfileRecord> = { companyId, employeeId: id, emergencyContact: { name: '', relation: '', phone: '' }, address: { line1: '', city: '', country: '' }, bankName: '', accountName: '', iban: '', offboarding: null }
  applyProfile(p, i)
  hrEmployees.push(e)
  hrProfiles.push(p)
  if (LEAVING.includes(e.status)) p.offboarding = { startedAt: now, completedAt: null, completedBy: null }
  logHr(companyId, e.id, actor, 'created', `Employee record created${userId ? ' and linked to a user' : ''}`, now)
  // Onboarding (status onboarding, e.g. a Recruitment hire) / offboarding journeys start here (services/hrJourney.ts).
  journeyOnEmployeeCreated(e, actor)
  return e
}

/* ---------------- endpoints ---------------- */

export async function listEmployees(user: User): Promise<EmployeeRow[]> {
  const rows = visibleEmployees(user)
  const co = tenantOf(user)
  runHrPeopleAlerts(co)
  const today = companyDayOf(co).today
  return delay(rows.map((e) => rowOf(e, today)).sort((a, b) => a.employeeNo.localeCompare(b.employeeNo)))
}

export async function exportEmployees(user: User): Promise<EmployeeExportRow[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  const today = companyDayOf(co).today
  return delay(
    visibleEmployees(user)
      .map((e) => rowOf(e, today))
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
      .map((r) => ({
        employeeNo: r.employeeNo,
        fullName: r.fullName,
        jobTitle: r.jobTitle,
        department: r.departmentName ?? '',
        manager: r.managerName ?? '',
        nationality: r.nationality,
        hireDate: r.hireDate,
        status: EMPLOYMENT_STATUS_LABEL[r.status],
        employmentType: EMPLOYMENT_TYPE_LABEL[r.employmentType],
        email: r.email,
        mobile: r.mobile,
        // Document state only: numbers never leave in an export.
        documents: r.docAlert ? `${r.docAlertCount} ${r.docAlert === 'expired' ? 'expired / expiring' : 'expiring'}` : 'OK',
      })),
  )
}

export async function getEmployee(user: User, id: string): Promise<EmployeeDetail> {
  const e = visibleEmployee(user, id)
  runHrPeopleAlerts(e.companyId)
  return delay(detailOf(user, hrAccessOf(user), e))
}

export async function createEmployeeFor(user: User, input: Partial<EmployeeInput> | null): Promise<EmployeeDetail> {
  assertHrFull(user)
  const e = createEmployee(tenantOf(user), input ?? {}, user)
  return delay(detailOf(user, 'full', e))
}

export async function updateEmployee(user: User, id: string, input: Partial<EmployeeInput> | null): Promise<EmployeeDetail> {
  const e = visibleEmployee(user, id)
  assertHrFull(user)
  const patch = { ...(input ?? {}) }
  delete patch.userId
  const values = clean(e.companyId, patch, e)
  const p = profileOf(e.companyId, e.id)
  applyProfile(p, patch)
  const now = new Date().toISOString()
  const before = e.status
  Object.assign(e, values, { updatedAt: now })
  if (LEAVING.includes(e.status) && !p.offboarding) p.offboarding = { startedAt: now, completedAt: null, completedBy: null }
  if (!LEAVING.includes(e.status) && p.offboarding && !p.offboarding.completedAt) p.offboarding = null
  const changed = Object.keys(values).filter((k) => k !== 'updatedAt')
  if (before !== e.status) logHr(e.companyId, e.id, user, 'status', `Status changed: ${EMPLOYMENT_STATUS_LABEL[before]} → ${EMPLOYMENT_STATUS_LABEL[e.status]}${e.exitDate && LEAVING.includes(e.status) ? ` (exit ${e.exitDate})` : ''}`, now)
  else if (changed.length || patch.bank || patch.address || patch.emergencyContact) logHr(e.companyId, e.id, user, 'updated', 'Profile updated', now)
  if (before !== e.status) journeyOnStatusChanged(e, before, user)
  return delay(detailOf(user, 'full', e))
}

/** POST /hr/employees/:id/reveal { field: 'iban' } — HR full only; audited. */
export async function revealEmployeeField(user: User, id: string, input: { field?: unknown } | null): Promise<{ field: string; value: string }> {
  const e = visibleEmployee(user, id)
  assertHrFull(user)
  if (input?.field !== 'iban') bad('Only the IBAN can be revealed here.')
  const p = profileOf(e.companyId, e.id)
  logHr(e.companyId, e.id, user, 'revealed', 'Viewed the full IBAN')
  recordAudit(user, { action: 'security', entity: 'employee', entityId: e.id, summary: `Viewed the IBAN of ${e.fullName}`, changes: [] })
  return delay({ field: 'iban', value: p.iban })
}

export async function unlinkedUsers(user: User): Promise<UnlinkedUser[]> {
  assertHrFull(user)
  const co = tenantOf(user)
  const linked = new Set(hrEmployees.filter((e) => e.companyId === co && e.userId).map((e) => e.userId))
  return delay(users.filter((u) => u.companyId === co && u.active && !linked.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })))
}

/** POST /hr/employees/:id/link-user { user_id | null } — HR full. */
export async function linkUser(user: User, id: string, input: { userId?: unknown } | null): Promise<EmployeeDetail> {
  const e = visibleEmployee(user, id)
  assertHrFull(user)
  const now = new Date().toISOString()
  if (input?.userId === null || input?.userId === '') {
    if (e.userId) logHr(e.companyId, e.id, user, 'login', 'Unlinked from the system user', now)
    e.userId = null
  } else {
    const u = checkUserLink(e.companyId, input?.userId, e.id)
    e.userId = u.id
    logHr(e.companyId, e.id, user, 'login', `Linked to the user ${u.name} (${u.email})`, now)
  }
  e.updatedAt = now
  return delay(detailOf(user, 'full', e))
}

/** POST /hr/employees/:id/offboarding/complete — blocked while assets are still assigned. */
export async function completeOffboarding(user: User, id: string): Promise<EmployeeDetail> {
  const e = visibleEmployee(user, id)
  assertHrFull(user)
  const p = profileOf(e.companyId, e.id)
  if (!p.offboarding) bad('Set the status to Notice period or Left (with the exit date) to start the offboarding.')
  if (p.offboarding!.completedAt) bad('The offboarding is already completed.')
  const held = assetsHeldBy(e)
  if (held.length) bad(`Return or mark lost the assets first: ${held.map((a) => `${a.tag} ${a.name}`).join(', ')}.`)
  const now = new Date().toISOString()
  p.offboarding = { ...p.offboarding!, completedAt: now, completedBy: user.id }
  e.status = 'terminated'
  if (!e.exitDate) e.exitDate = companyDayOf(e.companyId).today
  e.updatedAt = now
  logHr(e.companyId, e.id, user, 'offboarding', 'Offboarding completed', now)
  journeyOnOffboardingCompleted(e, user)
  return delay(detailOf(user, 'full', e))
}

/* ---------------- documents ---------------- */

function cleanDoc(input: Partial<DocumentInput>, base: DocumentRecord | null): Partial<DocumentRecord> {
  const out: Partial<DocumentRecord> = {}
  if (input.type !== undefined) {
    if (!DOCUMENT_TYPES.includes(input.type as DocumentType)) bad('Pick a document type.')
    out.type = input.type
  }
  if (input.number !== undefined && input.number !== null && String(input.number).trim() !== '') {
    const n = String(input.number).trim()
    if (n.length < 4 || n.length > 40) bad('The document number should be 4–40 characters.')
    out.number = n
  }
  if (input.issueDate !== undefined) {
    if (input.issueDate && !isIsoDate(input.issueDate)) bad('The issue date is not a valid date.')
    out.issueDate = input.issueDate || null
  }
  if (input.expiryDate !== undefined) {
    if (input.expiryDate && !isIsoDate(input.expiryDate)) bad('The expiry date is not a valid date.')
    out.expiryDate = input.expiryDate || null
  }
  if (input.issuingCountry !== undefined) {
    const c = String(input.issuingCountry ?? '').trim().toUpperCase()
    if (c && !/^[A-Z]{2}$/.test(c)) bad('Issuing country: use a 2-letter country code.')
    out.issuingCountry = c
  }
  if (input.notes !== undefined) out.notes = String(input.notes ?? '').slice(0, 1000)
  if (input.file !== undefined) out.file = fileOf(input.file)
  const merged = { ...(base ?? {}), ...out }
  if (merged.issueDate && merged.expiryDate && merged.expiryDate <= merged.issueDate) bad('The expiry date must be after the issue date.')
  return out
}

function visibleDoc(user: User, id: string): Tenant<DocumentRecord> {
  const ids = new Set(visibleEmployees(user).map((e) => e.id))
  const d = hrDocuments.find((x) => x.companyId === tenantOf(user) && x.id === id && ids.has(x.employeeId))
  if (!d) throw new ApiError(NOT_FOUND, 404)
  return d
}

export async function addDocument(user: User, employeeId: string, input: Partial<DocumentInput> | null): Promise<EmployeeDocument> {
  const e = visibleEmployee(user, employeeId)
  assertHrFull(user)
  const i = input ?? {}
  if (!i.type || !i.number) bad('Document type and number are required.')
  const v = cleanDoc(i, null)
  if (v.file) chargeFile(e.companyId, v.file, null)
  const now = new Date().toISOString()
  const d: Tenant<DocumentRecord> = {
    companyId: e.companyId,
    id: nextHrId('HDOC-', hrDocuments),
    employeeId: e.id,
    type: v.type!,
    number: v.number!,
    issueDate: v.issueDate ?? null,
    expiryDate: v.expiryDate ?? null,
    issuingCountry: v.issuingCountry ?? '',
    file: v.file ?? null,
    notes: v.notes ?? '',
    alertMarks: [],
    createdAt: now,
    updatedAt: now,
  }
  hrDocuments.push(d)
  if (d.file) noteUsage(e.companyId)
  logHr(e.companyId, e.id, user, 'document', `${DOCUMENT_TYPE_LABEL[d.type]} ${maskLast4(d.number)} added${d.expiryDate ? ` (expires ${d.expiryDate})` : ''}`, now)
  return delay(docView(d, companyDayOf(e.companyId).today))
}

export async function updateDocument(user: User, id: string, input: Partial<DocumentInput> | null): Promise<EmployeeDocument> {
  const d = visibleDoc(user, id)
  assertHrFull(user)
  const v = cleanDoc(input ?? {}, d)
  if (v.file !== undefined) chargeFile(d.companyId, v.file, d.file)
  const now = new Date().toISOString()
  // A new expiry date re-arms the 60-day and expiry reminders.
  if (v.expiryDate !== undefined && v.expiryDate !== d.expiryDate) d.alertMarks = []
  Object.assign(d, v, { updatedAt: now })
  if (v.file) noteUsage(d.companyId)
  logHr(d.companyId, d.employeeId, user, 'document', `${DOCUMENT_TYPE_LABEL[d.type]} ${maskLast4(d.number)} updated`, now)
  return delay(docView(d, companyDayOf(d.companyId).today))
}

export async function deleteDocument(user: User, id: string): Promise<{ id: string }> {
  const d = visibleDoc(user, id)
  assertHrFull(user)
  hrDocuments.splice(hrDocuments.indexOf(d), 1)
  noteUsage(d.companyId)
  logHr(d.companyId, d.employeeId, user, 'document', `${DOCUMENT_TYPE_LABEL[d.type]} ${maskLast4(d.number)} deleted`)
  return delay({ id: d.id })
}

/** POST /hr/documents/:id/reveal — the full number, HR full only; audited on the employee and in the audit log. */
export async function revealDocument(user: User, id: string): Promise<{ id: string; number: string }> {
  const d = visibleDoc(user, id)
  assertHrFull(user)
  logHr(d.companyId, d.employeeId, user, 'revealed', `Viewed the full ${DOCUMENT_TYPE_LABEL[d.type]} number`)
  recordAudit(user, { action: 'security', entity: 'employee_document', entityId: d.id, summary: `Viewed a ${DOCUMENT_TYPE_LABEL[d.type]} number`, changes: [] })
  return delay({ id: d.id, number: d.number })
}
