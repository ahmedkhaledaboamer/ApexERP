import type { Employee, EmploymentStatus, EmploymentType, Gender } from './types'

/**
 * HR › Employees, Employee contracts and Company assets (the "people" sections). Built on the shared core
 * (types.ts: Employee). UI camelCase; the API speaks snake_case through src/shared/api/hrMappers.ts
 * (docs/API.md › HR).
 *
 * Sensitive values never travel in full in a list, a detail or an export:
 *   - document numbers (passport, Emirates ID / Iqama, residency, labour card…) → `numberMasked` ("•••• 1234");
 *     HR full can reveal one on demand (POST /hr/documents/:id/reveal, audited);
 *   - the IBAN → `bank.ibanMasked`; HR full reveals it the same way (POST /hr/employees/:id/reveal);
 *   - contract pay (basic salary + allowances) → only HR full and the employee themself; everyone else gets
 *     `salaryVisible: false` and null amounts (the screens show "•••").
 */

/** What the caller's HR scope lets them see (PERMISSION_MATRIX `hr`). */
export type HrAccess = 'full' | 'team' | 'own'

/* ---------------- Documents ---------------- */

export type DocumentType =
  | 'passport'
  | 'residence_visa'
  | 'emirates_id'
  | 'iqama'
  | 'labour_card'
  | 'work_permit'
  | 'medical_insurance'
  | 'driving_license'
  | 'other'

export const DOCUMENT_TYPES: DocumentType[] = ['passport', 'residence_visa', 'emirates_id', 'iqama', 'labour_card', 'work_permit', 'medical_insurance', 'driving_license', 'other']
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  passport: 'Passport',
  residence_visa: 'Residence visa',
  emirates_id: 'Emirates ID',
  iqama: 'Iqama',
  labour_card: 'Labour card',
  work_permit: 'Work permit',
  medical_insurance: 'Medical insurance',
  driving_license: 'Driving license',
  other: 'Other',
}

/** `expiring`: expires within EXPIRY_ALERT_DAYS (company-local days); `expired`: past its expiry date. */
export type DocumentStatus = 'valid' | 'expiring' | 'expired'
export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = { valid: 'Valid', expiring: 'Expiring', expired: 'Expired' }
export const EXPIRY_ALERT_DAYS = 60

/** An uploaded file (mocked: metadata, plus a small data URL preview). Counted against the plan's storage. */
export interface HrFile {
  name: string
  sizeBytes: number
  mimeType: string
  /** A data URL for small files (≤ 256 KB), null otherwise (metadata only). */
  url: string | null
}

export interface EmployeeDocument {
  id: string
  employeeId: string
  type: DocumentType
  /** "•••• 1234": the number is never served in full (reveal: HR full only). */
  numberMasked: string
  issueDate: string | null
  expiryDate: string | null
  /** ISO 3166-1 alpha-2. */
  issuingCountry: string
  file: HrFile | null
  notes: string
  status: DocumentStatus
  /** Company-local days until the expiry date (negative once expired); null without an expiry date. */
  daysToExpiry: number | null
  createdAt: string
  updatedAt: string
}

export interface DocumentInput {
  type: DocumentType
  /** The full number (write only). Omitted on update = keep the stored one. */
  number?: string
  issueDate: string | null
  expiryDate: string | null
  issuingCountry: string
  file?: HrFile | null
  notes?: string
}

/* ---------------- Employees ---------------- */

export interface EmergencyContact {
  name: string
  relation: string
  phone: string
}
export interface EmployeeAddress {
  line1: string
  city: string
  country: string
}
export interface BankDetails {
  bankName: string
  accountName: string
  /** "•••• 3456" or '' when none is stored. */
  ibanMasked: string
}

/** A row of the Employees list. */
export interface EmployeeRow extends Employee {
  departmentName: string | null
  managerName: string | null
  /** A system user is linked (userId). */
  hasLogin: boolean
  /** Worst document state of the employee (expired > expiring), for the alert badge. */
  docAlert: 'expiring' | 'expired' | null
  docAlertCount: number
}

export interface LinkedUser {
  id: string
  name: string
  email: string
  role: string
  active: boolean
}

export interface EmployeeActivity {
  id: string
  at: string
  actorName: string
  action: string
  summary: string
}

export type OffboardingStepKey = 'assets' | 'login' | 'settlement'
export interface OffboardingStep {
  key: OffboardingStepKey
  label: string
  done: boolean
  detail: string
  /** A step that must be done before the offboarding can be completed. */
  blocking: boolean
}
export interface OffboardingState {
  startedAt: string
  completedAt: string | null
  steps: OffboardingStep[]
  canComplete: boolean
}

export interface EmployeeDetail extends EmployeeRow {
  emergencyContact: EmergencyContact
  address: EmployeeAddress
  /** Null for team viewers (department heads). */
  bank: BankDetails | null
  documents: EmployeeDocument[]
  contracts: EmployeeContract[]
  assets: AssetRow[]
  activity: EmployeeActivity[]
  offboarding: OffboardingState | null
  linkedUser: LinkedUser | null
  access: HrAccess
  /** HR full: edit, documents, contracts, assets, offboarding, reveal. */
  canManage: boolean
}

export interface EmployeeInput {
  fullName: string
  jobTitle: string
  /** Optional, in Arabic letters ('' clears it). */
  fullNameAr?: string
  jobTitleAr?: string
  departmentId: string | null
  managerId: string | null
  email: string
  mobile: string
  nationality: string
  gender: Gender | null
  dateOfBirth: string | null
  hireDate: string
  employmentType: EmploymentType
  status: EmploymentStatus
  exitDate: string | null
  /** Link an existing system user (create only; later through link-user). */
  userId?: string | null
  emergencyContact?: Partial<EmergencyContact>
  address?: Partial<EmployeeAddress>
  /** `iban` is write-only; omitted = keep, '' = remove. */
  bank?: { bankName?: string; accountName?: string; iban?: string }
}

