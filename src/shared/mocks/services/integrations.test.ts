import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '@/shared/mocks/handlers'
import type { User } from '@/shared/types'
import { activities, leads, users } from '@/shared/mocks/db'
import { notifications } from '@/shared/mocks/data/tasks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { nowMs, resetClock } from '@/shared/mocks/clock'
import { apiKeys, integrationSecrets, secretKey, syncLog, waTemplates, webhookDeliveries } from '@/shared/mocks/data/integrations'
import { addSync, startOAuth } from './integrationsCore'
import * as svc from './integrations'
import * as wa from './integrationsWhatsApp'
import * as dev from './integrationsDeveloper'
import { insertLead } from './leads'

const seed = takeSnapshot(true)
beforeEach(() => resetClock())
afterEach(() => {
  restoreSnapshot(seed)
  resetClock()
})

const u = (id: string): User => users.find((x) => x.id === id)!
const apexAdmin = () => u('u1')
const crestAdmin = () => u('u101')
const apexManagement = () => u('u2')
const apexAgent = () => u('u4')
const fails = async (p: Promise<unknown>, status: number, code?: string) => {
  await expect(p).rejects.toMatchObject(code ? { status, code } : { status })
}
const websiteToken = (co: string) => {
  svc.getWebsite(co === 'co_apex' ? apexAdmin() : crestAdmin())
  return integrationSecrets.get(secretKey(co, 'website', 'token'))!
}

describe('credentials are write-only and served masked', () => {
  it('SMTP: the password is stored server-side, the view carries a hint only; empty keeps it', async () => {
    const view = await svc.saveSmtp(apexAdmin(), { host: 'smtp.apexaora.ae', port: 587, security: 'starttls', username: 'mailer@apexaora.ae', password: 'S3cret-smtp-pass', fromName: 'Apex', fromAddress: 'mailer@apexaora.ae' })
    expect(view.provider).toBe('smtp')
    expect(view.passwordHint).toBe('•••• pass')
    expect(JSON.stringify(view)).not.toContain('S3cret-smtp-pass')
    expect(integrationSecrets.get(secretKey('co_apex', 'smtp', 'password'))).toBe('S3cret-smtp-pass')
    // The OAuth token of the previous (Google) connection is gone.
    expect(integrationSecrets.has(secretKey('co_apex', 'oauth-email', 'token'))).toBe(false)
    const again = await svc.saveSmtp(apexAdmin(), { host: 'smtp2.apexaora.ae', port: 465, security: 'ssl', username: 'mailer@apexaora.ae', fromName: 'Apex', fromAddress: 'mailer@apexaora.ae' })
    expect(again.smtp?.host).toBe('smtp2.apexaora.ae')
    expect(integrationSecrets.get(secretKey('co_apex', 'smtp', 'password'))).toBe('S3cret-smtp-pass')
  })

  it('SMTP from an OAuth connection needs a password; Management can read but not write', async () => {
    await fails(svc.saveSmtp(crestAdmin(), { host: 'smtp.crestlogistics.sa', port: 587, security: 'starttls', username: 'x', fromAddress: 'x@crestlogistics.sa' }), 422, 'password_required')
    expect((await svc.getEmail(apexManagement())).provider).toBe('google')
    await fails(svc.saveSmtp(apexManagement(), {}), 403)
    await fails(svc.getEmail(apexAgent()), 403)
  })

  it('gateway secret keys and the WhatsApp token never come back', async () => {
    const pay = await svc.saveGateway(apexAdmin(), 'stripe', { merchantId: 'acct_123', secretKey: 'sk_test_abcdefghijklmnop', mode: 'test', currency: 'USD' })
    const stripe = pay.gateways.find((g) => g.provider === 'stripe')!
    expect(stripe.secretKeyHint).toBe('•••• mnop')
    expect(JSON.stringify(pay)).not.toContain('sk_test_abcdefghijklmnop')
    const w = await wa.connectWhatsApp(crestAdmin(), { phoneNumberId: '1234567890123', businessAccountId: '9876543210987', accessToken: 'EAAG-crest-access-token-123' })
    expect(w.tokenHint).toBe('•••• -123')
    expect(JSON.stringify(w)).not.toContain('EAAG-crest-access-token-123')
    expect(w.displayNumber).toMatch(/^\+966/)
  })
})

