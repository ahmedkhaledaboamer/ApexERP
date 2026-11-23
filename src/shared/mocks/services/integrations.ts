import type { User } from '@/shared/types'
import type {
  BusyBlock,
  CalendarConnectionRow,
  DnsRecord,
  EmailIntegration,
  EmailLogRow,
  EmailLogSource,
  Gateway,
  GatewayProvider,
  IntegrationCard,
  IntegrationKey,
  IntegrationStatus,
  IntegrationsOverview,
  InboundWebhook,
  LeadField,
  MappingPreview,
  MyCalendar,
  PaymentsIntegration,
  Sender,
  SenderPurpose,
  SyncLogRow,
  WebsiteIntegration,
} from '@/modules/integrations/types'
import { GATEWAY_LABEL, GATEWAY_PROVIDERS, LEAD_FIELDS, PAUSABLE } from '@/modules/integrations/types'
import { normalizeMobile } from '@/shared/lib/phone'
import { recordAudit } from '@/shared/mocks/data/audit'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { emailConnections } from '@/shared/mocks/data/onboarding'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { adConnections } from '@/shared/mocks/data/ads'
import { formSubmissions, leadForms } from '@/shared/mocks/data/marketingGrowth'
import { bulkEmailRecipients, bulkEmails } from '@/shared/mocks/data/marketing'
import { financeInvoices } from '@/shared/mocks/data/finance'
import { finDunningLog } from '@/shared/mocks/data/financeCollections'
import { auditLog } from '@/shared/mocks/data/audit'
import { tasks } from '@/shared/mocks/data/tasks'
import {
  apiKeys,
  calendarConnections,
  emailConfigs,
  emailTestLog,
  hintOf,
  integrationSecrets,
  nextIntegrationId,
  pausedKeys,
  paymentConfigs,
  randomToken,
  secretKey,
  syncLog,
  waTemplates,
  webhookDeliveries,
  webhookEndpoints,
  websiteHooks,
  whatsappConfigs,
  type EmailConfigRecord,
  type GatewayRecord,
} from '@/shared/mocks/data/integrations'
import { CodedApiError, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { hitRateLimit, type RateHit } from './rateLimit'
import { assertCapacity, isReadOnly, LimitReachedError, noteUsage, runLifecycle } from './billing'
import { countryOf, insertLead } from './leads'
import { runFinanceHooks } from './ledger'
import { registerPaymentGateway } from './financeCollections'
import { registerArray } from '@/shared/mocks/persist/registry'
import {
  addSync,
  bad,
  canEditIntegrations,
  companyDomain,
  conflict,
  consumeOAuth,
  editCtx,
  EMAIL_RE,
  hasModule,
  isObj,
  notFound,
  str,
  viewCtx,
} from './integrationsCore'

/**
 * Insights & admin › Integrations: hub, email sending, website & forms (inbound webhook), payments, calendar sync and
 * the sync log (docs/API.md › Integrations). WhatsApp: services/integrationsWhatsApp.ts; API keys and outgoing
 * webhooks: services/integrationsDeveloper.ts; shared rules: services/integrationsCore.ts.
 */

const who = (user: User) => user.name

/* ======================================================================================
 * Hub
 * ==================================================================================== */

const latest = (...ats: (string | null | undefined)[]) => ats.filter((a): a is string => !!a).sort().pop() ?? null

function lastSyncOf(co: string, key: IntegrationKey): string | null {
  return syncLog.find((r) => r.companyId === co && r.integration === key)?.at ?? null
}

export function emailStatus(c: EmailConfigRecord): IntegrationStatus {
  if (!c.provider) return 'not_connected'
  if (c.paused) return 'paused'
  return c.lastTestStatus === 'error' ? 'error' : 'connected'
}

/** GET /integrations — one card per connector (settings view). */
export async function getOverview(user: User): Promise<IntegrationsOverview> {
  const co = viewCtx(user)
  const email = emailConfigs.get(co)
  const site = websiteHooks.get(co)
  const wa = whatsappConfigs.get(co)
  const pay = paymentConfigs.get(co)
  const tpl = waTemplates.filter((t) => t.companyId === co)
  const cals = calendarConnections.filter((c) => c.companyId === co)
  const ads = adConnections.filter((c) => c.companyId === co && c.status !== 'disconnected')
  const keys = apiKeys.filter((k) => k.companyId === co && !k.revokedAt)
  const hooks = webhookEndpoints.filter((w) => w.companyId === co)
  const failing = webhookDeliveries.filter((d) => d.companyId === co && d.status === 'failed').length
  const gateways = GATEWAY_PROVIDERS.filter((p) => pay.gateways[p])
  const card = (key: IntegrationKey, group: IntegrationCard['group'], name: string, status: IntegrationStatus, summary: string, problem: string | null = null, last: string | null = lastSyncOf(co, key)): IntegrationCard => ({ key, group, name, status, summary, problem, lastSyncAt: last })
  const cards: IntegrationCard[] = [
    card('email', 'communication', 'Email sending', emailStatus(email), email.provider ? `Connected as ${email.connectedAs}` : 'Send from your own domain (SMTP, Google Workspace or Microsoft 365).', email.lastTestStatus === 'error' ? email.lastError : null),
    card('whatsapp', 'communication', 'WhatsApp Business', wa.connected ? (wa.paused ? 'paused' : wa.lastError ? 'error' : 'connected') : 'not_connected', wa.connected ? `${wa.displayNumber} · ${tpl.filter((t) => t.status === 'approved').length} approved templates` : 'Cloud API number, message templates and inbound chats.', wa.lastError),
    card('website', 'website', 'Website & forms', site.paused ? 'paused' : 'connected', `${site.received} webhook submission${site.received === 1 ? '' : 's'} · ${leadForms.filter((f) => f.companyId === co).length} lead forms`, null, latest(site.lastReceivedAt, lastSyncOf(co, 'website'))),
    card('calendar', 'calendar', 'Calendar sync', cals.length ? 'connected' : 'not_connected', `${cals.length} user${cals.length === 1 ? '' : 's'} connected (Google / Outlook)`),
    card('payments', 'payments', 'Payment gateways', gateways.length ? 'connected' : 'not_connected', pay.defaultProvider ? `${GATEWAY_LABEL[pay.defaultProvider]} is used for payment links (${pay.gateways[pay.defaultProvider]?.mode} mode)` : 'Telr, Tap, PayTabs or Stripe for invoice payment links.'),
    card('ads', 'advertising', 'Ad platforms', ads.length ? (ads.some((a) => a.status === 'error') ? 'error' : 'connected') : 'not_connected', `${ads.length} ad account${ads.length === 1 ? '' : 's'} connected in Marketing › Ads Integrations`, null, latest(...ads.map((a) => a.lastSyncAt))),
    card('api', 'developer', 'API keys', keys.length ? 'connected' : 'not_connected', `${keys.length} active key${keys.length === 1 ? '' : 's'}`, null, latest(...keys.map((k) => k.lastUsedAt))),
    card('webhooks', 'developer', 'Outgoing webhooks', !hooks.length ? 'not_connected' : pausedKeys.has(`${co}|webhooks`) ? 'paused' : failing ? 'error' : 'connected', `${hooks.length} endpoint${hooks.length === 1 ? '' : 's'}`, failing ? `${failing} failed deliver${failing === 1 ? 'y' : 'ies'}` : null),
  ]
  const weekAgo = new Date(nowMs() - 7 * 86_400_000).toISOString()
  return { cards, canEdit: canEditIntegrations(user), recentErrors: syncLog.filter((r) => r.companyId === co && r.status === 'error' && r.at >= weekAgo).length }
}

/** PATCH /integrations/state/:key { paused } — pause / resume a connected integration (email, website, whatsapp, webhooks). */
export async function setPaused(user: User, key: string, input: unknown): Promise<IntegrationsOverview> {
  const co = editCtx(user)
  if (!(PAUSABLE as string[]).includes(key)) bad('This integration can’t be paused.', 'not_pausable')
  const paused = isObj(input) && typeof input.paused === 'boolean' ? input.paused : bad('paused is true or false.')
  if (key === 'email') {
    const c = emailConfigs.get(co)
    if (!c.provider) conflict('Connect email sending first.', 'not_connected')
    c.paused = paused
  } else if (key === 'whatsapp') {
    const c = whatsappConfigs.get(co)
    if (!c.connected) conflict('Connect WhatsApp first.', 'not_connected')
    c.paused = paused
  } else if (key === 'website') {
    websiteHooks.get(co).paused = paused
  } else {
    if (!webhookEndpoints.some((w) => w.companyId === co)) conflict('Add a webhook endpoint first.', 'not_connected')
    if (paused) pausedKeys.add(`${co}|webhooks`)
    else pausedKeys.delete(`${co}|webhooks`)
  }
  recordAudit(user, { action: 'update', entity: 'integration', entityId: key, summary: `${paused ? 'Paused' : 'Resumed'} the ${key} integration` })
  addSync(co, key as IntegrationKey, 'internal', 'success', `${paused ? 'Paused' : 'Resumed'} by ${who(user)}.`)
  return getOverview(user)
}

/* ======================================================================================
 * Email sending
 * ==================================================================================== */

function dnsFor(domain: string): DnsRecord[] {
  return [
    { kind: 'spf', type: 'TXT', host: domain, value: 'v=spf1 include:_spf.apexcrm.app ~all', status: 'pending', checkedAt: null, message: null },
    { kind: 'dkim', type: 'CNAME', host: `apexcrm._domainkey.${domain}`, value: 'dkim.apexcrm.app', status: 'pending', checkedAt: null, message: null },
    { kind: 'dmarc', type: 'TXT', host: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, status: 'pending', checkedAt: null, message: null },
  ]
}

function emailView(co: string): EmailIntegration {
  const c = emailConfigs.get(co)
  // A mailbox connected through the onboarding checklist (POST /settings/email-connection) shows up here too.
  const onboarding = emailConnections.get(co)
  if (!c.provider && onboarding) {
    c.provider = onboarding.provider
    c.connectedAs = onboarding.address
    c.connectedAt = onboarding.connectedAt
    c.connectedBy = onboarding.connectedBy
    c.fromAddress ||= onboarding.address
  }
  if (!c.domain) c.domain = companyDomain(co)
  if (!c.dns.length) c.dns = dnsFor(c.domain)
  return {
    status: emailStatus(c),
    provider: c.provider,
    connectedAs: c.connectedAs,
    smtp: c.smtp ? { ...c.smtp } : null,
    passwordHint: c.passwordHint,
    tokenHint: c.tokenHint,
    fromName: c.fromName,
    fromAddress: c.fromAddress,
    connectedAt: c.connectedAt,
    connectedBy: c.connectedBy,
    lastTestAt: c.lastTestAt,
    lastTestStatus: c.lastTestStatus,
    lastError: c.lastError,
    domain: c.domain,
    dns: c.dns.map((d) => ({ ...d })),
    senders: structuredClone(c.senders),
  }
}

export async function getEmail(user: User): Promise<EmailIntegration> {
  return emailView(viewCtx(user))
}

function clearEmailCredentials(co: string): void {
  integrationSecrets.delete(secretKey(co, 'smtp', 'password'))
  integrationSecrets.delete(secretKey(co, 'oauth-email', 'token'))
}

/** PUT /integrations/email/smtp — SMTP server; the password is write-only (empty = keep the stored one). */
export async function saveSmtp(user: User, input: unknown): Promise<EmailIntegration> {
  const co = editCtx(user)
  const b = isObj(input) ? input : {}
  const host = str(b.host, 190).toLowerCase()
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) bad('Enter the SMTP host, e.g. smtp.yourdomain.com.', 'invalid_host')
  const port = Number(b.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) bad('The port is a number from 1 to 65535 (usually 465 or 587).', 'invalid_port')
  const security = b.security === 'ssl' || b.security === 'starttls' || b.security === 'none' ? b.security : bad('Pick SSL/TLS, STARTTLS or none.')
  const username = str(b.username, 190)
  if (!username) bad('Enter the SMTP username.')
  const fromAddress = str(b.fromAddress, 190).toLowerCase()
  if (!EMAIL_RE.test(fromAddress)) bad('Enter a valid “from” address.', 'invalid_from')
  const fromName = str(b.fromName, 120)
  const c = emailConfigs.get(co)
  const pwKey = secretKey(co, 'smtp', 'password')
  const password = typeof b.password === 'string' ? b.password : ''
  if (password.length > 256) bad('The password is too long.')
  if (!password && !(c.provider === 'smtp' && integrationSecrets.has(pwKey))) bad('Enter the SMTP password.', 'password_required')
  const wasProvider = c.provider
  if (password) {
    clearEmailCredentials(co)
    integrationSecrets.set(pwKey, password)
    c.passwordHint = password.length >= 4 ? hintOf(password) : '••••'
  }
  c.provider = 'smtp'
  c.tokenHint = null
  c.smtp = { host, port, security, username }
  c.fromAddress = fromAddress
  c.fromName = fromName
  c.connectedAs = username.includes('@') ? username.toLowerCase() : fromAddress
  if (wasProvider !== 'smtp') {
    c.connectedAt = nowIso()
    c.connectedBy = who(user)
  }
  c.lastTestStatus = null
  c.lastError = null
  c.paused = false
  const domain = fromAddress.split('@')[1]
  if (domain !== c.domain) {
    c.domain = domain
    c.dns = dnsFor(domain)
  }
  emailConnections.set(co, { provider: 'smtp', address: fromAddress, connectedAt: c.connectedAt ?? nowIso(), connectedBy: c.connectedBy ?? who(user) })
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'email', summary: `Configured SMTP sending via ${host}:${port}${password ? ' (password changed)' : ''}` })
  addSync(co, 'email', 'internal', 'success', `SMTP server ${host}:${port} saved by ${who(user)}.`)
  return emailView(co)
}

