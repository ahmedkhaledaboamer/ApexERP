import { leads } from '@/shared/mocks/db'
import { nextIntegrationId, waConversations, waTemplates, whatsappConfigs } from '@/shared/mocks/data/integrations'
import { ADMIN, adminToken, api, APEX, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of Insights & admin › Integrations (handlers/integrations.ts), spread into ENDPOINTS
 * (endpoints.ts). Samples run as the company admin (settings full) and prepare fresh records through the API (a new
 * template / key / webhook / conversation per call), so the spoofing re-runs stay valid. Writes that depend on a state
 * the previous run changed (consumed OAuth state, already disconnected) list the second status in `expect`.
 */

const M = 'integrations'
let n = 0
const uniq = () => `${Date.now().toString(36)}${++n}`
const domain = (co: Co) => (co === APEX ? 'apexaora.ae' : 'crestlogistics.sa')
const mobile = (co: Co) => (co === APEX ? `+97150${String(1000000 + (n++ % 8999999)).padStart(7, '0')}` : `+96655${String(1000000 + (n++ % 8999999)).padStart(7, '0')}`)
const ownGateway = (co: Co) => (co === APEX ? 'telr' : 'tap')

/** WhatsApp connected for `co` (Crest isn't, in the seed). */
async function waOn(co: Co): Promise<void> {
  if (whatsappConfigs.get(co).connected) return
  const r = await api(adminToken(co), 'PUT', '/integrations/whatsapp', { body: { phone_number_id: '1098765432109', business_account_id: '2039485761203', access_token: `EAAG-isolation-${uniq()}-token` } })
  if (r.status !== 200) throw new Error(`isolation: WhatsApp connect failed ${r.text}`)
}
/** An approved template of `co` (pushed straight into the store: the review takes 10 s). */
export function approvedTemplate(co: Co): string {
  const found = waTemplates.find((t) => t.companyId === co && t.status === 'approved')
  if (found) return found.id
  const id = nextIntegrationId('WAT')
  waTemplates.push({ companyId: co, id, name: `iso_${uniq()}`, language: 'en', category: 'utility', body: 'Hello {{1}}, about {{2}}.', status: 'approved', rejectionReason: null, submittedAt: new Date().toISOString(), decideAt: 0, decidedAt: new Date().toISOString(), createdBy: 'Isolation' })
  return id
}
/** An open lead of `co` with a mobile, not Do Not Contact, owned by anyone (the admin has full scope). */
export const waLead = (co: Co) => leads.find((l) => l.companyId === co && !l.doNotContact && !!l.mobile && !['Won', 'Lost', 'Not interested'].includes(l.status))!
async function freshConversation(co: Co): Promise<string> {
  const id = nextIntegrationId('WAC')
  waConversations.push({ companyId: co, id, from: mobile(co), name: 'Isolation sender', leadId: null, lastMessageAt: new Date().toISOString(), messages: [{ id: nextIntegrationId('WAM'), direction: 'in', text: 'Hello', at: new Date().toISOString() }] })
  return id
}
async function freshTemplate(co: Co): Promise<string> {
  await waOn(co)
  const r = await api(adminToken(co), 'POST', '/integrations/whatsapp/templates', { body: { name: `iso_${uniq()}`, language: 'en', category: 'utility', body: 'Hi {{1}}' } })
  return (r.body.templates as { id: string; name: string }[]).find((t) => t.name.startsWith('iso_'))!.id
}
async function freshKey(co: Co): Promise<string> {
  const r = await api(adminToken(co), 'POST', '/integrations/api-keys', { body: { name: `Iso ${uniq()}`, scopes: { leads: 'read' } } })
  return r.body.key.id
}
async function freshHook(co: Co, url = 'https://example.org/hooks/crm'): Promise<string> {
  const r = await api(adminToken(co), 'POST', '/integrations/webhooks', { body: { url, events: ['lead.created'], secret: `whsec_isolation_${uniq()}` } })
  return r.body.id
}
async function failedDelivery(co: Co): Promise<string> {
  const id = await freshHook(co, 'https://fail.example.org/hook')
  const r = await api(adminToken(co), 'POST', `/integrations/webhooks/${id}/test`)
  return r.body.id
}
async function consent(co: Co, purpose: 'email' | 'calendar') {
  const r = await api(adminToken(co), 'POST', '/integrations/oauth/start', { body: { purpose, provider: purpose === 'email' ? 'microsoft' : 'google' } })
  return { state: r.body.state as string, approve: true }
}

const PUBLIC_HOOK =
  'Website webhook for third-party forms (no sign-in by design): the per-company token in the URL is the credential and decides the company; an unknown token, a company without the Integrations module or a deleted / suspended workspace answer the same 404. Rate-limited per client (X-Client-Id) and per token; leads are created through the lead creation service in that company only (integrations.isolation.test.ts: one company’s token never creates leads in the other).'
const PUBLIC_API =
  'Company REST API authenticated by an X-Api-Key (no session): the company comes from the key only; unknown / revoked keys, a company without the module or a deleted / suspended workspace answer the same 401; scope per module (read / write), 120 calls a minute per key.'

export const INTEGRATIONS_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/integrations', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PATCH', path: '/integrations/state/:key', kind: 'company-item', module: M, notOwned: ['key'], sample: () => ({ params: { key: 'website' }, body: { paused: false } }) },
  { method: 'POST', path: '/integrations/oauth/start', kind: 'company-write', module: M, sample: () => ({ body: { purpose: 'email', provider: 'google' } }) },

  /* email */
  { method: 'GET', path: '/integrations/email', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/integrations/email/log', kind: 'company-export', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/integrations/email/smtp', kind: 'company-write', module: M, sample: (co) => ({ body: { host: `smtp.${domain(co)}`, port: 587, security: 'starttls', username: `mailer@${domain(co)}`, password: `Isolation-smtp-${uniq()}`, from_name: 'Isolation', from_address: `mailer@${domain(co)}` } }) },
  { method: 'POST', path: '/integrations/email/connect', kind: 'company-write', module: M, sample: async (co) => ({ body: await consent(co, 'email'), expect: [200, 422] }) },
  { method: 'DELETE', path: '/integrations/email', kind: 'company-write', module: M, sample: () => ({ expect: [200, 409] }) },
  { method: 'POST', path: '/integrations/email/test', kind: 'company-write', module: M, sample: (co) => ({ body: { to: `iso@${domain(co)}` }, expect: [200, 409] }) },
  { method: 'POST', path: '/integrations/email/verify-domain', kind: 'company-write', module: M, sample: () => ({}) },
  { method: 'PATCH', path: '/integrations/email/senders', kind: 'company-write', module: M, sample: (co) => ({ body: { sales: { name: 'Isolation', address: `iso@${domain(co)}` } } }) },

  /* website */
  { method: 'GET', path: '/integrations/website', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/integrations/website/webhook', kind: 'company-write', module: M, sample: (co) => ({ body: { default_source: 'Website', default_owner_id: ADMIN[co] } }) },
  { method: 'POST', path: '/integrations/website/webhook/rotate', kind: 'company-write', module: M, sample: () => ({}) },
  { method: 'POST', path: '/integrations/website/webhook/preview', kind: 'company-write', module: M, sample: () => ({ body: { payload: { name: 'Iso Person', email: 'iso@example.org', company: 'Iso Co' } } }) },
  { method: 'POST', path: '/public/integrations/forms/:token', kind: 'public', module: M, reason: PUBLIC_HOOK },

  /* WhatsApp */
  { method: 'GET', path: '/integrations/whatsapp', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/integrations/whatsapp', kind: 'company-write', module: M, sample: () => ({ body: { phone_number_id: '1098765432109', business_account_id: '2039485761203', access_token: `EAAG-isolation-${uniq()}-token` } }) },
  { method: 'DELETE', path: '/integrations/whatsapp', kind: 'company-write', module: M, sample: () => ({ expect: [200, 409] }) },
  { method: 'POST', path: '/integrations/whatsapp/templates', kind: 'company-write', module: M, sample: async (co) => (await waOn(co), { body: { name: `iso_${uniq()}`, language: 'en', category: 'utility', body: 'Hi {{1}}' } }) },
  { method: 'DELETE', path: '/integrations/whatsapp/templates/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshTemplate(co) } }) },
  { method: 'GET', path: '/integrations/whatsapp/send-options', kind: 'company-list', module: M, sample: () => ({}) },
  {
    method: 'POST', path: '/integrations/whatsapp/messages', kind: 'company-write', module: M,
    sample: async (co) => {
      await waOn(co)
      const l = waLead(co)
      return { body: { lead_id: l.id, template_id: approvedTemplate(co), to: l.mobile, params: ['Iso', 'the proposal'] } }
    },
  },
  { method: 'GET', path: '/integrations/whatsapp/conversations', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/integrations/whatsapp/inbound', kind: 'company-write', module: M, sample: async (co) => (await waOn(co), { body: { from: mobile(co), name: 'Iso sender', text: 'Hello from isolation' } }) },
  { method: 'POST', path: '/integrations/whatsapp/conversations/:id/lead', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshConversation(co) }, body: { company: `Iso WA ${uniq()}` }, expect: [200, 409] }) },

  /* calendar (per user) */
  { method: 'GET', path: '/integrations/calendar/me', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/integrations/calendar/me/connect', kind: 'company-write', module: M, sample: async (co) => ({ body: await consent(co, 'calendar'), expect: [200, 422] }) },
  { method: 'PATCH', path: '/integrations/calendar/me', kind: 'company-write', module: M, sample: (co) => ({ as: co === APEX ? 'u3' : ADMIN[co], body: { show_busy: true }, expect: [200, 409] }) },
  { method: 'POST', path: '/integrations/calendar/me/sync', kind: 'company-write', module: M, sample: (co) => ({ as: co === APEX ? 'u3' : ADMIN[co], expect: [200, 409] }) },
  { method: 'DELETE', path: '/integrations/calendar/me', kind: 'company-write', module: M, sample: (co) => ({ as: co === APEX ? 'u4' : ADMIN[co], expect: [200, 409] }) },
  { method: 'GET', path: '/integrations/calendar/connections', kind: 'company-list', module: M, sample: () => ({}) },

  /* payments */
  { method: 'GET', path: '/integrations/payments', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/integrations/payments/:provider', kind: 'company-item', module: M, notOwned: ['provider'], sample: () => ({ params: { provider: 'stripe' }, body: { merchant_id: 'acct_isolation', secret_key: `sk_test_isolation_${uniq()}`, mode: 'test', currency: 'USD' } }) },
  { method: 'DELETE', path: '/integrations/payments/:provider', kind: 'company-item', module: M, notOwned: ['provider'], sample: (co) => ({ params: { provider: ownGateway(co) }, expect: [200, 409] }) },
  { method: 'POST', path: '/integrations/payments/:provider/default', kind: 'company-item', module: M, notOwned: ['provider'], sample: (co) => ({ params: { provider: ownGateway(co) } }) },
  { method: 'POST', path: '/integrations/payments/:provider/test', kind: 'company-item', module: M, notOwned: ['provider'], sample: (co) => ({ params: { provider: ownGateway(co) } }) },

  /* developer */
  { method: 'GET', path: '/integrations/api-keys', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/integrations/api-keys', kind: 'company-write', module: M, sample: () => ({ body: { name: `Isolation ${uniq()}`, scopes: { leads: 'read', tasks: 'write' } } }) },
  { method: 'DELETE', path: '/integrations/api-keys/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshKey(co) } }) },
  { method: 'GET', path: '/integrations/webhooks', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'POST', path: '/integrations/webhooks', kind: 'company-write', module: M, sample: () => ({ body: { url: 'https://example.org/hooks/iso', events: ['lead.created', 'deal.won'], secret: `whsec_isolation_${uniq()}` } }) },
  { method: 'PATCH', path: '/integrations/webhooks/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshHook(co) }, body: { events: ['lead.created', 'invoice.issued'] } }) },
  { method: 'DELETE', path: '/integrations/webhooks/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshHook(co) } }) },
  { method: 'GET', path: '/integrations/webhooks/:id/deliveries', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshHook(co) } }) },
  { method: 'POST', path: '/integrations/webhooks/:id/test', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await freshHook(co) } }) },
  { method: 'POST', path: '/integrations/webhook-deliveries/:id/retry', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await failedDelivery(co) } }) },

  /* sync log */
  { method: 'GET', path: '/integrations/sync-log', kind: 'company-export', module: M, sample: () => ({ query: { status: 'error' } }) },

  /* public API */
  { method: 'GET', path: '/public/v1/leads', kind: 'public', module: M, reason: PUBLIC_API },
  { method: 'POST', path: '/public/v1/leads', kind: 'public', module: M, reason: PUBLIC_API + ' Needs leads:write; the lead lands in the key’s company.' },
]
