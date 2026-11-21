import { CodedApiError } from '@/shared/mocks/tenant'
import { companyById } from '@/shared/mocks/data/tenancy'
import { financeSettings } from '@/shared/mocks/data/financeLedger'
import { rateLookup } from '@/modules/finance/ledger/calc'

/**
 * Exchange rates to the company's base currency (Finance settings › Exchange rates). Every finance section converts
 * document amounts to base currency with these:
 *   rateFor(companyId, 'USD', '2026-11-20') → 3.6725 (AED per USD for Apex), 1 for the base currency, null when no
 *   rate is effective on or before that date;
 *   requireRate(…) → the same, or 422 `missing_exchange_rate` (for posting).
 */

export function baseCurrencyOf(companyId: string): string {
  return companyById(companyId)?.regional.currency ?? 'AED'
}

export function rateFor(companyId: string, currency: string, date: string): number | null {
  return rateLookup(financeSettings.get(companyId).exchangeRates, currency, baseCurrencyOf(companyId), date)
}

export function requireRate(companyId: string, currency: string, date: string): number {
  const r = rateFor(companyId, currency, date)
  if (r === null) {
    throw new CodedApiError(`No exchange rate for ${currency} on or before ${date}. Add one in Finance settings › Exchange rates.`, 422, 'missing_exchange_rate', { currency, date })
  }
  return r
}