/** POST /integrations/email/connect { state, approve } — finishes the Google Workspace / Microsoft 365 consent. */
export async function connectEmailOAuth(user: User, input: unknown): Promise<EmailIntegration> {
  const co = editCtx(user)
  const rec = consumeOAuth(user, co, input, 'email')
  const c = emailConfigs.get(co)
  clearEmailCredentials(co)
  const token = `${rec.provider === 'google' ? 'ya29.' : 'EwB0A8l6'}${randomToken(40)}`
  integrationSecrets.set(secretKey(co, 'oauth-email', 'token'), token)
  c.provider = rec.provider
  c.tokenHint = hintOf(token)
  c.passwordHint = null
  c.smtp = null
  c.connectedAs = rec.account
  c.connectedAt = nowIso()
  c.connectedBy = who(user)
  c.fromAddress = rec.account
  c.fromName ||= companyById(co)?.branding?.displayName || companyById(co)?.name || ''
  c.lastTestStatus = null
  c.lastError = null
  c.paused = false
  const domain = rec.account.split('@')[1]
  if (domain !== c.domain || !c.dns.length) {
    c.domain = domain
    c.dns = dnsFor(domain)
  }
  emailConnections.set(co, { provider: rec.provider, address: rec.account, connectedAt: c.connectedAt, connectedBy: c.connectedBy })
  const label = rec.provider === 'google' ? 'Google Workspace' : 'Microsoft 365'
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'email', summary: `Connected ${label} email sending as ${rec.account}` })
  addSync(co, 'email', 'internal', 'success', `Connected ${label} as ${rec.account}.`)
  return emailView(co)
}

