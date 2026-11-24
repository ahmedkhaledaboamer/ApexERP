import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { EMPLOYMENT_TYPE_LABEL } from '@/modules/hr/types'
import type {
  IssuedLetter,
  LetterDecisionInput,
  LetterRequestDetail,
  LetterRequestInput,
  LetterRequestRow,
  LetterType,
  LetterTypeInput,
  LetterVerification,
  Letterhead,
  NocPurpose,
  BilingualLayout,
  DigitStyle,
  LetterLanguage,
  PublicLetterVerification,
} from '@/modules/hr/selfservice/types'
import { BILINGUAL_LAYOUTS, LETTER_LANGUAGES, NOC_PURPOSES, NOC_PURPOSE_LABEL } from '@/modules/hr/selfservice/types'
import {
  AR_CURRENCY,
  AR_EMPLOYMENT_TYPE,
  AR_NOC_PURPOSE,
  AR_REQUIRED_SOURCE,
  PLACEHOLDERS,
  countryNameAr,
  defaultLetterTypes,
  letterDate,
  letterDateAr,
  letterMoney,
  letterMoneyAr,
  letterReference,
  makeVerificationCode,
  maskedName,
  normalizeCode,
  renderTemplate,
  validateTemplate,
  type LetterValues,
} from '@/modules/hr/selfservice/letters'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { resolveWorkspace } from '@/shared/mocks/data/platform'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { companyModules } from '@/shared/mocks/services/billing'
import { letterVerifyHits } from '@/shared/mocks/data/hrSelfService'
import { hitRateLimit } from './rateLimit'
import { issuerFor } from '@/modules/quotations/lib/company'
import { countryLabel } from '@/shared/lib/country'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { employeeById, hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { hrLetterRequests, hrLetterTypes, nextLetterSeq, type LetterRequestRecord, type LetterTypeRecord } from '@/shared/mocks/data/hrSelfService'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { nowIso } from '@/shared/mocks/clock'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { companyEmployee, hrFullUsers, logHr } from './hrAccess'
import { profileOf } from './hrEmployees'
import { conflict, departmentName, forbidden, hrCtx, invalid, isFull, notFound, requireFull, requireSelf, str, type HrCtx } from './hrTimeAccess'

/**
 * HR letters (docs/API.md › HR › HR letters): letter types with editable templates (HR full), requests by the
 * employee (self-service, any role with an active employee record) or by HR on their behalf, approval / rejection by
 * HR full, issue with a per-company yearly reference number and a verification code, and the verify lookup.
 *
 * Visibility: HR full sees every request of the company; anyone else only their own (a Department Head never sees a
 * report's letter: 404). Salary amounts are only rendered into salary letter types (validated on the template too),
 * so pay is only ever visible to HR full and the employee themself. Nobody decides their own request (403 own_request).
 *
 * Notifications (stored, type `hr-requests`, bell group HR), once per request and event (`notified` keys):
 * submitted → every active HR-full user except the requester; issued / rejected → the employee.
 */

export const HR_REQUESTS_ALERT = 'hr-requests'
export const REQUESTS_LINK = '/hr/requests'
export const MY_HR_LINK = '/hr/me'

const LEAVING = new Set(['notice', 'terminated'])

/* ---------------- shared helpers (also used by services/hrSelfService.ts) ---------------- */

/** Stores a notification for each recipient once per (record, key). */
export function notifyOnce(rec: { companyId: string; notified: string[] }, key: string, userIds: readonly string[], n: { title: string; body: string; link: string }): void {
  if (rec.notified.includes(key)) return
  rec.notified.push(key)
  for (const userId of new Set(userIds)) pushNotification({ companyId: rec.companyId, userId, type: HR_REQUESTS_ALERT, ...n, at: nowIso() })
}

/** Active HR-full users of the company except the given user ids (the requester, the employee). */
export function hrRecipients(co: string, ...except: (string | null | undefined)[]): string[] {
  return hrFullUsers(co)
    .map((u) => u.id)
    .filter((id) => !except.includes(id))
}

export const ownRequest = () => new CodedApiError('You can’t decide your own request: another HR user does.', 403, 'own_request')

/** The caller's own employee id (if any). */
const selfId = (ctx: HrCtx) => ctx.self?.id ?? null

/* ---------------- letter types ---------------- */

function activeContract(co: string, employeeId: string) {
  return hrContracts.find((c) => c.companyId === co && c.employeeId === employeeId && c.status === 'active')
}

/** Why the employee can't request this type now (null = they can). */
function unavailableReason(co: string, e: Employee, t: LetterTypeRecord): string | null {
  if (!t.active) return 'This letter isn’t offered at the moment.'
  if (t.code === 'experience_letter' && !LEAVING.has(e.status)) return 'Experience letters are for employees in their notice period or who have left. Ask HR if you need one.'
  if (t.includesSalary && !activeContract(co, e.id)) return 'There is no active contract to take the salary from. Ask HR.'
  return null
}

function defaultOf(co: string, t: LetterTypeRecord) {
  return defaultLetterTypes(companyById(co)?.regional.country ?? 'AE').find((d) => d.code === t.code)
}

function typeView(co: string, t: LetterTypeRecord, opts: { withBody: boolean; employee?: Employee }): LetterType {
  const reason = opts.employee ? unavailableReason(co, opts.employee, t) : t.active ? null : 'Inactive'
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    body: opts.withBody ? t.body : '',
    includesSalary: t.includesSalary,
    nameAr: t.nameAr,
    bodyAr: opts.withBody ? t.bodyAr : '',
    hasArabic: !!t.bodyAr.trim(),
    active: t.active,
    isDefault: defaultOf(co, t)?.body === t.body && defaultOf(co, t)?.bodyAr === t.bodyAr,
    updatedAt: t.updatedAt,
    updatedByName: t.updatedByName,
    available: reason === null,
    unavailableReason: reason,
  }
}

