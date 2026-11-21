import { defineMapper } from './mapping'
import type {
  BalanceSheetStatement,
  CashFlowStatement,
  GeneralLedgerReport,
  ProfitAndLossStatement,
  StatementsMeta,
  TrialBalanceComparative,
  YearEndCloseInput,
  YearEndCloseResult,
  YearEndOverview,
  YearEndPreview,
} from '@/modules/finance/statements/types'

/**
 * Wire names of Accounts & finance › Financial statements and year-end close: plain snake_case at any depth
 * (columns[].from, sections[].lines[].account_id, totals.net_profit, operating.working_capital, fiscal_year_end…).
 * docs/API.md › Finance › Financial statements, Year-end close.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const finStatementsMetaMapper = deep<StatementsMeta>()
export const finPnlMapper = deep<ProfitAndLossStatement>()
export const finBalanceSheetMapper = deep<BalanceSheetStatement>()
export const finCashFlowMapper = deep<CashFlowStatement>()
export const finGeneralLedgerMapper = deep<GeneralLedgerReport>()
export const finTbCompareMapper = deep<TrialBalanceComparative>()
export const finYearEndMapper = deep<YearEndOverview>()
export const finYearEndPreviewMapper = deep<YearEndPreview>()
export const finYearEndCloseInputMapper = deep<YearEndCloseInput>()
export const finYearEndResultMapper = deep<YearEndCloseResult>()
/** `{ reason }` */
export const finYearEndPlainMapper = deep<Record<string, unknown>>()
