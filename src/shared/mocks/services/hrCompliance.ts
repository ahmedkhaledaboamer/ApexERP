import type { Role, User } from '@/shared/types'
import type { HrFile } from '@/modules/hr/peopleTypes'
import type { DigitStyle, LetterLanguage } from '@/modules/hr/selfservice/types'
import { LETTER_LANGUAGES } from '@/modules/hr/selfservice/types'
import type {
  AcknowledgeInput,
  DepartmentAckRow,
  DisciplinaryAttachment,
  DisciplinaryCategory,
  DisciplinaryDetail,
  DisciplinaryInput,
  DisciplinaryRow,
  DisciplinaryType,
  MyPolicy,
  PolicyAudience,
  PolicyCategory,
  PolicyDetail,
  PolicyExportRow,
  PolicyInput,
  PolicyRow,
  PolicyStats,
  PolicyStatusReport,
  WarningLetter,
} from '@/modules/hr/compliance/types'
import {
  DISCIPLINARY_CATEGORIES,
  DISCIPLINARY_CATEGORY_LABEL,
  DISCIPLINARY_CATEGORY_LABEL_AR,
  DISCIPLINARY_TYPES,
  DISCIPLINARY_TYPE_LABEL,
  DISCIPLINARY_TYPE_LABEL_AR,
  EXPIRY_MONTH_OPTIONS,
  POLICY_CATEGORIES,
  POLICY_CATEGORY_LABEL,
} from '@/modules/hr/compliance/types'
import { WARNING_KEYS, WARNING_LETTER_AR, WARNING_LETTER_EN, defaultExpiryMonths, disciplinaryStatus, dueReminder, escalationHint, expiryDate, pct } from '@/modules/hr/compliance/rules'
import { AR_CURRENCY, AR_MONTHS, AR_REQUIRED_SOURCE, PLACEHOLDERS, letterDate, letterDateAr, letterMoney, letterMoneyAr, renderTemplate, toArabicDigits } from '@/modules/hr/selfservice/letters'
import { monthLabel } from '@/modules/hr/payroll/calc'
import { PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { recordAudit } from '@/shared/mocks/data/audit'
import { activeMembershipOf, companyById } from '@/shared/mocks/data/tenancy'
import { departments } from '@/shared/mocks/data/departments'
import { employeeById, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { users } from '@/shared/mocks/db'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { hrPayAdjustments } from '@/shared/mocks/data/hrPayroll'
import {
  hrDisciplinary,
  hrPolicies,
  hrPolicyAcks,
  nextCaseSeq,
  type DisciplinaryRecord,
  type PolicyRecord,
} from '@/shared/mocks/data/hrCompliance'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { now as clockNow, nowIso } from '@/shared/mocks/clock'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { delay } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, companyModules, onLifecycleTick } from './billing'
import { fileOf } from './hrContracts'
import { hrFullUsers, logHr } from './hrAccess'
import { HR_REQUESTS_ALERT, letterValues, letterValuesAr, letterheadOf, prefixOf } from './hrLetters'
import { upsertSystemAdjustment } from './hrPayroll'
import { ackOf, audienceOf, latestAckOf, policiesFor } from './hrPolicyAudience'
import { conflict, departmentName, forbidden, hrCtx, invalid, isFull, notFound, requireFull, requireSelf, str, teamEmployeeIds, type HrCtx } from './hrTimeAccess'

/**
 * HR › Discipline (warnings & disciplinary actions) and Policies (docs/API.md › HR › Discipline, Policies).
 *
 * Visibility (matrix `hr` column): full (Company Admin, Management, HR Manager) every record / policy of the company and
 * the only writers; team (Department Head) the records of their team (departments they head + sub-departments, direct
 * reports) and the policy dashboards restricted to their team, read-only; everyone with an employee record (any role,
 * a Sales Agent too: self-service) their OWN records and the policies addressed to them. Anything else → 404 like a
 * missing id. A deduction amount (pay) is shown to HR full and the employee only.
 *
 * Payroll: a `deduction` creates a one-off payroll adjustment through upsertSystemAdjustment (sourceRef
 * `discipline:<id>`, idempotent); withdrawing the record removes it while it's unpaid (a paid one stays: history).
 *
 * Notifications (stored, type `hr-requests`, bell group HR): a record issued / withdrawn → the employee; acknowledged /
 * appealed → HR full users and the issuer; policy reminders → each audience employee who hasn't acknowledged the
 * current version, once at publish, +3 and +7 company days (lazy lifecycle tick, once-only marks).
 */

const MY_HR_LINK = '/hr/me'
const MY_POLICIES_LINK = '/hr/me/policies'
const disciplineLink = (id: string) => `/hr/discipline?record=${encodeURIComponent(id)}`

const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const nextId = (prefix: string, rows: readonly { id: string }[]) => {
  let max = 0
  for (const r of rows) if (r.id.startsWith(prefix)) max = Math.max(max, Number(r.id.slice(prefix.length)) || 0)
  return `${prefix}${max + 1}`
}
const notify = (co: string, userIds: readonly (string | null | undefined)[], n: { title: string; body: string; link: string }) => {
  const at = nowIso()
  for (const userId of new Set(userIds.filter((x): x is string => !!x))) pushNotification({ companyId: co, userId, type: HR_REQUESTS_ALERT, ...n, at })
}

/* ======================= access ======================= */

/** Employee ids whose records the caller may read: full → all; team → their team (+ self); anyone else → self. */
function readableIds(ctx: HrCtx): Set<string> | 'all' {
  if (isFull(ctx)) return 'all'
  if (ctx.scope === 'team') return teamEmployeeIds(ctx)
  return new Set(ctx.self ? [ctx.self.id] : [])
}
const canRead = (ids: Set<string> | 'all', employeeId: string) => ids === 'all' || ids.has(employeeId)

/* ======================= discipline: views ======================= */

function activeRecordsOf(co: string, employeeId: string, today: string) {
  return hrDisciplinary.filter((r) => r.companyId === co && r.employeeId === employeeId && disciplinaryStatus(r, today) === 'active')
}

function rowView(ctx: HrCtx, r: Tenant<DisciplinaryRecord>): DisciplinaryRow {
  const e = employeeById(r.companyId, r.employeeId)
  return {
    id: r.id,
    caseNo: r.caseNo,
    employeeId: r.employeeId,
    employeeName: e?.fullName ?? 'Unknown',
    employeeNo: e?.employeeNo ?? '',
    departmentName: departmentName(r.companyId, e?.departmentId ?? null),
    type: r.type,
    category: r.category,
    incidentDate: r.incidentDate,
    issueDate: r.issueDate,
    expiresOn: r.expiresOn,
    status: disciplinaryStatus(r, ctx.today),
    ackStatus: r.ackStatus,
    ackAt: r.ackAt,
    issuedByName: r.issuedByName,
    attachmentCount: r.attachments.length,
  }
}

function detailView(ctx: HrCtx, r: Tenant<DisciplinaryRecord>): DisciplinaryDetail {
  const own = ctx.self?.id === r.employeeId
  const payVisible = isFull(ctx) || own
  const status = disciplinaryStatus(r, ctx.today)
  return {
    ...rowView(ctx, r),
    description: r.description,
    descriptionAr: r.descriptionAr,
    expiryMonths: r.expiryMonths,
    suspensionDays: r.suspensionDays,
    suspensionStart: r.suspensionStart,
    deductionAmount: payVisible ? r.deductionAmount : null,
    deductionMonth: r.deductionMonth,
    currency: payVisible ? r.currency : null,
    adjustmentId: isFull(ctx) ? r.adjustmentId : null,
    employeeComment: r.employeeComment,
    attachments: r.attachments.map((a) => ({ ...a })),
    withdrawnAt: r.withdrawnAt,
    withdrawnByName: r.withdrawnByName,
    withdrawReason: r.withdrawReason,
    escalation: escalationHint(activeRecordsOf(r.companyId, r.employeeId, ctx.today)),
    canAcknowledge: own && r.ackStatus === 'pending' && status !== 'withdrawn',
    canWithdraw: isFull(ctx) && status !== 'withdrawn',
    canManage: isFull(ctx),
  }
}

function visibleRecord(ctx: HrCtx, id: string): Tenant<DisciplinaryRecord> {
  const r = hrDisciplinary.find((x) => x.companyId === ctx.co && x.id === id)
  if (!r || !canRead(readableIds(ctx), r.employeeId)) throw notFound()
  return r
}

/** Non-full, non-team callers need an employee record (self-service), like My HR. */
function requireReader(ctx: HrCtx): void {
  if (!isFull(ctx) && ctx.scope !== 'team') requireSelf(ctx)
}

/** GET /hr/discipline?employee_id&status&type&mine */
export async function listDiscipline(user: User, q: { employeeId?: string | null; status?: string | null; type?: string | null; mine?: boolean }): Promise<DisciplinaryRow[]> {
  const ctx = hrCtx(user)
  requireReader(ctx)
  const ids = readableIds(ctx)
  const rows = hrDisciplinary
    .filter((r) => r.companyId === ctx.co && canRead(ids, r.employeeId))
    .filter((r) => !q.mine || r.employeeId === ctx.self?.id)
    .filter((r) => !q.employeeId || r.employeeId === q.employeeId)
    .filter((r) => !q.type || r.type === q.type)
    .map((r) => rowView(ctx, r))
    .filter((r) => !q.status || r.status === q.status)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id.localeCompare(a.id))
  return delay(rows)
}

