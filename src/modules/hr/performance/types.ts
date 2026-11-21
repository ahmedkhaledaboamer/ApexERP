/**
 * HR › Performance reviews (docs/API.md › HR › Performance). UI camelCase; the API speaks snake_case
 * through src/shared/api/hrPerformanceMappers.ts (mechanical, at any depth).
 *
 *   template   rating scale + competency sections (questions rated + commented) + goals on/off + weights
 *   cycle      annual / mid-year / probation / ad-hoc; period, participants, phase dates;
 *              phases draft → goal_setting → self_review → manager_review → calibration → shared → closed
 *   review     one per employee per cycle: self assessment, manager assessment (direct manager), HR
 *              calibration (mandatory note, audited, never shown to the employee), shared → acknowledged
 *   goal       per employee per cycle, weights total 100 %, approved by the manager
 */

export type CycleType = 'annual' | 'mid_year' | 'probation' | 'ad_hoc'
export const CYCLE_TYPES: CycleType[] = ['annual', 'mid_year', 'probation', 'ad_hoc']
export const CYCLE_TYPE_LABEL: Record<CycleType, string> = { annual: 'Annual', mid_year: 'Mid-year', probation: 'Probation', ad_hoc: 'Ad-hoc' }

export type CyclePhase = 'draft' | 'goal_setting' | 'self_review' | 'manager_review' | 'calibration' | 'shared' | 'closed'
export const CYCLE_PHASES: CyclePhase[] = ['draft', 'goal_setting', 'self_review', 'manager_review', 'calibration', 'shared', 'closed']
export const PHASE_LABEL: Record<CyclePhase, string> = {
  draft: 'Draft',
  goal_setting: 'Goal setting',
  self_review: 'Self-review',
  manager_review: 'Manager review',
  calibration: 'Calibration',
  shared: 'Shared',
  closed: 'Closed',
}

/** Where one review stands (computed). */
export type ReviewStage = 'goal_setting' | 'self_review' | 'manager_review' | 'calibration' | 'shared' | 'acknowledged' | 'incomplete'
export const REVIEW_STAGES: ReviewStage[] = ['goal_setting', 'self_review', 'manager_review', 'calibration', 'shared', 'acknowledged', 'incomplete']
export const STAGE_LABEL: Record<ReviewStage, string> = {
  goal_setting: 'Goal setting',
  self_review: 'Self-review',
  manager_review: 'Manager review',
  calibration: 'Calibration',
  shared: 'Shared',
  acknowledged: 'Acknowledged',
  incomplete: 'Not completed',
}

export type GoalStatus = 'not_started' | 'on_track' | 'at_risk' | 'completed' | 'missed'
export const GOAL_STATUSES: GoalStatus[] = ['not_started', 'on_track', 'at_risk', 'completed', 'missed']
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { not_started: 'Not started', on_track: 'On track', at_risk: 'At risk', completed: 'Completed', missed: 'Missed' }

export type ProbationRecommendation = 'confirm' | 'extend' | 'terminate'
export const PROBATION_RECOMMENDATIONS: ProbationRecommendation[] = ['confirm', 'extend', 'terminate']
export const PROBATION_LABEL: Record<ProbationRecommendation, string> = { confirm: 'Confirm employment', extend: 'Extend probation', terminate: 'End employment' }

/** Probation reviews are created this many days before the probation end date (company calendar). */
export const PROBATION_LOOKAHEAD_DAYS = 30
/** "Due soon" reminder: this many days before a phase deadline. */
export const DUE_SOON_DAYS = 3

export const DEFAULT_SCALE: RatingLevel[] = [
  { value: 1, label: 'Unsatisfactory' },
  { value: 2, label: 'Needs improvement' },
  { value: 3, label: 'Meets expectations' },
  { value: 4, label: 'Exceeds expectations' },
  { value: 5, label: 'Outstanding' },
]

export interface RatingLevel {
  value: number
  label: string
}

export interface TemplateQuestion {
  id: string
  text: string
}

export interface TemplateSection {
  id: string
  title: string
  questions: TemplateQuestion[]
}

