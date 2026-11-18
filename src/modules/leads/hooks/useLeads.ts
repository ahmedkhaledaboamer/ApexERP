import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActivityType } from '@/shared/types'
import { leadKeys } from '@/modules/leads/queryKeys'
import { dashboardKeys } from '@/modules/dashboard/queryKeys'
import { addLeadNote, checkDuplicates, checkDuplicatesFull, checkLeadImport, createLead, getLeadOwners, importLeads, getLead, getLeadActivities, getLeadNotes, getLeads, getLeadTasks, logActivity, moveLeadStage, setDoNotContact, updateLead } from '@/modules/leads/api/leadsApi'
import type { DuplicateQuery, ImportLeadRow, ImportRequest, LeadCreateInput, LeadRow, LeadUpdateInput, MoveLeadInput, QuickAddInput } from '@/modules/leads/types'
import { can, scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

/** The signed-in user; lead hooks are only mounted inside the protected app. */
function useUserOrThrow() {
  const user = useCurrentUser()
  if (!user) throw new Error('Lead hooks need a signed-in user.')
  return user
}

export function useLeadsQuery() {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: leadKeys.list(user.id),
    queryFn: () => getLeads(),
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
  })
}

export function useLeadQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: leadKeys.detail(user.id, id),
    queryFn: () => getLead(id),
  })
}

export function useLeadActivitiesQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({ queryKey: leadKeys.activities(user.id, id), queryFn: () => getLeadActivities(id) })
}

export function useLeadNotesQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({ queryKey: leadKeys.notes(user.id, id), queryFn: () => getLeadNotes(id) })
}

export function useLeadTasksQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({ queryKey: leadKeys.tasks(user.id, id), queryFn: () => getLeadTasks(id) })
}

/**
 * Moves a lead between stages. The board updates at once from the cache; if the server
 * refuses, the snapshot is restored and the card goes back to its column.
 */
export function useMoveLeadStage() {
  const user = useUserOrThrow()
  const qc = useQueryClient()
  const listKey = leadKeys.list(user.id)

  return useMutation({
    mutationFn: (input: MoveLeadInput) => moveLeadStage(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: listKey })
      const previous = qc.getQueryData<LeadRow[]>(listKey)
      qc.setQueryData<LeadRow[]>(listKey, (rows) =>
        rows?.map((r) =>
          r.id === input.id
            ? {
                ...r,
                status: input.status,
                lossReason: input.lossReason ?? r.lossReason,
                nextStep: input.nextStep ?? r.nextStep,
                nextFollowUpDate: input.nextFollowUpDate ?? r.nextFollowUpDate,
              }
            : r,
        ),
      )
      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) qc.setQueryData(listKey, context.previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: dashboardKeys.all })
      // A move to Won creates a customer; stage changes also show on quotations.
      qc.invalidateQueries({ queryKey: ['crm'] })
      qc.invalidateQueries({ queryKey: ['quotations'] })
    },
  })
}

export function useSetDoNotContact(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (value: boolean) => setDoNotContact(id, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.all }),
  })
}

export function useLogActivity(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { type: ActivityType; summary: string }) => logActivity({ leadId, ...input }),
    // Logging can move a New lead to Contacted, so refresh the lead as well as the timeline.
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.all }),
  })
}

export function useAddNote(leadId: string) {
  const user = useUserOrThrow()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => addLeadNote({ leadId, body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: leadKeys.notes(user.id, leadId) }),
  })
}

export function useCreateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QuickAddInput | LeadCreateInput) => createLead(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: dashboardKeys.all })
      qc.invalidateQueries({ queryKey: ['onboarding'] })
      // Service usage counts (leads recommending / interested) change with lead edits.
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}

/** Edits lead fields (full form, follow-up reschedule, reassignment). */
export function useUpdateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeadUpdateInput }) => updateLead(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: dashboardKeys.all })
      // Service usage counts (leads recommending / interested) change with lead edits.
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}

/** Checks for duplicates once typing pauses. */
export function useDuplicateCheck(company: string, email: string) {
  const debouncedCompany = useDebounced(company.trim(), 400)
  const debouncedEmail = useDebounced(email.trim(), 400)
  return useQuery({
    queryKey: leadKeys.duplicates(debouncedCompany, debouncedEmail),
    queryFn: () => checkDuplicates({ company: debouncedCompany, email: debouncedEmail }),
    enabled: debouncedCompany.length > 2 || debouncedEmail.includes('@'),
    staleTime: 0,
  })
}

/**
 * Full-form duplicate check: company name, website domain and every contact email, once typing
 * pauses. `excludeId` keeps an edited lead from matching itself.
 */
export function useLeadDuplicateCheck(q: DuplicateQuery) {
  const company = useDebounced(q.company.trim(), 400)
  const website = useDebounced((q.website ?? '').trim(), 400)
  const emailsKey = useDebounced(
    (q.emails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .join(','),
    400,
  )
  return useQuery({
    queryKey: ['leads', 'duplicates-full', company, website, emailsKey, q.excludeId ?? ''] as const,
    queryFn: () =>
      checkDuplicatesFull({ company, website, emails: emailsKey ? emailsKey.split(',') : [], excludeId: q.excludeId }),
    enabled: company.length > 2 || website.includes('.') || emailsKey.length > 0,
    staleTime: 0,
    placeholderData: (prev) => prev,
  })
}

/** Assignable owners for the owner select (managers) and the import owner mapping. */
export function useLeadOwnersQuery(enabled = true) {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: ['leads', 'owners', user.id] as const,
    queryFn: getLeadOwners,
    enabled: enabled && can(user.role, 'sales', 'create'),
    staleTime: 60_000,
  })
}

/** POST /leads/import/check */
export function useImportCheck() {
  return useMutation({ mutationFn: (rows: ImportLeadRow[]) => checkLeadImport(rows) })
}

/** POST /leads/import */
export function useImportLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: ImportRequest) => importLeads(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: dashboardKeys.all })
      qc.invalidateQueries({ queryKey: ['onboarding'] })
    },
  })
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