/** GET /hr/discipline/:id */
export async function getDiscipline(user: User, id: string): Promise<DisciplinaryDetail> {
  const ctx = hrCtx(user)
  return delay(detailView(ctx, visibleRecord(ctx, id)))
}

/* ======================= discipline: writes ======================= */

function attachmentsOf(co: string, raw: unknown, existing = 0): DisciplinaryAttachment[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw invalid('Attachments are a list of files.', 'attachments')
  if (raw.length + existing > 5) throw invalid('Attach at most 5 files to a record.', 'attachments')
  const files = raw.map((f) => fileOf(f)).filter((f): f is HrFile => !!f)
  const bytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  if (bytes > 0) assertCapacity(co, 'storageMb', bytes / (1024 * 1024))
  return files.map((f) => ({ id: `HDAF-${crypto.randomUUID().slice(0, 8)}`, ...f }))
}

const caseNumber = (co: string, issueDate: string) => {
  const y = Number(issueDate.slice(0, 4))
  return `${prefixOf(co)}-DA-${y}-${String(nextCaseSeq(co, y)).padStart(4, '0')}`
}

function currencyOf(co: string, employeeId: string): string {
  const k = hrContracts.find((c) => c.companyId === co && c.employeeId === employeeId && c.status === 'active')
  return k?.currency ?? companyById(co)?.regional.currency ?? 'AED'
}

