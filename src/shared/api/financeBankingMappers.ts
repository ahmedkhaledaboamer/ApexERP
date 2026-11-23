import { defineMapper } from './mapping'
import type {
  BankAccount,
  BankAccountInput,
  BankAccountReveal,
  BankReconciliation,
  BankRule,
  BankRuleInput,
  BankStatement,
  BankStatementDetail,
  BankTransfer,
  CreateFromLineInput,
  FinishReconciliationInput,
  MatchInput,
  PayrollPosting,
  EosbProvisionReport,
  EosbRunResult,
  ReconcileWorkspace,
  ReconciliationReport,
  StatementImportInput,
  StatementPreview,
  TransferInput,
} from '@/modules/finance/banking/types'

/**
 * Wire names of Accounts & finance › Banking and Payroll posting: plain snake_case at any depth (ledger_account_id,
 * account_number_masked, statement_line_ids, journal_line_ids, statement_balance, outstanding_deposits…).
 * docs/API.md › Finance › Bank accounts, Reconciliation, Payroll posting.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const bankAccountMapper = deep<BankAccount>()
export const bankAccountInputMapper = deep<BankAccountInput>()
export const bankRevealMapper = deep<BankAccountReveal>()
export const bankTransferMapper = deep<BankTransfer>()
export const transferInputMapper = deep<TransferInput>()
export const statementPreviewMapper = deep<StatementPreview>()
export const statementImportInputMapper = deep<StatementImportInput>()
export const bankStatementMapper = deep<BankStatement>()
export const bankStatementDetailMapper = deep<BankStatementDetail>()
export const reconcileWorkspaceMapper = deep<ReconcileWorkspace & { autoMatched?: number }>()
export const matchInputMapper = deep<MatchInput>()
export const createFromLineInputMapper = deep<CreateFromLineInput>()
export const bankRuleMapper = deep<BankRule>()
export const bankRuleInputMapper = deep<BankRuleInput>()
export const finishReconInputMapper = deep<FinishReconciliationInput>()
export const reconciliationMapper = deep<BankReconciliation>()
export const reconciliationReportMapper = deep<ReconciliationReport>()
export const payrollPostingMapper = deep<PayrollPosting>()
export const eosbProvisionMapper = deep<EosbProvisionReport>()
export const eosbRunMapper = deep<EosbRunResult>()
export const bankPlainMapper = deep<Record<string, unknown>>()
