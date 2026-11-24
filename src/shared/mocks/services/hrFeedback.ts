import type { User } from '@/shared/types'
import type {
  FeedbackOptions,
  FeedbackRating,
  FeedbackRound,
  FeedbackSummary,
  Invitation,
  InvitationInput,
  InvitationRow,
  MyFeedback,
  ProviderInput,
  ProviderRow,
  Relationship,
  ReviewFeedback,
  RoundInput,
} from '@/modules/hr/engagement/types'
import { MIN_FEEDBACK_GROUP, RELATIONSHIPS } from '@/modules/hr/engagement/types'
import { groupFeedback } from '@/modules/hr/engagement/calc'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { isRealIsoDate } from '@/shared/lib/zonedTime'
import { departments } from '@/shared/mocks/data/departments'
import { employeeById, employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrPerfCycles, hrPerfReviews } from '@/shared/mocks/data/hrPerformance'
import { engSettingsOf, hrFbProviders, hrFbRounds, nextEngId, type FeedbackProviderRecord, type FeedbackRoundRecord } from '@/shared/mocks/data/hrEngagement'
import { delay } from '@/shared/mocks/server'
import type { Tenant } from '@/shared/mocks/tenant'
import { hrFullUsers } from './hrAccess'
import { markOnce, notifyUsers, visibleReview } from './hrPerformanceCore'
import { activeUserIdOf, canAnswer, conflict, engCtx, forbidden, invalid, isFull, notFound, type EngCtx } from './hrEngagementCore'
import { runEngagementTick } from './hrEngagementTick'

/**
 * HR › 360° feedback (docs/API.md › HR › 360° feedback). Within a performance cycle (attached to a review) or ad hoc.
 *
 * WHO (company from the session; anything else answers 404 like a missing id):
 *   hr        HR full: request for anyone, add providers, decide nominations, close; the aggregated summary, and the
 *             names behind answers only when the company setting allows it
 *   manager   the subject's direct manager (at request time or now), whatever their `hr` scope: the same, without names
 *   subject   the employee: nominates peers (the manager approves); sees their nominations (never who answered or
 *             declined) and the aggregated summary only once their review is shared (ad hoc: once the round closes)
 *   provider  the colleague asked: answers (editable until the round closes) or declines with a reason
 * Aggregation (calc.ts groupFeedback): by relationship group with at least 3 answers, the rest pooled into "Others".
 */

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const ROUND_LINK = (id: string) => `/hr/feedback?round=${encodeURIComponent(id)}`
const INVITE_LINK = (id: string) => `/hr/feedback?invitation=${encodeURIComponent(id)}`
const MAX_PROVIDERS = 20

export const DEFAULT_COMPETENCIES = [
  { id: 'fb-quality', text: 'Delivers high-quality work' },
  { id: 'fb-collaboration', text: 'Collaborates well with others' },
  { id: 'fb-communication', text: 'Communicates clearly' },
  { id: 'fb-ownership', text: 'Takes ownership and follows through' },
  { id: 'fb-growth', text: 'Helps others learn and grow' },
]

function ctxOf(user: User): EngCtx {
  const ctx = engCtx(user)
  runEngagementTick(ctx.co, ctx.now)
  return ctx
}

const deptName = (co: string, id: string | null) => (id ? (departments.find((d) => d.companyId === co && d.id === id)?.name ?? null) : null)
const providersOf = (co: string, roundId: string) => hrFbProviders.filter((p) => p.companyId === co && p.roundId === roundId)

type Viewer = 'hr' | 'manager' | 'subject'

function viewerOf(ctx: EngCtx, r: FeedbackRoundRecord): Viewer | null {
  const me = ctx.self?.id
  if (me && r.subjectEmployeeId === me) return 'subject'
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  if (me && (r.managerId === me || subject?.managerId === me)) return 'manager'
  if (isFull(ctx)) return 'hr'
  return null
}

