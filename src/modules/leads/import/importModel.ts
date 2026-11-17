import type { LeadStatus, SourceType } from '@/shared/types'
import type { ImportLeadRow, LeadOwnerOption } from '@/modules/leads/types'
import type { IndustryOption, ListOption, StatusOption } from '@/modules/settings/types'
import type { Service } from '@/modules/services/types'
import { matchServiceText } from '@/modules/services/match'
import { isUaeMobile, normalizeUaeMobile } from '@/shared/lib/phone'

/**
 * Pure logic for the Excel import wizard: reading files, matching headers, suggesting value
 * mappings and turning raw cells into clean rows. No React here, so it stays easy to test.
 */

/* ------------------------------------------------------------------------------------------
 * Target fields
 * ---------------------------------------------------------------------------------------- */

export type TargetKey =
  | 'company'
  | 'website'
  | 'contactName'
  | 'contactTitle'
  | 'mobile'
  | 'email'
  | 'isDecisionMaker'
  | 'sourceType'
  | 'sourceDetail'
  | 'industry'
  | 'subIndustry'
  | 'status'
  | 'owner'
  | 'nextFollowUpDate'
  | 'nextStep'
  | 'value'
  | 'companyServices'
  | 'recommendedService'
  | 'notes'
  | 'doNotContact'

export interface TargetField {
  key: TargetKey
  label: string
  required?: boolean
  /** Picked from a list; free text in the file gets a value mapping. */
  listed?: boolean
  hint?: string
  aliases: string[]
  example: string
}

export const TARGET_FIELDS: TargetField[] = [
  { key: 'company', label: 'Company', required: true, aliases: ['company', 'company name', 'business', 'organisation', 'organization', 'account', 'client', 'customer', 'lead', 'lead name'], example: 'Al Noor Medical Centre' },
  { key: 'website', label: 'Website', aliases: ['website', 'web', 'site', 'url', 'domain', 'web site'], example: 'alnoormedical.ae' },
  { key: 'contactName', label: 'Contact name', aliases: ['contact', 'contact name', 'contact person', 'name', 'person', 'full name', 'poc'], example: 'Dr. Fatima Al Hashimi' },
  { key: 'contactTitle', label: 'Contact title', aliases: ['title', 'job title', 'position', 'designation', 'role'], example: 'Clinic Manager' },
  { key: 'mobile', label: 'Mobile', aliases: ['mobile', 'mobile number', 'phone', 'phone number', 'cell', 'whatsapp', 'tel', 'telephone', 'contact number', 'number'], example: '050 123 4567' },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'email address', 'mail'], example: 'fatima@alnoormedical.ae' },
  { key: 'isDecisionMaker', label: 'Decision maker?', aliases: ['decision maker', 'dm', 'is decision maker', 'decision'], example: 'Yes' },
  { key: 'sourceType', label: 'Source', required: true, listed: true, aliases: ['source', 'source type', 'lead source', 'channel', 'how found', 'origin'], example: 'Website' },
  { key: 'sourceDetail', label: 'Source detail', aliases: ['source detail', 'source details', 'source link', 'source name', 'reference', 'event name', 'referred by', 'link'], example: 'Contact form' },
  { key: 'industry', label: 'Industry', required: true, listed: true, aliases: ['industry', 'sector', 'vertical', 'business type', 'category'], example: 'Healthcare' },
  { key: 'subIndustry', label: 'Sub-industry', aliases: ['sub industry', 'sub-industry', 'subindustry', 'sub sector', 'segment', 'sub category'], example: 'Clinics' },
  { key: 'status', label: 'Status', listed: true, aliases: ['status', 'stage', 'lead status', 'pipeline stage', 'state'], example: 'Contacted' },
  { key: 'owner', label: 'Owner', listed: true, aliases: ['owner', 'assigned to', 'agent', 'sales agent', 'salesperson', 'sales person', 'rep', 'account manager', 'handled by'], example: 'Bincy Thomas' },
  { key: 'nextFollowUpDate', label: 'Next follow-up', aliases: ['next follow up', 'next follow-up', 'follow up', 'follow-up', 'follow up date', 'followup', 'next action date', 'next contact', 'reminder'], example: '2026-11-20' },
  { key: 'nextStep', label: 'Next step', aliases: ['next step', 'next action', 'action', 'to do', 'todo'], example: 'Send chatbot demo' },
  { key: 'value', label: 'Value (AED)', aliases: ['value', 'deal value', 'amount', 'budget', 'aed', 'estimated value', 'deal size'], example: '45000' },
  { key: 'companyServices', label: 'Services they offer', hint: 'Comma or semicolon separated', aliases: ['services', 'company services', 'services offered', 'what they do', 'offerings', 'products'], example: 'Dental implants; Orthodontics' },
  { key: 'recommendedService', label: 'Recommended service', hint: 'Matched to the service catalog; unmatched text is kept as “unmatched”', aliases: ['recommended service', 'service', 'service of interest', 'service interest', 'interested in', 'proposed service', 'recommended solution', 'solution'], example: 'AI customer-service chatbot (WhatsApp + web)' },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments', 'comment', 'remarks', 'remark', 'description', 'details'], example: 'Met at Arab Health' },
  { key: 'doNotContact', label: 'Do not contact', aliases: ['do not contact', 'dnc', 'dont contact', 'opt out', 'unsubscribe'], example: 'No' },
]

