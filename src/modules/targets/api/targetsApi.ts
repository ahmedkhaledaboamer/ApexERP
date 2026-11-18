import { http } from '@/shared/lib/axios'
import type { AgentTargetRow, TargetDefaults, TargetsMonth, TargetValues, UpdateTargetsInput } from '@/modules/targets/types'

/** Sales targets API. Scope (own / team / full) is decided by the server from the auth token. */

const enc = encodeURIComponent

export async function getTargets(month: string): Promise<TargetsMonth> {
  return (await http.get<TargetsMonth>('/targets', { params: { month } })).data
}

export async function updateTargets(userId: string, month: string, input: UpdateTargetsInput): Promise<AgentTargetRow> {
  return (await http.put<AgentTargetRow>(`/targets/${enc(userId)}`, input, { params: { month } })).data
}

/** Removes the agent's targets for the month, so the company defaults apply again. */
export async function resetTargets(userId: string, month: string): Promise<AgentTargetRow> {
  return (await http.delete<AgentTargetRow>(`/targets/${enc(userId)}`, { params: { month } })).data
}

export async function getTargetDefaults(): Promise<TargetDefaults> {
  return (await http.get<TargetDefaults>('/targets/defaults')).data
}

/** Company Admin only. 0 means "no target" for that kind. */
export async function saveTargetDefaults(values: TargetValues): Promise<TargetDefaults> {
  return (await http.put<TargetDefaults>('/targets/defaults', { values })).data
}
