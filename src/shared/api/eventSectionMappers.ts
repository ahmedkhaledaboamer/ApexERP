import { defineMapper } from './mapping'
import type {
  AssignBoothLeadsInput,
  AssignBoothLeadsResult,
  AttendeeDirectory,
  AttendeeExportRow,
  BoothLeads,
  EventAnalytics,
} from '@/modules/events/sectionsTypes'

/**
 * Cross-event sections of the Events area (docs/API.md › Events › Attendees directory, Booth leads,
 * Event analytics). Aggregates: snake_case at any depth (`deep`).
 */
export const attendeeDirectoryMapper = defineMapper<AttendeeDirectory>({ deep: true })
export const attendeeExportMapper = defineMapper<AttendeeExportRow>({ deep: true })
export const boothLeadsMapper = defineMapper<BoothLeads>({ deep: true })
export const assignBoothLeadsInputMapper = defineMapper<AssignBoothLeadsInput>()
export const assignBoothLeadsResultMapper = defineMapper<AssignBoothLeadsResult>({ deep: true })
export const eventAnalyticsMapper = defineMapper<EventAnalytics>({ deep: true })
