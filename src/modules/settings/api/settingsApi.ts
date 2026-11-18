import { http } from '@/shared/lib/axios'
import type { AuditEntry, AutomationRules, LookupList, Lookups } from '@/modules/settings/types'
import { automationMapper, AUDIT_QUERY, auditEntryMapper, LOOKUP_LIST_API, lookupItemMapper, lookupsMapper } from '@/shared/api/mappers'

/** The lists come in their table / column names (lead_statuses: code, name, type…) and are mapped to the UI shape. */
export async function getLookups(): Promise<Lookups> {
  return lookupsMapper.fromApi((await http.get<unknown>('/lookups')).data)
}

/** Replaces one list. Items keep their `key`; new items have none. Removing is refused: deactivate instead. */
export async function saveLookupList(list: LookupList, items: Lookups[LookupList]): Promise<Lookups> {
  const body = { items: lookupItemMapper(list).toApi(items as never[]) }
  return lookupsMapper.fromApi((await http.put<unknown>(`/lookups/${LOOKUP_LIST_API[list]}`, body)).data)
}

export async function getAutomationRules(): Promise<AutomationRules> {
  return automationMapper.fromApi((await http.get<unknown>('/settings/automation')).data)
}

export async function saveAutomationRules(input: Partial<AutomationRules>): Promise<AutomationRules> {
  return automationMapper.fromApi((await http.put<unknown>('/settings/automation', automationMapper.toApi(input))).data)
}

export async function resetAutomationRules(): Promise<AutomationRules> {
  return automationMapper.fromApi((await http.post<unknown>('/settings/automation/reset')).data)
}

export interface AuditFilter {
  entity?: string
  userId?: string
  action?: string
  from?: string
  to?: string
}

export async function getAuditLog(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const params = Object.fromEntries(Object.entries(filter).map(([k, v]) => [AUDIT_QUERY[k as keyof AuditFilter] ?? k, v]))
  return auditEntryMapper.fromApiList((await http.get<unknown>('/audit-log', { params })).data)
}
