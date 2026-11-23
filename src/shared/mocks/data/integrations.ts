import type {
  ApiScope,
  ApiScopeModule,
  CalendarProvider,
  DeliveryStatus,
  DnsRecord,
  EmailProviderKey,
  GatewayProvider,
  IntegrationKey,
  IntegrationStatus,
  LeadField,
  Sender,
  SenderPurpose,
  SmtpSecurity,
  SyncDirection,
  SyncStatus,
  WaCategory,
  WaTemplateStatus,
  WebhookEvent,
} from '@/modules/integrations/types'
import { registerArray, registerMap, registerSet, registerValue } from '@/shared/mocks/persist/registry'
import { perTenant, type Tenant } from '@/shared/mocks/tenant'
import { APEX_ID, CREST_ID } from './tenancy'
import { emailConnections } from './onboarding'

/**
 * Insights & admin › Integrations stores (docs/API.md › Integrations; design gaps I-1… in docs/DB-ALIGNMENT.md).
 * Every row carries companyId (tenant key); per-company singletons (email, website webhook, WhatsApp number,
 * payment gateways) are perTenant. CREDENTIALS NEVER LIVE IN A ROW: they sit only in `integrationSecrets`
 * (key `<companyId>|<kind>|<id>`), rows keep a masked hint. API keys are not stored at all, only a hash.
 * Synthetic data only.
 */

/* ---------------- secrets (write-only, server side) ---------------- */

export type SecretKind = 'smtp' | 'oauth-email' | 'website' | 'whatsapp' | 'gateway' | 'calendar' | 'webhook'
export const integrationSecrets = registerMap('integrations.secrets', new Map<string, string>())
export const secretKey = (co: string, kind: SecretKind, id: string) => `${co}|${kind}|${id}`

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** Random token (crypto) of `len` base-62 characters. */
export function randomToken(len: number): string {
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 62]
  return out
}
/** "•••• 4f2a": the only form a stored credential is ever served in. */
export const hintOf = (secret: string) => `•••• ${secret.slice(-4)}`

/* ---------------- records ---------------- */

export interface EmailConfigRecord {
  provider: EmailProviderKey | null
  paused: boolean
  connectedAs: string | null
  smtp: { host: string; port: number; security: SmtpSecurity; username: string } | null
  passwordHint: string | null
  tokenHint: string | null
  fromName: string
  fromAddress: string
  connectedAt: string | null
  connectedBy: string | null
  lastTestAt: string | null
  lastTestStatus: 'success' | 'error' | null
  lastError: string | null
  domain: string
  dns: DnsRecord[]
  senders: Record<SenderPurpose, Sender>
}

export interface WebsiteHookRecord {
  tokenHint: string
  createdAt: string
  rotatedAt: string | null
  rotatedBy: string | null
  lastReceivedAt: string | null
  received: number
  leadsCreated: number
  fieldMap: Record<string, LeadField>
  defaultSource: string
  defaultOwnerId: string | null
  paused: boolean
}

export interface WhatsAppRecord {
  connected: boolean
  paused: boolean
  phoneNumberId: string | null
  businessAccountId: string | null
  displayNumber: string | null
  verifiedName: string | null
  tokenHint: string | null
  connectedAt: string | null
  connectedBy: string | null
  lastError: string | null
}

export interface WaTemplateRecord {
  id: string
  name: string
  language: 'en' | 'ar'
  category: WaCategory
  body: string
  status: WaTemplateStatus
  rejectionReason: string | null
  submittedAt: string
  /** Mock clock ms at which the (simulated) Meta review decides. */
  decideAt: number
  decidedAt: string | null
  createdBy: string
}

export interface WaConversationRecord {
  id: string
  from: string
  name: string
  leadId: string | null
  lastMessageAt: string
  messages: { id: string; direction: 'in' | 'out'; text: string; at: string }[]
}

export interface CalendarConnectionRecord {
  id: string
  userId: string
  provider: CalendarProvider
  connectedAs: string
  tokenHint: string
  connectedAt: string
  lastSyncAt: string | null
  pushedCount: number
  pushTasks: boolean
  pushMeetings: boolean
  showBusy: boolean
}

export interface GatewayRecord {
  merchantId: string
  mode: 'test' | 'live'
  currency: string
  secretKeyHint: string
  connectedAt: string
  connectedBy: string
  lastTestAt: string | null
  lastTestStatus: 'success' | 'error' | null
}

