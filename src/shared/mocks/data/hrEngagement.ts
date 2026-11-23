import type {
  Answer,
  Audience,
  FeedbackCompetency,
  FeedbackRating,
  Language,
  ProviderStatus,
  Recurrence,
  Relationship,
  RoundStatus,
  SurveyKind,
  SurveyQuestion,
  SurveyStatus,
  SurveyTemplate,
  TemplateKey,
  TenureBand,
} from '@/modules/hr/engagement/types'
import { addMonthsIso, tenureBandOf } from '@/modules/hr/engagement/calc'
import type { Tenant } from '@/shared/mocks/tenant'
import { addDaysIso, todayIsoIn } from '@/shared/lib/companyDay'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrPerfCycles, hrPerfReviews } from '@/shared/mocks/data/hrPerformance'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'

/**
 * HR › Engagement surveys and 360° feedback stores (docs/API.md › HR › Engagement surveys / 360° feedback; DB proposal
 * in docs/DB-ALIGNMENT.md › HR (engagement)). Ids are unique across companies (ESV- surveys, FBR- rounds, FBP-
 * providers; anonymous responses get a random ERS- id), so a foreign id answers like a missing one.
 *
 * ANONYMITY BY STORAGE: a response of an anonymous survey has `respondentEmployeeId: null`; who answered is only in
 * `hr.engParticipants` (a "has responded" marker for reminders, with no link to the answers). The employee edits
 * their answers until the survey closes through `sealedKey`, a keyed one-way hash of (company, survey, employee)
 * whose key the backend keeps outside the database (here: a constant). Anonymous responses get a random id, are
 * stored at a random position and carry the day only (no time), so neither order nor time links them to a marker.
 * Department and tenure band are kept for the breakdowns (the API suppresses groups under 5).
 */

/* ======================= Templates (built in, the same for every company) ======================= */

const likert = (id: string, driver: SurveyQuestion['driver'], text: string, textAr: string): SurveyQuestion => ({ id, type: 'likert', text, textAr, driver, options: [], required: true })
const text = (id: string, t: string, textAr: string, required = false): SurveyQuestion => ({ id, type: 'text', text: t, textAr, driver: null, options: [], required })
const nps = (id: string, t: string, textAr: string): SurveyQuestion => ({ id, type: 'nps', text: t, textAr, driver: null, options: [], required: true })
const choice = (id: string, type: 'single' | 'multi', t: string, textAr: string, options: [string, string, string][], required = true): SurveyQuestion => ({
  id,
  type,
  text: t,
  textAr,
  driver: null,
  options: options.map(([oid, o, oAr]) => ({ id: oid, text: o, textAr: oAr })),
  required,
})

export const ENPS_QUESTION_ID = 'enps'

