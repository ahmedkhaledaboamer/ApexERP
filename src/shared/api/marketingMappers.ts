import { defineMapper } from './mapping'
import type {
  AudiencePreview,
  BulkEmailDetail,
  BulkEmailInput,
  Campaign,
  CampaignCost,
  CampaignCostInput,
  CampaignInput,
  CampaignResults,
  MarketingOptions,
  MarketingReport,
  TestSendResult,
} from '@/modules/marketing/types'

/**
 * Marketing resources on the wire (database design §13: campaigns, campaign_costs, bulk_emails,
 * bulk_email_recipients). Kept apart from mappers.ts so the module stays self-contained; same rules
 * (shared/api/mapping.ts). Explicit names where the design column differs from plain snake_case.
 */

/** campaigns: currency_code, starts_on, ends_on; derived spend / leads / won / cost_per_lead. */
const CAMPAIGN_FIELDS = { currency: 'currency_code', startDate: 'starts_on', endDate: 'ends_on' }
export const campaignMapper = defineMapper<Campaign>({ fields: CAMPAIGN_FIELDS })
export const campaignInputMapper = defineMapper<CampaignInput>({ fields: CAMPAIGN_FIELDS })

/** campaign_costs: incurred_on, amount, description. */
const COST_FIELDS = { date: 'incurred_on', note: 'description', campaignId: 'campaign_id' }
export const campaignCostMapper = defineMapper<CampaignCost>({ fields: COST_FIELDS })
export const campaignCostInputMapper = defineMapper<CampaignCostInput>({ fields: COST_FIELDS })

/** bulk_emails.filters (json): industries, statuses, sources, owner_ids. */
const filtersMapper = defineMapper({ deep: true })
/** bulk_emails: message_template_id, filters, scheduled_at, created_by; counts (derived, recipients_count…). */
const BULK_FIELDS = { templateId: 'message_template_id', audience: 'filters' }
export const bulkEmailMapper = defineMapper<BulkEmailDetail>({
  fields: BULK_FIELDS,
  nested: { audience: filtersMapper as never, counts: defineMapper({ deep: true, opaque: ['skippedBy'] }) as never, recipients: defineMapper() as never },
})
export const bulkEmailInputMapper = defineMapper<BulkEmailInput>({ fields: BULK_FIELDS, nested: { audience: filtersMapper as never } })

/** Results, preview, options and the cost-per-lead report are aggregates: every level converted. */
export const campaignResultsMapper = defineMapper<CampaignResults>({
  deep: true,
  nested: { campaign: campaignMapper as never, costs: campaignCostMapper as never, emails: bulkEmailMapper as never },
})
export const audiencePreviewMapper = defineMapper<AudiencePreview>({ deep: true })
export const marketingOptionsMapper = defineMapper<MarketingOptions>({ deep: true })
export const marketingReportMapper = defineMapper<MarketingReport>({ deep: true })
export const testSendMapper = defineMapper<TestSendResult>({ fields: { from: 'from_address', to: 'to_address' } })

/** Query parameter names. */
export const MARKETING_QUERY = { status: 'status', campaignId: 'campaign_id', from: 'from', to: 'to' } as const
