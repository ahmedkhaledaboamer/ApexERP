/**
 * HR › Discipline (warnings & disciplinary actions) and Policies (publish, acknowledge, re-acknowledge)
 * (docs/API.md › HR › Discipline, Policies). camelCase here; snake_case on the wire (src/shared/api/hrComplianceMappers.ts).
 */
import type { Role } from '@/shared/types'
import type { HrFile } from '@/modules/hr/peopleTypes'
import type { DigitStyle, LetterLanguage, Letterhead } from '@/modules/hr/selfservice/types'

/* ======================= Discipline ======================= */

export type DisciplinaryType = 'verbal_warning' | 'written_warning' | 'final_warning' | 'suspension_paid' | 'suspension_unpaid' | 'deduction'
export const DISCIPLINARY_TYPES: DisciplinaryType[] = ['verbal_warning', 'written_warning', 'final_warning', 'suspension_paid', 'suspension_unpaid', 'deduction']
export const DISCIPLINARY_TYPE_LABEL: Record<DisciplinaryType, string> = {
  verbal_warning: 'Verbal warning',
  written_warning: 'Written warning',
  final_warning: 'Final warning',
  suspension_paid: 'Suspension with pay',
  suspension_unpaid: 'Suspension without pay',
  deduction: 'Salary deduction',
}
export const DISCIPLINARY_TYPE_LABEL_AR: Record<DisciplinaryType, string> = {
  verbal_warning: 'إنذار شفهي',
  written_warning: 'إنذار كتابي',
  final_warning: 'إنذار نهائي',
  suspension_paid: 'إيقاف عن العمل مع الأجر',
  suspension_unpaid: 'إيقاف عن العمل بدون أجر',
  deduction: 'خصم من الراتب',
}

export type DisciplinaryCategory = 'attendance' | 'conduct' | 'performance' | 'policy_breach' | 'safety' | 'other'
export const DISCIPLINARY_CATEGORIES: DisciplinaryCategory[] = ['attendance', 'conduct', 'performance', 'policy_breach', 'safety', 'other']
export const DISCIPLINARY_CATEGORY_LABEL: Record<DisciplinaryCategory, string> = {
  attendance: 'Attendance',
  conduct: 'Conduct',
  performance: 'Performance',
  policy_breach: 'Policy breach',
  safety: 'Health & safety',
  other: 'Other',
}
export const DISCIPLINARY_CATEGORY_LABEL_AR: Record<DisciplinaryCategory, string> = {
  attendance: 'الحضور والانصراف',
  conduct: 'السلوك',
  performance: 'الأداء',
  policy_breach: 'مخالفة سياسات الشركة',
  safety: 'الصحة والسلامة',
  other: 'أخرى',
}

/** How long a record stays "active" on the file (months; 0 = never lapses). */
export const EXPIRY_MONTH_OPTIONS = [0, 3, 6, 12, 24] as const

/** `expired`: past its expiry date (computed with the company's calendar day); `withdrawn`: rescinded by HR. */
export type DisciplinaryStatus = 'active' | 'expired' | 'withdrawn'
export const DISCIPLINARY_STATUS_LABEL: Record<DisciplinaryStatus, string> = { active: 'Active', expired: 'Lapsed', withdrawn: 'Withdrawn' }

/** The employee's answer: pending → acknowledged (optional comment) or appealed (comment required). */
export type AckStatus = 'pending' | 'acknowledged' | 'appealed'
export const ACK_STATUS_LABEL: Record<AckStatus, string> = { pending: 'Waiting for the employee', acknowledged: 'Acknowledged', appealed: 'Appealed' }

export interface DisciplinaryAttachment extends HrFile {
  id: string
}

export interface DisciplinaryRow {
  id: string
  caseNo: string
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  type: DisciplinaryType
  category: DisciplinaryCategory
  incidentDate: string
  issueDate: string
  expiresOn: string | null
  status: DisciplinaryStatus
  ackStatus: AckStatus
  ackAt: string | null
  issuedByName: string
  attachmentCount: number
}

export interface DisciplinaryDetail extends DisciplinaryRow {
  description: string
  /** Optional Arabic description (the Arabic warning letter falls back to `description`). */
  descriptionAr: string
  expiryMonths: number
  suspensionDays: number | null
  suspensionStart: string | null
  /** Deductions: HR full and the employee only (null for a department head, like pay elsewhere). */
  deductionAmount: number | null
  deductionMonth: string | null
  currency: string | null
  /** The payroll adjustment it created (deductions). */
  adjustmentId: string | null
  employeeComment: string
  attachments: DisciplinaryAttachment[]
  withdrawnAt: string | null
  withdrawnByName: string | null
  withdrawReason: string
  /** The employee's escalation picture (active records only). */
  escalation: EscalationHint
  canAcknowledge: boolean
  canWithdraw: boolean
  canManage: boolean
}