export const SURVEY_TEMPLATES: SurveyTemplate[] = [
  {
    key: 'enps_pulse',
    name: 'eNPS pulse',
    description: 'One question and a why: the employee Net Promoter Score. Short enough to repeat every month or quarter.',
    kind: 'enps',
    anonymous: true,
    recurrence: 'quarterly',
    durationDays: 10,
    questions: [
      nps(ENPS_QUESTION_ID, 'How likely are you to recommend working here to a friend?', 'ما مدى احتمال أن توصي صديقًا بالعمل هنا؟'),
      text('enps-why', 'What is the main reason for your score?', 'ما السبب الرئيسي لتقييمك؟'),
    ],
  },
  {
    key: 'quarterly_engagement',
    name: 'Quarterly engagement',
    description: '12 statements on six drivers (manager, growth, recognition, workload, wellbeing, communication), the eNPS question and one open question.',
    kind: 'engagement',
    anonymous: true,
    recurrence: 'quarterly',
    durationDays: 14,
    questions: [
      likert('eng-manager-1', 'manager', 'My manager gives me useful feedback on my work.', 'يقدم لي مديري ملاحظات مفيدة حول عملي.'),
      likert('eng-manager-2', 'manager', 'I trust my manager to support me when I need it.', 'أثق بأن مديري سيدعمني عند الحاجة.'),
      likert('eng-growth-1', 'growth', 'I can see a path to grow my career here.', 'أرى مسارًا واضحًا لتطوري المهني هنا.'),
      likert('eng-growth-2', 'growth', 'I have opportunities to learn new skills.', 'لدي فرص لتعلم مهارات جديدة.'),
      likert('eng-recognition-1', 'recognition', 'I am recognised when I do good work.', 'يتم تقديري عندما أقوم بعمل جيد.'),
      likert('eng-recognition-2', 'recognition', 'My contributions are valued by the team.', 'مساهماتي محل تقدير من الفريق.'),
      likert('eng-workload-1', 'workload', 'My workload is manageable.', 'حجم العمل المطلوب مني معقول.'),
      likert('eng-workload-2', 'workload', 'I have the tools and resources I need to do my job.', 'لدي الأدوات والموارد التي أحتاجها لأداء عملي.'),
      likert('eng-wellbeing-1', 'wellbeing', 'I can balance my work and personal life.', 'أستطيع الموازنة بين عملي وحياتي الشخصية.'),
      likert('eng-wellbeing-2', 'wellbeing', 'I feel comfortable raising concerns at work.', 'أشعر بالراحة عند طرح مخاوفي في العمل.'),
      likert('eng-communication-1', 'communication', 'I know what is going on in the company.', 'أعرف ما يحدث في الشركة.'),
      likert('eng-communication-2', 'communication', 'Leadership communicates openly and honestly.', 'تتواصل القيادة بانفتاح وصدق.'),
      nps(ENPS_QUESTION_ID, 'How likely are you to recommend working here to a friend?', 'ما مدى احتمال أن توصي صديقًا بالعمل هنا؟'),
      text('eng-improve', 'What one thing would most improve working here?', 'ما الشيء الوحيد الذي سيحسن العمل هنا أكثر من غيره؟'),
    ],
  },
  {
    key: 'onboarding_check_in',
    name: 'Onboarding check-in (30 / 60 / 90 days)',
    description: 'For new joiners at 30, 60 and 90 days: did they get what they need, is the role as expected, do they feel welcome.',
    kind: 'onboarding',
    anonymous: false,
    recurrence: 'none',
    durationDays: 7,
    questions: [
      choice('onb-milestone', 'single', 'Which check-in is this?', 'أي مرحلة هذه؟', [
        ['d30', '30 days', '30 يومًا'],
        ['d60', '60 days', '60 يومًا'],
        ['d90', '90 days', '90 يومًا'],
      ]),
      likert('onb-tools', 'workload', 'I have everything I need to do my job.', 'لدي كل ما أحتاجه لأداء عملي.'),
      likert('onb-role', 'growth', 'My role is what I expected when I joined.', 'دوري كما توقعته عند انضمامي.'),
      likert('onb-welcome', 'wellbeing', 'I feel welcome in my team.', 'أشعر بالترحيب في فريقي.'),
      likert('onb-manager', 'manager', 'My manager has made time for me.', 'خصص مديري وقتًا لي.'),
      text('onb-improve', 'What could we do better for the next joiner?', 'ما الذي يمكننا تحسينه للموظف الجديد القادم؟'),
    ],
  },
  {
    key: 'exit',
    name: 'Exit survey',
    description: 'Why people leave and what would have kept them. Sent to the leaver when they move to notice; answers are seen by HR only.',
    kind: 'exit',
    anonymous: false,
    recurrence: 'none',
    durationDays: 14,
    questions: [
      choice('exit-reason', 'single', 'What is the main reason you are leaving?', 'ما السبب الرئيسي لمغادرتك؟', [
        ['growth', 'Career growth', 'التطور المهني'],
        ['pay', 'Pay and benefits', 'الراتب والمزايا'],
        ['manager', 'My manager', 'مديري'],
        ['workload', 'Workload', 'حجم العمل'],
        ['relocation', 'Relocation or personal reasons', 'الانتقال أو أسباب شخصية'],
        ['other', 'Something else', 'سبب آخر'],
      ]),
      likert('exit-fair', 'manager', 'I was treated fairly here.', 'تمت معاملتي بعدل هنا.'),
      choice('exit-liked', 'multi', 'What did you like most?', 'ما الذي أعجبك أكثر؟', [
        ['team', 'My team', 'فريقي'],
        ['work', 'The work itself', 'طبيعة العمل'],
        ['learning', 'Learning', 'التعلم'],
        ['flexibility', 'Flexibility', 'المرونة'],
        ['pay', 'Pay and benefits', 'الراتب والمزايا'],
      ], false),
      nps(ENPS_QUESTION_ID, 'How likely are you to recommend working here to a friend?', 'ما مدى احتمال أن توصي صديقًا بالعمل هنا؟'),
      text('exit-stay', 'What would have made you stay?', 'ما الذي كان سيجعلك تبقى؟'),
    ],
  },
]

