import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import type { AssetCategory, AssetCondition, AssetDetail, AssetInput, AssetRow, AssetStatus, AssignInput, HrAccess, ReturnInput } from '@/modules/hr/peopleTypes'
import { ASSET_CATEGORIES, ASSET_CONDITIONS } from '@/modules/hr/peopleTypes'
import { ApiError } from '@/shared/lib/apiError'
import { companyById } from '@/shared/mocks/data/tenancy'
import { hrAssets, nextHrId, type AssetRecord } from '@/shared/mocks/data/hrPeople'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { delay } from '@/shared/mocks/server'
import { NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertHrFull, companyEmployee, employeeName, hrAccessOf, isIsoDate, logHr, visibleEmployeeIds } from './hrAccess'

/**
 * HR › Company assets (docs/API.md › HR › Company assets): the asset register (tag unique per company) with
 * its assignment history. HR full manages it; team viewers see the assets held by their team, an employee
 * their own. An offboarding can't be completed while the employee still holds an asset (returned, or marked
 * lost with a note). Warranty reminders (30 days) live in services/hrPeopleAlerts.ts.
 */

const bad = (message: string): never => {
  throw new ApiError(message, 422)
}

const current = (a: AssetRecord) => (a.status === 'assigned' ? [...a.assignments].reverse().find((x) => !x.returnedDate && !x.lost) ?? null : null)

export function assetRow(a: Tenant<AssetRecord>): AssetRow {
  const cur = current(a)
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    category: a.category,
    brand: a.brand,
    model: a.model,
    serial: a.serial,
    purchaseDate: a.purchaseDate,
    cost: a.cost,
    currency: a.currency,
    condition: a.condition,
    status: a.status,
    warrantyEnd: a.warrantyEnd,
    assignedToId: cur?.employeeId ?? null,
    assignedToName: cur ? employeeName(a.companyId, cur.employeeId) : null,
    assignedDate: cur?.assignedDate ?? null,
    notes: a.notes,
  }
}

function detail(a: Tenant<AssetRecord>, access: HrAccess, visible: Set<string>): AssetDetail {
  return {
    ...assetRow(a),
    // Team / own viewers see only the hand-overs of people in their scope.
    history: a.assignments
      .filter((h) => access === 'full' || visible.has(h.employeeId))
      .map((h) => ({ ...h, employeeName: employeeName(a.companyId, h.employeeId) ?? 'Unknown' }))
      .reverse(),
    canManage: access === 'full',
  }
}

/** Assets an employee holds now (Assets tab, offboarding). */
export function assetsHeldBy(employee: Tenant<Employee>): Tenant<AssetRecord>[] {
  return hrAssets.filter((a) => a.companyId === employee.companyId && a.status === 'assigned' && current(a)?.employeeId === employee.id)
}

function visibleAssets(user: User): { rows: Tenant<AssetRecord>[]; access: HrAccess; ids: Set<string> } {
  const access = hrAccessOf(user)
  const co = tenantOf(user)
  const ids = visibleEmployeeIds(user)
  const rows = hrAssets.filter((a) => {
    if (a.companyId !== co) return false
    if (access === 'full') return true
    const cur = current(a)
    return !!cur && ids.has(cur.employeeId)
  })
  return { rows, access, ids }
}

function visibleAsset(user: User, id: string): { a: Tenant<AssetRecord>; access: HrAccess; ids: Set<string> } {
  const v = visibleAssets(user)
  const a = v.rows.find((x) => x.id === id)
  if (!a) throw new ApiError(NOT_FOUND, 404)
  return { a, access: v.access, ids: v.ids }
}

export interface AssetQuery {
  status?: string | null
  category?: string | null
  employeeId?: string | null
}

export async function listAssets(user: User, q: AssetQuery = {}): Promise<AssetRow[]> {
  const { rows } = visibleAssets(user)
  return delay(
    rows
      .filter((a) => !q.status || a.status === q.status)
      .filter((a) => !q.category || a.category === q.category)
      .filter((a) => !q.employeeId || current(a)?.employeeId === q.employeeId)
      .sort((a, b) => a.tag.localeCompare(b.tag))
      .map(assetRow),
  )
}

