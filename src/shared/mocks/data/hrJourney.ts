import type { Employee } from '@/modules/hr/types'
import type { DueAnchor, ItemAction, ItemStatus, JourneyKind, JourneyStatus, JourneyTemplate, OwnerRole, SystemTaskKey, TemplateItem } from '@/modules/hr/journey/types'
import { dueDateFor, matchTemplate } from '@/modules/hr/journey/calc'
import type { Tenant } from '@/shared/mocks/tenant'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * HR › Onboarding & offboarding stores (services/hrJourney.ts):
 *   hr.journeyTemplates  checklist templates per company (kind, targeting by department / employment type, items)
 *   hr.journeys          one checklist run per employee and kind, items copied from the template at start
 *                        (+ the offboarding's system items); notification marks per item (`alertMarks`)
 * Ids are globally unique (TPL-n, TI-n, JRN-n, JI-n). Synthetic seed: per-country templates (UAE / KSA) and one
 * running onboarding per company (the employee in probation: only the probation review is left).
 */

export interface JourneyItemRecord {
  id: string
  title: string
  description: string
  ownerRole: OwnerRole
  assigneeUserId: string | null
  dueAnchor: DueAnchor
  dueOffsetDays: number
  dueDate: string
  dueOverridden: boolean
  required: boolean
  blocking: boolean
  action: ItemAction | null
  system: SystemTaskKey | null
  status: ItemStatus
  doneAt: string | null
  doneBy: string | null
  doneByName: string | null
  /** How a linked / system item was ticked ("Laptop AST-014 assigned"). */
  detail: string | null
  note: string
  /** Once-only notification marks: `assigned:<userId>`, `due:<date>`, `overdue:<date>`. */
  alertMarks: string[]
  /** Reference set by another section (e.g. the probation review id of HR › Performance). */
  externalRef: string | null
}

export interface JourneyRecord {
  id: string
  kind: JourneyKind
  employeeId: string
  templateId: string | null
  templateName: string | null
  status: JourneyStatus
  startedAt: string
  startedBy: string | null
  startedByName: string
  completedAt: string | null
  completedBy: string | null
  cancelledAt: string | null
  items: JourneyItemRecord[]
}

export const journeySeq = registerObject('hr.journeySeq', { template: 100, templateItem: 1000, journey: 100, item: 1000 })
export const nextTemplateId = () => `TPL-${++journeySeq.template}`
export const nextTemplateItemId = () => `TI-${++journeySeq.templateItem}`
export const nextJourneyId = () => `JRN-${++journeySeq.journey}`
export const nextJourneyItemId = () => `JI-${++journeySeq.item}`

/* ---------------- templates (seed) ---------------- */

type Seed = Omit<TemplateItem, 'id' | 'description' | 'ownerUserId' | 'dueAnchor' | 'required' | 'action'> & Partial<Pick<TemplateItem, 'description' | 'ownerUserId' | 'dueAnchor' | 'required' | 'action'>>

const mk = (s: Seed): TemplateItem => ({ id: nextTemplateItemId(), description: '', ownerUserId: null, dueAnchor: 'start', required: true, action: null, ...s })

const ADMIN: Record<string, string> = { [APEX_ID]: 'u1', [CREST_ID]: 'u101' }

function common(co: string): Seed[] {
  return [
    { title: 'Sign the employment contract', ownerRole: 'hr', dueOffsetDays: -3, action: { kind: 'sign_contract' }, description: 'Signed copy on the contract record.' },
    { title: 'Prepare the laptop', ownerRole: 'it', ownerUserId: ADMIN[co], dueOffsetDays: -1, action: { kind: 'assign_asset', assetCategory: 'laptop' }, description: 'Image, encrypt and hand over on day one.' },
    { title: 'Create the email account and system access', ownerRole: 'it', ownerUserId: ADMIN[co], dueOffsetDays: 0 },
    { title: 'Assign a first-week buddy', ownerRole: 'manager', dueOffsetDays: 0, description: 'Someone from the team for lunch, questions and the office tour.' },
    { title: 'Welcome meeting and 30-day goals', ownerRole: 'manager', dueOffsetDays: 2 },
    { title: 'Complete personal details and emergency contact', ownerRole: 'employee', dueOffsetDays: 3 },
    { title: 'Read the handbook and accept the code of conduct', ownerRole: 'employee', dueOffsetDays: 5 },
    { title: 'Enrol in the mandatory training', ownerRole: 'hr', dueOffsetDays: 14, action: { kind: 'enrol_course', courseId: null } },
    { title: 'Probation review', ownerRole: 'manager', dueOffsetDays: -10, dueAnchor: 'probation_end', required: false, action: { kind: 'probation_review' }, description: 'Confirm, extend or end the probation before it ends.' },
  ]
}

function uaeOnboarding(co: string): Seed[] {
  return [
    { title: 'Collect the passport copy and photos', ownerRole: 'hr', dueOffsetDays: -7, action: { kind: 'upload_document', documentType: 'passport' } },
    { title: 'Medical fitness test', ownerRole: 'hr', dueOffsetDays: 5, description: 'Book the visa medical at an approved centre.' },
    { title: 'Emirates ID biometrics', ownerRole: 'hr', dueOffsetDays: 14, action: { kind: 'upload_document', documentType: 'emirates_id' } },
    { title: 'Visa stamping', ownerRole: 'hr', dueOffsetDays: 21, action: { kind: 'upload_document', documentType: 'residence_visa' } },
    { title: 'Labour card', ownerRole: 'hr', dueOffsetDays: 21, action: { kind: 'upload_document', documentType: 'labour_card' } },
    { title: 'Medical insurance enrolment', ownerRole: 'hr', dueOffsetDays: 7, action: { kind: 'upload_document', documentType: 'medical_insurance' } },
    { title: 'Payroll and WPS bank details', ownerRole: 'finance', ownerUserId: 'u8', dueOffsetDays: 10, required: false },
    ...common(co),
  ]
}

function ksaOnboarding(co: string): Seed[] {
  return [
    { title: 'Collect the passport copy and photos', ownerRole: 'hr', dueOffsetDays: -7, action: { kind: 'upload_document', documentType: 'passport' } },
    { title: 'Issue the Iqama', ownerRole: 'hr', dueOffsetDays: 30, action: { kind: 'upload_document', documentType: 'iqama' }, description: 'Expatriates only: Iqama within 90 days of entry.' },
    { title: 'GOSI registration', ownerRole: 'hr', dueOffsetDays: 7 },
    { title: 'Update Muqeem', ownerRole: 'hr', dueOffsetDays: 30 },
    { title: 'Register the contract on Qiwa', ownerRole: 'hr', dueOffsetDays: 14 },
    { title: 'Medical insurance (CCHI)', ownerRole: 'hr', dueOffsetDays: 7, action: { kind: 'upload_document', documentType: 'medical_insurance' } },
    { title: 'Payroll and Mudad bank details', ownerRole: 'finance', dueOffsetDays: 10, required: false },
    ...common(co),
  ]
}

function offboardingItems(co: string, ksa: boolean): Seed[] {
  return [
    { title: 'Knowledge handover', ownerRole: 'manager', dueOffsetDays: -5, description: 'Hand over open work, documents and accounts to the team.' },
    { title: 'Exit interview', ownerRole: 'hr', dueOffsetDays: -3, required: false },
    { title: 'Clear expense claims and petty cash', ownerRole: 'finance', ownerUserId: ksa ? null : 'u8', dueOffsetDays: -2 },
    { title: 'Revoke system access and forward the mailbox', ownerRole: 'it', ownerUserId: ADMIN[co], dueOffsetDays: 0 },
    { title: 'Return the access card and keys', ownerRole: 'employee', dueOffsetDays: 0 },
    ksa
      ? { title: 'Final exit visa (Muqeem) and GOSI deregistration', ownerRole: 'hr', dueOffsetDays: 7 }
      : { title: 'Cancel the residence visa and labour card', ownerRole: 'hr', dueOffsetDays: 7 },
    { title: 'Experience certificate', ownerRole: 'hr', dueOffsetDays: 3, required: false },
  ]
}

function seedTemplates(): Tenant<JourneyTemplate>[] {
  const at = new Date(Date.now() - 120 * 86_400_000).toISOString()
  const t = (companyId: string, kind: JourneyKind, name: string, description: string, items: Seed[], target: Partial<Pick<JourneyTemplate, 'departmentId' | 'employmentType'>> = {}): Tenant<JourneyTemplate> => ({
    companyId,
    id: nextTemplateId(),
    kind,
    name,
    description,
    departmentId: target.departmentId ?? null,
    employmentType: target.employmentType ?? null,
    active: true,
    items: items.map(mk),
    createdAt: at,
    updatedAt: at,
  })
  return [
    t(APEX_ID, 'onboarding', 'Standard onboarding (UAE)', 'Visa, Emirates ID, labour card, IT set-up, buddy and probation review.', uaeOnboarding(APEX_ID)),
    t(APEX_ID, 'onboarding', 'Delivery team onboarding', 'The standard UAE steps plus project tools and shadowing.', [
      ...uaeOnboarding(APEX_ID),
      { title: 'Project tools access (tracker, repository, time sheets)', ownerRole: 'it', ownerUserId: 'u1', dueOffsetDays: 1 },
      { title: 'Shadow a client delivery', ownerRole: 'manager', dueOffsetDays: 10, required: false },
    ], { departmentId: 'd-delivery' }),
    t(APEX_ID, 'onboarding', 'Contractor onboarding', 'Short checklist for contractors: access, laptop, NDA.', [
      { title: 'Sign the consultancy agreement and NDA', ownerRole: 'hr', dueOffsetDays: -3, action: { kind: 'sign_contract' } },
      { title: 'Create the email account and system access', ownerRole: 'it', ownerUserId: 'u1', dueOffsetDays: 0 },
      { title: 'Introduce to the team', ownerRole: 'manager', dueOffsetDays: 1 },
    ], { employmentType: 'contractor' }),
    t(APEX_ID, 'offboarding', 'Standard offboarding (UAE)', 'Handover, exit interview, visa cancellation; assets, login and settlement are tracked automatically.', offboardingItems(APEX_ID, false)),
    t(CREST_ID, 'onboarding', 'Standard onboarding (KSA)', 'Iqama, GOSI, Muqeem, Qiwa, IT set-up, buddy and probation review.', ksaOnboarding(CREST_ID)),
    t(CREST_ID, 'onboarding', 'Operations onboarding', 'The KSA steps plus warehouse safety induction.', [
      ...ksaOnboarding(CREST_ID),
      { title: 'Warehouse safety induction', ownerRole: 'manager', dueOffsetDays: 1 },
      { title: 'Issue PPE and the access card', ownerRole: 'hr', dueOffsetDays: 0, action: { kind: 'assign_asset', assetCategory: 'access_card' } },
    ], { departmentId: 'c2-ops' }),
    t(CREST_ID, 'offboarding', 'Standard offboarding (KSA)', 'Handover, final exit visa, GOSI; assets, login and settlement are tracked automatically.', offboardingItems(CREST_ID, true)),
  ]
}

export const hrJourneyTemplates = registerArray<Tenant<JourneyTemplate>>('hr.journeyTemplates', seedTemplates())

/* ---------------- building items (shared with the service) ---------------- */

const activeUser = (co: string, id: string | null | undefined) => (id ? users.find((u) => u.id === id && u.companyId === co && u.active) : undefined)

/** The user who does a template item for this employee (null = the HR team). */
export function assigneeFor(co: string, employee: Employee, role: OwnerRole, ownerUserId: string | null): string | null {
  if (role === 'employee') return activeUser(co, employee.userId)?.id ?? null
  if (role === 'manager') {
    const m = employee.managerId ? hrEmployees.find((e) => e.companyId === co && e.id === employee.managerId) : undefined
    return activeUser(co, m?.userId)?.id ?? null
  }
  return activeUser(co, ownerUserId)?.id ?? null
}

/** The probation end of the employee's current contract (active, else draft), if any. */
export function probationEndOf(co: string, employeeId: string): string | null {
  const own = hrContracts.filter((c) => c.companyId === co && c.employeeId === employeeId)
  return (own.find((c) => c.status === 'active') ?? own.find((c) => c.status === 'draft'))?.probationEndDate ?? null
}

export function dueCtx(co: string, kind: JourneyKind, e: Employee) {
  return { kind, hireDate: e.hireDate, exitDate: e.exitDate, probationEndDate: probationEndOf(co, e.id) }
}

export function itemFromTemplate(co: string, kind: JourneyKind, e: Employee, t: TemplateItem): JourneyItemRecord {
  return {
    id: nextJourneyItemId(),
    title: t.title,
    description: t.description,
    ownerRole: t.ownerRole,
    assigneeUserId: assigneeFor(co, e, t.ownerRole, t.ownerUserId),
    dueAnchor: t.dueAnchor,
    dueOffsetDays: t.dueOffsetDays,
    dueDate: dueDateFor(t.dueAnchor, t.dueOffsetDays, dueCtx(co, kind, e)),
    dueOverridden: false,
    required: t.required,
    blocking: false,
    action: t.action ? { ...t.action } : null,
    system: null,
    status: 'open',
    doneAt: null,
    doneBy: null,
    doneByName: null,
    detail: null,
    note: '',
    alertMarks: [],
    externalRef: null,
  }
}

/* ---------------- journeys (seed) ---------------- */

/** One running onboarding per company: the employee in probation, everything done but the probation review. */
function seedJourneys(templates: Tenant<JourneyTemplate>[]): Tenant<JourneyRecord>[] {
  const out: Tenant<JourneyRecord>[] = []
  for (const [co, empId] of [[APEX_ID, 'EMP-X3'], [CREST_ID, 'EMP-X103']] as const) {
    const e = hrEmployees.find((x) => x.companyId === co && x.id === empId)
    if (!e) continue
    const t = matchTemplate(templates.filter((x) => x.companyId === co), 'onboarding', e)
    if (!t) continue
    const today = companyDayOf(co).today
    const started = `${e.hireDate}T06:00:00.000Z`
    const items = t.items.map((ti) => {
      const item = itemFromTemplate(co, 'onboarding', e, ti)
      if (ti.action?.kind !== 'probation_review') {
        item.status = 'done'
        item.doneAt = `${item.dueDate < today ? item.dueDate : e.hireDate}T08:00:00.000Z`
        item.doneByName = 'HR team'
      }
      // Seeded history: nothing to announce again (thresholds already passed are marked).
      if (item.assigneeUserId) item.alertMarks.push(`assigned:${item.assigneeUserId}`)
      if (item.dueDate <= today) item.alertMarks.push(`due:${item.dueDate}`)
      if (item.dueDate < today) item.alertMarks.push(`overdue:${item.dueDate}`)
      return item
    })
    out.push({ companyId: co, id: nextJourneyId(), kind: 'onboarding', employeeId: e.id, templateId: t.id, templateName: t.name, status: 'active', startedAt: started, startedBy: null, startedByName: 'System', completedAt: null, completedBy: null, cancelledAt: null, items })
  }
  return out
}

export const hrJourneys = registerArray<Tenant<JourneyRecord>>('hr.journeys', seedJourneys(hrJourneyTemplates))

export const journeysOf = (co: string) => hrJourneys.filter((j) => j.companyId === co)