export const templateByKey = (key: unknown) => SURVEY_TEMPLATES.find((t) => t.key === key)

/* ======================= Records ======================= */

export interface SurveyRecord {
  id: string
  name: string
  kind: SurveyKind
  templateKey: TemplateKey | null
  anonymous: boolean
  status: SurveyStatus
  questions: SurveyQuestion[]
  audience: Audience
  opensOn: string
  closesOn: string
  recurrence: Recurrence
  seriesId: string
  wave: number
  /** Frozen when the survey opens. */
  targetEmployeeIds: string[]
  /** Exit / onboarding: the one employee it was sent for. */
  subjectEmployeeId: string | null
  journeyId: string | null
  launchedAt: string | null
  closedAt: string | null
  createdAt: string
  createdBy: string | null
  createdByName: string
  /** Once-only notification marks (`open`, `mid`, `last`) and the recurrence mark (`next:<date>`). */
  marks: string[]
}

export interface ResponseRecord {
  id: string
  surveyId: string
  /** Null for an anonymous survey (always). */
  respondentEmployeeId: string | null
  /** Anonymous surveys: keyed hash of (company, survey, employee) to let the employee edit until close. */
  sealedKey: string | null
  departmentId: string | null
  tenureBand: TenureBand
  answers: Answer[]
  language: Language
  /** Company calendar day only (no time: anonymous answers can't be matched to a marker by time). */
  submittedOn: string
}

/** "Has responded" marker (reminders and response rate only; never linked to the answers). */
export interface ParticipantRecord {
  surveyId: string
  employeeId: string
}

export interface EngSettingsRecord {
  feedbackNamesVisibleToHr: boolean
  exitSurveyAuto: boolean
}

export interface FeedbackRoundRecord {
  id: string
  subjectEmployeeId: string
  /** The subject's direct manager (employee id) when the round was created. */
  managerId: string | null
  cycleId: string | null
  reviewId: string | null
  competencies: FeedbackCompetency[]
  deadline: string
  status: RoundStatus
  allowNominations: boolean
  requestedBy: string | null
  requestedByName: string
  createdAt: string
  closedAt: string | null
  marks: string[]
}

export interface FeedbackProviderRecord {
  id: string
  roundId: string
  employeeId: string
  relationship: Relationship
  status: ProviderStatus
  nominatedBy: 'employee' | 'manager' | 'hr'
  ratings: FeedbackRating[]
  strengths: string
  improvements: string
  declineReason: string | null
  invitedAt: string | null
  submittedAt: string | null
  marks: string[]
}

/* ---------------- Ids and the sealed key ---------------- */

let seq = 0
export const nextEngId = (prefix: string) => `${prefix}${++seq}`

/** Random id for an anonymous response (no sequence that follows the order people answered in). */
export const randomResponseId = () => `ERS-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`

/** The backend keeps this key in its secret store, never in the database. */
const SEAL_KEY = 'apex-eng-seal-v1'

/** Keyed one-way hash (two FNV-1a passes) of the respondent of an anonymous survey. */
export function sealKey(companyId: string, surveyId: string, employeeId: string): string {
  const input = `${SEAL_KEY}|${companyId}|${surveyId}|${employeeId}|${SEAL_KEY}`
  let a = 2166136261
  let b = 0x811c9dc5 ^ 0x5bd1e995
  for (let i = 0; i < input.length; i++) {
    a = Math.imul(a ^ input.charCodeAt(i), 16777619) >>> 0
    b = Math.imul(b ^ input.charCodeAt(input.length - 1 - i), 16777619) >>> 0
  }
  return `${a.toString(36)}${b.toString(36)}`
}

/** Inserts a row at a random position (anonymous responses: storage order says nothing). */
export function insertAtRandom<T>(arr: T[], row: T): void {
  arr.splice(Math.floor(Math.random() * (arr.length + 1)), 0, row)
}

