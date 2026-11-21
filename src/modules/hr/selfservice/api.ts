import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/hrSelfServiceMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type { LetterRequestInput, LetterTypeInput, ProfileChangeInput } from './types'

/** HR › Self-service and HR letters (docs/API.md › HR › Self-service, HR letters). snake_case on the wire. */

const enc = encodeURIComponent

export const selfServiceApi = {
  me: async () => m.myHrMapper.fromApi((await http.get<unknown>('/hr/me')).data),
  myPayslip: async (id: string) => m.myPayslipMapper.fromApi((await http.get<unknown>(`/hr/me/payslips/${enc(id)}`)).data),
  profileChanges: async (status?: string) => m.profileChangeMapper.fromApiList((await http.get<unknown>(`/hr/profile-changes${status ? `?status=${enc(status)}` : ''}`)).data),
  submitProfileChange: async (input: ProfileChangeInput) => m.profileChangeMapper.fromApi((await http.post<unknown>('/hr/profile-changes', m.profileChangeInputMapper.toApi(input))).data),
  decideProfileChange: async (a: { id: string; action: 'approve' | 'reject' | 'cancel'; reason?: string }) =>
    m.profileChangeMapper.fromApi((await http.post<unknown>(`/hr/profile-changes/${enc(a.id)}/${a.action}`, a.action === 'reject' ? { reason: a.reason } : a.action === 'approve' ? { comment: a.reason ?? '' } : {})).data),
  revealProfileChangeIban: async (id: string) => String(m.selfServicePlainMapper.fromApi((await http.post<unknown>(`/hr/profile-changes/${enc(id)}/reveal`)).data).iban ?? ''),
  inbox: async () => m.selfServiceInboxMapper.fromApi((await http.get<unknown>('/hr/self-service/inbox')).data),
  letterTypes: async () => m.letterTypeMapper.fromApiList((await http.get<unknown>('/hr/letters/types')).data),
  saveLetterType: async (a: { id: string; input: LetterTypeInput }) => m.letterTypeMapper.fromApi((await http.patch<unknown>(`/hr/letters/types/${enc(a.id)}`, m.letterTypeInputMapper.toApi(a.input))).data),
  resetLetterType: async (id: string) => m.letterTypeMapper.fromApi((await http.post<unknown>(`/hr/letters/types/${enc(id)}/reset`)).data),
  letterRequests: async (status?: string) => m.letterRequestRowMapper.fromApiList((await http.get<unknown>(`/hr/letters/requests${status ? `?status=${enc(status)}` : ''}`)).data),
  letterRequest: async (id: string) => m.letterRequestMapper.fromApi((await http.get<unknown>(`/hr/letters/requests/${enc(id)}`)).data),
  requestLetter: async (input: LetterRequestInput) => m.letterRequestMapper.fromApi((await http.post<unknown>('/hr/letters/requests', m.letterRequestInputMapper.toApi(input))).data),
  decideLetter: async (a: { id: string; action: 'approve' | 'reject' | 'cancel'; reason?: string; overrideReason?: string }) =>
    m.letterRequestMapper.fromApi(
      (await http.post<unknown>(`/hr/letters/requests/${enc(a.id)}/${a.action}`, m.selfServicePlainMapper.toApi(a.action === 'reject' ? { reason: a.reason } : a.action === 'approve' ? { overrideReason: a.overrideReason ?? '' } : {}))).data,
    ),
  verify: async (code: string) => m.letterVerificationMapper.fromApi((await http.get<unknown>(`/hr/letters/verify?code=${enc(code)}`)).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: string[]) => ['hr', 'self-service', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

export function useMyHr() {
  const key = useKey()
  return useQuery({ queryKey: key('me'), queryFn: selfServiceApi.me, enabled: useOn(), retry: false })
}
export function useMyPayslip(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('payslip', id), queryFn: () => selfServiceApi.myPayslip(id), enabled: useOn(!!id), retry: false })
}
export function useInbox(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('inbox'), queryFn: selfServiceApi.inbox, enabled: useOn(enabled), retry: false })
}
export function useProfileChanges(status?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('changes', status ?? ''), queryFn: () => selfServiceApi.profileChanges(status), enabled: useOn(), retry: false })
}
export function useLetterRequests(status?: string) {
  const key = useKey()
  return useQuery({ queryKey: key('letters', status ?? ''), queryFn: () => selfServiceApi.letterRequests(status), enabled: useOn(), retry: false })
}
export function useLetterRequest(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('letter', id), queryFn: () => selfServiceApi.letterRequest(id), enabled: useOn(!!id), retry: false })
}
export function useLetterTypes(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('types'), queryFn: selfServiceApi.letterTypes, enabled: useOn(enabled), retry: false })
}

/** A mutation that refreshes every HR query (and the bell) on success. */
export function useSelfServiceMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