/** POST /hr/discipline — HR full: issue a warning / disciplinary action. */
export async function createDiscipline(user: User, input: Partial<DisciplinaryInput> | null): Promise<DisciplinaryDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const i = input ?? {}
  const e = typeof i.employeeId === 'string' ? employeeById(ctx.co, i.employeeId) : undefined
  if (!e) throw notFound()
  if (e.status === 'terminated') throw invalid(`${e.fullName} has left: a disciplinary record can’t be issued.`, 'employee_left')
  if (ctx.self?.id === e.id) throw forbidden('You can’t issue a disciplinary record to yourself: another HR user does.')
  if (!DISCIPLINARY_TYPES.includes(i.type as DisciplinaryType)) throw invalid('Pick the type of action.', 'type')
  if (!DISCIPLINARY_CATEGORIES.includes(i.category as DisciplinaryCategory)) throw invalid('Pick the reason category.', 'category')
  const type = i.type as DisciplinaryType
  if (!isIso(i.incidentDate)) throw invalid('Enter the incident date.', 'incident_date')
  if (i.incidentDate > ctx.today) throw invalid('The incident date can’t be in the future.', 'incident_date')
  const description = str(i.description, 2000)
  if (description.length < 5) throw invalid('Describe what happened (at least a sentence).', 'description')
  const months = i.expiryMonths === undefined || i.expiryMonths === null ? defaultExpiryMonths(type) : Number(i.expiryMonths)
  if (!(EXPIRY_MONTH_OPTIONS as readonly number[]).includes(months)) throw invalid('Pick when it lapses: never, 3, 6, 12 or 24 months.', 'expiry_months')
  let suspensionDays: number | null = null
  let suspensionStart: string | null = null
  if (type === 'suspension_paid' || type === 'suspension_unpaid') {
    suspensionDays = Number(i.suspensionDays)
    if (!Number.isInteger(suspensionDays) || suspensionDays < 1 || suspensionDays > 30) throw invalid('A suspension is 1 to 30 days.', 'suspension_days')
    if (!isIso(i.suspensionStart)) throw invalid('Enter the first day of the suspension.', 'suspension_start')
    suspensionStart = i.suspensionStart
  }
  let deductionAmount: number | null = null
  let deductionMonth: string | null = null
  if (type === 'deduction') {
    deductionAmount = Math.round(Number(i.deductionAmount) * 100) / 100
    if (!Number.isFinite(deductionAmount) || deductionAmount <= 0 || deductionAmount > 100_000) throw invalid('Enter the amount to deduct.', 'deduction_amount')
    deductionMonth = i.deductionMonth ? String(i.deductionMonth) : ctx.today.slice(0, 7)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(deductionMonth)) throw invalid('Pick the payroll month (yyyy-MM).', 'deduction_month')
  }
  const attachments = attachmentsOf(ctx.co, i.attachments)
  const at = nowIso()
  const r: Tenant<DisciplinaryRecord> = {
    companyId: ctx.co,
    id: nextId('HDA-', hrDisciplinary),
    caseNo: caseNumber(ctx.co, ctx.today),
    employeeId: e.id,
    type,
    category: i.category as DisciplinaryCategory,
    incidentDate: i.incidentDate,
    description,
    descriptionAr: str(i.descriptionAr, 2000),
    issueDate: ctx.today,
    expiryMonths: months,
    expiresOn: expiryDate(ctx.today, months),
    suspensionDays,
    suspensionStart,
    deductionAmount,
    deductionMonth,
    currency: type === 'deduction' ? currencyOf(ctx.co, e.id) : null,
    adjustmentId: null,
    attachments,
    issuedBy: user.id,
    issuedByName: user.name,
    issuedByTitle: user.title || 'Human Resources',
    ackStatus: 'pending',
    ackAt: null,
    employeeComment: '',
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnByName: null,
    withdrawReason: '',
    notified: [],
    createdAt: at,
    updatedAt: at,
  }
  hrDisciplinary.push(r)
  if (type === 'deduction') r.adjustmentId = deductionAdjustment(ctx.co, r, user.id)
  const label = DISCIPLINARY_TYPE_LABEL[type]
  logHr(ctx.co, e.id, user, 'discipline', `${label} issued (${r.caseNo}, ${DISCIPLINARY_CATEGORY_LABEL[r.category].toLowerCase()})`, at)
  recordAudit(user, { action: 'create', entity: 'hr_disciplinary', entityId: r.id, summary: `Issued ${label.toLowerCase()} ${r.caseNo} to ${e.fullName}`, changes: [] })
  if (!r.notified.includes('issued')) {
    r.notified.push('issued')
    notify(ctx.co, [e.userId], { title: `${label} issued to you`, body: `${r.caseNo} · please read and acknowledge it in My HR`, link: `${MY_HR_LINK}?section=discipline` })
  }
  return delay(detailView(ctx, r))
}

/** The payroll deduction of a `deduction` record: one adjustment per record (idempotent through its sourceRef). */
export function deductionAdjustment(co: string, r: Pick<DisciplinaryRecord, 'id' | 'caseNo' | 'employeeId' | 'deductionAmount' | 'deductionMonth'>, by: string | null): string {
  const a = upsertSystemAdjustment(
    co,
    { employeeId: r.employeeId, kind: 'deduction', label: `Disciplinary deduction ${r.caseNo}`, amount: r.deductionAmount ?? 0, month: r.deductionMonth!, notes: `HR › Discipline ${r.caseNo}`, sourceRef: `discipline:${r.id}` },
    by,
  )
  return a.id
}

/** POST /hr/discipline/:id/attachments — HR full: add files (mock upload, counted in the plan's storage). */
export async function addDisciplineAttachments(user: User, id: string, input: { attachments?: unknown } | null): Promise<DisciplinaryDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const r = visibleRecord(ctx, id)
  const files = attachmentsOf(ctx.co, input?.attachments, r.attachments.length)
  if (!files.length) throw invalid('Attach a file.', 'attachments')
  r.attachments.push(...files)
  r.updatedAt = nowIso()
  logHr(ctx.co, r.employeeId, user, 'discipline', `${files.length} file${files.length > 1 ? 's' : ''} attached to ${r.caseNo}`)
  return delay(detailView(ctx, r))
}