export interface PaymentsRecord {
  defaultProvider: GatewayProvider | null
  gateways: Partial<Record<GatewayProvider, GatewayRecord>>
}

export interface ApiKeyRecord {
  id: string
  name: string
  /** First characters of the key ("apx_live_ab12"), shown with a masked tail. */
  prefix: string
  last4: string
  /** One-way hash of the key (the key itself is never stored). */
  hash: string
  scopes: Record<ApiScopeModule, ApiScope>
  createdAt: string
  createdBy: string
  lastUsedAt: string | null
  revokedAt: string | null
  revokedBy: string | null
}

export interface WebhookEndpointRecord {
  id: string
  url: string
  events: WebhookEvent[]
  active: boolean
  secretHint: string
  createdAt: string
  createdBy: string
  /** Real-time ISO instant: only records created from then on produce events (no backfill). */
  eventsFrom: string
}

export interface WebhookDeliveryRecord {
  id: string
  endpointId: string
  event: WebhookEvent | 'ping'
  /** `<event>:<record id>` — one delivery per endpoint and event key (idempotent pump). */
  eventKey: string
  payload: Record<string, unknown>
  signature: string
  status: DeliveryStatus
  attempts: number
  responseCode: number | null
  error: string | null
  createdAt: string
  lastAttemptAt: string | null
  /** Mock clock ms of the next automatic retry (status retrying). */
  nextRetryAt: number | null
}

export interface SyncLogRecord {
  id: string
  at: string
  integration: IntegrationKey
  direction: SyncDirection
  status: SyncStatus
  message: string
}

export interface EmailTestRecord {
  id: string
  at: string
  to: string
  subject: string
  status: 'sent' | 'failed'
  by: string
}

export interface OAuthStateRecord {
  id: string
  userId: string
  purpose: 'email' | 'calendar'
  provider: 'google' | 'microsoft'
  /** CalendarProvider for calendar purposes. */
  calendarProvider: CalendarProvider | null
  account: string
  expiresAt: number
}

/* ---------------- seed ---------------- */

const NOW = Date.now()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const H = 3_600_000
const D = 24 * H
const SEED_AT = new Date(NOW).toISOString()

const secrets: [string, string][] = []
const seedSecret = (co: string, kind: SecretKind, id: string, prefix: string) => {
  const value = `${prefix}${randomToken(28)}`
  secrets.push([secretKey(co, kind, id), value])
  return hintOf(value)
}

function dns(domain: string, states: [DnsRecord['status'], DnsRecord['status'], DnsRecord['status']], checkedAt: string | null): DnsRecord[] {
  const [spf, dkim, dmarc] = states
  const msg = (s: DnsRecord['status']) => (s === 'verified' ? null : s === 'pending' ? 'Not found yet. DNS changes can take up to 48 hours.' : 'The record was found but its value doesn’t match.')
  return [
    { kind: 'spf', type: 'TXT', host: domain, value: 'v=spf1 include:_spf.apexcrm.app ~all', status: spf, checkedAt, message: msg(spf) },
    { kind: 'dkim', type: 'CNAME', host: `apexcrm._domainkey.${domain}`, value: 'dkim.apexcrm.app', status: dkim, checkedAt, message: msg(dkim) },
    { kind: 'dmarc', type: 'TXT', host: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, status: dmarc, checkedAt, message: msg(dmarc) },
  ]
}

const DEFAULT_MAP: Record<string, LeadField> = { company: 'company', name: 'contactName', email: 'email', phone: 'mobile', message: 'note' }

function defaultEmail(): EmailConfigRecord {
  return {
    provider: null, paused: false, connectedAs: null, smtp: null, passwordHint: null, tokenHint: null, fromName: '', fromAddress: '',
    connectedAt: null, connectedBy: null, lastTestAt: null, lastTestStatus: null, lastError: null, domain: '', dns: [],
    senders: { sales: { name: '', address: '' }, invoices: { name: '', address: '' }, hr: { name: '', address: '' } },
  }
}

