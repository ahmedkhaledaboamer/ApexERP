import type { TaxCategory } from '@/modules/finance/types'
import type { EstimateLine, TaxAdjustmentLine, VatBox, VatFrequency, VatItem, VatLayout, VatTotals } from './types'

/**
 * Pure tax rules (no store access): filing periods and due dates, the VAT box mapping of the UAE FTA VAT 201 and the
 * KSA ZATCA return, the settlement entry, the UAE corporate tax bands and the simplified zakat base.
 * Estimates only — not tax advice.
 */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
const sum = (xs: readonly number[]) => r2(xs.reduce((s, x) => s + x, 0))

/* ---------------- dates / periods ---------------- */

const pad = (n: number) => String(n).padStart(2, '0')
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function monthEnd(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`
}
/** yyyy-MM plus n months. */
export function addMonthsYm(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

export interface VatPeriod {
  key: string
  label: string
  from: string
  to: string
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The filing period containing `date` (calendar months / calendar quarters). */
export function periodOf(date: string, frequency: VatFrequency): VatPeriod {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  if (frequency === 'monthly') return { key: `${y}-${pad(m)}`, label: `${MONTH_SHORT[m - 1]} ${y}`, from: `${y}-${pad(m)}-01`, to: monthEnd(y, m) }
  const q = Math.floor((m - 1) / 3)
  return { key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y} (${MONTH_SHORT[q * 3]}–${MONTH_SHORT[q * 3 + 2]})`, from: `${y}-${pad(q * 3 + 1)}-01`, to: monthEnd(y, q * 3 + 3) }
}

/** Every period from the one containing `from` up to the one containing `until` (oldest first). */
export function periodsBetween(from: string, until: string, frequency: VatFrequency): VatPeriod[] {
  const out: VatPeriod[] = []
  let p = periodOf(from, frequency)
  while (p.from <= until) {
    out.push(p)
    p = periodOf(addDaysIso(p.to, 1), frequency)
  }
  return out
}

/** True when the period ends on a calendar-quarter end (switching to quarterly must start on a quarter). */
export const isQuarterEnd = (iso: string) => [3, 6, 9, 12].includes(Number(iso.slice(5, 7))) && iso === monthEnd(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)))

/**
 * Filing / payment deadline. UAE (FTA): the 28th day after the period ends. KSA (ZATCA): the last day of the month
 * following the period.
 */
export function vatDueDate(layout: VatLayout, periodTo: string): string {
  if (layout === 'uae_vat201') return addDaysIso(periodTo, 28)
  const next = addMonthsYm(periodTo.slice(0, 7), 1)
  return monthEnd(Number(next.slice(0, 4)), Number(next.slice(5, 7)))
}

/* ---------------- box mapping ---------------- */

export const UAE_EMIRATE_BOXES: [string, string][] = [
  ['1a', 'Abu Dhabi'],
  ['1b', 'Dubai'],
  ['1c', 'Sharjah'],
  ['1d', 'Ajman'],
  ['1e', 'Umm Al Quwain'],
  ['1f', 'Ras Al Khaimah'],
  ['1g', 'Fujairah'],
]
export const EMIRATES = UAE_EMIRATE_BOXES.map(([, e]) => e)
export const emirateBox = (emirate: string) => UAE_EMIRATE_BOXES.find(([, e]) => e === emirate)?.[0] ?? '1b'

/**
 * The box an item feeds (`excluded` when not reported). UAE: standard sales by emirate (1a–1g), zero-rated 4, exempt 5;
 * recoverable standard-rated purchases 9 (non-recoverable VAT, zero-rated / exempt purchases and out-of-scope lines
 * are not reported). KSA: standard sales 1, zero-rated domestic 3, exports 4, exempt 5; standard purchases 7,
 * zero-rated 10, exempt 11; late corrections of filed periods 14 (VAT only).
 */
