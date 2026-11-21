import type { ApplicationStage, CriterionScore, OfferStatus } from '@/modules/hr/recruitmentTypes'
import { PIPELINE_STAGES } from '@/modules/hr/recruitmentTypes'
import type { CertificateState, MatrixCell } from '@/modules/hr/trainingTypes'
import { CERTIFICATE_ALERT_DAYS } from '@/modules/hr/trainingTypes'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'

/**
 * Pure rules of HR recruitment and training, shared by the mock API (the contract) and the screens:
 * pipeline stage moves, scorecard averages, certificate validity and the training matrix.
 */

/* ---------------- Pipeline ---------------- */

export interface MoveContext {
  /** The opening accepts pipeline moves (open or on hold). */
  openingActive: boolean
  /** Status of the application's live offer (draft / sent / accepted), if any. */
  offerStatus: OfferStatus | null
  reason?: string
}

/**
 * Why a stage move is refused, or null when it is allowed.
 *  - hired is final and only reached by accepting an offer;
 *  - rejecting needs a reason; withdrawn / rejected can be reopened to an active stage while the opening is active;
 *  - leaving `offer` with a sent offer is refused (decline or withdraw it first);
 *  - on a filled / closed opening only reject / withdraw remain.
 */
export function moveError(from: ApplicationStage, to: ApplicationStage, ctx: MoveContext): string | null {
  if (from === to) return 'The candidate is already in that stage.'
  if (from === 'hired') return 'Hired is final.'
  if (to === 'hired') return 'Hire a candidate by accepting their offer.'
  if (to === 'rejected' && !ctx.reason?.trim()) return 'Give a reason for rejecting the candidate.'
  const active = PIPELINE_STAGES.includes(to)
  if (active && !ctx.openingActive) return 'The opening is no longer open. Reopen it to move candidates on.'
  if (from === 'offer' && ctx.offerStatus === 'sent' && to !== 'withdrawn' && to !== 'rejected') {
    return 'An offer has been sent. Record the candidate’s answer before moving them.'
  }
  if (to === 'offer' && from !== 'assessment' && from !== 'interview') {
    return 'Move the candidate through an interview first.'
  }
  return null
}

/* ---------------- Scorecards ---------------- */

export const round1 = (n: number) => Math.round(n * 10) / 10

/** Average of a scorecard's criteria (one decimal). */
export function scorecardAverage(scores: readonly CriterionScore[]): number {
  if (!scores.length) return 0
  return round1(scores.reduce((s, x) => s + x.score, 0) / scores.length)
}

/** Overall score: the mean of the scorecards' averages (one decimal), null without any. */
export function overallOf(averages: readonly number[]): number | null {
  if (!averages.length) return null
  return round1(averages.reduce((s, x) => s + x, 0) / averages.length)
}

/* ---------------- Certificates & matrix ---------------- */

/** yyyy-MM-dd plus whole months (clamped to the month's last day: 31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** A certificate's expiry from its issue date and the course validity (null = never expires). */
export function certificateExpiry(issueDate: string, validityMonths: number | null): string | null {
  return validityMonths && validityMonths > 0 ? addMonthsIso(issueDate, validityMonths) : null
}

export function certificateState(today: string, expiryDate: string | null): { state: CertificateState; daysLeft: number | null } {
  if (!expiryDate) return { state: 'valid', daysLeft: null }
  const daysLeft = daysBetweenIso(today, expiryDate)
  return { state: daysLeft < 0 ? 'expired' : daysLeft <= CERTIFICATE_ALERT_DAYS ? 'expiring' : 'valid', daysLeft }
}

/** New hires get this many days to complete a mandatory course before it counts as overdue. */
export const MANDATORY_GRACE_DAYS = 30

/**
 * One matrix cell (employee × mandatory course).
 *  completed  the newest completion's certificate state (no certificate expiry → compliant)
 *  none       overdue once the grace period after the hire date has passed, else missing
 */
export function matrixCell(today: string, hireDate: string, best: { expiryDate: string | null } | null): MatrixCell {
  if (best) {
    const { state } = certificateState(today, best.expiryDate)
    return state === 'valid' ? 'compliant' : state
  }
  return daysBetweenIso(addDaysIso(hireDate, MANDATORY_GRACE_DAYS), today) > 0 ? 'overdue' : 'missing'
}

export const isCompliant = (c: MatrixCell) => c === 'compliant' || c === 'expiring'
export const isOverdue = (c: MatrixCell) => c === 'overdue' || c === 'expired'

/** Share of compliant cells, 0–100 (whole numbers); 100 when there is nothing to comply with. */
export function compliancePct(cells: readonly MatrixCell[]): number {
  if (!cells.length) return 100
  return Math.round((cells.filter(isCompliant).length / cells.length) * 100)
}
