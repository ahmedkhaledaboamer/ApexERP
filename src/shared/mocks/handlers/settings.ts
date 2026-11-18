import { http } from 'msw'
import type { AutomationRules } from '@/modules/settings/types'
import * as svc from '@/shared/mocks/services/settings'
import { automationMapper, AUDIT_QUERY, auditEntryMapper, lookupItemMapper, lookupListFromApi, lookupsMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

export const settingsHandlers = [
  // Lists speak their table and column names (lead_statuses: code, name, type, requires_next_step…).
  http.get(`${API}/lookups`, ({ request }) => respondAs(lookupsMapper, () => svc.getLookups(userFrom(request)))),
  http.put<{ list: string }>(`${API}/lookups/:list`, async ({ request, params }) => {
    const { items } = (await request.json()) as { items: unknown }
    // `:list` is the table name (lead_statuses, loss_reasons…); an unknown one (old camelCase names included) is answered 404 by the service.
    const list = lookupListFromApi(params.list)
    const parsed = list && Array.isArray(items) ? lookupItemMapper(list).fromApiList(items) : items
    return respondAs(lookupsMapper, () => svc.saveLookupList(userFrom(request), list ?? (`unknown:${params.list}` as never), parsed))
  }),
  http.get(`${API}/settings/automation`, ({ request }) => respondAs(automationMapper, () => svc.getAutomationRules(userFrom(request)))),
  http.put(`${API}/settings/automation`, async ({ request }) => {
    const body = await bodyAs<Partial<AutomationRules>>(request, automationMapper)
    return respondAs(automationMapper, () => svc.saveAutomationRules(userFrom(request), body))
  }),
  http.post(`${API}/settings/automation/reset`, ({ request }) => respondAs(automationMapper, () => svc.resetAutomationRules(userFrom(request)))),
  http.get(`${API}/audit-log`, ({ request }) => {
    const p = new URL(request.url).searchParams
    return respondAs(auditEntryMapper, () =>
      svc.getAuditLog(userFrom(request), {
        entity: p.get(AUDIT_QUERY.entity) ?? undefined,
        userId: p.get(AUDIT_QUERY.userId) ?? undefined,
        action: p.get(AUDIT_QUERY.action) ?? undefined,
        from: p.get(AUDIT_QUERY.from) ?? undefined,
        to: p.get(AUDIT_QUERY.to) ?? undefined,
      }),
    )
  }),
]
