/**
 * Ads integrations (Marketing › Ads Integrations): ad accounts connected per company through a
 * (simulated) OAuth flow, synced daily. Wire names: shared/api/adsMappers.ts; rules: docs/API.md ›
 * Marketing › Ads integrations.
 */

export type AdProvider = 'meta' | 'google' | 'linkedin' | 'tiktok'
export const AD_PROVIDERS: AdProvider[] = ['meta', 'google', 'linkedin', 'tiktok']
export const AD_PROVIDER_LABEL: Record<AdProvider, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  linkedin: 'LinkedIn Ads',
  tiktok: 'TikTok Ads',
}
/** Providers whose lead forms become CRM leads (Meta lead ads, LinkedIn Lead Gen Forms). */
export const LEAD_AD_PROVIDERS: AdProvider[] = ['meta', 'linkedin']

export type AdConnectionStatus = 'connected' | 'error' | 'disconnected'
export type AdObjective = 'leads' | 'traffic' | 'conversions' | 'awareness'
export const AD_OBJECTIVE_LABEL: Record<AdObjective, string> = {
  leads: 'Lead generation',
  traffic: 'Traffic',
  conversions: 'Conversions',
  awareness: 'Awareness',
}
export type AdSyncTrigger = 'initial' | 'daily' | 'manual'
export type AdSyncStatus = 'success' | 'error'
/** created = new lead · duplicate = linked to the existing lead · limit = plan limit reached (no lead) · pending_source = waiting for a lead source. */
export type LeadSubmissionOutcome = 'created' | 'duplicate' | 'limit' | 'pending_source'
export const LEAD_OUTCOME_LABEL: Record<LeadSubmissionOutcome, string> = {
  created: 'New lead',
  duplicate: 'Existing lead',
  limit: 'Plan limit',
  pending_source: 'Waiting for source',
}

/** An ad account the (simulated) authorizing user can pick in the connect dialog. */
export interface AdAccountOption {
  accountId: string
  name: string
  currency: string
  /** Already connected in this workspace. */
  connected: boolean
}

export interface AdTotals {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  leads: number
  /** Click-through rate in % (one decimal), null without impressions. */
  ctr: number | null
  /** Cost per click, null without clicks. */
  cpc: number | null
}

export interface AdConnection {
  id: string
  provider: AdProvider
  accountId: string
  accountName: string
  currency: string
  status: AdConnectionStatus
  /** Masked hint of the stored access token ("•••• 4f2a"); the token itself is never returned. */
  tokenHint: string | null
  connectedBy: string
  connectedByName: string
  connectedAt: string
  disconnectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: AdSyncStatus | null
  lastError: string | null
  /** Last company-local day whose stats are imported. */
  syncedThrough: string | null
  leadAds: boolean
  campaigns: number
  mapped: number
  /** Totals of the last 30 synced days. */
  last30: AdTotals
  /** Lead-form submissions waiting for a lead source. */
  pendingLeads: number
}

export interface AdCampaign {
  id: string
  connectionId: string
  externalId: string
  name: string
  objective: AdObjective
  status: 'active' | 'paused'
  campaignId: string | null
  campaignName: string | null
  mappedAt: string | null
  /** Totals of the last 30 synced days. */
  totals: AdTotals
  /** Campaign cost entries this ad campaign created so far. */
  costEntries: number
}

export interface AdSyncRun {
  id: string
  connectionId: string
  trigger: AdSyncTrigger
  status: AdSyncStatus
  startedAt: string
  finishedAt: string
  rows: number
  costs: number
  leadsCreated: number
  leadsDuplicate: number
  leadsSkipped: number
  leadsPending: number
  error: string | null
}

export interface AdLeadSubmission {
  id: string
  adCampaignId: string
  adCampaignName: string
  submittedAt: string
  name: string
  email: string
  companyName: string
  outcome: LeadSubmissionOutcome
  leadId: string | null
  campaignId: string | null
  message: string
}

export interface AdDailyPoint {
  date: string
  spend: number
  clicks: number
  impressions: number
  leads: number
}

export interface AdConnectionDetail extends AdConnection {
  adCampaigns: AdCampaign[]
  /** Newest first (last 20). */
  runs: AdSyncRun[]
  /** Newest first (last 50). */
  submissions: AdLeadSubmission[]
  /** Last 30 synced days, oldest first. */
  daily: AdDailyPoint[]
}

export interface AdConnectInput {
  provider: AdProvider
  accountId: string
  consent: boolean
}

export interface AdCampaignMapInput {
  campaignId: string | null
}