/** The part of a template a cycle snapshots at launch (later template edits don't change running cycles). */
export interface TemplateSnapshot {
  id: string
  name: string
  scale: RatingLevel[]
  sections: TemplateSection[]
  goalsEnabled: boolean
  /** Goals' share of the overall score, 0–100 (0 when goals are off). */
  goalsWeight: number
  /** Competencies' share = 100 − goalsWeight. */
  competencyWeight: number
  /** The employee fills a self-assessment. */
  selfReview: boolean
}

export interface ReviewTemplate extends TemplateSnapshot {
  description: string
  /** The default template of probation reviews (one per company). */
  forProbation: boolean
  active: boolean
  /** Cycles using it. */
  cycleCount: number
  createdAt: string
  updatedAt: string
}

export interface TemplateInput {
  name: string
  description: string
  /** Labels from the lowest to the highest level (values 1…n); default 1–5. */
  scale: RatingLevel[]
  sections: { id?: string; title: string; questions: { id?: string; text: string }[] }[]
  goalsEnabled: boolean
  goalsWeight: number
  selfReview: boolean
  forProbation: boolean
  active: boolean
}

export interface PhaseDeadlines {
  goalSetting: string | null
  selfReview: string | null
  managerReview: string
  calibration: string
}

export interface CycleProgress {
  total: number
  goalsReady: number
  selfDone: number
  managerDone: number
  shared: number
  acknowledged: number
  /** Manager reviews done over participants, %. */
  completionPct: number
}

export interface Cycle {
  id: string
  name: string
  type: CycleType
  phase: CyclePhase
  templateId: string
  templateName: string
  periodStart: string
  periodEnd: string
  /** Empty = every department. */
  departmentIds: string[]
  /** Explicit participants (ad-hoc / probation); empty = by department. */
  employeeIds: string[]
  /** Employees hired after this date are left out (null = no cutoff). */
  hiredBefore: string | null
  deadlines: PhaseDeadlines
  /** Deadline of the current phase (null in draft / shared / closed). */
  currentDeadline: string | null
  launchedAt: string | null
  closedAt: string | null
  createdAt: string
  createdByName: string
  progress: CycleProgress
}

export interface DistributionBucket {
  value: number
  label: string
  count: number
}

export interface DepartmentProgress {
  departmentId: string | null
  name: string
  total: number
  managerDone: number
  completionPct: number
  averageRating: number | null
}

export interface CycleDetail extends Cycle {
  template: TemplateSnapshot
  byStage: { stage: ReviewStage; count: number }[]
  distribution: DistributionBucket[]
  departments: DepartmentProgress[]
  reviews: ReviewRow[]
}

export interface CycleInput {
  name: string
  type: CycleType
  templateId: string
  periodStart: string
  periodEnd: string
  departmentIds: string[]
  employeeIds: string[]
  hiredBefore: string | null
  deadlines: Partial<PhaseDeadlines>
}

export interface ReviewRow {
  id: string
  cycleId: string
  cycleName: string
  cycleType: CycleType
  cyclePhase: CyclePhase
  employeeId: string
  employeeName: string
  employeeNo: string
  jobTitle: string
  departmentId: string | null
  departmentName: string | null
  managerId: string | null
  managerName: string | null
  stage: ReviewStage
  /** Deadline of the step this review waits for (null when nothing is pending). */
  dueDate: string | null
  overdue: boolean
  selfSubmittedAt: string | null
  managerSubmittedAt: string | null
  /** Weighted score (manager assessment), 2 decimals; null until visible to the viewer. */
  overallScore: number | null
  /** Final rating on the scale (calibrated or rounded overall); null until visible to the viewer. */
  finalRating: number | null
  finalLabel: string | null
  sharedAt: string | null
  acknowledgedAt: string | null
}

export interface Answer {
  questionId: string
  rating: number | null
  comment: string
}

export interface GoalRating {
  goalId: string
  rating: number | null
  comment: string
}

export interface Assessment {
  answers: Answer[]
  goalRatings: GoalRating[]
  summary: string
  submittedAt: string | null
}

export interface ManagerAssessment extends Assessment {
  recommendedCourseIds: string[]
  /** Probation reviews only. */
  recommendation: ProbationRecommendation | null
  /** Months, when recommending an extension. */
  extendMonths: number | null
}