function visibleRound(ctx: EngCtx, id: string, allow: Viewer[] = ['hr', 'manager', 'subject']): { r: Tenant<FeedbackRoundRecord>; viewer: Viewer } {
  const r = hrFbRounds.find((x) => x.companyId === ctx.co && x.id === id)
  const viewer = r ? viewerOf(ctx, r) : null
  if (!r || !viewer) throw notFound()
  if (!allow.includes(viewer)) throw forbidden(viewer === 'subject' ? 'Your manager or HR manages your feedback round.' : 'Only the employee can nominate their peers.')
  return { r, viewer }
}

/** May the employee see the summary yet? After the review is shared (ad hoc: after the round closes). */
function sharedWithSubject(co: string, r: FeedbackRoundRecord): boolean {
  if (r.reviewId) return !!hrPerfReviews.find((x) => x.companyId === co && x.id === r.reviewId)?.sharedAt
  return r.status === 'closed'
}

function roundView(ctx: EngCtx, r: Tenant<FeedbackRoundRecord>, viewer: Viewer): FeedbackRound {
  const ps = providersOf(ctx.co, r.id)
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  const cycle = r.cycleId ? hrPerfCycles.find((c) => c.companyId === ctx.co && c.id === r.cycleId) : undefined
  const open = r.status === 'open'
  const manages = viewer === 'hr' || viewer === 'manager'
  const invited = ps.filter((p) => p.status === 'pending' || p.status === 'submitted' || p.status === 'declined')
  return {
    id: r.id,
    subjectEmployeeId: r.subjectEmployeeId,
    subjectName: subject?.fullName ?? '—',
    departmentName: deptName(ctx.co, subject?.departmentId ?? null),
    cycleId: r.cycleId,
    cycleName: cycle?.name ?? null,
    reviewId: r.reviewId,
    deadline: r.deadline,
    status: r.status,
    allowNominations: r.allowNominations,
    competencies: structuredClone(r.competencies),
    counts: {
      invited: invited.length,
      // The employee sees only how many were asked: never who answered, declined or is still pending.
      submitted: manages ? ps.filter((p) => p.status === 'submitted').length : 0,
      declined: manages ? ps.filter((p) => p.status === 'declined').length : 0,
      pending: manages ? ps.filter((p) => p.status === 'pending').length : 0,
      nominated: ps.filter((p) => p.status === 'nominated').length,
    },
    viewer,
    providers: manages
      ? ps.map<ProviderRow>((p) => ({
          id: p.id,
          employeeId: p.employeeId,
          name: employeeById(ctx.co, p.employeeId)?.fullName ?? '—',
          relationship: p.relationship,
          status: p.status,
          nominatedBy: p.nominatedBy,
          declineReason: p.declineReason,
        }))
      : [],
    nominations:
      viewer === 'subject'
        ? ps
            .filter((p) => p.nominatedBy === 'employee')
            .map((p) => ({ employeeId: p.employeeId, name: employeeById(ctx.co, p.employeeId)?.fullName ?? '—', status: p.status === 'nominated' ? 'awaiting' : p.status === 'rejected' ? 'not_approved' : 'approved' }))
        : [],
    summaryVisible: viewer === 'subject' ? sharedWithSubject(ctx.co, r) : true,
    requestedByName: r.requestedByName,
    createdAt: r.createdAt,
    can: {
      addProviders: manages && open,
      decideNominations: manages && open && ps.some((p) => p.status === 'nominated'),
      nominate: viewer === 'subject' && open && r.allowNominations,
      close: manages && open,
    },
  }
}