describe('mock OAuth (email, calendar)', () => {
  it('consent → connected as an address of the company domain; the state is one-time and bound to the caller', async () => {
    const consent = startOAuth(crestAdmin(), { purpose: 'email', provider: 'google' })
    expect(consent.account).toBe('faisal@crestlogistics.sa')
    expect(consent.scopes.length).toBeGreaterThan(0)
    // Another user of the company can't finish it.
    await fails(svc.connectEmailOAuth(u('u102'), { state: consent.state, approve: true }), 403)
    const view = await svc.connectEmailOAuth(crestAdmin(), { state: consent.state, approve: true })
    expect(view).toMatchObject({ provider: 'google', connectedAs: 'faisal@crestlogistics.sa', domain: 'crestlogistics.sa' })
    expect(view.tokenHint).toMatch(/^•••• /)
    await fails(svc.connectEmailOAuth(crestAdmin(), { state: consent.state, approve: true }), 422, 'oauth_state_invalid')
  })

  it('denied consent connects nothing; a foreign state answers like an unknown one', async () => {
    const consent = startOAuth(apexAdmin(), { purpose: 'email', provider: 'microsoft' })
    await fails(svc.connectEmailOAuth(apexAdmin(), { state: consent.state, approve: false }), 422, 'consent_denied')
    expect((await svc.getEmail(apexAdmin())).provider).toBe('google')
    const other = startOAuth(crestAdmin(), { purpose: 'email', provider: 'google' })
    await fails(svc.connectEmailOAuth(apexAdmin(), { state: other.state, approve: true }), 422, 'oauth_state_invalid')
    expect(() => startOAuth(apexAgent(), { purpose: 'email', provider: 'google' })).toThrow()
  })

  it('calendar: every role connects their own calendar; admins see who, never a token', async () => {
    const agent = u('u5')
    const consent = startOAuth(agent, { purpose: 'calendar', provider: 'outlook' })
    expect(consent.account).toBe(agent.email)
    const mine = await svc.connectMyCalendar(agent, { state: consent.state, approve: true })
    expect(mine).toMatchObject({ status: 'connected', provider: 'outlook', connectedAs: agent.email })
    const rows = await svc.getCalendarConnections(apexAdmin())
    expect(rows.map((r) => r.userId)).toEqual(expect.arrayContaining(['u3', 'u4', 'u5']))
    expect(JSON.stringify(rows)).not.toMatch(/token|ya29|EwB0/)
    const synced = await svc.syncMyCalendar(agent)
    expect(synced.lastSyncAt).not.toBeNull()
    await fails(svc.getCalendarConnections(agent), 403)
  })
})

