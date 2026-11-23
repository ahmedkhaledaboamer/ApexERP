import type { User } from '@/shared/types'
import type { ApiKey, ApiScope, ApiScopeModule, CreatedApiKey, WebhookDelivery, WebhookEndpoint, WebhookEvent } from '@/modules/integrations/types'
import { API_SCOPE_MODULES, WEBHOOK_EVENTS } from '@/modules/integrations/types'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { leads, users } from '@/shared/mocks/db'
import { isWonFlowStatus, lookupsFor } from '@/shared/mocks/data/lookups'
import { leadStatusHistory } from '@/shared/mocks/data/leadStatusHistory'
import { financeInvoices } from '@/shared/mocks/data/finance'
import { finPayments } from '@/shared/mocks/data/financeCollections'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { registerArray } from '@/shared/mocks/persist/registry'
import {
  apiKeys,
  hintOf,
  integrationSecrets,
  keyHash,
  nextIntegrationId,
  noScopes,
  pausedKeys,
  randomToken,
  secretKey,
  webhookDeliveries,
  webhookEndpoints,
  type ApiKeyRecord,
  type WebhookDeliveryRecord,
  type WebhookEndpointRecord,
} from '@/shared/mocks/data/integrations'
import { CodedApiError, type Tenant } from '@/shared/mocks/tenant'
import { hitRateLimit, type RateHit } from './rateLimit'
import { assertCapacity, isReadOnly, noteUsage, onLifecycleTick } from './billing'
import { insertLead } from './leads'
import { addSync, bad, conflict, editCtx, hasModule, isObj, notFound, str, viewCtx, EMAIL_RE } from './integrationsCore'
import { runTemplateReviews } from './integrationsWhatsApp'

/**
 * Integrations › Developer: company API keys (shown once, stored as a hash, scoped read / write per module, revocable)
 * and outgoing webhooks (signed deliveries with retries).
 *
 * EVENT SOURCE (least invasive, no edits to the producing services): an outbox-style pump scans the company's own
 * records created after each endpoint's `eventsFrom` — leads (lead.created), lead_status_history (lead.status_changed,
 * deal.won), issued invoices (invoice.issued), payments (payment.received), employees (employee.created) — and creates
 * one delivery per endpoint and `<event>:<record id>` (idempotent). It runs on the company's lifecycle tick (every
 * authenticated request of that company, services/billing.ts `onLifecycleTick`), so an event shows up on the next
 * request. A real backend emits the events from a transactional outbox / queue instead (docs/API.md › Integrations).
 */

/* ======================================================================================
 * API keys
 * ==================================================================================== */

const SCOPES: ApiScope[] = ['none', 'read', 'write']
const isModule = (k: string): k is ApiScopeModule => API_SCOPE_MODULES.some((m) => m.key === k)

const keyView = (k: ApiKeyRecord): ApiKey => ({
  id: k.id,
  name: k.name,
  masked: `${k.prefix}…${'•'.repeat(4)}${k.last4}`,
  scopes: { ...k.scopes },
  createdAt: k.createdAt,
  createdBy: k.createdBy,
  lastUsedAt: k.lastUsedAt,
  revokedAt: k.revokedAt,
  status: k.revokedAt ? 'revoked' : 'active',
})

export async function listApiKeys(user: User): Promise<ApiKey[]> {
  const co = viewCtx(user)
  return apiKeys.filter((k) => k.companyId === co).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(keyView)
}

