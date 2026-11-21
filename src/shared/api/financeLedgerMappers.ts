import { defineMapper } from './mapping'
import type {
  AccountInput,
  AccountLedger,
  AccountRow,
  ExchangeRateInput,
  FinanceOverview,
  FinanceSettings,
  FinanceSettingsInput,
  JournalDetail,
  JournalDimensions,
  JournalRow,
  ManualJournalInput,
  OpeningBalanceInput,
  TrialBalance,
} from '@/modules/finance/ledger/types'

/**
 * Wire names of Accounts & finance › ledger core and setup: plain snake_case at any depth (base_currency,
 * fiscal_year_start_month, exchange_rates[].effective_date, parent_id, system_role, is_header, lines[].account_id,
 * department_id, source_type, totals.debit…). docs/API.md › Finance › Ledger & settings.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const finSettingsMapper = deep<FinanceSettings>()
export const finSettingsInputMapper = deep<FinanceSettingsInput>()
export const finRateInputMapper = deep<ExchangeRateInput>()
export const finAccountMapper = deep<AccountRow>()
export const finAccountInputMapper = deep<AccountInput>()
export const finLedgerMapper = deep<AccountLedger>()
export const finJournalRowMapper = deep<JournalRow>()
export const finJournalDetailMapper = deep<JournalDetail>()
export const finManualJournalInputMapper = deep<ManualJournalInput>()
export const finOpeningInputMapper = deep<OpeningBalanceInput>()
export const finDimensionsMapper = deep<JournalDimensions>()
export const finTrialBalanceMapper = deep<TrialBalance>()
export const finOverviewMapper = deep<FinanceOverview>()
/** Small bodies / answers ({ lock_date, reason }, { date, memo }, { id }, rate lookups). */
export const finPlainMapper = deep<Record<string, unknown>>()
