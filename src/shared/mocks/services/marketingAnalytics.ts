import type { Lead, User } from '@/shared/types'
import type { CampaignChannel } from '@/modules/marketing/types'
import {
  ANALYTICS_PRESETS,
  type AnalyticsCampaignRow,
  type AnalyticsChannelRow,
  type AnalyticsFunnelStage,
  type AnalyticsKpis,
  type AnalyticsPoint,
  type AnalyticsPreset,
  type MarketingAnalytics,
} from '@/modules/marketing/analyticsTypes'
import { AD_PROVIDERS } from '@/modules/marketing/adsTypes'
import { can } from '@/shared/lib/permissions'
import { canSeeMarketingReportsRole } from '@/modules/reports/lib/marketingAccess'
import { addDaysIso, daysBetweenIso, weekStartIso } from '@/shared/lib/companyDay'
import { DEFAULT_REGION } from '@/shared/lib/region'
import { isRealIsoDate, zonedParts } from '@/shared/lib/zonedTime'
import { leads } from '@/shared/mocks/db'
import { companyById } from '@/shared/mocks/data/tenancy'
import { lookupsFor, statusOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { leadStatusHistory } from '@/shared/mocks/data/leadStatusHistory'
import { bulkEmailRecipients, bulkEmails, campaignCosts, campaigns } from '@/shared/mocks/data/marketing'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { eventActualCost } from '@/shared/mocks/selectors/events'
import { adConnections, adDailyStats } from '@/shared/mocks/data/ads'
import { contentItems } from '@/shared/mocks/data/marketingCreative'
import { formSubmissions, leadForms } from '@/shared/mocks/data/marketingGrowth'
import { nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'
import { assertModule } from '@/shared/mocks/services/billing'
import { adTotalsOf } from '@/shared/mocks/services/ads'

/* ------------------------------------------------------------------------------------------
 * GET /marketing/analytics — Marketing analytics (absorbs the old cost-per-lead report). Access:
 * Marketing view AND a Reports scope of `full` or `marketing` (reports/lib/marketingAccess.ts).
 * Every number is the caller's company only. Dates are company-local (its timezone); presets are
 * resolved on the server from the mock clock. Rules: docs/API.md › Marketing › Marketing analytics.
 *
 * Definitions (the period = [from, to], company-local days):
 *   spend            campaign_costs incurred in the period (manual + synced ad spend)
 *   leads            leads created in the period (the cohort); attributed = with a campaign
 *   won / won value  cohort leads whose status is of type won now, and their value
 *   cost per lead    spend ÷ attributed leads
 *   ROI              (won value of attributed won leads − spend) ÷ spend, in %
 *   conversion rate  won ÷ leads, in %
 *   funnel           cohort leads that reached each stage (lead_status_history + current status)
 * ---------------------------------------------------------------------------------------- */

const round2 = (n: number) => Math.round(n * 100) / 100
const round1 = (n: number) => Math.round(n * 10) / 10
const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null)
/** The longest custom range (two years). */
export const MAX_ANALYTICS_DAYS = 732

function regionOf(co: string) {
  const r = companyById(co)?.regional
  return {
    currency: r?.currency ?? DEFAULT_REGION.currency,
    timezone: r?.timezone ?? DEFAULT_REGION.timezone,
    weekStartsOn: r?.weekStartsOn ?? DEFAULT_REGION.weekStartsOn,
  }
}

/** The period of a preset, in the company's timezone, ending today (mock clock). */
export function presetRange(preset: Exclude<AnalyticsPreset, 'custom'>, timezone: string, at: number = nowMs()): { from: string; to: string } {
  const today = zonedParts(at, timezone).date
  const [y, m] = today.split('-').map(Number)
  switch (preset) {
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_30_days':
      return { from: addDaysIso(today, -29), to: today }
    case 'this_quarter':
      return { from: `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`, to: today }
    case 'ytd':
      return { from: `${y}-01-01`, to: today }
  }
}

/** The previous period: the same number of days right before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const days = daysBetweenIso(from, to) + 1
  return { from: addDaysIso(from, -days), to: addDaysIso(from, -1) }
}

const FUNNEL: { key: AnalyticsFunnelStage['key']; label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
]

/** Funnel index of a status: type won → Won; the built-in stages by key (No response / Call later count as contacted); anything else → New. */
export function funnelIndex(co: string, status: string): number {
  if (statusOf(co, status)?.type === 'won') return 5
  switch (status) {
    case SYSTEM_STATUS.proposal:
      return 4
    case SYSTEM_STATUS.meeting:
      return 3
    case SYSTEM_STATUS.interested:
      return 2
    case SYSTEM_STATUS.contacted:
    case SYSTEM_STATUS.noResponse:
    case SYSTEM_STATUS.callLater:
      return 1
    default:
      return 0
  }
}

interface Ctx {
  co: string
  timezone: string
  dayOf: (iso: string) => string
}

const isWon = (co: string, l: Lead) => statusOf(co, l.status)?.type === 'won'

function cohort(ctx: Ctx, from: string, to: string): Lead[] {
  return leads.filter((l) => l.companyId === ctx.co && ctx.dayOf(l.createdAt) >= from && ctx.dayOf(l.createdAt) <= to)
}

function costsIn(co: string, from: string, to: string) {
  return campaignCosts.filter((c) => c.companyId === co && c.date >= from && c.date <= to)
}

export function kpisFor(ctx: Ctx, from: string, to: string): AnalyticsKpis {
  const ls = cohort(ctx, from, to)
  const spend = round2(costsIn(ctx.co, from, to).reduce((s, c) => s + c.amount, 0))
  const attributed = ls.filter((l) => l.campaignId)
  const won = ls.filter((l) => isWon(ctx.co, l))
  const wonValue = round2(won.reduce((s, l) => s + (l.value || 0), 0))
  const attributedWonValue = round2(won.filter((l) => l.campaignId).reduce((s, l) => s + (l.value || 0), 0))
  return {
    spend,
    leads: ls.length,
    attributedLeads: attributed.length,
    costPerLead: attributed.length ? round2(spend / attributed.length) : null,
    won: won.length,
    wonValue,
    attributedWonValue,
    roi: spend > 0 ? round1(((attributedWonValue - spend) / spend) * 100) : null,
    conversionRate: pct(won.length, ls.length),
  }
}

function hasModule(co: string, module: 'events'): boolean {
  try {
    assertModule(co, module)
    return true
  } catch {
    return false
  }
}

/** Builds the dashboard for a company and a resolved period (exported for tests). */
export function buildAnalytics(co: string, preset: AnalyticsPreset, from: string, to: string, compare: boolean): MarketingAnalytics {
  const { currency, timezone, weekStartsOn } = regionOf(co)
  const ctx: Ctx = { co, timezone, dayOf: (iso) => zonedParts(iso, timezone).date }
  const days = daysBetweenIso(from, to) + 1
  const ls = cohort(ctx, from, to)
  const costs = costsIn(co, from, to)
  const own = campaigns.filter((c) => c.companyId === co)
  const campaignOf = new Map(own.map((c) => [c.id, c]))
  const now = nowMs()
  const visible = (at: string | null) => !!at && Date.parse(at) <= now

  // Timeline: days up to 45 days, weeks (company week start) up to 200, else months.
  const bucket: MarketingAnalytics['bucket'] = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month'
  const bucketOf = (day: string) => (bucket === 'day' ? day : bucket === 'week' ? weekStartIso(day, weekStartsOn) : `${day.slice(0, 7)}-01`)
  const points = new Map<string, AnalyticsPoint>()
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const b = bucketOf(d)
    if (!points.has(b)) points.set(b, { start: b, leads: 0, spend: 0 })
  }
  for (const l of ls) points.get(bucketOf(ctx.dayOf(l.createdAt)))!.leads++
  for (const c of costs) {
    const p = points.get(bucketOf(c.date))!
    p.spend = round2(p.spend + c.amount)
  }

  // Sources.
  const sourceLabel = (key: string) => lookupsFor(co).sources.find((s) => s.key === key)?.label ?? key
  const bySource = [...new Set(ls.map((l) => l.sourceType))]
    .map((source) => {
      const rows = ls.filter((l) => l.sourceType === source)
      return { source, label: sourceLabel(source), leads: rows.length, attributed: rows.filter((l) => l.campaignId).length, won: rows.filter((l) => isWon(co, l)).length }
    })
    .sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label))

  // Channels (the campaign's channel; none = no campaign).
  const channels = new Map<CampaignChannel | 'none', AnalyticsChannelRow>()
  const channelRow = (ch: CampaignChannel | 'none') => {
    if (!channels.has(ch)) channels.set(ch, { channel: ch, leads: 0, spend: 0, won: 0 })
    return channels.get(ch)!
  }
  for (const l of ls) {
    const row = channelRow((l.campaignId && campaignOf.get(l.campaignId)?.channel) || 'none')
    row.leads++
    if (isWon(co, l)) row.won++
  }
  for (const c of costs) {
    const ch = campaignOf.get(c.campaignId)?.channel
    if (!ch) continue
    const row = channelRow(ch)
    row.spend = round2(row.spend + c.amount)
  }
  const byChannel = [...channels.values()].sort((a, b) => b.spend - a.spend || b.leads - a.leads)

  // Funnel: the furthest stage each cohort lead reached (its history and its current status).
  const reached = new Map<string, number>()
  for (const l of ls) reached.set(l.id, funnelIndex(co, l.status))
  for (const h of leadStatusHistory) {
    if (h.companyId !== co || !reached.has(h.leadId)) continue
    reached.set(h.leadId, Math.max(reached.get(h.leadId)!, funnelIndex(co, h.toStatusId)))
  }
  const counts = FUNNEL.map((_, i) => [...reached.values()].filter((r) => r >= i).length)
  const funnel = FUNNEL.map((s, i) => ({ ...s, count: counts[i], rate: pct(counts[i], counts[0]) }))

  // Email (bulk email recipients sent in the period).
  const sentRows = bulkEmailRecipients.filter((r) => r.companyId === co && r.status === 'sent' && r.sentAt && ctx.dayOf(r.sentAt) >= from && ctx.dayOf(r.sentAt) <= to)
  const emailOf = new Map(bulkEmails.filter((e) => e.companyId === co).map((e) => [e.id, e]))
  const sendIds = [...new Set(sentRows.map((r) => r.bulkEmailId))]
  const email = {
    sent: sentRows.length,
    opened: sentRows.filter((r) => visible(r.openedAt)).length,
    replied: sentRows.filter((r) => visible(r.repliedAt)).length,
    openRate: pct(sentRows.filter((r) => visible(r.openedAt)).length, sentRows.length),
    replyRate: pct(sentRows.filter((r) => visible(r.repliedAt)).length, sentRows.length),
    sends: sendIds
      .map((id) => {
        const rows = sentRows.filter((r) => r.bulkEmailId === id)
        return {
          id,
          name: emailOf.get(id)?.name ?? id,
          sent: rows.length,
          openRate: pct(rows.filter((r) => visible(r.openedAt)).length, rows.length),
          replyRate: pct(rows.filter((r) => visible(r.repliedAt)).length, rows.length),
        }
      })
      .sort((a, b) => b.sent - a.sent),
  }

  // Campaigns: every campaign with spend, leads or emails in the period, or active.
  const campaignRows: AnalyticsCampaignRow[] = own
    .map((c) => {
      const cl = ls.filter((l) => l.campaignId === c.id)
      const won = cl.filter((l) => isWon(co, l))
      const wonValue = round2(won.reduce((s, l) => s + (l.value || 0), 0))
      const spend = round2(costs.filter((x) => x.campaignId === c.id).reduce((s, x) => s + x.amount, 0))
      const rec = sentRows.filter((r) => emailOf.get(r.bulkEmailId)?.campaignId === c.id)
      return {
        campaignId: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        spend,
        leads: cl.length,
        costPerLead: cl.length ? round2(spend / cl.length) : null,
        won: won.length,
        wonValue,
        costPerWon: won.length ? round2(spend / won.length) : null,
        roi: spend > 0 ? round1(((wonValue - spend) / spend) * 100) : null,
        sent: rec.length,
        opened: rec.filter((r) => visible(r.openedAt)).length,
        replied: rec.filter((r) => visible(r.repliedAt)).length,
      }
    })
    .filter((r) => r.spend || r.leads || r.sent || campaignOf.get(r.campaignId)?.status === 'active')
    .sort((a, b) => b.spend - a.spend || b.leads - a.leads || a.name.localeCompare(b.name))

  // Events (plan module `events`): events starting in the period, not cancelled.
  const eventsIncluded = hasModule(co, 'events')
  const eventRows = eventsIncluded
    ? events
        .filter((e) => e.companyId === co && e.status !== 'cancelled' && ctx.dayOf(e.startsAt) >= from && ctx.dayOf(e.startsAt) <= to)
        .map((e) => {
          const att = eventAttendees.filter((a) => a.companyId === co && a.eventId === e.id)
          const leadIds = [...new Set(att.map((a) => a.leadId).filter((x): x is string => !!x))]
          const won = leadIds.filter((id) => {
            const l = leads.find((x) => x.companyId === co && x.id === id)
            return !!l && isWon(co, l)
          }).length
          return { eventId: e.id, name: e.name, startsOn: ctx.dayOf(e.startsAt), attendees: att.length, leads: leadIds.length, won, cost: eventActualCost(e) }
        })
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
    : []

  // Ads: synced daily stats in the period, per provider (disconnected accounts keep their history).
  const providerOf = new Map(adConnections.filter((c) => c.companyId === co).map((c) => [c.id, c.provider]))
  const stats = adDailyStats.filter((s) => s.companyId === co && s.date >= from && s.date <= to)
  const providers = AD_PROVIDERS.filter((p) => [...providerOf.values()].includes(p)).map((provider) => ({
    provider,
    ...adTotalsOf(stats.filter((s) => providerOf.get(s.connectionId) === provider)),
  }))

  // Content Calendar (agent A's contentItems) and Lead Generation forms (agent B's leadForms / formSubmissions).
  const inPeriod = (at: string | null) => !!at && ctx.dayOf(at) >= from && ctx.dayOf(at) <= to
  const items = contentItems.filter((c) => c.companyId === co)
  const published = items.filter((c) => c.status === 'published' && inPeriod(c.publishedAt))
  const types = [...new Set(published.map((c) => c.type))]
  const subs = formSubmissions.filter((s) => s.companyId === co && s.outcome !== 'spam' && inPeriod(s.submittedAt))
  const formName = new Map(leadForms.filter((f) => f.companyId === co).map((f) => [f.id, f.name]))

  const previous = compare ? previousRange(from, to) : null
  return {
    preset,
    from,
    to,
    days,
    previous,
    currency,
    timezone,
    kpis: kpisFor(ctx, from, to),
    previousKpis: previous ? kpisFor(ctx, previous.from, previous.to) : null,
    bucket,
    timeline: [...points.values()],
    bySource,
    byChannel,
    funnel,
    campaigns: campaignRows,
    email,
    events: {
      included: eventsIncluded,
      attendees: eventRows.reduce((s, r) => s + r.attendees, 0),
      leads: eventRows.reduce((s, r) => s + r.leads, 0),
      won: eventRows.reduce((s, r) => s + r.won, 0),
      cost: Math.round(eventRows.reduce((s, r) => s + (r.cost ?? 0), 0) * 100) / 100,
      rows: eventRows,
    },
    ads: { providers, totals: adTotalsOf(stats) },
    content: {
      published: published.length,
      scheduled: items.filter((c) => c.status === 'scheduled' && inPeriod(c.publishAt)).length,
      byType: types.map((type) => ({ type, count: published.filter((c) => c.type === type).length })).sort((a, b) => b.count - a.count),
    },
    forms: {
      submissions: subs.length,
      leadsCreated: subs.filter((s) => s.outcome === 'created').length,
      linked: subs.filter((s) => s.outcome === 'linked').length,
      rows: [...new Set(subs.map((s) => s.formId))]
        .map((formId) => {
          const rows = subs.filter((s) => s.formId === formId)
          return { formId, name: formName.get(formId) ?? formId, submissions: rows.length, leadsCreated: rows.filter((s) => s.outcome === 'created').length }
        })
        .sort((a, b) => b.submissions - a.submissions),
    },
  }
}

