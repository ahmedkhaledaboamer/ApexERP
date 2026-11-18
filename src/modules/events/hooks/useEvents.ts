import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/events/api/eventsApi'
import type { AttendeeImportRow, AttendeeInput, EventFilter, EventInput, EventUpdateInput } from '@/modules/events/types'
import { leadKeys } from '@/modules/leads/queryKeys'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'

/** Query keys are per user (the server scopes the answers to the caller). */
export const eventKeys = {
  all: ['events'] as const,
  list: (userId: string, f: EventFilter = {}) => ['events', userId, 'list', f.from ?? '', f.to ?? ''] as const,
  detail: (userId: string, id: string) => ['events', userId, 'detail', id] as const,
  attendees: (userId: string, id: string) => ['events', userId, 'attendees', id] as const,
  stats: (userId: string, id: string) => ['events', userId, 'stats', id] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** Events the caller can see; only fetched when the plan includes the module. */
export function useEventsQuery(filter: EventFilter = {}, opts: { enabled?: boolean } = {}) {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({
    queryKey: eventKeys.list(uid, filter),
    queryFn: () => api.getEvents(filter),
    enabled: ent.hasModule('events') && opts.enabled !== false,
  })
}

export function useEventQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventKeys.detail(uid, id), queryFn: () => api.getEvent(id), retry: false })
}

export function useAttendeesQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventKeys.attendees(uid, id), queryFn: () => api.getAttendees(id) })
}

export function useEventStatsQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventKeys.stats(uid, id), queryFn: () => api.getEventStats(id) })
}

/** Every event write refreshes the events cache; attendee writes also the leads (they create / link leads). */
function useInvalidate() {
  const qc = useQueryClient()
  return (leads = false) => {
    void qc.invalidateQueries({ queryKey: eventKeys.all })
    // Task chips show event names; targets count events attended.
    void qc.invalidateQueries({ queryKey: ['tasks'] })
    if (leads) void qc.invalidateQueries({ queryKey: leadKeys.all })
  }
}

export function useCreateEvent() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: EventInput) => api.createEvent(input), onSuccess: () => invalidate() })
}

export function useUpdateEvent() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: EventUpdateInput }) => api.updateEvent(id, input), onSuccess: () => invalidate() })
}

export function useCancelEvent() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.cancelEvent(id), onSuccess: () => invalidate() })
}

export function useAddTeamMember() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string }) => api.addTeamMember(id, userId), onSuccess: () => invalidate() })
}

export function useRemoveTeamMember() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string }) => api.removeTeamMember(id, userId), onSuccess: () => invalidate() })
}

export function useAddAttendee() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: AttendeeInput }) => api.addAttendee(id, input), onSuccess: () => invalidate(true) })
}

export function useUpdateAttendee() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, attendeeId, input }: { id: string; attendeeId: string; input: Partial<AttendeeInput> }) => api.updateAttendee(id, attendeeId, input),
    onSuccess: () => invalidate(),
  })
}

export function useRemoveAttendee() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, attendeeId }: { id: string; attendeeId: string }) => api.removeAttendee(id, attendeeId), onSuccess: () => invalidate() })
}

export function useCheckIn() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, attendeeId, undo }: { id: string; attendeeId: string; undo?: boolean }) => api.checkInAttendee(id, attendeeId, undo),
    onSuccess: () => invalidate(),
  })
}

export function useImportAttendees() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, rows, fileName }: { id: string; rows: AttendeeImportRow[]; fileName: string }) => api.importAttendees(id, rows, fileName),
    onSuccess: () => invalidate(true),
  })
}
