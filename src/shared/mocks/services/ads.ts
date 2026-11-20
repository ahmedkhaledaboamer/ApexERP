import type { Activity, User } from '@/shared/types'
import {
  AD_PROVIDERS,
  AD_PROVIDER_LABEL,
  LEAD_AD_PROVIDERS,
  type AdAccountOption,
  type AdCampaign,
  type AdCampaignMapInput,
  type AdConnectInput,
  type AdConnection,
  type AdConnectionDetail,
  type AdObjective,
  type AdProvider,
  type AdSyncRun,
  type AdSyncTrigger,
  type AdTotals,
  type LeadSubmissionOutcome,
} from '@/modules/marketing/adsTypes'
import { can } from '@/shared/lib/permissions'
import { addDaysIso } from '@/shared/lib/companyDay'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { zonedParts, zonedToUtc } from '@/shared/lib/zonedTime'
import { activities, leads, users } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { statusHistoryOf } from '@/shared/mocks/data/leadStatusHistory'
import { campaignCosts, campaigns, nextMarketingId } from '@/shared/mocks/data/marketing'
import {
  adCampaigns,
  adConnections,
  adCostLinks,
  adDailyStats,
  adLeadSubmissions,
  adSyncRuns,
  adTokens,
  adsSeq,
  nextAdsId,
  type AdCampaignRecord,
  type AdConnectionRecord,
  type AdLeadSubmissionRecord,
  type AdSyncRunRecord,
} from '@/shared/mocks/data/ads'
import { nowMs } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { findInTenant, scoped, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, assertModule, LimitReachedError, noteUsage, onLifecycleTick } from '@/shared/mocks/services/billing'
import { autoOwnerFor, findDuplicates, insertLead } from '@/shared/mocks/services/leads'

/* ------------------------------------------------------------------------------------------
 * Ads integrations (Marketing › Ads Integrations). Plan module `marketing` (the whole /marketing/*
 * tree, central gate); connecting, disconnecting, listing ad accounts and syncing also need the plan
 * module `integrations` (403 module_not_in_plan). Rights: Marketing column — view reads, full writes.
 * Tokens are stored server-side only (adTokens) and answered as a masked hint. Contract and rules:
 * docs/API.md › Marketing › Ads integrations.
 * ---------------------------------------------------------------------------------------- */

/** Days of history imported by the first sync of an account (and the most a later sync catches up). */
export const BACKFILL_DAYS = 30
const HOUR = 3_600_000
const NOT_FOUND = 'That ad account connection doesn’t exist.'
const AD_CAMPAIGN_NOT_FOUND = 'That ad campaign doesn’t exist.'
const UNKNOWN_CAMPAIGN = 'That campaign doesn’t exist.'
export const SIMULATED_SYNC_ERROR = 'The provider’s API timed out (simulated). Nothing was imported; the next sync retries.'

/* ---------------- Access ---------------- */

async function requireView(user: User): Promise<string> {
  if (!can(user.role, 'marketing', 'view')) return fail('Your role has no access to Marketing.', 403)
  return tenantOf(user)
}

async function requireEdit(user: User): Promise<string> {
  const co = await requireView(user)
  if (!can(user.role, 'marketing', 'edit')) return fail('Your role can view ad integrations but not change them.', 403)
  return co
}

/** Connecting, disconnecting and syncing ad accounts need the plan module `integrations`. */
function requireIntegrations(co: string): void {
  assertModule(co, 'integrations')
}

function hasModule(co: string, module: 'integrations' | 'marketing'): boolean {
  try {
    assertModule(co, module)
    return true
  } catch {
    return false
  }
}

/* ---------------- Helpers ---------------- */

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const iso = (ms: number) => new Date(ms).toISOString()
const isProvider = (v: unknown): v is AdProvider => typeof v === 'string' && (AD_PROVIDERS as string[]).includes(v)

function timezoneOf(co: string): string {
  return companyById(co)?.regional.timezone ?? DEFAULT_REGION.timezone
}
function currencyOf(co: string): string {
  return companyById(co)?.regional.currency ?? DEFAULT_REGION.currency
}
const localDay = (co: string, ms: number) => zonedParts(ms, timezoneOf(co)).date

/** FNV-1a: everything simulated is a pure function of ids and dates (deterministic). */
export function adsHash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0
  return h
}

function digits(seed: string, n: number): string {
  let out = ''
  for (let i = 0; out.length < n; i++) out += String(adsHash(`${seed}#${i}`) % 1_000_000).padStart(6, '0')
  return out.slice(0, n)
}

/* ---------------- Simulated provider ---------------- */

