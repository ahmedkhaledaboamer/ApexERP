import type {
  Assessment,
  CyclePhase,
  CycleType,
  GoalStatus,
  ManagerAssessment,
  PhaseDeadlines,
  ProbationRecommendation,
  RatingLevel,
  TemplateSection,
  TemplateSnapshot,
} from '@/modules/hr/performance/types'
import { DEFAULT_SCALE } from '@/modules/hr/performance/types'
import { weightsOf } from '@/modules/hr/performance/calc'
import type { Tenant } from '@/shared/mocks/tenant'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * HR › Performance stores (docs/API.md › HR › Performance; DB proposal in docs/DB-ALIGNMENT.md › HR (performance)).
 * Ids are unique across companies (PRT- templates, PCY- cycles, PRV- reviews, PGL- goals), so a foreign id
 * answers like a missing one. Synthetic seed per company: three templates, last year's closed annual cycle
 * (acknowledged reviews: the rating distribution has data) and this year's annual cycle in self-review.
 * Probation reviews are not seeded: the tick creates them from the contracts (services/hrPerformance.ts).
 */

export interface PerfTemplateRecord {
  id: string
  name: string
  description: string
  scale: RatingLevel[]
  sections: TemplateSection[]
  goalsEnabled: boolean
  goalsWeight: number
  competencyWeight: number
  selfReview: boolean
  forProbation: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PerfCycleRecord {
  id: string
  name: string
  type: CycleType
  phase: CyclePhase
  templateId: string
  /** Snapshot taken at creation, refreshed until launch; fixed afterwards. */
  template: TemplateSnapshot
  periodStart: string
  periodEnd: string
  departmentIds: string[]
  employeeIds: string[]
  hiredBefore: string | null
  deadlines: PhaseDeadlines
  /** Probation cycles: the contract and probation end date they were created for (dedupe key). */
  probationContractId: string | null
  probationEndDate: string | null
  launchedAt: string | null
  closedAt: string | null
  createdAt: string
  createdBy: string | null
  createdByName: string
  /** Once-only notification marks (`phase:self_review` …). */
  marks: string[]
}

export interface CalibrationEntry {
  rating: number
  previousRating: number | null
  note: string
  by: string
  byName: string
  at: string
}

export interface PerfReviewRecord {
  id: string
  cycleId: string
  employeeId: string
  /** Direct manager (employee id) at launch. */
  managerId: string | null
  self: Assessment
  manager: ManagerAssessment
  /** HR calibration (latest = calibrations[last]); never served to the employee or the manager. */
  calibrations: CalibrationEntry[]
  sharedAt: string | null
  sharedBy: string | null
  acknowledgedAt: string | null
  ackComment: string
  /** Probation: the outcome HR applied when sharing. */
  probationOutcome: ProbationRecommendation | null
  outcomeAppliedAt: string | null
  /** Once-only notification marks (`shared`, `ack`, `due:self_review:2026-11-30` …). */
  marks: string[]
  createdAt: string
}

export interface PerfGoalRecord {
  id: string
  reviewId: string
  cycleId: string
  employeeId: string
  title: string
  description: string
  weight: number
  target: string
  progress: number
  status: GoalStatus
  approved: boolean
  approvedAt: string | null
  approvedBy: string | null
  approvedByName: string | null
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}

/* ---------------- Ids ---------------- */

let seq = 0
export const nextPerfId = (prefix: string) => `${prefix}${++seq}`

/* ---------------- Seed ---------------- */

const ANNUAL_SECTIONS: TemplateSection[] = [
  {
    id: 's-delivery',
    title: 'Delivery & quality',
    questions: [
      { id: 'q-delivery-1', text: 'Delivers agreed work on time and to the expected standard' },
      { id: 'q-delivery-2', text: 'Owns problems and follows them through to a result' },
    ],
  },
  {
    id: 's-collab',
    title: 'Collaboration',
    questions: [
      { id: 'q-collab-1', text: 'Works well with colleagues and other departments' },
      { id: 'q-collab-2', text: 'Communicates clearly and keeps people informed' },
    ],
  },
  {
    id: 's-growth',
    title: 'Growth',
    questions: [
      { id: 'q-growth-1', text: 'Learns new skills and applies them in the role' },
      { id: 'q-growth-2', text: 'Gives and takes feedback constructively' },
    ],
  },
]

const CHECKIN_SECTIONS: TemplateSection[] = [
  {
    id: 's-checkin',
    title: 'How it is going',
    questions: [
      { id: 'q-checkin-1', text: 'Progress on the priorities agreed for the period' },
      { id: 'q-checkin-2', text: 'Teamwork and communication' },
      { id: 'q-checkin-3', text: 'Initiative and problem solving' },
    ],
  },
]

const PROBATION_SECTIONS: TemplateSection[] = [
  {
    id: 's-fit',
    title: 'Role fit',
    questions: [
      { id: 'q-fit-1', text: 'Has learned the role, its tools and processes' },
      { id: 'q-fit-2', text: 'Quality of work meets the standard for the role' },
    ],
  },
  {
    id: 's-conduct',
    title: 'Conduct',
    questions: [
      { id: 'q-conduct-1', text: 'Attendance and punctuality' },
      { id: 'q-conduct-2', text: 'Fits the team and the company’s values' },
    ],
  },
]

interface TemplateSeed {
  key: 'annual' | 'checkin' | 'probation'
  name: string
  description: string
  sections: TemplateSection[]
  goalsEnabled: boolean
  goalsWeight: number
  selfReview: boolean
  forProbation: boolean
}

const TEMPLATE_SEEDS: TemplateSeed[] = [
  { key: 'annual', name: 'Annual review', description: 'Goals (40%) and competencies (60%), with a self-assessment.', sections: ANNUAL_SECTIONS, goalsEnabled: true, goalsWeight: 40, selfReview: true, forProbation: false },
  { key: 'checkin', name: 'Quick check-in', description: 'Competencies only, for mid-year and ad-hoc reviews.', sections: CHECKIN_SECTIONS, goalsEnabled: false, goalsWeight: 0, selfReview: true, forProbation: false },
  { key: 'probation', name: 'Probation review', description: 'The manager’s assessment and recommendation before the probation ends.', sections: PROBATION_SECTIONS, goalsEnabled: false, goalsWeight: 0, selfReview: false, forProbation: true },
]

export function snapshotOf(t: PerfTemplateRecord): TemplateSnapshot {
  return structuredClone({
    id: t.id,
    name: t.name,
    scale: t.scale,
    sections: t.sections,
    goalsEnabled: t.goalsEnabled,
    goalsWeight: t.goalsWeight,
    competencyWeight: t.competencyWeight,
    selfReview: t.selfReview,
  })
}

/** Default templates of a company (seed, and companies created later on first use). */
export function defaultTemplates(companyId: string, at: string): Tenant<PerfTemplateRecord>[] {
  return TEMPLATE_SEEDS.map((s) => ({
    companyId,
    id: nextPerfId('PRT-'),
    name: s.name,
    description: s.description,
    scale: structuredClone(DEFAULT_SCALE),
    sections: structuredClone(s.sections),
    goalsEnabled: s.goalsEnabled,
    ...weightsOf(s.goalsEnabled, s.goalsWeight),
    selfReview: s.selfReview,
    forProbation: s.forProbation,
    active: true,
    createdAt: at,
    updatedAt: at,
  }))
}

/** Deterministic 0…n-1 from a string (synthetic ratings). */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return Math.abs(h)
}