/** DELETE /integrations/email — forgets the credentials (and the onboarding mailbox). */
export async function disconnectEmail(user: User): Promise<EmailIntegration> {
  const co = editCtx(user)
  const c = emailConfigs.get(co)
  if (!c.provider && !emailConnections.get(co)) conflict('Email sending isn’t connected.', 'not_connected')
  const was = c.connectedAs ?? emailConnections.get(co)?.address ?? ''
  clearEmailCredentials(co)
  Object.assign(c, { provider: null, connectedAs: null, smtp: null, passwordHint: null, tokenHint: null, connectedAt: null, connectedBy: null, lastTestStatus: null, lastError: null, paused: false })
  emailConnections.set(co, null)
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'email', summary: `Disconnected email sending (${was})` })
  addSync(co, 'email', 'internal', 'success', `Email sending disconnected by ${who(user)}.`)
  return emailView(co)
}

/** POST /integrations/email/test { to } — a (simulated) test email through the connected account; logged. */
export async function sendTestEmail(user: User, input: unknown): Promise<EmailIntegration> {
  const co = editCtx(user)
  const c = emailConfigs.get(co)
  emailView(co)
  if (!c.provider) conflict('Connect email sending first.', 'not_connected')
  if (c.paused) conflict('Email sending is paused. Resume it to send.', 'paused')
  const to = str(isObj(input) ? input.to : '', 190).toLowerCase() || user.email
  if (!EMAIL_RE.test(to)) bad('Enter a valid email address.', 'invalid_to')
  const host = c.smtp?.host ?? ''
  const failed = c.provider === 'smtp' && /invalid|fail/.test(host)
  const at = nowIso()
  const subject = 'Test email from Apex CRM'
  emailTestLog.unshift({ companyId: co, id: nextIntegrationId('ET'), at, to, subject, status: failed ? 'failed' : 'sent', by: who(user) })
  c.lastTestAt = at
  c.lastTestStatus = failed ? 'error' : 'success'
  c.lastError = failed ? `Couldn’t connect to ${host}:${c.smtp?.port} (simulated). Check the host, port and security.` : null
  addSync(co, 'email', 'outbound', failed ? 'error' : 'success', failed ? `Test email to ${to} failed: ${c.lastError}` : `Test email sent to ${to}.`, at)
  return emailView(co)
}

/**
 * POST /integrations/email/verify-domain — simulated DNS check: SPF and DMARC verify at once; DKIM only on a check at
 * least 10 minutes after the previous one (DNS propagation), else `pending`.
 */
export async function verifyDomain(user: User): Promise<EmailIntegration> {
  const co = editCtx(user)
  const c = emailConfigs.get(co)
  emailView(co)
  const at = nowIso()
  for (const d of c.dns) {
    const before = d.checkedAt ? Date.parse(d.checkedAt) : null
    if (d.kind === 'dkim' && d.status !== 'verified' && (before === null || nowMs() - before < 10 * 60_000)) {
      d.status = 'pending'
      d.message = 'Not found yet. DNS changes can take up to 48 hours; check again later.'
    } else {
      d.status = 'verified'
      d.message = null
    }
    d.checkedAt = at
  }
  const pending = c.dns.filter((d) => d.status !== 'verified').map((d) => d.kind.toUpperCase())
  addSync(co, 'email', 'internal', pending.length ? 'warning' : 'success', pending.length ? `Domain check for ${c.domain}: ${pending.join(', ')} pending.` : `Domain ${c.domain} verified (SPF, DKIM, DMARC).`, at)
  return emailView(co)
}