/** POST /integrations/api-keys { name, scopes } — the key is answered ONCE (`secret`); only its hash is kept. */
export async function createApiKey(user: User, input: unknown): Promise<CreatedApiKey> {
  const co = editCtx(user)
  const b = isObj(input) ? input : {}
  const name = str(b.name, 80)
  if (!name) bad('Give the key a name, e.g. the system that uses it.')
  const scopes = noScopes()
  if (!isObj(b.scopes)) bad('Pick at least one scope.', 'scopes_required')
  for (const [k, v] of Object.entries(b.scopes as Record<string, unknown>)) {
    if (!isModule(k)) bad(`Unknown scope module “${k}”.`, 'invalid_scope')
    if (!SCOPES.includes(v as ApiScope)) bad(`${k} is none, read or write.`, 'invalid_scope')
    scopes[k as ApiScopeModule] = v as ApiScope
  }
  if (Object.values(scopes).every((s) => s === 'none')) bad('Pick at least one scope.', 'scopes_required')
  if (apiKeys.filter((k) => k.companyId === co && !k.revokedAt).length >= 20) conflict('A company can have at most 20 active API keys.', 'too_many_keys')
  const secret = `apx_live_${randomToken(32)}`
  const rec: Tenant<ApiKeyRecord> = { companyId: co, id: nextIntegrationId('AK'), name, prefix: secret.slice(0, 13), last4: secret.slice(-4), hash: keyHash(secret), scopes, createdAt: nowIso(), createdBy: user.name, lastUsedAt: null, revokedAt: null, revokedBy: null }
  apiKeys.push(rec)
  recordAudit(user, { action: 'security', entity: 'integration', entityId: rec.id, summary: `Created the API key “${name}” (${Object.entries(scopes).filter(([, s]) => s !== 'none').map(([m, s]) => `${m}:${s}`).join(', ')})` })
  addSync(co, 'api', 'internal', 'success', `API key “${name}” created by ${user.name}.`)
  return { key: keyView(rec), secret }
}

export async function revokeApiKey(user: User, id: string): Promise<ApiKey> {
  const co = editCtx(user)
  const k = apiKeys.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (k.revokedAt) conflict('This key is already revoked.', 'already_revoked')
  k.revokedAt = nowIso()
  k.revokedBy = user.name
  recordAudit(user, { action: 'security', entity: 'integration', entityId: k.id, summary: `Revoked the API key “${k.name}”` })
  addSync(co, 'api', 'internal', 'success', `API key “${k.name}” revoked by ${user.name}.`)
  return keyView(k)
}

export const apiHits = registerArray<RateHit>('integrations.apiHits', [])
const INVALID_KEY = 'Invalid or revoked API key.'

/** Scope rule: write implies read. */
export function scopeAllows(scope: ApiScope, action: 'read' | 'write'): boolean {
  return scope === 'write' || (scope === 'read' && action === 'read')
}

/**
 * Authenticates an `X-Api-Key` (public API, no session): unknown / revoked keys, a company without the module or a
 * deleted / suspended workspace → the same 401. The company comes from the key only. 120 calls a minute per key.
 */
export function authenticateApiKey(header: string | null, module: ApiScopeModule, action: 'read' | 'write'): Tenant<ApiKeyRecord> {
  const key = (header ?? '').trim()
  const hash = key.startsWith('apx_') ? keyHash(key) : ''
  const rec = hash ? apiKeys.find((k) => k.hash === hash && !k.revokedAt) : undefined
  const sub = rec ? subscriptionOf(rec.companyId) : undefined
  if (!rec || !sub || sub.status === 'deleted' || companyById(rec.companyId)?.status === 'suspended' || !hasModule(rec.companyId, 'integrations')) {
    throw new CodedApiError(INVALID_KEY, 401, 'invalid_api_key')
  }
  hitRateLimit(apiHits, [`key:${rec.id}`], { limit: 120, windowMs: 60_000, what: 'API' })
  if (!scopeAllows(rec.scopes[module], action)) throw new CodedApiError(`This key has no ${module}:${action} scope.`, 403, 'insufficient_scope')
  if (action === 'write' && isReadOnly(sub.status)) throw new CodedApiError('This workspace is read-only.', 423, 'workspace_read_only')
  rec.lastUsedAt = nowIso()
  return rec
}