function summaryOf(ctx: EngCtx, r: Tenant<FeedbackRoundRecord>, viewer: Viewer): FeedbackSummary {
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  const submitted = providersOf(ctx.co, r.id).filter((p) => p.status === 'submitted')
  const base = { roundId: r.id, subjectName: subject?.fullName ?? '—', responses: submitted.length, minGroup: MIN_FEEDBACK_GROUP }
  const named =
    viewer === 'hr' && engSettingsOf(ctx.co).feedbackNamesVisibleToHr
      ? submitted
          .map((p) => ({ providerName: employeeById(ctx.co, p.employeeId)?.fullName ?? '—', relationship: p.relationship, ratings: structuredClone(p.ratings), strengths: p.strengths, improvements: p.improvements }))
          .sort((a, b) => a.providerName.localeCompare(b.providerName))
      : null
  if (viewer === 'subject' && !sharedWithSubject(ctx.co, r)) {
    return { ...base, responses: 0, available: false, reason: r.reviewId ? 'Feedback from colleagues appears here once your review is shared.' : 'Feedback appears here once the round closes.', groups: [], strengths: [], improvements: [], named: null }
  }
  if (submitted.length < MIN_FEEDBACK_GROUP) {
    return { ...base, available: false, reason: `Not enough responses to show (${submitted.length} of at least ${MIN_FEEDBACK_GROUP}).`, groups: [], strengths: [], improvements: [], named }
  }
  const texts = (k: 'strengths' | 'improvements') => submitted.map((p) => p[k].trim()).filter(Boolean).sort((a, b) => a.localeCompare(b))
  return {
    ...base,
    available: true,
    reason: null,
    groups: groupFeedback(submitted.map((p) => ({ relationship: p.relationship, ratings: p.ratings })), r.competencies),
    strengths: texts('strengths'),
    improvements: texts('improvements'),
    named,
  }
}

/* ======================= Options, my feedback ======================= */