const SEED_EMAIL: Record<string, EmailConfigRecord> = {
  [APEX_ID]: {
    ...defaultEmail(),
    provider: 'google', connectedAs: 'sales@apexaora.ae', tokenHint: seedSecret(APEX_ID, 'oauth-email', 'token', 'ya29.'),
    fromName: 'Apex Aora', fromAddress: 'sales@apexaora.ae', connectedAt: ago(40 * D), connectedBy: 'Omar Haddad',
    lastTestAt: ago(2 * D), lastTestStatus: 'success', domain: 'apexaora.ae', dns: dns('apexaora.ae', ['verified', 'verified', 'verified'], ago(39 * D)),
    senders: { sales: { name: 'Apex Aora Sales', address: 'sales@apexaora.ae' }, invoices: { name: 'Apex Aora Accounts', address: 'accounts@apexaora.ae' }, hr: { name: 'Apex Aora HR', address: 'hr@apexaora.ae' } },
  },
  [CREST_ID]: {
    ...defaultEmail(),
    provider: 'microsoft', connectedAs: 'info@crestlogistics.sa', tokenHint: seedSecret(CREST_ID, 'oauth-email', 'token', 'EwB0A8l6'),
    fromName: 'Crest Logistics', fromAddress: 'info@crestlogistics.sa', connectedAt: ago(20 * D), connectedBy: 'Faisal Al Harbi',
    lastTestAt: ago(1 * D), lastTestStatus: 'error', lastError: 'The mailbox rejected the message: sending quota exceeded (simulated).',
    domain: 'crestlogistics.sa', dns: dns('crestlogistics.sa', ['verified', 'pending', 'failed'], ago(3 * D)),
    senders: { sales: { name: 'Crest Sales', address: 'sales@crestlogistics.sa' }, invoices: { name: 'Crest Billing', address: 'billing@crestlogistics.sa' }, hr: { name: '', address: '' } },
  },
}
export const emailConfigs = perTenant<EmailConfigRecord>((co) => structuredClone(SEED_EMAIL[co] ?? defaultEmail()), 'integrations.email')

/** The website webhook (third-party forms) of a company; its token is created with the record. */
const SEED_WEBSITE: Record<string, WebsiteHookRecord> = {
  [APEX_ID]: { tokenHint: seedSecret(APEX_ID, 'website', 'token', 'whk_'), createdAt: ago(60 * D), rotatedAt: null, rotatedBy: null, lastReceivedAt: ago(26 * H), received: 14, leadsCreated: 11, fieldMap: { ...DEFAULT_MAP, company_size: 'note' }, defaultSource: 'Website', defaultOwnerId: 'u4', paused: false },
  [CREST_ID]: { tokenHint: seedSecret(CREST_ID, 'website', 'token', 'whk_'), createdAt: ago(20 * D), rotatedAt: null, rotatedBy: null, lastReceivedAt: null, received: 0, leadsCreated: 0, fieldMap: { ...DEFAULT_MAP }, defaultSource: 'Website', defaultOwnerId: null, paused: false },
}
export const websiteHooks = perTenant<WebsiteHookRecord>((co) => {
  const seeded = SEED_WEBSITE[co]
  if (seeded) return structuredClone(seeded)
  // A new company: its endpoint token is created on first use.
  const token = `whk_${randomToken(28)}`
  integrationSecrets.set(secretKey(co, 'website', 'token'), token)
  return { tokenHint: hintOf(token), createdAt: new Date().toISOString(), rotatedAt: null, rotatedBy: null, lastReceivedAt: null, received: 0, leadsCreated: 0, fieldMap: { ...DEFAULT_MAP }, defaultSource: 'Website', defaultOwnerId: null, paused: false }
}, 'integrations.website')

const NO_WA: WhatsAppRecord = { connected: false, paused: false, phoneNumberId: null, businessAccountId: null, displayNumber: null, verifiedName: null, tokenHint: null, connectedAt: null, connectedBy: null, lastError: null }
const SEED_WA: Record<string, WhatsAppRecord> = {
  [APEX_ID]: { connected: true, paused: false, phoneNumberId: '109876543210987', businessAccountId: '203948576120394', displayNumber: '+971 4 555 0142', verifiedName: 'Apex Aora', tokenHint: seedSecret(APEX_ID, 'whatsapp', 'token', 'EAAG'), connectedAt: ago(30 * D), connectedBy: 'Omar Haddad', lastError: null },
}
export const whatsappConfigs = perTenant<WhatsAppRecord>((co) => structuredClone(SEED_WA[co] ?? NO_WA), 'integrations.whatsapp')

