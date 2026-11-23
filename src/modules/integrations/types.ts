/**
 * Insights & admin › Integrations (docs/API.md › Integrations). UI shapes; the wire is plain snake_case
 * (src/shared/api/integrationsMappers.ts). Credentials (SMTP password, API keys, access tokens, webhook signing
 * secrets, gateway keys, OAuth tokens) are WRITE-ONLY: inputs carry them, no response ever does — views carry a
 * masked hint ("•••• 4f2a") or "connected as x@y" instead.
 */

export type IntegrationStatus = 'not_connected' | 'connected' | 'error' | 'paused'
export type IntegrationKey = 'email' | 'website' | 'whatsapp' | 'calendar' | 'payments' | 'ads' | 'api' | 'webhooks'
export type IntegrationGroup = 'communication' | 'website' | 'calendar' | 'payments' | 'advertising' | 'developer'

export const INTEGRATION_GROUPS: { key: IntegrationGroup; label: string }[] = [
  { key: 'communication', label: 'Communication' },
  { key: 'website', label: 'Website & leads' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'payments', label: 'Payments' },
  { key: 'advertising', label: 'Advertising' },
  { key: 'developer', label: 'Developer' },
]

export const INTEGRATION_LABEL: Record<IntegrationKey, string> = {
  email: 'Email sending',
  website: 'Website & forms',
  whatsapp: 'WhatsApp Business',
  calendar: 'Calendar sync',
  payments: 'Payment gateways',
  ads: 'Ad platforms',
  api: 'API keys',
  webhooks: 'Outgoing webhooks',
}

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  error: 'Error',
  paused: 'Paused',
}

/** Keys that can be paused / resumed from their card (PATCH /integrations/state/:key). */
export const PAUSABLE: IntegrationKey[] = ['email', 'website', 'whatsapp', 'webhooks']

/** GET /integrations — one card per connector. */
export interface IntegrationCard {
  key: IntegrationKey
  group: IntegrationGroup
  name: string
  status: IntegrationStatus
  /** One line: "Connected as sales@apexaora.ae", "4 templates, 3 approved", "2 users connected"… */
  summary: string
  lastSyncAt: string | null
  /** Open problems (failed test, failing deliveries…). */
  problem: string | null
}

export interface IntegrationsOverview {
  cards: IntegrationCard[]
  /** The caller may change company integrations (settings full). */
  canEdit: boolean
  /** Sync log errors in the last 7 days. */
  recentErrors: number
}

/* ---------------- OAuth (mock) ---------------- */

export type OAuthPurpose = 'email' | 'calendar'
export type OAuthProvider = 'google' | 'microsoft'
export const OAUTH_PROVIDER_LABEL: Record<OAuthProvider, string> = { google: 'Google Workspace', microsoft: 'Microsoft 365' }

/** POST /integrations/oauth/start — what the consent screen shows. `state` is a one-time nonce (not a credential). */
export interface OAuthConsent {
  state: string
  provider: OAuthProvider
  purpose: OAuthPurpose
  /** The account the (simulated) provider login offers, e.g. sales@apexaora.ae. */
  account: string
  scopes: string[]
  expiresAt: string
}

export interface OAuthCompleteInput {
  state: string
  approve: boolean
}

/* ---------------- Email ---------------- */

export type EmailProviderKey = 'smtp' | 'google' | 'microsoft'
export const EMAIL_PROVIDER_LABEL: Record<EmailProviderKey, string> = { smtp: 'SMTP server', google: 'Google Workspace', microsoft: 'Microsoft 365' }
export type SmtpSecurity = 'ssl' | 'starttls' | 'none'
export type SenderPurpose = 'sales' | 'invoices' | 'hr'
export const SENDER_PURPOSES: { key: SenderPurpose; label: string }[] = [
  { key: 'sales', label: 'Sales & marketing' },
  { key: 'invoices', label: 'Invoices & statements' },
  { key: 'hr', label: 'HR letters' },
]

export interface DnsRecord {
  kind: 'spf' | 'dkim' | 'dmarc'
  type: 'TXT' | 'CNAME'
  host: string
  value: string
  status: 'pending' | 'verified' | 'failed'
  checkedAt: string | null
  message: string | null
}

export interface Sender {
  name: string
  address: string
}