export async function getOptions(user: User): Promise<FeedbackOptions> {
  const ctx = ctxOf(user)
  // A colleague directory (names, titles, departments) to pick feedback providers from: every employee may nominate.
  return delay({
    colleagues: employeesOf(ctx.co)
      .filter((e) => canAnswer(e) && e.id !== ctx.self?.id)
      .map((e) => ({ id: e.id, name: e.fullName, jobTitle: e.jobTitle, departmentName: deptName(ctx.co, e.departmentId) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    minGroup: MIN_FEEDBACK_GROUP,
    today: ctx.today,
  })
}

const asInvited = (p: FeedbackProviderRecord) => p.status === 'pending' || p.status === 'submitted' || p.status === 'declined'

export async function getMyFeedback(user: User): Promise<MyFeedback> {
  const ctx = ctxOf(user)
  const me = ctx.self
  if (!me) return delay({ employeeLinked: false, invitations: [], aboutMe: [] })
  const invitations: InvitationRow[] = []
  for (const p of hrFbProviders) {
    if (p.companyId !== ctx.co || p.employeeId !== me.id || !asInvited(p)) continue
    const r = hrFbRounds.find((x) => x.companyId === ctx.co && x.id === p.roundId)
    if (!r) continue
    invitations.push({
      id: p.id,
      roundId: r.id,
      subjectName: employeeById(ctx.co, r.subjectEmployeeId)?.fullName ?? '—',
      relationship: p.relationship,
      status: p.status,
      deadline: r.deadline,
      overdue: p.status === 'pending' && daysBetweenIso(ctx.today, r.deadline) < 0,
      roundStatus: r.status,
    })
  }
  const order = { pending: 0, submitted: 1, declined: 2, nominated: 3, rejected: 4 }
  invitations.sort((a, b) => order[a.status] - order[b.status] || a.deadline.localeCompare(b.deadline))
  const aboutMe = hrFbRounds.filter((r) => r.companyId === ctx.co && r.subjectEmployeeId === me.id).map((r) => roundView(ctx, r, 'subject'))
  return delay({ employeeLinked: true, invitations, aboutMe: aboutMe.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
}

/* ======================= Rounds (HR / the manager) ======================= */

export async function listRounds(user: User): Promise<FeedbackRound[]> {
  const ctx = ctxOf(user)
  const out: FeedbackRound[] = []
  for (const r of hrFbRounds) {
    if (r.companyId !== ctx.co) continue
    const viewer = viewerOf(ctx, r)
    if (viewer === 'hr' || viewer === 'manager') out.push(roundView(ctx, r, viewer))
  }
  return delay(out.sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1)))
}

export async function getRound(user: User, id: string): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  const { r, viewer } = visibleRound(ctx, id)
  return delay(roundView(ctx, r, viewer))
}

function cleanProviders(ctx: EngCtx, r: Pick<FeedbackRoundRecord, 'id' | 'subjectEmployeeId'>, v: unknown, defaultRel: Relationship = 'peer'): ProviderInput[] {
  const out: ProviderInput[] = []
  const existing = new Set(providersOf(ctx.co, r.id).filter((p) => p.status !== 'rejected').map((p) => p.employeeId))
  for (const raw of arr(v)) {
    const x = (raw && typeof raw === 'object' ? raw : { employeeId: raw }) as Record<string, unknown>
    const e = typeof x.employeeId === 'string' ? employeeById(ctx.co, x.employeeId) : undefined
    if (!e || !canAnswer(e)) throw invalid('Unknown colleague (or without an active login).', 'validation_failed', { field: 'providers' })
    if (e.id === r.subjectEmployeeId) throw invalid('The employee can’t give feedback on themself here.', 'validation_failed', { field: 'providers' })
    if (existing.has(e.id) || out.some((o) => o.employeeId === e.id)) continue
    const relationship = RELATIONSHIPS.find((rel) => rel === x.relationship) ?? defaultRel
    out.push({ employeeId: e.id, relationship })
  }
  if (existing.size + out.length > MAX_PROVIDERS) throw invalid(`A round asks at most ${MAX_PROVIDERS} colleagues.`, 'too_many_providers')
  return out
}

function invite(ctx: EngCtx, r: Tenant<FeedbackRoundRecord>, p: Tenant<FeedbackProviderRecord>): void {
  p.status = 'pending'
  p.invitedAt = ctx.stamp
  if (!markOnce(p, 'invited')) return
  const to = activeUserIdOf(ctx.co, p.employeeId)
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  if (to) notifyUsers(ctx.co, [to], `Feedback request: ${subject?.fullName ?? 'a colleague'}`, `Your answers are shared anonymously, grouped with others. Please answer by ${r.deadline}.`, INVITE_LINK(p.id), ctx.stamp)
}

function addProviderRows(ctx: EngCtx, r: Tenant<FeedbackRoundRecord>, list: ProviderInput[], by: 'employee' | 'manager' | 'hr'): void {
  for (const x of list) {
    const p: Tenant<FeedbackProviderRecord> = {
      companyId: ctx.co,
      id: nextEngId('FBP-'),
      roundId: r.id,
      employeeId: x.employeeId,
      relationship: x.relationship,
      status: 'nominated',
      nominatedBy: by,
      ratings: [],
      strengths: '',
      improvements: '',
      declineReason: null,
      invitedAt: null,
      submittedAt: null,
      marks: [],
    }
    hrFbProviders.push(p)
    if (by !== 'employee') invite(ctx, r, p)
  }
}

export async function createRound(user: User, input: Partial<RoundInput> | null): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  if (!input) throw invalid('Send the feedback request.')
  const subject = typeof input.subjectEmployeeId === 'string' ? employeeById(ctx.co, input.subjectEmployeeId) : undefined
  if (!subject || subject.status === 'terminated') throw invalid('Unknown employee.', 'validation_failed', { field: 'subject_employee_id' })
  const me = ctx.self?.id
  const isManager = !!me && subject.managerId === me
  if (subject.id === me) throw forbidden('Ask your manager or HR to request feedback for you.')
  if (!isManager && !isFull(ctx)) throw forbidden('Only HR or the employee’s manager can request 360° feedback.')
  let reviewId: string | null = null
  let cycleId: string | null = null
  let competencies = structuredClone(DEFAULT_COMPETENCIES)
  if (input.reviewId) {
    const review = hrPerfReviews.find((x) => x.companyId === ctx.co && x.id === input.reviewId && x.employeeId === subject.id)
    if (!review) throw invalid('Unknown review.', 'validation_failed', { field: 'review_id' })
    const { cycle } = visibleReview(ctx, review.id)
    if (cycle.phase === 'closed') throw conflict('This review cycle is closed.', 'cycle_closed')
    if (hrFbRounds.some((x) => x.companyId === ctx.co && x.reviewId === review.id && x.status === 'open')) throw conflict('Feedback was already requested for this review.', 'round_exists')
    reviewId = review.id
    cycleId = cycle.id
    const fromTemplate = cycle.template.sections.flatMap((s) => s.questions.map((q) => ({ id: q.id, text: q.text })))
    if (fromTemplate.length) competencies = fromTemplate
  }
  const deadline = input.deadline === undefined ? addDaysIso(ctx.today, 14) : typeof input.deadline === 'string' && isRealIsoDate(input.deadline) ? input.deadline : null
  if (!deadline || deadline < ctx.today) throw invalid('Pick a deadline today or later.', 'validation_failed', { field: 'deadline' })
  const r: Tenant<FeedbackRoundRecord> = {
    companyId: ctx.co,
    id: nextEngId('FBR-'),
    subjectEmployeeId: subject.id,
    managerId: subject.managerId,
    cycleId,
    reviewId,
    competencies,
    deadline,
    status: 'open',
    allowNominations: typeof input.allowNominations === 'boolean' ? input.allowNominations : true,
    requestedBy: user.id,
    requestedByName: user.name,
    createdAt: ctx.stamp,
    closedAt: null,
    marks: [],
  }
  const providers = cleanProviders(ctx, r, input.providers)
  hrFbRounds.push(r)
  addProviderRows(ctx, r, providers, isManager ? 'manager' : 'hr')
  if (r.allowNominations && markOnce(r, 'nominate')) {
    const to = activeUserIdOf(ctx.co, subject.id)
    if (to) notifyUsers(ctx.co, [to], '360° feedback requested for you', `Nominate colleagues who know your work by ${deadline}; your manager approves the nominations.`, '/hr/feedback?tab=about', ctx.stamp)
  }
  return delay(roundView(ctx, r, viewerOf(ctx, r) ?? 'hr'))
}

export async function addProviders(user: User, id: string, input: { providers?: unknown } | null): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  const { r, viewer } = visibleRound(ctx, id, ['hr', 'manager'])
  if (r.status !== 'open') throw conflict('This feedback round is closed.', 'round_closed')
  const list = cleanProviders(ctx, r, input?.providers)
  if (!list.length) throw invalid('Pick at least one colleague not asked yet.', 'validation_failed', { field: 'providers' })
  addProviderRows(ctx, r, list, viewer === 'manager' ? 'manager' : 'hr')
  return delay(roundView(ctx, r, viewer))
}