/** POST /hr/discipline/:id/withdraw — HR full: rescind (reason, audited). An unpaid payroll deduction is removed. */
export async function withdrawDiscipline(user: User, id: string, input: { reason?: unknown } | null): Promise<DisciplinaryDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const r = visibleRecord(ctx, id)
  if (r.withdrawnAt) throw conflict('This record was already withdrawn.', 'already_withdrawn')
  const reason = str(input?.reason, 500)
  if (!reason) throw invalid('Give the reason for withdrawing it.', 'reason_required')
  const at = nowIso()
  let payroll = ''
  if (r.adjustmentId) {
    const a = hrPayAdjustments.find((x) => x.companyId === ctx.co && x.id === r.adjustmentId)
    if (a && !a.paidRunIds.length) {
      hrPayAdjustments.splice(hrPayAdjustments.indexOf(a), 1)
      r.adjustmentId = null
      payroll = ' The payroll deduction was removed.'
    } else if (a) payroll = ' The deduction was already paid in a payroll run: refund it with an allowance in the next run if needed.'
  }
  Object.assign(r, { withdrawnAt: at, withdrawnBy: user.id, withdrawnByName: user.name, withdrawReason: reason, updatedAt: at })
  logHr(ctx.co, r.employeeId, user, 'discipline', `${DISCIPLINARY_TYPE_LABEL[r.type]} ${r.caseNo} withdrawn: ${reason}.${payroll}`, at)
  recordAudit(user, { action: 'update', entity: 'hr_disciplinary', entityId: r.id, summary: `Withdrew ${r.caseNo}: ${reason}`, changes: [] })
  const e = employeeById(ctx.co, r.employeeId)
  if (!r.notified.includes('withdrawn')) {
    r.notified.push('withdrawn')
    notify(ctx.co, [e?.userId], { title: `${DISCIPLINARY_TYPE_LABEL[r.type]} ${r.caseNo} withdrawn`, body: reason, link: `${MY_HR_LINK}?section=discipline` })
  }
  return delay(detailView(ctx, r))
}

/** POST /hr/discipline/:id/acknowledge — the employee only: acknowledge (optional comment) or appeal (comment required). */
export async function acknowledgeDiscipline(user: User, id: string, input: AcknowledgeInput | null): Promise<DisciplinaryDetail> {
  const ctx = hrCtx(user)
  const r = visibleRecord(ctx, id)
  if (ctx.self?.id !== r.employeeId) throw forbidden('Only the employee acknowledges their own record.')
  if (r.withdrawnAt) throw conflict('This record was withdrawn.', 'withdrawn')
  if (r.ackStatus !== 'pending') throw conflict('You already answered this record.', 'already_acknowledged')
  const appeal = input?.appeal === true
  const comment = str(input?.comment, 1000)
  if (appeal && comment.length < 5) throw invalid('Explain why you disagree (your appeal goes to HR).', 'comment_required')
  const at = nowIso()
  Object.assign(r, { ackStatus: appeal ? 'appealed' : 'acknowledged', ackAt: at, employeeComment: comment, updatedAt: at })
  logHr(ctx.co, r.employeeId, user, 'discipline', `${r.caseNo} ${appeal ? 'appealed' : 'acknowledged'} by the employee${comment ? `: “${comment}”` : ''}`, at)
  const key = appeal ? 'appealed' : 'acknowledged'
  if (!r.notified.includes(key)) {
    r.notified.push(key)
    notify(ctx.co, [...hrFullUsers(ctx.co).map((u) => u.id), r.issuedBy].filter((x) => x !== user.id), {
      title: `${r.caseNo} ${appeal ? 'appealed' : 'acknowledged'} by ${user.name}`,
      body: comment || DISCIPLINARY_TYPE_LABEL[r.type],
      link: disciplineLink(r.id),
    })
  }
  return delay(detailView(ctx, r))
}

/* ======================= warning letter ======================= */

const PLACEHOLDER_LABEL = new Map(PLACEHOLDERS.map((p) => [p.key, p.label]))

function arDays(n: number): string {
  if (n === 1) return 'يوم واحد'
  if (n === 2) return 'يومين'
  if (n <= 10) return `${n} أيام`
  return `${n} يوماً`
}

function actionText(r: DisciplinaryRecord, lang: 'en' | 'ar', digits: DigitStyle): string {
  const d = (iso: string | null) => (lang === 'ar' ? letterDateAr(iso, digits) : letterDate(iso))
  const n = r.suspensionDays ?? 0
  if (lang === 'en') {
    switch (r.type) {
      case 'verbal_warning':
        return 'This letter confirms the verbal warning in writing for your file.'
      case 'written_warning':
        return 'You are expected to correct this immediately.'
      case 'final_warning':
        return 'This is a final warning: any further breach may lead to the termination of your employment.'
      case 'suspension_paid':
        return `You are suspended from work with pay for ${n} day${n === 1 ? '' : 's'} from ${d(r.suspensionStart)}.`
      case 'suspension_unpaid':
        return `You are suspended from work without pay for ${n} day${n === 1 ? '' : 's'} from ${d(r.suspensionStart)}.`
      case 'deduction':
        return `An amount of ${r.currency} ${letterMoney(r.deductionAmount)} will be deducted from your salary for ${monthLabel(r.deductionMonth ?? '')}.`
    }
  }
  const nn = digits === 'arabic' ? toArabicDigits(arDays(n)) : arDays(n)
  const month = r.deductionMonth ? `${AR_MONTHS[Number(r.deductionMonth.slice(5, 7)) - 1]} ${r.deductionMonth.slice(0, 4)}` : ''
  switch (r.type) {
    case 'verbal_warning':
      return 'ويُعدّ هذا الخطاب توثيقاً كتابياً للإنذار الشفهي.'
    case 'written_warning':
      return 'ويُطلب تصحيح ذلك فوراً.'
    case 'final_warning':
      return 'ويُعدّ هذا إنذاراً نهائياً، وقد يؤدي أي إخلال آخر إلى إنهاء الخدمة.'
    case 'suspension_paid':
      return `وتقرر الإيقاف عن العمل مع الأجر لمدة ${nn} اعتباراً من ${d(r.suspensionStart)}.`
    case 'suspension_unpaid':
      return `وتقرر الإيقاف عن العمل بدون أجر لمدة ${nn} اعتباراً من ${d(r.suspensionStart)}.`
    case 'deduction':
      return `وتقرر خصم مبلغ ${letterMoneyAr(r.deductionAmount, digits)} ${AR_CURRENCY[r.currency ?? ''] ?? r.currency ?? ''} من الراتب عن شهر ${digits === 'arabic' ? toArabicDigits(month) : month}.`
  }
}

