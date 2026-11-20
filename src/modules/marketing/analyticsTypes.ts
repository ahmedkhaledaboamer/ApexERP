import type { CampaignChannel, CampaignStatus } from '@/modules/marketing/types'
import type { AdProvider, AdTotals } from '@/modules/marketing/adsTypes'

/**
 * Marketing analytics (GET /marketing/analytics): one company-scoped dashboard for a date range in
 * the company's timezone, with the previous period of the same length. Rules: docs/API.md › Marketing
 * › Marketing analytics.
 */

export type AnalyticsPreset = 'this_month' | 'last_30_days' | 'this_quarter' | 'ytd' | 'custom'
export const ANALYTICS_PRESETS: AnalyticsPreset[] = ['this_month', 'last_30_days', 'this_quarter', 'ytd', 'custom']
export const ANALYTICS_PRESET_LABEL: Record<AnalyticsPreset, string> = {
  this_month: 'This month',
  last_30_days: 'Last 30 days',
  this_quarter: 'This quarter',
  ytd: 'Year to date',
  custom: 'Custom range',
}

export interface AnalyticsQuery {
  preset: AnalyticsPreset
  /** Custom range only (YYYY-MM-DD, company-local). */
  from?: string
  to?: string
  compare: boolean
}

export interface AnalyticsKpis {
  /** Campaign costs incurred in the period (manual and synced ad spend). */
  spend: number
  /** Leads created in the period. */
  leads: number
  /** Of those, leads with a campaign. */
  attributedLeads: number
  /** spend ÷ attributed leads (null without attributed leads). */
  costPerLead: number | null
  /** Leads created in the period that are won now. */
  won: number
  wonValue: number
  /** Won value of the attributed won leads (the ROI's return). */
  attributedWonValue: number
  /** (attributed won value − spend) ÷ spend, in % (null without spend). */
  roi: number | null
  /** won ÷ leads, in % (null without leads). */
  conversionRate: number | null
}

export interface AnalyticsPoint {
  /** First day of the bucket. */
  start: string
  leads: number
  spend: number
}

export interface AnalyticsSourceRow {
  source: string
  label: string
  leads: number
  attributed: number
  won: number
}

export interface AnalyticsChannelRow {
  channel: CampaignChannel | 'none'
  leads: number
  spend: number
  won: number
}

export interface AnalyticsFunnelStage {
  key: 'new' | 'contacted' | 'interested' | 'meeting' | 'proposal' | 'won'
  label: string
  count: number
  /** % of the first stage (null when it's empty). */
  rate: number | null
}

export interface AnalyticsCampaignRow {
  campaignId: string
  name: string
  channel: CampaignChannel
  status: CampaignStatus
  spend: number
  leads: number
  costPerLead: number | null
  won: number
  wonValue: number
  costPerWon: number | null
  roi: number | null
  sent: number
  opened: number
  replied: number
}

export interface AnalyticsEmail {
  sent: number
  opened: number
  replied: number
  openRate: number | null
  replyRate: number | null
  sends: { id: string; name: string; sent: number; openRate: number | null; replyRate: number | null }[]
}

export interface AnalyticsEvents {
  /** False when the plan has no Events module (rows empty). */
  included: boolean
  attendees: number
  leads: number
  won: number
  rows: { eventId: string; name: string; startsOn: string; attendees: number; leads: number; won: number }[]
}

export interface AnalyticsAdsRow extends AdTotals {
  provider: AdProvider
}

/** Content Calendar output in the period: items published (published_at) and scheduled to publish (publish_at). */
export interface AnalyticsContent {
  published: number
  scheduled: number
  byType: { type: string; count: number }[]
}

/** Lead Generation forms in the period (spam excluded): submissions and the leads they created / linked. */
export interface AnalyticsForms {
  submissions: number
  leadsCreated: number
  linked: number
  rows: { formId: string; name: string; submissions: number; leadsCreated: number }[]
}

export interface MarketingAnalytics {
  preset: AnalyticsPreset
  from: string
  to: string
  days: number
  previous: { from: string; to: string } | null
  currency: string
  timezone: string
  kpis: AnalyticsKpis
  previousKpis: AnalyticsKpis | null
  bucket: 'day' | 'week' | 'month'
  timeline: AnalyticsPoint[]
  bySource: AnalyticsSourceRow[]
  byChannel: AnalyticsChannelRow[]
  funnel: AnalyticsFunnelStage[]
  campaigns: AnalyticsCampaignRow[]
  email: AnalyticsEmail
  events: AnalyticsEvents
  ads: { providers: AnalyticsAdsRow[]; totals: AdTotals }
  content: AnalyticsContent
  forms: AnalyticsForms
}