export async function nominate(user: User, id: string, input: { employeeIds?: unknown; providers?: unknown } | null): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  const { r } = visibleRound(ctx, id, ['subject'])
  if (r.status !== 'open') throw conflict('This feedback round is closed.', 'round_closed')
  if (!r.allowNominations) throw conflict('Nominations are off for this round.', 'nominations_off')
  const list = cleanProviders(ctx, r, input?.providers ?? input?.employeeIds)
  if (!list.length) throw invalid('Pick at least one colleague not nominated yet.', 'validation_failed', { field: 'providers' })
  if (providersOf(ctx.co, r.id).filter((p) => p.nominatedBy === 'employee').length + list.length > 10) throw invalid('You can nominate at most 10 colleagues.', 'too_many_nominations')
  addProviderRows(ctx, r, list, 'employee')
  // The manager (else HR) approves: told once per batch.
  const managerUser = r.managerId ? activeUserIdOf(ctx.co, r.managerId) : null
  const to = managerUser ? [managerUser] : hrFullUsers(ctx.co).map((u) => u.id)
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  notifyUsers(ctx.co, to, `${subject?.fullName ?? 'An employee'} nominated ${list.length} colleague${list.length === 1 ? '' : 's'} for feedback`, 'Approve or decline the nominations.', ROUND_LINK(r.id), ctx.stamp)
  return delay(roundView(ctx, r, 'subject'))
}

