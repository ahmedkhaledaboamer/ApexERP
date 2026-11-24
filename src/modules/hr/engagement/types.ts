/**
 * HR › Engagement surveys (incl. eNPS) and 360° feedback (docs/API.md › HR › Engagement surveys, 360° feedback).
 * UI names are camelCase; the wire is snake_case (src/shared/api/hrEngagementMappers.ts, mechanical at any depth:
 * every answer holds arrays only, no data-keyed maps).
 *
 * ANONYMITY (the rules the API enforces, mirrored here only for labels):
 *   surveys   an anonymous survey never stores who answered with the answers; any group (the whole survey, a
 *             department, a tenure band, a department head's view) with fewer than MIN_SURVEY_GROUP (5) responses
 *             is suppressed ("Not enough responses to show"); comments are shown without names
 *   360°      the employee and their manager see answers aggregated by relationship group; a group with fewer
 *             than MIN_FEEDBACK_GROUP (3) answers is pooled into "Others" (and suppressed if still under 3)
 */

export const MIN_SURVEY_GROUP = 5
export const MIN_FEEDBACK_GROUP = 3

/* ======================= Surveys ======================= */

export type QuestionType = 'nps' | 'likert' | 'single' | 'multi' | 'text'
export const QUESTION_TYPES: QuestionType[] = ['nps', 'likert', 'single', 'multi', 'text']
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  nps: '0–10 scale',
  likert: '1–5 agreement (Likert)',
  single: 'Single choice',
  multi: 'Multiple choice',
  text: 'Free text',
}

export type Driver = 'manager' | 'growth' | 'recognition' | 'workload' | 'wellbeing' | 'communication'
export const DRIVERS: Driver[] = ['manager', 'growth', 'recognition', 'workload', 'wellbeing', 'communication']
export const DRIVER_LABEL: Record<Driver, string> = {
  manager: 'Manager',
  growth: 'Growth',
  recognition: 'Recognition',
  workload: 'Workload',
  wellbeing: 'Wellbeing',
  communication: 'Communication',
}

export type SurveyKind = 'enps' | 'engagement' | 'onboarding' | 'exit' | 'custom'
export const SURVEY_KIND_LABEL: Record<SurveyKind, string> = {
  enps: 'eNPS pulse',
  engagement: 'Engagement',
  onboarding: 'Onboarding',
  exit: 'Exit',
  custom: 'Custom',
}

export type TemplateKey = 'enps_pulse' | 'quarterly_engagement' | 'onboarding_check_in' | 'exit'

export type SurveyStatus = 'draft' | 'scheduled' | 'open' | 'closed'
export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = { draft: 'Draft', scheduled: 'Scheduled', open: 'Open', closed: 'Closed' }

export type Recurrence = 'none' | 'monthly' | 'quarterly'
export const RECURRENCE_LABEL: Record<Recurrence, string> = { none: 'One-off', monthly: 'Every month', quarterly: 'Every quarter' }

export type TenureBand = 'lt_6m' | '6_12m' | '1_2y' | '2_5y' | '5y_plus'
export const TENURE_BANDS: TenureBand[] = ['lt_6m', '6_12m', '1_2y', '2_5y', '5y_plus']
export const TENURE_LABEL: Record<TenureBand, string> = {
  lt_6m: 'Under 6 months',
  '6_12m': '6–12 months',
  '1_2y': '1–2 years',
  '2_5y': '2–5 years',
  '5y_plus': '5 years or more',
}

export type AudienceType = 'all' | 'departments' | 'tenure'
export interface Audience {
  type: AudienceType
  departmentIds: string[]
  tenureBands: TenureBand[]
}

export type Language = 'en' | 'ar'

export interface ChoiceOption {
  id: string
  text: string
  textAr: string
}

export interface SurveyQuestion {
  id: string
  type: QuestionType
  text: string
  /** Optional Arabic wording ('' = English only). */
  textAr: string
  /** Likert questions of an engagement survey roll up into a driver score. */
  driver: Driver | null
  options: ChoiceOption[]
  required: boolean
}

export interface SurveyTemplate {
  key: TemplateKey
  name: string
  description: string
  kind: SurveyKind
  anonymous: boolean
  recurrence: Recurrence
  durationDays: number
  questions: SurveyQuestion[]
}

export interface Survey {
  id: string
  name: string
  kind: SurveyKind
  templateKey: TemplateKey | null
  anonymous: boolean
  status: SurveyStatus
  audience: Audience
  opensOn: string
  closesOn: string
  recurrence: Recurrence
  /** Waves of a recurring pulse share the series id. */
  seriesId: string
  wave: number
  /** People asked (frozen when the survey opens; the audience size before). */
  targetCount: number
  responseCount: number
  /** Whole percent (null before the survey opens). */
  responseRate: number | null
  questions: SurveyQuestion[]
  /** Exit / onboarding surveys sent to one person (HR full only; null otherwise). */
  subjectName: string | null
  /** Exit survey: the employee's offboarding journey. */
  journeyId: string | null
  createdAt: string
  createdByName: string
}