export type Mapping = Record<TargetKey, number | null>

export interface SheetFile {
  fileName: string
  headers: string[]
  /** Data rows as text; dates already as yyyy-mm-dd. */
  rows: string[][]
  /** Spreadsheet row number of each data row (blank rows are dropped). */
  rowNumbers: number[]
}

/* ------------------------------------------------------------------------------------------
 * Reading files
 * ---------------------------------------------------------------------------------------- */

export const MAX_FILE_ROWS = 5000

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : ymd(v)
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).trim()
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas/newlines inside quotes, ; or tab delimiters. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => firstLine.split(ch).length - 1
  const delim = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((f) => f.trim()))
}

/** Reads .xlsx or .csv into headers + text rows. Blank rows are dropped; the first non-blank row is the header. */
export async function readSpreadsheet(file: File): Promise<SheetFile> {
  const name = file.name.toLowerCase()
  let grid: string[][]
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    grid = parseCsv(await file.text())
  } else if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser')
    const data = await readSheet(file)
    grid = data.map((r) => r.map((c) => cellText(c)))
  } else {
    throw new Error('Upload an .xlsx or .csv file. Old .xls files: open in Excel and “Save as” .xlsx first.')
  }

  const headerIndex = grid.findIndex((r) => r.some((c) => c !== ''))
  if (headerIndex < 0) throw new Error('The file is empty.')
  const headerRow = grid[headerIndex]
  const width = Math.max(...grid.map((r) => r.length))
  const headers = Array.from({ length: width }, (_, i) => headerRow[i]?.trim() || `Column ${columnLetter(i)}`)
  const rows: string[][] = []
  const rowNumbers: number[] = []
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i]
    if (!r.some((c) => c !== '')) continue
    rows.push(Array.from({ length: width }, (_, j) => r[j] ?? ''))
    rowNumbers.push(i + 1)
  }
  if (rows.length === 0) throw new Error('The file has a header row but no data rows.')
  if (rows.length > MAX_FILE_ROWS) throw new Error(`The file has ${rows.length.toLocaleString()} rows; import up to ${MAX_FILE_ROWS.toLocaleString()} at a time.`)
  return { fileName: file.name, headers, rows, rowNumbers }
}

/** Spreadsheet row number for data row i. */
export function rowNumberOf(sheet: SheetFile, i: number): number {
  return sheet.rowNumbers[i] ?? i + 2
}

export function columnLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/* ------------------------------------------------------------------------------------------
 * Header matching
 * ---------------------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function emptyMapping(): Mapping {
  return Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, null])) as Mapping
}

/** Exact alias matches first, then "header contains alias", each column used once. */
export function autoMatch(headers: string[]): Mapping {
  const mapping = emptyMapping()
  const used = new Set<number>()
  const normalized = headers.map(norm)
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of TARGET_FIELDS) {
      if (mapping[f.key] !== null) continue
      const aliases = [f.label, ...f.aliases].map(norm)
      const idx = normalized.findIndex(
        (h, i) => !used.has(i) && h !== '' && aliases.some((a) => (pass === 'exact' ? h === a : a.length > 3 && h.includes(a))),
      )
      if (idx >= 0) {
        mapping[f.key] = idx
        used.add(idx)
      }
    }
  }
  return mapping
}

