/**
 * HR › Salary Management (payroll). UI camelCase; the API speaks snake_case through
 * src/shared/api/hrPayrollMappers.ts (mechanical, deep). docs/API.md › HR › Salary management.
 *
 * Pay components (basic, housing, transport, other) come from the employee's ACTIVE CONTRACT
 * (peopleTypes.ts EmployeeContract); payroll never stores a second copy of them. Money is rounded
 * to 2 decimals per item (company currency AED / SAR). Sensitive identifiers (IBAN, WPS person id,
 * national id / iqama) are stored in full and served masked ("•••• 1234"); HR full reveals one
 * through an audited POST. The bank files (WPS SIF, Mudad CSV) are a POST that answers the file.
 */

export type PayCountry = 'AE' | 'SA'
export type PayMethod = 'bank' | 'cash' | 'cheque'
export const PAY_METHODS: PayMethod[] = ['bank', 'cash', 'cheque']
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { bank: 'Bank transfer', cash: 'Cash', cheque: 'Cheque' }

/** What the social insurance base is made of (UAE GPSSA / KSA GOSI "contributory wage"). */
export type SiBase = 'basic_housing' | 'basic' | 'gross'
export const SI_BASE_LABEL: Record<SiBase, string> = { basic_housing: 'Basic + housing', basic: 'Basic only', gross: 'Gross fixed pay' }

/** Wage basis of the KSA end-of-service award. */
export type GratuityBasis = 'basic_housing' | 'basic'

/* ---------------- Settings ---------------- */

export interface SocialInsuranceRates {
  /** Nationals (UAE: GPSSA; KSA: Saudi GOSI). Percent of the contributory base. */
  nationalEmployeeRate: number
  nationalEmployerRate: number
  /** Everyone else (UAE: none; KSA: occupational hazards, employer only). */
  expatEmployeeRate: number
  expatEmployerRate: number
  base: SiBase
  /** Monthly cap of the contributory base (KSA 45,000 SAR); null = no cap. */
  cap: number | null
}

export interface PaySettings {
  country: PayCountry
  currency: string
  /** Day of the month salaries are paid (1–28). */
  payDay: number
  /** Last day of the month whose attendance / leave counts (1–31, 31 = month end). */
  cutoffDay: number
  /** UAE WPS: the employer (MOL establishment) id, 13 digits. */
  wpsEmployerId: string
  /** UAE WPS: routing code of the employer's agent / bank, 9 digits. */
  wpsRoutingCode: string
  /** KSA Mudad: the establishment number (e.g. 7-0012345). */
  mudadEstablishmentNo: string
  socialInsurance: SocialInsuranceRates
  /** Deduct unexcused absence days (working days without attendance, leave or holiday). */
  deductAbsences: boolean
  /** Pay overtime from attendance (minutes beyond the shift) at `overtimeMultiplier` × the hourly basic. */
  overtimeEnabled: boolean
  overtimeMultiplier: number
  /** KSA end-of-service wage basis. */
  gratuityBasis: GratuityBasis
  /** The rates above are defaults HR has to confirm (not legal advice). */
  defaultsConfirmed: boolean
  defaultsConfirmedAt: string | null
  defaultsConfirmedByName: string | null
  /** Built-in defaults of the company's country, for "reset". */
  countryDefaults: SocialInsuranceRates
  updatedAt: string
}

export type PaySettingsInput = Partial<Omit<PaySettings, 'country' | 'currency' | 'countryDefaults' | 'updatedAt' | 'defaultsConfirmedAt' | 'defaultsConfirmedByName' | 'socialInsurance'>> & {
  socialInsurance?: Partial<SocialInsuranceRates>
}

/* ---------------- Payroll profiles ---------------- */

export interface PayrollProfile {
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  nationality: string
  status: string
  payMethod: PayMethod
  /** UAE: WPS person id (14 digits); KSA: national id / iqama (10 digits). "•••• 1234" or ''. */
  personIdMasked: string
  /** Employee bank's routing code (UAE WPS agent id); '' = the company's. */
  bankRoutingCode: string
  bankName: string
  ibanMasked: string
  /** From the active contract (null without one). */
  contractId: string | null
  basicSalary: number | null
  housingAllowance: number | null
  transportAllowance: number | null
  otherAllowance: number | null
  totalSalary: number | null
  currency: string
  /** What still blocks a clean payroll line: no_contract, no_iban, no_person_id. */
  issues: string[]
}

export interface PayrollProfileInput {
  payMethod?: PayMethod
  /** Write only; omitted = keep, '' = remove. */
  personId?: string
  bankRoutingCode?: string
}

/* ---------------- Adjustments and loans ---------------- */

