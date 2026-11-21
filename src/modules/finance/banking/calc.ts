import type { CsvMapping, DateFormat, ParsedLine } from './types'

/**
 * Pure helpers of Accounts & finance › Banking (no store access): CSV statement parsing, duplicate detection, auto-match
 * scoring, the cleared balance of a reconciliation and the journal lines of a transfer. Shared by the mock server
 * (services/financeBanking.ts) and the import screen (live preview).
 */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/* ---------------- CSV ---------------- */

/** The most frequent of `,` `;` tab in the first lines (outside quotes). */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n')
  const count = (d: string) => {
    let n = 0
    let q = false
    for (const ch of head) {
      if (ch === '"') q = !q
      else if (!q && ch === d) n++
    }
    return n
  }
  const c = { ',': count(','), ';': count(';'), '\t': count('\t') }
  return (Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] as ',' | ';' | '\t') ?? ','
}

/** RFC-4180-ish: quoted fields, doubled quotes, CRLF / LF; blank lines dropped; cells trimmed. */
export function parseCsv(text: string, delimiter: ',' | ';' | '\t' = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') q = false
      else cell += ch
      continue
    }
    if (ch === '"') q = true
    else if (ch === delimiter) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim())
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function validIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > dim) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** A statement date in `format` → yyyy-MM-dd, or null. Two-digit years are 20yy. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim()
  if (!s) return null
  const yy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))
  if (format === 'd MMM yyyy') {
    const m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})$/)
    if (!m) return null
    const mi = MONTHS.indexOf(m[2].toLowerCase())
    return mi < 0 ? null : validIso(yy(m[3]), mi + 1, Number(m[1]))
  }
  if (format === 'yyyy-MM-dd') {
    const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)
    return m ? validIso(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/)
  if (!m) return null
  return format === 'MM/dd/yyyy' ? validIso(yy(m[3]), Number(m[1]), Number(m[2])) : validIso(yy(m[3]), Number(m[2]), Number(m[1]))
}

/** "1,234.50" / "-12" / "(45.00)" / "12.00 CR" / "AED 10" → number (null when not a number; '' → 0 for debit / credit). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim()
  if (!s) return null
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  if (/\bDR\b$/i.test(s)) {
    sign = -sign
    s = s.replace(/\bDR\b$/i, '')
  } else s = s.replace(/\bCR\b$/i, '')
  s = s.replace(/[A-Z]{3}/gi, '').replace(/[\s ]/g, '')
  // 1.234,56 (European) → 1234.56; 1,234.56 → 1234.56
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null
  return r2(sign * Number(s))
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The duplicate key of a statement line: date, amount, description and reference (normalised). */
export function lineKey(l: { date: string; amount: number; description: string; reference: string }): string {
  return `${l.date}|${r2(l.amount).toFixed(2)}|${norm(l.description)}|${norm(l.reference)}`
}

const find = (header: string[], ...names: RegExp[]) => {
  for (const re of names) {
    const i = header.findIndex((h) => re.test(h.toLowerCase()))
    if (i >= 0) return i
  }
  return null
}

/** A mapping guessed from the header row (and the first data row's date shape). */
export function suggestMapping(rows: string[][]): CsvMapping {
  const header = rows[0] ?? []
  const hasHeader = header.some((h) => /[a-z]{3,}/i.test(h)) && !header.some((h) => parseAmount(h) !== null && /\d/.test(h) && !/[a-z]/i.test(h))
  const date = (hasHeader ? find(header, /value date/, /^date/, /date/) : null) ?? 0
  const description = (hasHeader ? find(header, /description/, /narrative/, /details/, /particulars/, /memo/) : null) ?? 1
  const reference = hasHeader ? find(header, /reference/, /^ref/, /cheque/) : null
  const debit = hasHeader ? find(header, /^debit/, /withdrawal/, /money out/, /^paid out/) : null
  const credit = hasHeader ? find(header, /^credit/, /deposit/, /money in/, /^paid in/) : null
  const amount = debit !== null && credit !== null ? null : ((hasHeader ? find(header, /amount/, /value$/) : null) ?? 2)
  const balance = hasHeader ? find(header, /balance/) : null
  const first = rows[hasHeader ? 1 : 0]?.[date] ?? ''
  let dateFormat: DateFormat = 'yyyy-MM-dd'
  if (/^\d{4}-/.test(first)) dateFormat = 'yyyy-MM-dd'
  else if (/^\d{1,2}\s?[A-Za-z]{3}/.test(first)) dateFormat = 'd MMM yyyy'
  else if (/^\d{1,2}\.\d{1,2}\./.test(first)) dateFormat = 'dd.MM.yyyy'
  else if (/^\d{1,2}-\d{1,2}-/.test(first)) dateFormat = 'dd-MM-yyyy'
  else if (/^\d{1,2}\/\d{1,2}\//.test(first)) {
    const [a, b] = first.split('/').map(Number)
    dateFormat = b > 12 && a <= 12 ? 'MM/dd/yyyy' : 'dd/MM/yyyy'
  }
  return { date, description, reference, amount, debit: amount === null ? debit : null, credit: amount === null ? credit : null, balance, dateFormat, hasHeader }
}