export async function getMarketingAnalytics(user: User, q: { preset?: string; from?: string; to?: string; compare?: string }): Promise<MarketingAnalytics> {
  if (!can(user.role, 'marketing', 'view')) return fail('Your role has no access to Marketing.', 403)
  if (!canSeeMarketingReportsRole(user.role)) return fail('Your role has no access to marketing analytics.', 403)
  const co = tenantOf(user)
  const preset = (q.preset || 'this_month') as AnalyticsPreset
  if (!ANALYTICS_PRESETS.includes(preset)) return fail('Pick a period: this_month, last_30_days, this_quarter, ytd or custom.', 400)
  let range: { from: string; to: string }
  if (preset === 'custom') {
    if (!isRealIsoDate(q.from) || !isRealIsoDate(q.to)) return fail('Pick a valid date range (from and to, YYYY-MM-DD).', 400)
    if (q.from > q.to) return fail('The start date must be on or before the end date.', 400)
    if (daysBetweenIso(q.from, q.to) + 1 > MAX_ANALYTICS_DAYS) return fail('Pick a range of two years or less.', 400)
    range = { from: q.from, to: q.to }
  } else {
    range = presetRange(preset, regionOf(co).timezone)
  }
  const compare = q.compare === undefined || q.compare === '' ? true : !['0', 'false', 'no'].includes(q.compare)
  return delay(buildAnalytics(co, preset, range.from, range.to, compare))
}
