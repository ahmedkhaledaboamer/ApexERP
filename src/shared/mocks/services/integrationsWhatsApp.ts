import type { User } from '@/shared/types'
import type { WaConversation, WaSendOptions, WaSendResult, WaTemplate, WhatsAppIntegration } from '@/modules/integrations/types'
import { can, inScope, scopeOf } from '@/shared/lib/permissions'
import { formatMobile, normalizeMobile } from '@/shared/lib/phone'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { activeMembershipOf, companyById } from '@/shared/mocks/data/tenancy'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import {
  hintOf,
  integrationSecrets,
  nextIntegrationId,
  secretKey,
  waConversations,
  waTemplates,
  whatsappConfigs,
  type WaConversationRecord,
  type WaTemplateRecord,
} from '@/shared/mocks/data/integrations'
import { tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from './billing'
import { countryOf, insertLead, logActivity, salesTeamOf } from './leads'
import { addSync, bad, conflict, editCtx, forbidden, isObj, notFound, str, viewCtx } from './integrationsCore'

/**
 * Integrations › WhatsApp Business (Cloud API, simulated). Connect (phone number id, business account id, access
 * token — write-only) → verified number; message templates with {{n}} parameters and a simulated Meta review that
 * decides 10 s (mock clock) after submission (on the next request of the company: the lifecycle tick); template sends
 * from a lead (activity type `whatsapp`, Do Not Contact respected through `logActivity`); inbound messages simulated
 * into conversations, with "create lead from unknown number".
 */

export const REVIEW_MS = 10_000
const MAX_BODY = 1024
const roleOf = (user: User) => activeMembershipOf(user.id)?.role ?? user.role

/** Number of {{n}} parameters; they must be 1..n without gaps. */
export function templateParams(body: string): number {
  const nums = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) : 0
}
export function paramsProblem(body: string): string | null {
  const nums = new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))
  const max = nums.size ? Math.max(...nums) : 0
  for (let i = 1; i <= max; i++) if (!nums.has(i)) return `Parameters must be numbered {{1}} to {{${max}}} without gaps ({{${i}}} is missing).`
  if (/\{\{(?!\s*\d+\s*\}\})/.test(body)) return 'Use numbered parameters only, like {{1}}.'
  return null
}
/** The template body with its parameters filled in. */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`)
}

/** The simulated review: a shortened link or an all-caps / "!!!" promotional text is rejected. */
function reviewOf(t: WaTemplateRecord): { status: 'approved' | 'rejected'; reason: string | null } {
  if (/https?:\/\/(bit\.ly|tinyurl\.com|t\.co)\//i.test(t.body) || /!!!/.test(t.body)) {
    return { status: 'rejected', reason: 'Shortened links and pushy promotional text aren’t allowed (simulated review).' }
  }
  return { status: 'approved', reason: null }
}

/** Decides every template whose review time has passed (idempotent; called by the lifecycle tick). */
export function runTemplateReviews(co: string, until = nowMs()): number {
  let n = 0
  for (const t of waTemplates) {
    if (t.companyId !== co || t.status !== 'pending' || t.decideAt > until) continue
    const r = reviewOf(t)
    t.status = r.status
    t.rejectionReason = r.reason
    t.decidedAt = new Date(Math.max(t.decideAt, Date.parse(t.submittedAt))).toISOString()
    addSync(co, 'whatsapp', 'inbound', r.status === 'approved' ? 'success' : 'warning', `Template “${t.name}” was ${r.status} by the WhatsApp review.`, t.decidedAt)
    n++
  }
  return n
}

const templateView = (t: WaTemplateRecord): WaTemplate => ({
  id: t.id, name: t.name, language: t.language, category: t.category, body: t.body, params: templateParams(t.body),
  status: t.status, rejectionReason: t.rejectionReason, submittedAt: t.submittedAt, decidedAt: t.decidedAt,
})

function view(co: string): WhatsAppIntegration {
  runTemplateReviews(co)
  const c = whatsappConfigs.get(co)
  return {
    status: !c.connected ? 'not_connected' : c.paused ? 'paused' : c.lastError ? 'error' : 'connected',
    phoneNumberId: c.phoneNumberId,
    businessAccountId: c.businessAccountId,
    displayNumber: c.displayNumber,
    verifiedName: c.verifiedName,
    tokenHint: c.tokenHint,
    connectedAt: c.connectedAt,
    connectedBy: c.connectedBy,
    lastError: c.lastError,
    templates: waTemplates.filter((t) => t.companyId === co).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map(templateView),
  }
}

export async function getWhatsApp(user: User): Promise<WhatsAppIntegration> {
  return view(viewCtx(user))
}

/**
 * PUT /integrations/whatsapp { phone_number_id, business_account_id, access_token } — the (simulated) Graph API check
 * verifies the number: digits only (10–20), the display number follows the company's country. The token is write-only
 * (empty = keep the stored one).
 */
export async function connectWhatsApp(user: User, input: unknown): Promise<WhatsAppIntegration> {
  const co = editCtx(user)
  const b = isObj(input) ? input : {}
  const phoneNumberId = str(b.phoneNumberId, 30)
  const businessAccountId = str(b.businessAccountId, 30)
  if (!/^\d{10,20}$/.test(phoneNumberId)) bad('The phone number id is the 10–20 digit id from WhatsApp Manager.', 'invalid_phone_number_id')
  if (!/^\d{10,20}$/.test(businessAccountId)) bad('The business account id is the 10–20 digit WABA id.', 'invalid_business_account_id')
  const c = whatsappConfigs.get(co)
  const token = typeof b.accessToken === 'string' ? b.accessToken.trim() : ''
  const tokenKey = secretKey(co, 'whatsapp', 'token')
  if (!token && !integrationSecrets.has(tokenKey)) bad('Enter the permanent access token.', 'token_required')
  if (token && token.length < 20) bad('That access token looks too short.', 'invalid_token')
  if (token) integrationSecrets.set(tokenKey, token)
  const country = countryOf({ companyId: co })
  const dial = country === 'SA' ? '+966 11' : '+971 4'
  const was = c.connected
  Object.assign(c, {
    connected: true,
    paused: false,
    phoneNumberId,
    businessAccountId,
    displayNumber: `${dial} ${phoneNumberId.slice(-7, -4)} ${phoneNumberId.slice(-4)}`,
    verifiedName: c.verifiedName ?? companyById(co)?.branding.displayName ?? 'Business',
    tokenHint: token ? hintOf(token) : c.tokenHint,
    connectedAt: was ? c.connectedAt : nowIso(),
    connectedBy: was ? c.connectedBy : user.name,
    lastError: null,
  })
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'whatsapp', summary: `${was ? 'Updated' : 'Connected'} WhatsApp Business (${c.displayNumber})${token ? ', token changed' : ''}` })
  addSync(co, 'whatsapp', 'internal', 'success', `${was ? 'Updated' : 'Connected'} WhatsApp Business number ${c.displayNumber}.`)
  return view(co)
}

export async function disconnectWhatsApp(user: User): Promise<WhatsAppIntegration> {
  const co = editCtx(user)
  const c = whatsappConfigs.get(co)
  if (!c.connected) conflict('WhatsApp isn’t connected.', 'not_connected')
  integrationSecrets.delete(secretKey(co, 'whatsapp', 'token'))
  const number = c.displayNumber
  Object.assign(c, { connected: false, paused: false, tokenHint: null, lastError: null, connectedAt: null, connectedBy: null })
  recordAudit(user, { action: 'update', entity: 'integration', entityId: 'whatsapp', summary: `Disconnected WhatsApp Business (${number})` })
  addSync(co, 'whatsapp', 'internal', 'success', `WhatsApp number ${number} disconnected by ${user.name}.`)
  return view(co)
}

/** POST /integrations/whatsapp/templates — submitted for review (pending → approved / rejected after REVIEW_MS). */
export async function createTemplate(user: User, input: unknown): Promise<WhatsAppIntegration> {
  const co = editCtx(user)
  if (!whatsappConfigs.get(co).connected) conflict('Connect WhatsApp first.', 'not_connected')
  const b = isObj(input) ? input : {}
  const name = str(b.name, 60).toLowerCase()
  if (!/^[a-z0-9_]{3,60}$/.test(name)) bad('Template names use lowercase letters, digits and underscores (3–60).', 'invalid_name')
  const language = b.language === 'ar' || b.language === 'en' ? b.language : bad('Pick English or Arabic.')
  const category = b.category === 'marketing' || b.category === 'utility' || b.category === 'authentication' ? b.category : bad('Pick a category.')
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) bad('Write the message body.')
  if (body.length > MAX_BODY) bad(`Keep the body under ${MAX_BODY} characters.`)
  const p = paramsProblem(body)
  if (p) bad(p, 'invalid_params')
  if (waTemplates.some((t) => t.companyId === co && t.name === name && t.language === language)) conflict(`A template “${name}” in this language already exists.`, 'duplicate_template')
  const t: Tenant<WaTemplateRecord> = { companyId: co, id: nextIntegrationId('WAT'), name, language, category, body, status: 'pending', rejectionReason: null, submittedAt: nowIso(), decideAt: nowMs() + REVIEW_MS, decidedAt: null, createdBy: user.name }
  waTemplates.push(t)
  recordAudit(user, { action: 'create', entity: 'integration', entityId: t.id, summary: `Submitted the WhatsApp template “${name}” (${language})` })
  addSync(co, 'whatsapp', 'outbound', 'success', `Template “${name}” submitted for review.`)
  return view(co)
}

export async function deleteTemplate(user: User, id: string): Promise<WhatsAppIntegration> {
  const co = editCtx(user)
  const i = waTemplates.findIndex((t) => t.companyId === co && t.id === id)
  if (i < 0) notFound()
  const [t] = waTemplates.splice(i, 1)
  recordAudit(user, { action: 'delete', entity: 'integration', entityId: t.id, summary: `Deleted the WhatsApp template “${t.name}”` })
  return view(co)
}

/* ---------------- sending (sales) ---------------- */

function senderCtx(user: User): string {
  if (!can(roleOf(user), 'sales', 'edit')) forbidden('Your role can’t contact leads.')
  return tenantOf(user)
}

/** GET /integrations/whatsapp/send-options — approved templates for anyone who can contact leads. */
export async function sendOptions(user: User): Promise<WaSendOptions> {
  const co = senderCtx(user)
  runTemplateReviews(co)
  const c = whatsappConfigs.get(co)
  const live = c.connected && !c.paused
  return {
    connected: live,
    displayNumber: live ? c.displayNumber : null,
    templates: live ? waTemplates.filter((t) => t.companyId === co && t.status === 'approved').map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.body, params: templateParams(t.body) })) : [],
  }
}

/**
 * POST /integrations/whatsapp/messages { lead_id, template_id, to, params } — sends an approved template to a lead
 * contact (simulated Cloud API) and logs a `whatsapp` activity through `logActivity` (lead scope, Do Not Contact →
 * 422, New → Contacted). A foreign / unknown lead answers 404; a foreign / unknown / unapproved template 422.
 */
export async function sendTemplate(user: User, input: unknown): Promise<WaSendResult> {
  const co = senderCtx(user)
  const b = isObj(input) ? input : {}
  const lead = leads.find((l) => l.companyId === co && l.id === b.leadId) ?? notFound()
  if (!inScope(scopeOf(roleOf(user), 'sales'), user, lead.ownerId, salesTeamOf(user))) forbidden('This lead belongs to someone outside your access.')
  const c = whatsappConfigs.get(co)
  if (!c.connected) conflict('WhatsApp Business isn’t connected. Ask a Company Admin to connect it in Integrations.', 'not_connected')
  if (c.paused) conflict('WhatsApp sending is paused.', 'paused')
  runTemplateReviews(co)
  const t = waTemplates.find((x) => x.companyId === co && x.id === b.templateId && x.status === 'approved')
  if (!t) bad('Pick an approved template.', 'invalid_template')
  const n = templateParams(t!.body)
  const params = Array.isArray(b.params) ? b.params.map((p) => (typeof p === 'string' ? p.trim().slice(0, 200) : '')) : []
  if (params.length < n || params.slice(0, n).some((p) => !p)) bad(`Fill in all ${n} parameter${n === 1 ? '' : 's'}.`, 'params_required')
  const country = countryOf(user)
  const to = normalizeMobile(str(b.to, 40), country)
  if (!to) bad('Pick a valid mobile number for this lead.', 'invalid_to')
  const text = fillTemplate(t!.body, params.slice(0, n))
  const contact = contacts.find((x) => x.companyId === co && x.leadId === lead.id && normalizeMobile(x.mobile, country) === to)
  const who = contact?.name || formatMobile(to!, country)
  const activity = await logActivity(user, { leadId: lead.id, type: 'whatsapp', summary: `WhatsApp template “${t!.name}” to ${who}: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}` })
  // The conversation of that number gets the outbound message.
  const conv = waConversations.find((x) => x.companyId === co && x.from === to)
  const msg = { id: nextIntegrationId('WAM'), direction: 'out' as const, text, at: nowIso() }
  if (conv) {
    conv.messages.push(msg)
    conv.lastMessageAt = msg.at
    conv.leadId ??= lead.id
  } else {
    waConversations.push({ companyId: co, id: nextIntegrationId('WAC'), from: to!, name: who, leadId: lead.id, lastMessageAt: msg.at, messages: [msg] })
  }
  addSync(co, 'whatsapp', 'outbound', 'success', `Template “${t!.name}” sent to ${who} (lead ${lead.id}) by ${user.name}.`)
  return { text, activityId: activity.id }
}

/* ---------------- conversations ---------------- */

function convCtx(user: User): string {
  if (!can(roleOf(user), 'sales', 'view') && !can(roleOf(user), 'settings', 'view')) forbidden('Your role has no access to WhatsApp conversations.')
  return tenantOf(user)
}

const convView = (co: string, r: WaConversationRecord): WaConversation => ({
  id: r.id,
  from: r.from,
  name: r.name,
  leadId: r.leadId,
  leadCompany: r.leadId ? leads.find((l) => l.companyId === co && l.id === r.leadId)?.company ?? null : null,
  lastMessageAt: r.lastMessageAt,
  messages: r.messages.map((m) => ({ ...m })),
})

/** GET /integrations/whatsapp/conversations — inbound chats (sales view or settings view). */
export async function listConversations(user: User): Promise<WaConversation[]> {
  const co = convCtx(user)
  return waConversations
    .filter((c) => c.companyId === co)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .map((c) => convView(co, c))
}

/**
 * POST /integrations/whatsapp/inbound { from, name, text } — SIMULATION of the provider's inbound webhook (the real
 * backend receives it from Meta, signature-verified). A known lead's number links the chat to the lead (and logs a
 * `whatsapp` activity); an unknown number starts a conversation the team can turn into a lead.
 */
export async function simulateInbound(user: User, input: unknown): Promise<WaConversation> {
  const co = editCtx(user)
  const c = whatsappConfigs.get(co)
  if (!c.connected) conflict('Connect WhatsApp first.', 'not_connected')
  const b = isObj(input) ? input : {}
  const country = countryOf(user)
  const from = normalizeMobile(str(b.from, 40), country) ?? bad('Enter the sender’s mobile number.', 'invalid_from')
  const text = str(b.text, 1000) || bad('Write the message.')
  const at = nowIso()
  const known = leads.find((l) => l.companyId === co && (normalizeMobile(l.mobile, country) === from || contacts.some((x) => x.companyId === co && x.leadId === l.id && normalizeMobile(x.mobile, country) === from)))
  let conv = waConversations.find((x) => x.companyId === co && x.from === from)
  if (!conv) {
    conv = { companyId: co, id: nextIntegrationId('WAC'), from, name: str(b.name, 120) || (known ? known.contactName || known.company : 'Unknown sender'), leadId: known?.id ?? null, lastMessageAt: at, messages: [] }
    waConversations.push(conv)
  }
  conv.messages.push({ id: nextIntegrationId('WAM'), direction: 'in', text, at })
  conv.lastMessageAt = at
  if (known) {
    activities.push({ companyId: co, id: `A-WA-${nextIntegrationId('X')}`, leadId: known.id, type: 'whatsapp', summary: `WhatsApp from ${conv.name}: ${text.slice(0, 140)}`, userId: known.ownerId, at })
  }
  addSync(co, 'whatsapp', 'inbound', 'success', `Message from ${formatMobile(from, country)}${known ? ` (lead ${known.id})` : ' (unknown number)'}.`, at)
  return convView(co, conv)
}

/** POST /integrations/whatsapp/conversations/:id/lead { company? } — creates a lead from an unknown number (sales create). */
export async function createLeadFromConversation(user: User, id: string, input: unknown): Promise<WaConversation> {
  const co = convCtx(user)
  const conv = waConversations.find((x) => x.companyId === co && x.id === id) ?? notFound()
  if (!can(roleOf(user), 'sales', 'create')) forbidden('Your role can’t add leads.')
  if (conv.leadId) conflict('This conversation is already linked to a lead.', 'already_linked')
  const b = isObj(input) ? input : {}
  const name = conv.name === 'Unknown sender' ? '' : conv.name
  const company = str(b.company, 255) || name || `WhatsApp ${conv.from}`
  const lk = lookupsFor(co)
  const source = lk.sources.find((s) => s.active && /whatsapp/i.test(s.key))?.key ?? lk.sources.find((s) => s.active && s.key === 'Website')?.key ?? lk.sources.find((s) => s.active)!.key
  const industry = lk.industries.find((i) => i.active && /other/i.test(i.key)) ?? lk.industries.find((i) => i.active)!
  assertCapacity(co, 'leadsContacts', 2)
  const owner = can(roleOf(user), 'sales', 'create') && scopeOf(roleOf(user), 'sales') !== 'view' ? user : users.find((u) => u.companyId === co && u.role === 'Company Admin')!
  const lead = insertLead(owner, {
    company,
    sourceType: source,
    sourceDetail: 'WhatsApp inbound',
    industry: industry.key,
    contacts: [{ name: name || company, title: '', mobile: conv.from, email: '', isDecisionMaker: false }],
    nextFollowUpDate: null,
    note: ['Created from a WhatsApp conversation.', ...conv.messages.filter((m) => m.direction === 'in').map((m) => `> ${m.text}`)].join('\n').slice(0, 4000),
  })
  noteUsage(co)
  conv.leadId = lead.id
  addSync(co, 'whatsapp', 'internal', 'success', `Lead ${lead.id} created from WhatsApp ${conv.from} by ${user.name}.`)
  return convView(co, conv)
}
