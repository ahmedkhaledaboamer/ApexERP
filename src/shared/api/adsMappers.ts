import { defineMapper } from './mapping'
import type {
  AdAccountOption,
  AdCampaign,
  AdCampaignMapInput,
  AdConnectInput,
  AdConnectionDetail,
} from '@/modules/marketing/adsTypes'
import type { MarketingAnalytics } from '@/modules/marketing/analyticsTypes'

/**
 * Ads integrations and marketing analytics on the wire (shared/api/mapping.ts rules). Design gap:
 * ad connections are `integrations` rows (provider meta_ads / google_ads / …), sync runs are
 * `integration_sync_logs`; ad campaigns, daily stats, lead-form submissions and the cost links have no
 * design table (docs/DB-ALIGNMENT.md › Marketing (ads & analytics)). Explicit names where the design
 * has a column: currency → currency_code, syncedThrough → synced_through, lastSyncAt → last_synced_at.
 */

const CONNECTION_FIELDS = { currency: 'currency_code', lastSyncAt: 'last_synced_at' }
const totals = defineMapper({ deep: true })
export const adCampaignMapper = defineMapper<AdCampaign>({ nested: { totals: totals as never } })
export const adConnectionMapper = defineMapper<AdConnectionDetail>({
  fields: CONNECTION_FIELDS,
  nested: {
    last30: totals as never,
    adCampaigns: adCampaignMapper as never,
    runs: defineMapper() as never,
    submissions: defineMapper() as never,
    daily: defineMapper() as never,
  },
})
export const adAccountMapper = defineMapper<AdAccountOption>({ fields: { currency: 'currency_code' } })
export const adConnectInputMapper = defineMapper<AdConnectInput>()
export const adCampaignMapInputMapper = defineMapper<AdCampaignMapInput>()

/** The analytics payload is an aggregate: every level converted. */
export const marketingAnalyticsMapper = defineMapper<MarketingAnalytics>({ deep: true })

/** Query parameter names of GET /marketing/analytics. */
export const ANALYTICS_QUERY = { preset: 'preset', from: 'from', to: 'to', compare: 'compare' } as const
