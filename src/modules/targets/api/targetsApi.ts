import { http } from '@/shared/lib/axios'
import type { AgentTargetRow, TargetDefaults, TargetsMonth, TargetValues, UpdateTargetsInput } from '@/modules/targets/types'
import { targetsMapper } from '@/shared/api/mappers'

/** Sales targets API. Scope (own / team / full) is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getTargets(month: string): Promise<TargetsMonth> {
  return targetsMapper.fromApi((await http.get<unknown>('/targets', { params: { month } })).data)
}

export async function updateTargets(userId: string, month: string, input: UpdateTargetsInput): Promise<AgentTargetRow> {
  return targetsMapper.fromApi((await http.put<unknown>(`/targets/${enc(userId)}`, targetsMapper.toApi(input), { params: { month } })).data)
}

/** Removes the agent's targets for the month, so the company defaults apply again. */
export async function resetTargets(userId: string, month: string): Promise<AgentTargetRow> {
  return targetsMapper.fromApi((await http.delete<unknown>(`/targets/${enc(userId)}`, { params: { month } })).data)
}

export async function getTargetDefaults(): Promise<TargetDefaults> {
  return targetsMapper.fromApi((await http.get<unknown>('/targets/defaults')).data)
}

/** Company Admin only. 0 means "no target" for that kind. */
export async function saveTargetDefaults(values: TargetValues): Promise<TargetDefaults> {
  return targetsMapper.fromApi((await http.put<unknown>('/targets/defaults', targetsMapper.toApi({ values }))).data)
}
