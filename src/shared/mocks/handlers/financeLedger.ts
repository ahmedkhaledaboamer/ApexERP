import { http, type HttpHandler } from 'msw'
import type { AccountInput, ExchangeRateInput, FinanceSettingsInput, ManualJournalInput, OpeningBalanceInput } from '@/modules/finance/ledger/types'
import * as fin from '@/shared/mocks/services/financeLedger'
import {
  finAccountInputMapper,
  finAccountMapper,
  finDimensionsMapper,
  finJournalDetailMapper,
  finJournalRowMapper,
  finLedgerMapper,
  finManualJournalInputMapper,
  finOpeningInputMapper,
  finOverviewMapper,
  finPlainMapper,
  finRateInputMapper,
  finSettingsInputMapper,
  finSettingsMapper,
  finTrialBalanceMapper,
} from '@/shared/api/financeLedgerMappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Id = { id: string }

async function body<T>(request: Request, mapper: { fromApi(value: unknown): unknown }): Promise<T | null> {
  try {
    return await bodyAs<T>(request, mapper)
  } catch {
    return null
  }
}
const query = (request: Request) => new URL(request.url).searchParams
const F = `${API}/finance`

/**
 * Accounts & finance › ledger core and setup (docs/API.md › Finance › Ledger & settings). Plan module `accounting`
 * (the `/finance` path gate); accounting full writes, view reads. Static paths before `:id`.
 */
export const financeLedgerHandlers: HttpHandler[] = [
  /* ---- settings, lock date, exchange rates ---- */
  http.get(`${F}/settings`, ({ request }) => respondAs(finSettingsMapper, () => fin.getFinanceSettings(userFrom(request)))),
  http.patch(`${F}/settings`, async ({ request }) => {
    const input = await body<FinanceSettingsInput>(request, finSettingsInputMapper)
    return respondAs(finSettingsMapper, () => fin.updateFinanceSettings(userFrom(request), input))
  }),
  http.put(`${F}/settings/lock-date`, async ({ request }) => {
    const input = await body<{ lockDate?: unknown; reason?: unknown }>(request, finPlainMapper)
    return respondAs(finSettingsMapper, () => fin.setLockDate(userFrom(request), input))
  }),
  http.get(`${F}/exchange-rates/lookup`, ({ request }) => {
    const q = query(request)
    return respondAs(finPlainMapper, () => fin.lookupRate(userFrom(request), { currency: q.get('currency'), date: q.get('date') }))
  }),
  http.post(`${F}/exchange-rates`, async ({ request }) => {
    const input = await body<ExchangeRateInput>(request, finRateInputMapper)
    return respondAs(finSettingsMapper, () => fin.addExchangeRate(userFrom(request), input))
  }),
  http.delete<Id>(`${F}/exchange-rates/:id`, ({ request, params }) => respondAs(finSettingsMapper, () => fin.deleteExchangeRate(userFrom(request), params.id))),

  /* ---- chart of accounts ---- */
  http.get(`${F}/accounts`, ({ request }) => {
    const q = query(request)
    return respondAs(finAccountMapper, () => fin.listAccounts(userFrom(request), { asOf: q.get('as_of'), includeInactive: q.get('include_inactive') }))
  }),
  http.post(`${F}/accounts/import-template`, ({ request }) => respondAs(finAccountMapper, () => fin.importChartTemplate(userFrom(request)))),
  http.post(`${F}/accounts`, async ({ request }) => {
    const input = await body<AccountInput>(request, finAccountInputMapper)
    return respondAs(finAccountMapper, () => fin.createAccount(userFrom(request), input))
  }),
  http.patch<Id>(`${F}/accounts/:id`, async ({ request, params }) => {
    const input = await body<AccountInput>(request, finAccountInputMapper)
    return respondAs(finAccountMapper, () => fin.updateAccount(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${F}/accounts/:id`, ({ request, params }) => respondAs(finPlainMapper, () => fin.deleteAccount(userFrom(request), params.id))),
  http.get<Id>(`${F}/accounts/:id/ledger`, ({ request, params }) => {
    const q = query(request)
    return respondAs(finLedgerMapper, () => fin.getAccountLedger(userFrom(request), params.id, { from: q.get('from'), to: q.get('to') }))
  }),

  /* ---- journal ---- */
  http.get(`${F}/journal`, ({ request }) => {
    const q = query(request)
    return respondAs(finJournalRowMapper, () =>
      fin.listJournal(userFrom(request), { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, sourceType: q.get('source_type') ?? undefined, accountId: q.get('account_id') ?? undefined, q: q.get('q') ?? undefined }),
    )
  }),
  http.get(`${F}/journal/dimensions`, ({ request }) => respondAs(finDimensionsMapper, () => fin.journalDimensions(userFrom(request)))),
  http.post(`${F}/journal`, async ({ request }) => {
    const input = await body<ManualJournalInput>(request, finManualJournalInputMapper)
    return respondAs(finJournalDetailMapper, () => fin.createManualJournal(userFrom(request), input))
  }),
  http.get<Id>(`${F}/journal/:id`, ({ request, params }) => respondAs(finJournalDetailMapper, () => fin.getJournalEntry(userFrom(request), params.id))),
  http.post<Id>(`${F}/journal/:id/reverse`, async ({ request, params }) => {
    const input = await body<{ date?: unknown; memo?: unknown }>(request, finPlainMapper)
    return respondAs(finJournalDetailMapper, () => fin.reverseManualJournal(userFrom(request), params.id, input))
  }),
  http.post(`${F}/opening-balances`, async ({ request }) => {
    const input = await body<OpeningBalanceInput>(request, finOpeningInputMapper)
    return respondAs(finJournalDetailMapper, () => fin.postOpeningBalances(userFrom(request), input))
  }),

  /* ---- reports, overview ---- */
  http.get(`${F}/reports/trial-balance`, ({ request }) => {
    const q = query(request)
    return respondAs(finTrialBalanceMapper, () => fin.getTrialBalance(userFrom(request), { asOf: q.get('as_of'), includeZero: q.get('include_zero') }))
  }),
  http.get(`${F}/overview`, ({ request }) => respondAs(finOverviewMapper, () => fin.getFinanceOverview(userFrom(request)))),
]