/** PATCH /integrations/email/senders — default sender per purpose; addresses must be on the company's sending domain. */
export async function updateSenders(user: User, input: unknown): Promise<EmailIntegration> {
  const co = editCtx(user)
  const c = emailConfigs.get(co)
  emailView(co)
  const b = isObj(input) ? input : {}
  const next = structuredClone(c.senders)
  for (const purpose of ['sales', 'invoices', 'hr'] as SenderPurpose[]) {
    const v = b[purpose]
    if (v === undefined) continue
    if (!isObj(v)) bad(`${purpose} is { name, address }.`)
    const s: Sender = { name: str(v.name, 120), address: str(v.address, 190).toLowerCase() }
    if (s.address && !EMAIL_RE.test(s.address)) bad(`${s.address} isn’t a valid email address.`, 'invalid_sender')
    if (s.address && !s.address.endsWith(`@${c.domain}`)) bad(`Senders must use your sending domain (${c.domain}).`, 'sender_domain')
    next[purpose] = s
  }
  c.senders = next
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'email', summary: 'Changed the default email senders' })
  return emailView(co)
}

/** GET /integrations/email/log — every email the workspace sent: invoices, statements, reminders, bulk emails, tests. */
export async function getEmailLog(user: User, q: { source?: string | null; status?: string | null } = {}): Promise<EmailLogRow[]> {
  const co = viewCtx(user)
  const rows: EmailLogRow[] = []
  if (hasModule(co, 'accounting')) {
    // Seed the books, then let the company's time-based jobs (reminders) catch up, so the log is stable between calls.
    runFinanceHooks(co)
    runLifecycle(co)
    for (const inv of financeInvoices) {
      if (inv.companyId !== co) continue
      const log = (inv as unknown as { sendLog?: { at: string; to: string; subject: string }[] }).sendLog ?? []
      log.forEach((s, i) => rows.push({ id: `inv-${inv.id}-${i}`, at: s.at, source: 'invoice', to: s.to, subject: s.subject, status: 'sent', detail: null, link: `/finance/invoices/${inv.id}` }))
    }
    for (const d of finDunningLog) {
      if (d.companyId !== co) continue
      const inv = financeInvoices.find((x) => x.companyId === co && x.id === d.invoiceId)
      rows.push({ id: `dun-${d.id}`, at: d.at, source: 'reminder', to: d.sentTo ?? '—', subject: `Payment reminder${inv ? ` for ${inv.number}` : ''}`, status: d.outcome === 'sent' ? 'sent' : 'skipped', detail: d.outcome === 'skipped' ? 'Skipped by the reminder schedule' : null, link: inv ? `/finance/invoices/${inv.id}` : null })
    }
    for (const a of auditLog) {
      if (a.companyId !== co || a.entity !== 'statement' || !a.summary.startsWith('Emailed the statement')) continue
      const to = a.summary.split(' to ').pop() ?? '—'
      rows.push({ id: `stm-${a.id}`, at: a.at, source: 'statement', to, subject: a.summary.replace(/ to [^ ]+$/, ''), status: 'sent', detail: null, link: null })
    }
  }
  for (const e of bulkEmails) {
    if (e.companyId !== co || e.status === 'draft') continue
    const rs = bulkEmailRecipients.filter((r) => r.companyId === co && r.bulkEmailId === e.id)
    const n = (s: string) => rs.filter((r) => r.status === s).length
    const status: EmailLogRow['status'] = n('sent') ? 'sent' : n('queued') ? 'queued' : n('failed') ? 'failed' : 'skipped'
    rows.push({ id: `bulk-${e.id}`, at: e.sentAt ?? e.startedAt ?? e.scheduledAt ?? e.updatedAt, source: 'bulk', to: `${rs.length} recipient${rs.length === 1 ? '' : 's'}`, subject: e.subject, status, detail: `${n('sent')} sent · ${n('queued')} queued · ${n('skipped')} skipped · ${n('failed')} failed`, link: `/marketing/email/${e.id}` })
  }
  for (const t of emailTestLog) {
    if (t.companyId !== co) continue
    rows.push({ id: `test-${t.id}`, at: t.at, source: 'test', to: t.to, subject: t.subject, status: t.status, detail: `Sent by ${t.by}`, link: null })
  }
  const source = q.source as EmailLogSource | undefined
  return rows
    .filter((r) => (!source || r.source === source) && (!q.status || r.status === q.status))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 500)
}

/* ======================================================================================
 * Website & forms (inbound webhook)
 * ==================================================================================== */

const WEBHOOK_PATH = '/public/integrations/forms/'
const websiteToken = (co: string) => {
  websiteHooks.get(co)
  return integrationSecrets.get(secretKey(co, 'website', 'token')) ?? ''
}

function webhookView(co: string, reveal: boolean): InboundWebhook {
  const w = websiteHooks.get(co)
  const leadsCreated = w.leadsCreated
  return {
    url: `${WEBHOOK_PATH}${reveal ? websiteToken(co) : `whk_${w.tokenHint.replace(/\s/g, '')}`}`,
    tokenHint: w.tokenHint,
    revealed: reveal,
    createdAt: w.createdAt,
    rotatedAt: w.rotatedAt,
    rotatedBy: w.rotatedBy,
    lastReceivedAt: w.lastReceivedAt,
    received: w.received,
    leadsCreated,
    fieldMap: { ...w.fieldMap },
    defaultSource: w.defaultSource,
    defaultOwnerId: w.defaultOwnerId,
    paused: w.paused,
  }
}

/**
 * GET /integrations/website — the company's lead forms (Marketing › Lead Generation, when in the plan) for the embed
 * snippets, and the inbound webhook. The webhook URL carries the full token for Company Admins only (they paste it
 * into the third-party form tool); Management sees it masked.
 */