const GOAL_SEEDS: [string, string][] = [
  ['Deliver the agreed priorities of the role', 'All agreed priorities delivered by the period end'],
  ['Improve customer / colleague satisfaction', 'Average feedback score of 4 or more'],
  ['Complete one development course', 'Course completed and applied in the role'],
]
const GOAL_WEIGHTS = [40, 30, 30]

const empty = (): Assessment => ({ answers: [], goalRatings: [], summary: '', submittedAt: null })
const emptyManager = (): ManagerAssessment => ({ ...empty(), recommendedCourseIds: [], recommendation: null, extendMonths: null })

interface Seeded {
  templates: Tenant<PerfTemplateRecord>[]
  cycles: Tenant<PerfCycleRecord>[]
  reviews: Tenant<PerfReviewRecord>[]
  goals: Tenant<PerfGoalRecord>[]
}

function seedAll(): Seeded {
  const out: Seeded = { templates: [], cycles: [], reviews: [], goals: [] }
  for (const co of [APEX_ID, CREST_ID]) {
    const tz = companyById(co)?.regional.timezone ?? 'Asia/Dubai'
    const today = todayIsoIn(tz)
    const year = Number(today.slice(0, 4))
    const at = (days: number) => `${addDaysIso(today, days)}T06:00:00.000Z`
    const templates = defaultTemplates(co, at(-500))
    out.templates.push(...templates)
    const annual = templates[0]
    const people = hrEmployees.filter((e) => e.companyId === co && e.status !== 'terminated' && e.status !== 'onboarding')
    const adminName = co === APEX_ID ? 'Mariam Saeed' : 'Noura Al Qahtani'

    const cycle = (name: string, phase: CyclePhase, periodStart: string, periodEnd: string, deadlines: PhaseDeadlines, launched: string, closed: string | null, hiredBefore: string): Tenant<PerfCycleRecord> => ({
      companyId: co,
      id: nextPerfId('PCY-'),
      name,
      type: 'annual',
      phase,
      templateId: annual.id,
      template: snapshotOf(annual),
      periodStart,
      periodEnd,
      departmentIds: [],
      employeeIds: [],
      hiredBefore,
      deadlines,
      probationContractId: null,
      probationEndDate: null,
      launchedAt: launched,
      closedAt: closed,
      createdAt: launched,
      createdBy: null,
      createdByName: adminName,
      marks: ['phase:goal_setting', 'phase:self_review', ...(closed ? ['phase:manager_review', 'phase:calibration', 'phase:shared'] : [])],
    })

    /* Last year's annual review: closed, every review shared and acknowledged. */
    const lastStart = `${year - 1}-01-01`
    const lastEnd = `${year - 1}-12-31`
    const closedAt = `${year}-01-31T08:00:00.000Z`
    const past = cycle(`Annual review ${year - 1}`, 'closed', lastStart, lastEnd, { goalSetting: `${year - 1}-01-31`, selfReview: `${year}-01-10`, managerReview: `${year}-01-20`, calibration: `${year}-01-27` }, `${year - 1}-01-05T08:00:00.000Z`, closedAt, `${year - 1}-09-30`)
    out.cycles.push(past)

    /* This year's annual review, in self-review (deadline in 12 days). */
    const cur = cycle(`Annual review ${year}`, 'self_review', `${year}-01-01`, `${year}-12-31`, { goalSetting: addDaysIso(today, -5), selfReview: addDaysIso(today, 12), managerReview: addDaysIso(today, 26), calibration: addDaysIso(today, 35) }, at(-30), null, addDaysIso(today, -120))
    out.cycles.push(cur)

    for (const [ci, c] of [past, cur].entries()) {
      people
        .filter((e) => e.hireDate <= (c.hiredBefore ?? '9999'))
        .forEach((e, i) => {
          const rid = nextPerfId('PRV-')
          const goalIds: string[] = []
          GOAL_SEEDS.forEach(([title, target], gi) => {
            const id = nextPerfId('PGL-')
            goalIds.push(id)
            out.goals.push({
              companyId: co,
              id,
              reviewId: rid,
              cycleId: c.id,
              employeeId: e.id,
              title,
              description: '',
              weight: GOAL_WEIGHTS[gi],
              target,
              progress: ci === 0 ? 100 : 25 + ((hash(`${e.id}${gi}`) % 6) * 10),
              status: ci === 0 ? (hash(`${e.id}${gi}m`) % 5 === 0 ? 'missed' : 'completed') : 'on_track',
              approved: true,
              approvedAt: c.launchedAt,
              approvedBy: null,
              approvedByName: 'Manager',
              createdBy: e.userId,
              createdByName: e.fullName,
              createdAt: c.launchedAt!,
              updatedAt: c.launchedAt!,
            })
          })
          const review: Tenant<PerfReviewRecord> = {
            companyId: co,
            id: rid,
            cycleId: c.id,
            employeeId: e.id,
            managerId: e.managerId,
            self: empty(),
            manager: emptyManager(),
            calibrations: [],
            sharedAt: null,
            sharedBy: null,
            acknowledgedAt: null,
            ackComment: '',
            probationOutcome: null,
            outcomeAppliedAt: null,
            marks: [],
            createdAt: c.launchedAt!,
          }
          // Ratings centred on "meets expectations" (a bell-ish curve), deterministic per employee.
          const base = [3, 3, 4, 3, 2, 4, 3, 5, 3, 4][hash(`${e.id}${c.id.length}`) % 10]
          const rate = (k: string) => Math.max(1, Math.min(5, base + ((hash(`${e.id}${k}`) % 3) - 1)))
          const answers = (who: string) => c.template.sections.flatMap((s) => s.questions.map((q) => ({ questionId: q.id, rating: rate(`${who}${q.id}`), comment: '' })))
          const goalRatings = (who: string) => goalIds.map((goalId) => ({ goalId, rating: rate(`${who}${goalId}`), comment: '' }))
          if (ci === 0) {
            review.self = { answers: answers('s'), goalRatings: goalRatings('s'), summary: 'A solid year; I want to grow my scope next year.', submittedAt: `${year}-01-08T09:00:00.000Z` }
            review.manager = { ...emptyManager(), answers: answers('m'), goalRatings: goalRatings('m'), summary: 'Reliable contributor; keep developing ownership of larger pieces of work.', submittedAt: `${year}-01-18T09:00:00.000Z` }
            review.sharedAt = `${year}-01-28T09:00:00.000Z`
            review.acknowledgedAt = `${year}-01-30T09:00:00.000Z`
            review.marks = ['shared', 'ack']
          } else if (i % 3 === 0) {
            review.self = { answers: answers('s'), goalRatings: goalRatings('s'), summary: 'On track with my goals so far.', submittedAt: at(-2) }
          }
          out.reviews.push(review)
        })
    }
  }
  return out
}

const seeded = seedAll()

export const hrPerfTemplates = registerArray<Tenant<PerfTemplateRecord>>('hrPerfTemplates', seeded.templates)
export const hrPerfCycles = registerArray<Tenant<PerfCycleRecord>>('hrPerfCycles', seeded.cycles)
export const hrPerfReviews = registerArray<Tenant<PerfReviewRecord>>('hrPerfReviews', seeded.reviews)
export const hrPerfGoals = registerArray<Tenant<PerfGoalRecord>>('hrPerfGoals', seeded.goals)
registerValue<number>(
  'hrPerfSeq',
  () => seq,
  (v) => {
    seq = v
  },
)

export const emptyAssessment = empty
export const emptyManagerAssessment = emptyManager

/** Templates of a company, seeding the defaults for a company created later (first use). */
export function ensurePerfTemplates(companyId: string, at: string): Tenant<PerfTemplateRecord>[] {
  let rows = hrPerfTemplates.filter((t) => t.companyId === companyId)
  if (!rows.length) {
    hrPerfTemplates.push(...defaultTemplates(companyId, at))
    rows = hrPerfTemplates.filter((t) => t.companyId === companyId)
  }
  return rows
}