/** GET /hr/discipline/:id/letter?language=en|ar|bilingual&digits=western|arabic — HR full or the employee (404 otherwise). */
export async function getWarningLetter(user: User, id: string, q: { language?: string | null; digits?: string | null }): Promise<WarningLetter> {
  const ctx = hrCtx(user)
  const r = hrDisciplinary.find((x) => x.companyId === ctx.co && x.id === id)
  if (!r || !(isFull(ctx) || ctx.self?.id === r.employeeId)) throw notFound()
  const language = (q.language || 'en') as LetterLanguage
  if (!LETTER_LANGUAGES.includes(language)) throw invalid('Pick English, Arabic or bilingual.', 'language')
  const digits: DigitStyle = q.digits === 'arabic' ? 'arabic' : 'western'
  const e = employeeById(ctx.co, r.employeeId)
  if (!e) throw notFound()
  const issue = { referenceNo: r.caseNo, issueDate: r.issueDate, signatoryName: r.issuedByName, signatoryTitle: r.issuedByTitle }
  const withEn = language !== 'ar'
  const withAr = language !== 'en'
  const en = {
    ...letterValues(ctx.co, e, { includesSalary: false }, { addressee: '', purpose: '', nocPurpose: null }, issue),
    'warning.caseNo': r.caseNo,
    'warning.type': DISCIPLINARY_TYPE_LABEL[r.type].toLowerCase(),
    'warning.category': DISCIPLINARY_CATEGORY_LABEL[r.category].toLowerCase(),
    'warning.incidentDate': letterDate(r.incidentDate),
    'warning.description': r.description,
    'warning.expiry': r.expiresOn ? `until ${letterDate(r.expiresOn)}` : 'with no expiry date',
    'warning.action': actionText(r, 'en', digits),
  }
  const ar = {
    ...letterValuesAr(ctx.co, e, { includesSalary: false }, { addressee: '', purpose: '', nocPurpose: null, addresseeAr: '', purposeAr: '', digits }, issue),
    'warning.caseNo': r.caseNo,
    'warning.type': DISCIPLINARY_TYPE_LABEL_AR[r.type],
    'warning.category': DISCIPLINARY_CATEGORY_LABEL_AR[r.category],
    'warning.incidentDate': letterDateAr(r.incidentDate, digits),
    'warning.description': r.descriptionAr || r.description,
    'warning.expiry': r.expiresOn ? `حتى ${letterDateAr(r.expiresOn, digits)}` : 'دون تاريخ انتهاء',
    'warning.action': actionText(r, 'ar', digits),
  }
  const renderedEn = withEn ? renderTemplate(WARNING_LETTER_EN, en, { keys: WARNING_KEYS }) : null
  const renderedAr = withAr ? renderTemplate(WARNING_LETTER_AR, ar, { rtl: true, keys: WARNING_KEYS }) : null
  const missEn = renderedEn?.missing ?? []
  const missAr = renderedAr?.missing ?? []
  if (missEn.length || missAr.length) {
    const labels = [...missEn.map((k) => PLACEHOLDER_LABEL.get(k) ?? k), ...missAr.map((k) => AR_REQUIRED_SOURCE[k] ?? `${PLACEHOLDER_LABEL.get(k) ?? k} (Arabic)`)]
    throw invalid(`Fill in first: ${[...new Set(labels)].join(', ')}.`, 'missing_values', { missing: missEn, missingAr: missAr })
  }
  return delay({
    language,
    digits,
    caseNo: r.caseNo,
    issueDate: r.issueDate,
    issueDateAr: withAr ? letterDateAr(r.issueDate, digits) : null,
    title: `${DISCIPLINARY_TYPE_LABEL[r.type]}`,
    titleAr: withAr ? DISCIPLINARY_TYPE_LABEL_AR[r.type] : null,
    body: renderedEn?.text ?? '',
    bodyAr: renderedAr?.text ?? null,
    employeeName: e.fullName,
    signatoryName: r.issuedByName,
    signatoryTitle: r.issuedByTitle,
    letterhead: letterheadOf(ctx.co),
  })
}

/* ======================= policies: audience & stats ======================= */

const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

function statsOf(co: string, p: Tenant<PolicyRecord>, within: Set<string> | 'all'): PolicyStats {
  if (p.status !== 'published' || !p.version) return { audience: 0, acknowledged: 0, pending: 0, pct: 0 }
  const aud = audienceOf(co, p).filter((e) => within === 'all' || within.has(e.id))
  const acknowledged = aud.filter((e) => ackOf(co, p.id, e.id, p.version)).length
  return { audience: aud.length, acknowledged, pending: aud.length - acknowledged, pct: pct(acknowledged, aud.length) }
}

function audienceLabel(co: string, a: PolicyAudience): string {
  if (a.kind === 'all') return 'All employees'
  if (a.kind === 'roles') return a.roles.join(', ') || 'No roles'
  return a.departmentIds.map((id) => departmentName(co, id) ?? id).join(', ') || 'No departments'
}

const currentVersion = (p: PolicyRecord) => p.versions.find((v) => v.version === p.version) ?? null

function policyRow(ctx: HrCtx, p: Tenant<PolicyRecord>): PolicyRow {
  const cur = currentVersion(p)
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    status: p.status,
    version: p.version,
    effectiveDate: cur?.effectiveDate ?? p.draft?.effectiveDate ?? null,
    audience: structuredClone(p.audience),
    audienceLabel: audienceLabel(ctx.co, p.audience),
    hasDraft: !!p.draft,
    publishedAt: cur?.publishedAt ?? null,
    stats: statsOf(ctx.co, p, isFull(ctx) ? 'all' : teamEmployeeIds(ctx)),
    updatedAt: p.updatedAt,
  }
}

