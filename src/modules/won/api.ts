import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import type { WonInput, WonPreview, WonResult } from '@/modules/won/types'
import { WON_INVALIDATES } from '@/modules/won/invalidation'

const enc = encodeURIComponent

export interface WonPreviewQuery {
  quotationId?: string | null
  serviceIds?: string[]
  projectManagerId?: string
  startDate?: string
}

export async function previewWon(leadId: string, q: WonPreviewQuery = {}): Promise<WonPreview> {
  return (await http.post<WonPreview>(`/leads/${enc(leadId)}/won/preview`, q)).data
}

/**
 * One atomic server action. Errors reject as ApiError (message, status, code) with the raw body
 * `{ message, code?, ...details, step }` kept as `details`.
 */
export async function winLead(leadId: string, input: WonInput): Promise<WonResult> {
  return (await http.post<WonResult>(`/leads/${enc(leadId)}/won`, input)).data
}

export const wonKeys = {
  preview: (leadId: string, q: WonPreviewQuery) => ['won', 'preview', leadId, q] as const,
}

export function useWonPreview(leadId: string | null, q: WonPreviewQuery) {
  return useQuery({
    queryKey: wonKeys.preview(leadId ?? '', q),
    queryFn: () => previewWon(leadId!, q),
    enabled: !!leadId,
    staleTime: 0,
  })
}

/**
 * Win a lead. On success every affected cache is invalidated (WON_INVALIDATES: leads, customers/CRM,
 * contracts, quotations, projects, tasks, notifications/alerts, dashboard, reports, audit).
 */
export function useWinLead(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WonInput) => winLead(leadId, input),
    onSuccess: () => {
      for (const key of WON_INVALIDATES) qc.invalidateQueries({ queryKey: [...key] })
    },
  })
}
