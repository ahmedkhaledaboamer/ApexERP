import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/events/api/sponsorsLogisticsApi'
import type { SponsorDealInput, SponsorDealUpdate, SponsorDeliverableInput, SponsorFilter, SponsorPackageInput, SponsorStageInput } from '@/modules/events/sponsorTypes'
import type { DeadlineInput, ShipmentInput, TripInput } from '@/modules/events/logisticsTypes'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'

/** Query keys (under ['events'], so every event write refreshes them; budgets and stats follow these writes). */
export const sectionKeys = {
  sponsorBoard: (uid: string, f: SponsorFilter) => ['events', uid, 'sponsor-board', f.eventId ?? '', f.packageId ?? '', f.stage ?? '', f.ownerId ?? ''] as const,
  sponsorship: (uid: string, id: string) => ['events', uid, 'sponsorship', id] as const,
  sponsor: (uid: string, id: string, sponsorId: string) => ['events', uid, 'sponsor', id, sponsorId] as const,
  orgs: (uid: string, q: string) => ['events', uid, 'sponsor-orgs', q] as const,
  logistics: (uid: string, eventId: string) => ['events', uid, 'logistics', eventId] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

function useInvalidate() {
  const qc = useQueryClient()
  return (more: string[] = []) => {
    void qc.invalidateQueries({ queryKey: ['events'] })
    for (const k of more) void qc.invalidateQueries({ queryKey: [k] })
  }
}

/* ---------------- Sponsors ---------------- */

export function useSponsorBoardQuery(filter: SponsorFilter = {}) {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: sectionKeys.sponsorBoard(uid, filter), queryFn: () => api.getSponsorBoard(filter), enabled: ent.hasModule('events') })
}

export function useSponsorshipQuery(eventId: string) {
  const uid = useUid()
  return useQuery({ queryKey: sectionKeys.sponsorship(uid, eventId), queryFn: () => api.getSponsorship(eventId) })
}

export function useSponsorQuery(eventId: string, sponsorId: string | null) {
  const uid = useUid()
  return useQuery({ queryKey: sectionKeys.sponsor(uid, eventId, sponsorId ?? ''), queryFn: () => api.getSponsor(eventId, sponsorId!), enabled: !!sponsorId && !!eventId })
}

export function useSponsorOrganizations(q: string, enabled: boolean) {
  const uid = useUid()
  return useQuery({ queryKey: sectionKeys.orgs(uid, q), queryFn: () => api.searchSponsorOrganizations(q), enabled, staleTime: 30_000 })
}

export function useSavePackage() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ eventId, input, packageId }: { eventId: string; input: Partial<SponsorPackageInput>; packageId?: string }) => api.savePackage(eventId, input, packageId),
    onSuccess: () => invalidate(),
  })
}

export function useDeletePackage() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, packageId }: { eventId: string; packageId: string }) => api.deletePackage(eventId, packageId), onSuccess: () => invalidate() })
}

export function useCreateSponsor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, input }: { eventId: string; input: SponsorDealInput }) => api.createSponsor(eventId, input), onSuccess: () => invalidate(['leads']) })
}

export function useUpdateSponsor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, sponsorId, input }: { eventId: string; sponsorId: string; input: SponsorDealUpdate }) => api.updateSponsor(eventId, sponsorId, input), onSuccess: () => invalidate() })
}

export function useMoveSponsor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, sponsorId, input }: { eventId: string; sponsorId: string; input: SponsorStageInput }) => api.moveSponsor(eventId, sponsorId, input), onSuccess: () => invalidate() })
}

export function useDeleteSponsor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, sponsorId }: { eventId: string; sponsorId: string }) => api.deleteSponsor(eventId, sponsorId), onSuccess: () => invalidate() })
}

export function useUpdateDeliverable() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ eventId, sponsorId, deliverableId, input }: { eventId: string; sponsorId: string; deliverableId: string; input: SponsorDeliverableInput }) => api.updateDeliverable(eventId, sponsorId, deliverableId, input),
    onSuccess: () => invalidate(['tasks']),
  })
}

export function useDeliverableTask() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ eventId, sponsorId, deliverableId }: { eventId: string; sponsorId: string; deliverableId: string }) => api.createDeliverableTask(eventId, sponsorId, deliverableId),
    onSuccess: () => invalidate(['tasks']),
  })
}

/* ---------------- Logistics ---------------- */

/** Cross-event bundle (eventId '' = every event) or one event's. */
export function useLogisticsQuery(eventId = '', perEvent = false) {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({
    queryKey: sectionKeys.logistics(uid, `${perEvent ? 'event:' : ''}${eventId}`),
    queryFn: () => (perEvent ? api.getEventLogistics(eventId) : api.getLogistics(eventId)),
    enabled: ent.hasModule('events'),
  })
}

export function useSaveTrip() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, input, tripId }: { eventId: string; input: Partial<TripInput>; tripId?: string }) => api.saveTrip(eventId, input, tripId), onSuccess: () => invalidate() })
}

export function useDeleteTrip() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, tripId }: { eventId: string; tripId: string }) => api.deleteTrip(eventId, tripId), onSuccess: () => invalidate() })
}

export function useSaveShipment() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, input, shipmentId }: { eventId: string; input: Partial<ShipmentInput>; shipmentId?: string }) => api.saveShipment(eventId, input, shipmentId), onSuccess: () => invalidate() })
}

export function useDeleteShipment() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, shipmentId }: { eventId: string; shipmentId: string }) => api.deleteShipment(eventId, shipmentId), onSuccess: () => invalidate() })
}

export function useSaveDeadline() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, input, deadlineId }: { eventId: string; input: Partial<DeadlineInput>; deadlineId?: string }) => api.saveDeadline(eventId, input, deadlineId), onSuccess: () => invalidate() })
}

export function useDeleteDeadline() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ eventId, deadlineId }: { eventId: string; deadlineId: string }) => api.deleteDeadline(eventId, deadlineId), onSuccess: () => invalidate() })
}
