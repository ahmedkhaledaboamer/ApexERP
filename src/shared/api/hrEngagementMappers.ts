import { defineMapper } from './mapping'
import type {
  AnswerInput,
  EngagementOptions,
  EngagementOverview,
  EngagementSettings,
  FeedbackOptions,
  FeedbackRound,
  FeedbackSummary,
  Invitation,
  InvitationInput,
  MyFeedback,
  MySurveyForm,
  MySurveys,
  ReviewFeedback,
  RoundInput,
  Survey,
  SurveyExport,
  SurveyInput,
  SurveyResults,
} from '@/modules/hr/engagement/types'

/**
 * HR › Engagement surveys and 360° feedback (docs/API.md › HR › Engagement surveys / 360° feedback). Mechanical
 * snake_case at any depth (`deep`): every answer holds arrays only (no data-keyed maps), so no data value is renamed.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const engOptionsMapper = deep<EngagementOptions>()
export const engSettingsMapper = deep<EngagementSettings>()
export const engSettingsInputMapper = deep<Partial<EngagementSettings>>()
export const engOverviewMapper = deep<EngagementOverview>()
export const surveyMapper = deep<Survey>()
export const surveyInputMapper = deep<Partial<SurveyInput> & { subjectEmployeeId?: string | null }>()
export const surveyResultsMapper = deep<SurveyResults>()
export const surveyExportMapper = deep<SurveyExport>()
export const mySurveysMapper = deep<MySurveys>()
export const mySurveyFormMapper = deep<MySurveyForm>()
export const answerInputMapper = deep<AnswerInput>()

export const fbOptionsMapper = deep<FeedbackOptions>()
export const myFeedbackMapper = deep<MyFeedback>()
export const roundMapper = deep<FeedbackRound>()
export const roundInputMapper = deep<RoundInput>()
export const providersInputMapper = deep<{ providers: { employeeId: string; relationship: string }[] }>()
export const nominateInputMapper = deep<{ employeeIds?: string[]; providers?: { employeeId: string; relationship: string }[] }>()
export const decideInputMapper = deep<{ approveIds: string[]; rejectIds: string[] }>()
export const summaryMapper = deep<FeedbackSummary>()
export const reviewFeedbackMapper = deep<ReviewFeedback>()
export const invitationMapper = deep<Invitation>()
export const invitationInputMapper = deep<InvitationInput>()
export const declineInputMapper = deep<{ reason: string }>()