describe('website webhook', () => {
  it('maps the posted fields to a new lead in the token’s company only (unmapped fields go to the note)', async () => {
    const before = leads.length
    await svc.receiveWebsiteWebhook(websiteToken('co_apex'), { fields: { name: 'Hala Nasser', email: 'hala@nasser-trading.example', company: 'Nasser Trading', phone: '0501234567', message: 'Call me', budget: '20k' } }, 'c1')
    expect(leads.length).toBe(before + 1)
    const lead = leads[leads.length - 1]
    expect(lead).toMatchObject({ companyId: 'co_apex', company: 'Nasser Trading', contactName: 'Hala Nasser', contactEmail: 'hala@nasser-trading.example', mobile: '+971501234567', sourceType: 'Website', ownerId: 'u4' })
    expect(syncLog[0]).toMatchObject({ companyId: 'co_apex', integration: 'website', direction: 'inbound', status: 'success' })
    // Same email again: linked, no duplicate.
    await svc.receiveWebsiteWebhook(websiteToken('co_apex'), { name: 'Hala', email: 'HALA@nasser-trading.example' }, 'c1')
    expect(leads.length).toBe(before + 1)
    expect(activities.some((a) => a.leadId === lead.id && a.type === 'system' && /webhook/.test(a.summary))).toBe(true)
  })

  it('a token of one company never creates leads in the other; unknown and rotated tokens answer 404', async () => {
    const crestBefore = leads.filter((l) => l.companyId === 'co_crest').length
    const apexBefore = leads.filter((l) => l.companyId === 'co_apex').length
    await svc.receiveWebsiteWebhook(websiteToken('co_crest'), { name: 'Saad', email: 'saad@example.sa', company: 'Saad Co' })
    expect(leads.filter((l) => l.companyId === 'co_crest').length).toBe(crestBefore + 1)
    expect(leads.filter((l) => l.companyId === 'co_apex').length).toBe(apexBefore)
    const old = websiteToken('co_crest')
    await svc.rotateWebhookToken(crestAdmin())
    expect(websiteToken('co_crest')).not.toBe(old)
    await fails(svc.receiveWebsiteWebhook(old, { name: 'x', email: 'x@example.sa' }), 404, 'webhook_not_found')
    await fails(svc.receiveWebsiteWebhook('whk_does-not-exist-at-all-000', { name: 'x', email: 'x@example.sa' }), 404, 'webhook_not_found')
  })

  it('rejects a submission without contact details, honours pause, and rate-limits per client', async () => {
    const t = websiteToken('co_apex')
    await fails(svc.receiveWebsiteWebhook(t, { company: 'No contact' }), 422, 'invalid_submission')
    await svc.setPaused(apexAdmin(), 'website', { paused: true })
    await fails(svc.receiveWebsiteWebhook(t, { name: 'a', email: 'a@example.org' }), 409, 'webhook_paused')
    await svc.setPaused(apexAdmin(), 'website', { paused: false })
    for (let i = 0; i < svc.WEBHOOK_RATE.perClient; i++) await svc.receiveWebsiteWebhook(t, { name: `P${i}`, email: `p${i}@rate.example` }, 'rl')
    await fails(svc.receiveWebsiteWebhook(t, { name: 'over', email: 'over@rate.example' }, 'rl'), 429, 'rate_limited')
  })

  it('mapping must keep a contact and a name; preview shows the result without storing', async () => {
    await fails(svc.updateInboundWebhook(apexAdmin(), { fieldMap: { company: 'company' } }), 422, 'mapping_incomplete')
    const site = await svc.updateInboundWebhook(apexAdmin(), { fieldMap: { 'Full Name': 'contactName', 'E-mail': 'email' } })
    expect(site.webhook.fieldMap).toEqual({ 'full name': 'contactName', 'e-mail': 'email' })
    const p = await svc.previewMapping(apexAdmin(), { payload: { 'Full Name': 'Ali', 'E-mail': 'ali@example.org', city: 'Dubai' } })
    expect(p.lead).toMatchObject({ contactName: 'Ali', email: 'ali@example.org' })
    expect(p.unmapped).toEqual(['city'])
    // Management sees the URL masked; the admin sees the token.
    expect((await svc.getWebsite(apexManagement())).webhook).toMatchObject({ revealed: false })
    expect((await svc.getWebsite(apexManagement())).webhook.url).not.toContain(websiteToken('co_apex'))
    expect((await svc.getWebsite(apexAdmin())).webhook.url).toContain(websiteToken('co_apex'))
  })
})

