import type { User } from '@/shared/types'
import type { IntegrationKey, OAuthConsent, OAuthProvider, OAuthPurpose, SyncDirection, SyncStatus, CalendarProvider } from '@/modules/integrations/types'
import { can } from '@/shared/lib/permissions'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { ApiError } from '@/shared/lib/apiError'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { users } from '@/shared/mocks/db'
import { activeMembershipOf, companyById } from '@/shared/mocks/data/tenancy'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { nextIntegrationId, notifiedFailures, oauthStates, randomToken, syncLog, type OAuthStateRecord } from '@/shared/mocks/data/integrations'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { companyModules } from './billing'

/**
 * Shared rules of Insights & admin › Integrations (docs/API.md › Integrations).
 *
 * WHO (PERMISSION_MATRIX `settings` column): full (Company Admin) configures; view (Management) reads status, logs and
 * masked settings; hidden → 403. Exceptions by design: the per-user calendar connection (every role, own row only) and
 * WhatsApp template sends / conversations (roles that can contact leads, `sales` edit / view). Plan gate: every
 * /integrations/* path → plan module `integrations` (central, billing MODULE_PATHS).
 */

export function bad(message: string, code = 'validation_failed', details: Record<string, unknown> = {}): never {
  throw new CodedApiError(message, 422, code, details)
}
export function conflict(message: string, code: string): never {
  throw new CodedApiError(message, 409, code)
}
export function notFound(): never {
  throw new ApiError(NOT_FOUND, 404)
}
export function forbidden(message: string): never {
  throw new CodedApiError(message, 403, 'forbidden')
}

const roleOf = (user: User) => activeMembershipOf(user.id)?.role ?? user.role

/** Settings view (Company Admin, Management). */
export function viewCtx(user: User): string {
  if (!can(roleOf(user), 'settings', 'view')) forbidden('Integrations are managed by your company administrators.')
  return tenantOf(user)
}
/** Settings full (Company Admin). */
export function editCtx(user: User): string {
  const co = viewCtx(user)
  if (!can(roleOf(user), 'settings', 'edit')) forbidden('Only a Company Admin can change integrations.')
  return co
}
export const canEditIntegrations = (user: User) => can(roleOf(user), 'settings', 'edit')
export const canViewIntegrations = (user: User) => can(roleOf(user), 'settings', 'view')

export const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function hasModule(co: string, module: 'marketing' | 'accounting' | 'hr' | 'integrations'): boolean {
  return (companyModules(co) as string[]).includes(module)
}

export function timezoneOf(co: string): string {
  return companyById(co)?.regional.timezone ?? DEFAULT_REGION.timezone
}
/** The company's calendar day on the mock clock. */
export const companyDay = (co: string) => todayIsoIn(timezoneOf(co), new Date(nowMs()))

/** The company's email domain: the branding sender's domain, else the first Company Admin's. */
export function companyDomain(co: string): string {
  const sender = companyById(co)?.branding?.emailSenderAddress ?? ''
  const fromSender = sender.split('@')[1]
  if (fromSender) return fromSender.toLowerCase()
  const admin = users.find((u) => u.companyId === co && u.role === 'Company Admin')
  return (admin?.email.split('@')[1] ?? 'example.com').toLowerCase()
}

export const companyAdmins = (co: string) => users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Company Admin')

/* ---------------- sync log + once-only failure notifications ---------------- */

/**
 * Appends a sync-log line. An `error` raises ONE stored notification to the company's Company Admins per integration
 * and company day (key `<co>|<integration>|<day>` in `integrations.notified`); later failures of the same integration
 * that day only log.
 */
export function addSync(co: string, integration: IntegrationKey, direction: SyncDirection, status: SyncStatus, message: string, at = nowIso()): Tenant<{ id: string }> {
  const row = { companyId: co, id: nextIntegrationId('SL'), at, integration, direction, status, message: message.slice(0, 500) }
  syncLog.unshift(row)
  if (status === 'error') notifyFailure(co, integration, message, at)
  return row
}

const LABEL: Record<IntegrationKey, string> = {
  email: 'Email sending', website: 'Website webhook', whatsapp: 'WhatsApp', calendar: 'Calendar sync', payments: 'Payments', ads: 'Ad platforms', api: 'API keys', webhooks: 'Outgoing webhooks',
}

