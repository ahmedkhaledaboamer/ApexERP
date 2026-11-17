import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { quotationKeys } from '@/modules/quotations/queryKeys'
import { leadKeys } from '@/modules/leads/queryKeys'
import { dashboardKeys } from '@/modules/dashboard/queryKeys'
import {
  createQuotation,
  duplicateQuotation,
  getQuotation,
  getQuotations,
  sendQuotation,
  setQuotationStatus,
  updateQuotation,
} from '@/modules/quotations/api/quotationsApi'
import type { Quotation, QuotationDecision, QuotationInput, QuotationUpdateInput } from '@/modules/quotations/types'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

function useUserOrThrow() {
  const user = useCurrentUser()
  if (!user) throw new Error('Quotation hooks need a signed-in user.')
  return user
}

/** All quotations in scope, or one lead's when `leadId` is given. */
export function useQuotationsQuery(leadId?: string) {
  const user = useUserOrThrow()
  return useQuery({
    queryKey: quotationKeys.list(user.id, leadId),
    queryFn: () => getQuotations({ leadId }),
    enabled: scopeOf(user.role, 'sales') !== 'hidden',
  })
}

export function useQuotationQuery(id: string) {
  const user = useUserOrThrow()
  return useQuery({ queryKey: quotationKeys.detail(user.id, id), queryFn: () => getQuotation(id), enabled: !!id })
}

/** Writes the fresh quotation into its detail cache and refreshes every list. */
function useSync() {
  const user = useUserOrThrow()
  const qc = useQueryClient()
  return (q: Quotation) => {
    qc.setQueryData(quotationKeys.detail(user.id, q.id), q)
    qc.invalidateQueries({ queryKey: quotationKeys.lists() })
  }
}

export function useCreateQuotation() {
  const sync = useSync()
  return useMutation({ mutationFn: (input: QuotationInput) => createQuotation(input), onSuccess: sync })
}

export function useUpdateQuotation() {
  const sync = useSync()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: QuotationUpdateInput }) => updateQuotation(id, input),
    onSuccess: sync,
  })
}

/** Sending can move the lead to Proposal and logs an email, so lead data is refreshed too. */
export function useSendQuotation() {
  const sync = useSync()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sendQuotation(id),
    onSuccess: (q) => {
      sync(q)
      qc.invalidateQueries({ queryKey: leadKeys.all })
      qc.invalidateQueries({ queryKey: dashboardKeys.all })
    },
  })
}

export function useSetQuotationStatus() {
  const sync = useSync()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuotationDecision }) => setQuotationStatus(id, status),
    onSuccess: sync,
  })
}

export function useDuplicateQuotation() {
  const sync = useSync()
  return useMutation({ mutationFn: (id: string) => duplicateQuotation(id), onSuccess: sync })
}