export function boxOf(layout: VatLayout, i: Pick<VatItem, 'side' | 'category' | 'recoverable' | 'emirate' | 'export' | 'correction'>): string {
  const cat: TaxCategory = i.category
  if (cat === 'out_of_scope') return 'excluded'
  if (layout === 'uae_vat201') {
    if (i.side === 'sales') return cat === 'standard' ? emirateBox(i.emirate) : cat === 'zero_rated' ? '4' : '5'
    return cat === 'standard' && i.recoverable ? '9' : 'excluded'
  }
  if (i.side === 'sales') {
    if (i.correction && cat === 'standard') return '14'
    return cat === 'standard' ? '1' : cat === 'zero_rated' ? (i.export ? '4' : '3') : '5'
  }
  if (cat === 'standard') return i.recoverable ? (i.correction ? '14' : '7') : 'excluded'
  return cat === 'zero_rated' ? '10' : '11'
}

const box = (key: string, label: string, kind: VatBox['kind'] = 'line', drill = true, note: string | null = null): VatBox => ({ key, label, amount: 0, adjustment: 0, vat: 0, kind, drill, note })

/** Credit / debit notes go to the KSA adjustment column (amount); everything else to the amount column. */
const isNote = (i: VatItem) => i.kind === 'credit_note' || i.kind === 'debit_note'

/**
 * Builds the return's boxes and totals from the classified items (items must carry `box`, see `boxOf`).
 * UAE: late corrections go to the VAT "Adjustment" column of their box (1a–1g, 9). KSA: credit / debit notes go to the
 * amount "Adjustment" column; late corrections to box 14 (between SAR ±5,000 without a voluntary disclosure).
 */
export function vatBoxes(layout: VatLayout, items: readonly VatItem[], creditBroughtForward = 0): { boxes: VatBox[]; totals: VatTotals } {
  const reported = items.filter((i) => i.box !== 'excluded')
  const outputVat = sum(reported.filter((i) => i.side === 'sales').map((i) => i.vat))
  const inputVat = sum(reported.filter((i) => i.side === 'purchases').map((i) => i.vat))
  const corrections = sum(reported.filter((i) => i.correction).map((i) => (i.side === 'sales' ? i.vat : -i.vat)))
  const netVat = r2(outputVat - inputVat)
  const cbf = r2(Math.max(0, creditBroughtForward))
  const totals: VatTotals = { outputVat, inputVat, corrections, netVat, creditBroughtForward: cbf, payable: r2(netVat - cbf) }

  if (layout === 'uae_vat201') {
    const boxes: VatBox[] = [
      ...UAE_EMIRATE_BOXES.map(([k, e]) => box(k, `Standard rated supplies in ${e}`)),
      box('2', 'Tax refunds provided to tourists under the Tax Refunds for Tourists Scheme', 'line', false, 'Not applicable (no tourist refund scheme).'),
      box('3', 'Supplies subject to the reverse charge provisions', 'line', false, 'Not tracked yet: imported services are not flagged on bills.'),
      box('4', 'Zero rated supplies'),
      box('5', 'Exempt supplies'),
      box('6', 'Goods imported into the UAE', 'line', false, 'Not tracked yet: customs imports are not recorded.'),
      box('7', 'Adjustments to goods imported into the UAE', 'line', false, 'Not tracked yet.'),
    ]
    const by = new Map(boxes.map((b) => [b.key, b]))
    const b9 = box('9', 'Standard rated expenses')
    for (const i of reported) {
      const b = i.box === '9' ? b9 : by.get(i.box)
      if (!b) continue
      if (i.correction && i.category === 'standard') b.adjustment = r2(b.adjustment + i.vat)
      else {
        b.amount = r2(b.amount + i.net)
        b.vat = r2(b.vat + i.vat)
      }
    }
    const b8 = box('8', 'Totals', 'total', false)
    for (const b of boxes) {
      b8.amount = r2(b8.amount + b.amount)
      b8.vat = r2(b8.vat + b.vat)
      b8.adjustment = r2(b8.adjustment + b.adjustment)
    }
    const b10 = box('10', 'Supplies subject to the reverse charge provisions', 'line', false, 'Not tracked yet.')
    const b11 = box('11', 'Totals', 'total', false)
    b11.amount = r2(b9.amount + b10.amount)
    b11.vat = r2(b9.vat + b10.vat)
    b11.adjustment = r2(b9.adjustment + b10.adjustment)
    const b12 = box('12', 'Total value of due tax for the period', 'result', false)
    b12.vat = r2(b8.vat + b8.adjustment)
    const b13 = box('13', 'Total value of recoverable tax for the period', 'result', false)
    b13.vat = r2(b11.vat + b11.adjustment)
    const b14 = box('14', 'Payable tax for the period', 'result', false, cbf > 0 ? `Credit brought forward from the previous return: ${cbf.toFixed(2)}` : null)
    b14.vat = r2(b12.vat - b13.vat)
    return { boxes: [...boxes, b8, b9, b10, b11, b12, b13, b14], totals }
  }

  const sales: VatBox[] = [
    box('1', 'Standard rated sales (15%)'),
    box('2', 'Private healthcare / private education / first house sales to citizens', 'line', false, 'Not tracked: such sales are not flagged on invoices.'),
    box('3', 'Zero rated domestic sales'),
    box('4', 'Exports'),
    box('5', 'Exempt sales'),
  ]
  const purchases: VatBox[] = [
    box('7', 'Standard rated domestic purchases'),
    box('8', 'Imports subject to VAT paid at customs', 'line', false, 'Not tracked yet: customs imports are not recorded.'),
    box('9', 'Imports subject to VAT accounted for through reverse charge mechanism', 'line', false, 'Not tracked yet.'),
    box('10', 'Zero rated purchases'),
    box('11', 'Exempt purchases'),
  ]
  const by = new Map([...sales, ...purchases].map((b) => [b.key, b]))
  for (const i of reported) {
    const b = by.get(i.box)
    if (!b) continue
    if (isNote(i)) b.adjustment = r2(b.adjustment + i.net)
    else b.amount = r2(b.amount + i.net)
    b.vat = r2(b.vat + i.vat)
  }
  const total = (key: string, label: string, rows: VatBox[]) => {
    const t = box(key, label, 'total', false)
    for (const b of rows) {
      t.amount = r2(t.amount + b.amount)
      t.adjustment = r2(t.adjustment + b.adjustment)
      t.vat = r2(t.vat + b.vat)
    }
    return t
  }
  const b6 = total('6', 'Total sales', sales)
  const b12 = total('12', 'Total purchases', purchases)
  const b13 = box('13', 'Total VAT due for current period', 'result', false)
  b13.vat = r2(b6.vat - b12.vat)
  const b14 = box('14', 'Corrections from previous period (between SAR ±5,000)', 'result', true)
  b14.vat = corrections
  const b15 = box('15', 'VAT credit carried forward from previous period(s)', 'result', false)
  b15.vat = cbf
  const b16 = box('16', 'Net VAT due (or claimed)', 'result', false)
  b16.vat = r2(b13.vat + b14.vat - b15.vat)
  return { boxes: [...sales, b6, ...purchases, b12, b13, b14, b15, b16], totals }
}