function policyDetail(ctx: HrCtx, p: Tenant<PolicyRecord>): PolicyDetail {
  const cur = currentVersion(p)
  return {
    ...policyRow(ctx, p),
    current: cur ? { version: cur.version, body: cur.body, file: cur.file, effectiveDate: cur.effectiveDate, changeNote: cur.changeNote, publishedAt: cur.publishedAt, publishedByName: cur.publishedByName } : null,
    draft: isFull(ctx) && p.draft ? structuredClone(p.draft) : null,
    versions: p.versions.map(({ version, effectiveDate, changeNote, publishedAt, publishedByName }) => ({ version, effectiveDate, changeNote, publishedAt, publishedByName })),
    canManage: isFull(ctx),
  }
}

/** HR full and department heads see the policy screens; team viewers only published policies (and their team's numbers). */
function requirePolicyViewer(ctx: HrCtx): void {
  if (!isFull(ctx) && ctx.scope !== 'team') throw forbidden('Policies are managed by HR. Your policies are in My HR.')
}

function viewablePolicy(ctx: HrCtx, id: string): Tenant<PolicyRecord> {
  const p = hrPolicies.find((x) => x.companyId === ctx.co && x.id === id)
  if (!p || (!isFull(ctx) && p.status !== 'published')) throw notFound()
  return p
}

/* ======================= policies: endpoints ======================= */

/** GET /hr/policies — HR full: every policy; department head: the published ones, numbers for their team. */
export async function listPolicies(user: User): Promise<PolicyRow[]> {
  const ctx = hrCtx(user)
  requirePolicyViewer(ctx)
  runPolicyReminders(ctx.co)
  return delay(
    hrPolicies
      .filter((p) => p.companyId === ctx.co && (isFull(ctx) || p.status === 'published'))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((p) => policyRow(ctx, p)),
  )
}

/** GET /hr/policies/:id */
export async function getPolicy(user: User, id: string): Promise<PolicyDetail> {
  const ctx = hrCtx(user)
  requirePolicyViewer(ctx)
  return delay(policyDetail(ctx, viewablePolicy(ctx, id)))
}

function cleanAudience(co: string, raw: Partial<PolicyAudience> | undefined, base: PolicyAudience): PolicyAudience {
  if (raw === undefined) return base
  const kind = raw?.kind ?? base.kind
  if (kind !== 'all' && kind !== 'departments' && kind !== 'roles') throw invalid('Pick the audience: all employees, departments or roles.', 'audience')
  if (kind === 'all') return { kind, departmentIds: [], roles: [] }
  if (kind === 'departments') {
    const ids = Array.isArray(raw.departmentIds) ? [...new Set(raw.departmentIds.map(String))] : []
    // A foreign / unknown department answers like a missing one (422, the same message).
    if (!ids.length || ids.some((id) => !departments.some((d) => d.companyId === co && d.id === id))) throw invalid('Pick at least one department of the company.', 'audience')
    return { kind, departmentIds: ids, roles: [] }
  }
  const roles = Array.isArray(raw.roles) ? [...new Set(raw.roles.map(String))] : []
  if (!roles.length || roles.some((r) => !ROLES.includes(r as Role))) throw invalid('Pick at least one role.', 'audience')
  return { kind, departmentIds: [], roles: roles as Role[] }
}

function policyFile(co: string, raw: unknown, prev: HrFile | null): HrFile | null {
  if (raw === undefined) return prev
  const f = fileOf(raw)
  if (f && !/pdf/i.test(f.mimeType) && !/\.pdf$/i.test(f.name)) throw invalid('Upload the policy as a PDF.', 'file')
  if (f && (!prev || prev.name !== f.name || prev.sizeBytes !== f.sizeBytes)) assertCapacity(co, 'storageMb', f.sizeBytes / (1024 * 1024))
  return f
}

/** POST /hr/policies — HR full: a new policy (draft; publish makes version 1). */
export async function createPolicy(user: User, input: PolicyInput | null): Promise<PolicyDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const i = input ?? {}
  const title = str(i.title, 200).replace(/\s+/g, ' ')
  if (title.length < 3 || title.length > 120) throw invalid('Give the policy a title (3–120 characters).', 'title')
  if (!POLICY_CATEGORIES.includes(i.category as PolicyCategory)) throw invalid('Pick a category.', 'category')
  const effectiveDate = i.effectiveDate === undefined ? ctx.today : i.effectiveDate
  if (!isIso(effectiveDate)) throw invalid('Enter the effective date.', 'effective_date')
  const at = nowIso()
  const p: Tenant<PolicyRecord> = {
    companyId: ctx.co,
    id: nextId('HPOL-', hrPolicies),
    title,
    category: i.category as PolicyCategory,
    status: 'draft',
    version: 0,
    versions: [],
    draft: { body: String(i.body ?? '').replace(/\r\n/g, '\n').slice(0, 50_000), file: policyFile(ctx.co, i.file ?? null, null), effectiveDate, changeNote: str(i.changeNote, 300) },
    audience: cleanAudience(ctx.co, i.audience ?? { kind: 'all' }, { kind: 'all', departmentIds: [], roles: [] }),
    reminderMarks: [],
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  }
  hrPolicies.push(p)
  recordAudit(user, { action: 'create', entity: 'hr_policy', entityId: p.id, summary: `Created the policy “${p.title}”`, changes: [] })
  return delay(policyDetail(ctx, p))
}

