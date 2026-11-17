import { http } from '@/shared/lib/axios'
import type { AuditEntry, AutomationRules, LookupList, Lookups } from '@/modules/settings/types'

export async function getLookups(): Promise<Lookups> {
  return (await http.get<Lookups>('/lookups')).data
}

/** Replaces one list. Items keep their `key`; new items have none. Removing is refused: deactivate instead. */
export async function saveLookupList(list: LookupList, items: Lookups[LookupList]): Promise<Lookups> {
  return (await http.put<Lookups>(`/lookups/${list}`, { items })).data
}

export async function getAutomationRules(): Promise<AutomationRules> {
  return (await http.get<AutomationRules>('/settings/automation')).data
}

export async function saveAutomationRules(input: Partial<AutomationRules>): Promise<AutomationRules> {
  return (await http.put<AutomationRules>('/settings/automation', input)).data
}

export async function resetAutomationRules(): Promise<AutomationRules> {
  return (await http.post<AutomationRules>('/settings/automation/reset')).data
}

export interface AuditFilter {
  entity?: string
  userId?: string
  action?: string
  from?: string
  to?: string
}

export async function getAuditLog(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  return (await http.get<AuditEntry[]>('/audit-log', { params: filter })).data
}