export interface SurveyQuestionInput {
  id?: string
  type: QuestionType
  text: string
  textAr?: string
  driver?: Driver | null
  options?: { id?: string; text: string; textAr?: string }[]
  required?: boolean
}

export interface SurveyInput {
  name: string
  templateKey: TemplateKey | null
  kind: SurveyKind
  anonymous: boolean
  questions: SurveyQuestionInput[]
  audience: Partial<Audience>
  opensOn: string
  closesOn: string
  recurrence: Recurrence
}

/* ---------------- Results (aggregates only for anonymous surveys) ---------------- */

export interface EnpsResult {
  score: number
  promoters: number
  passives: number
  detractors: number
  responses: number
}

export interface DriverScore {
  driver: Driver
  label: string
  /** Mean of the driver's Likert answers (1–5, two decimals). */
  score: number | null
  /** Share of 4–5 answers, whole percent. */
  favorablePct: number | null
  responses: number
}

export interface DistributionBar {
  value: string
  label: string
  count: number
}

export interface QuestionResult {
  questionId: string
  type: QuestionType
  text: string
  driver: Driver | null
  responses: number
  suppressed: boolean
  average: number | null
  distribution: DistributionBar[]
  /** Free text, without names, in no particular order (sorted). */
  comments: string[]
}

export interface GroupResult {
  key: string
  label: string
  responses: number
  suppressed: boolean
  enps: number | null
  /** Mean of every Likert answer (1–5). */
  score: number | null
}

export interface CommentTheme {
  theme: string
  label: string
  count: number
  examples: string[]
}

export interface TrendPoint {
  surveyId: string
  name: string
  opensOn: string
  status: SurveyStatus
  responses: number
  responseRate: number | null
  suppressed: boolean
  enps: number | null
  score: number | null
}

export interface IndividualResponse {
  employeeName: string
  departmentName: string | null
  submittedOn: string
  language: Language
  answers: { questionId: string; display: string }[]
}

export interface SurveyResults {
  survey: Survey
  /** company = HR full; departments = a Department Head (only their departments, threshold applies). */
  scope: 'company' | 'departments'
  filter: { departmentId: string | null; tenureBand: TenureBand | null }
  minGroup: number
  targetCount: number
  responseCount: number
  responseRate: number | null
  /** Fewer than minGroup responses in the selection: nothing but counts is shown. */
  suppressed: boolean
  enps: EnpsResult | null
  engagementScore: number | null
  drivers: DriverScore[]
  questions: QuestionResult[]
  byDepartment: GroupResult[]
  byTenure: GroupResult[]
  themes: CommentTheme[]
  trend: TrendPoint[]
  /** Non-anonymous surveys, HR full only; null otherwise. */
  individual: IndividualResponse[] | null
}

export interface SurveyExport {
  fileName: string
  headers: string[]
  rows: (string | number | null)[][]
}

export interface EngagementOverview {
  scope: 'company' | 'departments'
  minGroup: number
  latestEnps: TrendPoint | null
  enpsTrend: TrendPoint[]
  latestEngagement: { surveyId: string; name: string; status: SurveyStatus; responses: number; suppressed: boolean; score: number | null; drivers: DriverScore[] } | null
  openSurveys: { surveyId: string; name: string; closesOn: string; responseRate: number | null }[]
}

export interface EngagementSettings {
  /** HR sees the names behind 360° answers (off by default: anonymous to everyone). */
  feedbackNamesVisibleToHr: boolean
  /** Send the exit survey automatically when an employee moves to notice. */
  exitSurveyAuto: boolean
  minSurveyGroup: number
  minFeedbackGroup: number
}

export interface EngagementOptions {
  manage: boolean
  results: boolean
  scope: 'full' | 'team' | null
  departments: { id: string; name: string }[]
  templates: SurveyTemplate[]
  settings: EngagementSettings | null
  today: string
  timezone: string
}

/* ---------------- Answering (every employee) ---------------- */

export interface Answer {
  questionId: string
  /** nps 0–10, likert 1–5; null otherwise. */
  value: number | null
  choiceIds: string[]
  text: string
}

export interface MySurveyRow {
  surveyId: string
  name: string
  kind: SurveyKind
  anonymous: boolean
  closesOn: string
  responded: boolean
  editable: boolean
  questionCount: number
}

export interface MySurveys {
  employeeLinked: boolean
  toAnswer: MySurveyRow[]
  answered: MySurveyRow[]
}

