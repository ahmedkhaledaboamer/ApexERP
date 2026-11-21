import type { Account, Invoice, JournalEntry, TaxCode } from '@/modules/finance/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { seedAccounts, seedTaxCodes } from './financeSeed'

/**
 * Accounts & finance core stores (contract shared by every finance section). Seeds are filled by the
 * owning section: the chart of accounts / tax codes by the ledger core, invoices by the invoices section.
 * Section-specific stores (payments, credit notes, recurring, PDC …) live in their own data files.
 *
 * Synthetic data only.
 */

export const financeAccounts = registerArray<Tenant<Account>>('fin.accounts', seedAccounts())
export const financeTaxCodes = registerArray<Tenant<TaxCode>>('fin.taxCodes', seedTaxCodes())
export const financeJournal = registerArray<Tenant<JournalEntry>>('fin.journal', [])
export const financeInvoices = registerArray<Tenant<Invoice>>('fin.invoices', [])

/** Id counters (unique across companies) and per-company yearly document numbers. */
export const financeSeq = registerObject('fin.seq', {
  ids: { journal: 1000, invoice: 1000, creditNote: 1000, payment: 1000, recurring: 1000, pdc: 1000, paymentLink: 1000 } as Record<string, number>,
  /** key: `${companyId}:${series}:${year}` → last number used, e.g. "co_apex:INV:2026" → 12 */
  numbers: {} as Record<string, number>,
})
