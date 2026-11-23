/**
 * HR › Self-service ("My HR" portal, profile change requests) and HR letters (docs/API.md › HR › Self-service,
 * HR letters). camelCase here; snake_case on the wire (src/shared/api/hrSelfServiceMappers.ts).
 */
import type { Scope } from '@/shared/types'
import type { EmploymentStatus, EmploymentType } from '@/modules/hr/types'
import type { AssetRow, BankDetails, EmergencyContact, EmployeeAddress, EmployeeContract, EmployeeDocument } from '@/modules/hr/peopleTypes'
import type { PayslipRow } from '@/modules/hr/payroll/types'
import type { MyTraining } from '@/modules/hr/trainingTypes'
import type { InterviewCard } from '@/modules/hr/recruitmentTypes'

/* ---------------- profile change requests ---------------- */

export type ProfileChangeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export const PROFILE_CHANGE_STATUS_LABEL: Record<ProfileChangeStatus, string> = {
  pending: 'Waiting for HR',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export type ProfileChangeField = 'emergency_contact' | 'address' | 'mobile' | 'bank'
export const PROFILE_CHANGE_FIELD_LABEL: Record<ProfileChangeField, string> = {
  emergency_contact: 'Emergency contact',
  address: 'Address',
  mobile: 'Mobile',
  bank: 'Bank account',
}

/** Values of a change request as served: the IBAN is masked ("•••• 1234") like everywhere else. */
export interface ProfileChangeValues {
  emergencyContact?: EmergencyContact
  address?: EmployeeAddress
  mobile?: string
  bank?: BankDetails
}

export interface ProfileChangeRequest {
  id: string
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  fields: ProfileChangeField[]
  /** The values when the request was made. */
  current: ProfileChangeValues
  proposed: ProfileChangeValues
  /** The request changes the IBAN (HR approval is audited; HR full may reveal the new one). */
  ibanChange: boolean
  note: string
  status: ProfileChangeStatus
  requestedByName: string
  createdAt: string
  decidedByName: string | null
  decidedAt: string | null
  decisionComment: string
  canDecide: boolean
  canCancel: boolean
  canReveal: boolean
}

export interface ProfileChangeInput {
  emergencyContact?: Partial<EmergencyContact>
  address?: Partial<EmployeeAddress>
  mobile?: string
  /** `iban` is write-only (served masked). */
  bank?: { bankName?: string; accountName?: string; iban?: string }
  note?: string
}

/* ---------------- letters ---------------- */

export type LetterCode = 'salary_certificate' | 'salary_transfer' | 'employment_certificate' | 'experience_letter' | 'noc'
export const LETTER_CODES: LetterCode[] = ['salary_certificate', 'salary_transfer', 'employment_certificate', 'experience_letter', 'noc']

/** Letter language: English, Arabic (RTL), or both (side by side / stacked on one A4 page). */
export type LetterLanguage = 'en' | 'ar' | 'bilingual'
export const LETTER_LANGUAGES: LetterLanguage[] = ['en', 'ar', 'bilingual']
export const LETTER_LANGUAGE_LABEL: Record<LetterLanguage, string> = { en: 'English', ar: 'Arabic', bilingual: 'Bilingual (English + Arabic)' }
export type BilingualLayout = 'side_by_side' | 'stacked'
export const BILINGUAL_LAYOUTS: BilingualLayout[] = ['side_by_side', 'stacked']
export const BILINGUAL_LAYOUT_LABEL: Record<BilingualLayout, string> = { side_by_side: 'Side by side', stacked: 'Stacked (English, then Arabic)' }
/** Digits in the Arabic text: Western (0-9, default) or Arabic-Indic (٠-٩). */
export type DigitStyle = 'western' | 'arabic'
export const DIGIT_STYLE_LABEL: Record<DigitStyle, string> = { western: 'Western digits (0-9)', arabic: 'Arabic digits (٠-٩)' }

export type NocPurpose = 'travel' | 'visa' | 'other'
export const NOC_PURPOSES: NocPurpose[] = ['travel', 'visa', 'other']
export const NOC_PURPOSE_LABEL: Record<NocPurpose, string> = { travel: 'Travel', visa: 'Visa application', other: 'Other purpose' }

export interface LetterType {
  id: string
  code: LetterCode
  name: string
  description: string
  /** Template text with {{placeholders}} ('' for viewers who can't edit templates). */
  body: string
  /** Salary letters: may show pay (to HR full and the employee only). */
  includesSalary: boolean
  /** Arabic name and template ('' = no Arabic version: Arabic / bilingual requests are refused). */
  nameAr: string
  bodyAr: string
  /** An Arabic template exists (employees can ask for Arabic / bilingual). */
  hasArabic: boolean
  active: boolean
  /** The body still equals the seeded default. */
  isDefault: boolean
  updatedAt: string
  updatedByName: string | null
  /** For the caller as an employee: can they request it now (e.g. an experience letter needs notice / left). */
  available: boolean
  unavailableReason: string | null
}

export interface LetterTypeInput {
  name?: string
  description?: string
  body?: string
  nameAr?: string
  bodyAr?: string
  active?: boolean
}

/** `revoked`: an issued letter HR withdrew (reason, audited); the public verification shows it as revoked. */
export type LetterStatus = 'pending' | 'issued' | 'rejected' | 'cancelled' | 'revoked'
export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = {
  pending: 'Waiting for HR',
  issued: 'Issued',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  revoked: 'Revoked',
}

export interface LetterRequestRow {
  id: string
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  letterTypeId: string
  code: LetterCode
  typeName: string
  includesSalary: boolean
  addressee: string
  purpose: string
  nocPurpose: NocPurpose | null
  languageNote: string
  language: LetterLanguage
  /** Bilingual letters only. */
  layout: BilingualLayout | null
  digits: DigitStyle
  /** Arabic addressee / purpose (optional; the English ones, else an Arabic default, are used). */
  addresseeAr: string
  purposeAr: string
  /** Filed by HR for the employee. */
  onBehalf: boolean
  requestedByName: string
  status: LetterStatus
  createdAt: string
  decidedByName: string | null
  decidedAt: string | null
  rejectionReason: string
  /** HR override of the experience-letter rule (employee not leaving). */
  overrideReason: string
  referenceNo: string | null
  issueDate: string | null
  revokedAt: string | null
  revokedByName: string | null
  revokeReason: string
  canDecide: boolean
  canCancel: boolean
  /** HR full: an issued letter can be revoked. */
  canRevoke: boolean
}

export interface Letterhead {
  name: string
  legalName: string
  addressLines: string[]
  phone: string
  email: string
  website: string
  licenseNo: string
  logoUrl: string | null
  primaryColor: string | null
  /** Company legal name in Arabic (Accounts & finance › Settings), '' when not set. */
  legalNameAr: string
}

export interface IssuedLetter {
  title: string
  referenceNo: string
  issueDate: string
  verificationCode: string
  /** The rendered text (plain text; frozen at issue). '' for an Arabic-only letter. */
  body: string
  /** 'en' for letters issued before languages existed. */
  language: LetterLanguage
  layout: BilingualLayout | null
  digits: DigitStyle
  /** Arabic title and rendered text (RTL, with bidi isolates around Latin values); null for an English letter. */
  titleAr: string | null
  bodyAr: string | null
  /** The issue date written in Arabic (month names; Arabic-Indic digits when chosen). */
  issueDateAr: string | null
  signatoryName: string
  signatoryTitle: string
  letterhead: Letterhead
}

export interface LetterRequestDetail extends LetterRequestRow {
  letter: IssuedLetter | null
}

export interface LetterRequestInput {
  letterTypeId: string
  /** HR full only: file for another employee. */
  employeeId?: string
  addressee?: string
  purpose?: string
  nocPurpose?: NocPurpose | null
  languageNote?: string
  language?: LetterLanguage
  layout?: BilingualLayout | null
  digits?: DigitStyle
  addresseeAr?: string
  purposeAr?: string
  /** HR full only: an experience letter for an employee who isn't leaving. */
  overrideReason?: string
}

export interface LetterDecisionInput {
  reason?: string
  overrideReason?: string
  /** Approve: HR may change the language / layout / digits the employee asked for. */
  language?: LetterLanguage
  layout?: BilingualLayout | null
  digits?: DigitStyle
}

export interface LetterVerification {
  valid: boolean
  /** valid · revoked · not_found (another company's code answers not_found, like an unknown one). */
  status: 'valid' | 'revoked' | 'not_found'
  revokedAt: string | null
  code: string
  referenceNo: string | null
  employeeName: string | null
  employeeNo: string | null
  typeName: string | null
  issueDate: string | null
  issuedByName: string | null
}

/** GET /public/letters/verify: what anyone holding the letter may see (no pay, no personal data, masked name). */
export interface PublicLetterVerification {
  status: 'valid' | 'revoked'
  code: string
  companyName: string
  logoUrl: string | null
  monogram: string
  typeName: string
  referenceNo: string
  issueDate: string
  /** First name + initial ("Noura K."). */
  employeeNameMasked: string
  revokedAt: string | null
}

/* ---------------- HR inbox ---------------- */

export interface SelfServiceInbox {
  counts: { profileChanges: number; letters: number; total: number }
  profileChanges: ProfileChangeRequest[]
  letters: LetterRequestRow[]
}

/* ---------------- My HR portal ---------------- */

export interface MyHrEmployee {
  id: string
  employeeNo: string
  fullName: string
  jobTitle: string
  departmentName: string | null
  managerName: string | null
  email: string
  mobile: string
  nationality: string
  hireDate: string
  status: EmploymentStatus
  employmentType: EmploymentType
  exitDate: string | null
}

export interface MyHr {
  employee: MyHrEmployee
  profile: { emergencyContact: EmergencyContact; address: EmployeeAddress; mobile: string; bank: BankDetails }
  documents: EmployeeDocument[]
  /** The active contract (own pay visible to self), or null. */
  contract: EmployeeContract | null
  assets: AssetRow[]
  /** Paid runs only. */
  payslips: PayslipRow[]
  training: MyTraining
  interviews: InterviewCard[]
  profileChanges: ProfileChangeRequest[]
  letters: LetterRequestRow[]
  letterTypes: LetterType[]
  /** The caller's `hr` scope (links to the HR screens only when not hidden). */
  hrScope: Scope
  today: string
  timezone: string
  currency: string
}
