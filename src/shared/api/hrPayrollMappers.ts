import { defineMapper } from './mapping'
import type {
  AdjustmentInput,
  BankFile,
  FinalSettlement,
  LoanInput,
  PayAdjustment,
  PayLoan,
  PayrollProfile,
  PayrollProfileInput,
  PayrollRunDetail,
  PayrollRunRow,
  PayrollSummary,
  PaySettings,
  PaySettingsInput,
  Payslip,
  PayslipRow,
  SettlementInput,
} from '@/modules/hr/payroll/types'

/**
 * Wire names of HR › Salary Management: plain snake_case at any depth (pay_day, wps_employer_id,
 * social_insurance.national_employee_rate, person_id_masked, iban_masked, employer_cost, paid_run_ids…).
 * `by_month` of the summary is keyed by month (yyyy-MM) and passes through untouched. docs/API.md › HR ›
 * Salary management.
 */
const deep = <T>(opaque: string[] = []) => defineMapper<T>({ deep: true, opaque })

export const paySettingsMapper = deep<PaySettings>()
export const paySettingsInputMapper = deep<PaySettingsInput>()
export const payrollProfileMapper = deep<PayrollProfile>()
export const payrollProfileInputMapper = deep<PayrollProfileInput>()
export const payAdjustmentMapper = deep<PayAdjustment>()
export const payAdjustmentInputMapper = deep<AdjustmentInput>()
export const payLoanMapper = deep<PayLoan>()
export const payLoanInputMapper = deep<LoanInput>()
export const payrollRunRowMapper = deep<PayrollRunRow>()
export const payrollRunDetailMapper = deep<PayrollRunDetail>()
export const bankFileMapper = deep<BankFile>()
export const payslipRowMapper = deep<PayslipRow>()
export const payslipMapper = deep<Payslip>()
export const payrollSummaryMapper = deep<PayrollSummary>(['byMonth'])
export const settlementMapper = deep<FinalSettlement>()
export const settlementInputMapper = deep<SettlementInput>()
/** Small bodies / answers ({ month }, { warnings }, { format }, { person_id }…). */
export const payPlainMapper = deep<Record<string, unknown>>()