const ORDER = ['salary_certificate', 'salary_transfer', 'employment_certificate', 'experience_letter', 'noc']
const typesOf = (co: string) => hrLetterTypes.filter((t) => t.companyId === co).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code))

/** Letter types an employee may pick (portal), with availability for them; no template text. */
export function letterTypesForEmployee(co: string, e: Employee): LetterType[] {
  return typesOf(co)
    .filter((t) => t.active)
    .map((t) => typeView(co, t, { withBody: false, employee: e }))
}

/** GET /hr/letters/types — HR full: every type with its template; anyone else (self): the active ones for them. */
export async function listLetterTypes(user: User): Promise<LetterType[]> {
  const ctx = hrCtx(user)
  if (isFull(ctx)) return delay(typesOf(ctx.co).map((t) => typeView(ctx.co, t, { withBody: true })))
  return delay(letterTypesForEmployee(ctx.co, requireSelf(ctx)))
}

function ownType(ctx: HrCtx, id: string): Tenant<LetterTypeRecord> {
  const t = hrLetterTypes.find((x) => x.companyId === ctx.co && x.id === id)
  if (!t) throw notFound()
  return t
}

function templateProblems(body: string, includesSalary: boolean, opts: { optional?: boolean; arabic?: boolean } = {}): void {
  const problems = validateTemplate(body, includesSalary, opts).map((x) => (opts.arabic ? `Arabic template: ${x}` : x))
  if (problems.length) throw invalid(problems.join(' '), 'invalid_template', { problems })
}

/** PATCH /hr/letters/types/:id — HR full: name, description, template text, active. */
export async function updateLetterType(user: User, id: string, input: LetterTypeInput | null): Promise<LetterType> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const t = ownType(ctx, id)
  const i = input ?? {}
  const patch: Partial<LetterTypeRecord> = {}
  if (i.name !== undefined) {
    const name = str(i.name, 200).replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 80) throw invalid('Enter a name (2–80 characters).', 'name')
    patch.name = name
  }
  if (i.description !== undefined) patch.description = str(i.description, 300)
  if (i.body !== undefined) {
    const body = String(i.body ?? '').replace(/\r\n/g, '\n')
    templateProblems(body, t.includesSalary)
    patch.body = body
  }
  if (i.nameAr !== undefined) {
    const nameAr = str(i.nameAr, 200).replace(/\s+/g, ' ')
    if (nameAr.length > 80) throw invalid('The Arabic name is too long (80 characters max).', 'name_ar')
    patch.nameAr = nameAr
  }
  if (i.bodyAr !== undefined) {
    // Optional: an empty Arabic template means the letter is offered in English only.
    const bodyAr = String(i.bodyAr ?? '').replace(/\r\n/g, '\n')
    templateProblems(bodyAr, t.includesSalary, { optional: true, arabic: true })
    patch.bodyAr = bodyAr
  }
  if (i.active !== undefined) {
    if (typeof i.active !== 'boolean') throw invalid('Active must be true or false.', 'active')
    patch.active = i.active
  }
  if (!Object.keys(patch).length) throw invalid('Nothing to change.', 'no_changes')
  Object.assign(t, patch, { updatedAt: nowIso(), updatedBy: user.id, updatedByName: user.name })
  recordAudit(user, { action: 'update', entity: 'hr_letter_type', entityId: t.id, summary: `Updated the letter template “${t.name}”`, changes: [] })
  return delay(typeView(ctx.co, t, { withBody: true }))
}

/** POST /hr/letters/types/:id/reset — HR full: back to the seeded default text and name. */
export async function resetLetterType(user: User, id: string): Promise<LetterType> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const t = ownType(ctx, id)
  const d = defaultOf(ctx.co, t)!
  Object.assign(t, { name: d.name, description: d.description, body: d.body, nameAr: d.nameAr, bodyAr: d.bodyAr, updatedAt: nowIso(), updatedBy: user.id, updatedByName: user.name })
  recordAudit(user, { action: 'update', entity: 'hr_letter_type', entityId: t.id, summary: `Reset the letter template “${t.name}” to the default`, changes: [] })
  return delay(typeView(ctx.co, t, { withBody: true }))
}