/** Users of the company that no employee links yet (link / invite pickers). */
export interface UnlinkedUser {
  id: string
  name: string
  email: string
  role: string
}

/** One export row (HR full): no document numbers, no bank details, no pay. */
export interface EmployeeExportRow {
  employeeNo: string
  fullName: string
  jobTitle: string
  department: string
  manager: string
  nationality: string
  hireDate: string
  status: string
  employmentType: string
  email: string
  mobile: string
  documents: string
}

/* ---------------- Contracts ---------------- */

export type ContractType = 'unlimited' | 'limited' | 'part_time' | 'internship' | 'consultancy'
export const CONTRACT_TYPES: ContractType[] = ['unlimited', 'limited', 'part_time', 'internship', 'consultancy']
export const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  unlimited: 'Unlimited',
  limited: 'Limited (fixed term)',
  part_time: 'Part time',
  internship: 'Internship',
  consultancy: 'Consultancy',
}

export type ContractStatus = 'draft' | 'active' | 'ended' | 'terminated' | 'renewed'
export const CONTRACT_STATUSES: ContractStatus[] = ['draft', 'active', 'ended', 'terminated', 'renewed']
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  ended: 'Ended',
  terminated: 'Terminated',
  renewed: 'Renewed',
}

export interface EmployeeContract {
  id: string
  employeeId: string
  employeeName: string
  employeeNo: string
  type: ContractType
  startDate: string
  endDate: string | null
  probationMonths: number
  probationEndDate: string | null
  noticeDays: number
  hoursPerWeek: number
  /** False for team viewers: amounts are null (shown "•••"). */
  salaryVisible: boolean
  basicSalary: number | null
  housingAllowance: number | null
  transportAllowance: number | null
  otherAllowance: number | null
  totalSalary: number | null
  currency: string
  status: ContractStatus
  signedDate: string | null
  file: HrFile | null
  notes: string
  renewedFromId: string | null
  renewedToId: string | null
  /** Active and the probation end is today or later. */
  inProbation: boolean
  /** Company-local days to the end date (active contracts with an end date), else null. */
  daysToEnd: number | null
  createdAt: string
  updatedAt: string
}

export interface ContractInput {
  employeeId: string
  type: ContractType
  startDate: string
  endDate: string | null
  probationMonths: number
  noticeDays: number
  hoursPerWeek: number
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowance: number
  currency: string
  status: ContractStatus
  signedDate: string | null
  file?: HrFile | null
  notes?: string
}

/** Renew: a new contract from the old one's terms (overrides optional); the old one becomes `renewed`. */
export type RenewInput = Partial<Omit<ContractInput, 'employeeId' | 'status'>>

/* ---------------- Assets ---------------- */

export type AssetCategory = 'laptop' | 'phone' | 'tablet' | 'vehicle' | 'sim' | 'access_card' | 'furniture' | 'other'
export const ASSET_CATEGORIES: AssetCategory[] = ['laptop', 'phone', 'tablet', 'vehicle', 'sim', 'access_card', 'furniture', 'other']
export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  laptop: 'Laptop',
  phone: 'Phone',
  tablet: 'Tablet',
  vehicle: 'Vehicle',
  sim: 'SIM card',
  access_card: 'Access card',
  furniture: 'Furniture',
  other: 'Other',
}

export type AssetStatus = 'in_stock' | 'assigned' | 'in_repair' | 'retired' | 'lost'
export const ASSET_STATUSES: AssetStatus[] = ['in_stock', 'assigned', 'in_repair', 'retired', 'lost']
export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_stock: 'In stock',
  assigned: 'Assigned',
  in_repair: 'In repair',
  retired: 'Retired',
  lost: 'Lost',
}

export type AssetCondition = 'new' | 'good' | 'fair' | 'poor' | 'damaged'
export const ASSET_CONDITIONS: AssetCondition[] = ['new', 'good', 'fair', 'poor', 'damaged']
export const ASSET_CONDITION_LABEL: Record<AssetCondition, string> = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor', damaged: 'Damaged' }

export const WARRANTY_ALERT_DAYS = 30

export interface AssetAssignment {
  id: string
  employeeId: string
  employeeName: string
  assignedDate: string
  assignedCondition: AssetCondition
  handoverNote: string
  returnedDate: string | null
  returnedCondition: AssetCondition | null
  returnNote: string
  /** Closed by "mark lost" instead of a return. */
  lost: boolean
}

export interface AssetRow {
  id: string
  tag: string
  name: string
  category: AssetCategory
  brand: string
  model: string
  serial: string
  purchaseDate: string | null
  cost: number | null
  currency: string
  condition: AssetCondition
  status: AssetStatus
  warrantyEnd: string | null
  assignedToId: string | null
  assignedToName: string | null
  assignedDate: string | null
  notes: string
}

export interface AssetDetail extends AssetRow {
  history: AssetAssignment[]
  canManage: boolean
}

export interface AssetInput {
  tag: string
  name: string
  category: AssetCategory
  brand: string
  model: string
  serial: string
  purchaseDate: string | null
  cost: number | null
  currency: string
  condition: AssetCondition
  /** in_stock | in_repair | retired (assigned / lost go through assign / lost). */
  status?: AssetStatus
  warrantyEnd: string | null
  notes?: string
}

export interface AssignInput {
  employeeId: string
  date: string
  condition: AssetCondition
  note?: string
}
export interface ReturnInput {
  date: string
  condition: AssetCondition
  note?: string
}
