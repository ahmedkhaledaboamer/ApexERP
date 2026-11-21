import { defineMapper } from './mapping'
import type {
  JourneyDetail,
  JourneyItemInput,
  JourneyOptions,
  JourneyRow,
  MyJourneyTask,
  StartJourneyInput,
  TemplateInput,
  TemplateView,
} from '@/modules/hr/journey/types'

/**
 * Wire names of HR › Onboarding & offboarding: plain snake_case at any depth (employee_id, template_id,
 * due_offset_days, due_anchor, owner_role, owner_user_id, assignee_user_id, asset_category, course_id,
 * document_type, can_complete, finish_blockers…). docs/API.md › HR › Onboarding & offboarding.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const hrJourneyRowMapper = deep<JourneyRow>()
export const hrJourneyDetailMapper = deep<JourneyDetail>()
export const hrJourneyStartMapper = deep<StartJourneyInput>()
export const hrJourneyItemInputMapper = deep<JourneyItemInput>()
export const hrJourneyTemplateMapper = deep<TemplateView>()
export const hrJourneyTemplateInputMapper = deep<TemplateInput>()
export const hrJourneyOptionsMapper = deep<JourneyOptions>()
export const hrMyJourneyTaskMapper = deep<MyJourneyTask>()
/** Small bodies / answers ({ note }, { id }, a detail or a task). */
export const hrJourneyPlainMapper = deep<Record<string, unknown>>()