export interface EmailIntegration {
  status: IntegrationStatus
  provider: EmailProviderKey | null
  connectedAs: string | null
  smtp: { host: string; port: number; security: SmtpSecurity; username: string } | null
  /** "•••• word" of the stored SMTP password (never the password). */
  passwordHint: string | null
  /** "•••• 4f2a" of the stored OAuth token (Google / Microsoft). */
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

export interface SmtpInput {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  /** Write-only. Omit (or leave empty) to keep the stored password. */
  password?: string
  fromName: string
  fromAddress: string
}

export type EmailLogSource = 'invoice' | 'statement' | 'reminder' | 'bulk' | 'test'
export const EMAIL_LOG_SOURCE_LABEL: Record<EmailLogSource, string> = {
  invoice: 'Invoice',
  statement: 'Statement',
  reminder: 'Payment reminder',
  bulk: 'Bulk email',
  test: 'Test email',
}
export interface EmailLogRow {
  id: string
  at: string
  source: EmailLogSource
  to: string
  subject: string
  status: 'sent' | 'failed' | 'skipped' | 'queued'
  /** Bulk emails: one row per campaign with counts. */
  detail: string | null
  /** In-app link of the source document. */
  link: string | null
}

/* ---------------- Website & forms ---------------- */

export type LeadField = 'company' | 'contactName' | 'email' | 'mobile' | 'industry' | 'sourceDetail' | 'website' | 'value' | 'note'
export const LEAD_FIELD_LABEL: Record<LeadField, string> = {
  company: 'Company name',
  contactName: 'Contact name',
  email: 'Email',
  mobile: 'Mobile',
  industry: 'Industry',
  sourceDetail: 'Source detail',
  website: 'Website',
  value: 'Deal value',
  note: 'Note',
}
export const LEAD_FIELDS = Object.keys(LEAD_FIELD_LABEL) as LeadField[]

export interface WebsiteForm {
  id: string
  name: string
  publicKey: string
  status: string
  submissions: number
}

export interface InboundWebhook {
  /** Full endpoint path with the company token — Company Admins only; others get it masked. */
  url: string
  tokenHint: string
  /** True when `url` carries the full token (the caller may manage integrations). */
  revealed: boolean
  createdAt: string
  rotatedAt: string | null
  rotatedBy: string | null
  lastReceivedAt: string | null
  received: number
  leadsCreated: number
  /** External field name → lead field. */
  fieldMap: Record<string, LeadField>
  defaultSource: string
  defaultOwnerId: string | null
  paused: boolean
}

export interface WebsiteIntegration {
  /** Lead Generation (Marketing) is in the plan: its forms are listed. */
  marketingInPlan: boolean
  forms: WebsiteForm[]
  webhook: InboundWebhook
}

export interface InboundWebhookInput {
  fieldMap?: Record<string, LeadField>
  defaultSource?: string
  defaultOwnerId?: string | null
}

export interface MappingPreview {
  lead: Partial<Record<LeadField, string>>
  unmapped: string[]
  problems: string[]
}

/* ---------------- WhatsApp ---------------- */

export type WaTemplateStatus = 'pending' | 'approved' | 'rejected'
export type WaCategory = 'marketing' | 'utility' | 'authentication'

export interface WaTemplate {
  id: string
  name: string
  language: 'en' | 'ar'
  category: WaCategory
  body: string
  /** Number of {{n}} parameters in the body. */
  params: number
  status: WaTemplateStatus
  rejectionReason: string | null
  submittedAt: string
  decidedAt: string | null
}

export interface WaTemplateInput {
  name: string
  language: 'en' | 'ar'
  category: WaCategory
  body: string
}

export interface WhatsAppIntegration {
  status: IntegrationStatus
  phoneNumberId: string | null
  businessAccountId: string | null
  displayNumber: string | null
  verifiedName: string | null
  tokenHint: string | null
  connectedAt: string | null
  connectedBy: string | null
  lastError: string | null
  templates: WaTemplate[]
}

export interface WhatsAppConnectInput {
  phoneNumberId: string
  businessAccountId: string
  /** Write-only. */
  accessToken?: string
}

/** GET /integrations/whatsapp/send-options — for anyone who can contact leads. */
export interface WaSendOptions {
  connected: boolean
  displayNumber: string | null
  templates: Pick<WaTemplate, 'id' | 'name' | 'language' | 'body' | 'params'>[]
}

export interface WaSendInput {
  leadId: string
  templateId: string
  to: string
  params: string[]
}

export interface WaSendResult {
  text: string
  activityId: string
}

export interface WaMessage {
  id: string
  direction: 'in' | 'out'
  text: string
  at: string
}

export interface WaConversation {
  id: string
  from: string
  name: string
  leadId: string | null
  leadCompany: string | null
  lastMessageAt: string
  messages: WaMessage[]
}

/* ---------------- Calendar (per user) ---------------- */

export type CalendarProvider = 'google' | 'outlook'
export const CALENDAR_PROVIDER_LABEL: Record<CalendarProvider, string> = { google: 'Google Calendar', outlook: 'Outlook calendar' }

export interface CalendarSettings {
  pushTasks: boolean
  pushMeetings: boolean
  showBusy: boolean
}

export interface BusyBlock {
  start: string
  end: string
}

export interface MyCalendar {
  status: IntegrationStatus
  provider: CalendarProvider | null
  connectedAs: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  pushedCount: number
  settings: CalendarSettings
  /** Busy times from the connected calendar for the next 7 days (when showBusy). */
  busy: BusyBlock[]
}

export interface CalendarConnectionRow {
  userId: string
  userName: string
  role: string
  provider: CalendarProvider
  connectedAs: string
  connectedAt: string
  lastSyncAt: string | null
}

/* ---------------- Payments ---------------- */

export type GatewayProvider = 'telr' | 'tap' | 'paytabs' | 'stripe'
export const GATEWAY_PROVIDERS: GatewayProvider[] = ['telr', 'tap', 'paytabs', 'stripe']
export const GATEWAY_LABEL: Record<GatewayProvider, string> = { telr: 'Telr', tap: 'Tap Payments', paytabs: 'PayTabs', stripe: 'Stripe' }

export interface Gateway {
  provider: GatewayProvider
  status: IntegrationStatus
  merchantId: string | null
  mode: 'test' | 'live'
  currency: string | null
  /** "•••• 9f1c" of the stored secret key. */
  secretKeyHint: string | null
  isDefault: boolean
  /** Where the provider posts payment notifications (path; the backend verifies the signature). */
  webhookUrl: string
  connectedAt: string | null
  lastTestAt: string | null
  lastTestStatus: 'success' | 'error' | null
}

export interface PaymentsIntegration {
  gateways: Gateway[]
  defaultProvider: GatewayProvider | null
}

export interface GatewayInput {
  merchantId: string
  /** Write-only. Omit to keep the stored key. */
  secretKey?: string
  mode: 'test' | 'live'
  currency: string
}

/* ---------------- Developer ---------------- */

export type ApiScopeModule = 'leads' | 'customers' | 'tasks' | 'invoices' | 'employees'
export const API_SCOPE_MODULES: { key: ApiScopeModule; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'customers', label: 'Customers' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'employees', label: 'Employees' },
]
export type ApiScope = 'none' | 'read' | 'write'