/** GET /public/v1/leads (X-Api-Key, leads:read) — the key's company's leads, newest first (max 100). */
export async function publicListLeads(header: string | null): Promise<{ data: { id: string; company: string; contactName: string; status: string; ownerId: string; createdAt: string }[] }> {
  const k = authenticateApiKey(header, 'leads', 'read')
  return {
    data: leads
      .filter((l) => l.companyId === k.companyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100)
      .map((l) => ({ id: l.id, company: l.company, contactName: l.contactName, status: l.status, ownerId: l.ownerId, createdAt: l.createdAt })),
  }
}

/** POST /public/v1/leads (X-Api-Key, leads:write) { company, contact_name, email, mobile } — a New lead, auto-assigned. */
export async function publicCreateLead(header: string | null, input: unknown): Promise<{ id: string; status: string }> {
  const k = authenticateApiKey(header, 'leads', 'write')
  const co = k.companyId
  const b = isObj(input) ? input : {}
  const company = str(b.company, 255)
  const contactName = str(b.contactName, 255)
  const email = str(b.email, 190).toLowerCase()
  if (!company && !contactName) bad('company or contact_name is required.')
  if (email && !EMAIL_RE.test(email)) bad(`${email} isn’t a valid email address.`)
  const lk = lookupsFor(co)
  const owner = users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Sales Agent').sort((a, b) => a.id.localeCompare(b.id))[0] ?? users.find((u) => u.companyId === co && u.role === 'Company Admin')!
  assertCapacity(co, 'leadsContacts', 2)
  const lead = insertLead(owner, {
    company: company || contactName,
    sourceType: lk.sources.find((s) => s.active && s.key === 'Website')?.key ?? lk.sources.find((s) => s.active)!.key,
    sourceDetail: `API key “${k.name}”`,
    industry: (lk.industries.find((i) => i.active && /other/i.test(i.key)) ?? lk.industries.find((i) => i.active)!).key,
    contacts: [{ name: contactName || company, title: '', mobile: str(b.mobile, 40), email, isDecisionMaker: false }],
    ownerId: owner.id,
    nextFollowUpDate: null,
  })
  noteUsage(co)
  addSync(co, 'api', 'inbound', 'success', `API key “${k.name}” created lead ${lead.id}.`)
  return { id: lead.id, status: lead.status }
}

/* ======================================================================================
 * Outgoing webhooks
 * ==================================================================================== */

const EVENT_KEYS = WEBHOOK_EVENTS.map((e) => e.key)
const MAX_ATTEMPTS = 3

/** HTTPS only; no localhost / private ranges (the backend must also re-check the resolved IP: SSRF). */
function cleanUrl(v: unknown): string {
  const raw = str(v, 500)
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return bad('Enter the full https:// URL of your endpoint.', 'invalid_url')
  }
  if (u.protocol !== 'https:') bad('Webhook URLs must use https://.', 'invalid_url')
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(u.hostname) || u.hostname.endsWith('.local')) bad('Private and local addresses aren’t allowed.', 'invalid_url')
  return u.toString()
}

function cleanEvents(v: unknown): WebhookEvent[] {
  if (!Array.isArray(v) || !v.length) bad('Pick at least one event.', 'events_required')
  const out = [...new Set(v as unknown[])]
  for (const e of out) if (!(EVENT_KEYS as unknown[]).includes(e)) bad(`Unknown event “${String(e)}”.`, 'invalid_event')
  return out as WebhookEvent[]
}

const endpointView = (w: Tenant<WebhookEndpointRecord>): WebhookEndpoint => {
  const ds = webhookDeliveries.filter((d) => d.companyId === w.companyId && d.endpointId === w.id)
  return {
    id: w.id,
    url: w.url,
    events: [...w.events],
    active: w.active,
    secretHint: w.secretHint,
    createdAt: w.createdAt,
    createdBy: w.createdBy,
    lastDeliveryAt: ds.map((d) => d.lastAttemptAt ?? d.createdAt).sort().pop() ?? null,
    failing: ds.filter((d) => d.status === 'failed').length,
  }
}

export async function listWebhooks(user: User): Promise<WebhookEndpoint[]> {
  const co = viewCtx(user)
  pumpWebhookEvents(co)
  return webhookEndpoints.filter((w) => w.companyId === co).map(endpointView)
}