export const waTemplates = registerArray<Tenant<WaTemplateRecord>>('integrations.waTemplates', [
  { companyId: APEX_ID, id: 'WAT-101', name: 'meeting_reminder', language: 'en', category: 'utility', body: 'Hi {{1}}, a reminder of our meeting on {{2}}. Reply YES to confirm or call us to reschedule.', status: 'approved', rejectionReason: null, submittedAt: ago(28 * D), decideAt: 0, decidedAt: ago(28 * D), createdBy: 'Omar Haddad' },
  { companyId: APEX_ID, id: 'WAT-102', name: 'proposal_follow_up', language: 'en', category: 'marketing', body: 'Hello {{1}}, did you get a chance to review the proposal we sent for {{2}}? Happy to walk you through it.', status: 'approved', rejectionReason: null, submittedAt: ago(27 * D), decideAt: 0, decidedAt: ago(27 * D), createdBy: 'Omar Haddad' },
  { companyId: APEX_ID, id: 'WAT-103', name: 'welcome_ar', language: 'ar', category: 'utility', body: 'مرحباً {{1}}، شكراً لتواصلك مع أبكس أورا. سيتواصل معك فريقنا قريباً.', status: 'approved', rejectionReason: null, submittedAt: ago(20 * D), decideAt: 0, decidedAt: ago(20 * D), createdBy: 'Sara Khoury' },
  { companyId: APEX_ID, id: 'WAT-104', name: 'year_end_offer', language: 'en', category: 'marketing', body: 'Big savings! Get 50% off all services this month only, click http://bit.ly/apex-offer now!!!', status: 'rejected', rejectionReason: 'Shortened links and promotional content need an opt-out line (simulated review).', submittedAt: ago(5 * D), decideAt: 0, decidedAt: ago(5 * D), createdBy: 'Sara Khoury' },
])

export const waConversations = registerArray<Tenant<WaConversationRecord>>('integrations.waConversations', [
  {
    companyId: APEX_ID, id: 'WAC-101', from: '+971559871234', name: 'Unknown sender', leadId: null, lastMessageAt: ago(3 * H),
    messages: [
      { id: 'WAM-101', direction: 'in', text: 'Hi, I saw your website. Do you build mobile apps for clinics?', at: ago(3 * H) },
    ],
  },
  {
    companyId: APEX_ID, id: 'WAC-102', from: '+971504448812', name: 'Reem (website chat)', leadId: null, lastMessageAt: ago(28 * H),
    messages: [
      { id: 'WAM-102', direction: 'in', text: 'Can you send me your pricing for SEO packages?', at: ago(30 * H) },
      { id: 'WAM-103', direction: 'out', text: 'Hello Reem, thanks for reaching out! A colleague will share the packages today.', at: ago(28 * H) },
    ],
  },
])

export const calendarConnections = registerArray<Tenant<CalendarConnectionRecord>>('integrations.calendar', [
  { companyId: APEX_ID, id: 'CAL-101', userId: 'u3', provider: 'google', connectedAs: 'karim@apexaora.ae', tokenHint: seedSecret(APEX_ID, 'calendar', 'u3', 'ya29.'), connectedAt: ago(15 * D), lastSyncAt: ago(2 * H), pushedCount: 9, pushTasks: true, pushMeetings: true, showBusy: true },
  { companyId: APEX_ID, id: 'CAL-102', userId: 'u4', provider: 'outlook', connectedAs: 'bincy@apexaora.ae', tokenHint: seedSecret(APEX_ID, 'calendar', 'u4', 'EwB0A8l6'), connectedAt: ago(9 * D), lastSyncAt: ago(5 * H), pushedCount: 4, pushTasks: true, pushMeetings: false, showBusy: true },
])

