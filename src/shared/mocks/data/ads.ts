import type {
  AdConnectionStatus,
  AdObjective,
  AdProvider,
  AdSyncStatus,
  AdSyncTrigger,
  LeadSubmissionOutcome,
} from '@/modules/marketing/adsTypes'
import { registerArray, registerMap, registerValue } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Ads integrations (Marketing › Ads Integrations). Tables (design gap, see docs/DB-ALIGNMENT.md
 * "Marketing (ads & analytics)"): one `integrations` row per connected ad account, its ad campaigns,
 * daily stats, sync runs (`integration_sync_logs`), lead-form submissions, and the link from a synced
 * day of spend to the `campaign_costs` row it created (the idempotency key of the cost sync).
 * Every row carries companyId (tenant key). Access tokens live ONLY in `adTokens` (never in a view).
 * The seed rows are written by services/ads.ts at load time (it needs the sync engine).
 */

export interface AdConnectionRecord {
  id: string
  provider: AdProvider
  /** The provider's ad account id (act_…, 123-456-7890, …). */
  accountId: string
  accountName: string
  currency: string
  status: AdConnectionStatus
  /** Masked hint of the stored token, e.g. "•••• 4f2a" (the token itself never leaves adTokens). */
  tokenHint: string | null
  connectedBy: string
  connectedAt: string
  disconnectedBy: string | null
  disconnectedAt: string | null
  lastSyncAt: string | null
  lastSyncStatus: AdSyncStatus | null
  lastError: string | null
  /** Last company-local day whose stats are imported (complete days only). */
  syncedThrough: string | null
  /** Lead-form submissions from this instant on become leads (the webhook subscription starts at connect). */
  leadsFrom: string
  /** Mock clock ms before which the automatic daily sync won't retry after an error. */
  retryAfter: number
}

export interface AdCampaignRecord {
  id: string
  connectionId: string
  externalId: string
  name: string
  objective: AdObjective
  status: 'active' | 'paused'
  /** The CRM campaign its spend and leads go to (null = unmapped). */
  campaignId: string | null
  mappedAt: string | null
  mappedBy: string | null
}

export interface AdDailyStatRecord {
  connectionId: string
  adCampaignId: string
  date: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  leads: number
}

export interface AdCostLinkRecord {
  /** `${adCampaignId}|${date}`: one cost entry per ad campaign per day, ever. */
  key: string
  adCampaignId: string
  date: string
  campaignId: string
  costId: string
}

export interface AdSyncRunRecord {
  id: string
  connectionId: string
  trigger: AdSyncTrigger
  status: AdSyncStatus
  startedAt: string
  finishedAt: string
  /** Daily stat rows imported. */
  rows: number
  /** Campaign cost entries created. */
  costs: number
  leadsCreated: number
  leadsDuplicate: number
  leadsSkipped: number
  leadsPending: number
  error: string | null
}

export interface AdLeadSubmissionRecord {
  id: string
  connectionId: string
  adCampaignId: string
  /** The provider's lead id (idempotency key per connection). */
  externalId: string
  submittedAt: string
  name: string
  email: string
  companyName: string
  title: string
  outcome: LeadSubmissionOutcome
  leadId: string | null
  campaignId: string | null
  message: string
  processedAt: string | null
}

export const adConnections: Tenant<AdConnectionRecord>[] = registerArray('ads.connections', [])
export const adCampaigns: Tenant<AdCampaignRecord>[] = registerArray('ads.campaigns', [])
export const adDailyStats: Tenant<AdDailyStatRecord>[] = registerArray('ads.dailyStats', [])
export const adCostLinks: Tenant<AdCostLinkRecord>[] = registerArray('ads.costLinks', [])
export const adSyncRuns: Tenant<AdSyncRunRecord>[] = registerArray('ads.syncRuns', [])
export const adLeadSubmissions: Tenant<AdLeadSubmissionRecord>[] = registerArray('ads.leadSubmissions', [])

/** Access tokens by connection id: server-side only (a real backend encrypts integrations.credentials). */
export const adTokens = registerMap('ads.tokens', new Map<string, string>())

let seq = 1
registerValue('ads.seq', () => seq, (v) => {
  seq = Number(v) || 1
})
export function nextAdsId(prefix: 'ADX' | 'ADC' | 'ASR' | 'ALS'): string {
  return `${prefix}-${1000 + seq++}`
}
/** The sequence number of the next sync run (drives the simulated error rate). */
export const adsSeq = () => seq