export async function getWebsite(user: User): Promise<WebsiteIntegration> {
  const co = viewCtx(user)
  const marketing = hasModule(co, 'marketing')
  const forms = marketing
    ? leadForms
        .filter((f) => f.companyId === co)
        .map((f) => ({ id: f.id, name: f.name, publicKey: f.publicKey, status: f.status, submissions: formSubmissions.filter((s) => s.companyId === co && s.formId === f.id && s.outcome !== 'spam').length }))
    : []
  return { marketingInPlan: marketing, forms, webhook: webhookView(co, canEditIntegrations(user)) }
}

/** POST /integrations/website/webhook/rotate — new token; the old URL stops working at once. Audited. */
export async function rotateWebhookToken(user: User): Promise<WebsiteIntegration> {
  const co = editCtx(user)
  const w = websiteHooks.get(co)
  const token = `whk_${randomToken(28)}`
  integrationSecrets.set(secretKey(co, 'website', 'token'), token)
  w.tokenHint = hintOf(token)
  w.rotatedAt = nowIso()
  w.rotatedBy = who(user)
  recordAudit(user, { action: 'security', entity: 'integration', entityId: 'website-webhook', summary: 'Regenerated the website webhook token (the previous URL no longer works)' })
  addSync(co, 'website', 'internal', 'success', `Webhook token regenerated by ${who(user)}.`)
  return getWebsite(user)
}

const isLeadField = (v: unknown): v is LeadField => typeof v === 'string' && (LEAD_FIELDS as string[]).includes(v)

/** PUT /integrations/website/webhook — field mapping, default source and owner. */
export async function updateInboundWebhook(user: User, input: unknown): Promise<WebsiteIntegration> {
  const co = editCtx(user)
  const w = websiteHooks.get(co)
  const b = isObj(input) ? input : {}
  if (b.fieldMap !== undefined) {
    if (!isObj(b.fieldMap)) bad('field_map is an object: external field → lead field.')
    const map: Record<string, LeadField> = {}
    const entries = Object.entries(b.fieldMap as Record<string, unknown>)
    if (entries.length > 40) bad('Map at most 40 fields.')
    for (const [k, v] of entries) {
      const key = k.trim().toLowerCase().slice(0, 60)
      if (!key || !/^[a-z0-9_.\-[\] ]+$/.test(key)) bad(`“${k}” isn’t a valid field name (letters, digits, spaces, _ . -).`, 'invalid_field')
      if (!isLeadField(v)) bad(`Map “${k}” to a lead field.`, 'invalid_field')
      map[key] = v
    }
    const targets = Object.values(map)
    if (!targets.includes('email') && !targets.includes('mobile')) bad('Map at least one field to Email or Mobile.', 'mapping_incomplete')
    if (!targets.includes('company') && !targets.includes('contactName')) bad('Map at least one field to Company name or Contact name.', 'mapping_incomplete')
    w.fieldMap = map
  }
  if (b.defaultSource !== undefined) {
    const s = str(b.defaultSource, 60)
    if (!lookupsFor(co).sources.some((x) => x.active && x.key === s)) bad('Pick a lead source from the list.', 'invalid_source')
    w.defaultSource = s
  }
  if (b.defaultOwnerId !== undefined) {
    if (b.defaultOwnerId === null || b.defaultOwnerId === '') w.defaultOwnerId = null
    else {
      const u = users.find((x) => x.companyId === co && x.id === b.defaultOwnerId && x.active !== false)
      if (!u) bad('That user doesn’t exist.', 'invalid_owner')
      w.defaultOwnerId = u!.id
    }
  }
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'website-webhook', summary: 'Changed the website webhook mapping' })
  return getWebsite(user)
}

/** Payload → lead fields through the mapping (keys compared case-insensitively; nested `fields` objects flattened). */
function mapPayload(map: Record<string, LeadField>, raw: unknown): MappingPreview & { notes: string[] } {
  const flat: Record<string, string> = {}
  const walk = (v: unknown, prefix: string) => {
    if (!isObj(v)) return
    for (const [k, x] of Object.entries(v)) {
      const key = `${prefix}${k}`.trim().toLowerCase()
      if (isObj(x)) walk(x, key === 'fields' || key === 'data' ? '' : `${key}.`)
      else if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') flat[key.slice(0, 60)] = String(x).trim().slice(0, 1000)
    }
  }
  walk(raw, '')
  const lead: Partial<Record<LeadField, string>> = {}
  const notes: string[] = []
  const unmapped: string[] = []
  for (const [k, v] of Object.entries(flat)) {
    if (!v) continue
    const f = map[k]
    if (!f) {
      unmapped.push(k)
      notes.push(`${k}: ${v}`)
    } else if (f === 'note') notes.push(`${k}: ${v}`)
    else lead[f] = lead[f] ? `${lead[f]} ${v}` : v
  }
  const problems: string[] = []
  if (!lead.email && !lead.mobile) problems.push('No email or mobile in the submission.')
  if (!lead.company && !lead.contactName) problems.push('No company or contact name in the submission.')
  if (lead.email && !EMAIL_RE.test(lead.email)) problems.push(`${lead.email} isn’t a valid email address.`)
  if (notes.length) lead.note = notes.join('\n')
  return { lead, unmapped, problems, notes }
}

/** POST /integrations/website/webhook/preview { payload } — what the mapping makes of a sample submission (nothing stored). */
export async function previewMapping(user: User, input: unknown): Promise<MappingPreview> {
  const co = viewCtx(user)
  const { lead, unmapped, problems } = mapPayload(websiteHooks.get(co).fieldMap, isObj(input) ? input.payload : null)
  return { lead, unmapped, problems }
}

export const webhookHits = registerArray<RateHit>('integrations.webhookHits', [])
const INVALID_HOOK = 'This webhook URL isn’t valid.'
export const WEBHOOK_RATE = { perClient: 30, perToken: 300, windowMs: 10 * 60_000 }

/** The company behind a website webhook token; an unknown token, a company without the module or a deleted / suspended workspace → the same 404. */
export function companyByWebhookToken(token: string): string {
  let co: string | null = null
  if (typeof token === 'string' && token.length >= 20) {
    for (const [k, v] of integrationSecrets) {
      if (v === token && k.endsWith('|website|token')) {
        co = k.split('|')[0]
        break
      }
    }
  }
  const sub = co ? subscriptionOf(co) : undefined
  if (!co || !sub || sub.status === 'deleted' || companyById(co)?.status === 'suspended' || !hasModule(co, 'integrations')) {
    throw new CodedApiError(INVALID_HOOK, 404, 'webhook_not_found')
  }
  return co
}