/** PATCH /hr/policies/:id — HR full: title, category, audience apply now; text / PDF / effective date go into the next version's draft. */
export async function updatePolicy(user: User, id: string, input: PolicyInput | null): Promise<PolicyDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const p = viewablePolicy(ctx, id)
  if (p.status === 'archived') throw conflict('This policy is archived.', 'archived')
  const i = input ?? {}
  let changed = false
  if (i.title !== undefined) {
    const title = str(i.title, 200).replace(/\s+/g, ' ')
    if (title.length < 3 || title.length > 120) throw invalid('Give the policy a title (3–120 characters).', 'title')
    p.title = title
    changed = true
  }
  if (i.category !== undefined) {
    if (!POLICY_CATEGORIES.includes(i.category as PolicyCategory)) throw invalid('Pick a category.', 'category')
    p.category = i.category as PolicyCategory
    changed = true
  }
  if (i.audience !== undefined) {
    p.audience = cleanAudience(ctx.co, i.audience, p.audience)
    changed = true
  }
  if (i.body !== undefined || i.file !== undefined || i.effectiveDate !== undefined || i.changeNote !== undefined) {
    const cur = currentVersion(p)
    const draft = p.draft ?? { body: cur?.body ?? '', file: cur?.file ?? null, effectiveDate: ctx.today, changeNote: '' }
    if (i.body !== undefined) draft.body = String(i.body ?? '').replace(/\r\n/g, '\n').slice(0, 50_000)
    if (i.file !== undefined) draft.file = policyFile(ctx.co, i.file, draft.file)
    if (i.effectiveDate !== undefined) {
      if (!isIso(i.effectiveDate)) throw invalid('Enter the effective date.', 'effective_date')
      draft.effectiveDate = i.effectiveDate
    }
    if (i.changeNote !== undefined) draft.changeNote = str(i.changeNote, 300)
    p.draft = draft
    changed = true
  }
  if (!changed) throw invalid('Nothing to change.', 'no_changes')
  p.updatedAt = nowIso()
  recordAudit(user, { action: 'update', entity: 'hr_policy', entityId: p.id, summary: `Updated the policy “${p.title}”`, changes: [] })
  return delay(policyDetail(ctx, p))
}

/** POST /hr/policies/:id/publish — HR full: the draft becomes the next version; everyone in the audience must (re-)acknowledge. */
export async function publishPolicy(user: User, id: string, input: { changeNote?: unknown } | null): Promise<PolicyDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const p = viewablePolicy(ctx, id)
  if (p.status === 'archived') throw conflict('This policy is archived.', 'archived')
  if (!p.draft) throw conflict('There are no changes to publish: edit the text or upload a new PDF first.', 'nothing_to_publish')
  if (!p.draft.body.trim() && !p.draft.file) throw invalid('Write the policy text or upload the PDF before publishing.', 'body')
  const at = nowIso()
  const version = p.version + 1
  const note = str(input?.changeNote, 300) || p.draft.changeNote || (version === 1 ? 'First version.' : '')
  p.versions.push({ version, body: p.draft.body, file: p.draft.file, effectiveDate: p.draft.effectiveDate, changeNote: note, publishedAt: at, publishedBy: user.id, publishedByName: user.name })
  Object.assign(p, { version, status: 'published', draft: null, updatedAt: at })
  recordAudit(user, { action: 'update', entity: 'hr_policy', entityId: p.id, summary: `Published “${p.title}” version ${version}`, changes: [] })
  // The "at publish" reminder goes out now (once per employee and version).
  runPolicyReminders(ctx.co)
  return delay(policyDetail(ctx, p))
}

/** POST /hr/policies/:id/archive — HR full: no longer offered or reminded (acknowledgements stay as history). */
export async function archivePolicy(user: User, id: string): Promise<PolicyDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const p = viewablePolicy(ctx, id)
  if (p.status === 'archived') throw conflict('This policy is already archived.', 'archived')
  Object.assign(p, { status: 'archived', updatedAt: nowIso() })
  recordAudit(user, { action: 'update', entity: 'hr_policy', entityId: p.id, summary: `Archived the policy “${p.title}”`, changes: [] })
  return delay(policyDetail(ctx, p))
}

function statusReport(ctx: HrCtx, p: Tenant<PolicyRecord>): PolicyStatusReport {
  const within = isFull(ctx) ? 'all' : teamEmployeeIds(ctx)
  const aud = p.status === 'published' ? audienceOf(ctx.co, p).filter((e) => within === 'all' || within.has(e.id)) : []
  const employees = aud
    .map((e) => {
      const a = ackOf(ctx.co, p.id, e.id, p.version)
      const latest = latestAckOf(ctx.co, p.id, e.id)
      return {
        employeeId: e.id,
        employeeName: e.fullName,
        employeeNo: e.employeeNo,
        departmentName: departmentName(ctx.co, e.departmentId),
        acknowledged: !!a,
        acknowledgedAt: a?.at ?? null,
        acknowledgedVersion: latest?.version ?? null,
      }
    })
    .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || (a.departmentName ?? '').localeCompare(b.departmentName ?? '') || a.employeeName.localeCompare(b.employeeName))
  const byDept = new Map<string, DepartmentAckRow>()
  for (const e of aud) {
    const key = e.departmentId ?? ''
    const row = byDept.get(key) ?? { departmentId: e.departmentId, departmentName: departmentName(ctx.co, e.departmentId) ?? 'No department', audience: 0, acknowledged: 0, pct: 0 }
    row.audience++
    if (ackOf(ctx.co, p.id, e.id, p.version)) row.acknowledged++
    byDept.set(key, row)
  }
  const byDepartment = [...byDept.values()].map((r) => ({ ...r, pct: pct(r.acknowledged, r.audience) })).sort((a, b) => a.departmentName.localeCompare(b.departmentName))
  return { policyId: p.id, version: p.version, stats: statsOf(ctx.co, p, within), byDepartment, employees }
}

/** GET /hr/policies/:id/status — HR full (company) / department head (their team): who acknowledged the current version. */
export async function getPolicyStatus(user: User, id: string): Promise<PolicyStatusReport> {
  const ctx = hrCtx(user)
  requirePolicyViewer(ctx)
  return delay(statusReport(ctx, viewablePolicy(ctx, id)))
}

