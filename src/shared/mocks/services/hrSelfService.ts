import type { User } from '@/shared/types'
import type { Payslip } from '@/modules/hr/payroll/types'
import type { MyHr, ProfileChangeField, ProfileChangeInput, ProfileChangeRequest, ProfileChangeValues, SelfServiceInbox } from '@/modules/hr/selfservice/types'
import { PROFILE_CHANGE_FIELD_LABEL } from '@/modules/hr/selfservice/types'
import { recordAudit } from '@/shared/mocks/data/audit'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrContracts, hrDocuments, maskLast4 } from '@/shared/mocks/data/hrPeople'
import { hrProfileChanges, type ProfileChangeRecord } from '@/shared/mocks/data/hrSelfService'
import { nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { type Tenant } from '@/shared/mocks/tenant'
import { logHr } from './hrAccess'
import { applyProfile, docView, profileOf } from './hrEmployees'
import { contractView } from './hrContracts'
import { assetRow, assetsHeldBy } from './hrAssets'
import { ownPayslip, ownPayslipRows } from './hrPayroll'
import { trainingOfEmployee } from './hrTraining'
import { interviewCardsOf } from './hrRecruitment'
import { companyCurrency } from './hrTalentAccess'
import { hrRecipients, letterRowsFor, letterTypesForEmployee, MY_HR_LINK, notifyOnce, ownRequest, REQUESTS_LINK } from './hrLetters'
import { conflict, departmentName, hrCtx, invalid, isFull, notFound, requireFull, requireSelf, str, type HrCtx } from './hrTimeAccess'

/**
 * HR › Self-service (docs/API.md › HR › Self-service): the "My HR" portal of every user with an active employee
 * record — whatever their `hr` scope, like clock-in and leave (a Sales Agent too) — profile change requests decided
 * by HR full, and the HR inbox (profile changes + letter requests in one queue).
 *
 * Strictly own data: every portal answer is built from the caller's own employee record (`EMP-<userId>`); nothing
 * takes an employee id from the request. Masking as everywhere (IBAN and document numbers "•••• 1234"); a proposed IBAN
 * is served masked too and wiped from the store once the request is closed. Only HR full may reveal a pending one
 * (POST, audited), like the profile's.
 */

/* ---------------- portal ---------------- */

/** GET /hr/me — the caller's own HR data in one answer (attendance and leave come from /hr/attendance/me, /hr/leave/me). */
export async function getMyHr(user: User): Promise<MyHr> {
  const ctx = hrCtx(user)
  const me = requireSelf(ctx)
  const co = ctx.co
  const p = profileOf(co, me.id)
  const manager = me.managerId ? employeeById(co, me.managerId) : undefined
  const active = hrContracts.find((c) => c.companyId === co && c.employeeId === me.id && c.status === 'active')
  return delay({
    employee: {
      id: me.id,
      employeeNo: me.employeeNo,
      fullName: me.fullName,
      jobTitle: me.jobTitle,
      departmentName: departmentName(co, me.departmentId),
      managerName: manager?.fullName ?? null,
      email: me.email,
      mobile: me.mobile,
      nationality: me.nationality,
      hireDate: me.hireDate,
      status: me.status,
      employmentType: me.employmentType,
      exitDate: me.exitDate,
    },
    profile: {
      emergencyContact: { ...p.emergencyContact },
      address: { ...p.address },
      mobile: me.mobile,
      bank: { bankName: p.bankName, accountName: p.accountName, ibanMasked: maskLast4(p.iban) },
    },
    documents: hrDocuments
      .filter((d) => d.companyId === co && d.employeeId === me.id)
      .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'))
      .map((d) => docView(d, ctx.today)),
    contract: active ? contractView(active, user, 'own', ctx.today) : null,
    assets: assetsHeldBy(me).map(assetRow),
    payslips: ownPayslipRows(co, me.id),
    training: trainingOfEmployee(co, me),
    interviews: interviewCardsOf(co, user),
    profileChanges: changeRowsFor(ctx, { employeeId: me.id }),
    letters: letterRowsFor(ctx, { employeeId: me.id }),
    letterTypes: letterTypesForEmployee(co, me),
    hrScope: ctx.scope,
    today: ctx.today,
    timezone: ctx.timezone,
    currency: companyCurrency(co),
  })
}

/** GET /hr/me/payslips/:id — one of the caller's own paid payslips (printable), whatever their hr scope. */
export async function getMyPayslip(user: User, id: string): Promise<Payslip> {
  const ctx = hrCtx(user)
  return ownPayslip(ctx.co, requireSelf(ctx).id, id)
}

/* ---------------- profile change requests ---------------- */

const FIELD_ORDER: ProfileChangeField[] = ['mobile', 'emergency_contact', 'address', 'bank']

function fieldsOf(c: ProfileChangeRecord): ProfileChangeField[] {
  const p = c.proposed
  const has: Record<ProfileChangeField, boolean> = { mobile: p.mobile !== undefined, emergency_contact: !!p.emergencyContact, address: !!p.address, bank: !!p.bank }
  return FIELD_ORDER.filter((f) => has[f])
}

const labels = (c: ProfileChangeRecord) => fieldsOf(c).map((f) => PROFILE_CHANGE_FIELD_LABEL[f].toLowerCase()).join(', ')

function changeView(ctx: HrCtx, c: Tenant<ProfileChangeRecord>): ProfileChangeRequest {
  const e = employeeById(c.companyId, c.employeeId)
  const own = ctx.self?.id === c.employeeId
  const p = c.proposed
  const proposed: ProfileChangeValues = {}
  if (p.emergencyContact) proposed.emergencyContact = { ...p.emergencyContact }
  if (p.address) proposed.address = { ...p.address }
  if (p.mobile !== undefined) proposed.mobile = p.mobile
  if (p.bank) proposed.bank = { bankName: p.bank.bankName, accountName: p.bank.accountName, ibanMasked: p.bank.ibanMasked }
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName: e?.fullName ?? 'Unknown',
    employeeNo: e?.employeeNo ?? '',
    departmentName: departmentName(c.companyId, e?.departmentId ?? null),
    fields: fieldsOf(c),
    current: structuredClone(c.current),
    proposed,
    ibanChange: c.ibanChange,
    note: c.note,
    status: c.status,
    requestedByName: c.requestedByName,
    createdAt: c.createdAt,
    decidedByName: c.decidedByName,
    decidedAt: c.decidedAt,
    decisionComment: c.decisionComment,
    canDecide: isFull(ctx) && c.status === 'pending' && !own,
    canCancel: c.status === 'pending' && (own || isFull(ctx)),
    canReveal: isFull(ctx) && c.status === 'pending' && c.ibanChange && !own,
  }
}