const ownHook = (co: string, id: string) => webhookEndpoints.find((w) => w.companyId === co && w.id === id) ?? notFound()

function cleanSecret(v: unknown, required: boolean): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return required ? bad('Enter a signing secret (at least 16 characters) or generate one.', 'secret_required') : null
  if (s.length < 16 || s.length > 200) bad('The signing secret is 16 to 200 characters.', 'invalid_secret')
  return s
}

/** POST /integrations/webhooks { url, events, secret } — the signing secret is write-only. */
export async function createWebhook(user: User, input: unknown): Promise<WebhookEndpoint> {
  const co = editCtx(user)
  const b = isObj(input) ? input : {}
  const url = cleanUrl(b.url)
  const events = cleanEvents(b.events)
  const secret = cleanSecret(b.secret, true)!
  if (webhookEndpoints.filter((w) => w.companyId === co).length >= 10) conflict('A company can have at most 10 webhook endpoints.', 'too_many_webhooks')
  const w: Tenant<WebhookEndpointRecord> = { companyId: co, id: nextIntegrationId('WH'), url, events, active: true, secretHint: hintOf(secret), createdAt: nowIso(), createdBy: user.name, eventsFrom: new Date().toISOString() }
  integrationSecrets.set(secretKey(co, 'webhook', w.id), secret)
  webhookEndpoints.push(w)
  recordAudit(user, { action: 'create', entity: 'integration', entityId: w.id, summary: `Added the webhook endpoint ${url} (${events.join(', ')})` })
  addSync(co, 'webhooks', 'internal', 'success', `Webhook endpoint ${url} added by ${user.name}.`)
  return endpointView(w)
}

export async function updateWebhook(user: User, id: string, input: unknown): Promise<WebhookEndpoint> {
  const co = editCtx(user)
  const w = ownHook(co, id)
  const b = isObj(input) ? input : {}
  if (b.url !== undefined) w.url = cleanUrl(b.url)
  if (b.events !== undefined) w.events = cleanEvents(b.events)
  if (b.active !== undefined) {
    if (typeof b.active !== 'boolean') bad('active is true or false.')
    // Re-activating starts from now: no backlog of the time it was off.
    if (b.active && !w.active) w.eventsFrom = new Date().toISOString()
    w.active = b.active
  }
  const secret = cleanSecret(b.secret, false)
  if (secret) {
    integrationSecrets.set(secretKey(co, 'webhook', w.id), secret)
    w.secretHint = hintOf(secret)
  }
  recordAudit(user, { action: 'update', entity: 'integration', entityId: w.id, summary: `Changed the webhook endpoint ${w.url}${secret ? ' (new signing secret)' : ''}` })
  return endpointView(w)
}

export async function deleteWebhook(user: User, id: string): Promise<{ deleted: true }> {
  const co = editCtx(user)
  const w = ownHook(co, id)
  webhookEndpoints.splice(webhookEndpoints.indexOf(w), 1)
  integrationSecrets.delete(secretKey(co, 'webhook', w.id))
  for (let i = webhookDeliveries.length - 1; i >= 0; i--) if (webhookDeliveries[i].companyId === co && webhookDeliveries[i].endpointId === w.id) webhookDeliveries.splice(i, 1)
  recordAudit(user, { action: 'delete', entity: 'integration', entityId: w.id, summary: `Removed the webhook endpoint ${w.url}` })
  return { deleted: true }
}

const deliveryView = (d: WebhookDeliveryRecord): WebhookDelivery => ({
  id: d.id,
  endpointId: d.endpointId,
  event: d.event,
  status: d.status,
  attempts: d.attempts,
  responseCode: d.responseCode,
  error: d.error,
  signature: d.signature,
  payload: structuredClone(d.payload),
  createdAt: d.createdAt,
  lastAttemptAt: d.lastAttemptAt,
  nextRetryAt: d.nextRetryAt ? new Date(d.nextRetryAt).toISOString() : null,
})