const SEED_PAYMENTS: Record<string, PaymentsRecord> = {
  [APEX_ID]: { defaultProvider: 'telr', gateways: { telr: { merchantId: '27451', mode: 'test', currency: 'AED', secretKeyHint: seedSecret(APEX_ID, 'gateway', 'telr', 'telr_sk_'), connectedAt: ago(35 * D), connectedBy: 'Omar Haddad', lastTestAt: ago(35 * D), lastTestStatus: 'success' } } },
  [CREST_ID]: { defaultProvider: 'tap', gateways: { tap: { merchantId: '8812034', mode: 'test', currency: 'SAR', secretKeyHint: seedSecret(CREST_ID, 'gateway', 'tap', 'sk_test_'), connectedAt: ago(12 * D), connectedBy: 'Faisal Al Harbi', lastTestAt: ago(12 * D), lastTestStatus: 'success' } } },
}
export const paymentConfigs = perTenant<PaymentsRecord>((co) => structuredClone(SEED_PAYMENTS[co] ?? { defaultProvider: null, gateways: {} }), 'integrations.payments')

const NONE: Record<ApiScopeModule, ApiScope> = { leads: 'none', customers: 'none', tasks: 'none', invoices: 'none', employees: 'none' }
export const noScopes = () => ({ ...NONE })

/** FNV-1a (two seeds, 16 hex): the mock's one-way hash of an API key (the backend uses SHA-256). */
export function keyHash(key: string): string {
  const h = (seed: number) => {
    let x = seed
    for (let i = 0; i < key.length; i++) x = Math.imul(x ^ key.charCodeAt(i), 16777619) >>> 0
    return x.toString(16).padStart(8, '0')
  }
  return `${h(2166136261)}${h(0x811c9dc5 ^ 0x5bd1e995)}`
}
const SEED_API_KEY = `apx_live_${randomToken(32)}`
export const apiKeys = registerArray<Tenant<ApiKeyRecord>>('integrations.apiKeys', [
  { companyId: APEX_ID, id: 'AK-101', name: 'Website CMS', prefix: SEED_API_KEY.slice(0, 13), last4: SEED_API_KEY.slice(-4), hash: keyHash(SEED_API_KEY), scopes: { ...NONE, leads: 'write' }, createdAt: ago(45 * D), createdBy: 'Omar Haddad', lastUsedAt: ago(3 * H), revokedAt: null, revokedBy: null },
])

export const webhookEndpoints = registerArray<Tenant<WebhookEndpointRecord>>('integrations.webhooks', [
  { companyId: APEX_ID, id: 'WH-101', url: 'https://hooks.apexaora.ae/crm-events', events: ['lead.created', 'deal.won', 'invoice.issued'], active: true, secretHint: seedSecret(APEX_ID, 'webhook', 'WH-101', 'whsec_'), createdAt: ago(25 * D), createdBy: 'Omar Haddad', eventsFrom: SEED_AT },
])

const delivery = (id: string, event: WebhookEvent, ref: string, at: number, status: DeliveryStatus, extra: Partial<WebhookDeliveryRecord> = {}): Tenant<WebhookDeliveryRecord> => ({
  companyId: APEX_ID,
  id,
  endpointId: 'WH-101',
  event,
  eventKey: `${event}:${ref}`,
  payload: { event, id: ref, created_at: ago(at) },
  signature: `t=${Math.floor((NOW - at) / 1000)},v1=${keyHash(`${id}${ref}`)}`,
  status,
  attempts: 1,
  responseCode: 200,
  error: null,
  createdAt: ago(at),
  lastAttemptAt: ago(at),
  nextRetryAt: null,
  ...extra,
})
export const webhookDeliveries = registerArray<Tenant<WebhookDeliveryRecord>>('integrations.deliveries', [
  delivery('WD-101', 'lead.created', 'L-seed-1', 6 * D, 'success'),
  delivery('WD-102', 'invoice.issued', 'INV-seed-1', 4 * D, 'success'),
  delivery('WD-103', 'deal.won', 'LSH-seed-1', 2 * D, 'failed', { attempts: 3, responseCode: 503, error: 'HTTP 503 Service Unavailable from the receiver (3 attempts).', lastAttemptAt: ago(2 * D - 7 * 60_000) }),
  delivery('WD-104', 'lead.created', 'L-seed-2', 20 * H, 'success'),
])