export interface Goal {
  id: string
  reviewId: string
  cycleId: string
  employeeId: string
  title: string
  description: string
  /** Share of the goals score, %; the goals of a review total 100. */
  weight: number
  target: string
  /** 0–100. */
  progress: number
  status: GoalStatus
  approved: boolean
  approvedAt: string | null
  approvedByName: string | null
  createdByName: string
  updatedAt: string
}

export interface GoalInput {
  title: string
  description: string
  weight: number
  target: string
  progress: number
  status: GoalStatus
}

export interface Scores {
  competency: number | null
  goals: number | null
  overall: number | null
}

/** HR full only (never the employee, never the manager). */
export interface Calibration {
  rating: number
  previousRating: number | null
  note: string
  byName: string
  at: string
  history: { rating: number; previousRating: number | null; note: string; byName: string; at: string }[]
}

export interface ProbationInfo {
  contractId: string | null
  endDate: string
  outcome: ProbationRecommendation | null
  outcomeAppliedAt: string | null
}

export interface SalesKpi {
  key: string
  label: string
  target: number
  actual: number
  attainmentPct: number | null
}

/** How the caller relates to a review. */
export type ReviewViewer = 'employee' | 'manager' | 'hr' | 'team'

export interface ReviewCan {
  editGoals: boolean
  /** Title / weight / target (else progress only). */
  editGoalTerms: boolean
  approveGoals: boolean
  editSelf: boolean
  submitSelf: boolean
  editManager: boolean
  submitManager: boolean
  calibrate: boolean
  share: boolean
  acknowledge: boolean
}

export interface ReviewDetail extends ReviewRow {
  viewer: ReviewViewer
  template: TemplateSnapshot
  periodStart: string
  periodEnd: string
  deadlines: PhaseDeadlines
  goals: Goal[]
  goalWeightTotal: number
  /** The employee's own assessment: the employee always; others once submitted. */
  self: Assessment | null
  selfScores: Scores | null
  /** The manager's assessment: the manager / HR; the employee only once shared. */
  manager: ManagerAssessment | null
  scores: Scores | null
  calibration: Calibration | null
  acknowledgement: { at: string; comment: string } | null
  probation: ProbationInfo | null
  recommendedCourses: { id: string; title: string }[]
  salesKpis: SalesKpi[] | null
  locked: boolean
  can: ReviewCan
}

export interface AssessmentInput {
  answers: Answer[]
  goalRatings: GoalRating[]
  summary: string
  submit: boolean
}

export interface ManagerAssessmentInput extends AssessmentInput {
  recommendedCourseIds: string[]
  recommendation: ProbationRecommendation | null
  extendMonths: number | null
}

export interface CalibrateInput {
  rating: number
  note: string
  /** Probation reviews: HR may change the outcome. */
  recommendation?: ProbationRecommendation | null
}

export interface AcknowledgeInput {
  comment: string
}

export type PendingAction = 'set_goals' | 'approve_goals' | 'self_review' | 'manager_review' | 'acknowledge'
export const PENDING_LABEL: Record<PendingAction, string> = {
  set_goals: 'Set your goals',
  approve_goals: 'Approve goals',
  self_review: 'Complete your self-review',
  manager_review: 'Complete the manager review',
  acknowledge: 'Read and acknowledge your review',
}

/** GET /hr/performance/my: the portal card and "My reviews & goals". */
export interface MyPerformance {
  employeeId: string | null
  /** What the caller must do now (own reviews and the ones they review as manager). */
  pending: { reviewId: string; action: PendingAction; employeeName: string; cycleName: string; dueDate: string | null; overdue: boolean }[]
  reviews: ReviewRow[]
  goals: Goal[]
  /** Reviews the caller completes as the direct manager (open ones). */
  teamToComplete: number
  latestShared: ReviewRow | null
}

export interface PerformanceOptions {
  manage: boolean
  /** The caller reviews someone (direct manager, team, or HR). */
  reviews: boolean
  templates: { id: string; name: string; goalsEnabled: boolean; selfReview: boolean; forProbation: boolean }[]
  departments: { id: string; name: string }[]
  courses: { id: string; title: string }[]
  probationLookaheadDays: number
}