/** KSA: corrections above SAR 5,000 (either way) need a voluntary disclosure instead of box 14. */
export const KSA_CORRECTION_LIMIT = 5000

/**
 * The settlement entry posted when a return is filed: Dr VAT output (the period's output VAT), Cr VAT input (the
 * recoverable input VAT), and the difference to the "VAT payable to tax authority" account (Cr when payable, Dr when a
 * credit). Amounts can be negative when credit notes exceed sales: the side flips.
 */
export function settlementLines(t: Pick<VatTotals, 'outputVat' | 'inputVat'>, accounts: { output: string; input: string; payable: string }): { accountId: string; debit: number; credit: number; description: string }[] {
  const side = (accountId: string, amount: number, description: string) => ({ accountId, debit: amount > 0 ? r2(amount) : 0, credit: amount < 0 ? r2(-amount) : 0, description })
  const net = r2(t.outputVat - t.inputVat)
  return [
    side(accounts.output, t.outputVat, 'VAT output for the period'),
    side(accounts.input, -t.inputVat, 'VAT input recovered'),
    side(accounts.payable, -net, net >= 0 ? 'VAT payable to the tax authority' : 'VAT refundable / carried forward'),
  ].filter((l) => l.debit > 0 || l.credit > 0)
}

/* ---------------- corporate tax (UAE) ---------------- */

export const UAE_CT_THRESHOLD = 375_000
export const UAE_CT_RATE = 9

