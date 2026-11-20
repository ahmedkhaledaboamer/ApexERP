import { addDays, format } from 'date-fns'
import { contacts, customers, leads, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { departments } from '@/shared/mocks/data/departments'
import { quotations } from '@/shared/mocks/data/quotations'
import { bulkEmails, campaigns } from '@/shared/mocks/data/marketing'
import { adCampaigns, adConnections } from '@/shared/mocks/data/ads'
import { accountsFor } from '@/shared/mocks/services/ads'
import { reportSchedules } from '@/shared/mocks/data/reportSchedules'
import { packages, services } from '@/shared/mocks/data/services'
import { templates } from '@/shared/mocks/data/templates'
import { projects, pushNotification, tasks } from '@/shared/mocks/data/tasks'
import { getSessions } from '@/shared/mocks/services/security'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { teamIdsOf } from '@/shared/mocks/selectors/events'
import { APEX, ADMIN, api, adminToken, other, platformToken, userById, type Co } from './harness'
import { contactInputMapper, importRowMapper, leadInputMapper } from '@/shared/api/mappers'
import { CREATIVE_ENDPOINTS } from './creativeEndpoints'
import { GROWTH_ENDPOINTS } from './growthEndpoints'

/**
 * THE COVERAGE TABLE of the isolation suite: one entry per registered MSW handler (method + path as
 * registered, without the /api base). The completeness guard (completeness.isolation.test.ts) fails
 * when a handler is missing here or an entry no longer matches a handler.
 *
 * Kinds
 *   company-list    GET of a company collection or company state: only own rows, no foreign ids/markers
 *   company-item    an endpoint with a company-owned id in the path: a foreign id answers exactly 404,
 *                   with the same body as a missing id, and the foreign record is unchanged
 *   company-write   create / update / action without an owned id: spoofed company fields are ignored,
 *                   rows land in the caller's company, the other company's data is unchanged
 *   company-search  duplicate checks, availability, owners pickers: scoped to the caller's company
 *   company-export  exports, reports, dashboard: only own rows; key numbers equal an own recomputation
 *   public          no authentication by design (sign-up, plans, workspace lookup) — needs `reason`
 *   platform        /platform/* Super-Admin console (platform token only) — needs `reason`
 *   auth            sign-in endpoints (no session yet) — needs `reason`
 *   dev             dev-only simulation / tenant switcher, a real backend has none — needs `reason`
 *
 * Every company-* entry has a `sample(co)`: a valid request of a user of `co` naming `co`'s own records.
 * The table-driven tests (endpoints.isolation.test.ts) run, for both companies:
 *   no token → 401 · platform token → 401 · X-Workspace of the other company → 403 tenant_mismatch
 *   the sample → expected status, no trace of the other company, the other company's data unchanged
 *   the sample with companyId/company_id/tenantId/tenant in body, query and X-Company-Id/X-Tenant-Id → same
 *   each owned path param swapped for the other company's id → 404, same body as a missing id
 */

export type CompanyKind = 'company-list' | 'company-item' | 'company-write' | 'company-search' | 'company-export'
export type OtherKind = 'public' | 'platform' | 'auth' | 'dev'
export type Kind = CompanyKind | OtherKind

export interface Sample {
  /** Path params (every `:param` of the path). */
  params?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
  /** Caller (user id); the company admin by default. */
  as?: string
  /** Expected status(es) of the sample call; 200 by default. */
  expect?: number | number[]
}

interface Base {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'ALL'
  /** As registered, without the API base, e.g. `/leads/:id`. */
  path: string
  module: string
}

export interface CompanyEndpoint extends Base {
  kind: CompanyKind
  /** A valid request of a user of `co` that names `co`'s own records. May prepare data (runs inside the test). */
  sample: (co: Co) => Sample | Promise<Sample>
  /** Path params that are NOT company-owned ids (lookup list names, onboarding item keys…). */
  notOwned?: string[]
  /** For lists: the number of rows in the response and the own-company recomputation. */
  count?: { of: (body: unknown) => number; expected: (co: Co) => number }
  note?: string
}

export interface OtherEndpoint extends Base {
  kind: OtherKind
  /** Why this endpoint is not company-scoped (required, non-empty). */
  reason: string
  /** Dev endpoints that act on the caller's company run the company tests too. */
  sample?: (co: Co) => Sample | Promise<Sample>
}

export type Endpoint = CompanyEndpoint | OtherEndpoint

export const isCompany = (e: Endpoint): e is CompanyEndpoint => e.kind.startsWith('company-')

/* ---------------- Data helpers (live seed rows) ---------------- */

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`

function pick<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}
const lead = (co: Co) => pick(leads, co, 'open lead', (l) => !['Won', 'Lost', 'Not interested'].includes(l.status) && !l.doNotContact)
const customer = (co: Co) => pick(customers, co, 'customer')
const contact = (co: Co) => pick(contacts, co, 'contact')
const contract = (co: Co) => pick(contracts, co, 'contract')
const quotation = (co: Co, status?: string) => pick(quotations, co, `quotation ${status ?? ''}`, (q) => !status || q.status === status)
const dept = (co: Co) => pick(departments, co, 'department with goals', (d) => d.active && d.goals.length > 0)
const salesDept = (co: Co) => pick(departments, co, 'sales department', (d) => /sales/i.test(d.name))
const task = (co: Co) => pick(tasks, co, 'task', (t) => !t.projectId)
const project = (co: Co) => pick(projects, co, 'project')
const service = (co: Co) => pick(services, co, 'active service', (s) => s.active)
const twoServices = (co: Co) => services.filter((s) => s.companyId === co && s.active).slice(0, 2)
const pkg = (co: Co) => pick(packages, co, 'package')
const template = (co: Co) => pick(templates, co, 'template', (t) => t.active)
const schedule = (co: Co) => pick(reportSchedules, co, 'report schedule')
const userOf = (co: Co, role: string) => pick(users, co, role, (u) => u.role === role && u.active !== false)
const agent = (co: Co) => userOf(co, 'Sales Agent')
const member = (co: Co) => pick(users, co, 'department member', (u) => u.departmentId === dept(co).id && u.active !== false && u.role !== 'Company Admin')
const dial = (co: Co) => (co === APEX ? '+971 50 555 01' : '+966 55 555 01')
const mobile = (co: Co) => `${dial(co)}${String(10 + (seq++ % 89))}`
const domain = (co: Co) => (co === APEX ? 'iso-apex.ae' : 'iso-crest.sa')
/** A valid 1×1 PNG (Settings › Branding samples). */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** GET the current state with the admin (to PUT it back unchanged, or to find an id). */
async function current(co: Co, path: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(adminToken(co), 'GET', path)
  if (r.status !== 200) throw new Error(`Isolation table: GET ${path} for ${co} answered ${r.status}`)
  return r.body
}

/** A new Draft quotation of the company (created through the API). */
async function draftQuote(co: Co): Promise<string> {
  const r = await api(adminToken(co), 'POST', '/quotations', { body: quoteBody(co) })
  if (r.status !== 200) throw new Error(`Isolation table: creating a quotation for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id
}