/** `commission`: pushed by Accounts & finance › Commissions (approved statement), never typed in HR (not in ADJUSTMENT_KINDS). */
/** `reimbursement`: an approved expense claim paid through payroll (Accounts & finance › Expenses); not taxable, not in gross or the social-insurance base, paid with the net; never typed in HR. */
export type AdjustmentKind = 'allowance' | 'bonus' | 'deduction' | 'commission' | 'reimbursement'
export const ADJUSTMENT_KINDS: AdjustmentKind[] = ['allowance', 'bonus', 'deduction']
export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = { allowance: 'Allowance', bonus: 'Bonus', deduction: 'Deduction', commission: 'Commission', reimbursement: 'Reimbursement' }
export type Recurrence = 'once' | 'monthly'

export interface PayAdjustment {
  id: string
  employeeId: string
  employeeName: string
  kind: AdjustmentKind
  label: string
  amount: number
  recurrence: Recurrence
  /** First (or only) month, yyyy-MM. */
  month: string
  /** Last month of a recurring one (null: until stopped). */
  endMonth: string | null
  notes: string
  /** Paid runs that included it (a paid one-off can't be changed any more). */
  paidRunIds: string[]
  locked: boolean
  createdAt: string
}

export interface AdjustmentInput {
  employeeId?: string
  kind?: AdjustmentKind
  label?: string
  amount?: number
  recurrence?: Recurrence
  month?: string
  endMonth?: string | null
  notes?: string
}

export type LoanKind = 'advance' | 'loan'
export type LoanStatus = 'active' | 'repaid' | 'cancelled' | 'settled'
export const LOAN_STATUS_LABEL: Record<LoanStatus, string> = { active: 'In repayment', repaid: 'Repaid', cancelled: 'Cancelled', settled: 'Settled at exit' }

export interface LoanRepayment {
  runId: string | null
  month: string
  amount: number
  /** `run` (payroll deduction) or `settlement` (final settlement). */
  source: 'run' | 'settlement'
}

export interface LoanInstallment {
  month: string
  amount: number
  /** paid in a paid run, planned otherwise. */
  status: 'paid' | 'planned'
}

export interface PayLoan {
  id: string
  employeeId: string
  employeeName: string
  kind: LoanKind
  principal: number
  installmentAmount: number
  /** First deduction month, yyyy-MM. */
  startMonth: string
  reason: string
  status: LoanStatus
  repaid: number
  remaining: number
  repayments: LoanRepayment[]
  /** The full schedule: paid installments, then the planned ones until repaid. */
  schedule: LoanInstallment[]
  createdAt: string
}

export interface LoanInput {
  employeeId?: string
  kind?: LoanKind
  principal?: number
  installmentAmount?: number
  startMonth?: string
  reason?: string
  /** PATCH: `cancelled` (nothing repaid yet) */
  status?: LoanStatus
}

/* ---------------- Runs ---------------- */

export type RunStatus = 'draft' | 'calculated' | 'approved' | 'paid'
export const RUN_STATUS_LABEL: Record<RunStatus, string> = { draft: 'Draft', calculated: 'Awaiting approval', approved: 'Approved', paid: 'Paid' }

/** `reimbursement`: expense claims repaid with the salary (added to net, not to gross). */
export type PayItemType = 'earning' | 'deduction' | 'employer' | 'reimbursement'
export interface PayItem {
  code: string
  label: string
  type: PayItemType
  amount: number
  /** e.g. "2 days × 333.33" */
  note: string
}

export type WarningCode = 'no_contract' | 'no_iban' | 'no_person_id' | 'negative_net'
export const WARNING_LABEL: Record<WarningCode, string> = {
  no_contract: 'No active contract',
  no_iban: 'Missing IBAN',
  no_person_id: 'Missing WPS / national id',
  negative_net: 'Negative net pay',
}
export interface LineWarning {
  code: WarningCode
  message: string
  acknowledged: boolean
}

export interface PayLine {
  /** Also the payslip id. */
  id: string
  runId: string
  employeeId: string
  employeeName: string
  employeeNo: string
  jobTitle: string
  departmentId: string | null
  departmentName: string | null
  nationality: string
  contractId: string | null
  payMethod: PayMethod
  bankName: string
  ibanMasked: string
  /** First / last day paid in the month (company calendar). */
  payStart: string | null
  payEnd: string | null
  daysInMonth: number
  paidDays: number
  unpaidLeaveDays: number
  absenceDays: number
  leaveDays: number
  overtimeHours: number
  items: PayItem[]
  basic: number
  housing: number
  gross: number
  totalDeductions: number
  net: number
  employeeSocialInsurance: number
  employerSocialInsurance: number
  employerCost: number
  /** Fixed / variable split of the net (WPS). */
  fixedPay: number
  variablePay: number
  warnings: LineWarning[]
}

