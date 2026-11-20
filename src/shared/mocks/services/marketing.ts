import type { Lead, User } from '@/shared/types'
import type {
  AudienceFilter,
  AudiencePreview,
  BulkEmail,
  BulkEmailCounts,
  BulkEmailDetail,
  BulkEmailInput,
  BulkEmailRecipient,
  BulkEmailUpdateInput,
  Campaign,
  CampaignCost,
  CampaignCostInput,
  CampaignInput,
  CampaignResults,
  CampaignUpdateInput,
  MarketingOptions,
  MarketingReport,
  MarketingReportRow,
  SkipReason,
  TestSendResult,
} from '@/modules/marketing/types'
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, SKIP_REASONS } from '@/modules/marketing/types'
import { BODY_MAX, SUBJECT_MAX } from '@/modules/settings/templates/types'
import { buildTemplateContext, companyContextFor } from '@/modules/settings/templates/context'
import { renderTemplate, unknownVariables } from '@/modules/settings/templates/render'
import { emailBrandOf, renderEmailHtml } from '@/modules/settings/templates/emailLayout'
import { DEFAULT_BRANDING } from '@/modules/tenancy/branding'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { can } from '@/shared/lib/permissions'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { addDaysIso, weekStartIso } from '@/shared/lib/companyDay'
import { isRealIsoDate, zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { activities, leads, users } from '@/shared/mocks/db'
import { templates } from '@/shared/mocks/data/templates'
import { companyById } from '@/shared/mocks/data/tenancy'
import {
  bulkEmailRecipients,
  bulkEmails,
  campaignCosts,
  campaigns,
  nextMarketingId,
  queueState,
  type BulkEmailRecord,
  type CampaignCostRecord,
  type CampaignRecord,
  type RecipientRecord,
} from '@/shared/mocks/data/marketing'
import { lookupsFor, statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, limitDetails, onLifecycleTick, recordUsage, remainingCapacity, subOf, subPlan } from '@/shared/mocks/services/billing'
import { emailSenderOf } from '@/shared/mocks/services/messages'
import { audienceLeadIds } from '@/shared/mocks/services/audiences'

/* ------------------------------------------------------------------------------------------
 * Marketing (plan module `marketing`; every /marketing/* path is gated in userFrom →
 * enforceRequestPolicy → 403 module_not_in_plan). Role rights: the Marketing column of
 * PERMISSION_MATRIX (hidden → 403; view → read only; full → read and write). Everything is scoped
 * to the caller's company; another company's id answers exactly like a missing one (404 / 422).
 * Contract and rules: docs/API.md › Marketing.
 * ---------------------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MAX = 120
const NOT_FOUND = 'That campaign doesn’t exist.'
const EMAIL_NOT_FOUND = 'That bulk email doesn’t exist.'

/** Queue: one slot every SLOT_MS of mock-clock time sends at most SLOT_CAPACITY emails, BATCH per company per round. */
export const QUEUE = { SLOT_MS: 5_000, SLOT_CAPACITY: 100, BATCH: 25 }

/* ---------------- Access ---------------- */

async function requireView(user: User): Promise<string> {
  if (!can(user.role, 'marketing', 'view')) return fail('Your role has no access to Marketing.', 403)
  return tenantOf(user)
}

async function requireEdit(user: User): Promise<string> {
  const co = await requireView(user)
  if (!can(user.role, 'marketing', 'edit')) return fail('Your role can view marketing but not change it.', 403)
  return co
}

/** Marketing reports: Marketing view + a Reports scope of `full` or `marketing` (reports/lib/marketingAccess.ts). */
export const canSeeMarketingReports = canSeeMarketingReportsRole

/* ---------------- Helpers ---------------- */

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const round2 = (n: number) => Math.round(n * 100) / 100
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
const untenant = <T extends { companyId: string }>(row: T): Omit<T, 'companyId'> => {
  const { companyId: _c, ...rest } = row
  return rest
}

function regionOf(co: string) {
  const r = companyById(co)?.regional
  return { currency: r?.currency ?? DEFAULT_REGION.currency, timezone: r?.timezone ?? DEFAULT_REGION.timezone }
}

function companyUser(co: string, id: string | null | undefined): User | undefined {
  return id ? users.find((u) => u.id === id && u.companyId === co) : undefined
}

/**
 * Statuses a bulk email never goes to (besides Do Not Contact): the built-in "Not interested" and any
 * company-added status of type `lost` (a custom refusal). The built-in "Lost" (a lost deal, not an
 * opt-out) stays mailable; leave it out of the audience's statuses to skip it.
 */
export function excludedStatusKeys(co: string): string[] {
  return lookupsFor(co)
    .statuses.filter((s) => s.key === SYSTEM_STATUS.notInterested || (s.type === 'lost' && !s.system))
    .map((s) => s.key)
}

/** Why a lead can't get a bulk email right now (null = it can). Duplicates are decided per send. */
function exclusionOf(lead: Lead, excluded: string[]): SkipReason | null {
  if (lead.doNotContact) return 'dnc'
  if (excluded.includes(lead.status)) return 'not_interested'
  if (!EMAIL_RE.test(lead.contactEmail?.trim() ?? '')) return 'no_email'
  return null
}

const EMPTY_AUDIENCE: AudienceFilter = { industries: [], statuses: [], sources: [], ownerIds: [] }

function matches(lead: Lead, a: AudienceFilter): boolean {
  return (
    (!a.industries.length || a.industries.includes(lead.industry)) &&
    (!a.statuses.length || a.statuses.includes(lead.status)) &&
    (!a.sources.length || a.sources.includes(lead.sourceType)) &&
    (!a.ownerIds.length || a.ownerIds.includes(lead.ownerId))
  )
}

interface Planned {
  lead: Tenant<Lead>
  email: string
  skip: SkipReason | null
}

/**
 * The audience of a send, in a stable order (lead id), each lead with its exclusion (if any). A saved
 * audience (`audienceId`) is resolved NOW (dynamic rules re-applied; a deleted one = nobody), then
 * the filters narrow it; every exclusion rule below still applies.
 */
function planAudience(co: string, audience: AudienceFilter): Planned[] {
  const excluded = excludedStatusKeys(co)
  const seen = new Set<string>()
  const saved = audience.audienceId ? (audienceLeadIds(co, audience.audienceId) ?? new Set<string>()) : null
  return leads
    .filter((l) => l.companyId === co && (!saved || saved.has(l.id)) && matches(l, audience))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((lead) => {
      const email = lead.contactEmail?.trim().toLowerCase() ?? ''
      let skip = exclusionOf(lead, excluded)
      if (!skip) {
        if (seen.has(email)) skip = 'duplicate'
        else seen.add(email)
      }
      return { lead, email, skip }
    })
}

/* ---------------- Views ---------------- */

function leadsOfCampaign(co: string, id: string) {
  return leads.filter((l) => l.companyId === co && l.campaignId === id)
}
const isWon = (co: string, l: Lead) => statusOf(co, l.status)?.type === 'won'
const spendOf = (co: string, id: string) => round2(campaignCosts.filter((c) => c.companyId === co && c.campaignId === id).reduce((s, c) => s + c.amount, 0))

function campaignView(c: Tenant<CampaignRecord>): Campaign {
  const attributed = leadsOfCampaign(c.companyId, c.id)
  const spend = spendOf(c.companyId, c.id)
  return {
    ...untenant(c),
    ownerName: c.ownerId ? ownerName(c.ownerId) : '',
    spend,
    leads: attributed.length,
    won: attributed.filter((l) => isWon(c.companyId, l)).length,
    costPerLead: attributed.length ? round2(spend / attributed.length) : null,
  }
}

function costView(c: Tenant<CampaignCostRecord>): CampaignCost {
  return untenant(c)
}

const visible = (at: string | null, now: number) => !!at && Date.parse(at) <= now

function countsOf(e: Tenant<BulkEmailRecord>, now = nowMs()): BulkEmailCounts {
  const rows = bulkEmailRecipients.filter((r) => r.companyId === e.companyId && r.bulkEmailId === e.id)
  const skippedBy = Object.fromEntries(SKIP_REASONS.map((k) => [k, 0])) as Record<SkipReason, number>
  let queued = 0
  let sent = 0
  let skipped = 0
  let failed = 0
  let opened = 0
  let replied = 0
  for (const r of rows) {
    if (r.status === 'queued') queued++
    else if (r.status === 'failed') failed++
    else if (r.status === 'skipped') {
      skipped++
      if (r.skipReason) skippedBy[r.skipReason]++
    } else {
      sent++
      if (visible(r.openedAt, now)) opened++
      if (visible(r.repliedAt, now)) replied++
    }
  }
  return { recipients: rows.length, queued, sent, skipped, failed, opened, replied, openRate: rate(opened, sent), replyRate: rate(replied, sent), skippedBy }
}

function emailView(e: Tenant<BulkEmailRecord>): BulkEmail {
  const { timezone } = regionOf(e.companyId)
  const campaign = e.campaignId ? campaigns.find((c) => c.companyId === e.companyId && c.id === e.campaignId) : undefined
  const local = e.scheduledAt ? zonedParts(e.scheduledAt, timezone) : null
  return {
    ...untenant(e),
    audience: { ...e.audience },
    campaignName: campaign?.name ?? null,
    scheduledLocal: local ? `${local.date}T${local.time}` : null,
    timezone,
    createdByName: ownerName(e.createdBy),
    counts: countsOf(e),
  }
}

function recipientView(r: Tenant<RecipientRecord>, now: number): BulkEmailRecipient {
  const lead = r.leadId ? leads.find((l) => l.id === r.leadId && l.companyId === r.companyId) : undefined
  return {
    id: r.id,
    leadId: r.leadId,
    contactId: r.contactId,
    company: lead?.company ?? '',
    name: lead?.contactName ?? '',
    email: r.email,
    status: r.status,
    skipReason: r.skipReason,
    sentAt: r.sentAt,
    openedAt: visible(r.openedAt, now) ? r.openedAt : null,
    repliedAt: visible(r.repliedAt, now) ? r.repliedAt : null,
  }
}

function detailView(e: Tenant<BulkEmailRecord>): BulkEmailDetail {
  const now = nowMs()
  const rows = bulkEmailRecipients.filter((r) => r.companyId === e.companyId && r.bulkEmailId === e.id).sort((a, b) => a.seq - b.seq)
  return { ...emailView(e), recipients: rows.map((r) => recipientView(r, now)) }
}

/* ---------------- Campaigns ---------------- */

export async function getCampaigns(user: User, q: { status?: string } = {}): Promise<Campaign[]> {
  await requireView(user)
  const list = scoped(campaigns, user)
    .filter((c) => !q.status || c.status === q.status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(list.map(campaignView))
}

async function campaignFor(user: User, id: string): Promise<Tenant<CampaignRecord>> {
  const c = findInTenant(campaigns, user, (x) => x.id === id)
  if (!c) return fail(NOT_FOUND, 404)
  return c
}

export async function getCampaign(user: User, id: string): Promise<Campaign> {
  await requireView(user)
  return delay(campaignView(await campaignFor(user, id)))
}

/** Validates a create / update body; returns the cleaned fields or an error message. */
function campaignFields(co: string, input: Partial<CampaignInput>, existing?: CampaignRecord): Partial<CampaignRecord> | string {
  const out: Partial<CampaignRecord> = {}
  if (input.name !== undefined || !existing) {
    const name = clean(input.name)
    if (!name) return 'Give the campaign a name.'
    if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
    const taken = campaigns.some((c) => c.companyId === co && c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase())
    if (taken) return `A campaign called “${name}” already exists.`
    out.name = name
  }
  if (input.channel !== undefined || !existing) {
    if (!CAMPAIGN_CHANNELS.includes(input.channel as never)) return 'Pick a channel: email, social, ads, event, referral or other.'
    out.channel = input.channel
  }
  if (input.status !== undefined) {
    if (!CAMPAIGN_STATUSES.includes(input.status as never)) return 'Pick a status: draft, active, paused or completed.'
    out.status = input.status
  }
  if (input.budget !== undefined) {
    if (input.budget !== null && (typeof input.budget !== 'number' || !Number.isFinite(input.budget) || input.budget < 0)) {
      return 'The budget must be a positive amount.'
    }
    out.budget = input.budget === null ? null : round2(input.budget)
  }
  for (const key of ['startDate', 'endDate'] as const) {
    const v = input[key]
    if (v === undefined) continue
    if (v !== null && v !== '' && !isRealIsoDate(v)) return 'Dates use the format YYYY-MM-DD.'
    out[key] = v || null
  }
  const start = out.startDate !== undefined ? out.startDate : (existing?.startDate ?? null)
  const end = out.endDate !== undefined ? out.endDate : (existing?.endDate ?? null)
  if (start && end && end < start) return 'The end date must be on or after the start date.'
  if (input.goal !== undefined) out.goal = clean(input.goal).slice(0, 2000)
  if (input.sourceDetail !== undefined) out.sourceDetail = clean(input.sourceDetail).slice(0, 255)
  if (input.targetLeads !== undefined) {
    const t = input.targetLeads
    if (t !== null && (typeof t !== 'number' || !Number.isInteger(t) || t < 0)) return 'The lead target must be a whole number.'
    out.targetLeads = t
  }
  if (input.ownerId !== undefined) {
    if (input.ownerId) {
      const owner = companyUser(co, input.ownerId)
      // Another company's user answers exactly like a missing one.
      if (!owner || owner.active === false) return 'Pick an owner from your team.'
    }
    out.ownerId = input.ownerId || null
  }
  return out
}

export async function createCampaign(user: User, input: Partial<CampaignInput>): Promise<Campaign> {
  const co = await requireEdit(user)
  const fields = campaignFields(co, input ?? {})
  if (typeof fields === 'string') return fail(fields, 422)
  const at = new Date(nowMs()).toISOString()
  const row: Tenant<CampaignRecord> = stamp(
    {
      id: nextMarketingId('CMP'),
      name: fields.name!,
      channel: fields.channel!,
      status: fields.status ?? 'draft',
      budget: fields.budget ?? null,
      currency: regionOf(co).currency,
      startDate: fields.startDate ?? null,
      endDate: fields.endDate ?? null,
      goal: fields.goal ?? '',
      targetLeads: fields.targetLeads ?? null,
      ownerId: fields.ownerId !== undefined ? fields.ownerId : user.id,
      sourceDetail: fields.sourceDetail ?? '',
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  campaigns.push(row)
  return delay(campaignView(row))
}

export async function updateCampaign(user: User, id: string, input: CampaignUpdateInput): Promise<Campaign> {
  const co = await requireView(user)
  const c = await campaignFor(user, id)
  await requireEdit(user)
  const fields = campaignFields(co, input ?? {}, c)
  if (typeof fields === 'string') return fail(fields, 422)
  Object.assign(c, fields, { updatedAt: new Date(nowMs()).toISOString() })
  return delay(campaignView(c))
}

export async function addCampaignCost(user: User, id: string, input: Partial<CampaignCostInput>): Promise<CampaignCost> {
  await requireView(user)
  const c = await campaignFor(user, id)
  await requireEdit(user)
  const amount = input?.amount
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return fail('Enter the amount spent.', 422)
  if (!isRealIsoDate(input.date)) return fail('Pick the date the money was spent (YYYY-MM-DD).', 422)
  const row: Tenant<CampaignCostRecord> = stamp(
    { id: nextMarketingId('CC'), campaignId: c.id, date: input.date, amount: round2(amount), note: clean(input.note).slice(0, 255), createdAt: new Date(nowMs()).toISOString() },
    user,
  )
  campaignCosts.push(row)
  c.updatedAt = row.createdAt
  return delay(costView(row))
}

export async function getCampaignResults(user: User, id: string): Promise<CampaignResults> {
  const co = await requireView(user)
  const c = await campaignFor(user, id)
  const campaign = campaignView(c)
  const attributed = leadsOfCampaign(co, c.id)
  const won = attributed.filter((l) => isWon(co, l))
  const wonValue = round2(won.reduce((s, l) => s + (l.value || 0), 0))
  const emails = bulkEmails.filter((e) => e.companyId === co && e.campaignId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const views = emails.map(emailView)
  const sent = views.reduce((s, e) => s + e.counts.sent, 0)
  const opened = views.reduce((s, e) => s + e.counts.opened, 0)
  const replied = views.reduce((s, e) => s + e.counts.replied, 0)
  const spend = campaign.spend

  // Weekly buckets (company week start), from the campaign start (or first lead) to its end (or today).
  const { timezone } = regionOf(co)
  const weekStartsOn = companyById(co)?.regional.weekStartsOn ?? DEFAULT_REGION.weekStartsOn
  const dayOf = (iso: string) => zonedParts(iso, timezone).date
  const today = zonedParts(nowMs(), timezone).date
  const firstLead = attributed.map((l) => dayOf(l.createdAt)).sort()[0]
  const from = weekStartIso(c.startDate ?? firstLead ?? today, weekStartsOn)
  const lastDay = [c.endDate && c.endDate < today ? c.endDate : today, ...attributed.map((l) => dayOf(l.createdAt))].sort().pop()!
  const timeline: CampaignResults['timeline'] = []
  for (let w = from, i = 0; w <= lastDay && i < 104; w = addDaysIso(w, 7), i++) {
    const end = addDaysIso(w, 7)
    const inWeek = (iso: string | null | undefined) => !!iso && dayOf(iso) >= w && dayOf(iso) < end
    timeline.push({
      week: w,
      leads: attributed.filter((l) => inWeek(l.createdAt)).length,
      won: won.filter((l) => inWeek(l.wonAt ?? l.stageChangedAt)).length,
    })
  }

  return delay({
    campaign,
    costs: campaignCosts.filter((x) => x.companyId === co && x.campaignId === c.id).sort((a, b) => b.date.localeCompare(a.date)).map(costView),
    emails: views,
    kpis: {
      leads: attributed.length,
      won: won.length,
      wonValue,
      spend,
      budget: c.budget,
      costPerLead: attributed.length ? round2(spend / attributed.length) : null,
      costPerWon: won.length ? round2(spend / won.length) : null,
      sent,
      opened,
      replied,
      openRate: rate(opened, sent),
      replyRate: rate(replied, sent),
      targetLeads: c.targetLeads,
    },
    timeline,
  })
}

/* ---------------- Options ---------------- */

export async function getMarketingOptions(user: User): Promise<MarketingOptions> {
  const co = await requireView(user)
  const { currency, timezone } = regionOf(co)
  return delay({
    currency,
    timezone,
    owners: users
      .filter((u) => u.companyId === co && u.active !== false)
      .map((u) => ({ id: u.id, name: u.name, role: u.role }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    templates: scoped(templates, user)
      .filter((t) => t.channel === 'email' && t.active)
      .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, purpose: t.purpose })),
    campaigns: scoped(campaigns, user).map((c) => ({ id: c.id, name: c.name, status: c.status })),
    excludedStatuses: excludedStatusKeys(co),
  })
}

/* ---------------- Bulk emails ---------------- */

async function emailFor(user: User, id: string): Promise<Tenant<BulkEmailRecord>> {
  const e = findInTenant(bulkEmails, user, (x) => x.id === id)
  if (!e) return fail(EMAIL_NOT_FOUND, 404)
  return e
}

export async function getBulkEmails(user: User, q: { status?: string; campaignId?: string } = {}): Promise<BulkEmail[]> {
  await requireView(user)
  const list = scoped(bulkEmails, user)
    .filter((e) => (!q.status || e.status === q.status) && (!q.campaignId || e.campaignId === q.campaignId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return delay(list.map(emailView))
}

export async function getBulkEmail(user: User, id: string): Promise<BulkEmailDetail> {
  await requireView(user)
  return delay(detailView(await emailFor(user, id)))
}

const strings = (v: unknown): string[] | null =>
  v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null

/** Validates an audience: list values must be strings; owners must be users of the company. */
function audienceOf(co: string, raw: Partial<AudienceFilter> | undefined): AudienceFilter | string {
  const a = raw ?? {}
  const industries = strings(a.industries)
  const statuses = strings(a.statuses)
  const sources = strings(a.sources)
  const ownerIds = strings(a.ownerIds)
  if (!industries || !statuses || !sources || !ownerIds) return 'The target list must be lists of industries, statuses, sources and owners.'
  if (ownerIds.some((id) => !companyUser(co, id))) return 'Pick owners from your team.'
  // A saved audience of the company (another company's id answers like a missing one).
  const audienceId = typeof a.audienceId === 'string' ? a.audienceId.trim() : ''
  if (a.audienceId !== undefined && a.audienceId !== null && typeof a.audienceId !== 'string') return 'The audience must be an audience id.'
  if (audienceId && !audienceLeadIds(co, audienceId)) return 'That audience doesn’t exist.'
  return { industries, statuses, sources, ownerIds, ...(audienceId ? { audienceId } : {}) }
}

function emailFields(co: string, input: BulkEmailUpdateInput, creating: boolean): Partial<BulkEmailRecord> | string {
  const out: Partial<BulkEmailRecord> = {}
  if (input.name !== undefined || creating) {
    const name = clean(input.name)
    if (!name) return 'Give the bulk email a name.'
    if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
    out.name = name
  }
  if (input.campaignId !== undefined) {
    if (input.campaignId && !campaigns.some((c) => c.companyId === co && c.id === input.campaignId)) return NOT_FOUND
    out.campaignId = input.campaignId || null
  }
  if (input.templateId !== undefined) {
    if (input.templateId) {
      const t = templates.find((x) => x.companyId === co && x.id === input.templateId)
      if (!t || t.channel !== 'email') return 'That template doesn’t exist for email.'
      // Starting from a template: its subject and body, unless the request brings its own.
      if (input.subject === undefined) out.subject = t.subject
      if (input.body === undefined) out.body = t.body
    }
    out.templateId = input.templateId || null
  }
  if (input.subject !== undefined) {
    const subject = clean(input.subject)
    if (subject.length > SUBJECT_MAX) return `Keep the subject under ${SUBJECT_MAX} characters.`
    out.subject = subject
  }
  if (input.body !== undefined) {
    const body = typeof input.body === 'string' ? input.body : ''
    if (body.length > BODY_MAX) return `Keep the message under ${BODY_MAX.toLocaleString()} characters.`
    out.body = body
  }
  if (input.audience !== undefined || creating) {
    const audience = audienceOf(co, input.audience)
    if (typeof audience === 'string') return audience
    out.audience = audience
  }
  return out
}

export async function createBulkEmail(user: User, input: BulkEmailInput): Promise<BulkEmailDetail> {
  const co = await requireEdit(user)
  const fields = emailFields(co, input ?? ({} as BulkEmailInput), true)
  if (typeof fields === 'string') return fail(fields, 422)
  const at = new Date(nowMs()).toISOString()
  const row: Tenant<BulkEmailRecord> = stamp(
    {
      id: nextMarketingId('BE'),
      name: fields.name!,
      campaignId: fields.campaignId ?? null,
      templateId: fields.templateId ?? null,
      subject: fields.subject ?? '',
      body: fields.body ?? '',
      audience: fields.audience ?? { ...EMPTY_AUDIENCE },
      status: 'draft',
      scheduledAt: null,
      startedAt: null,
      sentAt: null,
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  bulkEmails.push(row)
  return delay(detailView(row))
}

/** Only drafts and scheduled sends can change (a scheduled send is checked again when it starts). */
export async function updateBulkEmail(user: User, id: string, input: BulkEmailUpdateInput): Promise<BulkEmailDetail> {
  const co = await requireView(user)
  const e = await emailFor(user, id)
  await requireEdit(user)
  if (e.status !== 'draft' && e.status !== 'scheduled') return fail('This bulk email has started sending and can’t be changed.', 409)
  const fields = emailFields(co, input ?? {}, false)
  if (typeof fields === 'string') return fail(fields, 422)
  Object.assign(e, fields, { updatedAt: new Date(nowMs()).toISOString() })
  return delay(detailView(e))
}

/** DELETE: cancels a draft, a scheduled send, or the rest of a send in progress (queued → skipped "cancelled"). */
export async function cancelBulkEmail(user: User, id: string): Promise<BulkEmailDetail> {
  await requireView(user)
  const e = await emailFor(user, id)
  await requireEdit(user)
  if (e.status === 'sent' || e.status === 'cancelled') return fail(`This bulk email is already ${e.status}.`, 409)
  for (const r of bulkEmailRecipients) {
    if (r.companyId === e.companyId && r.bulkEmailId === e.id && r.status === 'queued') {
      r.status = 'skipped'
      r.skipReason = 'cancelled'
    }
  }
  e.status = 'cancelled'
  e.updatedAt = new Date(nowMs()).toISOString()
  return delay(detailView(e))
}

/**
 * Emails still promised this period by the company's other pending sends: the eligible audience of
 * scheduled ones and the queued recipients of the ones sending.
 */
function reservedEmails(co: string, exceptId: string): number {
  let n = 0
  for (const e of bulkEmails) {
    if (e.companyId !== co || e.id === exceptId) continue
    if (e.status === 'scheduled') n += planAudience(co, e.audience).filter((p) => !p.skip).length
    if (e.status === 'sending') n += bulkEmailRecipients.filter((r) => r.companyId === co && r.bulkEmailId === e.id && r.status === 'queued').length
  }
  return n
}

/** Emails this send may still use: the plan's monthly allowance left minus other pending sends (null = unlimited). */
function availableFor(co: string, exceptId: string): number | null {
  const left = remainingCapacity(co, 'emailsPerMonth')
  return left === Infinity ? null : Math.max(0, left - reservedEmails(co, exceptId))
}

export async function previewAudience(user: User, id: string, override?: Partial<AudienceFilter>): Promise<AudiencePreview> {
  const co = await requireView(user)
  const e = await emailFor(user, id)
  let audience = e.audience
  if (override && Object.keys(override).length) {
    const a = audienceOf(co, override)
    if (typeof a === 'string') return fail(a, 422)
    audience = a
  }
  const plan = planAudience(co, audience)
  const count = (k: SkipReason) => plan.filter((p) => p.skip === k).length
  const eligible = plan.filter((p) => !p.skip)
  return delay({
    matched: plan.length,
    eligible: eligible.length,
    excluded: { dnc: count('dnc'), notInterested: count('not_interested'), noEmail: count('no_email'), duplicate: count('duplicate') },
    excludedStatuses: excludedStatusKeys(co),
    available: availableFor(co, e.id),
    sample: eligible.slice(0, 5).map((p) => ({ leadId: p.lead.id, company: p.lead.company, name: p.lead.contactName, email: p.lead.contactEmail })),
  })
}

/** What every send checks first (schedule, send now): content, sender, audience and the monthly email limit. */
async function assertSendable(user: User, e: Tenant<BulkEmailRecord>): Promise<void> {
  const co = e.companyId
  if (e.status !== 'draft' && e.status !== 'scheduled') return fail(`This bulk email is already ${e.status}.`, 409)
  if (!e.subject.trim()) return fail('Add a subject.', 422)
  if (!e.body.trim()) return fail('The message can’t be empty.', 422)
  const unknown = unknownVariables(`${e.subject}\n${e.body}`)
  if (unknown.length) return fail(`Fix or remove {{${unknown[0]}}}: it isn’t a template variable.`, 422)
  if (!emailSenderOf(user).address) return fail('Set the email sender in Settings > Branding before sending emails.', 422)
  const eligible = planAudience(co, e.audience).filter((p) => !p.skip).length
  if (eligible === 0) return fail('Nobody in this target list can receive the email. Widen the filters.', 422)
  const available = availableFor(co, e.id)
  if (available !== null && eligible > available) {
    // Policy: refuse the whole send up front (402), never send part of it silently.
    const d = limitDetails(co, 'emailsPerMonth')
    const plan = subPlan(subOf(co))
    throw new CodedApiError(
      `This send needs ${eligible.toLocaleString('en-US')} emails but only ${available.toLocaleString('en-US')} are left this period on your ${plan.name} plan. Narrow the target list or upgrade.`,
      402,
      'LIMIT_REACHED',
      { limit: d.limit, current: d.current, max: d.max, planId: d.planId, requested: eligible, available },
    )
  }
}

export async function scheduleBulkEmail(user: User, id: string, body: { scheduledAt?: unknown }): Promise<BulkEmailDetail> {
  await requireView(user)
  const e = await emailFor(user, id)
  await requireEdit(user)
  const local = typeof body?.scheduledAt === 'string' ? body.scheduledAt.trim() : ''
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local)
  if (!m || !isRealIsoDate(m[1]) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(m[2])) {
    return fail('Pick the date and time to send, in your company’s timezone (YYYY-MM-DDTHH:mm).', 422)
  }
  const at = Date.parse(zonedToUtc(m[1], m[2], regionOf(e.companyId).timezone))
  if (at <= nowMs()) return fail('Pick a time in the future.', 422)
  if (at > nowMs() + 366 * 86_400_000) return fail('Schedule within the next year.', 422)
  await assertSendable(user, e)
  e.status = 'scheduled'
  e.scheduledAt = new Date(at).toISOString()
  e.updatedAt = new Date(nowMs()).toISOString()
  return delay(detailView(e))
}

export async function sendBulkEmailNow(user: User, id: string): Promise<BulkEmailDetail> {
  await requireView(user)
  const e = await emailFor(user, id)
  await requireEdit(user)
  await assertSendable(user, e)
  startSend(e, nowMs())
  return delay(detailView(e))
}

/** POST /marketing/emails/:id/test: renders the email for the first eligible lead and "sends" it to `to` (counts 1 email). */
export async function testBulkEmail(user: User, id: string, body: { to?: unknown }): Promise<TestSendResult> {
  await requireView(user)
  const e = await emailFor(user, id)
  await requireEdit(user)
  const to = clean(body?.to)
  if (!EMAIL_RE.test(to)) return fail(to ? `${to} isn’t a valid email address.` : 'Enter the address to send the test to.', 422)
  if (!e.subject.trim() || !e.body.trim()) return fail('Add a subject and a message first.', 422)
  const sender = emailSenderOf(user)
  if (!sender.address) return fail('Set the email sender in Settings > Branding before sending emails.', 422)
  assertCapacity(e.companyId, 'emailsPerMonth')
  const lead = planAudience(e.companyId, e.audience).find((p) => !p.skip)?.lead ?? null
  const rendered = renderFor(e, lead)
  recordUsage(e.companyId, 'emailsPerMonth')
  return delay({ to, from: `${sender.name} <${sender.address}>`, subject: `[Test] ${rendered.subject}`, html: rendered.html })
}

/** The email as a recipient gets it: variables filled from the lead, the sender and the company; branded layout. */
function renderFor(e: Tenant<BulkEmailRecord>, lead: Lead | null): { subject: string; html: string } {
  const co = e.companyId
  const company = companyById(co) ?? null
  const agent = users.find((u) => u.id === e.createdBy)
  const label = (list: 'industries' | 'sources', key: string) => lookupsFor(co)[list].find((x) => x.key === key)?.label ?? key
  const ctx = {
    ...buildTemplateContext({
      lead,
      agent: agent ? { name: agent.name, email: agent.email, title: agent.title, mobile: agent.mobile } : undefined,
      labels: { status: (k) => statusOf(co, k)?.label ?? k, industry: (k) => label('industries', k), source: (k) => label('sources', k) },
    }),
    company: companyContextFor(company),
  }
  const subject = renderTemplate(e.subject, ctx)
  const body = renderTemplate(e.body, ctx)
  return { subject, html: renderEmailHtml({ brand: emailBrandOf(company?.branding ?? DEFAULT_BRANDING), subject, body }) }
}

/* ---------------- The send queue (fair across companies, mock-clock driven) ---------------- */

/**
 * Starts a send: the audience is resolved NOW (scheduled sends: at their scheduled time), one
 * recipient row per matching lead (unique email per send). Excluded leads are stored as skipped with
 * their reason; the rest are queued. If the company's monthly allowance shrank since scheduling, the
 * recipients beyond it are skipped with reason `limit` (visible in the results, never silent).
 */
function startSend(e: Tenant<BulkEmailRecord>, at: number): void {
  const co = e.companyId
  const iso = new Date(at).toISOString()
  const plan = planAudience(co, e.audience)
  let room = availableFor(co, e.id) ?? Infinity
  plan.forEach((p, i) => {
    let skip = p.skip
    if (!skip && room <= 0) skip = 'limit'
    if (!skip) room--
    bulkEmailRecipients.push({
      companyId: co,
      id: nextMarketingId('BER'),
      bulkEmailId: e.id,
      leadId: p.lead.id,
      contactId: null,
      email: p.email || p.lead.contactEmail || '',
      status: skip ? 'skipped' : 'queued',
      skipReason: skip,
      queuedAt: iso,
      seq: i,
      sentAt: null,
      openedAt: null,
      repliedAt: null,
    })
  })
  e.status = 'sending'
  e.startedAt = iso
  e.updatedAt = iso
  finishIfDone(e, at)
}

function finishIfDone(e: Tenant<BulkEmailRecord>, at: number): void {
  if (e.status !== 'sending') return
  const rows = bulkEmailRecipients.filter((r) => r.companyId === e.companyId && r.bulkEmailId === e.id)
  if (rows.some((r) => r.status === 'queued')) return
  e.status = 'sent'
  e.sentAt = rows.map((r) => r.sentAt).filter((x): x is string => !!x).sort().pop() ?? new Date(at).toISOString()
  e.updatedAt = e.sentAt
}

/** FNV-1a: the deterministic engagement of a recipient. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h
}

/** Dev / test hook: `globalThis.__apexMarketingEngagement = 'all' | 'none'` forces opens and replies (never read in production). */
function forcedEngagement(): 'all' | 'none' | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return null
  const v = (globalThis as { __apexMarketingEngagement?: unknown }).__apexMarketingEngagement
  return v === 'all' || v === 'none' ? v : null
}

const MINUTE = 60_000

/** Simulated engagement: ~45% open 1–30 min after delivery, ~12% of all reply 5–120 min after opening. */
function engagementOf(r: RecipientRecord, at: number): { openedAt: string | null; repliedAt: string | null } {
  const forced = forcedEngagement()
  if (forced === 'all') return { openedAt: new Date(at).toISOString(), repliedAt: new Date(at).toISOString() }
  if (forced === 'none') return { openedAt: null, repliedAt: null }
  const h = hash(`${r.id}|${r.email}`)
  const bucket = h % 100
  if (bucket >= 45) return { openedAt: null, repliedAt: null }
  const opened = at + (1 + (h % 30)) * MINUTE
  const replied = bucket < 12 ? opened + (5 + ((h >>> 8) % 116)) * MINUTE : null
  return { openedAt: new Date(opened).toISOString(), repliedAt: replied === null ? null : new Date(replied).toISOString() }
}

/**
 * Sends one queued recipient at `at`. The exclusions are checked AGAIN here (the lead may have
 * changed since it was queued): deleted lead, Do Not Contact, excluded status, no email; then the
 * plan's monthly allowance. Each email sent is logged as an activity on the lead.
 */
function deliver(r: Tenant<RecipientRecord>, e: Tenant<BulkEmailRecord>, at: number): boolean {
  const co = r.companyId
  const lead = r.leadId ? leads.find((l) => l.id === r.leadId && l.companyId === co) : undefined
  const skip: SkipReason | null = !lead ? 'removed' : exclusionOf(lead, excludedStatusKeys(co))
  if (skip) {
    r.status = 'skipped'
    r.skipReason = skip
    return false
  }
  if (remainingCapacity(co, 'emailsPerMonth') <= 0) {
    r.status = 'skipped'
    r.skipReason = 'limit'
    return false
  }
  const iso = new Date(at).toISOString()
  r.status = 'sent'
  r.sentAt = iso
  r.email = lead!.contactEmail.trim().toLowerCase() || r.email
  Object.assign(r, engagementOf(r, at))
  activities.push({
    companyId: co,
    id: `A-${r.id}`,
    leadId: lead!.id,
    type: 'email',
    summary: `Bulk email sent to ${lead!.contactName || r.email}: ${e.subject}`,
    userId: e.createdBy,
    at: iso,
  })
  recordUsage(co, 'emailsPerMonth')
  return true
}

/**
 * One queue slot at `slot`: at most SLOT_CAPACITY emails, taken round-robin across the companies with
 * queued recipients, BATCH per company per round, starting from a rotating cursor. A company with a
 * huge queue gets the same share per round as one with a small queue, so it never holds another up.
 */
function runSlot(slot: number): void {
  const due = bulkEmailRecipients.filter((r) => r.status === 'queued' && Date.parse(r.queuedAt) <= slot)
  const byCompany = new Map<string, Tenant<RecipientRecord>[]>()
  for (const r of due) {
    const list = byCompany.get(r.companyId) ?? []
    list.push(r)
    byCompany.set(r.companyId, list)
  }
  const companies = [...byCompany.keys()].sort()
  if (!companies.length) return
  for (const list of byCompany.values()) list.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.bulkEmailId.localeCompare(b.bulkEmailId) || a.seq - b.seq)
  const start = queueState.cursor % companies.length
  const order = [...companies.slice(start), ...companies.slice(0, start)]
  queueState.cursor = (queueState.cursor + 1) % 1_000_000
  const emailOf = new Map(bulkEmails.map((e) => [e.id, e]))
  const touched = new Set<Tenant<BulkEmailRecord>>()
  let capacity = QUEUE.SLOT_CAPACITY
  while (capacity > 0 && order.some((co) => byCompany.get(co)!.length)) {
    for (const co of order) {
      const list = byCompany.get(co)!
      const take = list.splice(0, Math.min(QUEUE.BATCH, capacity))
      for (const r of take) {
        const e = emailOf.get(r.bulkEmailId)
        if (!e || e.status !== 'sending') {
          r.status = 'skipped'
          r.skipReason = 'cancelled'
          continue
        }
        // Skipped recipients don't use the slot's capacity.
        if (deliver(r, e, slot)) capacity--
        touched.add(e)
      }
      if (capacity <= 0) break
    }
  }
  for (const e of touched) finishIfDone(e, slot)
}

const alignUp = (ms: number) => Math.ceil(ms / QUEUE.SLOT_MS) * QUEUE.SLOT_MS

/**
 * The queue worker, run lazily (every authenticated request's lifecycle tick, Dev › advance clock):
 * replays everything due up to `until` in time order — scheduled sends start at their time, then
 * one slot every SLOT_MS while recipients are queued. Global by nature (one sender for all
 * companies, like the real queue worker); idempotent.
 */
export function processMarketingQueue(until: number = nowMs()): void {
  for (let guard = 0; guard < 100_000; guard++) {
    const scheduled = bulkEmails.filter((e) => e.status === 'scheduled' && e.scheduledAt).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0]
    const nextStart = scheduled ? Date.parse(scheduled.scheduledAt!) : Infinity
    const queued = bulkEmailRecipients.filter((r) => r.status === 'queued')
    const earliest = queued.length ? Math.min(...queued.map((r) => Date.parse(r.queuedAt))) : Infinity
    const nextSlot = queued.length ? Math.max(queueState.lastSlot + QUEUE.SLOT_MS, alignUp(earliest)) : Infinity
    const t = Math.min(nextStart, nextSlot)
    if (t > until || t === Infinity) return
    if (nextStart <= nextSlot) startSend(scheduled!, nextStart)
    else {
      runSlot(nextSlot)
      queueState.lastSlot = nextSlot
    }
  }
}
onLifecycleTick('marketing.queue', (_companyId, until) => processMarketingQueue(until))

/* ---------------- Report: cost per lead by campaign ---------------- */

export async function getMarketingReport(user: User, q: { from?: string; to?: string }): Promise<MarketingReport> {
  const co = await requireView(user)
  if (!canSeeMarketingReports(user.role)) return fail('Your role has no access to marketing reports.', 403)
  if (!isRealIsoDate(q.from) || !isRealIsoDate(q.to)) return fail('Pick a valid date range (from and to).', 400)
  if (q.from > q.to) return fail('The start date must be on or before the end date.', 400)
  const { currency, timezone } = regionOf(co)
  const dayOf = (iso: string) => zonedParts(iso, timezone).date
  const inRange = (day: string) => day >= q.from! && day <= q.to!
  const periodLeads = leads.filter((l) => l.companyId === co && inRange(dayOf(l.createdAt)))
  const own = scoped(campaigns, user)
  const rowOf = (id: string | null): MarketingReportRow => {
    const c = id ? own.find((x) => x.id === id) : undefined
    const ls = periodLeads.filter((l) => (l.campaignId ?? null) === id)
    const won = ls.filter((l) => isWon(co, l))
    const spend = id ? round2(campaignCosts.filter((x) => x.companyId === co && x.campaignId === id && inRange(x.date)).reduce((s, x) => s + x.amount, 0)) : 0
    const recipients = id
      ? bulkEmailRecipients.filter((r) => r.companyId === co && r.status === 'sent' && r.sentAt && inRange(dayOf(r.sentAt)) && bulkEmails.some((e) => e.id === r.bulkEmailId && e.campaignId === id))
      : []
    const now = nowMs()
    return {
      campaignId: id,
      name: c?.name ?? 'No campaign',
      channel: c?.channel ?? null,
      status: c?.status ?? null,
      leads: ls.length,
      won: won.length,
      wonValue: round2(won.reduce((s, l) => s + (l.value || 0), 0)),
      spend,
      costPerLead: ls.length && id ? round2(spend / ls.length) : null,
      costPerWon: won.length && id ? round2(spend / won.length) : null,
      sent: recipients.length,
      opened: recipients.filter((r) => visible(r.openedAt, now)).length,
      replied: recipients.filter((r) => visible(r.repliedAt, now)).length,
    }
  }
  const rows = own.map((c) => rowOf(c.id)).filter((r) => r.leads || r.spend || r.sent || own.find((c) => c.id === r.campaignId)?.status === 'active')
  rows.sort((a, b) => b.spend - a.spend || b.leads - a.leads)
  const unattributed = rowOf(null)
  if (unattributed.leads) rows.push(unattributed)
  const sources = [...new Set(periodLeads.map((l) => l.sourceType))].sort().map((source) => {
    const ls = periodLeads.filter((l) => l.sourceType === source)
    return { source, leads: ls.length, attributed: ls.filter((l) => l.campaignId).length, won: ls.filter((l) => isWon(co, l)).length }
  })
  const attributed = periodLeads.filter((l) => l.campaignId).length
  const spend = round2(rows.reduce((s, r) => s + r.spend, 0))
  return delay({
    from: q.from,
    to: q.to,
    currency,
    rows,
    sources,
    totals: { leads: periodLeads.length, attributed, spend, costPerLead: attributed ? round2(spend / attributed) : null },
  })
}
