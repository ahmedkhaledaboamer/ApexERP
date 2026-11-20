import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/modules/events/api/eventsAdvancedApi'
import type { BudgetLineInput, CaptureInput, EventTemplateInput, InviteInput, SessionInput, SpeakerInput, TicketTypeInput } from '@/modules/events/types'
import { leadKeys } from '@/modules/leads/queryKeys'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'

/** Query keys of the advanced Events features (under ['events'], so every event write refreshes them). */
export const eventAdvKeys = {
  templates: (uid: string) => ['events', uid, 'templates'] as const,
  checklist: (uid: string, id: string) => ['events', uid, 'checklist', id] as const,
  agenda: (uid: string, id: string) => ['events', uid, 'agenda', id] as const,
  tickets: (uid: string, id: string) => ['events', uid, 'tickets', id] as const,
  checkIn: (uid: string, id: string) => ['events', uid, 'check-in', id] as const,
  emails: (uid: string, id: string) => ['events', uid, 'emails', id] as const,
  captures: (uid: string, id: string) => ['events', uid, 'captures', id] as const,
  leaderboard: (uid: string, id: string) => ['events', uid, 'leaderboard', id] as const,
  survey: (uid: string, id: string) => ['events', uid, 'survey', id] as const,
  budget: (uid: string, id: string) => ['events', uid, 'budget', id] as const,
}

function useUid(): string {
  return useCurrentUser()?.id ?? 'anonymous'
}

/** Refreshes events (and tasks: checklist items are tasks). */
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['events'] })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
  }
}

/* ---------------- Templates + checklist ---------------- */

export function useEventTemplatesQuery(enabled = true) {
  const uid = useUid()
  const ent = useEntitlements()
  return useQuery({ queryKey: eventAdvKeys.templates(uid), queryFn: api.getTemplates, enabled: enabled && ent.hasModule('events') })
}

export function useSaveTemplate() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EventTemplateInput }) => (id ? api.updateTemplate(id, input) : api.createTemplate(input)),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteTemplate() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: (id: string) => api.deleteTemplate(id), onSuccess: () => invalidate() })
}

export function useChecklistQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.checklist(uid, id), queryFn: () => api.getChecklist(id) })
}

export function useApplyTemplate() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, templateId }: { id: string; templateId: string }) => api.applyTemplate(id, templateId), onSuccess: () => invalidate() })
}

/* ---------------- Agenda & speakers ---------------- */

export function useAgendaQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.agenda(uid, id), queryFn: () => api.getAgenda(id) })
}

export function useSaveSession() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input, sessionId }: { id: string; input: Partial<SessionInput>; sessionId?: string }) => api.saveSession(id, input, sessionId),
    onSuccess: () => invalidate(),
  })
}

export function useRemoveSession() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, sessionId }: { id: string; sessionId: string }) => api.removeSession(id, sessionId), onSuccess: () => invalidate() })
}

export function useSaveSpeaker() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input, speakerId }: { id: string; input: Partial<SpeakerInput>; speakerId?: string }) => api.saveSpeaker(id, input, speakerId),
    onSuccess: () => invalidate(),
  })
}

export function useRemoveSpeaker() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, speakerId }: { id: string; speakerId: string }) => api.removeSpeaker(id, speakerId), onSuccess: () => invalidate() })
}
/* ---------------- Tickets & waitlist ---------------- */

export function useTicketTypesQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.tickets(uid, id), queryFn: () => api.getTicketTypes(id) })
}

export function useSaveTicketType() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input, ticketTypeId }: { id: string; input: Partial<TicketTypeInput>; ticketTypeId?: string }) => api.saveTicketType(id, input, ticketTypeId),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteTicketType() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, ticketTypeId }: { id: string; ticketTypeId: string }) => api.deleteTicketType(id, ticketTypeId), onSuccess: () => invalidate() })
}

export function useCancelRegistration() {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, attendeeId }: { id: string; attendeeId: string }) => api.cancelRegistration(id, attendeeId),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}
/* ---------------- Check-in ---------------- */

export function useCheckInSummaryQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.checkIn(uid, id), queryFn: () => api.getCheckInSummary(id), refetchInterval: 15_000 })
}

export function useCheckInByCode() {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: ({ id, code, undo }: { id: string; code: string; undo?: boolean }) => api.checkInByCode(id, code, undo), onSuccess: () => invalidate() })
}
/* ---------------- Invitations & email log ---------------- */

export function useEventEmailsQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.emails(uid, id), queryFn: () => api.getEventEmails(id) })
}

export function useInviteAudience() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InviteInput }) => api.inviteAudience(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketing'] }),
  })
}
/* ---------------- Booth capture + leaderboard ---------------- */

export function useCapturesQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.captures(uid, id), queryFn: () => api.getCaptures(id) })
}

export function useLeaderboardQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.leaderboard(uid, id), queryFn: () => api.getLeaderboard(id) })
}

export function useCreateCapture() {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CaptureInput }) => api.createCapture(id, input),
    onSuccess: () => {
      invalidate()
      void qc.invalidateQueries({ queryKey: leadKeys.all })
    },
  })
}
/* ---------------- Feedback survey ---------------- */

export function useSurveyResultsQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.survey(uid, id), queryFn: () => api.getSurveyResults(id) })
}
/* ---------------- Budget & campaign ---------------- */

export function useBudgetQuery(id: string) {
  const uid = useUid()
  return useQuery({ queryKey: eventAdvKeys.budget(uid, id), queryFn: () => api.getBudget(id) })
}

function useBudgetInvalidate() {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return () => {
    invalidate()
    void qc.invalidateQueries({ queryKey: ['marketing'] })
  }
}

export function useSaveBudgetLine() {
  const done = useBudgetInvalidate()
  return useMutation({
    mutationFn: ({ id, input, lineId }: { id: string; input: Partial<BudgetLineInput>; lineId?: string }) => api.saveBudgetLine(id, input, lineId),
    onSuccess: done,
  })
}

export function useRemoveBudgetLine() {
  const done = useBudgetInvalidate()
  return useMutation({ mutationFn: ({ id, lineId }: { id: string; lineId: string }) => api.removeBudgetLine(id, lineId), onSuccess: done })
}

export function useLinkCampaign() {
  const done = useBudgetInvalidate()
  return useMutation({ mutationFn: ({ id, campaignId }: { id: string; campaignId: string | null }) => api.linkCampaign(id, campaignId), onSuccess: done })
}