/**
 * POST /public/integrations/forms/:token — third-party website forms (WordPress, Webflow, Zapier…) post their fields
 * here. No sign-in: the per-company token in the URL is the credential; the lead lands in that company only.
 * Rate-limited per client and per token. Mapping → lead through the lead creation service (`insertLead`): an existing
 * lead with the same email gets an activity instead of a duplicate; the plan's leads limit stores nothing but a sync
 * warning. The answer never says which of these happened.
 */
export async function receiveWebsiteWebhook(token: string, input: unknown, clientKey = 'anonymous'): Promise<{ ok: true }> {
  const co = companyByWebhookToken(token)
  hitRateLimit(webhookHits, [`hook:${co}:${clientKey || 'anonymous'}`], { limit: WEBHOOK_RATE.perClient, windowMs: WEBHOOK_RATE.windowMs, what: 'submission' })
  // A second, wider limit for every client of the token together.
  hitRateLimit(webhookHits, [`hook:${co}`], { limit: WEBHOOK_RATE.perToken, windowMs: WEBHOOK_RATE.windowMs, what: 'submission' })
  const w = websiteHooks.get(co)
  if (w.paused) throw new CodedApiError('This webhook is paused.', 409, 'webhook_paused')
  const sub = subscriptionOf(co)
  if (sub && isReadOnly(sub.status)) throw new CodedApiError('This webhook isn’t accepting submissions right now.', 409, 'webhook_paused')
  const { lead: m, problems, notes } = mapPayload(w.fieldMap, input)
  const at = nowIso()
  w.received += 1
  w.lastReceivedAt = at
  if (problems.length) {
    addSync(co, 'website', 'inbound', 'warning', `Webhook submission skipped: ${problems.join(' ')}`, at)
    throw new CodedApiError(problems.join(' '), 422, 'invalid_submission')
  }
  const country = countryOf({ companyId: co })
  const email = (m.email ?? '').toLowerCase()
  const mobile = m.mobile ? normalizeMobile(m.mobile, country) ?? '' : ''
  const existing = email
    ? leads.find((l) => l.companyId === co && (l.contactEmail.toLowerCase() === email || contacts.some((c) => c.companyId === co && c.leadId === l.id && c.email.toLowerCase() === email)))
    : undefined
  const name = m.contactName || m.company || ''
  if (existing) {
    activities.push({ companyId: co, id: `A-WH-${nextIntegrationId('X')}`, leadId: existing.id, type: 'system', summary: `${name} submitted a website form again (webhook).${existing.doNotContact ? ' The lead is Do Not Contact: no outreach.' : ''}`, userId: existing.ownerId, at })
    addSync(co, 'website', 'inbound', 'success', `Webhook submission linked to existing lead ${existing.id}.`, at)
    return { ok: true }
  }
  const lk = lookupsFor(co)
  const source = lk.sources.find((s) => s.active && s.key === w.defaultSource)?.key ?? lk.sources.find((s) => s.active && s.key === 'Website')?.key ?? lk.sources.find((s) => s.active)?.key ?? 'Website'
  const wanted = (m.industry ?? '').toLowerCase()
  const industry = lk.industries.find((i) => i.active && (i.key.toLowerCase() === wanted || i.label.toLowerCase() === wanted)) ?? lk.industries.find((i) => i.active && /other/i.test(i.key)) ?? lk.industries.find((i) => i.active)
  const owner =
    users.find((u) => u.companyId === co && u.id === w.defaultOwnerId && u.active !== false) ??
    users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Sales Agent').sort((a, b) => a.id.localeCompare(b.id))[0] ??
    users.find((u) => u.companyId === co && u.role === 'Company Admin')
  if (!owner || !industry) throw new CodedApiError(INVALID_HOOK, 404, 'webhook_not_found')
  try {
    assertCapacity(co, 'leadsContacts', 2)
    const value = Number(String(m.value ?? '').replace(/[^\d.]/g, ''))
    const lead = insertLead(owner, {
      company: (m.company || m.contactName || '').slice(0, 255),
      sourceType: source,
      sourceDetail: (m.sourceDetail || 'Website webhook').slice(0, 255),
      industry: industry.key,
      contacts: [{ name: (m.contactName || m.company || '').slice(0, 255), title: '', mobile, email, isDecisionMaker: false }],
      ownerId: owner.id,
      nextFollowUpDate: null,
      value: Number.isFinite(value) ? value : 0,
      website: m.website,
      note: ['Received through the website webhook.', ...notes].join('\n').slice(0, 4000),
    })
    w.leadsCreated += 1
    noteUsage(co)
    addSync(co, 'website', 'inbound', 'success', `Webhook created lead ${lead.id} (${lead.company}).`, at)
  } catch (err) {
    if (!(err instanceof LimitReachedError)) throw err
    addSync(co, 'website', 'inbound', 'warning', 'Webhook submission not saved: the plan’s leads limit is reached.', at)
  }
  return { ok: true }
}

/* ======================================================================================
 * Payments
 * ==================================================================================== */

const isGateway = (v: unknown): v is GatewayProvider => typeof v === 'string' && (GATEWAY_PROVIDERS as string[]).includes(v)

function gatewayView(co: string, p: GatewayProvider): Gateway {
  const cfg = paymentConfigs.get(co)
  const g: GatewayRecord | undefined = cfg.gateways[p]
  const sub = companyById(co)?.subdomain ?? 'workspace'
  return {
    provider: p,
    status: g ? 'connected' : 'not_connected',
    merchantId: g?.merchantId ?? null,
    mode: g?.mode ?? 'test',
    currency: g?.currency ?? null,
    secretKeyHint: g?.secretKeyHint ?? null,
    isDefault: cfg.defaultProvider === p,
    webhookUrl: `https://${sub}.apexcrm.app/api/public/payments/${p}/webhook`,
    connectedAt: g?.connectedAt ?? null,
    lastTestAt: g?.lastTestAt ?? null,
    lastTestStatus: g?.lastTestStatus ?? null,
  }
}

function paymentsView(co: string): PaymentsIntegration {
  return { gateways: GATEWAY_PROVIDERS.map((p) => gatewayView(co, p)), defaultProvider: paymentConfigs.get(co).defaultProvider }
}