/* ---------------- requests: views ---------------- */

function canSee(ctx: HrCtx, r: LetterRequestRecord): boolean {
  return isFull(ctx) || (!!ctx.self && r.employeeId === ctx.self.id)
}

function rowView(ctx: HrCtx, r: Tenant<LetterRequestRecord>): LetterRequestRow {
  const e = employeeById(r.companyId, r.employeeId)
  const own = selfId(ctx) === r.employeeId
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: e?.fullName ?? 'Unknown',
    employeeNo: e?.employeeNo ?? '',
    departmentName: departmentName(r.companyId, e?.departmentId ?? null),
    letterTypeId: r.letterTypeId,
    code: r.code,
    typeName: r.typeName,
    includesSalary: r.includesSalary,
    addressee: r.addressee,
    purpose: r.purpose,
    nocPurpose: r.nocPurpose,
    languageNote: r.languageNote,
    language: r.language ?? 'en',
    layout: r.layout ?? null,
    digits: r.digits ?? 'western',
    addresseeAr: r.addresseeAr ?? '',
    purposeAr: r.purposeAr ?? '',
    onBehalf: r.onBehalf,
    requestedByName: r.requestedByName,
    status: r.status,
    createdAt: r.createdAt,
    decidedByName: r.decidedByName,
    decidedAt: r.decidedAt,
    rejectionReason: r.rejectionReason,
    overrideReason: r.overrideReason,
    referenceNo: r.letter?.referenceNo ?? null,
    issueDate: r.letter?.issueDate ?? null,
    revokedAt: r.revokedAt ?? null,
    revokedByName: r.revokedByName ?? null,
    revokeReason: r.revokeReason ?? '',
    canDecide: isFull(ctx) && r.status === 'pending' && !own,
    canCancel: r.status === 'pending' && (own || isFull(ctx)),
    canRevoke: isFull(ctx) && r.status === 'issued',
  }
}

function detailView(ctx: HrCtx, r: Tenant<LetterRequestRecord>): LetterRequestDetail {
  return { ...rowView(ctx, r), letter: r.letter ? structuredClone(r.letter) : null }
}

function visibleRequest(ctx: HrCtx, id: string): Tenant<LetterRequestRecord> {
  const r = hrLetterRequests.find((x) => x.companyId === ctx.co && x.id === id)
  if (!r || !canSee(ctx, r)) throw notFound()
  return r
}