/* ------------------------------------------------------------------------------------------
 * Value mapping (the spec's "value cleanup")
 * ---------------------------------------------------------------------------------------- */

export type ListedKey = 'sourceType' | 'industry' | 'status' | 'owner'

/** raw value (lower-cased, trimmed; '' = blank) → allowed value ('' = leave blank / auto). */
export type ValueMaps = Record<ListedKey, Record<string, string>>

export function emptyValueMaps(): ValueMaps {
  return { sourceType: {}, industry: {}, status: {}, owner: {} }
}

export function valueKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * The ACTIVE lookup items the wizard maps free text onto (Settings > Fixed lists). Values in the
 * file are matched against labels and keys; mapped values are always lookup keys.
 */
export interface ImportLists {
  sources: ListOption[]
  statuses: StatusOption[]
  industries: IndustryOption[]
  /** The service catalog (active + inactive); the "Recommended service" column is matched onto it. */
  services?: Service[]
}

/** Status for rows with a blank status: the first active open status (New by default). */
export function defaultImportStatus(lists: ImportLists): LeadStatus {
  return lists.statuses.find((s) => s.kind === 'open')?.key ?? ''
}

/** Closest item by label or key (see `closest`), returned as its key. */
function closestKey(raw: string, items: ListOption[], fuzzy = true): string {
  const byLabel = closest(raw, items.map((i) => i.label), fuzzy)
  if (byLabel) return items.find((i) => i.label === byLabel)?.key ?? ''
  const byKey = closest(raw, items.map((i) => i.key), fuzzy)
  return byKey
}

/** A synonym's target only counts when it's still an active item. */
function synonymKey<T extends string>(table: [RegExp, T][], k: string, items: ListOption[]): string {
  const target = table.find(([re]) => re.test(k))?.[1]
  return target && items.some((i) => i.key === target) ? target : ''
}

/** Hints for the built-in keys (Settings can rename labels; these keys never change). */
const SOURCE_SYNONYMS: [RegExp, SourceType][] = [
  [/web|site|form|inbound|seo|google ads|landing/, 'Website'],
  [/linked ?in|\bli\b/, 'LinkedIn'],
  [/refer|friend|partner|word of mouth|existing client/, 'Referral'],
  [/event|expo|exhibition|gitex|arab health|conference|summit|trade show|seminar/, 'Event'],
  [/cold|call(ing)? list|outbound|walk ?in|canvass/, 'Cold Outreach'],
  [/director|yellow ?pages|chamber|listing|connect\.ae|database/, 'Directory'],
  [/research|google|online|internet|search|instagram|facebook|social/, 'Online Research'],
]

const STATUS_SYNONYMS: [RegExp, LeadStatus][] = [
  [/not interested|no interest|declin|rejected|refused/, 'Not interested'],
  [/won|closed won|signed|converted|deal done|customer/, 'Won'],
  [/lost|closed lost|dead|cancel/, 'Lost'],
  [/no (response|answer|reply)|unreachable|not reachable|no pickup|ringing/, 'No response'],
  [/call ?back|call later|later|follow ?up|busy|next month/, 'Call later'],
  [/meeting|demo|visit|appointment/, 'Meeting'],
  [/proposal|quot|offer sent|pricing sent|negotiat/, 'Proposal'],
  [/interest|hot|warm|positive/, 'Interested'],
  [/contacted|called|emailed|reached|in progress|touched/, 'Contacted'],
  [/^new$|fresh|not contacted|^open$|to call|pending/, 'New'],
]

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Closest allowed option by normalized equality, containment, then (if fuzzy) a small edit distance. */
function closest(raw: string, options: string[], fuzzy = true): string {
  const r = norm(raw)
  if (!r) return ''
  const exact = options.find((o) => norm(o) === r || norm(o) === r.replace(/s$/, '') || `${norm(o)}s` === r)
  if (exact) return exact
  const contains = options.find((o) => r.length > 3 && (norm(o).includes(r) || r.includes(norm(o))))
  if (contains || !fuzzy) return contains ?? ''
  // Short words need a near-exact hit ("hot" must not become "Won").
  let best = ''
  let bestD = r.length <= 4 ? 1 : r.length <= 7 ? 2 : 3
  for (const o of options) {
    const d = levenshtein(r, norm(o))
    if (d < bestD) {
      best = o
      bestD = d
    }
  }
  return best
}