export async function getPayments(user: User): Promise<PaymentsIntegration> {
  return paymentsView(viewCtx(user))
}

const provider = (p: string) => (isGateway(p) ? p : notFound())

/** PUT /integrations/payments/:provider — merchant id, mode, currency; the secret key is write-only. */
export async function saveGateway(user: User, p: string, input: unknown): Promise<PaymentsIntegration> {
  const co = editCtx(user)
  const prov = provider(p)
  const b = isObj(input) ? input : {}
  const merchantId = str(b.merchantId, 40)
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(merchantId)) bad('Enter the merchant / account id from the gateway dashboard.', 'invalid_merchant')
  const mode = b.mode === 'live' || b.mode === 'test' ? b.mode : bad('Pick test or live mode.')
  const currency = str(b.currency, 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) bad('Pick the settlement currency.', 'invalid_currency')
  const cfg = paymentConfigs.get(co)
  const existing = cfg.gateways[prov]
  const secret = typeof b.secretKey === 'string' ? b.secretKey.trim() : ''
  if (!secret && !existing) bad('Enter the secret key.', 'secret_required')
  if (secret && (secret.length < 12 || secret.length > 200)) bad('The secret key looks too short.', 'invalid_secret')
  if (secret) integrationSecrets.set(secretKey(co, 'gateway', prov), secret)
  cfg.gateways[prov] = {
    merchantId,
    mode,
    currency,
    secretKeyHint: secret ? hintOf(secret) : existing!.secretKeyHint,
    connectedAt: existing?.connectedAt ?? nowIso(),
    connectedBy: existing?.connectedBy ?? who(user),
    lastTestAt: existing?.lastTestAt ?? null,
    lastTestStatus: existing?.lastTestStatus ?? null,
  }
  if (!cfg.defaultProvider) cfg.defaultProvider = prov
  recordAudit(user, { action: 'update', entity: 'integration', entityId: `payments:${prov}`, summary: `${existing ? 'Updated' : 'Connected'} ${GATEWAY_LABEL[prov]} (${mode} mode, ${currency})${secret ? ', key changed' : ''}` })
  addSync(co, 'payments', 'internal', 'success', `${GATEWAY_LABEL[prov]} ${existing ? 'updated' : 'connected'} (${mode} mode).`)
  return paymentsView(co)
}

export async function removeGateway(user: User, p: string): Promise<PaymentsIntegration> {
  const co = editCtx(user)
  const prov = provider(p)
  const cfg = paymentConfigs.get(co)
  if (!cfg.gateways[prov]) conflict(`${GATEWAY_LABEL[prov]} isn’t connected.`, 'not_connected')
  delete cfg.gateways[prov]
  integrationSecrets.delete(secretKey(co, 'gateway', prov))
  if (cfg.defaultProvider === prov) cfg.defaultProvider = GATEWAY_PROVIDERS.find((x) => cfg.gateways[x]) ?? null
  recordAudit(user, { action: 'update', entity: 'integration', entityId: `payments:${prov}`, summary: `Disconnected ${GATEWAY_LABEL[prov]}` })
  addSync(co, 'payments', 'internal', 'success', `${GATEWAY_LABEL[prov]} disconnected by ${who(user)}.`)
  return paymentsView(co)
}

/** POST /integrations/payments/:provider/default — the gateway finance payment links use. */
export async function setDefaultGateway(user: User, p: string): Promise<PaymentsIntegration> {
  const co = editCtx(user)
  const prov = provider(p)
  const cfg = paymentConfigs.get(co)
  if (!cfg.gateways[prov]) conflict(`Connect ${GATEWAY_LABEL[prov]} first.`, 'not_connected')
  cfg.defaultProvider = prov
  recordAudit(user, { action: 'update', entity: 'integration', entityId: `payments:${prov}`, summary: `Made ${GATEWAY_LABEL[prov]} the default gateway for payment links` })
  return paymentsView(co)
}

/** POST /integrations/payments/:provider/test — simulated 1.00 authorisation (refunded in live mode). Merchant ids ending in 000 are declined. */
export async function testGateway(user: User, p: string): Promise<PaymentsIntegration> {
  const co = editCtx(user)
  const prov = provider(p)
  const g = paymentConfigs.get(co).gateways[prov]
  if (!g) conflict(`Connect ${GATEWAY_LABEL[prov]} first.`, 'not_connected')
  const failed = /000$/.test(g!.merchantId)
  g!.lastTestAt = nowIso()
  g!.lastTestStatus = failed ? 'error' : 'success'
  addSync(
    co,
    'payments',
    'outbound',
    failed ? 'error' : 'success',
    failed ? `${GATEWAY_LABEL[prov]} test transaction declined: authentication failed (check the merchant id and key).` : `${GATEWAY_LABEL[prov]} test transaction approved (${g!.currency} 1.00, ${g!.mode} mode${g!.mode === 'live' ? ', refunded' : ''}).`,
  )
  return paymentsView(co)
}

// SEAM(gateway) in services/financeCollections.ts: payment links use the default gateway's mode, and a paid link is logged here.
registerPaymentGateway(
  (co) => {
    const cfg = paymentConfigs.get(co)
    const g = cfg.defaultProvider ? cfg.gateways[cfg.defaultProvider] : undefined
    return cfg.defaultProvider && g ? { provider: cfg.defaultProvider, label: GATEWAY_LABEL[cfg.defaultProvider], testMode: g.mode === 'test' } : null
  },
  (co, paid) => {
    const cfg = paymentConfigs.get(co)
    const label = cfg.defaultProvider ? GATEWAY_LABEL[cfg.defaultProvider] : 'Simulated gateway'
    addSync(co, 'payments', 'inbound', 'success', `${label}: ${paid.currency} ${paid.amount.toFixed(2)} received for ${paid.invoiceNumber} (receipt ${paid.receiptNumber}).`)
  },
)

/* ======================================================================================
 * Calendar (per user)
 * ==================================================================================== */

const myRow = (co: string, userId: string) => calendarConnections.find((c) => c.companyId === co && c.userId === userId)

