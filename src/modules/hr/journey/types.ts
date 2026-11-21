import type { EmploymentStatus, EmploymentType } from '@/modules/hr/types'
import type { AssetCategory, DocumentType } from '@/modules/hr/peopleTypes'

/**
 * HR › Onboarding & offboarding (docs/API.md › HR › Onboarding & offboarding). Checklist TEMPLATES (per company,
 * optionally targeted by department and / or employment type) and JOURNEYS: one checklist run per employee and kind,
 * items copied from the best-matching template at start. Snake_case on the wire (src/shared/api/hrJourneyMappers.ts).
 *
 * Offboarding journeys also carry the three SYSTEM items of the existing offboarding (assets returned, login
 * deactivated, final settlement paid): they complete from their real source and can't be ticked by hand.
 */

export type JourneyKind = 'onboarding' | 'offboarding'
export const JOURNEY_KINDS: JourneyKind[] = ['onboarding', 'offboarding']
export const JOURNEY_KIND_LABEL: Record<JourneyKind, string> = { onboarding: 'Onboarding', offboarding: 'Offboarding' }

/** Who an item belongs to. `user` = a specific user (`ownerUserId`). */
export type OwnerRole = 'hr' | 'it' | 'manager' | 'employee' | 'finance' | 'user'
export const OWNER_ROLES: OwnerRole[] = ['hr', 'it', 'manager', 'employee', 'finance', 'user']
export const OWNER_ROLE_LABEL: Record<OwnerRole, string> = {
  hr: 'HR',
  it: 'IT / admin',
  manager: 'Manager',
  employee: 'Employee',
  finance: 'Finance',
  user: 'Specific person',
}

/**
 * What the due offset counts from: `start` = the hire date (onboarding) or the exit date (offboarding);
 * `probation_end` = the active contract's probation end (falls back to hire date + 90 days when unknown).
 */
export type DueAnchor = 'start' | 'probation_end'
export const DUE_ANCHORS: DueAnchor[] = ['start', 'probation_end']
/** Assumed probation length (days) when the employee has no contract with a probation end yet. */
export const DEFAULT_PROBATION_DAYS = 90

/**
 * Optional link action of an item: a shortcut to the screen that does it, and an automatic tick when the real
 * record appears (asset of the category held, enrolled in the course / every mandatory course, document of the
 * type on file, a signed contract). `probation_review` is the seam for HR › Performance (probation reviews).
 */
export type ItemActionKind = 'assign_asset' | 'enrol_course' | 'upload_document' | 'sign_contract' | 'probation_review'
export const ITEM_ACTION_KINDS: ItemActionKind[] = ['assign_asset', 'enrol_course', 'upload_document', 'sign_contract', 'probation_review']
export const ITEM_ACTION_LABEL: Record<ItemActionKind, string> = {
  assign_asset: 'Assign asset',
  enrol_course: 'Enrol in course',
  upload_document: 'Upload document',
  sign_contract: 'Sign contract',
  probation_review: 'Probation review',
}

export interface ItemAction {
  kind: ItemActionKind
  /** assign_asset: the category to hand over (any when null). */
  assetCategory?: AssetCategory | null
  /** enrol_course: the course (every mandatory course when null). */
  courseId?: string | null
  /** upload_document: the document type. */
  documentType?: DocumentType | null
}

/** System items of an offboarding (the existing checklist): they complete from their source. */
export type SystemTaskKey = 'assets' | 'login' | 'settlement'

/* ---------------- templates ---------------- */

export interface TemplateItem {
  id: string
  title: string
  description: string
  ownerRole: OwnerRole
  /** Required for `user`; optional default person for hr / it / finance (otherwise the HR team). */
  ownerUserId: string | null
  /** Days relative to the anchor (negative = before). */
  dueOffsetDays: number
  dueAnchor: DueAnchor
  required: boolean
  action: ItemAction | null
}

export interface JourneyTemplate {
  id: string
  kind: JourneyKind
  name: string
  description: string
  /** Targeting: null = any department / any employment type. */
  departmentId: string | null
  employmentType: EmploymentType | null
  active: boolean
  items: TemplateItem[]
  createdAt: string
  updatedAt: string
}