export async function getAsset(user: User, id: string): Promise<AssetDetail> {
  const { a, access, ids } = visibleAsset(user, id)
  return delay(detail(a, access, ids))
}

const condition = (v: unknown, field = 'Condition'): AssetCondition => (ASSET_CONDITIONS.includes(v as AssetCondition) ? (v as AssetCondition) : bad(`${field}: pick one of the listed conditions.`))

function clean(companyId: string, input: Partial<AssetInput>, base: Tenant<AssetRecord> | null): Partial<AssetRecord> {
  const out: Partial<AssetRecord> = {}
  if (input.tag !== undefined) {
    const tag = String(input.tag ?? '').trim().toUpperCase()
    if (!tag || tag.length > 40) bad('Enter an asset tag (40 characters max).')
    // Unique per company (another company may use the same tag).
    if (hrAssets.some((a) => a.companyId === companyId && a.id !== base?.id && a.tag.toUpperCase() === tag)) bad(`Tag ${tag} is already used by another asset.`)
    out.tag = tag
  }
  if (input.name !== undefined) {
    const name = String(input.name ?? '').trim()
    if (name.length < 2 || name.length > 120) bad('Enter the asset name.')
    out.name = name
  }
  if (input.category !== undefined) {
    if (!ASSET_CATEGORIES.includes(input.category as AssetCategory)) bad('Pick a category.')
    out.category = input.category
  }
  for (const k of ['brand', 'model', 'serial', 'notes'] as const) if (input[k] !== undefined) out[k] = String(input[k] ?? '').trim().slice(0, k === 'notes' ? 2000 : 120)
  if (input.purchaseDate !== undefined) {
    if (input.purchaseDate && !isIsoDate(input.purchaseDate)) bad('The purchase date is not a valid date.')
    out.purchaseDate = input.purchaseDate || null
  }
  if (input.warrantyEnd !== undefined) {
    if (input.warrantyEnd && !isIsoDate(input.warrantyEnd)) bad('The warranty end is not a valid date.')
    out.warrantyEnd = input.warrantyEnd || null
  }
  if (input.cost !== undefined) {
    if (input.cost === null || (input.cost as unknown) === '') out.cost = null
    else {
      const n = Number(input.cost)
      if (!Number.isFinite(n) || n < 0) bad('Cost must be a positive amount.')
      out.cost = Math.round(n * 100) / 100
    }
  }
  if (input.currency !== undefined) {
    const cur = String(input.currency ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(cur)) bad('Pick a currency.')
    out.currency = cur
  }
  if (input.condition !== undefined) out.condition = condition(input.condition)
  if (input.status !== undefined) {
    const s = input.status as AssetStatus
    if (!['in_stock', 'in_repair', 'retired'].includes(s)) bad('Use Assign, Return or Mark lost to change who holds an asset.')
    if (base && base.status === 'assigned') bad('Return the asset before changing its status.')
    out.status = s
  }
  return out
}

export async function createAsset(user: User, input: Partial<AssetInput> | null): Promise<AssetRow> {
  assertHrFull(user)
  const co = tenantOf(user)
  const i = input ?? {}
  if (!i.tag || !i.name || !i.category) bad('Tag, name and category are required.')
  const v = clean(co, { condition: 'new', currency: companyById(co)?.regional.currency ?? 'AED', ...i }, null)
  const now = new Date().toISOString()
  const a: Tenant<AssetRecord> = {
    companyId: co,
    id: nextHrId('HAS-', hrAssets),
    tag: v.tag!,
    name: v.name!,
    category: v.category!,
    brand: v.brand ?? '',
    model: v.model ?? '',
    serial: v.serial ?? '',
    purchaseDate: v.purchaseDate ?? null,
    cost: v.cost ?? null,
    currency: v.currency!,
    condition: v.condition ?? 'new',
    status: v.status ?? 'in_stock',
    warrantyEnd: v.warrantyEnd ?? null,
    notes: v.notes ?? '',
    assignments: [],
    alertMarks: [],
    createdAt: now,
    updatedAt: now,
  }
  hrAssets.push(a)
  return delay(assetRow(a))
}

