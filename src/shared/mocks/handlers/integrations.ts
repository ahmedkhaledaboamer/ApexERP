import { http, type HttpHandler } from 'msw'
import * as core from '@/shared/mocks/services/integrationsCore'
import * as svc from '@/shared/mocks/services/integrations'
import * as wa from '@/shared/mocks/services/integrationsWhatsApp'
import * as dev from '@/shared/mocks/services/integrationsDeveloper'
import * as m from '@/shared/api/integrationsMappers'
import { API, respondAs, userFrom } from './utils'

type Id = { id: string }
async function body(request: Request): Promise<unknown> {
  const raw = (await request.json().catch(() => null)) as unknown
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? m.integrationInputMapper.fromApi(raw) : {}
}
const query = (request: Request) => new URL(request.url).searchParams
const I = `${API}/integrations`

/**
 * Insights & admin › Integrations (docs/API.md › Integrations). Plan module `integrations` for every /integrations/*
 * path (central gate). Settings column: full writes, view reads; per-user calendar and WhatsApp sends have their own
 * rules (services/integrationsCore.ts). Static paths before `:id`. Public: the website webhook and the API-key API.
 */
export const integrationsHandlers: HttpHandler[] = [
  http.get(I, ({ request }) => respondAs(m.overviewMapper, () => svc.getOverview(userFrom(request)))),
  http.patch<{ key: string }>(`${I}/state/:key`, async ({ request, params }) => {
    const input = await body(request)
    return respondAs(m.overviewMapper, () => svc.setPaused(userFrom(request), params.key, input))
  }),
  http.post(`${I}/oauth/start`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.oauthConsentMapper, () => core.startOAuth(userFrom(request), input))
  }),

  /* ---- email ---- */
  http.get(`${I}/email`, ({ request }) => respondAs(m.emailMapper, () => svc.getEmail(userFrom(request)))),
  http.get(`${I}/email/log`, ({ request }) => respondAs(m.emailLogMapper, () => svc.getEmailLog(userFrom(request), { source: query(request).get('source'), status: query(request).get('status') }))),
  http.put(`${I}/email/smtp`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.emailMapper, () => svc.saveSmtp(userFrom(request), input))
  }),
  http.post(`${I}/email/connect`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.emailMapper, () => svc.connectEmailOAuth(userFrom(request), input))
  }),
  http.delete(`${I}/email`, ({ request }) => respondAs(m.emailMapper, () => svc.disconnectEmail(userFrom(request)))),
  http.post(`${I}/email/test`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.emailMapper, () => svc.sendTestEmail(userFrom(request), input))
  }),
  http.post(`${I}/email/verify-domain`, ({ request }) => respondAs(m.emailMapper, () => svc.verifyDomain(userFrom(request)))),
  http.patch(`${I}/email/senders`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.emailMapper, () => svc.updateSenders(userFrom(request), input))
  }),

  /* ---- website & forms ---- */
  http.get(`${I}/website`, ({ request }) => respondAs(m.websiteMapper, () => svc.getWebsite(userFrom(request)))),
  http.put(`${I}/website/webhook`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.websiteMapper, () => svc.updateInboundWebhook(userFrom(request), input))
  }),
  http.post(`${I}/website/webhook/rotate`, ({ request }) => respondAs(m.websiteMapper, () => svc.rotateWebhookToken(userFrom(request)))),
  http.post(`${I}/website/webhook/preview`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.mappingPreviewMapper, () => svc.previewMapping(userFrom(request), input))
  }),
  // Public (no session): the per-company token in the URL is the credential. The body is the third party's own fields (not mapped).
  http.post<{ token: string }>(`${API}/public/integrations/forms/:token`, async ({ request, params }) => {
    const raw = (await request.json().catch(() => null)) as unknown
    const client = request.headers.get('X-Client-Id')?.trim() || 'anonymous'
    return respondAs(m.integrationInputMapper, () => svc.receiveWebsiteWebhook(params.token, raw, client))
  }),

  /* ---- WhatsApp ---- */
  http.get(`${I}/whatsapp`, ({ request }) => respondAs(m.whatsappMapper, () => wa.getWhatsApp(userFrom(request)))),
  http.put(`${I}/whatsapp`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.whatsappMapper, () => wa.connectWhatsApp(userFrom(request), input))
  }),
  http.delete(`${I}/whatsapp`, ({ request }) => respondAs(m.whatsappMapper, () => wa.disconnectWhatsApp(userFrom(request)))),
  http.post(`${I}/whatsapp/templates`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.whatsappMapper, () => wa.createTemplate(userFrom(request), input))
  }),
  http.delete<Id>(`${I}/whatsapp/templates/:id`, ({ request, params }) => respondAs(m.whatsappMapper, () => wa.deleteTemplate(userFrom(request), params.id))),
  http.get(`${I}/whatsapp/send-options`, ({ request }) => respondAs(m.waSendOptionsMapper, () => wa.sendOptions(userFrom(request)))),
  http.post(`${I}/whatsapp/messages`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.waSendResultMapper, () => wa.sendTemplate(userFrom(request), input))
  }),
  http.get(`${I}/whatsapp/conversations`, ({ request }) => respondAs(m.waConversationMapper, () => wa.listConversations(userFrom(request)))),
  http.post(`${I}/whatsapp/inbound`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.waConversationMapper, () => wa.simulateInbound(userFrom(request), input))
  }),
  http.post<Id>(`${I}/whatsapp/conversations/:id/lead`, async ({ request, params }) => {
    const input = await body(request)
    return respondAs(m.waConversationMapper, () => wa.createLeadFromConversation(userFrom(request), params.id, input))
  }),

  /* ---- calendar (per user) ---- */
  http.get(`${I}/calendar/me`, ({ request }) => respondAs(m.myCalendarMapper, () => svc.getMyCalendar(userFrom(request)))),
  http.post(`${I}/calendar/me/connect`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.myCalendarMapper, () => svc.connectMyCalendar(userFrom(request), input))
  }),
  http.patch(`${I}/calendar/me`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.myCalendarMapper, () => svc.updateMyCalendar(userFrom(request), input))
  }),
  http.post(`${I}/calendar/me/sync`, ({ request }) => respondAs(m.myCalendarMapper, () => svc.syncMyCalendar(userFrom(request)))),
  http.delete(`${I}/calendar/me`, ({ request }) => respondAs(m.myCalendarMapper, () => svc.disconnectMyCalendar(userFrom(request)))),
  http.get(`${I}/calendar/connections`, ({ request }) => respondAs(m.calendarConnectionMapper, () => svc.getCalendarConnections(userFrom(request)))),

  /* ---- payments ---- */
  http.get(`${I}/payments`, ({ request }) => respondAs(m.paymentsMapper, () => svc.getPayments(userFrom(request)))),
  http.put<{ provider: string }>(`${I}/payments/:provider`, async ({ request, params }) => {
    const input = await body(request)
    return respondAs(m.paymentsMapper, () => svc.saveGateway(userFrom(request), params.provider, input))
  }),
  http.delete<{ provider: string }>(`${I}/payments/:provider`, ({ request, params }) => respondAs(m.paymentsMapper, () => svc.removeGateway(userFrom(request), params.provider))),
  http.post<{ provider: string }>(`${I}/payments/:provider/default`, ({ request, params }) => respondAs(m.paymentsMapper, () => svc.setDefaultGateway(userFrom(request), params.provider))),
  http.post<{ provider: string }>(`${I}/payments/:provider/test`, ({ request, params }) => respondAs(m.paymentsMapper, () => svc.testGateway(userFrom(request), params.provider))),

  /* ---- developer ---- */
  http.get(`${I}/api-keys`, ({ request }) => respondAs(m.apiKeyMapper, () => dev.listApiKeys(userFrom(request)))),
  http.post(`${I}/api-keys`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.createdApiKeyMapper, () => dev.createApiKey(userFrom(request), input))
  }),
  http.delete<Id>(`${I}/api-keys/:id`, ({ request, params }) => respondAs(m.apiKeyMapper, () => dev.revokeApiKey(userFrom(request), params.id))),
  http.get(`${I}/webhooks`, ({ request }) => respondAs(m.webhookMapper, () => dev.listWebhooks(userFrom(request)))),
  http.post(`${I}/webhooks`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.webhookMapper, () => dev.createWebhook(userFrom(request), input))
  }),
  http.patch<Id>(`${I}/webhooks/:id`, async ({ request, params }) => {
    const input = await body(request)
    return respondAs(m.webhookMapper, () => dev.updateWebhook(userFrom(request), params.id, input))
  }),
  http.delete<Id>(`${I}/webhooks/:id`, ({ request, params }) => respondAs(m.integrationInputMapper, () => dev.deleteWebhook(userFrom(request), params.id))),
  http.get<Id>(`${I}/webhooks/:id/deliveries`, ({ request, params }) => respondAs(m.deliveryMapper, () => dev.listDeliveries(userFrom(request), params.id))),
  http.post<Id>(`${I}/webhooks/:id/test`, ({ request, params }) => respondAs(m.deliveryMapper, () => dev.testWebhook(userFrom(request), params.id))),
  http.post<Id>(`${I}/webhook-deliveries/:id/retry`, ({ request, params }) => respondAs(m.deliveryMapper, () => dev.retryDelivery(userFrom(request), params.id))),

  /* ---- sync log ---- */
  http.get(`${I}/sync-log`, ({ request }) => {
    const q = query(request)
    return respondAs(m.syncLogMapper, () => svc.getSyncLog(userFrom(request), { integration: q.get('integration'), status: q.get('status'), direction: q.get('direction') }))
  }),

  /* ---- public API (X-Api-Key) ---- */
  http.get(`${API}/public/v1/leads`, ({ request }) => respondAs(m.integrationInputMapper, () => dev.publicListLeads(request.headers.get('X-Api-Key')))),
  http.post(`${API}/public/v1/leads`, async ({ request }) => {
    const input = await body(request)
    return respondAs(m.integrationInputMapper, () => dev.publicCreateLead(request.headers.get('X-Api-Key'), input))
  }),
]
