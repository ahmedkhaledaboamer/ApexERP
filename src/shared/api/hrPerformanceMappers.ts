import { defineMapper } from './mapping'
import type {
  AcknowledgeInput,
  AssessmentInput,
  CalibrateInput,
  Cycle,
  CycleDetail,
  CycleInput,
  GoalInput,
  ManagerAssessmentInput,
  MyPerformance,
  PerformanceOptions,
  ReviewDetail,
  ReviewRow,
  ReviewTemplate,
  TemplateInput,
} from '@/modules/hr/performance/types'

/**
 * HR › Performance (docs/API.md › HR › Performance). The UI names follow the proposed columns (cycle_id,
 * employee_id, goals_weight, submitted_at …), so every resource converts mechanically at any depth (`deep`);
 * no data-keyed maps are sent (arrays only).
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const perfOptionsMapper = deep<PerformanceOptions>()
export const perfTemplateMapper = deep<ReviewTemplate>()
export const perfTemplateInputMapper = deep<TemplateInput>()
export const perfCycleMapper = deep<Cycle>()
export const perfCycleDetailMapper = deep<CycleDetail>()
export const perfCycleInputMapper = deep<CycleInput>()
export const perfReviewRowMapper = deep<ReviewRow>()
export const perfReviewMapper = deep<ReviewDetail>()
export const perfAssessmentInputMapper = deep<AssessmentInput>()
export const perfManagerInputMapper = deep<ManagerAssessmentInput>()
export const perfCalibrateInputMapper = deep<CalibrateInput>()
export const perfAckInputMapper = deep<AcknowledgeInput>()
export const perfGoalInputMapper = deep<GoalInput>()
export const perfMyMapper = deep<MyPerformance>()
export const perfRemindMapper = deep<{ sent: number }>()