export interface MySurveyForm {
  surveyId: string
  name: string
  kind: SurveyKind
  anonymous: boolean
  closesOn: string
  questions: SurveyQuestion[]
  /** The caller's own answers (null before the first answer). */
  answers: Answer[] | null
  language: Language
  editable: boolean
}

export interface AnswerInput {
  answers: Answer[]
  language: Language
}

/* ======================= 360° feedback ======================= */

export type Relationship = 'peer' | 'direct_report' | 'cross_functional'
export const RELATIONSHIPS: Relationship[] = ['peer', 'direct_report', 'cross_functional']
export const RELATIONSHIP_LABEL: Record<Relationship | 'others', string> = {
  peer: 'Peers',
  direct_report: 'Direct reports',
  cross_functional: 'Cross-functional',
  others: 'Others',
}

export type ProviderStatus = 'nominated' | 'pending' | 'submitted' | 'declined' | 'rejected'
export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  nominated: 'Nominated (awaiting approval)',
  pending: 'Waiting for feedback',
  submitted: 'Submitted',
  declined: 'Declined',
  rejected: 'Nomination not approved',
}

export type RoundStatus = 'open' | 'closed'

export interface FeedbackCompetency {
  id: string
  text: string
}

export interface ProviderRow {
  id: string
  employeeId: string
  name: string
  relationship: Relationship
  status: ProviderStatus
  nominatedBy: 'employee' | 'manager' | 'hr'
  declineReason: string | null
}

/** What the reviewed employee sees of their nominations (never who answered or declined). */
export interface OwnNomination {
  employeeId: string
  name: string
  status: 'awaiting' | 'approved' | 'not_approved'
}

export interface FeedbackRound {
  id: string
  subjectEmployeeId: string
  subjectName: string
  departmentName: string | null
  cycleId: string | null
  cycleName: string | null
  reviewId: string | null
  deadline: string
  status: RoundStatus
  allowNominations: boolean
  competencies: FeedbackCompetency[]
  counts: { invited: number; submitted: number; declined: number; pending: number; nominated: number }
  viewer: 'hr' | 'manager' | 'subject'
  /** HR / manager only (names and status, never answers); [] for the employee. */
  providers: ProviderRow[]
  /** The employee only. */
  nominations: OwnNomination[]
  summaryVisible: boolean
  requestedByName: string
  createdAt: string
  can: { addProviders: boolean; decideNominations: boolean; nominate: boolean; close: boolean }
}

export interface FeedbackGroup {
  key: Relationship | 'others' | 'all'
  label: string
  responses: number
  suppressed: boolean
  competencies: { competencyId: string; text: string; average: number | null }[]
  overall: number | null
}

export interface NamedFeedback {
  providerName: string
  relationship: Relationship
  ratings: { competencyId: string; rating: number | null }[]
  strengths: string
  improvements: string
}

export interface FeedbackSummary {
  roundId: string
  subjectName: string
  /** False before the employee may see it (review not shared yet) or below the minimum. */
  available: boolean
  reason: string | null
  responses: number
  minGroup: number
  groups: FeedbackGroup[]
  strengths: string[]
  improvements: string[]
  /** HR full only, when the company setting allows it; null otherwise. */
  named: NamedFeedback[] | null
}

export interface ReviewFeedback {
  reviewId: string
  /** The reviewed employee. */
  subjectEmployeeId: string
  round: FeedbackRound | null
  summary: FeedbackSummary | null
  canRequest: boolean
}

export interface InvitationRow {
  id: string
  roundId: string
  subjectName: string
  relationship: Relationship
  status: ProviderStatus
  deadline: string
  overdue: boolean
  roundStatus: RoundStatus
}

export interface MyFeedback {
  employeeLinked: boolean
  invitations: InvitationRow[]
  aboutMe: FeedbackRound[]
}

export interface FeedbackRating {
  competencyId: string
  /** 1–5; null = can't say. */
  rating: number | null
}

export interface Invitation {
  id: string
  roundId: string
  subjectName: string
  subjectJobTitle: string
  relationship: Relationship
  deadline: string
  status: ProviderStatus
  competencies: FeedbackCompetency[]
  ratings: FeedbackRating[]
  strengths: string
  improvements: string
  declineReason: string | null
  editable: boolean
}

export interface InvitationInput {
  ratings: FeedbackRating[]
  strengths: string
  improvements: string
  submit: boolean
}

export interface ProviderInput {
  employeeId: string
  relationship: Relationship
}

export interface RoundInput {
  subjectEmployeeId: string
  reviewId: string | null
  deadline: string
  allowNominations: boolean
  providers: ProviderInput[]
}

export interface FeedbackOptions {
  colleagues: { id: string; name: string; jobTitle: string; departmentName: string | null }[]
  minGroup: number
  today: string
}