/** Rows the caller may see: HR full all of the company, anyone else their own. */
export function letterRowsFor(ctx: HrCtx, filter: { status?: string | null; employeeId?: string | null } = {}): LetterRequestRow[] {
  return hrLetterRequests
    .filter((r) => r.companyId === ctx.co && canSee(ctx, r) && (!filter.status || r.status === filter.status) && (!filter.employeeId || r.employeeId === filter.employeeId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((r) => rowView(ctx, r))
}

/** GET /hr/letters/requests?status&employee_id */
export async function listLetterRequests(user: User, q: { status?: string | null; employeeId?: string | null }): Promise<LetterRequestRow[]> {
  const ctx = hrCtx(user)
  if (!isFull(ctx)) requireSelf(ctx)
  return delay(letterRowsFor(ctx, q))
}

/** GET /hr/letters/requests/:id — the request and, once issued, the letter. */
export async function getLetterRequest(user: User, id: string): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  return delay(detailView(ctx, visibleRequest(ctx, id)))
}

/* ---------------- requests: create / decide ---------------- */

const nextId = (prefix: string, rows: readonly { id: string }[]) => {
  let max = 0
  for (const r of rows) if (r.id.startsWith(prefix)) max = Math.max(max, Number(r.id.slice(prefix.length)) || 0)
  return `${prefix}${max + 1}`
}

/** Language, bilingual layout and digit style of a request (validated; Arabic needs the type's Arabic template). */
function languageOf(i: { language?: unknown; layout?: unknown; digits?: unknown }, t: Pick<LetterTypeRecord, 'bodyAr' | 'name'>): { language: LetterLanguage; layout: BilingualLayout | null; digits: DigitStyle } {
  const language = (i.language ?? 'en') as LetterLanguage
  if (!LETTER_LANGUAGES.includes(language)) throw invalid('Pick the letter language: English, Arabic or bilingual.', 'language')
  if (language !== 'en' && !t.bodyAr.trim()) throw invalid(`${t.name} has no Arabic version yet. Ask HR, or request it in English.`, 'no_arabic_template')
  const layout = language === 'bilingual' ? ((i.layout ?? 'side_by_side') as BilingualLayout) : null
  if (layout && !BILINGUAL_LAYOUTS.includes(layout)) throw invalid('Pick side by side or stacked for a bilingual letter.', 'layout')
  const digits = (i.digits ?? 'western') as DigitStyle
  if (digits !== 'western' && digits !== 'arabic') throw invalid('Pick Western or Arabic digits.', 'digits')
  return { language, layout, digits }
}

/** POST /hr/letters/requests — the employee for themselves, or HR full for an employee (`employee_id`). */
export async function createLetterRequest(user: User, input: LetterRequestInput | null): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  const i = input ?? ({} as LetterRequestInput)
  const forOther = i.employeeId !== undefined && i.employeeId !== null && i.employeeId !== '' && i.employeeId !== selfId(ctx)
  let e: Tenant<Employee>
  if (forOther) {
    if (!isFull(ctx)) throw forbidden('Only HR can request a letter for another employee.')
    const found = companyEmployee(ctx.co, i.employeeId)
    if (!found) throw notFound()
    e = found
  } else e = requireSelf(ctx)
  const t = typeof i.letterTypeId === 'string' ? hrLetterTypes.find((x) => x.companyId === ctx.co && x.id === i.letterTypeId) : undefined
  if (!t) throw notFound()
  if (!t.active) throw invalid('This letter isn’t offered at the moment.', 'type_inactive')
  const addressee = str(i.addressee, 200) || (t.code === 'salary_transfer' ? '' : 'To whom it may concern')
  if (!addressee) throw invalid('Enter the bank the letter is addressed to.', 'addressee')
  const purpose = str(i.purpose, 300)
  let nocPurpose: NocPurpose | null = null
  if (t.code === 'noc') {
    if (!NOC_PURPOSES.includes(i.nocPurpose as NocPurpose)) throw invalid('Pick what the NOC is for: travel, a visa application or another purpose.', 'noc_purpose')
    nocPurpose = i.nocPurpose as NocPurpose
    if (!purpose) throw invalid('Describe the purpose (e.g. travel to Oman from 10 to 14 March).', 'purpose')
  }
  const lang = languageOf(i, t)
  const overrideReason = forOther ? str(i.overrideReason, 300) : ''
  if (t.code === 'experience_letter' && !LEAVING.has(e.status) && !overrideReason) {
    throw invalid(
      forOther
        ? 'Experience letters are for employees in their notice period or who have left: give a reason to issue one anyway.'
        : 'Experience letters are for employees in their notice period or who have left. Ask HR if you need one.',
      'not_leaving',
    )
  }
  if (t.includesSalary && !activeContract(ctx.co, e.id)) throw invalid('There is no active contract to take the salary from. Ask HR.', 'no_contract')
  if (hrLetterRequests.some((r) => r.companyId === ctx.co && r.employeeId === e.id && r.letterTypeId === t.id && r.status === 'pending')) {
    throw conflict(`You already have a request for this letter (${t.name}) waiting for HR.`, 'duplicate_request')
  }
  const at = nowIso()
  const r: Tenant<LetterRequestRecord> = {
    companyId: ctx.co,
    id: nextId('HLR-', hrLetterRequests),
    employeeId: e.id,
    letterTypeId: t.id,
    code: t.code,
    typeName: t.name,
    includesSalary: t.includesSalary,
    addressee,
    purpose,
    nocPurpose,
    languageNote: str(i.languageNote, 300),
    ...lang,
    addresseeAr: str(i.addresseeAr, 200),
    purposeAr: str(i.purposeAr, 300),
    requestedBy: user.id,
    requestedByName: user.name,
    onBehalf: forOther,
    status: 'pending',
    overrideReason,
    rejectionReason: '',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    letter: null,
    revokedAt: null,
    revokedBy: null,
    revokedByName: null,
    revokeReason: '',
    notified: [],
    createdAt: at,
    updatedAt: at,
  }
  hrLetterRequests.push(r)
  logHr(ctx.co, e.id, user, 'letter', `${t.name} requested${forOther ? ` by ${user.name} (HR)` : ''}`, at)
  notifyOnce(r, 'submitted', hrRecipients(ctx.co, user.id, e.userId), {
    title: `${t.name} requested by ${e.fullName}`,
    body: `${addressee}${purpose ? ` · ${purpose}` : ''}`,
    link: `${REQUESTS_LINK}?tab=letters&request=${encodeURIComponent(r.id)}`,
  })
  return delay(detailView(ctx, r))
}

function pendingForDecision(ctx: HrCtx, id: string): Tenant<LetterRequestRecord> {
  requireFull(ctx)
  const r = visibleRequest(ctx, id)
  if (selfId(ctx) === r.employeeId) throw ownRequest()
  if (r.status !== 'pending') throw conflict('This request was already decided.', 'not_pending')
  return r
}

const PLACEHOLDER_LABEL = new Map(PLACEHOLDERS.map((p) => [p.key, p.label]))