/** GET /hr/policies/:id/export — HR full: one row per audience employee (CSV on the client). */
export async function exportPolicyStatus(user: User, id: string): Promise<PolicyExportRow[]> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const p = viewablePolicy(ctx, id)
  return delay(
    statusReport(ctx, p).employees.map((e) => ({
      employeeNo: e.employeeNo,
      employeeName: e.employeeName,
      department: e.departmentName ?? '',
      policy: p.title,
      version: p.version,
      acknowledged: e.acknowledged ? 'yes' : 'no',
      acknowledgedAt: e.acknowledgedAt ?? '',
    })),
  )
}

/* ======================= policies: the employee ======================= */

function myPolicyView(co: string, p: Tenant<PolicyRecord>, employeeId: string): MyPolicy {
  const cur = currentVersion(p)!
  const a = ackOf(co, p.id, employeeId, p.version)
  const latest = latestAckOf(co, p.id, employeeId)
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    version: p.version,
    effectiveDate: cur.effectiveDate,
    publishedAt: cur.publishedAt,
    body: cur.body,
    file: cur.file,
    changeNote: cur.changeNote,
    acknowledged: !!a,
    acknowledgedAt: a?.at ?? null,
    reacknowledge: !a && !!latest && latest.version < p.version,
  }
}

/** GET /hr/policies/my — every user with an employee record: the policies addressed to them, pending first. */
export async function myPolicies(user: User): Promise<MyPolicy[]> {
  const ctx = hrCtx(user)
  const me = requireSelf(ctx)
  runPolicyReminders(ctx.co)
  return delay(
    policiesFor(ctx.co, me)
      .map((p) => myPolicyView(ctx.co, p, me.id))
      .sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || a.title.localeCompare(b.title)),
  )
}

/** POST /hr/policies/:id/acknowledge { version } — the employee, for the CURRENT version (an older one → 409 version_changed). */
export async function acknowledgePolicy(user: User, id: string, input: { version?: unknown } | null): Promise<MyPolicy> {
  const ctx = hrCtx(user)
  const me = requireSelf(ctx)
  const p = hrPolicies.find((x) => x.companyId === ctx.co && x.id === id)
  if (!p || !policiesFor(ctx.co, me).includes(p)) throw notFound()
  const version = Number(input?.version ?? p.version)
  if (version !== p.version) throw conflict(`“${p.title}” changed: read version ${p.version} and acknowledge it.`, 'version_changed')
  if (!ackOf(ctx.co, p.id, me.id, p.version)) {
    const at = nowIso()
    hrPolicyAcks.push({ companyId: ctx.co, id: nextId('HPA-', hrPolicyAcks), policyId: p.id, version: p.version, employeeId: me.id, userId: user.id, at })
    logHr(ctx.co, me.id, user, 'policy', `Acknowledged “${p.title}” version ${p.version}`, at)
  }
  return delay(myPolicyView(ctx.co, p, me.id))
}

/* ======================= reminders (lifecycle tick) ======================= */

/**
 * Policy reminders: for every published policy and each audience employee who hasn't acknowledged the current version,
 * a stored notification at publish, +3 and +7 company days — each once (marks `<employeeId>:v<n>:d<days>`; `*:` marks
 * apply to everyone). Lazy and idempotent: runs on the company's lifecycle tick and before the policy reads.
 */
/**
 * What the reminders depend on, per company: the hour, the published versions, the acknowledgements, the
 * employees and the users (roles / active). Same fingerprint as the last run → nothing can be due (the tick runs on
 * every authenticated request, so it must be cheap). Not persisted: a reload simply recomputes once.
 */
const lastTick = new Map<string, string>()
function tickFingerprint(co: string, hour: string): string {
  let pol = ''
  for (const p of hrPolicies) if (p.companyId === co) pol += `${p.id}:${p.status}:${p.version}:${JSON.stringify(p.audience)};`
  let emp = ''
  for (const e of hrEmployees) if (e.companyId === co) emp += `${e.id}:${e.status}:${e.departmentId}:${e.userId};`
  let usr = ''
  for (const u of users) if (u.companyId === co) usr += `${u.id}:${u.active}:${activeMembershipOf(u.id)?.role ?? u.role};`
  const acks = hrPolicyAcks.reduce((n, a) => n + (a.companyId === co ? 1 : 0), 0)
  return `${hour}|${pol}|${emp}|${usr}|${acks}`
}

export function runPolicyReminders(co: string, at: Date = clockNow()): number {
  if (!companyModules(co).includes('hr')) return 0
  // The hour (not the company day) keeps the check free of timezone math; a new hour recomputes once.
  const fp = tickFingerprint(co, String(Math.floor(at.getTime() / 3_600_000)))
  if (lastTick.get(co) === fp) return 0
  lastTick.set(co, fp)
  const today = companyDayOf(co, at).today
  let sent = 0
  for (const p of hrPolicies) {
    if (p.companyId !== co || p.status !== 'published' || !p.version) continue
    const cur = currentVersion(p)
    if (!cur) continue
    const publishedDay = companyDayOf(co, new Date(cur.publishedAt)).today
    for (const e of audienceOf(co, p)) {
      if (ackOf(co, p.id, e.id, p.version)) continue
      const marks = p.reminderMarks.filter((m) => m.startsWith(`${e.id}:`) || m.startsWith('*:')).map((m) => m.slice(m.indexOf(':') + 1))
      const due = dueReminder(publishedDay, today, p.version, marks)
      if (!due.send) continue
      for (const k of due.mark) p.reminderMarks.push(`${e.id}:${k}`)
      const first = due.send.endsWith(':d0')
      notify(co, [e.userId], {
        title: first ? `New policy to acknowledge: ${p.title}` : `Reminder: please acknowledge ${p.title}`,
        body: `Version ${p.version} · ${POLICY_CATEGORY_LABEL[p.category]}`,
        link: MY_POLICIES_LINK,
      })
      sent++
    }
  }
  return sent
}

onLifecycleTick('hr-policy-reminders', (companyId, until) => runPolicyReminders(companyId, new Date(until)))