/** The ad accounts the (simulated) authorizing login can see: three per provider, ids derived from the company. */
export function accountsFor(co: string, provider: AdProvider): { accountId: string; name: string; currency: string }[] {
  const company = companyById(co)
  const brand = company?.branding?.displayName || company?.name || 'Company'
  const names = [brand, `${brand} – Regional`, `${brand} – Agency managed`]
  return names.map((name, i) => {
    const d = digits(`${co}|${provider}|${i}`, 12)
    const accountId =
      provider === 'meta' ? `act_${d.slice(0, 10)}` : provider === 'google' ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}` : provider === 'linkedin' ? `5${d.slice(0, 8)}` : `7${d.slice(0, 10)}`
    return { accountId, name, currency: currencyOf(co) }
  })
}

const TEMPLATES: Record<AdProvider, [string, AdObjective][]> = {
  meta: [
    ['Lead form – decision makers', 'leads'],
    ['Retargeting – website visitors', 'traffic'],
    ['Brand video – awareness', 'awareness'],
  ],
  google: [
    ['Search – core services', 'conversions'],
    ['Performance Max – demos', 'conversions'],
  ],
  linkedin: [
    ['Sponsored content – lead gen form', 'leads'],
    ['Message ads – executives', 'leads'],
    ['Website visits – case studies', 'traffic'],
  ],
  tiktok: [
    ['In-feed – brand awareness', 'awareness'],
    ['Spark ads – product demo', 'traffic'],
  ],
}

const BASE: Record<AdProvider, { impressions: number; ctr: number; cpc: number }> = {
  meta: { impressions: 6000, ctr: 1.2, cpc: 2.4 },
  google: { impressions: 3000, ctr: 3.5, cpc: 4.5 },
  linkedin: { impressions: 2500, ctr: 0.7, cpc: 11 },
  tiktok: { impressions: 9000, ctr: 1, cpc: 1.6 },
}

const leadFormsOf = (provider: AdProvider, objective: AdObjective) => objective === 'leads' && LEAD_AD_PROVIDERS.includes(provider)

/** One day of an ad campaign (deterministic from the ad campaign's provider id and the date). */
export function simulateDay(provider: AdProvider, externalId: string, objective: AdObjective, date: string) {
  const h = adsHash(`${externalId}|${date}`)
  const b = BASE[provider]
  const impressions = Math.round(b.impressions * (0.6 + (h % 80) / 100))
  const ctr = b.ctr * (0.7 + ((h >>> 7) % 60) / 100)
  const clicks = Math.round((impressions * ctr) / 100)
  const cpc = b.cpc * (0.8 + ((h >>> 13) % 40) / 100)
  const spend = round2(clicks * cpc)
  const conversions = Math.round((clicks * (2 + ((h >>> 19) % 7))) / 100)
  const leadCount = leadFormsOf(provider, objective) ? 1 + ((h >>> 23) % 3 === 0 ? 1 : 0) : 0
  return { impressions, clicks, spend, conversions, leads: leadCount }
}

const FIRST = ['Anwar', 'Dalia', 'Jaber', 'Lubna', 'Marwan', 'Nadine', 'Imad', 'Ruba', 'Suhail', 'Thuraya', 'Wael', 'Yasmeen']
const LAST = ['Albaz', 'Darwish', 'Ghanem', 'Hijazi', 'Jaziri', 'Kanaan', 'Mahrooqi', 'Qudsi', 'Rifai', 'Shami', 'Tamimi', 'Zaben']
const COMPANIES = [
  'Quillon Analytics', 'Brightvale Clinics', 'Sandcastle Realty', 'Tidewater Retail', 'Ironbark Freight', 'Kestrel Academies',
  'Copperline Insurance', 'Juniper Motors', 'Wexford Legal', 'Saffronleaf Foods', 'Halcyon Hotels', 'Bluefin Labs',
  'Larchmont Interiors', 'Ravenna Pharma', 'Cobalt Fitness', 'Wrenfield Logistics',
]
const TITLES = ['Operations Manager', 'Marketing Director', 'General Manager', 'IT Lead', 'Procurement Head', 'Founder']

/**
 * The lead-form submissions of an ad campaign on a day (count = the day's `leads` stat). About one in
 * five reuses the email and company of an existing lead of the company (a returning prospect), so the
 * duplicate rule shows up in the demo.
 */
function submissionsOn(co: string, provider: AdProvider, adc: AdCampaignRecord, date: string) {
  const day = simulateDay(provider, adc.externalId, adc.objective, date)
  const out: { externalId: string; submittedAt: string; name: string; email: string; companyName: string; title: string }[] = []
  const own = leads.filter((l) => l.companyId === co && l.contactEmail).sort((a, b) => a.id.localeCompare(b.id))
  for (let i = 0; i < day.leads; i++) {
    const h = adsHash(`${adc.externalId}|${date}|${i}`)
    const first = FIRST[h % FIRST.length]
    const last = LAST[(h >>> 4) % LAST.length]
    const time = `${String(9 + ((h >>> 3) % 9)).padStart(2, '0')}:${String((h >>> 11) % 60).padStart(2, '0')}`
    const returning = own.length > 0 && (h >>> 27) % 5 === 0 ? own[(h >>> 8) % own.length] : null
    const companyName = returning?.company ?? COMPANIES[(h >>> 9) % COMPANIES.length]
    const email = returning?.contactEmail.trim().toLowerCase() ?? `${first}.${last}@${companyName.toLowerCase().replace(/[^a-z]+/g, '')}.example`.toLowerCase()
    out.push({
      externalId: `${adc.externalId}-${date}-${i + 1}`,
      submittedAt: zonedToUtc(date, time, timezoneOf(co)),
      name: returning?.contactName || `${first} ${last}`,
      email,
      companyName,
      title: TITLES[(h >>> 15) % TITLES.length],
    })
  }
  return out
}

/* ---------------- Lead sources for lead ads ---------------- */

const SOURCE_CANDIDATES: Record<AdProvider, string[]> = {
  meta: ['paid ads', 'meta ads', 'meta', 'facebook ads', 'facebook', 'instagram', 'social media', 'social'],
  linkedin: ['linkedin ads', 'linkedin', 'paid ads'],
  google: ['google ads', 'paid ads'],
  tiktok: ['tiktok ads', 'tiktok', 'paid ads'],
}

/** The company's active lead source for a provider's lead forms (by key or label, in preference order). */
export function adSourceKey(co: string, provider: AdProvider): string | null {
  const sources = lookupsFor(co).sources.filter((s) => s.active)
  for (const want of SOURCE_CANDIDATES[provider]) {
    const s = sources.find((x) => x.key.toLowerCase() === want || x.label.toLowerCase() === want)
    if (s) return s.key
  }
  return null
}

export function adSourceMissing(provider: AdProvider): string {
  const hint = provider === 'linkedin' ? '“LinkedIn” or “Paid ads”' : provider === 'meta' ? '“Paid ads” (or “Meta”)' : '“Paid ads”'
  return `Your lead sources have no active ${hint} source, so ${AD_PROVIDER_LABEL[provider]} lead-form submissions can’t become leads yet. Add (or reactivate) it in Settings › Fixed lists › Lead sources; waiting submissions are imported on the next sync.`
}

/* ---------------- Sync engine ---------------- */

function campaignsOfConnection(c: Tenant<AdConnectionRecord>): Tenant<AdCampaignRecord>[] {
  return adCampaigns.filter((a) => a.companyId === c.companyId && a.connectionId === c.id)
}

/** Creates the account's ad campaigns the first time it syncs (the provider's campaign list). */
function ensureAdCampaigns(c: Tenant<AdConnectionRecord>): Tenant<AdCampaignRecord>[] {
  const existing = campaignsOfConnection(c)
  TEMPLATES[c.provider].forEach(([name, objective], i) => {
    const externalId = `${c.accountId}-c${i + 1}`
    if (existing.some((a) => a.externalId === externalId)) return
    const row: Tenant<AdCampaignRecord> = {
      companyId: c.companyId,
      id: nextAdsId('ADC'),
      connectionId: c.id,
      externalId,
      name,
      objective,
      status: 'active',
      campaignId: null,
      mappedAt: null,
      mappedBy: null,
    }
    adCampaigns.push(row)
    existing.push(row)
  })
  return existing
}

/**
 * Turns the synced spend of a MAPPED ad campaign into campaign cost entries: one per day with spend,
 * keyed `${adCampaignId}|${date}` in adCostLinks, so syncing, re-syncing or re-mapping never creates a
 * second entry for the same day. Unmapped → nothing new; existing entries stay where they are.
 */
export function applyAdCosts(adc: Tenant<AdCampaignRecord>, at: number = nowMs()): number {
  if (!adc.campaignId) return 0
  const co = adc.companyId
  const campaign = campaigns.find((x) => x.companyId === co && x.id === adc.campaignId)
  if (!campaign) return 0
  const provider = adConnections.find((c) => c.id === adc.connectionId && c.companyId === co)?.provider
  const linked = new Set(adCostLinks.filter((l) => l.companyId === co && l.adCampaignId === adc.id).map((l) => l.key))
  let n = 0
  const stats = adDailyStats.filter((s) => s.companyId === co && s.adCampaignId === adc.id && s.spend > 0).sort((a, b) => a.date.localeCompare(b.date))
  for (const s of stats) {
    const key = `${adc.id}|${s.date}`
    if (linked.has(key)) continue
    const costId = nextMarketingId('CC')
    campaignCosts.push({
      companyId: co,
      id: costId,
      campaignId: campaign.id,
      date: s.date,
      amount: s.spend,
      note: `${provider ? AD_PROVIDER_LABEL[provider] : 'Ads'}: ${adc.name} (synced ad spend)`.slice(0, 255),
      createdAt: iso(at),
    })
    adCostLinks.push({ companyId: co, key, adCampaignId: adc.id, date: s.date, campaignId: campaign.id, costId })
    linked.add(key)
    n++
  }
  if (n) campaign.updatedAt = iso(at)
  return n
}

/** The company user lead ads are created as: its first active Company Admin (full Sales scope → auto-assignment). */
function leadActor(co: string): User | null {
  return users.find((u) => u.companyId === co && u.active !== false && u.role === 'Company Admin') ?? null
}

/**
 * Applies the lead rule to one submission (the normal lead-creation path, like event registrations):
 *  - no active source for the provider → `pending_source` (kept, retried on every sync);
 *  - an existing lead of the company with the same email / company / domain → `duplicate` (linked, activity logged);
 *  - the plan's leads + contacts limit → `limit` (no lead);
 *  - otherwise a new lead: source = the provider's source, source detail = provider + ad campaign,
 *    campaign_id = the ad campaign's mapping (if any), owner = auto-assignment.
 */
function processSubmission(sub: Tenant<AdLeadSubmissionRecord>, c: Tenant<AdConnectionRecord>, at: number): LeadSubmissionOutcome {
  const co = c.companyId
  const adc = adCampaigns.find((a) => a.companyId === co && a.id === sub.adCampaignId)
  sub.processedAt = iso(at)
  const source = adSourceKey(co, c.provider)
  if (!source) {
    sub.outcome = 'pending_source'
    sub.message = adSourceMissing(c.provider)
    return sub.outcome
  }
  const campaignId = adc?.campaignId && campaigns.some((x) => x.companyId === co && x.id === adc.campaignId) ? adc.campaignId : null
  const matches = findDuplicates(co, { company: sub.companyName, emails: [sub.email] })
  if (matches.length) {
    const lead = leads.find((l) => l.companyId === co && l.id === matches[0].leadId)!
    sub.outcome = 'duplicate'
    sub.leadId = lead.id
    sub.campaignId = campaignId
    sub.message = `Linked to ${lead.company} (${lead.id}): same ${matches[0].reason}.`
    const activity: Tenant<Activity> = {
      companyId: co,
      id: `A-${sub.id}`,
      leadId: lead.id,
      type: 'system',
      summary: `${sub.name} submitted the ${AD_PROVIDER_LABEL[c.provider]} lead form “${adc?.name ?? 'Lead form'}”.`,
      userId: lead.ownerId,
      at: sub.submittedAt,
    }
    activities.push(activity)
    return sub.outcome
  }
  const actor = leadActor(co)
  if (!actor) {
    sub.outcome = 'limit'
    sub.message = 'This workspace has no Company Admin to create leads as.'
    return sub.outcome
  }
  try {
    // The lead plus its one contact count toward leads + contacts.
    assertCapacity(co, 'leadsContacts', 2)
  } catch (err) {
    if (!(err instanceof LimitReachedError)) throw err
    sub.outcome = 'limit'
    sub.message = 'Not imported: your plan’s leads and contacts limit is reached.'
    return sub.outcome
  }
  const lead = insertLead(actor, {
    company: sub.companyName,
    sourceType: source,
    sourceDetail: `${AD_PROVIDER_LABEL[c.provider]}: ${adc?.name ?? 'Lead form'}`,
    industry: '',
    contacts: [{ name: sub.name, title: sub.title, mobile: '', email: sub.email, isDecisionMaker: false }],
    ownerId: autoOwnerFor(actor),
    nextFollowUpDate: null,
    note: `Submitted the ${AD_PROVIDER_LABEL[c.provider]} lead form “${adc?.name ?? 'Lead form'}” (${c.accountName}).`,
    campaignId,
  })
  // The lead is born when the form was submitted.
  lead.createdAt = sub.submittedAt
  lead.stageChangedAt = sub.submittedAt
  const first = statusHistoryOf(lead.id)[0]
  if (first) first.changedAt = sub.submittedAt
  noteUsage(co)
  sub.outcome = 'created'
  sub.leadId = lead.id
  sub.campaignId = campaignId
  sub.message = `New lead ${lead.id}.`
  return sub.outcome
}

/** Dev / test hook: `globalThis.__apexAdsSync = 'fail' | 'ok'` forces the next syncs to fail or succeed (never read in production). */
function forcedSync(): 'fail' | 'ok' | null {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'test')) return null
  const v = (globalThis as { __apexAdsSync?: unknown }).__apexAdsSync
  return v === 'fail' || v === 'ok' ? v : null
}

/**
 * One sync run of a connection at `at`: imports the complete days (company time) after the last
 * synced day, at most BACKFILL_DAYS back, up to yesterday; creates the costs of mapped ad campaigns;
 * stores the new lead-form submissions (from `leadsFrom` on) and processes every waiting one. About
 * one run in ten fails (simulated provider timeout): nothing is imported, the run is logged with the
 * error, the connection shows `error`, and the next run retries. Idempotent.
 */
export function runAdSync(c: Tenant<AdConnectionRecord>, trigger: AdSyncTrigger, at: number = nowMs(), opts: { noFail?: boolean } = {}): Tenant<AdSyncRunRecord> {
  const co = c.companyId
  const forced = forcedSync()
  const failNow = !opts.noFail && (forced === 'fail' || (forced !== 'ok' && adsHash(`${c.id}|${adsSeq()}`) % 10 === 0))
  const run: Tenant<AdSyncRunRecord> = {
    companyId: co,
    id: nextAdsId('ASR'),
    connectionId: c.id,
    trigger,
    status: 'success',
    startedAt: iso(at),
    finishedAt: iso(at),
    rows: 0,
    costs: 0,
    leadsCreated: 0,
    leadsDuplicate: 0,
    leadsSkipped: 0,
    leadsPending: 0,
    error: null,
  }
  adSyncRuns.push(run)
  c.lastSyncAt = run.startedAt
  if (failNow) {
    run.status = 'error'
    run.error = SIMULATED_SYNC_ERROR
    c.status = 'error'
    c.lastSyncStatus = 'error'
    c.lastError = SIMULATED_SYNC_ERROR
    c.retryAfter = at + HOUR
    return run
  }
  const today = localDay(co, at)
  const yesterday = addDaysIso(today, -1)
  const floor = addDaysIso(today, -BACKFILL_DAYS)
  let start = c.syncedThrough ? addDaysIso(c.syncedThrough, 1) : floor
  if (start < floor) start = floor
  const list = ensureAdCampaigns(c)
  const leadsFrom = Date.parse(c.leadsFrom)
  for (let d = start; d <= yesterday; d = addDaysIso(d, 1)) {
    for (const adc of list) {
      if (adDailyStats.some((s) => s.companyId === co && s.adCampaignId === adc.id && s.date === d)) continue
      const day = simulateDay(c.provider, adc.externalId, adc.objective, d)
      adDailyStats.push({ companyId: co, connectionId: c.id, adCampaignId: adc.id, date: d, ...day })
      run.rows++
      for (const s of submissionsOn(co, c.provider, adc, d)) {
        if (Date.parse(s.submittedAt) < leadsFrom) continue
        if (adLeadSubmissions.some((x) => x.companyId === co && x.connectionId === c.id && x.externalId === s.externalId)) continue
        adLeadSubmissions.push({ companyId: co, id: nextAdsId('ALS'), connectionId: c.id, adCampaignId: adc.id, ...s, outcome: 'pending_source', leadId: null, campaignId: null, message: '', processedAt: null })
      }
    }
  }
  for (const adc of list) run.costs += applyAdCosts(adc, at)
  const waiting = adLeadSubmissions
    .filter((s) => s.companyId === co && s.connectionId === c.id && (s.processedAt === null || s.outcome === 'pending_source'))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))
  for (const s of waiting) {
    const outcome = processSubmission(s, c, at)
    if (outcome === 'created') run.leadsCreated++
    else if (outcome === 'duplicate') run.leadsDuplicate++
    else if (outcome === 'limit') run.leadsSkipped++
    else run.leadsPending++
  }
  if (!c.syncedThrough || yesterday > c.syncedThrough) c.syncedThrough = yesterday
  c.status = 'connected'
  c.lastSyncStatus = 'success'
  c.lastError = null
  c.retryAfter = 0
  return run
}

/**
 * The daily sync, run lazily on the company's lifecycle tick (every authenticated request, Dev ›
 * advance clock): every live connection whose last synced day is before yesterday (company time)
 * syncs once; after an error it waits an hour of mock-clock time before retrying. Skipped while the
 * plan lacks `marketing` or `integrations`. Only ever touches `companyId`'s rows.
 */
export function runAdsDailySync(companyId: string, until: number = nowMs()): void {
  const live = adConnections.filter((c) => c.companyId === companyId && c.status !== 'disconnected')
  if (!live.length) return
  if (!hasModule(companyId, 'marketing') || !hasModule(companyId, 'integrations')) return
  const yesterday = addDaysIso(localDay(companyId, until), -1)
  for (const c of live) {
    if (c.syncedThrough && c.syncedThrough >= yesterday) continue
    if (until < c.retryAfter) continue
    runAdSync(c, 'daily', until)
  }
}
onLifecycleTick('marketing.ads', (companyId, until) => runAdsDailySync(companyId, until))

/**
 * A provider's lead webhook (simulated; a real backend verifies the provider's signature). The lead is
 * routed by CONNECTION — the live connection of that provider and ad account — never by a company field
 * of the payload, so a submission for company A's account can't land in company B. Unknown or
 * disconnected accounts are ignored.
 */
export function receiveLeadWebhook(payload: {
  provider: AdProvider
  accountId: string
  externalId: string
  adCampaignExternalId?: string
  name: string
  email: string
  companyName: string
  title?: string
  submittedAt?: string
  [key: string]: unknown
}): { accepted: boolean; outcome?: LeadSubmissionOutcome; submissionId?: string } {
  const c = adConnections.find((x) => x.provider === payload.provider && x.accountId === payload.accountId && x.status !== 'disconnected')
  if (!c) return { accepted: false }
  const co = c.companyId
  const list = ensureAdCampaigns(c)
  const adc = list.find((a) => a.externalId === payload.adCampaignExternalId) ?? list.find((a) => leadFormsOf(c.provider, a.objective)) ?? list[0]
  const dup = adLeadSubmissions.find((x) => x.companyId === co && x.connectionId === c.id && x.externalId === payload.externalId)
  if (dup) return { accepted: true, outcome: dup.outcome, submissionId: dup.id }
  const sub: Tenant<AdLeadSubmissionRecord> = {
    companyId: co,
    id: nextAdsId('ALS'),
    connectionId: c.id,
    adCampaignId: adc.id,
    externalId: payload.externalId,
    submittedAt: payload.submittedAt ?? iso(nowMs()),
    name: String(payload.name ?? '').trim().slice(0, 255),
    email: String(payload.email ?? '').trim().toLowerCase().slice(0, 190),
    companyName: String(payload.companyName ?? '').trim().slice(0, 255) || String(payload.name ?? 'Lead'),
    title: String(payload.title ?? '').trim().slice(0, 120),
    outcome: 'pending_source',
    leadId: null,
    campaignId: null,
    message: '',
    processedAt: null,
  }
  adLeadSubmissions.push(sub)
  return { accepted: true, outcome: processSubmission(sub, c, nowMs()), submissionId: sub.id }
}

/* ---------------- Views ---------------- */

function totalsOf(rows: { spend: number; impressions: number; clicks: number; conversions: number; leads: number }[]): AdTotals {
  const t = rows.reduce(
    (s, r) => ({ spend: s.spend + r.spend, impressions: s.impressions + r.impressions, clicks: s.clicks + r.clicks, conversions: s.conversions + r.conversions, leads: s.leads + r.leads }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, leads: 0 },
  )
  return {
    ...t,
    spend: round2(t.spend),
    ctr: t.impressions ? round1((t.clicks / t.impressions) * 100) : null,
    cpc: t.clicks ? round2(t.spend / t.clicks) : null,
  }
}
export { totalsOf as adTotalsOf }

function last30(c: Tenant<AdConnectionRecord>) {
  const end = c.syncedThrough ?? addDaysIso(localDay(c.companyId, nowMs()), -1)
  const from = addDaysIso(end, -29)
  return adDailyStats.filter((s) => s.companyId === c.companyId && s.connectionId === c.id && s.date >= from && s.date <= end)
}

function connectionView(c: Tenant<AdConnectionRecord>): AdConnection {
  const list = campaignsOfConnection(c)
  return {
    id: c.id,
    provider: c.provider,
    accountId: c.accountId,
    accountName: c.accountName,
    currency: c.currency,
    status: c.status,
    tokenHint: c.tokenHint,
    connectedBy: c.connectedBy,
    connectedByName: ownerName(c.connectedBy),
    connectedAt: c.connectedAt,
    disconnectedAt: c.disconnectedAt,
    lastSyncAt: c.lastSyncAt,
    lastSyncStatus: c.lastSyncStatus,
    lastError: c.lastError,
    syncedThrough: c.syncedThrough,
    leadAds: LEAD_AD_PROVIDERS.includes(c.provider),
    campaigns: list.length,
    mapped: list.filter((a) => a.campaignId).length,
    last30: totalsOf(last30(c)),
    pendingLeads: adLeadSubmissions.filter((s) => s.companyId === c.companyId && s.connectionId === c.id && s.outcome === 'pending_source').length,
  }
}

function adCampaignView(a: Tenant<AdCampaignRecord>): AdCampaign {
  const c = adConnections.find((x) => x.id === a.connectionId && x.companyId === a.companyId)!
  const recent = last30(c).filter((s) => s.adCampaignId === a.id)
  return {
    id: a.id,
    connectionId: a.connectionId,
    externalId: a.externalId,
    name: a.name,
    objective: a.objective,
    status: a.status,
    campaignId: a.campaignId,
    campaignName: a.campaignId ? (campaigns.find((x) => x.companyId === a.companyId && x.id === a.campaignId)?.name ?? null) : null,
    mappedAt: a.mappedAt,
    totals: totalsOf(recent),
    costEntries: adCostLinks.filter((l) => l.companyId === a.companyId && l.adCampaignId === a.id).length,
  }
}

function runView(r: Tenant<AdSyncRunRecord>): AdSyncRun {
  const { companyId: _c, ...rest } = r
  return rest
}

function detailView(c: Tenant<AdConnectionRecord>): AdConnectionDetail {
  const co = c.companyId
  const list = campaignsOfConnection(c)
  const nameOf = new Map(list.map((a) => [a.id, a.name]))
  const byDay = new Map<string, { date: string; spend: number; clicks: number; impressions: number; leads: number }>()
  for (const s of last30(c)) {
    const d = byDay.get(s.date) ?? { date: s.date, spend: 0, clicks: 0, impressions: 0, leads: 0 }
    d.spend = round2(d.spend + s.spend)
    d.clicks += s.clicks
    d.impressions += s.impressions
    d.leads += s.leads
    byDay.set(s.date, d)
  }
  return {
    ...connectionView(c),
    adCampaigns: list.map(adCampaignView),
    runs: adSyncRuns
      .filter((r) => r.companyId === co && r.connectionId === c.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id, 'en', { numeric: true }))
      .slice(0, 20)
      .map(runView),
    submissions: adLeadSubmissions
      .filter((s) => s.companyId === co && s.connectionId === c.id)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        adCampaignId: s.adCampaignId,
        adCampaignName: nameOf.get(s.adCampaignId) ?? '',
        submittedAt: s.submittedAt,
        name: s.name,
        email: s.email,
        companyName: s.companyName,
        outcome: s.outcome,
        leadId: s.leadId,
        campaignId: s.campaignId,
        message: s.message,
      })),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/* ---------------- Endpoints ---------------- */

/** GET /marketing/ads/connections — every connection of the company (disconnected ones keep their history). */
export async function getAdConnections(user: User): Promise<AdConnection[]> {
  await requireView(user)
  const order = (c: AdConnectionRecord) => (c.status === 'disconnected' ? 1 : 0)
  return delay(
    scoped(adConnections, user)
      .sort((a, b) => order(a) - order(b) || AD_PROVIDERS.indexOf(a.provider) - AD_PROVIDERS.indexOf(b.provider) || a.connectedAt.localeCompare(b.connectedAt))
      .map(connectionView),
  )
}

/** GET /marketing/ads/providers/:provider/accounts — the OAuth step: ad accounts the login can see. */
export async function getAdAccounts(user: User, provider: string): Promise<AdAccountOption[]> {
  const co = await requireEdit(user)
  requireIntegrations(co)
  if (!isProvider(provider)) return fail('Unknown ad provider.', 404)
  return delay(
    accountsFor(co, provider).map((a) => ({
      ...a,
      connected: adConnections.some((c) => c.companyId === co && c.provider === provider && c.accountId === a.accountId && c.status !== 'disconnected'),
    })),
  )
}

async function connectionFor(user: User, id: string): Promise<Tenant<AdConnectionRecord>> {
  const c = findInTenant(adConnections, user, (x) => x.id === id)
  if (!c) return fail(NOT_FOUND, 404)
  return c
}

export async function getAdConnection(user: User, id: string): Promise<AdConnectionDetail> {
  await requireView(user)
  return delay(detailView(await connectionFor(user, id)))
}

function newToken(seed: string): string {
  return `adtok_${digits(`${seed}|tok|a`, 12)}${adsHash(`${seed}|tok|b`).toString(16).padStart(8, '0')}${adsHash(`${seed}|tok|c`).toString(16).padStart(8, '0')}`
}
const hintOf = (token: string) => `•••• ${token.slice(-4)}`

/**
 * POST /marketing/ads/connections — the end of the (simulated) OAuth flow: the user picked an ad
 * account and gave consent. The access token is stored server-side; the answer has a masked hint
 * only. The first sync runs right away (BACKFILL_DAYS of history). Reconnecting a disconnected
 * account reactivates its connection and keeps its history.
 */
export async function connectAdAccount(user: User, input: Partial<AdConnectInput>): Promise<AdConnectionDetail> {
  const co = await requireEdit(user)
  requireIntegrations(co)
  const provider = input?.provider
  if (!isProvider(provider)) return fail('Pick an ad platform: Meta Ads, Google Ads, LinkedIn Ads or TikTok Ads.', 422)
  if (input.consent !== true) return fail('Allow Apex CRM to read your ad account’s campaigns, spend and lead forms to connect it.', 422)
  const account = accountsFor(co, provider).find((a) => a.accountId === input.accountId)
  if (!account) return fail('That ad account isn’t available to the login you authorized. Pick one from the list.', 422)
  const at = nowMs()
  let c = adConnections.find((x) => x.companyId === co && x.provider === provider && x.accountId === account.accountId)
  if (c && c.status !== 'disconnected') return fail(`${account.name} is already connected.`, 409)
  if (!c) {
    c = {
      companyId: co,
      id: nextAdsId('ADX'),
      provider,
      accountId: account.accountId,
      accountName: account.name,
      currency: account.currency,
      status: 'connected',
      tokenHint: null,
      connectedBy: user.id,
      connectedAt: iso(at),
      disconnectedBy: null,
      disconnectedAt: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      syncedThrough: null,
      leadsFrom: iso(at),
      retryAfter: 0,
    }
    adConnections.push(c)
  } else {
    Object.assign(c, { status: 'connected', connectedBy: user.id, connectedAt: iso(at), disconnectedBy: null, disconnectedAt: null, leadsFrom: iso(at), retryAfter: 0 })
  }
  const token = newToken(`${c.id}|${at}`)
  adTokens.set(c.id, token)
  c.tokenHint = hintOf(token)
  runAdSync(c, 'initial', at)
  return delay(detailView(c))
}

/** DELETE /marketing/ads/connections/:id — revokes the token and stops syncing; synced stats, costs, leads and mappings stay. */
export async function disconnectAdAccount(user: User, id: string): Promise<AdConnectionDetail> {
  await requireView(user)
  const c = await connectionFor(user, id)
  const co = await requireEdit(user)
  requireIntegrations(co)
  if (c.status === 'disconnected') return fail('This ad account is already disconnected.', 409)
  adTokens.delete(c.id)
  Object.assign(c, { status: 'disconnected', tokenHint: null, disconnectedBy: user.id, disconnectedAt: iso(nowMs()) })
  return delay(detailView(c))
}

/** POST /marketing/ads/connections/:id/sync — "Sync now" (also the retry after an error). */
export async function syncAdConnection(user: User, id: string): Promise<AdConnectionDetail> {
  await requireView(user)
  const c = await connectionFor(user, id)
  const co = await requireEdit(user)
  requireIntegrations(co)
  if (c.status === 'disconnected') return fail('Reconnect this ad account to sync it.', 409)
  runAdSync(c, 'manual', nowMs())
  return delay(detailView(c))
}

/**
 * PATCH /marketing/ads/campaigns/:id `{ campaign_id }` — maps an ad campaign to a CRM campaign (its
 * synced spend becomes campaign costs right away, one entry per day, never twice) or unmaps it
 * (`null`: no new costs; entries already created stay).
 */
export async function mapAdCampaign(user: User, id: string, input: Partial<AdCampaignMapInput>): Promise<AdCampaign> {
  await requireView(user)
  const adc = findInTenant(adCampaigns, user, (x) => x.id === id)
  if (!adc) return fail(AD_CAMPAIGN_NOT_FOUND, 404)
  const co = await requireEdit(user)
  const target = input?.campaignId
  if (target !== null && typeof target !== 'string') return fail('Pick a campaign, or none to unmap.', 422)
  if (target && !campaigns.some((x) => x.companyId === co && x.id === target)) return fail(UNKNOWN_CAMPAIGN, 422)
  const at = nowMs()
  adc.campaignId = target || null
  adc.mappedAt = target ? iso(at) : null
  adc.mappedBy = target ? user.id : null
  applyAdCosts(adc, at)
  return delay(adCampaignView(adc))
}

/* ---------------- Seed ---------------- */

/**
 * Synthetic connections: Apex — Meta and Google connected (their lead-form / search campaigns mapped
 * to "Q4 LinkedIn outreach"); Crest — LinkedIn connected (mapped to "LinkedIn sponsored content Q4").
 * Each has BACKFILL_DAYS of synced history; lead forms import from the seed time on.
 */
function seed(): void {
  const at = Date.now()
  const plan: { co: string; provider: AdProvider; by: string; daysAgo: number; map: Record<number, string> }[] = [
    { co: 'co_apex', provider: 'meta', by: 'u7', daysAgo: 60, map: { 0: 'CMP-1001' } },
    { co: 'co_apex', provider: 'google', by: 'u7', daysAgo: 40, map: { 0: 'CMP-1001' } },
    { co: 'co_crest', provider: 'linkedin', by: 'u102', daysAgo: 50, map: { 0: 'CMP-5002' } },
  ]
  for (const p of plan) {
    if (!companyById(p.co) || !users.some((u) => u.id === p.by)) continue
    const account = accountsFor(p.co, p.provider)[0]
    const c: Tenant<AdConnectionRecord> = {
      companyId: p.co,
      id: nextAdsId('ADX'),
      provider: p.provider,
      accountId: account.accountId,
      accountName: account.name,
      currency: account.currency,
      status: 'connected',
      tokenHint: null,
      connectedBy: p.by,
      connectedAt: iso(at - p.daysAgo * 86_400_000),
      disconnectedBy: null,
      disconnectedAt: null,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastError: null,
      syncedThrough: null,
      leadsFrom: iso(at),
      retryAfter: 0,
    }
    adConnections.push(c)
    const token = newToken(`${c.id}|seed`)
    adTokens.set(c.id, token)
    c.tokenHint = hintOf(token)
    const list = ensureAdCampaigns(c)
    for (const [i, campaignId] of Object.entries(p.map)) {
      const adc = list[Number(i)]
      if (adc && campaigns.some((x) => x.companyId === p.co && x.id === campaignId)) {
        adc.campaignId = campaignId
        adc.mappedAt = c.connectedAt
        adc.mappedBy = p.by
      }
    }
    runAdSync(c, 'initial', at, { noFail: true })
  }
}
seed()