export async function decideNominations(user: User, id: string, input: { approveIds?: unknown; rejectIds?: unknown } | null): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  const { r, viewer } = visibleRound(ctx, id, ['hr', 'manager'])
  if (r.status !== 'open') throw conflict('This feedback round is closed.', 'round_closed')
  const approve = new Set(arr(input?.approveIds).filter((x): x is string => typeof x === 'string'))
  const reject = new Set(arr(input?.rejectIds).filter((x): x is string => typeof x === 'string'))
  if (!approve.size && !reject.size) throw invalid('Pick the nominations to approve or decline.')
  const ps = providersOf(ctx.co, r.id)
  for (const pid of [...approve, ...reject]) {
    const p = ps.find((x) => x.id === pid)
    if (!p || p.status !== 'nominated') throw invalid('Unknown nomination (or already decided).', 'validation_failed', { field: 'approve_ids' })
  }
  for (const p of ps) {
    if (approve.has(p.id)) invite(ctx, r, p)
    else if (reject.has(p.id)) p.status = 'rejected'
  }
  return delay(roundView(ctx, r, viewer))
}

export async function closeRound(user: User, id: string): Promise<FeedbackRound> {
  const ctx = ctxOf(user)
  const { r, viewer } = visibleRound(ctx, id, ['hr', 'manager'])
  if (r.status !== 'open') throw conflict('This feedback round is closed already.', 'round_closed')
  r.status = 'closed'
  r.closedAt = ctx.stamp
  return delay(roundView(ctx, r, viewer))
}

export async function getSummary(user: User, id: string): Promise<FeedbackSummary> {
  const ctx = ctxOf(user)
  const { r, viewer } = visibleRound(ctx, id)
  return delay(summaryOf(ctx, r, viewer))
}