/** The company prefix of reference numbers: the employee-number prefix (APX, CRS), else from the subdomain. */
export function prefixOf(co: string): string {
  const fromNo = hrEmployees.find((e) => e.companyId === co)?.employeeNo.match(/^([A-Z]+)-/)?.[1]
  return fromNo ?? (companyById(co)?.subdomain ?? 'HR').slice(0, 3).toUpperCase()
}

export function letterheadOf(co: string): Letterhead {
  const c = companyById(co) ?? null
  const issuer = issuerFor(c)
  return {
    name: issuer.name,
    legalName: issuer.legalName,
    addressLines: issuer.addressLines,
    phone: issuer.phone,
    email: issuer.email,
    website: issuer.website,
    licenseNo: issuer.commercialLicenseNo,
    logoUrl: c?.branding.logoUrl ?? null,
    primaryColor: c?.branding.primaryColor ?? null,
    legalNameAr: legalNameArOf(co),
  }
}

/** The company legal name in Arabic: Accounts & finance › Settings (the same name KSA tax invoices print). */
export function legalNameArOf(co: string): string {
  return financeSettings.get(co).legalNameAr?.trim() ?? ''
}

/** The values a template is filled with. Pay and bank only for salary letter types. */
export function letterValues(co: string, e: Employee, t: Pick<LetterTypeRecord, 'includesSalary'>, r: Pick<LetterRequestRecord, 'addressee' | 'purpose' | 'nocPurpose'>, issue: { referenceNo: string; issueDate: string; signatoryName: string; signatoryTitle: string }): LetterValues {
  const c = companyById(co) ?? null
  const issuer = issuerFor(c)
  const g = e.gender
  const v: LetterValues = {
    'employee.fullName': e.fullName,
    'employee.salutation': g === 'male' ? 'Mr.' : g === 'female' ? 'Ms.' : '',
    'employee.pronoun': g === 'male' ? 'he' : g === 'female' ? 'she' : 'they',
    'employee.possessive': g === 'male' ? 'his' : g === 'female' ? 'her' : 'their',
    'employee.object': g === 'male' ? 'him' : g === 'female' ? 'her' : 'them',
    'employee.employeeNo': e.employeeNo,
    'employee.jobTitle': e.jobTitle,
    'employee.department': departmentName(co, e.departmentId),
    'employee.nationality': e.nationality ? countryLabel(e.nationality) : '',
    'employee.hireDate': letterDate(e.hireDate),
    'employee.exitDate': letterDate(e.exitDate),
    'employee.employmentType': EMPLOYMENT_TYPE_LABEL[e.employmentType]?.toLowerCase() ?? '',
    'company.name': issuer.name,
    'company.legalName': issuer.legalName,
    'company.address': issuer.addressLines.join(', '),
    'company.country': c ? countryLabel(c.regional.country) : '',
    'letter.date': letterDate(issue.issueDate),
    'letter.referenceNo': issue.referenceNo,
    addressee: r.addressee,
    purpose: r.purpose || 'whatever purpose it may serve',
    'noc.purpose': r.nocPurpose ? NOC_PURPOSE_LABEL[r.nocPurpose] : '',
    'signatory.name': issue.signatoryName,
    'signatory.title': issue.signatoryTitle,
  }
  if (t.includesSalary) {
    const k = activeContract(co, e.id)
    const p = profileOf(co, e.id)
    if (k) {
      const allowances = k.housingAllowance + k.transportAllowance + k.otherAllowance
      Object.assign(v, {
        'salary.basic': letterMoney(k.basicSalary),
        'salary.housing': letterMoney(k.housingAllowance),
        'salary.transport': letterMoney(k.transportAllowance),
        'salary.other': letterMoney(k.otherAllowance),
        'salary.allowances': letterMoney(allowances),
        'salary.total': letterMoney(k.basicSalary + allowances),
        'salary.currency': k.currency,
      })
    }
    // Never the full IBAN: the last 4 characters only.
    Object.assign(v, { 'bank.name': p.bankName, 'bank.ibanLast4': p.iban ? p.iban.slice(-4) : '' })
  }
  return v
}

const DEFAULT_ADDRESSEE = 'To whom it may concern'

/**
 * The Arabic values of a template: the employee's Arabic name and job title, the company's Arabic legal name (no
 * fallback: missing ones block the issue), Arabic nationality / country names, dates with Arabic month names, the
 * currency in words, Arabic-Indic digits when chosen (identifiers — reference, employee number, IBAN digits — stay
 * Western). Pay and bank only for salary letter types, like the English values.
 */