export interface EscalationHint {
  activeVerbal: number
  activeWritten: number
  activeFinal: number
  /** The suggested next step if another issue happens, or null. */
  suggestion: DisciplinaryType | null
  message: string | null
}

export interface DisciplinaryInput {
  employeeId: string
  type: DisciplinaryType
  category: DisciplinaryCategory
  incidentDate: string
  description: string
  descriptionAr?: string
  /** Default by type: verbal 6, written / final 12, others 0. */
  expiryMonths?: number
  suspensionDays?: number | null
  suspensionStart?: string | null
  deductionAmount?: number | null
  /** yyyy-MM; default the current company month. */
  deductionMonth?: string | null
  attachments?: HrFile[]
}

export interface AcknowledgeInput {
  comment?: string
  /** Disagree: the comment (required) is the appeal. */
  appeal?: boolean
}

/** The warning letter generated from a record (EN / AR / bilingual), printable. */
export interface WarningLetter {
  language: LetterLanguage
  digits: DigitStyle
  caseNo: string
  issueDate: string
  issueDateAr: string | null
  title: string
  titleAr: string | null
  body: string
  bodyAr: string | null
  employeeName: string
  signatoryName: string
  signatoryTitle: string
  letterhead: Letterhead
}

/* ======================= Policies ======================= */

export type PolicyCategory = 'code_of_conduct' | 'it_security' | 'data_protection' | 'health_safety' | 'leave' | 'expenses' | 'other'
export const POLICY_CATEGORIES: PolicyCategory[] = ['code_of_conduct', 'it_security', 'data_protection', 'health_safety', 'leave', 'expenses', 'other']
export const POLICY_CATEGORY_LABEL: Record<PolicyCategory, string> = {
  code_of_conduct: 'Code of conduct',
  it_security: 'IT & security',
  data_protection: 'Data protection',
  health_safety: 'Health & safety',
  leave: 'Leave & time off',
  expenses: 'Expenses & travel',
  other: 'Other',
}

export type PolicyStatus = 'draft' | 'published' | 'archived'
export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' }

export type AudienceKind = 'all' | 'departments' | 'roles'
export interface PolicyAudience {
  kind: AudienceKind
  /** `departments`: these departments and their sub-departments. */
  departmentIds: string[]
  roles: Role[]
}

export interface PolicyVersion {
  version: number
  /** Light formatting: "# heading", "- bullet", **bold** (rendered as text elements, never HTML). */
  body: string
  file: HrFile | null
  effectiveDate: string
  changeNote: string
  publishedAt: string
  publishedByName: string
}

export interface PolicyDraft {
  body: string
  file: HrFile | null
  effectiveDate: string
  changeNote: string
}

export interface PolicyStats {
  /** Employees in the audience (with a login, not terminated). */
  audience: number
  acknowledged: number
  pending: number
  /** 0–100, one decimal. */
  pct: number
}

export interface PolicyRow {
  id: string
  title: string
  category: PolicyCategory
  status: PolicyStatus
  /** The current published version (0 = never published). */
  version: number
  effectiveDate: string | null
  audience: PolicyAudience
  audienceLabel: string
  hasDraft: boolean
  publishedAt: string | null
  stats: PolicyStats
  updatedAt: string
}

export interface PolicyDetail extends PolicyRow {
  /** The current version's text / file (for HR: also the draft). */
  current: PolicyVersion | null
  draft: PolicyDraft | null
  versions: Omit<PolicyVersion, 'body' | 'file'>[]
  canManage: boolean
}

export interface DepartmentAckRow {
  departmentId: string | null
  departmentName: string
  audience: number
  acknowledged: number
  pct: number
}

export interface PolicyAckEmployee {
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  acknowledged: boolean
  acknowledgedAt: string | null
  /** The latest version this employee acknowledged (an older one = needs to re-acknowledge). */
  acknowledgedVersion: number | null
}

export interface PolicyStatusReport {
  policyId: string
  version: number
  stats: PolicyStats
  byDepartment: DepartmentAckRow[]
  employees: PolicyAckEmployee[]
}

export interface PolicyInput {
  title?: string
  category?: PolicyCategory
  body?: string
  file?: HrFile | null
  effectiveDate?: string
  changeNote?: string
  audience?: Partial<PolicyAudience>
}

/** A policy as the employee sees it (My HR). */
export interface MyPolicy {
  id: string
  title: string
  category: PolicyCategory
  version: number
  effectiveDate: string
  publishedAt: string
  body: string
  file: HrFile | null
  changeNote: string
  acknowledged: boolean
  acknowledgedAt: string | null
  /** They acknowledged an older version: this one needs a new acknowledgement. */
  reacknowledge: boolean
}

export interface PolicyExportRow {
  employeeNo: string
  employeeName: string
  department: string
  policy: string
  version: number
  acknowledged: string
  acknowledgedAt: string
}
