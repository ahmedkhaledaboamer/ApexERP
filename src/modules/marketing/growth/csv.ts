import type { KeywordImportRow } from './types'

/** Splits one CSV line (commas or semicolons; "quoted, values" and "" escapes). */
export function splitCsvLine(line: string, sep = ','): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const KEYWORD_HEADERS = ['keyword', 'query', 'top queries', 'search query']
const DATE_HEADERS = ['date', 'day']
const POSITION_HEADERS = ['position', 'avg position', 'average position', 'rank']

/** "2026-11-03", "03/11/2026" (day first) or "2026/11/03" → YYYY-MM-DD; anything else is returned as is (the server rejects it). */
function isoDate(v: string): string {
  const s = v.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return s
}

/**
 * Rows of a "keyword,date,position" CSV (like a Search Console export). A header row is optional: when
 * present, columns are found by name (keyword / query, date, position / avg position); otherwise the
 * order is keyword, date, position. Row numbers count the file's lines (header = 1).
 */
export function parseKeywordCsv(text: string): KeywordImportRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const first = lines.find((l) => l.trim()) ?? ''
  const sep = first.includes(';') && !first.includes(',') ? ';' : ','
  const head = splitCsvLine(first, sep).map((h) => h.toLowerCase())
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h))
  const hasHeader = idx(KEYWORD_HEADERS) >= 0 || idx(POSITION_HEADERS) >= 0
  const k = hasHeader ? idx(KEYWORD_HEADERS) : 0
  const d = hasHeader ? idx(DATE_HEADERS) : 1
  const p = hasHeader ? idx(POSITION_HEADERS) : 2
  const rows: KeywordImportRow[] = []
  let started = false
  lines.forEach((line, i) => {
    if (!line.trim()) return
    if (hasHeader && !started) {
      started = true
      return
    }
    const cells = splitCsvLine(line, sep)
    rows.push({ row: i + 1, keyword: cells[k] ?? '', date: isoDate(cells[d] ?? ''), position: p >= 0 ? (cells[p] ?? '') : '' })
  })
  return rows
}
