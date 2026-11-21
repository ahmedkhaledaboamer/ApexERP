import { defineMapper } from './mapping'
import type {
  CashCountInput,
  ClaimInput,
  ClaimsMeta,
  DuplicateCheckInput,
  Expense,
  ExpenseCategory,
  ExpenseCategoryInput,
  ExpenseClaim,
  ExpenseInput,
  ExpensePolicy,
  ExpensePolicyInput,
  ExpensesMeta,
  PettyExpenseInput,
  PettyFund,
  PettyFundDetail,
  PettyFundInput,
  PettyMeta,
  PettyTopUpInput,
  ReimburseInput,
  ReplenishInput,
} from '@/modules/finance/expenses/types'

/**
 * Wire names of Accounts & finance › Expenses, Expense claims and Petty cash: plain snake_case at any depth
 * (payee_vat_number, paid_from_account_id, petty_fund_id, lines[].merchant_vat_number, receipt.size_bytes,
 * reimbursement.payroll_adjustment_id, float_limit, cash_expected…). docs/API.md › Finance › Expenses.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const expenseMapper = deep<Expense>()
export const expenseInputMapper = deep<ExpenseInput>()
export const duplicateCheckMapper = deep<DuplicateCheckInput>()
export const expensesMetaMapper = deep<ExpensesMeta>()
export const expenseCategoryMapper = deep<ExpenseCategory>()
export const expenseCategoryInputMapper = deep<ExpenseCategoryInput>()
export const expensePolicyMapper = deep<ExpensePolicy>()
export const expensePolicyInputMapper = deep<ExpensePolicyInput>()
export const claimMapper = deep<ExpenseClaim>()
export const claimInputMapper = deep<ClaimInput>()
export const claimsMetaMapper = deep<ClaimsMeta>()
export const reimburseInputMapper = deep<ReimburseInput>()
export const pettyFundMapper = deep<PettyFund>()
export const pettyFundDetailMapper = deep<PettyFundDetail>()
export const pettyFundInputMapper = deep<PettyFundInput>()
export const pettyTopUpInputMapper = deep<PettyTopUpInput>()
export const pettyExpenseInputMapper = deep<PettyExpenseInput>()
export const replenishInputMapper = deep<ReplenishInput>()
export const cashCountInputMapper = deep<CashCountInput>()
export const pettyMetaMapper = deep<PettyMeta>()
/** Small bodies / answers ({ reason }, { id }, { duplicates }). */
export const expensesPlainMapper = deep<Record<string, unknown>>()
