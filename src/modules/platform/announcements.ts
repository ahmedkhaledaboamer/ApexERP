import type { Announcement, AnnouncementInput } from '@/modules/platform/types'

export type AnnouncementStatus = 'scheduled' | 'live' | 'ended'

export function announcementStatus(a: Pick<Announcement, 'startsAt' | 'endsAt'>, now: number = Date.now()): AnnouncementStatus {
  if (Date.parse(a.endsAt) <= now) return 'ended'
  if (Date.parse(a.startsAt) > now) return 'scheduled'
  return 'live'
}

/** Field errors for the announcement form (empty = valid). */
export function validateAnnouncement(input: Partial<AnnouncementInput>): Record<string, string> {
  const e: Record<string, string> = {}
  if (!input.title?.trim()) e.title = 'Enter a title.'
  else if (input.title.trim().length > 120) e.title = 'At most 120 characters.'
  if (!input.body?.trim()) e.body = 'Enter the message.'
  else if (input.body.trim().length > 1000) e.body = 'At most 1000 characters.'
  const start = input.startsAt ? Date.parse(input.startsAt) : NaN
  const end = input.endsAt ? Date.parse(input.endsAt) : NaN
  if (!Number.isFinite(start)) e.startsAt = 'Choose a start.'
  if (!Number.isFinite(end)) e.endsAt = 'Choose an end.'
  else if (Number.isFinite(start) && end <= start) e.endsAt = 'The end must be after the start.'
  return e
}