export async function listDeliveries(user: User, id: string): Promise<WebhookDelivery[]> {
  const co = viewCtx(user)
  ownHook(co, id)
  pumpWebhookEvents(co)
  return webhookDeliveries
    .filter((d) => d.companyId === co && d.endpointId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200)
    .map(deliveryView)
}

/** The simulated receiver: hosts / paths containing "fail" or a `.invalid` host answer HTTP 500. */
const receiverFails = (url: string) => {
  const u = new URL(url)
  return /fail/i.test(u.hostname + u.pathname) || u.hostname.endsWith('.invalid')
}

function sign(co: string, endpointId: string, payload: Record<string, unknown>): string {
  const t = Math.floor(nowMs() / 1000)
  const secret = integrationSecrets.get(secretKey(co, 'webhook', endpointId)) ?? ''
  return `t=${t},v1=${keyHash(`${secret}.${t}.${JSON.stringify(payload)}`)}`
}

/** One attempt: success, or retrying with backoff (1, 2 min…), `failed` after MAX_ATTEMPTS (sync-log error → notification). */
function attempt(w: Tenant<WebhookEndpointRecord>, d: Tenant<WebhookDeliveryRecord>, manual = false): void {
  const at = nowIso()
  d.attempts += 1
  d.lastAttemptAt = at
  d.signature = sign(w.companyId, w.id, d.payload)
  if (!receiverFails(w.url)) {
    Object.assign(d, { status: 'success', responseCode: 200, error: null, nextRetryAt: null })
    if (manual) addSync(w.companyId, 'webhooks', 'outbound', 'success', `Delivery ${d.id} (${d.event}) to ${w.url} succeeded on retry.`, at)
    return
  }
  d.responseCode = 500
  d.error = `HTTP 500 Internal Server Error from the receiver (simulated), attempt ${d.attempts}.`
  if (!manual && d.attempts < MAX_ATTEMPTS) {
    d.status = 'retrying'
    d.nextRetryAt = nowMs() + 60_000 * 2 ** (d.attempts - 1)
    return
  }
  d.status = 'failed'
  d.nextRetryAt = null
  addSync(w.companyId, 'webhooks', 'outbound', 'error', `Delivery ${d.id} (${d.event}) to ${w.url} failed after ${d.attempts} attempt${d.attempts === 1 ? '' : 's'}: HTTP 500.`, at)
}

function enqueue(w: Tenant<WebhookEndpointRecord>, event: WebhookEvent | 'ping', ref: string, data: Record<string, unknown>, at: string): Tenant<WebhookDeliveryRecord> {
  const id = nextIntegrationId('WD')
  const payload = { id, event, created_at: at, company: companyById(w.companyId)?.subdomain ?? '', data }
  const d: Tenant<WebhookDeliveryRecord> = { companyId: w.companyId, id, endpointId: w.id, event, eventKey: `${event}:${ref}`, payload, signature: '', status: 'retrying', attempts: 0, responseCode: null, error: null, createdAt: at, lastAttemptAt: null, nextRetryAt: null }
  webhookDeliveries.push(d)
  attempt(w, d)
  return d
}

/** POST /integrations/webhooks/:id/test — a `ping` delivery right away. */
export async function testWebhook(user: User, id: string): Promise<WebhookDelivery> {
  const co = editCtx(user)
  const w = ownHook(co, id)
  const d = enqueue(w, 'ping', `ping-${nextIntegrationId('P')}`, { message: 'Test event from Apex CRM' }, nowIso())
  return deliveryView(d)
}

/** POST /integrations/webhook-deliveries/:id/retry — one more attempt now (failed or retrying deliveries). */
export async function retryDelivery(user: User, id: string): Promise<WebhookDelivery> {
  const co = editCtx(user)
  const d = webhookDeliveries.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (d.status === 'success') conflict('This delivery already succeeded.', 'already_delivered')
  const w = ownHook(co, d.endpointId)
  attempt(w, d, true)
  recordAudit(user, { action: 'update', entity: 'integration', entityId: d.id, summary: `Retried the webhook delivery ${d.id} (${d.status})` })
  return deliveryView(d)
}