/** Busy blocks of the (simulated) connected calendar for the next 7 days: deterministic per user. */
function busyOf(userId: string): BusyBlock[] {
  let h = 0
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const out: BusyBlock[] = []
  const start = new Date(nowMs())
  start.setUTCHours(0, 0, 0, 0)
  for (let d = 1; d <= 7; d++) {
    const day = new Date(start.getTime() + d * 86_400_000)
    if (day.getUTCDay() === 5 || day.getUTCDay() === 6) continue
    const hour = 5 + ((h + d * 7) % 6)
    const len = 30 + ((h >> d) % 3) * 30
    const s = new Date(day.getTime() + hour * 3_600_000)
    out.push({ start: s.toISOString(), end: new Date(s.getTime() + len * 60_000).toISOString() })
  }
  return out
}

function myCalendarView(co: string, userId: string): MyCalendar {
  const r = myRow(co, userId)
  if (!r) return { status: 'not_connected', provider: null, connectedAs: null, connectedAt: null, lastSyncAt: null, pushedCount: 0, settings: { pushTasks: true, pushMeetings: true, showBusy: true }, busy: [] }
  return {
    status: 'connected',
    provider: r.provider,
    connectedAs: r.connectedAs,
    connectedAt: r.connectedAt,
    lastSyncAt: r.lastSyncAt,
    pushedCount: r.pushedCount,
    settings: { pushTasks: r.pushTasks, pushMeetings: r.pushMeetings, showBusy: r.showBusy },
    busy: r.showBusy ? busyOf(userId) : [],
  }
}

/** GET /integrations/calendar/me — every role (own connection only). */
export async function getMyCalendar(user: User): Promise<MyCalendar> {
  return myCalendarView(tenantOf(user), user.id)
}

/** POST /integrations/calendar/me/connect { state, approve } — finishes the Google / Outlook consent for the caller. */
export async function connectMyCalendar(user: User, input: unknown): Promise<MyCalendar> {
  const co = tenantOf(user)
  const rec = consumeOAuth(user, co, input, 'calendar')
  const prov = rec.calendarProvider ?? 'google'
  const token = `${prov === 'google' ? 'ya29.' : 'EwB0A8l6'}${randomToken(40)}`
  integrationSecrets.set(secretKey(co, 'calendar', user.id), token)
  const existing = myRow(co, user.id)
  const row = existing ?? { companyId: co, id: nextIntegrationId('CAL'), userId: user.id, provider: prov, connectedAs: rec.account, tokenHint: '', connectedAt: nowIso(), lastSyncAt: null, pushedCount: 0, pushTasks: true, pushMeetings: true, showBusy: true }
  Object.assign(row, { provider: prov, connectedAs: rec.account, tokenHint: hintOf(token), connectedAt: nowIso() })
  if (!existing) calendarConnections.push(row)
  addSync(co, 'calendar', 'internal', 'success', `${who(user)} connected ${prov === 'google' ? 'Google Calendar' : 'Outlook'} (${rec.account}).`)
  return myCalendarView(co, user.id)
}

export async function updateMyCalendar(user: User, input: unknown): Promise<MyCalendar> {
  const co = tenantOf(user)
  const r = myRow(co, user.id) ?? conflict('Connect your calendar first.', 'not_connected')
  const b = isObj(input) ? input : {}
  for (const k of ['pushTasks', 'pushMeetings', 'showBusy'] as const) {
    if (b[k] === undefined) continue
    if (typeof b[k] !== 'boolean') bad(`${k} is true or false.`)
    r[k] = b[k] as boolean
  }
  return myCalendarView(co, user.id)
}

/** POST /integrations/calendar/me/sync — pushes the caller's open tasks with a due date (and meetings) to the calendar. */
export async function syncMyCalendar(user: User): Promise<MyCalendar> {
  const co = tenantOf(user)
  const r = myRow(co, user.id) ?? conflict('Connect your calendar first.', 'not_connected')
  const taskCount = r.pushTasks ? tasks.filter((t) => t.companyId === co && t.ownerId === user.id && t.dueDate && t.status !== 'done' && t.status !== 'cancelled').length : 0
  const since = new Date(nowMs() - 30 * 86_400_000).toISOString()
  const meetings = r.pushMeetings ? activities.filter((a) => a.companyId === co && a.userId === user.id && a.type === 'meeting' && a.at >= since).length : 0
  r.lastSyncAt = nowIso()
  r.pushedCount = taskCount + meetings
  addSync(co, 'calendar', 'outbound', 'success', `${who(user)}: ${taskCount} task${taskCount === 1 ? '' : 's'} and ${meetings} meeting${meetings === 1 ? '' : 's'} pushed to ${r.provider === 'google' ? 'Google Calendar' : 'Outlook'}.`)
  return myCalendarView(co, user.id)
}

export async function disconnectMyCalendar(user: User): Promise<MyCalendar> {
  const co = tenantOf(user)
  const i = calendarConnections.findIndex((c) => c.companyId === co && c.userId === user.id)
  if (i < 0) conflict('Your calendar isn’t connected.', 'not_connected')
  calendarConnections.splice(i, 1)
  integrationSecrets.delete(secretKey(co, 'calendar', user.id))
  addSync(co, 'calendar', 'internal', 'success', `${who(user)} disconnected their calendar.`)
  return myCalendarView(co, user.id)
}

/** GET /integrations/calendar/connections — who is connected (settings view; never a token). */
export async function getCalendarConnections(user: User): Promise<CalendarConnectionRow[]> {
  const co = viewCtx(user)
  return calendarConnections
    .filter((c) => c.companyId === co)
    .map((c) => {
      const u = users.find((x) => x.id === c.userId)
      return { userId: c.userId, userName: u?.name ?? 'Former user', role: u?.role ?? '', provider: c.provider, connectedAs: c.connectedAs, connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt }
    })
    .sort((a, b) => a.userName.localeCompare(b.userName))
}

/* ======================================================================================
 * Sync log
 * ==================================================================================== */

/** GET /integrations/sync-log?integration=&status=&direction= — newest first (settings view). */
export async function getSyncLog(user: User, q: { integration?: string | null; status?: string | null; direction?: string | null } = {}): Promise<SyncLogRow[]> {
  const co = viewCtx(user)
  return syncLog
    .filter((r: Tenant<SyncLogRow>) => r.companyId === co && (!q.integration || r.integration === q.integration) && (!q.status || r.status === q.status) && (!q.direction || r.direction === q.direction))
    .map(({ companyId: _c, ...r }) => r)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 1000)
}