/* ======================= Seed ======================= */

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return Math.abs(h)
}

interface Seeded {
  surveys: Tenant<SurveyRecord>[]
  responses: Tenant<ResponseRecord>[]
  participants: Tenant<ParticipantRecord>[]
  rounds: Tenant<FeedbackRoundRecord>[]
  providers: Tenant<FeedbackProviderRecord>[]
}

interface CompanySeed {
  admin: string
  adminName: string
  /** Users who answered the two closed eNPS waves, with their scores (wave 1, wave 2). */
  enps: [string, number, number][]
  whys: string[]
  /** Users who already answered the open engagement survey. */
  engagement: string[]
  improve: string[]
  /** 360°: subject user, manager user, providers [user, relationship, status]. */
  feedback: { subject: string; manager: string; providers: [string, Relationship, ProviderStatus][]; strengths: string[]; improvements: string[]; decline: string }
}

const SEEDS: Record<string, CompanySeed> = {
  [APEX_ID]: {
    admin: 'u9',
    adminName: 'Mariam Saeed',
    enps: [
      ['u1', 9, 10], ['u2', 10, 9], ['u3', 8, 8], ['u4', 7, 9], ['u5', 6, 6], ['u7', 9, 10], ['u8', 10, 9],
      ['u9', 8, 8], ['u10', 5, 7], ['u11', 9, 9], ['u14', 7, 10], ['u15', 8, 8], ['u16', 10, 9], ['u17', 6, 4],
    ],
    whys: [
      'Great team and interesting projects.',
      'Workload has been heavy this quarter with a lot of overtime.',
      'I would like a clearer career path and more training.',
      'My manager is supportive and gives useful feedback.',
      'Salary is below the market for my role.',
      'Communication from leadership could be more transparent.',
      'Flexible hours help a lot with balance.',
    ],
    engagement: ['u2', 'u3', 'u8', 'u9', 'u15', 'u16'],
    improve: ['More training budget for the team.', 'Fewer meetings, more focus time.', 'Clearer updates on company plans.', 'Recognition when we hit targets.'],
    feedback: {
      subject: 'u14',
      manager: 'u10',
      providers: [['u11', 'peer', 'submitted'], ['u15', 'peer', 'submitted'], ['u16', 'peer', 'submitted'], ['u17', 'peer', 'pending'], ['u12', 'cross_functional', 'declined']],
      strengths: ['Writes clean, well-tested code.', 'Always willing to help others debug.', 'Calm under pressure before releases.'],
      improvements: ['Share progress earlier with the team.', 'Document decisions in the wiki.', 'Speak up more in planning meetings.'],
      decline: 'I have not worked with Yusuf enough this year to give fair feedback.',
    },
  },
  [CREST_ID]: {
    admin: 'u102',
    adminName: 'Noura Al Qahtani',
    enps: [['u101', 8, 9], ['u102', 6, 7], ['u103', 9, 9], ['u104', 7, 6], ['u106', 5, 10], ['u107', 10, 8]],
    whys: [
      'Good people in operations and a stable company.',
      'Too many manual processes and old tools in the warehouse.',
      'Pay is fair but the hours are long in peak season.',
      'I am learning a lot about logistics.',
    ],
    engagement: ['u102', 'u103'],
    improve: ['Better tools for route planning.', 'More recognition for the night shift.'],
    feedback: {
      subject: 'u105',
      manager: 'u103',
      providers: [['u104', 'peer', 'submitted'], ['u107', 'cross_functional', 'submitted'], ['u101', 'cross_functional', 'submitted'], ['u106', 'cross_functional', 'pending']],
      strengths: ['Knows every key account by name.', 'Follows up on every shipment issue.', 'Reliable with customer reporting.'],
      improvements: ['Plan visits further ahead.', 'Loop operations in before promising dates.', 'Update the CRM the same day.'],
      decline: '',
    },
  },
}