/**
 * Data rows → statement lines. `existing`: duplicate keys of lines already imported for the account; a line repeated
 * inside the file is a duplicate from its second occurrence on.
 */
export function buildLines(rows: string[][], mapping: CsvMapping, existing: ReadonlySet<string> = new Set()): ParsedLine[] {
  const data = mapping.hasHeader ? rows.slice(1) : rows
  const seen = new Set<string>()
  return data.map((cells, i) => {
    const row = i + (mapping.hasHeader ? 2 : 1)
    const cell = (idx: number | null) => (idx === null || idx === undefined ? '' : (cells[idx] ?? ''))
    const date = parseDate(cell(mapping.date), mapping.dateFormat)
    let amount: number | null = null
    if (mapping.amount !== null && mapping.amount !== undefined) {
      amount = parseAmount(cell(mapping.amount))
      if (amount !== null && mapping.invertSign) amount = -amount
    } else {
      const dRaw = cell(mapping.debit)
      const cRaw = cell(mapping.credit)
      const d = dRaw ? parseAmount(dRaw) : 0
      const c = cRaw ? parseAmount(cRaw) : 0
      amount = d === null || c === null ? null : r2(Math.abs(c) - Math.abs(d))
    }
    const balRaw = cell(mapping.balance)
    const balance = balRaw ? parseAmount(balRaw) : null
    const description = cell(mapping.description).slice(0, 300)
    const reference = cell(mapping.reference).slice(0, 100)
    let error: string | null = null
    if (!date) error = `Row ${row}: the date “${cell(mapping.date)}” doesn’t match ${mapping.dateFormat}.`
    else if (amount === null) error = `Row ${row}: the amount isn’t a number.`
    else if (amount === 0) error = `Row ${row}: zero amount.`
    const line: ParsedLine = { row, date: date ?? '', description, reference, amount: amount ?? 0, balance, duplicate: false, error }
    if (!error) {
      const key = lineKey(line)
      line.duplicate = existing.has(key) || seen.has(key)
      seen.add(key)
    }
    return line
  })
}

/* ---------------- matching ---------------- */

export interface MatchableStatementLine {
  id: string
  date: string
  amount: number
  description: string
  reference: string
}
export interface MatchableBookLine {
  id: string
  date: string
  amount: number
  /** Document numbers that identify the line (journal number, source document number, payment reference…). */
  docNumbers: string[]
}

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/**
 * Score of a 1-to-1 candidate (0 = not a candidate): same amount (required, 50), date within ±3 days (required;
 * 30 on the same day, −5 a day), the statement's description / reference contains one of the line's document numbers (20).
 */
export function scoreMatch(s: MatchableStatementLine, b: MatchableBookLine): { score: number; reasons: string[] } {
  if (r2(s.amount) !== r2(b.amount)) return { score: 0, reasons: [] }
  const d = dayDiff(s.date, b.date)
  if (d > 3) return { score: 0, reasons: [] }
  const reasons = ['Same amount', d === 0 ? 'Same date' : `${d} day${d === 1 ? '' : 's'} apart`]
  let score = 50 + 30 - d * 5
  const hay = norm(`${s.description} ${s.reference}`).replace(/\s/g, '')
  const doc = b.docNumbers.find((n) => n && n.length >= 4 && hay.includes(norm(n).replace(/\s/g, '')))
  if (doc) {
    score += 20
    reasons.push(`Mentions ${doc}`)
  }
  return { score: Math.min(100, score), reasons }
}