/** A seed campaign of the company (marketing). */
const campaign = (co: Co) => pick(campaigns, co, 'campaign')
/** A live (seeded) ad account connection and one of its ad campaigns (marketing › ads). */
const adConnection = (co: Co) => pick(adConnections, co, 'ad connection', (c) => c.status !== 'disconnected')
const adCampaign = (co: Co) => pick(adCampaigns, co, 'ad campaign')
/** A bulk email body in the API's snake_case: from an email template, to the company's New leads. */
const bulkEmailBody = (co: Co) => ({
  name: `Isolation bulk email ${uniq()}`,
  campaign_id: campaign(co).id,
  message_template_id: pick(templates, co, 'email template', (t) => t.active && t.channel === 'email').id,
  filters: { statuses: ['New', 'Contacted', 'Interested'], industries: [], sources: [], owner_ids: [] },
})
/** A new Draft bulk email of the company (created through the API). */
async function draftBulkEmail(co: Co): Promise<string> {
  const r = await api(adminToken(co), 'POST', '/marketing/emails', { body: bulkEmailBody(co) })
  if (r.status !== 200) throw new Error(`Isolation table: creating a bulk email for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id
}

/** The company's first active loss reason (GET /lookups speaks the loss_reasons columns: id, is_active). */
const lossReason = async (co: Co): Promise<string> => (await current(co, '/lookups')).loss_reasons.find((x: { is_active: boolean }) => x.is_active).id

/** A stored notification of the admin (alerts only mark stored ones read). */
const storedAlert = (co: Co) => pushNotification({ userId: ADMIN[co], type: 'assignment', title: 'Isolation alert', body: 'Check', link: '/tasks' }).id

/** A non-current session of the admin. */
async function otherSession(co: Co): Promise<string> {
  const list = await getSessions(userById(ADMIN[co]))
  const s = list.find((x) => !x.current)
  if (!s) throw new Error(`Isolation table: no other session for ${co}`)
  return s.id
}

/** An attachment on the company's task (created through the API). */
async function attachment(co: Co): Promise<{ id: string; attachmentId: string }> {
  const t = task(co)
  const r = await api(adminToken(co), 'POST', `/tasks/${t.id}/attachments`, { body: { original_name: 'brief.pdf', size_bytes: 1200, mime_type: 'application/pdf' } })
  const list = (r.body?.attachments ?? []) as { id: string }[]
  return { id: t.id, attachmentId: list[list.length - 1].id }
}

/** A time entry of the admin on the company's task (created through the API). */
async function timeEntry(co: Co): Promise<{ id: string; entryId: string }> {
  const t = task(co)
  const r = await api(adminToken(co), 'POST', `/tasks/${t.id}/time-entries`, { body: { entry_date: day(0), hours: 1.5, description: 'Isolation hours' } })
  const list = (r.body?.time_entries ?? []) as { id: string; user_id: string }[]
  const mine = list.find((e) => e.user_id === ADMIN[co])
  if (!mine) throw new Error(`Isolation table: no time entry for ${co}: ${r.text}`)
  return { id: t.id, entryId: mine.id }
}

/** The company's open, unblocked task, blocked through the API (for the unblock sample). */
async function blockedTask(co: Co): Promise<{ id: string }> {
  const t = pick(tasks, co, 'open task', (x) => !x.projectId && x.status !== 'done' && x.status !== 'cancelled')
  if (!t.blockedAt) await api(adminToken(co), 'POST', `/tasks/${t.id}/block`, { body: { reason: 'Isolation: waiting on a reply' } })
  return { id: t.id }
}

/** A quick-add body in the API's snake_case (company_name, contact_name, phone, source_id, industry_id). */
const quick = (co: Co) =>
  leadInputMapper.toApi({
    company: `Isolation Probe ${uniq()} LLC`,
    contactName: 'Probe Person',
    mobile: mobile(co),
    email: `probe${uniq()}@${domain(co)}`,
    sourceType: 'Website',
    industry: 'Logistics',
  })

const importRow = (co: Co, row = 1) => ({
  row,
  company: `Imported ${uniq()} Co`,
  website: '',
  contactName: 'Imported Person',
  contactTitle: 'Manager',
  mobile: mobile(co),
  email: `imp${uniq()}@${domain(co)}`,
  isDecisionMaker: true,
  sourceType: 'Website',
  sourceDetail: '',
  industry: 'Logistics',
  subIndustry: '',
  status: 'New',
  ownerId: '',
  nextFollowUpDate: '',
  nextStep: '',
  value: null,
  companyServices: [],
  recommendedServiceId: '',
  recommendedServiceText: '',
})

/** A quotation body in the API's snake_case (quotations / quotation_items columns). */
const quoteBody = (co: Co) => ({
  lead_id: lead(co).id,
  title: 'Isolation quote',
  valid_until: day(30),
  items: [{ description: 'Work', quantity: 1, unit: 'project', unit_price: 1000, discount_percent: 0, service_id: service(co).id }],
  notes: '',
  terms: '',
})

/** A project body in the API's snake_case (projects columns). */
const projectBody = (co: Co) => ({
  name: `Isolation project ${uniq()}`,
  customer_id: customer(co).id,
  service_id: service(co).id,
  manager_id: ADMIN[co],
  start_date: day(20),
  end_date: day(60),
  status: 'planned',
  estimated_hours: 0,
  generate_tasks: false,
})

const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const ownCount = <T extends { companyId: string }>(rows: readonly T[], pred: (r: T) => boolean = () => true) => (co: Co) =>
  rows.filter((r) => r.companyId === co && pred(r)).length

/** Events (Events module): a confirmed upcoming event, a completed one with seeded attendees, one of its attendees. */
const openEvent = (co: Co) => pick(events, co, 'confirmed event', (e) => e.status === 'confirmed')
const pastEvent = (co: Co) => pick(events, co, 'completed event', (e) => e.status === 'completed')
const attendee = (co: Co) => pick(eventAttendees, co, 'event attendee')
const PUBLIC_EVENT = 'Public registration page of an event (no sign-in by design): the event is found by its unguessable registration token, only public fields are served, and an unknown token, a company without the Events module or a deleted / suspended workspace answer the same 404.'

/* ---------------- The table ---------------- */

const PUBLIC_SIGNUP = 'Self-service sign-up runs before any workspace exists; it never reads tenant data (the signup id is a random handle).'
const PLATFORM = 'Super-Admin console: platform token only (requirePlatform); company and impersonation tokens get 401. Boundary-tested in platform.isolation.test.ts.'
const DEV_BILLING = 'Dev-only billing simulation (registered only in development); acts on the caller’s own company through userFrom, so the company tests run on it too.'

export const ENDPOINTS: Endpoint[] = [
  /* ---- auth (handlers/auth.ts) ---- */
  { method: 'POST', path: '/auth/login', kind: 'auth', module: 'auth', reason: 'Sign-in: no session yet. The workspace comes from X-Workspace; a user of another workspace is refused (tested in boundary tests).' },
  { method: 'POST', path: '/auth/login/2fa', kind: 'auth', module: 'auth', reason: 'Second sign-in step: keyed by a random challenge id, no session yet.' },
  { method: 'POST', path: '/auth/switch-role', kind: 'company-write', module: 'auth', sample: () => ({ body: { role: 'Sales Manager' } }), note: 'Demo role switcher: signs in as a user of the same company only.' },
  { method: 'GET', path: '/auth/me', kind: 'company-list', module: 'auth', sample: () => ({}) },
  { method: 'GET', path: '/tenant', kind: 'company-list', module: 'regional/branding', sample: () => ({}) },
  { method: 'GET', path: '/public/workspaces/:subdomain', kind: 'public', module: 'auth', reason: 'Workspace lookup before sign-in: answers only the public branding (name, subdomain, colours, logos, favicon) of the address the app was opened on.' },
  { method: 'GET', path: '/users', kind: 'company-list', module: 'auth', sample: () => ({}), count: { of: len, expected: ownCount(users) } },
  { method: 'GET', path: '/auth/dev/accounts', kind: 'dev', module: 'auth', reason: 'Dev tenant switcher (mock only): lists every seeded account of every tenant on purpose. A real backend has no such endpoint.' },
  { method: 'POST', path: '/auth/dev/sign-in', kind: 'dev', module: 'auth', reason: 'Dev tenant switcher (mock only): signs in as any seeded account without a password. A real backend has no such endpoint.' },
  { method: 'POST', path: '/platform/auth/login', kind: 'auth', module: 'platform', reason: 'Platform console sign-in: no session yet; issues a platform token that opens no workspace.' },
  { method: 'POST', path: '/auth/impersonation/stop', kind: 'company-write', module: 'account/security', sample: () => ({}), note: 'A normal session gets { ok: true } and nothing changes; impersonation is tested in platform.isolation.test.ts.' },
  { method: 'POST', path: '/auth/impersonation/write-mode', kind: 'company-write', module: 'account/security', sample: () => ({ body: { confirm: true }, expect: 403 }), note: 'Only an impersonation token may switch; a normal session gets 403 not_impersonating.' },

  /* ---- company profile, onboarding, email connection, sign-up (handlers/companyProfile.ts) ---- */
  { method: 'GET', path: '/settings/company-profile', kind: 'company-list', module: 'company profile', sample: () => ({}) },
  { method: 'PATCH', path: '/settings/company-profile', kind: 'company-write', module: 'company profile', sample: async (co) => ({ body: await current(co, '/settings/company-profile') }) },
  { method: 'GET', path: '/settings/roles', kind: 'company-list', module: 'company profile', sample: () => ({}) },
  { method: 'GET', path: '/settings/branding', kind: 'company-list', module: 'branding', sample: () => ({}) },
  {
    method: 'PATCH',
    path: '/settings/branding',
    kind: 'company-write',
    module: 'branding',
    sample: async (co) => {
      const cur = await current(co, '/settings/branding')
      return { body: { display_name: cur.branding.display_name, brand_color: co === APEX ? '#2563eb' : '#be123c', logo_light: TINY_PNG, favicon: TINY_PNG } }
    },
  },
  { method: 'POST', path: '/settings/branding/reset', kind: 'company-write', module: 'branding', sample: () => ({}) },
  { method: 'GET', path: '/settings/email-connection', kind: 'company-list', module: 'integrations/email', sample: () => ({}) },
  { method: 'POST', path: '/settings/email-connection', kind: 'company-write', module: 'integrations/email', sample: (co) => ({ body: { provider: 'google', address: `mailbox@${domain(co)}` } }) },
  { method: 'DELETE', path: '/settings/email-connection', kind: 'company-write', module: 'integrations/email', sample: () => ({}) },
  { method: 'GET', path: '/onboarding', kind: 'company-list', module: 'onboarding', sample: () => ({}) },
  { method: 'PATCH', path: '/onboarding', kind: 'company-write', module: 'onboarding', sample: () => ({ body: { dismissed: true } }) },
  { method: 'POST', path: '/onboarding/dismiss', kind: 'company-write', module: 'onboarding', sample: () => ({}) },
  { method: 'POST', path: '/onboarding/restore', kind: 'company-write', module: 'onboarding', sample: () => ({}) },
  { method: 'POST', path: '/onboarding/items/:id/complete', kind: 'company-item', module: 'onboarding', notOwned: ['id'], sample: () => ({ params: { id: 'lists' } }), note: 'Item ids are fixed checklist keys, the same in every company; progress is per company.' },
  { method: 'PATCH', path: '/onboarding/items/:id', kind: 'company-item', module: 'onboarding', notOwned: ['id'], sample: () => ({ params: { id: 'lists' }, body: { done: true } }) },
  { method: 'GET', path: '/public/plans', kind: 'public', module: 'billing', reason: 'Public price list of the sign-up page; plans are platform-wide.' },
  { method: 'GET', path: '/public/signup/availability', kind: 'public', module: 'onboarding', reason: 'Subdomain availability during sign-up: subdomains are platform-wide by design (one address = one workspace); answers available/taken only, never which company holds it.' },
  { method: 'POST', path: '/public/signup', kind: 'public', module: 'onboarding', reason: PUBLIC_SIGNUP },
  { method: 'GET', path: '/public/signup/:id', kind: 'public', module: 'onboarding', reason: PUBLIC_SIGNUP },
  { method: 'POST', path: '/public/signup/:id/resend', kind: 'public', module: 'onboarding', reason: PUBLIC_SIGNUP },
  { method: 'POST', path: '/public/signup/:id/verify', kind: 'public', module: 'onboarding', reason: PUBLIC_SIGNUP },
  { method: 'POST', path: '/public/signup/:id/complete', kind: 'public', module: 'onboarding', reason: PUBLIC_SIGNUP + ' Creates a new company; the email uniqueness check is platform-wide by design (409 without naming the company).' },
  { method: 'POST', path: '/public/checkout', kind: 'public', module: 'billing', reason: 'Paid sign-up checkout (no workspace yet); creates a new company.' },
  { method: 'POST', path: '/public/contact-sales', kind: 'public', module: 'billing', reason: 'Enterprise contact form; stored for the platform team only, never served to a company.' },

  /* ---- settings lists, automation, audit (handlers/settings.ts) ---- */
  { method: 'GET', path: '/lookups', kind: 'company-list', module: 'settings lists', sample: () => ({}) },
  {
    method: 'PUT', path: '/lookups/:list', kind: 'company-item', module: 'settings lists', notOwned: ['list'],
    sample: async (co) => ({ params: { list: 'industries' }, body: { items: (await current(co, '/lookups')).industries } }),
    note: 'List names are fixed keys; each company has its own lists (uniqueness inside the company).',
  },
  { method: 'GET', path: '/settings/automation', kind: 'company-list', module: 'automation rules', sample: () => ({}) },
  { method: 'PUT', path: '/settings/automation', kind: 'company-write', module: 'automation rules', sample: async (co) => ({ body: await current(co, '/settings/automation') }) },
  { method: 'POST', path: '/settings/automation/reset', kind: 'company-write', module: 'automation rules', sample: () => ({}) },
  { method: 'GET', path: '/audit-log', kind: 'company-list', module: 'audit log', sample: () => ({}) },

  /* ---- settings users (handlers/settingsUsers.ts) ---- */
  { method: 'GET', path: '/settings/users', kind: 'company-list', module: 'settings users', sample: () => ({}), count: { of: len, expected: ownCount(users) } },
  { method: 'GET', path: '/settings/departments', kind: 'company-list', module: 'departments', sample: () => ({}) },
  {
    method: 'POST', path: '/settings/users', kind: 'company-write', module: 'settings users',
    sample: (co) => ({ body: { name: 'Iso New User', email: `new${uniq()}@${domain(co)}`, mobile: mobile(co), role: 'Sales Agent', title: 'Rep', department_id: salesDept(co).id, manager_id: null } }),
  },
  { method: 'PATCH', path: '/settings/users/:id', kind: 'company-item', module: 'settings users', sample: (co) => ({ params: { id: agent(co).id }, body: { title: 'Senior Rep' } }) },
  { method: 'POST', path: '/settings/users/:id/deactivate', kind: 'company-item', module: 'settings users', sample: (co) => ({ params: { id: agent(co).id }, body: { confirm: true } }) },
  { method: 'POST', path: '/settings/users/:id/reactivate', kind: 'company-item', module: 'settings users', sample: (co) => ({ params: { id: agent(co).id }, expect: [200, 409, 422] }) },

  /* ---- security (handlers/security.ts) ---- */
  { method: 'GET', path: '/security/2fa', kind: 'company-list', module: 'account/security', sample: () => ({}) },
  { method: 'POST', path: '/security/2fa/setup', kind: 'company-write', module: 'account/security', sample: (co) => ({ as: agent(co).id }) },
  { method: 'POST', path: '/security/2fa/verify', kind: 'company-write', module: 'account/security', sample: (co) => ({ as: agent(co).id, body: { code: '000000' }, expect: [409, 422] }) },
  { method: 'POST', path: '/security/2fa/disable', kind: 'company-write', module: 'account/security', sample: () => ({ body: { code: '000000' }, expect: [403, 409, 422] }) },
  { method: 'GET', path: '/security/sessions', kind: 'company-list', module: 'account/security', sample: () => ({}) },
  { method: 'POST', path: '/security/sessions/revoke-others', kind: 'company-write', module: 'account/security', sample: () => ({}) },
  { method: 'DELETE', path: '/security/sessions/:id', kind: 'company-item', module: 'account/security', sample: async (co) => ({ params: { id: await otherSession(co) } }) },
  { method: 'GET', path: '/security/backups', kind: 'company-list', module: 'account/security', sample: () => ({}) },
  { method: 'POST', path: '/security/backups/run', kind: 'company-write', module: 'account/security', sample: () => ({}) },
  { method: 'GET', path: '/security/policy', kind: 'company-list', module: 'account/security', sample: () => ({}) },
  { method: 'PUT', path: '/security/policy', kind: 'company-write', module: 'account/security', sample: async (co) => ({ body: await current(co, '/security/policy') }) },

  /* ---- account (handlers/account.ts) ---- */
  { method: 'GET', path: '/account', kind: 'company-list', module: 'account/security', sample: () => ({}) },
  { method: 'POST', path: '/account/password', kind: 'company-write', module: 'account/security', sample: () => ({ body: { currentPassword: 'wrong-password', newPassword: 'Brand-New-Pass-2026' }, expect: [400, 403, 422] }) },

  /* ---- message templates (handlers/templates.ts) ---- */
  { method: 'GET', path: '/templates', kind: 'company-list', module: 'message templates', sample: () => ({}), count: { of: len, expected: ownCount(templates) } },
  { method: 'GET', path: '/templates/:id', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id } }) },
  { method: 'POST', path: '/templates', kind: 'company-write', module: 'message templates', sample: () => ({ body: { type: 'email', name: `Iso template ${uniq()}`, purpose: 'First follow-up', subject: 'Hello', body: 'Hello there' } }) },
  { method: 'PATCH', path: '/templates/:id', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id }, body: { name: `Renamed ${uniq()}` } }) },
  { method: 'POST', path: '/templates/:id/duplicate', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id } }) },
  { method: 'POST', path: '/templates/:id/default', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id } }) },
  { method: 'POST', path: '/templates/:id/deactivate', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id }, expect: [200, 409] }) },
  { method: 'POST', path: '/templates/:id/reactivate', kind: 'company-item', module: 'message templates', sample: (co) => ({ params: { id: template(co).id } }) },

  /* ---- won flow (handlers/won.ts) ---- */
  { method: 'POST', path: '/leads/:id/won/preview', kind: 'company-item', module: 'won flow', sample: (co) => ({ params: { id: lead(co).id }, body: { service_ids: [service(co).id] } }) },
  {
    method: 'POST', path: '/leads/:id/won', kind: 'company-item', module: 'won flow',
    sample: (co) => ({ params: { id: lead(co).id }, body: { service_ids: [service(co).id], project_manager_id: ADMIN[co], start_date: day(21), idempotency_key: `iso-${uniq()}` } }),
  },

  /* ---- lead import (handlers/leadImport.ts) ---- */
  { method: 'POST', path: '/leads/import/check', kind: 'company-search', module: 'imports', sample: (co) => ({ body: { rows: [importRowMapper.toApi(importRow(co))] } }) },
  { method: 'POST', path: '/leads/import', kind: 'company-write', module: 'imports', sample: (co) => ({ body: { rows: [importRowMapper.toApi(importRow(co))], decisions: { 1: 'import' }, owner_rule: 'auto' } }) },

  /* ---- leads (handlers/leads.ts) ---- */
  { method: 'GET', path: '/leads/duplicates', kind: 'company-search', module: 'leads', sample: (co) => ({ query: { company_name: lead(co).company, email: lead(co).contactEmail } }) },
  { method: 'GET', path: '/leads/owners', kind: 'company-search', module: 'leads', sample: () => ({}) },
  { method: 'GET', path: '/leads', kind: 'company-list', module: 'leads', sample: () => ({}), count: { of: len, expected: ownCount(leads) } },
  { method: 'POST', path: '/leads', kind: 'company-write', module: 'leads', sample: (co) => ({ body: quick(co) }) },
  { method: 'GET', path: '/leads/:id', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id } }) },
  { method: 'PATCH', path: '/leads/:id', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id }, body: { next_step: 'Isolation follow-up' } }) },
  { method: 'PATCH', path: '/leads/:id/stage', kind: 'company-item', module: 'leads', sample: async (co) => ({ params: { id: lead(co).id }, body: { status_id: 'Lost', loss_reason_id: await lossReason(co) }, expect: [200] }), note: 'The demo fails a share of stage moves on purpose (503); the rate is 0 under tests.' },
  { method: 'PATCH', path: '/leads/:id/do-not-contact', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id }, body: { value: true } }) },
  { method: 'GET', path: '/leads/:id/activities', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id } }) },
  { method: 'POST', path: '/leads/:id/activities', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id }, body: { type: 'call', summary: 'Isolation call' } }) },
  { method: 'GET', path: '/leads/:id/notes', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id } }) },
  { method: 'POST', path: '/leads/:id/notes', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id }, body: { body: 'Isolation note' } }) },
  { method: 'GET', path: '/leads/:id/tasks', kind: 'company-item', module: 'leads', sample: (co) => ({ params: { id: lead(co).id } }) },

  /* ---- messages (handlers/messages.ts) ---- */
  { method: 'POST', path: '/leads/:id/messages', kind: 'company-item', module: 'messages', sample: (co) => ({ params: { id: lead(co).id }, body: { channel: 'email', to_address: lead(co).contactEmail, subject: 'Hello', body: 'Isolation message' } }) },

  /* ---- dashboard (handlers/dashboard.ts) ---- */
  { method: 'GET', path: '/dashboard/summary', kind: 'company-export', module: 'dashboard', sample: () => ({ query: { period: '12m' } }) },

  /* ---- departments (handlers/departments.ts) ---- */
  { method: 'GET', path: '/departments/org-chart', kind: 'company-list', module: 'departments', sample: () => ({}) },
  { method: 'POST', path: '/departments/move-members', kind: 'company-write', module: 'departments', sample: (co) => ({ body: { user_ids: [agent(co).id], to_department_id: dept(co).id, manager_id: null } }) },
  { method: 'GET', path: '/departments', kind: 'company-list', module: 'departments', sample: () => ({ query: { include_inactive: 'true' } }), count: { of: len, expected: ownCount(departments) } },
  { method: 'POST', path: '/departments', kind: 'company-write', module: 'departments', sample: () => ({ body: { name: `Iso Dept ${uniq()}`, parent_id: null, head_user_id: null } }) },
  { method: 'GET', path: '/departments/:id', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id } }) },
  { method: 'PATCH', path: '/departments/:id', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id }, body: { cost_center_code: 'CC-ISO' } }) },
  { method: 'POST', path: '/departments/:id/deactivate', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id }, expect: [200, 409] }) },
  { method: 'POST', path: '/departments/:id/reactivate', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id } }) },
  { method: 'PATCH', path: '/departments/:id/members/:userId', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id, userId: member(co).id }, body: { manager_id: null } }) },
  { method: 'POST', path: '/departments/:id/goals', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id }, body: { title: 'Isolation goal', owner_id: null, due_date: day(30) } }) },
  { method: 'PATCH', path: '/departments/:id/goals/:goalId', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id, goalId: dept(co).goals[0].id }, body: { title: 'Renamed goal' } }) },
  { method: 'DELETE', path: '/departments/:id/goals/:goalId', kind: 'company-item', module: 'departments', sample: (co) => ({ params: { id: dept(co).id, goalId: dept(co).goals[0].id } }) },

  /* ---- tasks & projects (handlers/tasks.ts, projects.ts) ---- */
  { method: 'GET', path: '/tasks', kind: 'company-list', module: 'tasks', sample: () => ({ query: { include_done: 'true' } }) },
  {
    method: 'GET',
    path: '/tasks/assignable',
    kind: 'company-search',
    module: 'tasks',
    sample: () => ({}),
    // Full scope (the admin): every active user of the own company, nobody else.
    count: { of: (b) => (b as unknown[]).length, expected: (co) => users.filter((u) => u.companyId === co && u.active !== false).length },
  },
  { method: 'GET', path: '/tasks/:id', kind: 'company-item', module: 'tasks', sample: (co) => ({ params: { id: task(co).id } }) },
  { method: 'POST', path: '/tasks', kind: 'company-write', module: 'tasks', sample: () => ({ body: { title: 'Isolation task', priority: 'medium', due_date: day(5) } }) },
  { method: 'PATCH', path: '/tasks/:id', kind: 'company-item', module: 'tasks', sample: (co) => ({ params: { id: task(co).id }, body: { title: 'Isolation renamed' } }) },
  { method: 'POST', path: '/tasks/:id/comments', kind: 'company-item', module: 'tasks', sample: (co) => ({ params: { id: task(co).id }, body: { body: 'Isolation comment' } }) },
  { method: 'POST', path: '/tasks/:id/attachments', kind: 'company-item', module: 'tasks', sample: (co) => ({ params: { id: task(co).id }, body: { original_name: 'a.pdf', size_bytes: 10, mime_type: 'application/pdf' } }) },
  { method: 'DELETE', path: '/tasks/:id/attachments/:attachmentId', kind: 'company-item', module: 'tasks', sample: async (co) => ({ params: await attachment(co) }) },
  {
    method: 'POST',
    path: '/tasks/:id/block',
    kind: 'company-item',
    module: 'tasks',
    // 200 the first time, 409 when an earlier run already blocked it: both prove the task was found.
    sample: (co) => ({ params: { id: pick(tasks, co, 'open task', (x) => !x.projectId && x.status !== 'done' && x.status !== 'cancelled').id }, body: { reason: 'Isolation: waiting on a reply' }, expect: [200, 409] }),
  },
  { method: 'POST', path: '/tasks/:id/unblock', kind: 'company-item', module: 'tasks', sample: async (co) => ({ params: await blockedTask(co), expect: [200, 409] }) },
  { method: 'POST', path: '/tasks/:id/time-entries', kind: 'company-item', module: 'tasks', sample: (co) => ({ params: { id: task(co).id }, body: { entry_date: day(0), hours: 2, description: 'Isolation hours', is_billable: false } }) },
  { method: 'DELETE', path: '/tasks/:id/time-entries/:entryId', kind: 'company-item', module: 'tasks', sample: async (co) => ({ params: await timeEntry(co) }) },
  { method: 'GET', path: '/projects', kind: 'company-list', module: 'projects', sample: () => ({}), count: { of: len, expected: ownCount(projects) } },
  { method: 'POST', path: '/projects', kind: 'company-write', module: 'projects', sample: (co) => ({ body: projectBody(co) }) },
  { method: 'GET', path: '/projects/:id', kind: 'company-item', module: 'projects', sample: (co) => ({ params: { id: project(co).id } }) },
  { method: 'PATCH', path: '/projects/:id', kind: 'company-item', module: 'projects', sample: (co) => ({ params: { id: project(co).id }, body: { name: `Renamed project ${uniq()}` } }) },

  /* ---- notifications / alerts (handlers/alerts.ts) ---- */
  { method: 'GET', path: '/alerts', kind: 'company-list', module: 'notifications/alerts', sample: () => ({}) },
  { method: 'POST', path: '/alerts/read-all', kind: 'company-write', module: 'notifications/alerts', sample: (co) => (storedAlert(co), {}) },
  { method: 'PATCH', path: '/alerts/:id/read', kind: 'company-item', module: 'notifications/alerts', sample: (co) => ({ params: { id: storedAlert(co) } }) },

  /* ---- services, packages, project templates (handlers/services.ts) ---- */
  { method: 'GET', path: '/services/packages', kind: 'company-list', module: 'services/packages', sample: () => ({}), count: { of: len, expected: ownCount(packages) } },
  { method: 'POST', path: '/services/packages', kind: 'company-write', module: 'services/packages', sample: (co) => ({ body: { name: `Iso package ${uniq()}`, description: 'Bundle', items: twoServices(co).map((x) => ({ service_id: x.id, quantity: 1 })), price: 100, currency_code: co === APEX ? 'AED' : 'SAR' } }) },
  { method: 'GET', path: '/services/packages/:id', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: pkg(co).id } }) },
  { method: 'PATCH', path: '/services/packages/:id', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: pkg(co).id }, body: { description: 'Isolation edit' } }) },
  { method: 'POST', path: '/services/packages/:id/deactivate', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: pkg(co).id } }) },
  { method: 'POST', path: '/services/packages/:id/reactivate', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: pkg(co).id } }) },
  { method: 'GET', path: '/services', kind: 'company-list', module: 'services/packages', sample: () => ({}), count: { of: len, expected: ownCount(services) } },
  { method: 'POST', path: '/services', kind: 'company-write', module: 'services/packages', sample: (co) => ({ body: { name: `Iso service ${uniq()}`, category_id: service(co).category, description: 'Isolation', industry_ids: [], pricing_type: service(co).pricingType, price: 1000, currency_code: co === APEX ? 'AED' : 'SAR', delivery_days: 5 } }) },
  { method: 'GET', path: '/services/:id', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: service(co).id } }) },
  { method: 'PATCH', path: '/services/:id', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: service(co).id }, body: { description: 'Isolation edit' } }) },
  { method: 'POST', path: '/services/:id/deactivate', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: service(co).id }, expect: [200, 409] }) },
  { method: 'POST', path: '/services/:id/reactivate', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: service(co).id } }) },
  { method: 'GET', path: '/services/:id/project-template', kind: 'company-item', module: 'services/packages', sample: (co) => ({ params: { id: service(co).id } }) },
  {
    method: 'PUT', path: '/services/:id/project-template', kind: 'company-item', module: 'services/packages',
    sample: async (co) => ({ params: { id: service(co).id }, body: { tasks: (await current(co, `/services/${service(co).id}/project-template`)).tasks } }),
  },

  /* ---- targets (handlers/targets.ts) ---- */
  { method: 'GET', path: '/targets/defaults', kind: 'company-list', module: 'targets', sample: () => ({}) },
  { method: 'PUT', path: '/targets/defaults', kind: 'company-write', module: 'targets', sample: async (co) => ({ body: { values: (await current(co, '/targets/defaults')).values } }) },
  { method: 'GET', path: '/targets', kind: 'company-list', module: 'targets', sample: () => ({}) },
  { method: 'PUT', path: '/targets/:userId', kind: 'company-item', module: 'targets', sample: async (co) => ({ params: { userId: agent(co).id }, body: { values: (await current(co, '/targets/defaults')).values } }) },
  { method: 'DELETE', path: '/targets/:userId', kind: 'company-item', module: 'targets', sample: (co) => ({ params: { userId: agent(co).id } }) },

  /* ---- customers, contacts, contracts (handlers/crm.ts) ---- */
  { method: 'GET', path: '/customers', kind: 'company-list', module: 'customers', sample: () => ({}), count: { of: len, expected: ownCount(customers) } },
  { method: 'GET', path: '/customers/:id', kind: 'company-item', module: 'customers', sample: (co) => ({ params: { id: customer(co).id } }) },
  { method: 'PATCH', path: '/customers/:id', kind: 'company-item', module: 'customers', sample: (co) => ({ params: { id: customer(co).id }, body: { address_line: 'Isolation Street 1' } }) },
  { method: 'GET', path: '/contacts', kind: 'company-list', module: 'contacts', sample: () => ({}) },
  { method: 'POST', path: '/contacts', kind: 'company-write', module: 'contacts', sample: (co) => ({ body: contactInputMapper.toApi({ recordType: 'lead' as never, recordId: lead(co).id, name: 'Iso Contact', title: 'Buyer', mobile: mobile(co), email: `contact${uniq()}@${domain(co)}`, isDecisionMaker: false }) }) },
  { method: 'PATCH', path: '/contacts/:id', kind: 'company-item', module: 'contacts', sample: (co) => ({ params: { id: contact(co).id }, body: { title: 'Isolation title' } }) },
  { method: 'GET', path: '/contracts', kind: 'company-list', module: 'contracts', sample: () => ({}), count: { of: len, expected: ownCount(contracts) } },
  { method: 'POST', path: '/contracts', kind: 'company-write', module: 'contracts', sample: (co) => ({ body: { customer_id: customer(co).id, title: 'Isolation contract', service_ids: [service(co).id], cycle_value: 5000, billing_period: 'Monthly', start_date: day(1), renewal_date: day(366) } }) },
  { method: 'PATCH', path: '/contracts/:id', kind: 'company-item', module: 'contracts', sample: (co) => ({ params: { id: contract(co).id }, body: { title: 'Isolation renamed contract' } }) },

  /* ---- quotations (handlers/quotations.ts) ---- */
  { method: 'GET', path: '/quotations', kind: 'company-list', module: 'quotations', sample: () => ({}), count: { of: len, expected: ownCount(quotations) } },
  {
    method: 'POST', path: '/quotations', kind: 'company-write', module: 'quotations',
    sample: (co) => ({ body: quoteBody(co) }),
  },
  { method: 'GET', path: '/quotations/:id', kind: 'company-item', module: 'quotations', sample: (co) => ({ params: { id: quotation(co).id } }) },
  { method: 'PATCH', path: '/quotations/:id', kind: 'company-item', module: 'quotations', sample: async (co) => ({ params: { id: await draftQuote(co) }, body: { title: 'Isolation renamed quote' } }) },
  { method: 'POST', path: '/quotations/:id/send', kind: 'company-item', module: 'quotations', sample: async (co) => ({ params: { id: await draftQuote(co) } }) },
  { method: 'POST', path: '/quotations/:id/status', kind: 'company-item', module: 'quotations', sample: (co) => ({ params: { id: quotation(co, 'sent').id }, body: { status: 'rejected' } }) },
  { method: 'POST', path: '/quotations/:id/viewed', kind: 'company-item', module: 'quotations', sample: (co) => ({ params: { id: quotation(co, 'sent').id } }) },
  { method: 'POST', path: '/quotations/:id/duplicate', kind: 'company-item', module: 'quotations', sample: (co) => ({ params: { id: quotation(co).id } }) },

  /* ---- reports (handlers/reports.ts) ---- */
  { method: 'GET', path: '/reports/sales', kind: 'company-export', module: 'reports', sample: () => ({ query: { from: day(-365), to: day(0) } }) },
  { method: 'POST', path: '/reports/custom', kind: 'company-export', module: 'reports', sample: () => ({ body: { from: day(-365), to: day(0), dimension: 'owner', measure: 'count' } }) },
  { method: 'GET', path: '/reports/schedules', kind: 'company-list', module: 'reports', sample: () => ({}), count: { of: len, expected: ownCount(reportSchedules) } },
  { method: 'POST', path: '/reports/schedules', kind: 'company-write', module: 'reports', sample: (co) => ({ body: { report_type: 'all', frequency: 'weekly', day: 1, run_at: '08:00', recipients: [userById(ADMIN[co]).email], format: 'excel' } }) },
  { method: 'DELETE', path: '/reports/schedules/:id', kind: 'company-item', module: 'reports', sample: (co) => ({ params: { id: schedule(co).id } }) },

  /* ---- billing & usage (handlers/billing.ts) ---- */
  { method: 'GET', path: '/billing/entitlements', kind: 'company-list', module: 'billing/usage', sample: () => ({}) },
  { method: 'GET', path: '/billing/overview', kind: 'company-list', module: 'billing/usage', sample: () => ({}) },
  { method: 'POST', path: '/billing/change-plan', kind: 'company-write', module: 'billing/usage', sample: (co) => ({ body: { plan_id: co === APEX ? 'business' : 'enterprise' }, expect: [200, 409, 422] }) },
  { method: 'POST', path: '/billing/trial-plan', kind: 'company-write', module: 'billing/usage', sample: () => ({ body: { plan_id: 'business' }, expect: [409, 422] }), note: 'Only on a trial; both seed companies are paid (409).' },
  { method: 'DELETE', path: '/billing/scheduled-change', kind: 'company-write', module: 'billing/usage', sample: () => ({ expect: [200, 409] }) },
  { method: 'POST', path: '/billing/payment-method', kind: 'company-write', module: 'billing/usage', sample: () => ({ body: { holder: 'Iso Holder', card_number: '4242 4242 4242 4242', expiry: '12/39', cvc: '123' } }) },
  { method: 'POST', path: '/billing/cancel', kind: 'company-write', module: 'billing/usage', sample: () => ({}) },
  { method: 'POST', path: '/billing/resume', kind: 'company-write', module: 'billing/usage', sample: () => ({ expect: [200, 409] }) },
  { method: 'POST', path: '/billing/reactivate', kind: 'company-write', module: 'billing/usage', sample: () => ({ body: {}, expect: [200, 409] }) },
  { method: 'GET', path: '/billing/export', kind: 'company-export', module: 'exports', sample: () => ({}) },
  { method: 'POST', path: '/ai/credits/consume', kind: 'company-write', module: 'billing/usage', sample: (co) => ({ body: { credits: 1 }, expect: co === APEX ? [200, 402, 403] : [200, 402, 403] }) },
  { method: 'GET', path: '/hr/employees', kind: 'company-list', module: 'billing/usage', sample: (co) => ({ expect: co === APEX ? 200 : 403 }), note: 'Module stub: Crest (Business) has no HR → 403 module_not_in_plan.' },
  /* ---- events (handlers/events.ts; plan module `events`) ---- */
  { method: 'GET', path: '/events', kind: 'company-list', module: 'events', sample: () => ({ query: { from: day(-400), to: day(400) } }), count: { of: len, expected: ownCount(events) } },
  { method: 'POST', path: '/events', kind: 'company-write', module: 'events', sample: (co) => ({ body: { name: `Isolation event ${uniq()}`, type: 'meeting', start_date: day(10), start_time: '09:00', end_time: '11:00', budget: 1000, team_ids: [userOf(co, 'Sales Agent').id] } }) },
  { method: 'GET', path: '/events/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id } }) },
  { method: 'PATCH', path: '/events/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id }, body: { location: 'Isolation hall', registration_open: true } }) },
  { method: 'DELETE', path: '/events/:id', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id } }), note: 'Soft delete: the event is cancelled.' },
  { method: 'POST', path: '/events/:id/team', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id }, body: { user_id: userOf(co, 'Management').id } }) },
  { method: 'DELETE', path: '/events/:id/team/:userId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id, userId: teamIdsOf(openEvent(co))[1] } }) },
  { method: 'GET', path: '/events/:id/stats', kind: 'company-export', module: 'events', sample: (co) => ({ params: { id: pastEvent(co).id } }) },
  { method: 'GET', path: '/events/:id/attendees', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: pastEvent(co).id } }) },
  { method: 'POST', path: '/events/:id/attendees/import', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id }, body: { file_name: 'iso.csv', rows: [{ row: 2, name: 'Iso Import', company_name: 'Iso Import Co', email: `iso-import-${uniq()}@${domain(co)}` }] } }) },
  { method: 'POST', path: '/events/:id/attendees', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: openEvent(co).id }, body: { name: 'Iso Attendee', company_name: 'Iso Attendee Co', email: `iso-att-${uniq()}@${domain(co)}`, mobile: mobile(co) } }) },
  { method: 'PATCH', path: '/events/:id/attendees/:attendeeId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: attendee(co).eventId, attendeeId: attendee(co).id }, body: { title: 'Isolation title' } }) },
  { method: 'DELETE', path: '/events/:id/attendees/:attendeeId', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: attendee(co).eventId, attendeeId: attendee(co).id } }) },
  { method: 'POST', path: '/events/:id/attendees/:attendeeId/check-in', kind: 'company-item', module: 'events', sample: (co) => ({ params: { id: attendee(co).eventId, attendeeId: attendee(co).id }, body: { undo: true } }) },
  { method: 'GET', path: '/public/events/:token', kind: 'public', module: 'events', reason: PUBLIC_EVENT },
  { method: 'POST', path: '/public/events/:token/register', kind: 'public', module: 'events', reason: PUBLIC_EVENT + ' Rate-limited per client and email, honeypot; the attendee and its lead land in the event’s company only.' },

  /* ---- marketing (handlers/marketing.ts; plan module `marketing`) ---- */
  { method: 'GET', path: '/marketing/options', kind: 'company-list', module: 'marketing', sample: () => ({}) },
  { method: 'GET', path: '/marketing/campaigns', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(campaigns) } },
  {
    method: 'POST', path: '/marketing/campaigns', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { name: `Isolation campaign ${uniq()}`, channel: 'ads', budget: 1000, starts_on: day(0), ends_on: day(30), owner_id: ADMIN[co] } }),
  },
  { method: 'GET', path: '/marketing/campaigns/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: campaign(co).id } }) },
  { method: 'PATCH', path: '/marketing/campaigns/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: campaign(co).id }, body: { goal: 'Isolation goal' } }) },
  {
    method: 'POST', path: '/marketing/campaigns/:id/costs', kind: 'company-item', module: 'marketing',
    sample: (co) => ({ params: { id: campaign(co).id }, body: { incurred_on: day(0), amount: 250, description: 'Isolation cost' } }),
  },
  { method: 'GET', path: '/marketing/campaigns/:id/results', kind: 'company-export', module: 'marketing', sample: (co) => ({ params: { id: campaign(co).id } }) },
  { method: 'GET', path: '/marketing/emails', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: ownCount(bulkEmails) } },
  {
    method: 'POST', path: '/marketing/emails', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: bulkEmailBody(co) }),
  },
  { method: 'GET', path: '/marketing/emails/:id', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await draftBulkEmail(co) } }) },
  { method: 'PATCH', path: '/marketing/emails/:id', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await draftBulkEmail(co) }, body: { subject: 'Isolation subject {{lead.firstName}}' } }) },
  { method: 'DELETE', path: '/marketing/emails/:id', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await draftBulkEmail(co) } }) },
  {
    method: 'POST', path: '/marketing/emails/:id/preview-audience', kind: 'company-item', module: 'marketing',
    sample: async (co) => ({ params: { id: await draftBulkEmail(co) }, body: { filters: { statuses: [], industries: [], sources: [], owner_ids: [ADMIN[co]] } } }),
  },
  {
    method: 'POST', path: '/marketing/emails/:id/schedule', kind: 'company-item', module: 'marketing',
    sample: async (co) => ({ params: { id: await draftBulkEmail(co) }, body: { scheduled_at: `${day(3)}T09:30` } }),
  },
  { method: 'POST', path: '/marketing/emails/:id/send-now', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await draftBulkEmail(co) } }) },
  { method: 'POST', path: '/marketing/emails/:id/test', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await draftBulkEmail(co) }, body: { to: 'iso-test@example.org' } }) },
  {
    method: 'GET', path: '/marketing/reports/cost-per-lead', kind: 'company-export', module: 'marketing',
    sample: () => ({ query: { from: day(-365), to: day(0) } }),
  },
  /* ---- marketing › content calendar, design requests, brand assets (isolation/creativeEndpoints.ts) ---- */
  ...CREATIVE_ENDPOINTS,
  /* ---- marketing › lead generation, audiences, website & SEO (isolation/growthEndpoints.ts) ---- */
  ...GROWTH_ENDPOINTS,
  /* ---- marketing › ads integrations + analytics (handlers/ads.ts) ---- */
  { method: 'GET', path: '/marketing/ads/connections', kind: 'company-list', module: 'marketing/ads', sample: () => ({}), count: { of: len, expected: ownCount(adConnections) } },
  {
    method: 'POST', path: '/marketing/ads/connections', kind: 'company-write', module: 'marketing/ads',
    // Re-running the sample (spoofing variants) finds the account already connected: 409.
    sample: (co) => ({ body: { provider: 'tiktok', account_id: accountsFor(co, 'tiktok')[0].accountId, consent: true }, expect: [200, 409] }),
  },
  { method: 'GET', path: '/marketing/ads/connections/:id', kind: 'company-item', module: 'marketing/ads', sample: (co) => ({ params: { id: adConnection(co).id } }) },
  { method: 'DELETE', path: '/marketing/ads/connections/:id', kind: 'company-item', module: 'marketing/ads', sample: (co) => ({ params: { id: adConnection(co).id }, expect: [200, 409] }) },
  { method: 'POST', path: '/marketing/ads/connections/:id/sync', kind: 'company-item', module: 'marketing/ads', sample: (co) => ({ params: { id: adConnection(co).id } }) },
  { method: 'GET', path: '/marketing/ads/providers/:provider/accounts', kind: 'company-list', module: 'marketing/ads', notOwned: ['provider'], sample: () => ({ params: { provider: 'meta' } }) },
  { method: 'PATCH', path: '/marketing/ads/campaigns/:id', kind: 'company-item', module: 'marketing/ads', sample: (co) => ({ params: { id: adCampaign(co).id }, body: { campaign_id: campaign(co).id } }) },
  { method: 'GET', path: '/marketing/analytics', kind: 'company-export', module: 'marketing/analytics', sample: () => ({ query: { preset: 'custom', from: day(-60), to: day(0), compare: 'true' } }) },
  { method: 'GET', path: '/finance/invoices', kind: 'company-list', module: 'billing/usage', sample: () => ({}) },
  { method: 'GET', path: '/integrations', kind: 'company-list', module: 'integrations/email', sample: () => ({}) },

  /* ---- platform console (handlers/platform.ts) ---- */
  { method: 'GET', path: '/platform/me', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/companies', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/companies/:id', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/companies/:id/users', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/companies/:id/timeline', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/companies/:id/notes', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'POST', path: '/platform/companies/:id/notes', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'POST', path: '/platform/companies/:id/actions', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'POST', path: '/platform/companies/:id/modules', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'POST', path: '/platform/companies/:id/subdomain', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/subdomains/check', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/overview', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/plans', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'POST', path: '/platform/plans', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'PATCH', path: '/platform/plans/:id', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'DELETE', path: '/platform/plans/:id', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/settings', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'PATCH', path: '/platform/settings', kind: 'platform', module: 'platform', reason: PLATFORM },
  { method: 'GET', path: '/platform/announcements', kind: 'platform', module: 'announcements', reason: PLATFORM },
  { method: 'POST', path: '/platform/announcements', kind: 'platform', module: 'announcements', reason: PLATFORM },
  { method: 'PATCH', path: '/platform/announcements/:id', kind: 'platform', module: 'announcements', reason: PLATFORM },
  { method: 'DELETE', path: '/platform/announcements/:id', kind: 'platform', module: 'announcements', reason: PLATFORM },
  { method: 'GET', path: '/announcements', kind: 'company-list', module: 'announcements', sample: () => ({}) },
  {
    method: 'POST', path: '/announcements/:id/dismiss', kind: 'company-item', module: 'announcements', notOwned: ['id'],
    sample: async () => {
      const r = await api(platformToken(),'POST', '/platform/announcements', { body: { title: 'Maintenance', body: 'Tonight', tone: 'info', audience: { plans: [], countries: [] }, endsAt: new Date(Date.now() + 86_400_000).toISOString() } })
      return { params: { id: r.body.id } }
    },
    note: 'Announcements are platform rows targeted by plan/country; one outside the company’s segment answers 404 (targeted test in endpoints.isolation.test.ts). Dismissals are per user.',
  },
  { method: 'GET', path: '/platform/audit', kind: 'platform', module: 'audit log', reason: PLATFORM },
  { method: 'POST', path: '/platform/impersonations', kind: 'platform', module: 'platform', reason: PLATFORM + ' Issues an impersonation token bound to one user and company (tested in platform.isolation.test.ts).' },
  { method: 'ALL', path: '/platform/*', kind: 'platform', module: 'platform', reason: 'Catch-all: unknown /platform paths stay behind the platform gate (401 for any non-platform token, 404 otherwise).' },

  /* ---- dev billing simulation (handlers/devBilling.ts) ---- */
  { method: 'GET', path: '/dev/billing/state', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING, sample: () => ({}) },
  { method: 'POST', path: '/dev/billing/advance', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING + ' Moves the shared mock clock (the clock is global by nature); the lifecycle then runs per company.', sample: () => ({ body: { days: 0 }, expect: [200, 422] }) },
  { method: 'POST', path: '/dev/billing/status', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING, sample: () => ({ body: { status: 'active' }, expect: [200, 422] }) },
  { method: 'POST', path: '/dev/billing/fail-next-payment', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING, sample: () => ({ body: { fail: true } }) },
  { method: 'POST', path: '/dev/billing/usage', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING, sample: () => ({ body: { key: 'users', percent: 50 }, expect: [200, 422] }) },
  { method: 'POST', path: '/dev/billing/reset', kind: 'dev', module: 'billing/usage', reason: DEV_BILLING, sample: () => ({}) },
]

/** `METHOD /path` key of an entry or a handler. */
export const keyOf = (method: string, path: string) => `${method.toUpperCase()} ${path}`

/** Concrete path: every `:param` replaced (missing params → `x`), plus the query string. */
export function fill(path: string, params: Record<string, string> = {}, query: Record<string, string> = {}): string {
  const p = path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? 'x')).replace(/\*$/, 'nothing-here')
  const q = new URLSearchParams(query).toString()
  return q ? `${p}?${q}` : p
}

export const paramsOf = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1])

/** The other company of a sample (for readability in tests). */
export { other }