function seedAll(): Seeded {
  const out: Seeded = { surveys: [], responses: [], participants: [], rounds: [], providers: [] }
  for (const co of [APEX_ID, CREST_ID]) {
    const s = SEEDS[co]
    const tz = companyById(co)?.regional.timezone ?? 'Asia/Dubai'
    const today = todayIsoIn(tz)
    const stamp = (iso: string) => `${iso}T06:00:00.000Z`
    const emp = (userId: string) => hrEmployees.find((e) => e.companyId === co && e.userId === userId)!
    const audience: Audience = { type: 'all', departmentIds: [], tenureBands: [] }
    const targetsOn = (day: string) =>
      hrEmployees.filter((e) => e.companyId === co && e.userId && e.status !== 'terminated' && e.hireDate <= day && users.some((u) => u.id === e.userId && u.active !== false)).map((e) => e.id)

    const survey = (key: TemplateKey, name: string, status: SurveyStatus, opensOn: string, closesOn: string, seriesId: string | null, wave: number): Tenant<SurveyRecord> => {
      const t = templateByKey(key)!
      const id = nextEngId('ESV-')
      return {
        companyId: co,
        id,
        name,
        kind: t.kind,
        templateKey: key,
        anonymous: t.anonymous,
        status,
        questions: structuredClone(t.questions),
        audience: structuredClone(audience),
        opensOn,
        closesOn,
        recurrence: t.recurrence,
        seriesId: seriesId ?? id,
        wave,
        targetEmployeeIds: targetsOn(opensOn),
        subjectEmployeeId: null,
        journeyId: null,
        launchedAt: stamp(opensOn),
        closedAt: status === 'closed' ? stamp(addDaysIso(closesOn, 1)) : null,
        createdAt: stamp(addDaysIso(opensOn, -2)),
        createdBy: s.admin,
        createdByName: s.adminName,
        marks: status === 'closed' ? ['open', 'mid', 'last'] : ['open'],
      }
    }
    // Seeded day and language are random (not derived from the person), like a real submission.
    const respond = (sv: Tenant<SurveyRecord>, userId: string, answers: Answer[], maxOffset: number) => {
      const e = emp(userId)
      out.participants.push({ companyId: co, surveyId: sv.id, employeeId: e.id })
      insertAtRandom(out.responses, {
        companyId: co,
        id: randomResponseId(),
        surveyId: sv.id,
        respondentEmployeeId: null,
        sealedKey: sealKey(co, sv.id, e.id),
        departmentId: e.departmentId,
        tenureBand: tenureBandOf(e.hireDate, sv.opensOn),
        answers,
        language: co === CREST_ID && Math.random() < 0.3 ? 'ar' : 'en',
        submittedOn: addDaysIso(sv.opensOn, Math.floor(Math.random() * maxOffset)),
      })
    }

    /* Two closed eNPS waves of one quarterly series: last quarter and the one before. */
    const w2Open = addDaysIso(addMonthsIso(today, -1), -10)
    const w1Open = addMonthsIso(w2Open, -3)
    const w1 = survey('enps_pulse', `eNPS pulse · ${w1Open.slice(0, 7)}`, 'closed', w1Open, addDaysIso(w1Open, 10), null, 1)
    const w2 = survey('enps_pulse', `eNPS pulse · ${w2Open.slice(0, 7)}`, 'closed', w2Open, addDaysIso(w2Open, 10), w1.id, 2)
    out.surveys.push(w1, w2)
    s.enps.forEach(([userId, a, b], i) => {
      const why = (n: number) => (hash(`${userId}${n}`) % 3 === 0 ? '' : s.whys[(i + n) % s.whys.length])
      respond(w1, userId, [{ questionId: ENPS_QUESTION_ID, value: a, choiceIds: [], text: '' }, { questionId: 'enps-why', value: null, choiceIds: [], text: why(1) }], 8)
      respond(w2, userId, [{ questionId: ENPS_QUESTION_ID, value: b, choiceIds: [], text: '' }, { questionId: 'enps-why', value: null, choiceIds: [], text: why(2) }], 8)
    })

    /* The quarterly engagement survey, open now (closes in 9 days). */
    const engOpen = addDaysIso(today, -5)
    const eng = survey('quarterly_engagement', `Engagement survey · Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1} ${today.slice(0, 4)}`, 'open', engOpen, addDaysIso(today, 9), null, 1)
    out.surveys.push(eng)
    s.engagement.forEach((userId, i) => {
      const answers: Answer[] = eng.questions.map((q) => {
        if (q.type === 'likert') return { questionId: q.id, value: Math.max(1, Math.min(5, 3 + (hash(`${userId}${q.id}`) % 3) - (q.driver === 'workload' ? 1 : 0))), choiceIds: [], text: '' }
        if (q.type === 'nps') return { questionId: q.id, value: 5 + (hash(`${userId}nps`) % 6), choiceIds: [], text: '' }
        return { questionId: q.id, value: null, choiceIds: [], text: s.improve[i % s.improve.length] }
      })
      respond(eng, userId, answers, 5)
    })

    /* A 360° round in this year's performance cycle (self-review phase), requested by the subject's manager. */
    const cycle = hrPerfCycles.find((c) => c.companyId === co && c.type === 'annual' && c.phase === 'self_review')
    const subject = emp(s.feedback.subject)
    const review = cycle ? hrPerfReviews.find((r) => r.companyId === co && r.cycleId === cycle.id && r.employeeId === subject.id) : undefined
    if (cycle && review) {
      const managerName = users.find((u) => u.id === s.feedback.manager)?.name ?? 'Manager'
      const roundId = nextEngId('FBR-')
      const created = stamp(addDaysIso(today, -6))
      const competencies = cycle.template.sections.flatMap((sec) => sec.questions.map((q) => ({ id: q.id, text: q.text })))
      out.rounds.push({
        companyId: co,
        id: roundId,
        subjectEmployeeId: subject.id,
        managerId: subject.managerId,
        cycleId: cycle.id,
        reviewId: review.id,
        competencies,
        deadline: addDaysIso(today, 10),
        status: 'open',
        allowNominations: true,
        requestedBy: s.feedback.manager,
        requestedByName: managerName,
        createdAt: created,
        closedAt: null,
        marks: [],
      })
      s.feedback.providers.forEach(([userId, relationship, status], i) => {
        const submitted = status === 'submitted'
        out.providers.push({
          companyId: co,
          id: nextEngId('FBP-'),
          roundId,
          employeeId: emp(userId).id,
          relationship,
          status,
          nominatedBy: 'manager',
          ratings: submitted ? competencies.map((c) => ({ competencyId: c.id, rating: 3 + (hash(`${userId}${c.id}`) % 3) })) : [],
          strengths: submitted ? s.feedback.strengths[i % s.feedback.strengths.length] : '',
          improvements: submitted ? s.feedback.improvements[i % s.feedback.improvements.length] : '',
          declineReason: status === 'declined' ? s.feedback.decline : null,
          invitedAt: created,
          submittedAt: submitted ? stamp(addDaysIso(today, -3 + (i % 2))) : null,
          marks: ['invited'],
        })
      })
    }
  }
  return out
}