export function letterValuesAr(
  co: string,
  e: Employee,
  t: Pick<LetterTypeRecord, 'includesSalary'>,
  r: Pick<LetterRequestRecord, 'addressee' | 'purpose' | 'nocPurpose' | 'addresseeAr' | 'purposeAr' | 'digits'>,
  issue: { referenceNo: string; issueDate: string; signatoryName: string; signatoryTitle: string },
): LetterValues {
  const c = companyById(co) ?? null
  const issuer = issuerFor(c)
  const digits = r.digits ?? 'western'
  const legalAr = legalNameArOf(co)
  const g = e.gender
  const v: LetterValues = {
    'employee.fullName': e.fullNameAr ?? '',
    'employee.salutation': g === 'male' ? 'السيد' : g === 'female' ? 'السيدة' : '',
    'employee.pronoun': g === 'female' ? 'هي' : 'هو',
    'employee.possessive': g === 'female' ? 'لها' : 'له',
    'employee.object': g === 'female' ? 'لها' : 'له',
    'employee.employeeNo': e.employeeNo,
    'employee.jobTitle': e.jobTitleAr ?? '',
    'employee.department': departmentName(co, e.departmentId),
    'employee.nationality': e.nationality ? countryNameAr(e.nationality) : '',
    'employee.hireDate': letterDateAr(e.hireDate, digits),
    'employee.exitDate': letterDateAr(e.exitDate, digits),
    'employee.employmentType': AR_EMPLOYMENT_TYPE[e.employmentType] ?? '',
    'company.name': legalAr,
    'company.legalName': legalAr,
    'company.address': issuer.addressLines.join('، '),
    'company.country': c ? countryNameAr(c.regional.country) : '',
    'letter.date': letterDateAr(issue.issueDate, digits),
    'letter.referenceNo': issue.referenceNo,
    addressee: r.addresseeAr || (r.addressee && r.addressee !== DEFAULT_ADDRESSEE ? r.addressee : 'لمن يهمه الأمر'),
    purpose: r.purposeAr || r.purpose || 'تقديمها لمن يهمه الأمر',
    'noc.purpose': r.nocPurpose ? AR_NOC_PURPOSE[r.nocPurpose] : '',
    'signatory.name': issue.signatoryName,
    'signatory.title': issue.signatoryTitle,
  }
  if (t.includesSalary) {
    const k = activeContract(co, e.id)
    const p = profileOf(co, e.id)
    if (k) {
      const allowances = k.housingAllowance + k.transportAllowance + k.otherAllowance
      Object.assign(v, {
        'salary.basic': letterMoneyAr(k.basicSalary, digits),
        'salary.housing': letterMoneyAr(k.housingAllowance, digits),
        'salary.transport': letterMoneyAr(k.transportAllowance, digits),
        'salary.other': letterMoneyAr(k.otherAllowance, digits),
        'salary.allowances': letterMoneyAr(allowances, digits),
        'salary.total': letterMoneyAr(k.basicSalary + allowances, digits),
        'salary.currency': AR_CURRENCY[k.currency] ?? k.currency,
      })
    }
    Object.assign(v, { 'bank.name': p.bankName, 'bank.ibanLast4': p.iban ? p.iban.slice(-4) : '' })
  }
  return v
}

/** Labels of missing values for the 422 message: Arabic ones say where to fill them in. */
function missingLabels(en: string[], ar: string[]): string {
  return [...en.map((k) => PLACEHOLDER_LABEL.get(k) ?? k), ...ar.map((k) => AR_REQUIRED_SOURCE[k] ?? `${PLACEHOLDER_LABEL.get(k) ?? k} (Arabic)`)]
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(', ')
}

function uniqueCode(): string {
  for (;;) {
    const code = makeVerificationCode()
    if (!hrLetterRequests.some((r) => r.letter?.verificationCode === code)) return code
  }
}

