import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/hrComplianceMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type { HrFile } from '@/modules/hr/peopleTypes'
import type { DigitStyle, LetterLanguage } from '@/modules/hr/selfservice/types'
import type { AcknowledgeInput, DisciplinaryInput, PolicyInput } from './types'

/** HR › Discipline and Policies (docs/API.md › HR › Discipline, Policies). snake_case on the wire. */

const enc = encodeURIComponent
const qs = (o: Record<string, string | null | undefined | boolean>) => {
  const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
  return p.length ? `?${p.map(([k, v]) => `${k}=${enc(String(v))}`).join('&')}` : ''
}

export const complianceApi = {
  discipline: async (q: { employeeId?: string; status?: string; type?: string; mine?: boolean } = {}) =>
    m.disciplinaryRowMapper.fromApiList((await http.get<unknown>(`/hr/discipline${qs({ employee_id: q.employeeId, status: q.status, type: q.type, mine: q.mine ? '1' : undefined })}`)).data),
  record: async (id: string) => m.disciplinaryMapper.fromApi((await http.get<unknown>(`/hr/discipline/${enc(id)}`)).data),
  createRecord: async (input: DisciplinaryInput) => m.disciplinaryMapper.fromApi((await http.post<unknown>('/hr/discipline', m.disciplinaryInputMapper.toApi(input))).data),
  addAttachments: async (a: { id: string; attachments: HrFile[] }) =>
    m.disciplinaryMapper.fromApi((await http.post<unknown>(`/hr/discipline/${enc(a.id)}/attachments`, m.compliancePlainMapper.toApi({ attachments: a.attachments }))).data),
  withdraw: async (a: { id: string; reason: string }) => m.disciplinaryMapper.fromApi((await http.post<unknown>(`/hr/discipline/${enc(a.id)}/withdraw`, { reason: a.reason })).data),
  acknowledge: async (a: { id: string } & AcknowledgeInput) =>
    m.disciplinaryMapper.fromApi((await http.post<unknown>(`/hr/discipline/${enc(a.id)}/acknowledge`, m.acknowledgeInputMapper.toApi({ comment: a.comment, appeal: a.appeal }))).data),
  warningLetter: async (id: string, language: LetterLanguage, digits: DigitStyle) =>
    m.warningLetterMapper.fromApi((await http.get<unknown>(`/hr/discipline/${enc(id)}/letter${qs({ language, digits })}`)).data),

  policies: async () => m.policyRowMapper.fromApiList((await http.get<unknown>('/hr/policies')).data),
  policy: async (id: string) => m.policyMapper.fromApi((await http.get<unknown>(`/hr/policies/${enc(id)}`)).data),
  createPolicy: async (input: PolicyInput) => m.policyMapper.fromApi((await http.post<unknown>('/hr/policies', m.policyInputMapper.toApi(input))).data),
  updatePolicy: async (a: { id: string; input: PolicyInput }) => m.policyMapper.fromApi((await http.patch<unknown>(`/hr/policies/${enc(a.id)}`, m.policyInputMapper.toApi(a.input))).data),
  publishPolicy: async (a: { id: string; changeNote?: string }) => m.policyMapper.fromApi((await http.post<unknown>(`/hr/policies/${enc(a.id)}/publish`, { change_note: a.changeNote ?? '' })).data),
  archivePolicy: async (id: string) => m.policyMapper.fromApi((await http.post<unknown>(`/hr/policies/${enc(id)}/archive`)).data),
  policyStatus: async (id: string) => m.policyStatusMapper.fromApi((await http.get<unknown>(`/hr/policies/${enc(id)}/status`)).data),
  policyExport: async (id: string) => m.policyExportMapper.fromApiList((await http.get<unknown>(`/hr/policies/${enc(id)}/export`)).data),
  myPolicies: async () => m.myPolicyMapper.fromApiList((await http.get<unknown>('/hr/policies/my')).data),
  acknowledgePolicy: async (a: { id: string; version: number }) => m.myPolicyMapper.fromApi((await http.post<unknown>(`/hr/policies/${enc(a.id)}/acknowledge`, { version: a.version })).data),
}

function useKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: string[]) => ['hr', 'compliance', uid, ...rest] as const
}
function useOn(enabled = true) {
  const ent = useEntitlements()
  return enabled && ent.hasModule('hr')
}

export function useDiscipline(q: { employeeId?: string; status?: string; type?: string; mine?: boolean } = {}) {
  const key = useKey()
  return useQuery({ queryKey: key('discipline', JSON.stringify(q)), queryFn: () => complianceApi.discipline(q), enabled: useOn(), retry: false })
}
export function useDisciplineRecord(id: string | null) {
  const key = useKey()
  return useQuery({ queryKey: key('record', id ?? ''), queryFn: () => complianceApi.record(id!), enabled: useOn(!!id), retry: false })
}
export function useWarningLetter(id: string, language: LetterLanguage, digits: DigitStyle) {
  const key = useKey()
  return useQuery({ queryKey: key('warning-letter', id, language, digits), queryFn: () => complianceApi.warningLetter(id, language, digits), enabled: useOn(!!id), retry: false })
}
export function usePolicies(enabled = true) {
  const key = useKey()
  return useQuery({ queryKey: key('policies'), queryFn: complianceApi.policies, enabled: useOn(enabled), retry: false })
}
export function usePolicy(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('policy', id), queryFn: () => complianceApi.policy(id), enabled: useOn(!!id), retry: false })
}
export function usePolicyStatus(id: string) {
  const key = useKey()
  return useQuery({ queryKey: key('policy-status', id), queryFn: () => complianceApi.policyStatus(id), enabled: useOn(!!id), retry: false })
}
export function useMyPolicies() {
  const key = useKey()
  return useQuery({ queryKey: key('my-policies'), queryFn: complianceApi.myPolicies, enabled: useOn(), retry: false })
}

/** A mutation that refreshes every HR query (and the bell) on success. */
export function useComplianceMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hr'] })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