export async function updateAsset(user: User, id: string, input: Partial<AssetInput> | null): Promise<AssetDetail> {
  const { a, ids } = visibleAsset(user, id)
  assertHrFull(user)
  const v = clean(a.companyId, input ?? {}, a)
  if (v.warrantyEnd !== undefined && v.warrantyEnd !== a.warrantyEnd) a.alertMarks = []
  Object.assign(a, v, { updatedAt: new Date().toISOString() })
  return delay(detail(a, 'full', ids))
}

export async function assignAsset(user: User, id: string, input: Partial<AssignInput> | null): Promise<AssetDetail> {
  const { a, ids } = visibleAsset(user, id)
  assertHrFull(user)
  const e = companyEmployee(a.companyId, input?.employeeId)
  if (!e) throw new ApiError(NOT_FOUND, 404)
  if (a.status !== 'in_stock') bad(a.status === 'assigned' ? `${a.tag} is already assigned. Return it first.` : `${a.tag} is ${a.status.replace('_', ' ')} and can’t be assigned.`)
  if (e.status === 'terminated') bad(`${e.fullName} has left the company.`)
  const date = input?.date ?? companyDayOf(a.companyId).today
  if (!isIsoDate(date)) bad('Enter the hand-over date.')
  const cond = condition(input?.condition ?? a.condition)
  const now = new Date().toISOString()
  a.assignments.push({
    id: nextHrId('HAA-', hrAssets.flatMap((x) => x.assignments)),
    employeeId: e.id,
    assignedDate: date,
    assignedCondition: cond,
    handoverNote: String(input?.note ?? '').slice(0, 1000),
    returnedDate: null,
    returnedCondition: null,
    returnNote: '',
    lost: false,
  })
  a.status = 'assigned'
  a.condition = cond
  a.updatedAt = now
  logHr(a.companyId, e.id, user, 'asset', `${a.tag} ${a.name} assigned`, now)
  return delay(detail(a, 'full', ids))
}

export async function returnAsset(user: User, id: string, input: Partial<ReturnInput> | null): Promise<AssetDetail> {
  const { a, ids } = visibleAsset(user, id)
  assertHrFull(user)
  const cur = current(a)
  if (!cur) bad(`${a.tag} isn’t assigned to anyone.`)
  const date = input?.date ?? companyDayOf(a.companyId).today
  if (!isIsoDate(date)) bad('Enter the return date.')
  if (date < cur!.assignedDate) bad('The return date can’t be before the hand-over date.')
  const cond = condition(input?.condition ?? a.condition)
  const now = new Date().toISOString()
  cur!.returnedDate = date
  cur!.returnedCondition = cond
  cur!.returnNote = String(input?.note ?? '').slice(0, 1000)
  a.status = cond === 'damaged' ? 'in_repair' : 'in_stock'
  a.condition = cond
  a.updatedAt = now
  logHr(a.companyId, cur!.employeeId, user, 'asset', `${a.tag} ${a.name} returned (${cond})`, now)
  return delay(detail(a, 'full', ids))
}

export async function markAssetLost(user: User, id: string, input: { note?: string } | null): Promise<AssetDetail> {
  const { a, ids } = visibleAsset(user, id)
  assertHrFull(user)
  const note = String(input?.note ?? '').trim()
  if (note.length < 3) bad('Add a note: what happened to the asset?')
  if (a.status === 'lost' || a.status === 'retired') bad(`${a.tag} is already ${a.status}.`)
  const cur = current(a)
  const now = new Date().toISOString()
  if (cur) {
    cur.lost = true
    cur.returnNote = note.slice(0, 1000)
    logHr(a.companyId, cur.employeeId, user, 'asset', `${a.tag} ${a.name} marked lost: ${note.slice(0, 120)}`, now)
  }
  a.status = 'lost'
  a.notes = a.notes ? `${a.notes}\nLost: ${note}` : `Lost: ${note}`
  a.updatedAt = now
  return delay(detail(a, 'full', ids))
}
