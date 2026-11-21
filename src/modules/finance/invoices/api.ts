import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeInvoicesMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import type { CreditNoteInput, InvoiceFromSourceInput, InvoiceInput, InvoiceListQuery, RecurringInput, RecurringUpdate, SendInput } from './types'

/** Accounts & finance › Invoices, credit notes, recurring invoices (docs/API.md › Finance). snake_case on the wire. */

const enc = encodeURIComponent
const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '' && v !== false) s.set(k, String(v))
  const t = s.toString()
  return t ? `?${t}` : ''
}
const I = '/finance/invoices'
const CN = '/finance/credit-notes'
const R = '/finance/recurring-invoices'

export const invoicesApi = {
  list: async (q: InvoiceListQuery = {}) =>
    m.invoiceRowMapper.fromApiList((await http.get<unknown>(`${I}${qs({ status: q.status, customer_id: q.customerId, from: q.from, to: q.to, overdue: q.overdue, q: q.q })}`)).data),
  get: async (id: string) => m.invoiceDetailMapper.fromApi((await http.get<unknown>(`${I}/${enc(id)}`)).data),
  meta: async () => m.invoiceMetaMapper.fromApi((await http.get<unknown>(`${I}/meta`)).data),
  sources: async () => m.invoiceSourcesMapper.fromApi((await http.get<unknown>(`${I}/sources`)).data),
  create: async (input: InvoiceInput) => m.invoiceDetailMapper.fromApi((await http.post<unknown>(I, m.invoiceInputMapper.toApi(input))).data),
  update: async (id: string, input: Partial<InvoiceInput>) => m.invoiceDetailMapper.fromApi((await http.patch<unknown>(`${I}/${enc(id)}`, m.invoiceInputMapper.toApi(input as InvoiceInput))).data),
  remove: async (id: string) => void (await http.delete(`${I}/${enc(id)}`)),
  fromSource: async (input: InvoiceFromSourceInput) => m.invoiceDetailMapper.fromApi((await http.post<unknown>(`${I}/from-source`, m.invoiceFromSourceMapper.toApi(input))).data),
  issue: async (id: string) => m.invoiceDetailMapper.fromApi((await http.post<unknown>(`${I}/${enc(id)}/issue`)).data),
  void: async (id: string, reason: string) => m.invoiceDetailMapper.fromApi((await http.post<unknown>(`${I}/${enc(id)}/void`, { reason })).data),
  send: async (id: string, input: SendInput) => m.invoiceDetailMapper.fromApi((await http.post<unknown>(`${I}/${enc(id)}/send`, m.invoiceSendMapper.toApi(input))).data),
  xml: async (id: string) => m.xmlFileMapper.fromApi((await http.post<unknown>(`${I}/${enc(id)}/zatca-xml`)).data),
  creditNotes: async (invoiceId?: string) => m.creditNoteMapper.fromApiList((await http.get<unknown>(`${CN}${qs({ invoice_id: invoiceId })}`)).data),
  creditNote: async (id: string) => m.creditNoteMapper.fromApi((await http.get<unknown>(`${CN}/${enc(id)}`)).data),
  createCreditNote: async (input: CreditNoteInput) => m.creditNoteMapper.fromApi((await http.post<unknown>(CN, m.creditNoteInputMapper.toApi(input))).data),
  creditNoteXml: async (id: string) => m.xmlFileMapper.fromApi((await http.post<unknown>(`${CN}/${enc(id)}/zatca-xml`)).data),
  recurring: async () => m.recurringMapper.fromApiList((await http.get<unknown>(R)).data),
  createRecurring: async (input: RecurringInput) => m.recurringMapper.fromApi((await http.post<unknown>(R, m.recurringInputMapper.toApi(input))).data),
  updateRecurring: async (id: string, input: RecurringUpdate) => m.recurringMapper.fromApi((await http.patch<unknown>(`${R}/${enc(id)}`, m.recurringUpdateMapper.toApi(input))).data),
}

/* ---------------- hooks ---------------- */

/** Every invoices query sits under ['finance', 'invoices', uid] (the ['finance'] invalidation of the ledger refreshes them too). */
function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | boolean | object | undefined)[]) => ['finance', 'invoices', uid, ...rest] as const
}

/** `full` (Company Admin, Management, Accountant) writes; `view` (Sales Manager) reads. */
export function useInvoicesScope() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'accounting') : 'hidden'
  return { scope, canWrite: scope === 'full', canRead: scope === 'full' || scope === 'view' }
}

function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('accounting')
}

export function useInvoices(q: InvoiceListQuery) {
  const key = useKey()
  return useQuery({ queryKey: key('list', q), queryFn: () => invoicesApi.list(q), enabled: useOn(), retry: false })
}
export function useInvoice(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('detail', id ?? ''), queryFn: () => invoicesApi.get(id!), enabled: useOn(!!id), retry: false })
}
export function useInvoiceMeta() {
  const key = useKey()
  return useQuery({ queryKey: key('meta'), queryFn: invoicesApi.meta, enabled: useOn(), retry: false, staleTime: 60_000 })
}
export function useInvoiceSources(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('sources'), queryFn: invoicesApi.sources, enabled: useOn(enabled), retry: false })
}
export function useCreditNotes(invoiceId?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('credit-notes', invoiceId ?? ''), queryFn: () => invoicesApi.creditNotes(invoiceId), enabled: useOn(), retry: false })
}
export function useRecurring() {
  const key = useKey()
  return useQuery({ queryKey: key('recurring'), queryFn: invoicesApi.recurring, enabled: useOn(), retry: false })
}

/** A mutation that refreshes every finance query (invoices, ledger, collections) and the bell on success. */
export function useInvoiceMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}

/** Saves an XML answer as a file (no server-side storage). */
export function downloadXml(file: { filename: string; mimeType: string; content: string }): void {
  const blob = new Blob([file.content], { type: file.mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