describe('WhatsApp templates and sends', () => {
  it('counts and checks {{n}} parameters and fills them', () => {
    expect(wa.templateParams('Hi {{1}}, see {{2}} and {{1}}')).toBe(2)
    expect(wa.paramsProblem('Hi {{1}} {{3}}')).toContain('({{2}} is missing)')
    expect(wa.paramsProblem('Hi {{name}}')).toMatch(/numbered/)
    expect(wa.fillTemplate('Hi {{1}}, about {{2}}', ['Sara', 'the quote'])).toBe('Hi Sara, about the quote')
  })

  it('a new template is pending, then decided by the simulated review', async () => {
    await wa.createTemplate(apexAdmin(), { name: 'Visit_Confirm', language: 'en', category: 'utility', body: 'Hi {{1}}, see you on {{2}}.' })
    await wa.createTemplate(apexAdmin(), { name: 'promo_now', language: 'en', category: 'marketing', body: 'Deal!!! http://bit.ly/x' })
    const pending = waTemplates.filter((t) => t.companyId === 'co_apex' && t.status === 'pending')
    expect(pending.map((t) => t.name).sort()).toEqual(['promo_now', 'visit_confirm'])
    expect(wa.runTemplateReviews('co_apex', nowMs() + wa.REVIEW_MS + 1)).toBe(2)
    expect(waTemplates.find((t) => t.name === 'visit_confirm')!.status).toBe('approved')
    expect(waTemplates.find((t) => t.name === 'promo_now')!.status).toBe('rejected')
    await fails(wa.createTemplate(apexAdmin(), { name: 'visit_confirm', language: 'en', category: 'utility', body: 'x' }), 409, 'duplicate_template')
    await fails(wa.createTemplate(crestAdmin(), { name: 'x_y', language: 'en', category: 'utility', body: 'x' }), 409, 'not_connected')
  })

  it('sends an approved template to a lead and logs a whatsapp activity; Do Not Contact and missing params are refused', async () => {
    const lead = leads.find((l) => l.companyId === 'co_apex' && l.ownerId === 'u4' && !l.doNotContact && l.mobile && !['Won', 'Lost'].includes(l.status))!
    await fails(wa.sendTemplate(apexAgent(), { leadId: lead.id, templateId: 'WAT-101', to: lead.mobile, params: ['Sara'] }), 422, 'params_required')
    await fails(wa.sendTemplate(apexAgent(), { leadId: lead.id, templateId: 'WAT-104', to: lead.mobile, params: [] }), 422, 'invalid_template')
    const r = await wa.sendTemplate(apexAgent(), { leadId: lead.id, templateId: 'WAT-101', to: lead.mobile, params: ['Sara', 'Monday 10:00'] })
    expect(r.text).toBe('Hi Sara, a reminder of our meeting on Monday 10:00. Reply YES to confirm or call us to reschedule.')
    const act = activities.find((a) => a.id === r.activityId)!
    expect(act).toMatchObject({ leadId: lead.id, type: 'whatsapp', userId: 'u4' })
    lead.doNotContact = true
    await fails(wa.sendTemplate(apexAgent(), { leadId: lead.id, templateId: 'WAT-101', to: lead.mobile, params: ['a', 'b'] }), 422)
    // Another company's lead answers like a missing one; Crest has no connected number.
    const crestLead = leads.find((l) => l.companyId === 'co_crest')!
    await fails(wa.sendTemplate(apexAgent(), { leadId: crestLead.id, templateId: 'WAT-101', to: '0501234567', params: ['a', 'b'] }), 404)
    await fails(wa.sendOptions(u('u9')), 403)
  })

  it('an inbound message from an unknown number becomes a lead on request', async () => {
    const conv = await wa.simulateInbound(apexAdmin(), { from: '0559990001', text: 'Hello, pricing?' })
    expect(conv.leadId).toBeNull()
    const done = await wa.createLeadFromConversation(apexAgent(), conv.id, { company: 'Clinic Co' })
    expect(done.leadId).toBeTruthy()
    expect(leads.find((l) => l.id === done.leadId)).toMatchObject({ companyId: 'co_apex', company: 'Clinic Co', mobile: '+971559990001' })
    await fails(wa.createLeadFromConversation(apexAgent(), conv.id, {}), 409, 'already_linked')
  })
})