export function notifyFailure(co: string, integration: IntegrationKey, message: string, at = nowIso()): boolean {
  const key = `${co}|${integration}|${companyDay(co)}`
  if (notifiedFailures.has(key)) return false
  notifiedFailures.add(key)
  for (const admin of companyAdmins(co)) {
    pushNotification({ companyId: co, userId: admin.id, type: 'integrations', title: `${LABEL[integration]}: a sync failed`, body: message.slice(0, 240), link: '/integrations?tab=sync-log', at })
  }
  return true
}

/* ---------------- mock OAuth ---------------- */

const OAUTH_TTL_MS = 10 * 60_000
const SCOPES: Record<OAuthPurpose, Record<OAuthProvider, string[]>> = {
  email: { google: ['https://mail.google.com/ (send email as you)', 'userinfo.email'], microsoft: ['Mail.Send', 'offline_access', 'User.Read'] },
  calendar: { google: ['calendar.events', 'calendar.freebusy'], microsoft: ['Calendars.ReadWrite', 'offline_access'] },
}

/**
 * POST /integrations/oauth/start { purpose, provider } — the simulated provider consent screen. Email: Company Admin,
 * the account offered is an address of the company's domain (the caller's own when it's on that domain); calendar:
 * any signed-in user, their own address. The returned `state` is a one-time nonce bound to the caller and company,
 * valid 10 minutes. A real backend redirects to the provider instead (docs/API.md › Integrations › OAuth).
 */
export function startOAuth(user: User, input: unknown): OAuthConsent {
  const b = isObj(input) ? input : {}
  const purpose = b.purpose === 'email' || b.purpose === 'calendar' ? b.purpose : bad('Pick what to connect: email or calendar.')
  const co = purpose === 'email' ? editCtx(user) : tenantOf(user)
  const raw = b.provider
  let provider: OAuthProvider
  let calendarProvider: CalendarProvider | null = null
  if (purpose === 'calendar') {
    calendarProvider = raw === 'google' || raw === 'outlook' ? raw : bad('Pick Google or Outlook.')
    provider = calendarProvider === 'google' ? 'google' : 'microsoft'
  } else {
    provider = raw === 'google' || raw === 'microsoft' ? raw : bad('Pick Google Workspace or Microsoft 365.')
  }
  const domain = companyDomain(co)
  const own = user.email.toLowerCase()
  const account = purpose === 'calendar' || own.endsWith(`@${domain}`) ? own : `admin@${domain}`
  // One pending consent per user and purpose.
  for (let i = oauthStates.length - 1; i >= 0; i--) {
    const s = oauthStates[i]
    if (s.companyId === co && s.userId === user.id && s.purpose === purpose) oauthStates.splice(i, 1)
  }
  const rec: Tenant<OAuthStateRecord> = { companyId: co, id: `st_${randomToken(24)}`, userId: user.id, purpose, provider, calendarProvider, account, expiresAt: nowMs() + OAUTH_TTL_MS }
  oauthStates.push(rec)
  return { state: rec.id, provider, purpose, account, scopes: SCOPES[purpose][provider], expiresAt: new Date(rec.expiresAt).toISOString() }
}

/**
 * Validates and consumes a consent `state`: it must be the caller's, in their company, for `purpose`, not expired.
 * A foreign / unknown / used state answers the same 422 `oauth_state_invalid`. `approve: false` → 422 `consent_denied`.
 */
export function consumeOAuth(user: User, co: string, input: unknown, purpose: OAuthPurpose): OAuthStateRecord {
  const b = isObj(input) ? input : {}
  const state = str(b.state, 80)
  const i = oauthStates.findIndex((s) => s.companyId === co && s.id === state && s.userId === user.id && s.purpose === purpose)
  if (i < 0) bad('This sign-in link has expired. Start again.', 'oauth_state_invalid')
  const rec = oauthStates[i]
  oauthStates.splice(i, 1)
  if (rec.expiresAt < nowMs()) bad('This sign-in link has expired. Start again.', 'oauth_state_invalid')
  if (b.approve !== true) bad('Access wasn’t granted, so nothing was connected.', 'consent_denied')
  return rec
}