/** 0 % on taxable income up to AED 375,000, 9 % above. */
export function corporateTaxBands(taxableIncome: number): { label: string; amount: number; rate: number; tax: number }[] {
  const t = Math.max(0, r2(taxableIncome))
  const low = Math.min(t, UAE_CT_THRESHOLD)
  const high = r2(Math.max(0, t - UAE_CT_THRESHOLD))
  return [
    { label: `Up to AED ${UAE_CT_THRESHOLD.toLocaleString('en-US')}`, amount: low, rate: 0, tax: 0 },
    { label: `Above AED ${UAE_CT_THRESHOLD.toLocaleString('en-US')}`, amount: high, rate: UAE_CT_RATE, tax: r2((high * UAE_CT_RATE) / 100) },
  ]
}
export const corporateTaxOf = (taxableIncome: number) => sum(corporateTaxBands(taxableIncome).map((b) => b.tax))

/**
 * Automatic adjustments to accounting profit: 50 % of entertainment (account 6560) is not deductible; fines and
 * penalties (accounts named so) are not deductible; dividends / capital gains (income accounts named so) are exempt.
 */
export function corporateTaxAdjustments(rows: readonly { code: string; name: string; type: 'income' | 'expense'; amount: number }[]): EstimateLine[] {
  const out: EstimateLine[] = []
  const ent = rows.filter((r) => r.type === 'expense' && r.code === '6560').reduce((s, r) => s + r.amount, 0)
  if (ent) out.push({ key: 'entertainment', label: 'Entertainment: 50 % not deductible (account 6560)', amount: r2(ent * 0.5), note: null })
  for (const r of rows.filter((x) => x.type === 'expense' && /fine|penalt/i.test(x.name) && x.amount)) out.push({ key: `fines:${r.code}`, label: `Fines and penalties not deductible (${r.code} ${r.name})`, amount: r2(r.amount), note: null })
  for (const r of rows.filter((x) => x.type === 'income' && /dividend|capital gain/i.test(x.name) && x.amount)) out.push({ key: `exempt:${r.code}`, label: `Exempt income (${r.code} ${r.name})`, amount: r2(-r.amount), note: null })
  return out
}

export const sumManual = (lines: readonly TaxAdjustmentLine[]) => sum(lines.map((l) => l.amount))

/* ---------------- zakat (KSA) ---------------- */

export const ZAKAT_RATE = 2.5

/**
 * Simplified zakat base: equity (+ profit not yet closed) + long-term liabilities − net fixed assets (± manual
 * adjustments), or the adjusted net profit when higher; never below 0. Zakat = 2.5 % of the base.
 */
export function zakatOf(x: { equity: number; unclosedProfit: number; longTermLiabilities: number; fixedAssetsNet: number; adjustedNetProfit: number; manual: number }): { baseByBalanceSheet: number; base: number; method: 'balance_sheet' | 'net_profit'; zakat: number } {
  const baseByBalanceSheet = r2(x.equity + x.unclosedProfit + x.longTermLiabilities - x.fixedAssetsNet + x.manual)
  const method = x.adjustedNetProfit > baseByBalanceSheet ? 'net_profit' : 'balance_sheet'
  const base = r2(Math.max(0, method === 'net_profit' ? x.adjustedNetProfit : baseByBalanceSheet))
  return { baseByBalanceSheet, base, method, zakat: r2((base * ZAKAT_RATE) / 100) }
}

/* ---------------- fiscal years ---------------- */

/** Fiscal year `year` (the calendar year it starts in) with the start month (1–12): first and last day. */
export function fiscalYearRange(year: number, startMonth: number): { from: string; to: string } {
  const from = `${year}-${pad(startMonth)}-01`
  const endYm = addMonthsYm(`${year}-${pad(startMonth)}`, 11)
  return { from, to: monthEnd(Number(endYm.slice(0, 4)), Number(endYm.slice(5, 7))) }
}
/** The fiscal year containing `date`. */
export function fiscalYearOf(date: string, startMonth: number): number {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return m >= startMonth ? y : y - 1
}
/** The 12 months (yyyy-MM) of a fiscal year. */
export function fiscalMonths(year: number, startMonth: number): string[] {
  return Array.from({ length: 12 }, (_, i) => addMonthsYm(`${year}-${pad(startMonth)}`, i))
}