/* ---------------- event pump ---------------- */

interface PendingEvent {
  event: WebhookEvent
  ref: string
  at: string
  data: Record<string, unknown>
}

/** Every event of the company's records at or after `from` (real-time ISO). */
export function eventsSince(co: string, from: string): PendingEvent[] {
  const out: PendingEvent[] = []
  for (const l of leads) {
    if (l.companyId === co && l.createdAt >= from) out.push({ event: 'lead.created', ref: l.id, at: l.createdAt, data: { id: l.id, company: l.company, contact_name: l.contactName, status: l.status, source: l.sourceType, owner_id: l.ownerId, value: l.value } })
  }
  for (const h of leadStatusHistory) {
    if (h.companyId !== co || h.changedAt < from || !h.fromStatusId) continue
    const won = isWonFlowStatus(co, h.toStatusId)
    out.push({ event: won ? 'deal.won' : 'lead.status_changed', ref: h.id, at: h.changedAt, data: { lead_id: h.leadId, from: h.fromStatusId, to: h.toStatusId, changed_at: h.changedAt } })
  }
  for (const inv of financeInvoices) {
    if (inv.companyId === co && inv.issuedAt && inv.issuedAt >= from) out.push({ event: 'invoice.issued', ref: inv.id, at: inv.issuedAt, data: { id: inv.id, number: inv.number, customer_id: inv.customerId, total: inv.total, currency: inv.currency, issue_date: inv.issueDate } })
  }
  for (const p of finPayments) {
    if (p.companyId === co && p.createdAt >= from && p.status !== 'void') out.push({ event: 'payment.received', ref: p.id, at: p.createdAt, data: { id: p.id, number: p.number, customer_id: p.customerId, amount: p.amount, currency: p.currency } })
  }
  for (const e of hrEmployees) {
    if (e.companyId === co && e.createdAt >= from) out.push({ event: 'employee.created', ref: e.id, at: e.createdAt, data: { id: e.id, employee_no: e.employeeNo, name: e.fullName, job_title: e.jobTitle, department_id: e.departmentId } })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

/** Creates the missing deliveries of every active endpoint of the company (idempotent). Paused → nothing until resumed. */
export function pumpWebhookEvents(co: string): number {
  if (pausedKeys.has(`${co}|webhooks`)) return 0
  const hooks = webhookEndpoints.filter((w) => w.companyId === co && w.active)
  if (!hooks.length) return 0
  let n = 0
  const from = hooks.map((w) => w.eventsFrom).sort()[0]
  const events = eventsSince(co, from)
  if (!events.length) return 0
  for (const w of hooks) {
    const done = new Set(webhookDeliveries.filter((d) => d.companyId === co && d.endpointId === w.id).map((d) => d.eventKey))
    for (const e of events) {
      if (e.at < w.eventsFrom || !w.events.includes(e.event) || done.has(`${e.event}:${e.ref}`)) continue
      enqueue(w, e.event, e.ref, e.data, e.at)
      n++
    }
  }
  return n
}

/** Automatic retries that are due (mock clock). */
export function retryDue(co: string, until = nowMs()): number {
  if (pausedKeys.has(`${co}|webhooks`)) return 0
  let n = 0
  for (const d of webhookDeliveries) {
    if (d.companyId !== co || d.status !== 'retrying' || d.nextRetryAt === null || d.nextRetryAt > until) continue
    const w = webhookEndpoints.find((x) => x.companyId === co && x.id === d.endpointId)
    if (!w || !w.active) continue
    attempt(w, d)
    n++
  }
  return n
}

/** The integrations tick: template reviews, the webhook pump and due retries — only for companies with the module. */
export function runIntegrationsTick(co: string, until = nowMs()): void {
  if (!hasModule(co, 'integrations')) return
  runTemplateReviews(co, until)
  pumpWebhookEvents(co)
  retryDue(co, until)
}
onLifecycleTick('integrations', (co, until) => runIntegrationsTick(co, until))
