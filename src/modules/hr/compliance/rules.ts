/**
 * HR › Discipline and Policies: pure rules shared by the mock API (services/hrCompliance.ts) and the screens.
 *
 *   - discipline: default expiry by type, expiry date, status on a company day, the escalation hint
 *     (2 active verbal → written; 2 active written → final; an active final → the next step is HR's decision),
 *     the warning letter templates (English + formal Arabic) and their extra placeholders;
 *   - policies: audience matching, the reminder schedule (publish, +3 days, +7 days, once each), the light text
 *     format of a policy body ("# heading", "- bullet", **bold**: parsed into blocks, never rendered as HTML).
 */
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import type { DisciplinaryStatus, DisciplinaryType, EscalationHint, PolicyAudience } from './types'

/* ======================= Discipline ======================= */

export function defaultExpiryMonths(type: DisciplinaryType): number {
  if (type === 'verbal_warning') return 6
  if (type === 'written_warning' || type === 'final_warning') return 12
  return 0
}

/** 2026-11-23 + 6 months → 2027-05-23 (end of month clamped: 2026-08-31 + 6 → 2027-02-28). 0 months → null (never lapses). */
export function expiryDate(issueDate: string, months: number): string | null {
  if (!months) return null
  const [y, m, d] = issueDate.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Withdrawn wins; then lapsed once the company day is past the expiry date (the record stays on file as history). */
export function disciplinaryStatus(r: { withdrawnAt: string | null; expiresOn: string | null }, today: string): DisciplinaryStatus {
  if (r.withdrawnAt) return 'withdrawn'
  if (r.expiresOn && today > r.expiresOn) return 'expired'
  return 'active'
}

/**
 * What the next step would be, from the employee's ACTIVE records (lapsed and withdrawn ones don't count): progressive
 * discipline. Suspensions and deductions don't change the ladder. A hint only: HR decides.
 */
export function escalationHint(active: readonly { type: DisciplinaryType }[]): EscalationHint {
  const n = (t: DisciplinaryType) => active.filter((r) => r.type === t).length
  const activeVerbal = n('verbal_warning')
  const activeWritten = n('written_warning')
  const activeFinal = n('final_warning')
  let suggestion: DisciplinaryType | null = null
  let message: string | null = null
  if (activeFinal > 0) {
    message = 'An active final warning is on file: a further issue may lead to suspension or termination (HR decision).'
  } else if (activeWritten >= 2) {
    suggestion = 'final_warning'
    message = `${activeWritten} active written warnings: the next step is a final warning.`
  } else if (activeWritten === 1) {
    suggestion = 'written_warning'
    message = 'One active written warning: a second one leads to a final warning.'
  } else if (activeVerbal >= 2) {
    suggestion = 'written_warning'
    message = `${activeVerbal} active verbal warnings: the next step is a written warning.`
  }
  return { activeVerbal, activeWritten, activeFinal, suggestion, message }
}

/** Placeholders only the warning letter uses (on top of the letter catalogue). */
export const WARNING_KEYS: ReadonlySet<string> = new Set([
  'warning.caseNo',
  'warning.type',
  'warning.category',
  'warning.incidentDate',
  'warning.description',
  'warning.expiry',
  'warning.action',
])

/** The warning letter (English). Synthetic: review with HR / legal before use. */
export const WARNING_LETTER_EN = [
  'To: {{employee.salutation}} {{employee.fullName}}',
  'Employee number: {{employee.employeeNo}}',
  'Position: {{employee.jobTitle}}',
  '',
  'Subject: {{warning.type}} – {{warning.category}} (case {{warning.caseNo}})',
  '',
  'Dear {{employee.salutation}} {{employee.fullName}},',
  '',
  'This letter records a {{warning.type}} issued to you concerning the following incident of {{warning.incidentDate}}:',
  '',
  '{{warning.description}}',
  '',
  '{{warning.action}}',
  '',
  'This record remains on your employee file {{warning.expiry}}. Any repetition may lead to further disciplinary action in line with company policy and the applicable labour law.',
  '',
  'Please acknowledge receipt of this letter in My HR. You may add a comment or appeal there within five working days.',
].join('\n')

/** The warning letter (formal Arabic, without gendered verbs). Synthetic: review with HR / legal before use. */
export const WARNING_LETTER_AR = [
  'إلى: {{employee.salutation}} {{employee.fullName}}',
  'الرقم الوظيفي: {{employee.employeeNo}}',
  'المسمى الوظيفي: {{employee.jobTitle}}',
  '',
  'الموضوع: {{warning.type}} – {{warning.category}} (رقم القضية {{warning.caseNo}})',
  '',
  'تحية طيبة وبعد،',
  '',
  'يوثّق هذا الخطاب {{warning.type}} بشأن الواقعة التالية بتاريخ {{warning.incidentDate}}:',
  '',
  '{{warning.description}}',
  '',
  '{{warning.action}}',
  '',
  'ويبقى هذا الإجراء مسجلاً في الملف الوظيفي {{warning.expiry}}، وقد يترتب على تكرار المخالفة اتخاذ إجراءات تأديبية أخرى وفقاً لسياسات الشركة وقانون العمل المعمول به.',
  '',
  'يُرجى الإقرار باستلام هذا الخطاب عبر بوابة «My HR»، مع إمكانية إضافة ملاحظة أو تقديم تظلم خلال خمسة أيام عمل.',
].join('\n')

/* ======================= Policies ======================= */

/** Reminder thresholds after publishing (company days): at publish, +3 days, +7 days. */
export const POLICY_REMINDER_DAYS = [0, 3, 7] as const

/**
 * The reminder due now for one employee and policy version, once only: the LATEST threshold reached that isn't marked
 * yet (earlier ones reached at the same time are marked without a second notification). Keys: `v<version>:d<days>`.
 */
export function dueReminder(publishedDay: string, today: string, version: number, marks: readonly string[]): { send: string | null; mark: string[] } {
  const passed = daysBetweenIso(publishedDay, today)
  const reached = POLICY_REMINDER_DAYS.filter((d) => passed >= d).map((d) => `v${version}:d${d}`)
  const open = reached.filter((k) => !marks.includes(k))
  if (!open.length) return { send: null, mark: [] }
  return { send: open[open.length - 1], mark: open }
}

/** Is an employee (department, role) in a policy's audience? `deptTree` expands a department to its sub-departments. */
export function inAudience(a: PolicyAudience, who: { departmentId: string | null; role: string | null }, deptTree: (id: string) => readonly string[]): boolean {
  if (a.kind === 'all') return true
  if (a.kind === 'roles') return !!who.role && a.roles.includes(who.role as never)
  if (!who.departmentId) return false
  return a.departmentIds.some((d) => deptTree(d).includes(who.departmentId!))
}

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0)

export interface TextRun {
  text: string
  bold: boolean
}
export interface PolicyBlock {
  kind: 'heading' | 'bullet' | 'paragraph'
  runs: TextRun[]
}

/** "**bold** text" → runs (no nesting; unmatched ** stays literal). */
export function runsOf(line: string): TextRun[] {
  const out: TextRun[] = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index), bold: false })
    out.push({ text: m[1], bold: true })
    last = m.index! + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false })
  return out
}

/** A policy body → blocks: "# " headings, "- " / "* " bullets, other lines paragraphs (blank lines separate). */
export function policyBlocks(body: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = []
  for (const raw of (body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,3}\s+/.test(line)) blocks.push({ kind: 'heading', runs: runsOf(line.replace(/^#{1,3}\s+/, '')) })
    else if (/^[-*]\s+/.test(line)) blocks.push({ kind: 'bullet', runs: runsOf(line.replace(/^[-*]\s+/, '')) })
    else blocks.push({ kind: 'paragraph', runs: runsOf(line) })
  }
  return blocks
}

/** Company day + n (re-exported for the services). */
export const plusDays = addDaysIso
