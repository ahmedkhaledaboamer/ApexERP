import { http, type HttpHandler } from 'msw'
import type { TemplateChannel, TemplateFilter, TemplateInput, TemplatePurpose, TemplateUpdateInput } from '@/modules/settings/templates/types'
import * as svc from '@/shared/mocks/services/templates'
import { API, respond, userFrom } from './utils'

type Params = { id: string }

export const templatesHandlers: HttpHandler[] = [
  http.get(`${API}/templates`, ({ request }) => {
    const url = new URL(request.url)
    const active = url.searchParams.get('active')
    const filter: TemplateFilter = {
      channel: (url.searchParams.get('channel') as TemplateChannel | null) ?? undefined,
      purpose: (url.searchParams.get('purpose') as TemplatePurpose | null) ?? undefined,
      active: active === null ? undefined : active === 'true',
    }
    return respond(() => svc.getTemplates(userFrom(request), filter))
  }),
  http.get<Params>(`${API}/templates/:id`, ({ request, params }) => respond(() => svc.getTemplate(userFrom(request), params.id))),
  http.post(`${API}/templates`, async ({ request }) => {
    const body = (await request.json()) as TemplateInput
    return respond(() => svc.createTemplate(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/templates/:id`, async ({ request, params }) => {
    const body = (await request.json()) as TemplateUpdateInput
    return respond(() => svc.updateTemplate(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/templates/:id/duplicate`, ({ request, params }) =>
    respond(() => svc.duplicateTemplate(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/templates/:id/default`, ({ request, params }) =>
    respond(() => svc.makeDefaultTemplate(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/templates/:id/deactivate`, ({ request, params }) =>
    respond(() => svc.setTemplateActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/templates/:id/reactivate`, ({ request, params }) =>
    respond(() => svc.setTemplateActive(userFrom(request), params.id, true)),
  ),
]