export interface RunTotals {
  headcount: number
  gross: number
  deductions: number
  net: number
  employerSocialInsurance: number
  employerCost: number
}

export interface PayrollRunRow {
  id: string
  month: string
  status: RunStatus
  currency: string
  periodStart: string
  periodEnd: string
  payDate: string
  totals: RunTotals
  openWarnings: number
  calculatedAt: string | null
  calculatedByName: string | null
  approvedAt: string | null
  approvedByName: string | null
  paidAt: string | null
  paidByName: string | null
  createdAt: string
}

export interface PayrollRunDetail extends PayrollRunRow {
  lines: PayLine[]
  calculatedBy: string | null
  /** For the caller: maker–checker. */
  canCalculate: boolean
  canApprove: boolean
  /** Why approve is not possible now (null when it is). */
  approveBlockedReason: string | null
  canPay: boolean
  canReopen: boolean
  canExport: boolean
  exports: { at: string; byName: string; format: BankFileFormat; count: number }[]
  notes: string
}

export type BankFileFormat = 'wps' | 'mudad'
export interface BankFile {
  format: BankFileFormat
  fileName: string
  mimeType: string
  /** The file itself (full IBANs and ids: never stored in a list, never a GET). */
  content: string
  count: number
  total: number
  /** Lines not in the file (cash / cheque, missing IBAN or id, zero net). */
  skipped: { employeeId: string; employeeName: string; reason: string }[]
}

/* ---------------- Payslips ---------------- */

export interface PayslipRow {
  id: string
  runId: string
  month: string
  employeeId: string
  employeeName: string
  employeeNo: string
  departmentName: string | null
  gross: number
  totalDeductions: number
  net: number
  currency: string
  payDate: string
  paidAt: string | null
}

export interface Payslip extends PayslipRow {
  company: { name: string; country: string }
  jobTitle: string
  nationality: string
  payMethod: PayMethod
  bankName: string
  ibanMasked: string
  periodStart: string
  periodEnd: string
  payStart: string | null
  payEnd: string | null
  daysInMonth: number
  paidDays: number
  unpaidLeaveDays: number
  absenceDays: number
  overtimeHours: number
  items: PayItem[]
  employerSocialInsurance: number
}

/* ---------------- Summary ---------------- */

export interface PayrollSummary {
  currency: string
  months: { month: string; runId: string; status: RunStatus; headcount: number; gross: number; deductions: number; net: number; employerCost: number }[]
  departments: { departmentId: string | null; departmentName: string; byMonth: Record<string, number>; total: number; headcount: number }[]
  totals: { gross: number; deductions: number; net: number; employerCost: number; headcountLatest: number }
}

/* ---------------- Gratuity and final settlement ---------------- */

export type ExitReason = 'resignation' | 'termination' | 'contract_end'
export const EXIT_REASONS: ExitReason[] = ['resignation', 'termination', 'contract_end']
export const EXIT_REASON_LABEL: Record<ExitReason, string> = { resignation: 'Resignation', termination: 'Termination by the employer', contract_end: 'End of contract' }

export interface GratuityResult {
  country: PayCountry
  serviceDays: number
  /** Unpaid leave days taken out of the service (UAE). */
  excludedDays: number
  years: number
  /** Monthly wage the award is based on. */
  monthlyWage: number
  dailyWage: number
  /** UAE: days of wage for the first 5 years / beyond. KSA: months of wage. */
  firstPeriodUnits: number
  laterPeriodUnits: number
  /** Before the resignation factor and the cap. */
  fullAmount: number
  /** KSA resignation: 0, 1/3, 2/3 or 1. UAE: always 1. */
  factor: number
  /** UAE: the 2-year cap applied. */
  capped: boolean
  amount: number
  eligible: boolean
  explanation: string[]
}

export type SettlementStatus = 'draft' | 'paid'

export interface SettlementAdjustment {
  label: string
  /** Positive adds, negative deducts. */
  amount: number
}

export interface FinalSettlement {
  id: string
  employeeId: string
  employeeName: string
  employeeNo: string
  hireDate: string
  exitDate: string
  reason: ExitReason
  currency: string
  basicSalary: number
  housingAllowance: number
  gratuity: GratuityResult
  /** Calendar days from the day after the last paid run through the exit date. */
  unpaidSalaryFrom: string | null
  unpaidSalaryDays: number
  unpaidSalary: number
  leaveDays: number
  leaveEncashment: number
  loanBalance: number
  adjustments: SettlementAdjustment[]
  total: number
  status: SettlementStatus
  notes: string
  createdAt: string
  createdByName: string | null
  paidAt: string | null
  paidByName: string | null
}

export interface SettlementInput {
  employeeId?: string
  reason?: ExitReason
  exitDate?: string
  adjustments?: SettlementAdjustment[]
  notes?: string
}