/** Best 1-to-1 suggestions: highest score first, each statement line and book line used once. */
export function suggestMatches(stmt: readonly MatchableStatementLine[], book: readonly MatchableBookLine[], minScore = 60): { statementLineId: string; journalLineIds: string[]; score: number; reasons: string[] }[] {
  const cands: { s: MatchableStatementLine; b: MatchableBookLine; score: number; reasons: string[] }[] = []
  for (const s of stmt) {
    for (const b of book) {
      const m = scoreMatch(s, b)
      if (m.score >= minScore) cands.push({ s, b, ...m })
    }
  }
  cands.sort((x, y) => y.score - x.score || dayDiff(x.s.date, x.b.date) - dayDiff(y.s.date, y.b.date) || x.s.id.localeCompare(y.s.id) || x.b.id.localeCompare(y.b.id))
  const usedS = new Set<string>()
  const usedB = new Set<string>()
  const out: { statementLineId: string; journalLineIds: string[]; score: number; reasons: string[] }[] = []
  for (const c of cands) {
    if (usedS.has(c.s.id) || usedB.has(c.b.id)) continue
    usedS.add(c.s.id)
    usedB.add(c.b.id)
    out.push({ statementLineId: c.s.id, journalLineIds: [c.b.id], score: c.score, reasons: c.reasons })
  }
  return out
}

/** A match must balance: Σ statement amounts = Σ book amounts (account currency, to the cent). */
export function matchBalances(statementAmounts: readonly number[], bookAmounts: readonly number[]): boolean {
  return r2(statementAmounts.reduce((s, a) => s + a, 0)) === r2(bookAmounts.reduce((s, a) => s + a, 0))
}

/**
 * Cleared (reconciled) book balance on a statement date: the opening position (book lines before `reconcileFrom`)
 * plus every book line matched to statement lines dated on or before `statementDate`.
 */
export function clearedBalance(
  book: readonly { date: string; amount: number; matched: boolean; matchStatementDate: string | null }[],
  reconcileFrom: string | null,
  statementDate: string,
): number {
  let t = 0
  for (const l of book) {
    if (reconcileFrom && l.date < reconcileFrom) t += l.amount
    else if (l.matched && l.matchStatementDate !== null && l.matchStatementDate <= statementDate) t += l.amount
  }
  return r2(t)
}

/** statement balance − cleared balance (0 = reconciled). */
export const reconciliationDifference = (statementBalance: number, cleared: number): number => r2(statementBalance - cleared)

/* ---------------- transfers ---------------- */

export interface TransferCalcInput {
  fromAccountId: string
  toAccountId: string
  feeAccountId: string
  fxAccountId: string
  amountFrom: number
  amountTo: number
  fee: number
  /** Base-currency value of 1 unit of each account's currency on the transfer date. */
  rateFrom: number
  rateTo: number
}
export interface TransferCalcLine {
  accountId: string
  debit: number
  credit: number
  description: string
  /** Account-currency amount (signed: + into the account) for bank-account lines. */
  foreign: number | null
}

/**
 * Dr to (amountTo at its rate) · Cr from (amountFrom + fee at its rate) · Dr bank charges (fee) · the difference of the
 * two base values to fx gain / loss (Dr = loss, Cr = gain). Always balances.
 */
export function transferLines(t: TransferCalcInput): { lines: TransferCalcLine[]; fxDifference: number } {
  const baseFrom = r2(t.amountFrom * t.rateFrom)
  const baseTo = r2(t.amountTo * t.rateTo)
  const feeBase = r2(t.fee * t.rateFrom)
  const fx = r2(baseFrom - baseTo)
  const lines: TransferCalcLine[] = [
    { accountId: t.toAccountId, debit: baseTo, credit: 0, description: 'Transfer in', foreign: r2(t.amountTo) },
    { accountId: t.fromAccountId, debit: 0, credit: r2(baseFrom + feeBase), description: t.fee ? 'Transfer out (incl. fee)' : 'Transfer out', foreign: -r2(t.amountFrom + t.fee) },
  ]
  if (feeBase) lines.push({ accountId: t.feeAccountId, debit: feeBase, credit: 0, description: 'Transfer fee', foreign: null })
  if (fx > 0) lines.push({ accountId: t.fxAccountId, debit: fx, credit: 0, description: 'Exchange loss on transfer', foreign: null })
  if (fx < 0) lines.push({ accountId: t.fxAccountId, debit: 0, credit: -fx, description: 'Exchange gain on transfer', foreign: null })
  return { lines, fxDifference: fx }
}

/** "•••• 1234" (empty → ''). */
export function maskTail(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\s/g, '')
  return s ? `•••• ${s.slice(-4)}` : ''
}

/** `JE-1042:L1` ↔ { entryId, index }. */
export const lineIdOf = (entryId: string, index: number) => `${entryId}:L${index}`
export function parseLineId(id: string): { entryId: string; index: number } | null {
  const m = /^(.+):L(\d{1,4})$/.exec(id)
  return m ? { entryId: m[1], index: Number(m[2]) } : null
}