/** The 360° panel of a performance review: HR and the reviewer get the round + summary; the employee once shared. */
export async function getReviewFeedback(user: User, reviewId: string): Promise<ReviewFeedback> {
  const ctx = ctxOf(user)
  const { review, cycle, rel } = visibleReview(ctx, reviewId)
  const rounds = hrFbRounds.filter((x) => x.companyId === ctx.co && x.reviewId === review.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latest = rounds[0]
  if (rel.own) {
    const viewer: Viewer = 'subject'
    return delay({ reviewId, subjectEmployeeId: review.employeeId, round: latest ? roundView(ctx, latest, viewer) : null, summary: latest ? summaryOf(ctx, latest, viewer) : null, canRequest: false })
  }
  if (!rel.hr && !rel.manager) return delay({ reviewId, subjectEmployeeId: review.employeeId, round: null, summary: null, canRequest: false })
  const me = ctx.self?.id
  const direct = !!me && (review.managerId === me || employeeById(ctx.co, review.employeeId)?.managerId === me)
  const viewer: Viewer = direct || !isFull(ctx) ? 'manager' : 'hr'
  const canRequest = cycle.phase !== 'closed' && !review.sharedAt && !rounds.some((x) => x.status === 'open') && (isFull(ctx) || employeeById(ctx.co, review.employeeId)?.managerId === ctx.self?.id)
  return delay({ reviewId, subjectEmployeeId: review.employeeId, round: latest ? roundView(ctx, latest, viewer) : null, summary: latest ? summaryOf(ctx, latest, viewer) : null, canRequest })
}

/* ======================= Invitations (the colleague asked) ======================= */

function myInvitation(ctx: EngCtx, id: string): { p: Tenant<FeedbackProviderRecord>; r: Tenant<FeedbackRoundRecord> } {
  const p = hrFbProviders.find((x) => x.companyId === ctx.co && x.id === id)
  if (!p || !ctx.self || p.employeeId !== ctx.self.id || !asInvited(p)) throw notFound()
  const r = hrFbRounds.find((x) => x.companyId === ctx.co && x.id === p.roundId)
  if (!r) throw notFound()
  return { p, r }
}

function invitationView(ctx: EngCtx, p: Tenant<FeedbackProviderRecord>, r: Tenant<FeedbackRoundRecord>): Invitation {
  const subject = employeeById(ctx.co, r.subjectEmployeeId)
  return {
    id: p.id,
    roundId: r.id,
    subjectName: subject?.fullName ?? '—',
    subjectJobTitle: subject?.jobTitle ?? '',
    relationship: p.relationship,
    deadline: r.deadline,
    status: p.status,
    competencies: structuredClone(r.competencies),
    ratings: structuredClone(p.ratings),
    strengths: p.strengths,
    improvements: p.improvements,
    declineReason: p.declineReason,
    editable: r.status === 'open' && (p.status === 'pending' || p.status === 'submitted'),
  }
}

export async function getInvitation(user: User, id: string): Promise<Invitation> {
  const ctx = ctxOf(user)
  const { p, r } = myInvitation(ctx, id)
  return delay(invitationView(ctx, p, r))
}

export async function answerInvitation(user: User, id: string, input: Partial<InvitationInput> | null): Promise<Invitation> {
  const ctx = ctxOf(user)
  const { p, r } = myInvitation(ctx, id)
  if (r.status !== 'open') throw conflict('This feedback round is closed.', 'round_closed')
  if (p.status === 'declined') throw conflict('You declined this request.', 'declined')
  if (!input) throw invalid('Send your feedback.')
  const ids = new Set(r.competencies.map((c) => c.id))
  const given = arr(input.ratings).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
  const ratings: FeedbackRating[] = r.competencies.map((c) => {
    const raw = given.find((g) => g.competencyId === c.id)
    const v = raw?.rating
    if (v !== undefined && v !== null && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) throw invalid('Ratings go from 1 to 5.', 'validation_failed', { field: c.id })
    return { competencyId: c.id, rating: typeof v === 'number' ? v : null }
  })
  if (given.some((g) => typeof g.competencyId === 'string' && !ids.has(g.competencyId))) throw invalid('Unknown competency.', 'validation_failed', { field: 'ratings' })
  p.ratings = ratings
  if (input.strengths !== undefined) p.strengths = str(input.strengths, 2000)
  if (input.improvements !== undefined) p.improvements = str(input.improvements, 2000)
  if (input.submit) {
    if (!ratings.some((x) => x.rating !== null)) throw invalid('Rate at least one competency.', 'answer_required')
    p.status = 'submitted'
    p.submittedAt = ctx.stamp
  }
  return delay(invitationView(ctx, p, r))
}

export async function declineInvitation(user: User, id: string, input: { reason?: unknown } | null): Promise<Invitation> {
  const ctx = ctxOf(user)
  const { p, r } = myInvitation(ctx, id)
  if (r.status !== 'open') throw conflict('This feedback round is closed.', 'round_closed')
  if (p.status !== 'pending') throw conflict(p.status === 'declined' ? 'You declined this request already.' : 'You answered this request already.', 'not_pending')
  const reason = str(input?.reason, 500)
  if (!reason) throw invalid('Say briefly why you decline.', 'validation_failed', { field: 'reason' })
  p.status = 'declined'
  p.declineReason = reason
  if (markOnce(p, 'declined')) {
    const managerUser = r.managerId ? activeUserIdOf(ctx.co, r.managerId) : null
    const to = r.requestedBy ? [r.requestedBy] : managerUser ? [managerUser] : hrFullUsers(ctx.co).map((u) => u.id)
    const subject = employeeById(ctx.co, r.subjectEmployeeId)
    notifyUsers(ctx.co, to, `A feedback request for ${subject?.fullName ?? 'an employee'} was declined`, `Reason: ${reason.slice(0, 200)}`, ROUND_LINK(r.id), ctx.stamp)
  }
  return delay(invitationView(ctx, p, r))
}