/** POST /hr/letters/requests/:id/approve — HR full (not their own): issues the letter. */
export async function approveLetterRequest(user: User, id: string, input: (LetterDecisionInput & { signatoryTitle?: string }) | null): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  const r = pendingForDecision(ctx, id)
  const e = employeeById(ctx.co, r.employeeId)
  const t = hrLetterTypes.find((x) => x.companyId === ctx.co && x.id === r.letterTypeId)
  if (!e || !t) throw notFound()
  const override = str(input?.overrideReason, 300)
  if (r.code === 'experience_letter' && !LEAVING.has(e.status) && !r.overrideReason && !override) {
    throw invalid(`${e.fullName} isn’t in a notice period and hasn’t left: give an override reason to issue an experience letter anyway.`, 'not_leaving')
  }
  if (t.includesSalary && !activeContract(ctx.co, e.id)) throw invalid('There is no active contract to take the salary from.', 'no_contract')
  // HR may change the language / layout / digits at approval; otherwise the request's choice.
  const lang = languageOf(
    {
      language: input?.language ?? r.language ?? 'en',
      layout: input?.language !== undefined || input?.layout !== undefined ? input?.layout : r.layout,
      digits: input?.digits ?? r.digits ?? 'western',
    },
    t,
  )
  const withEn = lang.language !== 'ar'
  const withAr = lang.language !== 'en'
  if (withEn) templateProblems(t.body, t.includesSalary)
  if (withAr) templateProblems(t.bodyAr, t.includesSalary, { arabic: true })
  const issueDate = ctx.today
  const signatoryTitle = str(input?.signatoryTitle, 120) || user.title || 'Human Resources'
  const rq = { ...r, digits: lang.digits }
  const valuesFor = (referenceNo: string) => ({
    en: letterValues(ctx.co, e, t, rq, { referenceNo, issueDate, signatoryName: user.name, signatoryTitle }),
    ar: letterValuesAr(ctx.co, e, t, rq, { referenceNo, issueDate, signatoryName: user.name, signatoryTitle }),
  })
  // Everything is checked before the sequence moves, so a refused approval never burns a reference number.
  const pv = valuesFor('X')
  const missEn = withEn ? renderTemplate(t.body, pv.en).missing : []
  const missAr = withAr ? renderTemplate(t.bodyAr, pv.ar, { rtl: true }).missing : []
  if (missEn.length || missAr.length) {
    throw invalid(`Fill in before issuing: ${missingLabels(missEn, missAr)}.`, 'missing_values', { missing: missEn, missingAr: missAr })
  }
  const referenceNo = letterReference(prefixOf(ctx.co), Number(issueDate.slice(0, 4)), nextLetterSeq(ctx.co, Number(issueDate.slice(0, 4))))
  const v = valuesFor(referenceNo)
  const letter: IssuedLetter = {
    title: t.name,
    referenceNo,
    issueDate,
    verificationCode: uniqueCode(),
    body: withEn ? renderTemplate(t.body, v.en).text : '',
    language: lang.language,
    layout: lang.layout,
    digits: lang.digits,
    titleAr: withAr ? t.nameAr || t.name : null,
    bodyAr: withAr ? renderTemplate(t.bodyAr, v.ar, { rtl: true }).text : null,
    issueDateAr: withAr ? letterDateAr(issueDate, lang.digits) : null,
    signatoryName: user.name,
    signatoryTitle,
    letterhead: letterheadOf(ctx.co),
  }
  const at = nowIso()
  Object.assign(r, { status: 'issued', letter, ...lang, decidedBy: user.id, decidedByName: user.name, decidedAt: at, updatedAt: at })
  if (override) r.overrideReason = override
  logHr(ctx.co, e.id, user, 'letter', `${t.name} issued (${referenceNo})${r.overrideReason ? ` — override: ${r.overrideReason}` : ''}`, at)
  recordAudit(user, { action: 'create', entity: 'hr_letter', entityId: r.id, summary: `Issued ${t.name} ${referenceNo} to ${e.fullName}`, changes: [] })
  if (e.userId) {
    notifyOnce(r, 'issued', [e.userId], { title: `Your ${t.name.toLowerCase()} is ready`, body: `${referenceNo} · ${r.addressee}`, link: `/hr/letters/${encodeURIComponent(r.id)}` })
  }
  return delay(detailView(ctx, r))
}

/** POST /hr/letters/requests/:id/reject — HR full (not their own), with a reason. */
export async function rejectLetterRequest(user: User, id: string, input: LetterDecisionInput | null): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  const r = pendingForDecision(ctx, id)
  const reason = str(input?.reason, 500)
  if (!reason) throw invalid('Give the employee a reason.', 'reason_required')
  const at = nowIso()
  Object.assign(r, { status: 'rejected', rejectionReason: reason, decidedBy: user.id, decidedByName: user.name, decidedAt: at, updatedAt: at })
  const e = employeeById(ctx.co, r.employeeId)
  logHr(ctx.co, r.employeeId, user, 'letter', `${r.typeName} request rejected: ${reason}`, at)
  if (e?.userId) notifyOnce(r, 'rejected', [e.userId], { title: `Your ${r.typeName.toLowerCase()} request was rejected`, body: reason, link: `${MY_HR_LINK}?section=letters` })
  return delay(detailView(ctx, r))
}

/** POST /hr/letters/requests/:id/cancel — the employee (own, pending) or HR full. */
export async function cancelLetterRequest(user: User, id: string): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  const r = visibleRequest(ctx, id)
  if (r.status !== 'pending') throw conflict('Only a request waiting for HR can be cancelled.', 'not_pending')
  const at = nowIso()
  Object.assign(r, { status: 'cancelled', updatedAt: at })
  logHr(ctx.co, r.employeeId, user, 'letter', `${r.typeName} request cancelled`, at)
  return delay(detailView(ctx, r))
}

