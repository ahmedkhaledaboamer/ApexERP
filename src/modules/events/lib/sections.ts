import type { EventType } from '@/modules/events/types'
import type { AttendeePerson, BoothLead, EventTypeSummary, FollowUpState } from '@/modules/events/sectionsTypes'
import type { CaptureRating } from '@/modules/events/types'

/** Client-side filters of the cross-event sections (Attendees, Booth leads). */

export interface AttendeeFilters {
  eventId: string
  type: EventType | ''
  from: string
  to: string
  checkedIn: '' | 'yes' | 'no'
  /** '' | 'with' | 'without' | `status:<key>` */
  lead: string
  company: string
}

export const NO_ATTENDEE_FILTERS: AttendeeFilters = { eventId: '', type: '', from: '', to: '', checkedIn: '', lead: '', company: '' }

export function matchesPerson(p: AttendeePerson, f: AttendeeFilters): boolean {
  const regs = p.registrations.filter((r) => r.status !== 'cancelled')
  if (f.eventId && !regs.some((r) => r.eventId === f.eventId)) return false
  if (f.type && !regs.some((r) => r.eventType === f.type)) return false
  if ((f.from || f.to) && !regs.some((r) => (!f.from || r.eventDate >= f.from) && (!f.to || r.eventDate <= f.to))) return false
  if (f.checkedIn === 'yes' && p.eventsAttended === 0) return false
  if (f.checkedIn === 'no' && p.eventsAttended > 0) return false
  if (f.lead === 'with' && !p.leadId) return false
  if (f.lead === 'without' && p.leadId) return false
  if (f.lead.startsWith('status:') && p.leadStatus !== f.lead.slice(7)) return false
  if (f.company.trim() && !p.companyName.toLowerCase().includes(f.company.trim().toLowerCase())) return false
  return true
}

export interface BoothFilters {
  eventId: string
  rating: CaptureRating | ''
  ownerId: string
  state: FollowUpState | ''
  overdueOnly: boolean
}

export const NO_BOOTH_FILTERS: BoothFilters = { eventId: '', rating: '', ownerId: '', state: '', overdueOnly: false }

export function matchesBoothLead(r: BoothLead, f: BoothFilters): boolean {
  if (f.eventId && r.eventId !== f.eventId) return false
  if (f.rating && r.rating !== f.rating) return false
  if (f.ownerId && r.leadOwnerId !== f.ownerId) return false
  if (f.state && r.state !== f.state) return false
  if (f.overdueOnly && !r.overdue) return false
  return true
}

/** Best / worst event type (analytics insight cards): by ROI where costs are known, else by cost per lead. */
export function typeInsights(types: EventTypeSummary[]): { best: EventTypeSummary | null; worst: EventTypeSummary | null; by: 'roi' | 'cpl' | null } {
  const withRoi = types.filter((t) => t.roi !== null)
  if (withRoi.length) {
    const sorted = [...withRoi].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))
    return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, by: 'roi' }
  }
  const withCpl = types.filter((t) => t.costPerLead !== null)
  if (withCpl.length) {
    const sorted = [...withCpl].sort((a, b) => (a.costPerLead ?? 0) - (b.costPerLead ?? 0))
    return { best: sorted[0], worst: sorted.length > 1 ? sorted[sorted.length - 1] : null, by: 'cpl' }
  }
  return { best: null, worst: null, by: null }
}
