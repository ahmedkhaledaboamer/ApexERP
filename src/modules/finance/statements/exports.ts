import type { ExportCell, ExportSheet } from '@/modules/reports/lib/exportExcel'
import { csvCell } from '@/modules/platform/csv'
import type { BalanceSheetStatement, CashFlowStatement, GeneralLedgerReport, ProfitAndLossStatement, TrialBalanceComparative } from './types'
import { pctChange } from './calc'

/**
 * Statement → one export table (pure). The same table feeds the Excel workbook (reports/lib/exportExcel) and the CSV
 * (quoted, formula-safe). Amounts stay numbers (base currency, 2 decimals).
 */

export const MONEY = '#,##0.00'
const money = (header: string) => ({ header, width: 16, format: MONEY })

export function pnlSheet(s: ProfitAndLossStatement): ExportSheet {
  const withPct = s.view === 'period' && s.columns.length > 1
  const columns = [{ header: 'Code', width: 8 }, { header: 'Line', width: 34 }, ...s.columns.map((c) => money(c.label))]
  if (withPct) for (const c of s.columns.slice(1)) columns.push({ header: `% vs ${c.label}`, width: 12, format: '0.0"%"' })
  const pct = (vals: number[]): ExportCell[] => (withPct ? vals.slice(1).map((v) => pctChange(vals[0], v)) : [])
  const rows: ExportCell[][] = []
  const line = (code: string, label: string, vals: number[]) => rows.push([code, label, ...vals, ...pct(vals)])
  const sec = (id: string) => s.sections.find((x) => x.id === id)!
  const block = (id: string) => {
    const x = sec(id)
    rows.push([null, x.label])
    for (const l of x.lines) line(l.code, `  ${l.name}`, l.amounts)
    line('', `Total ${x.label.toLowerCase()}`, x.totals)
  }
  block('revenue')
  block('cost_of_sales')
  line('', 'Gross profit', s.totals.grossProfit)
  block('operating_expenses')
  line('', 'Operating profit', s.totals.operatingProfit)
  block('other_income')
  block('other_expenses')
  line('', 'Net profit', s.totals.netProfit)
  return { name: 'Profit and loss', title: `Profit and loss (${s.currency})`, columns, rows }
}

export function balanceSheetSheet(s: BalanceSheetStatement): ExportSheet {
  const rows: ExportCell[][] = []
  const groups: [string, string, number[]][] = [
    ['assets', 'Total assets', s.totals.assets],
    ['liabilities', 'Total liabilities', s.totals.liabilities],
    ['equity', 'Total equity', s.totals.equity],
  ]
  for (const [g, label, totals] of groups) {
    for (const sec of s.sections.filter((x) => x.group === g && x.lines.length)) {
      rows.push([null, sec.label])
      for (const l of sec.lines) rows.push([l.code, `  ${l.name}`, ...l.amounts])
      rows.push(['', `Total ${sec.label.toLowerCase()}`, ...sec.totals])
    }
    rows.push(['', label, ...totals])
  }
  rows.push(['', 'Total liabilities and equity', ...s.totals.liabilitiesAndEquity])
  rows.push(['', 'Difference (assets − liabilities − equity)', ...s.totals.difference])
  return { name: 'Balance sheet', title: `Balance sheet (${s.currency})`, columns: [{ header: 'Code', width: 8 }, { header: 'Line', width: 40 }, ...s.columns.map((c) => money(`As of ${c.label}`))], rows }
}

export function cashFlowSheet(s: CashFlowStatement): ExportSheet {
  const rows: ExportCell[][] = [[null, 'Operating activities'], ['', '  Net profit', s.operating.netProfit]]
  if (s.operating.adjustments.length) rows.push([null, '  Adjustments for non-cash items'])
  for (const l of s.operating.adjustments) rows.push([l.code, `    ${l.name}`, l.amount])
  if (s.operating.workingCapital.length) rows.push([null, '  Changes in working capital'])
  for (const l of s.operating.workingCapital) rows.push([l.code, `    ${l.name}`, l.amount])
  rows.push(['', 'Net cash from operating activities', s.operating.total], [null, 'Investing activities'])
  for (const l of s.investing.lines) rows.push([l.code, `  ${l.name}`, l.amount])
  rows.push(['', 'Net cash from investing activities', s.investing.total], [null, 'Financing activities'])
  for (const l of s.financing.lines) rows.push([l.code, `  ${l.name}`, l.amount])
  rows.push(
    ['', 'Net cash from financing activities', s.financing.total],
    ['', 'Net change in cash and bank', s.netChange],
    ['', 'Cash and bank at the start', s.openingCash],
    ['', 'Cash and bank at the end', s.closingCash],
    ['', 'Check (should be 0)', s.check],
  )
  return { name: 'Cash flow', title: `Cash flow statement (${s.currency})`, columns: [{ header: 'Code', width: 8 }, { header: 'Line', width: 44 }, money('Amount')], rows }
}

export function generalLedgerSheet(s: GeneralLedgerReport): ExportSheet {
  const rows: ExportCell[][] = []
  for (const a of s.accounts) {
    rows.push([a.account.code, a.account.name, 'Opening balance', null, null, null, null, a.openingBalance])
    for (const r of a.rows) rows.push([a.account.code, a.account.name, r.date, r.number, r.memo + (r.description && r.description !== r.memo ? ` · ${r.description}` : ''), r.debit || null, r.credit || null, r.balance])
    rows.push([a.account.code, a.account.name, 'Closing balance', null, null, a.totals.debit, a.totals.credit, a.closingBalance])
  }
  return {
    name: 'General ledger',
    title: `General ledger ${s.from} – ${s.to} (${s.currency})`,
    columns: [{ header: 'Code', width: 8 }, { header: 'Account', width: 30 }, { header: 'Date', width: 14 }, { header: 'Entry', width: 14 }, { header: 'Memo', width: 44 }, money('Debit'), money('Credit'), money('Balance')],
    rows,
  }
}

export function trialBalanceSheet(s: TrialBalanceComparative): ExportSheet {
  const columns = [{ header: 'Code', width: 8 }, { header: 'Account', width: 34 }, { header: 'Type', width: 10 }]
  for (const c of s.columns) columns.push(money(`Debit ${c.label}`), money(`Credit ${c.label}`))
  const rows: ExportCell[][] = s.rows.map((r) => [r.code, r.name, r.type, ...s.columns.flatMap((_, i) => [r.debit[i] || null, r.credit[i] || null])])
  rows.push(['', 'Total', '', ...s.columns.flatMap((_, i) => [s.totals.debit[i], s.totals.credit[i]])])
  return { name: 'Trial balance', title: `Trial balance (${s.currency})`, columns, rows }
}

/** CSV of one export table: header row then values (formula-safe quoting). */
export function sheetToCsv(sheet: ExportSheet): string {
  const lines = [sheet.columns.map((c) => csvCell(c.header)).join(',')]
  for (const r of sheet.rows) lines.push(sheet.columns.map((_, i) => csvCell(r[i] ?? null)).join(','))
  return lines.join('\r\n')
}
