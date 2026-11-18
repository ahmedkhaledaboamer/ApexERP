import { http, type HttpHandler } from 'msw'
import type { TemplateChannel, TemplateFilter, TemplateInput, TemplatePurpose, TemplateUpdateInput } from '@/modules/settings/templates/types'
import * as svc from '@/shared/mocks/services/templates'
import { TEMPLATE_QUERY, templateMapper } from '@/shared/api/mappers'
import { API, bodyAs, respondAs, userFrom } from './utils'

type Params = { id: string }

export const templatesHandlers: HttpHandler[] = [
  http.get(`${API}/templates`, ({ request }) => {
    const url = new URL(request.url)
    const active = url.searchParams.get(TEMPLATE_QUERY.active)
    const filter: TemplateFilter = {
      channel: (url.searchParams.get(TEMPLATE_QUERY.channel) as TemplateChannel | null) ?? undefined,
      purpose: (url.searchParams.get(TEMPLATE_QUERY.purpose) as TemplatePurpose | null) ?? undefined,
      active: active === null ? undefined : active === 'true',
    }
    return respondAs(templateMapper, () => svc.getTemplates(userFrom(request), filter))
  }),
  http.get<Params>(`${API}/templates/:id`, ({ request, params }) => respondAs(templateMapper, () => svc.getTemplate(userFrom(request), params.id))),
  http.post(`${API}/templates`, async ({ request }) => {
    const body = await bodyAs<TemplateInput>(request, templateMapper)
    return respondAs(templateMapper, () => svc.createTemplate(userFrom(request), body))
  }),
  http.patch<Params>(`${API}/templates/:id`, async ({ request, params }) => {
    const body = await bodyAs<TemplateUpdateInput>(request, templateMapper)
    return respondAs(templateMapper, () => svc.updateTemplate(userFrom(request), params.id, body))
  }),
  http.post<Params>(`${API}/templates/:id/duplicate`, ({ request, params }) =>
    respondAs(templateMapper, () => svc.duplicateTemplate(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/templates/:id/default`, ({ request, params }) =>
    respondAs(templateMapper, () => svc.makeDefaultTemplate(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/templates/:id/deactivate`, ({ request, params }) =>
    respondAs(templateMapper, () => svc.setTemplateActive(userFrom(request), params.id, false)),
  ),
  http.post<Params>(`${API}/templates/:id/reactivate`, ({ request, params }) =>
    respondAs(templateMapper, () => svc.setTemplateActive(userFrom(request), params.id, true)),
  ),
]
