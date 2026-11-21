import type { JournalLine } from '@/modules/finance/types'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { financeJournal } from '@/shared/mocks/data/finance'
import { postJournal, reverseJournal } from '@/shared/mocks/services/ledger'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { monthRange } from '@/modules/finance/ledger/calc'
import { now } from '@/shared/mocks/clock'

/**
 * Ledger seed (both companies, different data), posted through `postJournal` like any entry: opening balances at the
 * start of the fiscal year (the difference to opening balance equity) and a few manual entries in the last months
 * (one of them reversed). Dates are relative to the company's today. Runs once, when the ledger services load.
 * Synthetic data only.
 */

const ln = (accountId: string, debit: number, credit: number, description = '', dims: Partial<JournalLine> = {}): JournalLine => ({ accountId, debit, credit, description, ...dims })

/** A day of the month `offset` months from today (clamped to today in the current month). */
function dayIn(today: string, offset: number, day: number): string {
  const r = monthRange(today, offset)
  const d = `${r.month}-${String(day).padStart(2, '0')}`
  const capped = d > r.to ? r.to : d
  return offset === 0 && capped > today ? today : capped
}

function opening(companyId: string, date: string, createdBy: string, lines: JournalLine[]): void {
  const diff = lines.reduce((s, l) => s + l.debit - l.credit, 0)
  const all = diff === 0 ? lines : [...lines, ln('ACC-3300', diff < 0 ? -diff : 0, diff > 0 ? diff : 0, 'Opening balance equity')]
  postJournal(companyId, { date, memo: `Opening balances at ${date}`, sourceType: 'opening_balance', sourceId: null, lines: all, createdBy })
}

function manual(companyId: string, date: string, memo: string, createdBy: string, lines: JournalLine[]) {
  return postJournal(companyId, { date, memo, sourceType: 'manual', sourceId: null, lines, createdBy })
}

let seeded = false
export function seedLedgerJournal(): void {
  if (seeded) return
  seeded = true
  // Idempotent for a restored DB that already holds the seed.
  if (financeJournal.some((e) => e.sourceType === 'opening_balance')) return

  /* ---- Apex Aora (AED, UAE): accountant Rashid Iqbal (u8) ---- */
  {
    const co = APEX_ID
    const today = todayIsoIn(companyById(co)!.regional.timezone, now())
    const fy = `${today.slice(0, 4)}-01-01`
    opening(co, fy, 'u8', [
      ln('ACC-1120', 485000, 0, 'Emirates NBD current account'),
      ln('ACC-1110', 12500, 0, 'Petty cash'),
      ln('ACC-1400', 18000, 0, 'Prepaid office insurance'),
      ln('ACC-1510', 96000, 0, 'Laptops and servers'),
      ln('ACC-1520', 38000, 0, 'Office fit-out'),
      ln('ACC-1590', 0, 21000, 'Accumulated depreciation'),
      ln('ACC-2100', 0, 42300, 'Supplier balances'),
      ln('ACC-2500', 0, 64000, 'End-of-service provision'),
      ln('ACC-3100', 0, 300000, 'Share capital'),
    ])
    manual(co, dayIn(today, -1, 4), 'Office rent Q4, Business Bay', 'u8', [
      ln('ACC-6200', 30000, 0, 'Rent October–December', { departmentId: 'd-management' }),
      ln('ACC-1120', 0, 30000, 'Cheque 000418'),
    ])
    const accrual = manual(co, dayIn(today, -1, 28), 'Accrued audit fee (estimate)', 'u8', [
      ln('ACC-6700', 8000, 0, 'External audit 2026', { departmentId: 'd-finance' }),
      ln('ACC-2600', 0, 8000, 'Accrued expenses'),
    ])
    manual(co, dayIn(today, -1, 30), 'Monthly depreciation', 'u8', [
      ln('ACC-6850', 1750, 0, 'IT equipment and furniture'),
      ln('ACC-1590', 0, 1750, 'Accumulated depreciation'),
    ])
    reverseJournal(co, accrual.id, dayIn(today, 0, 1), 'Reversal of the audit fee accrual (invoice received)', 'u8')
    manual(co, dayIn(today, 0, 3), 'Design software subscriptions', 'u8', [
      ln('ACC-6600', 4200, 0, 'Annual licences', { departmentId: 'd-marketing' }),
      ln('ACC-1300', 210, 0, 'VAT 5% recoverable', { taxCode: 'VAT5' }),
      ln('ACC-1120', 0, 4410, 'Card payment'),
    ])
    manual(co, dayIn(today, 0, 5), 'Petty cash top-up', 'u8', [ln('ACC-1110', 5000, 0, 'Cash withdrawal'), ln('ACC-1120', 0, 5000, 'Cash withdrawal')])
  }

  /* ---- Crest Logistics (SAR, KSA): admin Faisal Al Harbi (u101); the 2025 books are locked ---- */
  {
    const co = CREST_ID
    const today = todayIsoIn(companyById(co)!.regional.timezone, now())
    const fy = `${today.slice(0, 4)}-01-01`
    opening(co, fy, 'u101', [
      ln('ACC-1120', 1240000, 0, 'Al Rajhi Bank current account'),
      ln('ACC-1110', 8000, 0, 'Petty cash'),
      ln('ACC-1530', 420000, 0, 'Delivery fleet'),
      ln('ACC-1590', 0, 95000, 'Accumulated depreciation'),
      ln('ACC-2100', 0, 136500, 'Supplier balances'),
      ln('ACC-2410', 0, 18400, 'GOSI December'),
      ln('ACC-2700', 0, 32000, 'Zakat 2025'),
      ln('ACC-3100', 0, 1000000, 'Share capital'),
    ])
    manual(co, dayIn(today, -2, 12), 'Zakat 2025 paid to ZATCA', 'u101', [ln('ACC-2700', 32000, 0, 'Zakat settlement'), ln('ACC-1120', 0, 32000, 'SADAD payment')])
    manual(co, dayIn(today, -1, 30), 'Fleet depreciation', 'u101', [
      ln('ACC-6850', 7000, 0, 'Vehicles', { departmentId: 'c2-ops' }),
      ln('ACC-1590', 0, 7000, 'Accumulated depreciation'),
    ])
    manual(co, dayIn(today, 0, 2), 'Warehouse rent, Riyadh 2nd Industrial City', 'u101', [
      ln('ACC-6200', 45000, 0, 'Warehouse rent (quarter)', { departmentId: 'c2-ops' }),
      ln('ACC-1300', 6750, 0, 'VAT 15% recoverable', { taxCode: 'VAT15' }),
      ln('ACC-1120', 0, 51750, 'Bank transfer'),
    ])
    manual(co, dayIn(today, 0, 6), 'Bank charges', 'u101', [ln('ACC-6800', 115, 0, 'Monthly account fee'), ln('ACC-1120', 0, 115, 'Al Rajhi Bank')])
  }
}