describe('outgoing webhooks', () => {
  it('a new lead produces one signed lead.created delivery (idempotent pump)', async () => {
    const hook = await dev.createWebhook(crestAdmin(), { url: 'https://hooks.example.org/crest', events: ['lead.created'], secret: 'whsec_crest_secret_123456' })
    insertLead(crestAdmin(), { company: 'Webhook Event Co', sourceType: 'Website', industry: 'Logistics', contacts: [{ name: 'Ev', title: '', mobile: '', email: 'ev@example.sa', isDecisionMaker: false }], nextFollowUpDate: null })
    expect(dev.pumpWebhookEvents('co_crest')).toBe(1)
    expect(dev.pumpWebhookEvents('co_crest')).toBe(0)
    const d = webhookDeliveries.filter((x) => x.endpointId === hook.id)
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ event: 'lead.created', status: 'success', attempts: 1, responseCode: 200, companyId: 'co_crest' })
    expect(d[0].signature).toMatch(/^t=\d+,v1=[0-9a-f]{16}$/)
    expect((d[0].payload.data as { company: string }).company).toBe('Webhook Event Co')
    // Apex's endpoint got nothing from a Crest lead.
    expect(webhookDeliveries.filter((x) => x.companyId === 'co_apex' && x.eventKey.includes('Webhook'))).toHaveLength(0)
  })

  it('a failing receiver is retried with backoff, then marked failed (sync-log error), and a manual retry can succeed', async () => {
    const hook = await dev.createWebhook(apexAdmin(), { url: 'https://fail.example.org/hook', events: ['lead.created'], secret: 'whsec_apex_secret_1234567' })
    insertLead(apexAdmin(), { company: 'Retry Co', sourceType: 'Website', industry: leads.find((l) => l.companyId === 'co_apex')!.industry, contacts: [{ name: 'R', title: '', mobile: '', email: 'r@retry.example', isDecisionMaker: false }], nextFollowUpDate: null })
    dev.pumpWebhookEvents('co_apex')
    const d = webhookDeliveries.find((x) => x.endpointId === hook.id)!
    expect(d).toMatchObject({ status: 'retrying', attempts: 1, responseCode: 500 })
    expect(dev.retryDue('co_apex', nowMs())).toBe(0)
    expect(dev.retryDue('co_apex', nowMs() + 61_000)).toBe(1)
    expect(d.attempts).toBe(2)
    expect(dev.retryDue('co_apex', nowMs() + 10 * 60_000)).toBe(1)
    expect(d).toMatchObject({ status: 'failed', attempts: 3 })
    expect(syncLog[0]).toMatchObject({ companyId: 'co_apex', integration: 'webhooks', status: 'error' })
    await dev.updateWebhook(apexAdmin(), hook.id, { url: 'https://hooks.example.org/fixed' })
    const r = await dev.retryDelivery(apexAdmin(), d.id)
    expect(r).toMatchObject({ status: 'success', attempts: 4 })
  })

  it('validates URL (https, no private hosts) and events; the signing secret is write-only', async () => {
    await fails(dev.createWebhook(apexAdmin(), { url: 'http://example.org', events: ['lead.created'], secret: 'x'.repeat(20) }), 422, 'invalid_url')
    await fails(dev.createWebhook(apexAdmin(), { url: 'https://192.168.1.4/x', events: ['lead.created'], secret: 'x'.repeat(20) }), 422, 'invalid_url')
    await fails(dev.createWebhook(apexAdmin(), { url: 'https://example.org', events: ['lead.deleted'], secret: 'x'.repeat(20) }), 422, 'invalid_event')
    await fails(dev.createWebhook(apexAdmin(), { url: 'https://example.org', events: ['lead.created'] }), 422, 'secret_required')
    const w = await dev.createWebhook(apexAdmin(), { url: 'https://example.org/x', events: ['deal.won'], secret: 'whsec_visible_never_1234' })
    expect(JSON.stringify(w)).not.toContain('whsec_visible_never_1234')
    expect(w.secretHint).toBe('•••• 1234')
  })
})