export interface TemplateItemView extends TemplateItem {
  ownerUserName: string | null
}

export interface TemplateView extends Omit<JourneyTemplate, 'items'> {
  departmentName: string | null
  items: TemplateItemView[]
  /** Journeys started from it that are still running. */
  activeJourneys: number
}

export interface TemplateItemInput {
  title: string
  description?: string
  ownerRole: OwnerRole
  ownerUserId?: string | null
  dueOffsetDays: number
  dueAnchor?: DueAnchor
  required?: boolean
  action?: ItemAction | null
}

export interface TemplateInput {
  kind: JourneyKind
  name: string
  description?: string
  departmentId?: string | null
  employmentType?: EmploymentType | null
  active?: boolean
  items: TemplateItemInput[]
}

/* ---------------- journeys ---------------- */

export type JourneyStatus = 'active' | 'completed' | 'cancelled'
export const JOURNEY_STATUS_LABEL: Record<JourneyStatus, string> = { active: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }

export type ItemStatus = 'open' | 'done' | 'skipped'

export interface JourneyItem {
  id: string
  title: string
  description: string
  ownerRole: OwnerRole
  /** The person who does it (null = the HR team). */
  assigneeUserId: string | null
  assigneeName: string | null
  dueAnchor: DueAnchor
  dueOffsetDays: number
  dueDate: string
  /** HR set the due date by hand (it no longer follows the hire / exit / probation date). */
  dueOverridden: boolean
  required: boolean
  /** Blocks finishing the journey (the offboarding's "return assets"). */
  blocking: boolean
  action: ItemAction | null
  system: SystemTaskKey | null
  status: ItemStatus
  doneAt: string | null
  doneByName: string | null
  /** Live state of a system item, or how a linked item was ticked. */
  detail: string | null
  note: string
  overdue: boolean
  /** Days until due (negative = overdue), company calendar; null when closed. */
  daysLeft: number | null
  /** The caller may tick / reopen it. */
  canComplete: boolean
}

export interface JourneyProgress {
  done: number
  total: number
  requiredDone: number
  requiredTotal: number
  /** 0–100 over every non-skipped item. */
  pct: number
}

export interface JourneyRow {
  id: string
  kind: JourneyKind
  employeeId: string
  employeeName: string
  employeeNo: string
  jobTitle: string
  departmentId: string | null
  departmentName: string | null
  managerName: string | null
  employeeStatus: EmploymentStatus
  templateId: string | null
  templateName: string | null
  /** Hire date (onboarding) or exit date (offboarding). */
  anchorDate: string | null
  status: JourneyStatus
  startedAt: string
  startedByName: string
  completedAt: string | null
  progress: JourneyProgress
  overdue: number
  nextDueDate: string | null
}

export interface JourneyDetail extends JourneyRow {
  items: JourneyItem[]
  /** HR full: add / remove / reassign items, activate, cancel. */
  canManage: boolean
  /** Onboarding: every required item is done (HR may mark the employee active). Offboarding: no blocking item open. */
  canFinish: boolean
  finishBlockers: string[]
}

export interface StartJourneyInput {
  employeeId: string
  kind: JourneyKind
  /** Default: the best-matching active template. */
  templateId?: string | null
}

export interface JourneyItemInput {
  title?: string
  description?: string
  ownerRole?: OwnerRole
  assigneeUserId?: string | null
  dueDate?: string
  dueOffsetDays?: number
  required?: boolean
  action?: ItemAction | null
}

/** GET /hr/journeys/my-tasks: open (and recently done) items assigned to the caller, any role. */
export interface MyJourneyTask {
  journeyId: string
  journeyKind: JourneyKind
  employeeId: string
  employeeName: string
  /** The caller is the person joining / leaving. */
  self: boolean
  item: JourneyItem
}

export interface JourneyOptions {
  templates: { id: string; name: string; kind: JourneyKind }[]
  /** Users HR can assign items to (active users of the company). */
  assignees: { id: string; name: string; role: string }[]
  departments: { id: string; name: string }[]
  courses: { id: string; title: string }[]
}