/** Parent industry when a raw industry is actually a sub-industry ("Clinics" → Healthcare). */
export function industryOfSub(raw: string, lists: ImportLists): { industry: string; sub: string } | null {
  for (const industry of lists.industries) {
    const subs = industry.subIndustries.filter((s) => s.active)
    const sub = closestKey(raw, subs)
    const label = subs.find((s) => s.key === sub)?.label ?? sub
    if (sub && norm(label).slice(0, 5) === norm(raw).slice(0, 5)) return { industry: industry.key, sub }
  }
  return null
}

const INDUSTRY_SYNONYMS: [RegExp, string][] = [
  [/health|medical|clinic|hospital|dental|pharma|diagnos|wellness/, 'Healthcare'],
  [/real ?estate|property|properties|brokerage|realty/, 'Real Estate'],
  [/hotel|hospitality|restaurant|f ?& ?b|food|travel|tourism|cafe/, 'Hospitality'],
  [/retail|shop|store|fashion|e-?commerce|grocery|electronics/, 'Retail'],
  [/logistic|freight|shipping|cargo|courier|warehouse|transport/, 'Logistics'],
  [/school|education|university|academy|training|institute/, 'Education'],
  [/bank|finance|financial|insurance|exchange|fintech|invest/, 'Financial Services'],
  [/construct|contracting|mep|fit-?out|engineering|interior/, 'Construction'],
  [/auto|car|vehicle|motor|garage|rental/, 'Automotive'],
  [/legal|law|consult|account|audit|professional|advis/, 'Professional Services'],
]

export function suggestValue(kind: ListedKey, raw: string, owners: LeadOwnerOption[], lists: ImportLists): string {
  const k = valueKey(raw)
  if (!k) return kind === 'status' ? defaultImportStatus(lists) : ''
  if (kind === 'sourceType') {
    return closestKey(k, lists.sources, false) || synonymKey(SOURCE_SYNONYMS, k, lists.sources) || closestKey(k, lists.sources)
  }
  if (kind === 'status') {
    return closestKey(k, lists.statuses, false) || synonymKey(STATUS_SYNONYMS, k, lists.statuses) || closestKey(k, lists.statuses)
  }
  if (kind === 'industry') {
    const direct = closestKey(k, lists.industries, false)
    if (direct) return direct
    const viaSub = industryOfSub(k, lists)
    if (viaSub) return viaSub.industry
    return synonymKey(INDUSTRY_SYNONYMS, k, lists.industries) || closestKey(k, lists.industries)
  }
  // Owner: full name, email, first name, or initials.
  const byEmail = owners.find((o) => k.includes('@') && k.split('@')[0] === o.name.split(' ')[0].toLowerCase())
  if (byEmail) return byEmail.id
  const byName = owners.find((o) => norm(o.name) === norm(k))
  if (byName) return byName.id
  const byFirst = owners.filter((o) => norm(o.name.split(' ')[0]) === norm(k.split(' ')[0]))
  if (byFirst.length === 1) return byFirst[0].id
  const byInitials = owners.filter(
    (o) =>
      o.name
        .split(' ')
        .map((p) => p[0])
        .join('')
        .toLowerCase() === norm(k),
  )
  if (byInitials.length === 1) return byInitials[0].id
  const fuzzy = closest(k, owners.map((o) => o.name))
  return owners.find((o) => o.name === fuzzy)?.id ?? ''
}

/** Distinct raw values of a column with counts, most common first. */
export function distinctValues(sheet: SheetFile, col: number | null): { raw: string; key: string; count: number }[] {
  if (col === null) return []
  const map = new Map<string, { raw: string; key: string; count: number }>()
  for (const r of sheet.rows) {
    const raw = (r[col] ?? '').trim()
    const key = valueKey(raw)
    const e = map.get(key)
    if (e) e.count++
    else map.set(key, { raw, key, count: 1 })
  }
  return [...map.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.count - a.count))
}