const seeded = seedAll()

export const hrEngSurveys = registerArray<Tenant<SurveyRecord>>('hr.engSurveys', seeded.surveys)
export const hrEngResponses = registerArray<Tenant<ResponseRecord>>('hr.engResponses', seeded.responses)
export const hrEngParticipants = registerArray<Tenant<ParticipantRecord>>('hr.engParticipants', seeded.participants)
export const hrEngSettings = registerArray<Tenant<EngSettingsRecord>>('hr.engSettings', [])
export const hrFbRounds = registerArray<Tenant<FeedbackRoundRecord>>('hr.fbRounds', seeded.rounds)
export const hrFbProviders = registerArray<Tenant<FeedbackProviderRecord>>('hr.fbProviders', seeded.providers)
registerValue<number>(
  'hr.engSeq',
  () => seq,
  (v) => {
    seq = v
  },
)

export const DEFAULT_ENG_SETTINGS: EngSettingsRecord = { feedbackNamesVisibleToHr: false, exitSurveyAuto: true }

/** The company's settings row (created with the defaults on first write). */
export function engSettingsOf(companyId: string): EngSettingsRecord {
  return hrEngSettings.find((s) => s.companyId === companyId) ?? { ...DEFAULT_ENG_SETTINGS }
}
export function ensureEngSettings(companyId: string): Tenant<EngSettingsRecord> {
  let row = hrEngSettings.find((s) => s.companyId === companyId)
  if (!row) {
    row = { companyId, ...DEFAULT_ENG_SETTINGS }
    hrEngSettings.push(row)
  }
  return row
}
