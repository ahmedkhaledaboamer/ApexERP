import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import * as api from './api'
import type { JourneyItemInput, StartJourneyInput, TemplateInput } from './types'

/**
 * HR › Onboarding & offboarding. Keys live under ['hr', uid, 'journeys', …]; every write refreshes the whole ['hr']
 * tree (an employee's status / activity changes too) and the bell.
 */
export const journeyKeys = {
  list: (uid: string, f: api.JourneyFilters) => ['hr', uid, 'journeys', 'list', f] as const,
  detail: (uid: string, id: string) => ['hr', uid, 'journeys', 'detail', id] as const,
  mine: (uid: string) => ['hr', uid, 'journeys', 'mine'] as const,
  options: (uid: string) => ['hr', uid, 'journeys', 'options'] as const,
  templates: (uid: string) => ['hr', uid, 'journeys', 'templates'] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** The caller's `hr` scope: full manages; team / own read their journeys; hidden only has "My tasks". */
export function useJourneyScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'hr') : 'hidden'
  return { scope, canManage: scope === 'full', canSeeJourneys: scope !== 'hidden' }
}

function useOn(enabled: boolean) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['hr'] })
    void qc.invalidateQueries({ queryKey: ['alerts'] })
  }
}

export function useJourneysQuery(f: api.JourneyFilters = {}, enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: journeyKeys.list(uid, f), queryFn: () => api.getJourneys(f), enabled: useOn(enabled), retry: false })
}
export function useJourneyQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: journeyKeys.detail(uid, id), queryFn: () => api.getJourney(id), enabled: useOn(!!id), retry: false })
}
/** Items assigned to the caller (any role): the "My tasks" tab and the My HR portal card. */
export function useMyJourneyTasksQuery(enabled = true) {
  const uid = useUid()
  return useQuery({ queryKey: journeyKeys.mine(uid), queryFn: api.getMyJourneyTasks, enabled: useOn(enabled), retry: false })
}
export function useJourneyOptionsQuery(enabled: boolean) {
  const uid = useUid()
  return useQuery({ queryKey: journeyKeys.options(uid), queryFn: api.getJourneyOptions, enabled: useOn(enabled), retry: false, staleTime: 60_000 })
}
export function useJourneyTemplatesQuery(enabled: boolean) {
  const uid = useUid()
  return useQuery({ queryKey: journeyKeys.templates(uid), queryFn: api.getJourneyTemplates, enabled: useOn(enabled), retry: false })
}

export function useStartJourney() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (input: StartJourneyInput) => api.startJourney(input), onSuccess: invalidate })
}
export function useSetItemDone() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { journeyId: string; itemId: string; done: boolean; note?: string }) => api.setJourneyItemDone(v.journeyId, v.itemId, v.done, v.note), onSuccess: invalidate })
}
export function useAddJourneyItem() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { journeyId: string; input: JourneyItemInput }) => api.addJourneyItem(v.journeyId, v.input), onSuccess: invalidate })
}
export function useUpdateJourneyItem() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { journeyId: string; itemId: string; input: JourneyItemInput }) => api.updateJourneyItem(v.journeyId, v.itemId, v.input), onSuccess: invalidate })
}
export function useDeleteJourneyItem() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { journeyId: string; itemId: string }) => api.deleteJourneyItem(v.journeyId, v.itemId), onSuccess: invalidate })
}
export function useActivateJourney() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.activateJourney(id), onSuccess: invalidate })
}
export function useCancelJourney() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.cancelJourney(id), onSuccess: invalidate })
}
export function useSaveJourneyTemplate() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (v: { input: Partial<TemplateInput>; id?: string }) => api.saveJourneyTemplate(v.input, v.id), onSuccess: invalidate })
}
export function useDeleteJourneyTemplate() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteJourneyTemplate(id), onSuccess: invalidate })
}