export interface ApiKey {
  id: string
  name: string
  /** "apx_live_ab12…" + masked tail. */
  masked: string
  scopes: Record<ApiScopeModule, ApiScope>
  createdAt: string
  createdBy: string
  lastUsedAt: string | null
  revokedAt: string | null
  status: 'active' | 'revoked'
}

/** POST /integrations/api-keys — the only response that carries the key (`secret`), once. */
export interface CreatedApiKey {
  key: ApiKey
  secret: string
}

export interface ApiKeyInput {
  name: string
  scopes: Partial<Record<ApiScopeModule, ApiScope>>
}

export type WebhookEvent = 'lead.created' | 'lead.status_changed' | 'deal.won' | 'invoice.issued' | 'payment.received' | 'employee.created'
export const WEBHOOK_EVENTS: { key: WebhookEvent; label: string }[] = [
  { key: 'lead.created', label: 'Lead created' },
  { key: 'lead.status_changed', label: 'Lead status changed' },
  { key: 'deal.won', label: 'Deal won' },
  { key: 'invoice.issued', label: 'Invoice issued' },
  { key: 'payment.received', label: 'Payment received' },
  { key: 'employee.created', label: 'Employee created' },
]

export interface WebhookEndpoint {
  id: string
  url: string
  events: WebhookEvent[]
  active: boolean
  secretHint: string
  createdAt: string
  createdBy: string
  lastDeliveryAt: string | null
  failing: number
}

export interface WebhookInput {
  url?: string
  events?: WebhookEvent[]
  active?: boolean
  /** Write-only signing secret (at least 16 characters). Required on create, optional on update. */
  secret?: string
}

export type DeliveryStatus = 'success' | 'retrying' | 'failed'
export interface WebhookDelivery {
  id: string
  endpointId: string
  event: WebhookEvent | 'ping'
  status: DeliveryStatus
  attempts: number
  responseCode: number | null
  error: string | null
  /** `t=<unix>,v1=<hmac>` header the receiver verifies with its secret. */
  signature: string
  payload: Record<string, unknown>
  createdAt: string
  lastAttemptAt: string | null
  nextRetryAt: string | null
}

/* ---------------- Sync log ---------------- */

export type SyncDirection = 'inbound' | 'outbound' | 'internal'
export type SyncStatus = 'success' | 'warning' | 'error'

export interface SyncLogRow {
  id: string
  at: string
  integration: IntegrationKey
  direction: SyncDirection
  status: SyncStatus
  message: string
}

export interface SyncLogFilters {
  integration?: IntegrationKey | ''
  status?: SyncStatus | ''
  direction?: SyncDirection | ''
}