const canSee = (ctx: HrCtx, c: ProfileChangeRecord) => isFull(ctx) || (!!ctx.self && c.employeeId === ctx.self.id)

function changeRowsFor(ctx: HrCtx, f: { status?: string | null; employeeId?: string | null } = {}): ProfileChangeRequest[] {
  return hrProfileChanges
    .filter((c) => c.companyId === ctx.co && canSee(ctx, c) && (!f.status || c.status === f.status) && (!f.employeeId || c.employeeId === f.employeeId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((c) => changeView(ctx, c))
}

function visibleChange(ctx: HrCtx, id: string): Tenant<ProfileChangeRecord> {
  const c = hrProfileChanges.find((x) => x.companyId === ctx.co && x.id === id)
  if (!c || !canSee(ctx, c)) throw notFound()
  return c
}

/** GET /hr/profile-changes?status — HR full: the company's; anyone else: their own. */
export async function listProfileChanges(user: User, q: { status?: string | null }): Promise<ProfileChangeRequest[]> {
  const ctx = hrCtx(user)
  if (!isFull(ctx)) requireSelf(ctx)
  return delay(changeRowsFor(ctx, q))
}

const MOBILE = /^\+?[0-9][0-9 ()-]{6,24}$/
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b)

/** POST /hr/profile-changes — the employee asks HR to change their emergency contact / address / mobile / bank account. */
export async function submitProfileChange(user: User, input: ProfileChangeInput | null): Promise<ProfileChangeRequest> {
  const ctx = hrCtx(user)
  const me = requireSelf(ctx)
  const i = input ?? {}
  if (hrProfileChanges.some((c) => c.companyId === ctx.co && c.employeeId === me.id && c.status === 'pending')) {
    throw conflict('You already have a profile change waiting for HR. Cancel it to send a new one.', 'pending_exists')
  }
  const prof = profileOf(ctx.co, me.id)
  // Validate exactly like the HR form (applyProfile throws 422) on a scratch copy; the profile itself is untouched.
  const scratch = structuredClone({ ...prof })
  applyProfile(scratch, { emergencyContact: i.emergencyContact, address: i.address, bank: i.bank })
  const proposed: ProfileChangeRecord['proposed'] = {}
  const current: ProfileChangeRecord['current'] = {}
  if (i.emergencyContact && !same(scratch.emergencyContact, prof.emergencyContact)) {
    if (!scratch.emergencyContact.name || !scratch.emergencyContact.phone) throw invalid('Give the emergency contact’s name and phone number.', 'emergency_contact')
    proposed.emergencyContact = { ...scratch.emergencyContact }
    current.emergencyContact = { ...prof.emergencyContact }
  }
  if (i.address && !same(scratch.address, prof.address)) {
    if (!scratch.address.line1 || !scratch.address.city) throw invalid('Give the address and the city.', 'address')
    proposed.address = { ...scratch.address }
    current.address = { ...prof.address }
  }
  if (i.mobile !== undefined) {
    const m = str(i.mobile, 30)
    if (!MOBILE.test(m)) throw invalid('That doesn’t look like a phone number (e.g. +971 50 123 4567).', 'mobile')
    if (m !== me.mobile) {
      proposed.mobile = m
      current.mobile = me.mobile
    }
  }
  let ibanChange = false
  if (i.bank && (scratch.bankName !== prof.bankName || scratch.accountName !== prof.accountName || scratch.iban !== prof.iban)) {
    if (!scratch.iban) throw invalid('Enter the IBAN of the account your salary should go to.', 'iban')
    if (!scratch.bankName) throw invalid('Enter the bank name.', 'bank_name')
    proposed.bank = { bankName: scratch.bankName, accountName: scratch.accountName, iban: scratch.iban, ibanMasked: maskLast4(scratch.iban) }
    current.bank = { bankName: prof.bankName, accountName: prof.accountName, ibanMasked: maskLast4(prof.iban) }
    ibanChange = scratch.iban !== prof.iban
  }
  if (!Object.keys(proposed).length) throw invalid('Nothing changed: edit at least one field.', 'no_changes')
  const at = nowIso()
  const c: Tenant<ProfileChangeRecord> = {
    companyId: ctx.co,
    id: nextChangeId(),
    employeeId: me.id,
    requestedBy: user.id,
    requestedByName: user.name,
    proposed,
    ibanChange,
    current,
    note: str(i.note, 500),
    status: 'pending',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    decisionComment: '',
    notified: [],
    createdAt: at,
    updatedAt: at,
  }
  hrProfileChanges.push(c)
  logHr(ctx.co, me.id, user, 'self-service', `Asked HR to change: ${labels(c)}`, at)
  notifyOnce(c, 'submitted', hrRecipients(ctx.co, user.id), {
    title: `Profile change requested by ${me.fullName}`,
    body: `${fieldsOf(c).map((f) => PROFILE_CHANGE_FIELD_LABEL[f]).join(', ')}${ibanChange ? ' (new bank account: check it before approving)' : ''}`,
    link: `${REQUESTS_LINK}?tab=profile&request=${encodeURIComponent(c.id)}`,
  })
  return delay(changeView(ctx, c))
}

function nextChangeId(): string {
  let max = 0
  for (const r of hrProfileChanges) if (r.id.startsWith('HPC-')) max = Math.max(max, Number(r.id.slice(4)) || 0)
  return `HPC-${max + 1}`
}

/** The full proposed IBAN is not kept once the request is closed (the masked form stays for the history). */
function close(c: ProfileChangeRecord): void {
  if (c.proposed.bank) c.proposed.bank.iban = ''
}

function pendingForDecision(ctx: HrCtx, id: string): Tenant<ProfileChangeRecord> {
  requireFull(ctx)
  const c = visibleChange(ctx, id)
  if (ctx.self?.id === c.employeeId) throw ownRequest()
  if (c.status !== 'pending') throw conflict('This request was already decided.', 'not_pending')
  return c
}

/** POST /hr/profile-changes/:id/approve — HR full (not their own): applies the change to the employee record. */
export async function approveProfileChange(user: User, id: string, input: { comment?: unknown } | null): Promise<ProfileChangeRequest> {
  const ctx = hrCtx(user)
  const c = pendingForDecision(ctx, id)
  const e = employeeById(ctx.co, c.employeeId)
  if (!e) throw notFound()
  const p = profileOf(ctx.co, e.id)
  const beforeIban = maskLast4(p.iban)
  const pr = c.proposed
  applyProfile(p, { emergencyContact: pr.emergencyContact, address: pr.address, bank: pr.bank ? { bankName: pr.bank.bankName, accountName: pr.bank.accountName, iban: pr.bank.iban } : undefined })
  const at = nowIso()
  if (pr.mobile !== undefined) e.mobile = pr.mobile
  e.updatedAt = at
  Object.assign(c, { status: 'approved', decidedBy: user.id, decidedByName: user.name, decidedAt: at, decisionComment: str(input?.comment, 500), updatedAt: at })
  close(c)
  logHr(ctx.co, e.id, user, 'updated', `Profile change approved (${labels(c)}), requested by the employee`, at)
  if (c.ibanChange) {
    recordAudit(user, {
      action: 'security',
      entity: 'employee',
      entityId: e.id,
      summary: `Approved the bank account change of ${e.fullName} (self-service request ${c.id})`,
      changes: [{ field: 'IBAN', from: beforeIban || '—', to: pr.bank!.ibanMasked }],
    })
  } else {
    recordAudit(user, { action: 'update', entity: 'employee', entityId: e.id, summary: `Approved a profile change of ${e.fullName}: ${labels(c)} (self-service request ${c.id})`, changes: [] })
  }
  if (e.userId) notifyOnce(c, 'approved', [e.userId], { title: 'Your profile change was approved', body: `Updated: ${labels(c)}`, link: MY_HR_LINK })
  return delay(changeView(ctx, c))
}

/** POST /hr/profile-changes/:id/reject — HR full (not their own), with a reason. */
export async function rejectProfileChange(user: User, id: string, input: { reason?: unknown } | null): Promise<ProfileChangeRequest> {
  const ctx = hrCtx(user)
  const c = pendingForDecision(ctx, id)
  const reason = str(input?.reason, 500)
  if (!reason) throw invalid('Give the employee a reason.', 'reason_required')
  const at = nowIso()
  Object.assign(c, { status: 'rejected', decidedBy: user.id, decidedByName: user.name, decidedAt: at, decisionComment: reason, updatedAt: at })
  close(c)
  logHr(ctx.co, c.employeeId, user, 'self-service', `Profile change rejected (${labels(c)}): ${reason}`, at)
  const e = employeeById(ctx.co, c.employeeId)
  if (e?.userId) notifyOnce(c, 'rejected', [e.userId], { title: 'Your profile change was rejected', body: reason, link: MY_HR_LINK })
  return delay(changeView(ctx, c))
}

/** POST /hr/profile-changes/:id/cancel — the employee (own, pending) or HR full. */
export async function cancelProfileChange(user: User, id: string): Promise<ProfileChangeRequest> {
  const ctx = hrCtx(user)
  const c = visibleChange(ctx, id)
  if (c.status !== 'pending') throw conflict('Only a request waiting for HR can be cancelled.', 'not_pending')
  const at = nowIso()
  Object.assign(c, { status: 'cancelled', updatedAt: at })
  close(c)
  logHr(ctx.co, c.employeeId, user, 'self-service', `Profile change cancelled (${labels(c)})`, at)
  return delay(changeView(ctx, c))
}

/** POST /hr/profile-changes/:id/reveal — HR full: the full proposed IBAN of a pending request, audited. */
export async function revealProfileChangeIban(user: User, id: string): Promise<{ id: string; iban: string }> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const c = visibleChange(ctx, id)
  if (ctx.self?.id === c.employeeId) throw ownRequest()
  if (c.status !== 'pending' || !c.proposed.bank?.iban) throw invalid('Only the new IBAN of a pending request can be revealed.', 'nothing_to_reveal')
  const e = employeeById(ctx.co, c.employeeId)
  logHr(ctx.co, c.employeeId, user, 'revealed', 'Viewed the full IBAN of a requested bank account change')
  recordAudit(user, { action: 'security', entity: 'employee', entityId: c.employeeId, summary: `Viewed the requested new IBAN of ${e?.fullName ?? c.employeeId} (${c.id})`, changes: [] })
  return delay({ id: c.id, iban: c.proposed.bank.iban })
}

/* ---------------- HR inbox ---------------- */

/** GET /hr/self-service/inbox — HR full: pending profile changes and letter requests, with counts. */
export async function getInbox(user: User): Promise<SelfServiceInbox> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const profileChanges = changeRowsFor(ctx, { status: 'pending' })
  const letters = letterRowsFor(ctx, { status: 'pending' })
  return delay({ counts: { profileChanges: profileChanges.length, letters: letters.length, total: profileChanges.length + letters.length }, profileChanges, letters })
}

