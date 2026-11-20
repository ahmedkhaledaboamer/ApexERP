import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/events/api/eventLibraryApi'
import type { LibraryAccess, SpeakerInput, SpeakerRatingInput, VendorInput, VendorReviewInput, VenueInput } from '@/modules/events/libraryTypes'
import { libraryAccess } from '@/modules/events/lib/library'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/**
 * Speakers directory, venues and vendors. Keys live under ['events', uid, 'library', …] so every event write
 * (agenda, budget lines, venue pick) refreshes them, and every library write refreshes the events.
 */
export const libraryKeys = {
  speakers: (uid: string) => ['events', uid, 'library', 'speakers'] as const,
  speaker: (uid: string, id: string) => ['events', uid, 'library', 'speaker', id] as const,
  venues: (uid: string) => ['events', uid, 'library', 'venues'] as const,
  venue: (uid: string, id: string) => ['events', uid, 'library', 'venue', id] as const,
  vendors: (uid: string) => ['events', uid, 'library', 'vendors'] as const,
  vendor: (uid: string, id: string) => ['events', uid, 'library', 'vendor', id] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/**
 * What the UI may offer. Managing follows marketing `full`; reading is decided by the server (marketing view,
 * or a member of any event team) — pages show the 403 message when it says no.
 */
export function useLibraryAccess(): { canManage: boolean; access: LibraryAccess } {
  const user = useCurrentUser()
  const access = user ? libraryAccess(scopeOf(user.role, 'marketing'), false) : 'none'
  return { canManage: access === 'manage', access }
}

function useOn(enabled: boolean) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('events')
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: ['events'] })
}

/* ---- speakers ---- */

export function useSpeakersQuery(enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.speakers(uid), queryFn: api.getSpeakers, enabled: useOn(enabled), retry: false })
}
export function useSpeakerQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.speaker(uid, id), queryFn: () => api.getSpeaker(id), enabled: useOn(!!id), retry: false })
}
export function useSaveSpeaker() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<SpeakerInput> }) => api.saveSpeaker(input, id), onSuccess: invalidate })
}
export function useDeleteSpeaker() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteSpeaker(id), onSuccess: invalidate })
}
export function useRateSpeaker() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: SpeakerRatingInput }) => api.rateSpeaker(id, input), onSuccess: invalidate })
}

/* ---- venues ---- */

export function useVenuesQuery(enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.venues(uid), queryFn: api.getVenues, enabled: useOn(enabled), retry: false })
}
export function useVenueQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.venue(uid, id), queryFn: () => api.getVenue(id), enabled: useOn(!!id), retry: false })
}
export function useSaveVenue() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<VenueInput> }) => api.saveVenue(input, id), onSuccess: invalidate })
}
export function useDeleteVenue() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteVenue(id), onSuccess: invalidate })
}

/* ---- vendors ---- */

export function useVendorsQuery(enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.vendors(uid), queryFn: api.getVendors, enabled: useOn(enabled), retry: false })
}
export function useVendorQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: libraryKeys.vendor(uid, id), queryFn: () => api.getVendor(id), enabled: useOn(!!id), retry: false })
}
export function useSaveVendor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id?: string; input: Partial<VendorInput> }) => api.saveVendor(input, id), onSuccess: invalidate })
}
export function useDeleteVendor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteVendor(id), onSuccess: invalidate })
}
export function useReviewVendor() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, input }: { id: string; input: VendorReviewInput }) => api.reviewVendor(id, input), onSuccess: invalidate })
}