describe('API keys', () => {
  it('the key is answered once, stored as a hash; scopes allow / refuse; revoking answers 401', async () => {
    const created = await dev.createApiKey(crestAdmin(), { name: 'ERP sync', scopes: { leads: 'read' } })
    expect(created.secret).toMatch(/^apx_live_[A-Za-z0-9]{32}$/)
    const rec = apiKeys.find((k) => k.id === created.key.id)!
    expect(JSON.stringify(rec)).not.toContain(created.secret)
    expect(created.key.masked).toContain(created.secret.slice(-4))
    expect(JSON.stringify(await dev.listApiKeys(crestAdmin()))).not.toContain(created.secret)
    const list = await dev.publicListLeads(created.secret)
    expect(list.data.length).toBeGreaterThan(0)
    expect(list.data.every((l) => leads.find((x) => x.id === l.id)?.companyId === 'co_crest')).toBe(true)
    expect(apiKeys.find((k) => k.id === created.key.id)!.lastUsedAt).not.toBeNull()
    await fails(dev.publicCreateLead(created.secret, { company: 'Nope' }), 403, 'insufficient_scope')
    const tasksOnly = await dev.createApiKey(crestAdmin(), { name: 'Tasks', scopes: { tasks: 'write' } })
    await fails(dev.publicListLeads(tasksOnly.secret), 403, 'insufficient_scope')
    const writer = await dev.createApiKey(crestAdmin(), { name: 'Writer', scopes: { leads: 'write' } })
    const made = await dev.publicCreateLead(writer.secret, { company: 'API Lead Co', contactName: 'Api', email: 'api@example.sa' })
    expect(leads.find((l) => l.id === made.id)?.companyId).toBe('co_crest')
    await dev.revokeApiKey(crestAdmin(), created.key.id)
    await fails(dev.publicListLeads(created.secret), 401, 'invalid_api_key')
    await fails(dev.publicListLeads('apx_live_unknownunknownunknownunknown00'), 401, 'invalid_api_key')
    await fails(dev.createApiKey(crestAdmin(), { name: 'Empty', scopes: { leads: 'none' } }), 422, 'scopes_required')
    await fails(dev.revokeApiKey(apexAdmin(), writer.key.id), 404)
  })
})

describe('sync-log failures notify Company Admins once per integration and day', () => {
  it('two failures → one stored notification per admin; another integration → another one', () => {
    const before = notifications.filter((n) => n.companyId === 'co_apex' && n.type === 'integrations').length
    addSync('co_apex', 'payments', 'outbound', 'error', 'Gateway timeout (1)')
    addSync('co_apex', 'payments', 'outbound', 'error', 'Gateway timeout (2)')
    const admins = users.filter((x) => x.companyId === 'co_apex' && x.role === 'Company Admin' && x.active !== false).length
    const after = notifications.filter((n) => n.companyId === 'co_apex' && n.type === 'integrations')
    expect(after.length - before).toBe(admins)
    expect(after[0]).toMatchObject({ link: '/integrations?tab=sync-log', title: 'Payments: a sync failed' })
    addSync('co_apex', 'email', 'outbound', 'error', 'SMTP down')
    expect(notifications.filter((n) => n.companyId === 'co_apex' && n.type === 'integrations').length - before).toBe(2 * admins)
    // Success / warning never notify; Crest is untouched.
    addSync('co_apex', 'payments', 'outbound', 'warning', 'slow')
    expect(notifications.filter((n) => n.companyId === 'co_crest' && n.type === 'integrations')).toHaveLength(0)
  })
})
