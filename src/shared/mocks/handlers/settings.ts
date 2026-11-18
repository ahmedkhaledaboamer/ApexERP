import { http } from 'msw'
import type { AutomationRules, LookupList } from '@/modules/settings/types'
import * as svc from '@/shared/mocks/services/settings'
import { API, respond, userFrom } from './utils'

export const settingsHandlers = [
  http.get(`${API}/lookups`, ({ request }) => respond(() => svc.getLookups(userFrom(request)))),
  http.put<{ list: string }>(`${API}/lookups/:list`, async ({ request, params }) => {
    const { items } = (await request.json()) as { items: unknown }
    return respond(() => svc.saveLookupList(userFrom(request), params.list as LookupList, items))
  }),
  http.get(`${API}/settings/automation`, ({ request }) => respond(() => svc.getAutomationRules(userFrom(request)))),
  http.put(`${API}/settings/automation`, async ({ request }) => {
    const body = (await request.json()) as Partial<AutomationRules>
    return respond(() => svc.saveAutomationRules(userFrom(request), body))
  }),
  http.post(`${API}/settings/automation/reset`, ({ request }) => respond(() => svc.resetAutomationRules(userFrom(request)))),
  http.get(`${API}/audit-log`, ({ request }) => {
    const p = new URL(request.url).searchParams
    return respond(() =>
      svc.getAuditLog(userFrom(request), {
        entity: p.get('entity') ?? undefined,
        userId: p.get('userId') ?? undefined,
        action: p.get('action') ?? undefined,
        from: p.get('from') ?? undefined,
        to: p.get('to') ?? undefined,
      }),
    )
  }),
]