/** Fills suggestions for values that have no mapping yet (keeps user choices). */
export function suggestValueMaps(
  sheet: SheetFile,
  mapping: Mapping,
  current: ValueMaps,
  owners: LeadOwnerOption[],
  lists: ImportLists,
): ValueMaps {
  const next: ValueMaps = {
    sourceType: { ...current.sourceType },
    industry: { ...current.industry },
    status: { ...current.status },
    owner: { ...current.owner },
  }
  for (const kind of ['sourceType', 'industry', 'status', 'owner'] as const) {
    // Owner suggestions wait for the owner list, or every name would stick as auto-assign.
    if (kind === 'owner' && owners.length === 0) continue
    const col = mapping[kind]
    const values = col === null ? [{ key: '', raw: '' }] : distinctValues(sheet, col)
    for (const v of values) {
      if (!(v.key in next[kind])) next[kind][v.key] = suggestValue(kind, v.raw, owners, lists)
    }
  }
  return next
}

/* ------------------------------------------------------------------------------------------
 * Cleaning
 * ---------------------------------------------------------------------------------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** yyyy-mm-dd, dd/mm/yyyy (UAE order), dd-mm-yyyy, d MMM yyyy, Excel serials. '' when not a date. */
export function parseDate(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v)
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    // UAE writes day first; flip only when the "month" can't be a month.
    return +m[2] > 12 && +m[1] <= 12 ? valid(y, +m[1], +m[2]) : valid(y, +m[2], +m[1])
  }
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{4})$/i.exec(v)
  if (m) return valid(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i.exec(v)
  if (m) return valid(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Math.floor(Number(v))
    if (serial > 30000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
      return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
  }
  return ''
}

function valid(y: number, mo: number, d: number): string {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return ''
  const date = new Date(y, mo - 1, d)
  if (date.getMonth() !== mo - 1) return ''
  return `${y}-${pad(mo)}-${pad(d)}`
}

const YES = /^(y|yes|true|1|x|✓|✔|dm|decision maker)$/i

export function parseAmount(raw: string): number | null {
  const v = raw.replace(/aed|dhs?|,|\s/gi, '')
  if (!v) return null
  const k = /^(\d+(\.\d+)?)k$/i.exec(v)
  if (k) return Math.round(Number(k[1]) * 1000)
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export type IssueField =
  | 'company'
  | 'mobile'
  | 'email'
  | 'sourceType'
  | 'industry'
  | 'subIndustry'
  | 'nextFollowUpDate'
  | 'value'
  | 'recommendedService'

export interface RowIssue {
  field: IssueField
  message: string
  /** Errors stop the row; warnings import it with the value cleared. */
  level: 'error' | 'warning'
  raw: string
}

/** Inline fixes typed in the Clean step, per row number. */
export type Fixes = Record<number, Partial<Record<'mobile' | 'email', string>>>

export interface CleanRow {
  data: ImportLeadRow
  issues: RowIssue[]
  /** Raw cell texts by target, for the error report. */
  raw: Partial<Record<TargetKey, string>>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Applies the mapping, value maps and fixes to every row. */
export function buildRows(sheet: SheetFile, mapping: Mapping, maps: ValueMaps, fixes: Fixes, lists: ImportLists): CleanRow[] {
  const get = (r: string[], key: TargetKey) => {
    const col = mapping[key]
    return col === null ? '' : (r[col] ?? '').trim()
  }
  return sheet.rows.map((r, i) => {
    const row = rowNumberOf(sheet, i)
    const issues: RowIssue[] = []
    const raw: Partial<Record<TargetKey, string>> = {}
    for (const f of TARGET_FIELDS) raw[f.key] = get(r, f.key)

    const company = raw.company!.replace(/\s+/g, ' ')
    if (!company) issues.push({ field: 'company', level: 'error', message: 'Company is missing', raw: '' })

    // Mobile: normalize to +9715XXXXXXXX.
    const rawMobile = fixes[row]?.mobile ?? raw.mobile!
    let mobile = ''
    if (rawMobile) {
      const first = rawMobile.split(/[/,;]| or /i)[0]
      const n = normalizeUaeMobile(first)
      if (n && isUaeMobile(n)) mobile = n
      else issues.push({ field: 'mobile', level: 'warning', message: 'Not a UAE mobile', raw: rawMobile })
    }

    // Email: trim + lowercase; first address if several.
    const rawEmail = fixes[row]?.email ?? raw.email!
    let email = ''
    if (rawEmail) {
      const first = rawEmail.split(/[\s,;]+/).find((p) => p.includes('@')) ?? rawEmail
      const e = first.trim().toLowerCase().replace(/^mailto:/, '')
      if (EMAIL_RE.test(e)) email = e
      else issues.push({ field: 'email', level: 'warning', message: 'Invalid email', raw: rawEmail })
    }

    const sourceType = (maps.sourceType[valueKey(raw.sourceType!)] ?? '') as SourceType | ''
    if (!sourceType) {
      issues.push({ field: 'sourceType', level: 'error', message: raw.sourceType ? `Source “${raw.sourceType}” not mapped` : 'Source is blank', raw: raw.sourceType! })
    }
    const industry = maps.industry[valueKey(raw.industry!)] ?? ''
    if (!industry) {
      issues.push({ field: 'industry', level: 'error', message: raw.industry ? `Industry “${raw.industry}” not mapped` : 'Industry is blank', raw: raw.industry! })
    }

    // Sub-industry: from its own column, or from an industry cell that named a sub-industry.
    let subIndustry = ''
    const subs = (lists.industries.find((i) => i.key === industry)?.subIndustries ?? []).filter((s) => s.active)
    if (raw.subIndustry) {
      subIndustry = closestKey(raw.subIndustry, subs)
      if (!subIndustry && industry) {
        issues.push({ field: 'subIndustry', level: 'warning', message: `“${raw.subIndustry}” isn’t under ${industry}`, raw: raw.subIndustry })
      }
    } else if (raw.industry && industry) {
      const viaSub = industryOfSub(raw.industry, lists)
      if (viaSub && viaSub.industry === industry) subIndustry = viaSub.sub
    }

    const status: LeadStatus = maps.status[valueKey(raw.status!)] ?? defaultImportStatus(lists)
    const ownerId = maps.owner[valueKey(raw.owner!)] ?? ''

    const nextFollowUpDate = parseDate(raw.nextFollowUpDate!)
    if (raw.nextFollowUpDate && !nextFollowUpDate) {
      issues.push({ field: 'nextFollowUpDate', level: 'warning', message: 'Date not understood', raw: raw.nextFollowUpDate })
    }
    const value = parseAmount(raw.value!)
    if (raw.value && value === null) issues.push({ field: 'value', level: 'warning', message: 'Not an amount', raw: raw.value })

    // Recommended service: matched to the catalog; unmatched text is kept (shown as "unmatched").
    const rawService = raw.recommendedService!.replace(/\s+/g, ' ')
    const hit = rawService ? matchServiceText(rawService, lists.services ?? []) : null
    const matched = hit?.active ? hit : null // new leads only get ACTIVE catalog services
    if (rawService && !matched) {
      issues.push({ field: 'recommendedService', level: 'warning', message: 'No catalog match; kept as unmatched text', raw: rawService })
    }

    let website = raw.website!.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
    if (website && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(website)) website = ''

    const data: ImportLeadRow = {
      row,
      company,
      website,
      contactName: raw.contactName!.replace(/\s+/g, ' '),
      contactTitle: raw.contactTitle!,
      mobile,
      email,
      isDecisionMaker: YES.test(raw.isDecisionMaker!),
      sourceType,
      sourceDetail: raw.sourceDetail!,
      industry,
      subIndustry,
      status,
      ownerId,
      nextFollowUpDate,
      nextStep: raw.nextStep!,
      value,
      companyServices: raw.companyServices!
        .split(/[,;\n|•]/)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 40)
        .slice(0, 20),
      recommendedServiceId: matched?.id ?? '',
      recommendedServiceText: rawService && !matched ? rawService.slice(0, 120) : '',
      notes: raw.notes!,
      doNotContact: YES.test(raw.doNotContact!),

    }
    return { data, issues, raw }
  })
}