/** POST /hr/letters/requests/:id/revoke — HR full: withdraw an issued letter (reason, audited); its verification shows "revoked". */
export async function revokeLetter(user: User, id: string, input: { reason?: unknown } | null): Promise<LetterRequestDetail> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const r = visibleRequest(ctx, id)
  if (r.status !== 'issued' || !r.letter) throw conflict('Only an issued letter can be revoked.', 'not_issued')
  const reason = str(input?.reason, 500)
  if (!reason) throw invalid('Give the reason for revoking the letter.', 'reason_required')
  const at = nowIso()
  Object.assign(r, { status: 'revoked', revokedAt: at, revokedBy: user.id, revokedByName: user.name, revokeReason: reason, updatedAt: at })
  logHr(ctx.co, r.employeeId, user, 'letter', `${r.typeName} ${r.letter.referenceNo} revoked: ${reason}`, at)
  recordAudit(user, { action: 'security', entity: 'hr_letter', entityId: r.id, summary: `Revoked ${r.typeName} ${r.letter.referenceNo}: ${reason}`, changes: [] })
  const e = employeeById(ctx.co, r.employeeId)
  if (e?.userId) notifyOnce(r, 'revoked', [e.userId], { title: `Your ${r.typeName.toLowerCase()} ${r.letter.referenceNo} was revoked`, body: reason, link: `/hr/letters/${encodeURIComponent(r.id)}` })
  return delay(detailView(ctx, r))
}

const LETTER_CODE_HINT = 'Enter the 12-character verification code printed on the letter (e.g. ABCD-EFGH-JKLM).'

/** GET /hr/letters/verify?code= — HR full: is this an authentic letter of the company? (Another company's code: not valid.) */
export async function verifyLetter(user: User, rawCode: string | null): Promise<LetterVerification> {
  const ctx = hrCtx(user)
  requireFull(ctx)
  const code = normalizeCode(rawCode)
  if (!code) throw invalid(LETTER_CODE_HINT, 'code')
  const r = hrLetterRequests.find((x) => x.companyId === ctx.co && (x.status === 'issued' || x.status === 'revoked') && x.letter?.verificationCode === code)
  const e = r ? employeeById(ctx.co, r.employeeId) : undefined
  return delay({
    valid: r?.status === 'issued',
    status: !r ? 'not_found' : r.status === 'issued' ? 'valid' : 'revoked',
    revokedAt: r?.revokedAt ?? null,
    code,
    referenceNo: r?.letter?.referenceNo ?? null,
    employeeName: e?.fullName ?? null,
    employeeNo: e?.employeeNo ?? null,
    typeName: r?.typeName ?? null,
    issueDate: r?.letter?.issueDate ?? null,
    issuedByName: r?.letter?.signatoryName ?? null,
  })
}

/* ---------------- public verification (no sign-in) ---------------- */

const PUBLIC_NOT_FOUND = 'No letter with this verification code was issued by this company. Check the code, or ask the company’s HR.'
/** Lookups per client in 10 minutes (a code is 12 characters of a 32-letter alphabet: guessing is hopeless anyway). */
export const PUBLIC_VERIFY_LIMIT = 20
const PUBLIC_VERIFY_WINDOW_MS = 10 * 60_000

/**
 * GET /public/letters/verify?code= — anyone holding a letter (its QR code). The COMPANY comes from the address the page
 * was opened on (Host; X-Workspace or ?workspace= in the mock), never from the code: a code is looked up in that company
 * only, so another company's code answers exactly like an unknown one (404). Unknown / suspended / deleted workspace,
 * no HR module → the same 404. Answers only the company's name / logo, the letter type, reference, issue date, a masked
 * employee name and valid / revoked: no pay, no employee number, no personal data. Rate-limited per client.
 */
export async function verifyLetterPublic(workspace: string | null, rawCode: string | null, clientKey = 'anonymous'): Promise<PublicLetterVerification> {
  hitRateLimit(letterVerifyHits, [`letter-verify:${clientKey || 'anonymous'}`], { limit: PUBLIC_VERIFY_LIMIT, windowMs: PUBLIC_VERIFY_WINDOW_MS, what: 'verification' })
  const code = normalizeCode(rawCode)
  if (!code) throw invalid(LETTER_CODE_HINT, 'code')
  const host = (workspace ?? '').trim().toLowerCase()
  const co = host ? (resolveWorkspace(host)?.company.id ?? null) : null
  const sub = co ? subscriptionOf(co) : undefined
  const c = co ? companyById(co) : undefined
  const r = co ? hrLetterRequests.find((x) => x.companyId === co && (x.status === 'issued' || x.status === 'revoked') && x.letter?.verificationCode === code) : undefined
  if (!co || !c || !r?.letter || !sub || sub.status === 'deleted' || c.status === 'suspended' || !companyModules(co).includes('hr')) {
    throw new CodedApiError(PUBLIC_NOT_FOUND, 404, 'letter_not_found')
  }
  const e = employeeById(co, r.employeeId)
  return delay({
    status: r.status === 'issued' ? 'valid' : 'revoked',
    code,
    companyName: c.branding.displayName || c.name,
    logoUrl: c.branding.logoUrl ?? null,
    monogram: c.branding.monogram ?? '',
    typeName: r.letter.title,
    referenceNo: r.letter.referenceNo,
    issueDate: r.letter.issueDate,
    employeeNameMasked: maskedName(e?.fullName),
    revokedAt: r.status === 'revoked' ? (r.revokedAt ?? null) : null,
  })
}