export const syncLog = registerArray<Tenant<SyncLogRecord>>('integrations.syncLog', [
  { companyId: APEX_ID, id: 'SL-101', at: ago(40 * D), integration: 'email', direction: 'internal', status: 'success', message: 'Connected Google Workspace as sales@apexaora.ae.' },
  { companyId: APEX_ID, id: 'SL-102', at: ago(35 * D), integration: 'payments', direction: 'outbound', status: 'success', message: 'Telr test transaction approved (AED 1.00, test mode).' },
  { companyId: APEX_ID, id: 'SL-103', at: ago(30 * D), integration: 'whatsapp', direction: 'internal', status: 'success', message: 'Connected WhatsApp Business number +971 4 555 0142.' },
  { companyId: APEX_ID, id: 'SL-104', at: ago(5 * D), integration: 'whatsapp', direction: 'inbound', status: 'warning', message: 'Template “year_end_offer” was rejected by the WhatsApp review.' },
  { companyId: APEX_ID, id: 'SL-105', at: ago(2 * D - 7 * 60_000), integration: 'webhooks', direction: 'outbound', status: 'error', message: 'Delivery WD-103 (deal.won) to https://hooks.apexaora.ae/crm-events failed after 3 attempts: HTTP 503.' },
  { companyId: APEX_ID, id: 'SL-106', at: ago(2 * D), integration: 'email', direction: 'outbound', status: 'success', message: 'Test email sent to omar@apexaora.ae.' },
  { companyId: APEX_ID, id: 'SL-107', at: ago(26 * H), integration: 'website', direction: 'inbound', status: 'success', message: 'Website webhook created lead from “Contact us” (WordPress).' },
  { companyId: APEX_ID, id: 'SL-108', at: ago(2 * H), integration: 'calendar', direction: 'outbound', status: 'success', message: 'Karim Nasser: 3 tasks pushed to Google Calendar.' },
  { companyId: CREST_ID, id: 'SL-501', at: ago(20 * D), integration: 'email', direction: 'internal', status: 'success', message: 'Connected Microsoft 365 as info@crestlogistics.sa.' },
  { companyId: CREST_ID, id: 'SL-502', at: ago(12 * D), integration: 'payments', direction: 'outbound', status: 'success', message: 'Tap Payments test transaction approved (SAR 1.00, test mode).' },
  { companyId: CREST_ID, id: 'SL-503', at: ago(3 * D), integration: 'email', direction: 'internal', status: 'warning', message: 'Domain check for crestlogistics.sa: DKIM pending, DMARC value doesn’t match.' },
  { companyId: CREST_ID, id: 'SL-504', at: ago(1 * D), integration: 'email', direction: 'outbound', status: 'error', message: 'Test email to faisal@crestlogistics.sa failed: sending quota exceeded (simulated).' },
])

export const emailTestLog = registerArray<Tenant<EmailTestRecord>>('integrations.emailTests', [
  { companyId: APEX_ID, id: 'ET-101', at: ago(2 * D), to: 'omar@apexaora.ae', subject: 'Test email from Apex CRM', status: 'sent', by: 'Omar Haddad' },
  { companyId: CREST_ID, id: 'ET-501', at: ago(1 * D), to: 'faisal@crestlogistics.sa', subject: 'Test email from Apex CRM', status: 'failed', by: 'Faisal Al Harbi' },
])

export const oauthStates = registerArray<Tenant<OAuthStateRecord>>('integrations.oauthStates', [])

/** Once-only failure notifications: `<companyId>|<integration>|<company day>` already notified. */
export const notifiedFailures = registerSet('integrations.notified', new Set<string>([`${CREST_ID}|email|seeded`, `${APEX_ID}|webhooks|seeded`]))

for (const [k, v] of secrets) integrationSecrets.set(k, v)

/** The seeded mailboxes count as the onboarding "Connect email" step (services/onboarding.ts). */
emailConnections.set(APEX_ID, { provider: 'google', address: 'sales@apexaora.ae', connectedAt: ago(40 * D), connectedBy: 'Omar Haddad' })
emailConnections.set(CREST_ID, { provider: 'microsoft', address: 'info@crestlogistics.sa', connectedAt: ago(20 * D), connectedBy: 'Faisal Al Harbi' })

let seq = 1000
registerValue('integrations.seq', () => seq, (v) => { seq = Number(v) || 1000 })
export const nextIntegrationId = (prefix: string) => `${prefix}-${++seq}`

/** For status cards: the paused flag per company of the keys stored outside their own record (webhooks). */
export const pausedKeys = registerSet('integrations.paused', new Set<string>())
export type { IntegrationStatus }
