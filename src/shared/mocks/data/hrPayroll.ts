import type {
  AdjustmentKind,
  BankFileFormat,
  ExitReason,
  GratuityBasis,
  GratuityResult,
  LineWarning,
  LoanKind,
  LoanRepayment,
  LoanStatus,
  PayCountry,
  PayItem,
  PayMethod,
  Recurrence,
  RunStatus,
  SettlementAdjustment,
  SettlementStatus,
  SocialInsuranceRates,
} from '@/modules/hr/payroll/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * HR › Salary Management stores (docs/API.md › HR › Salary management). One array per entity for every
 * company (Tenant rows); ids are globally unique (`PR-`, `PSL-`, `PADJ-`, `PLN-`, `PFS-`), so a foreign id is
 * never an own one. The seed (two companies, different data: paid past months, a draft for the current month,
 * a loan in repayment, an unpaid leave, a mid-month joiner) runs in services/hrPayroll.ts, because it uses the
 * payroll engine.
 *
 *   hr.paySettings        one per company: pay day, cut-off, WPS / Mudad ids, social insurance rates
 *   hr.payrollProfiles    one per employee: pay method, WPS person id / national id (stored full, served masked)
 *   hr.payAdjustments     allowances / bonuses / deductions, one-off or monthly
 *   hr.payLoans           salary advances and loans with their repayments
 *   hr.payrollRuns        monthly runs with their lines (a paid run is immutable)
 *   hr.finalSettlements   end-of-service settlements
 *
 * Pay components are NOT stored here: they come from the employee's active contract (hr.contracts).
 */

export interface PaySettingsRecord {
  country: PayCountry
  currency: string
  payDay: number
  cutoffDay: number
  wpsEmployerId: string
  wpsRoutingCode: string
  mudadEstablishmentNo: string
  socialInsurance: SocialInsuranceRates
  deductAbsences: boolean
  overtimeEnabled: boolean
  overtimeMultiplier: number
  gratuityBasis: GratuityBasis
  defaultsConfirmed: boolean
  defaultsConfirmedAt: string | null
  defaultsConfirmedBy: string | null
  updatedAt: string
}

export interface PayrollProfileRecord {
  employeeId: string
  payMethod: PayMethod
  /** Stored in full (encrypted in the backend); served masked. */
  personId: string
  bankRoutingCode: string
  updatedAt: string
}

export interface AdjustmentRecord {
  id: string
  employeeId: string
  kind: AdjustmentKind
  label: string
  amount: number
  recurrence: Recurrence
  month: string
  endMonth: string | null
  notes: string
  paidRunIds: string[]
  createdAt: string
  createdBy: string | null
}

export interface LoanRecord {
  id: string
  employeeId: string
  kind: LoanKind
  principal: number
  installmentAmount: number
  startMonth: string
  reason: string
  status: LoanStatus
  repayments: LoanRepayment[]
  createdAt: string
  createdBy: string | null
}

export interface PayLineRecord {
  id: string
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
  /** Masked at calculation time (the payslip keeps the account it was paid to). */
  ibanMasked: string
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
  fixedPay: number
  variablePay: number
  warnings: LineWarning[]
  adjustmentIds: string[]
  loanInstallments: { loanId: string; amount: number }[]
  /** "Payslip available" sent to the employee (once). */
  notifiedAt: string | null
}

export interface PayrollRunRecord {
  id: string
  month: string
  status: RunStatus
  currency: string
  periodStart: string
  periodEnd: string
  payDate: string
  lines: PayLineRecord[]
  calculatedAt: string | null
  calculatedBy: string | null
  approvedAt: string | null
  approvedBy: string | null
  paidAt: string | null
  paidBy: string | null
  notes: string
  /** Once-only notification marks (`awaiting`), cleared when the run is reopened. */
  alertMarks: string[]
  exports: { at: string; by: string; format: BankFileFormat; count: number }[]
  createdAt: string
  createdBy: string | null
}

export interface SettlementRecord {
  id: string
  employeeId: string
  exitDate: string
  reason: ExitReason
  currency: string
  basicSalary: number
  housingAllowance: number
  gratuity: GratuityResult
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
  createdBy: string | null
  paidAt: string | null
  paidBy: string | null
}

export const hrPaySettings = registerArray<Tenant<PaySettingsRecord>>('hr.paySettings', [])
export const hrPayrollProfiles = registerArray<Tenant<PayrollProfileRecord>>('hr.payrollProfiles', [])
export const hrPayAdjustments = registerArray<Tenant<AdjustmentRecord>>('hr.payAdjustments', [])
export const hrPayLoans = registerArray<Tenant<LoanRecord>>('hr.payLoans', [])
export const hrPayrollRuns = registerArray<Tenant<PayrollRunRecord>>('hr.payrollRuns', [])
export const hrFinalSettlements = registerArray<Tenant<SettlementRecord>>('hr.finalSettlements', [])

/** Next id `<prefix><n>` over some rows (globally unique, safe after a restore). */
export function nextPayId(prefix: string, ids: Iterable<string>): string {
  let max = 1000
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue
    const n = Number(id.slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

export const allLineIds = () => hrPayrollRuns.flatMap((r) => r.lines.map((l) => l.id))

/** The paid settlement of an employee (offboarding checklist). */
export const settlementOf = (companyId: string, employeeId: string) => hrFinalSettlements.find((s) => s.companyId === companyId && s.employeeId === employeeId)
