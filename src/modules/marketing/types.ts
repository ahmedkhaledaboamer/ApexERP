/**
 * Marketing (Phase 2, plan module `marketing`): campaigns, their costs, bulk emails and results.
 * Tables: campaigns, campaign_costs, bulk_emails, bulk_email_recipients (database design §13);
 * leads.campaign_id attributes a lead to a campaign. Wire names: src/shared/api/marketingMappers.ts.
 */

export type CampaignChannel = 'email' | 'social' | 'ads' | 'event' | 'referral' | 'other'
export const CAMPAIGN_CHANNELS: CampaignChannel[] = ['email', 'social', 'ads', 'event', 'referral', 'other']
export const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  email: 'Email',
  social: 'Social',
  ads: 'Ads',
  event: 'Event',
  referral: 'Referral',
  other: 'Other',
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['draft', 'active', 'paused', 'completed']
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
}

export interface Campaign {
  id: string
  name: string
  channel: CampaignChannel
  status: CampaignStatus
  /** Planned spend; null = no budget set. */
  budget: number | null
  currency: string
  /** Company-local calendar dates (YYYY-MM-DD). */
  startDate: string | null
  endDate: string | null
  goal: string
  /** Optional number of leads the campaign aims for. */
  targetLeads: number | null
  ownerId: string | null
  ownerName: string
  /** UTM / source detail (e.g. utm_campaign=q4-linkedin). */
  sourceDetail: string
  createdAt: string
  updatedAt: string
  /** Derived: sum of campaign_costs. */
  spend: number
  /** Derived: leads with leads.campaign_id = this campaign. */
  leads: number
  won: number
  /** spend / leads; null without leads. */
  costPerLead: number | null
}

export interface CampaignInput {
  name: string
  channel: CampaignChannel
  status?: CampaignStatus
  budget?: number | null
  startDate?: string | null
  endDate?: string | null
  goal?: string
  targetLeads?: number | null
  ownerId?: string | null
  sourceDetail?: string
}
export type CampaignUpdateInput = Partial<CampaignInput>

export interface CampaignCost {
  id: string
  campaignId: string
  /** Company-local date the money was spent (incurred_on). */
  date: string
  amount: number
  note: string
  createdAt: string
}
export interface CampaignCostInput {
  date: string
  amount: number
  note?: string
}

/* ---------------- Bulk email ---------------- */

export type BulkEmailStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
export const BULK_EMAIL_STATUSES: BulkEmailStatus[] = ['draft', 'scheduled', 'sending', 'sent', 'cancelled']
export const BULK_EMAIL_STATUS_LABEL: Record<BulkEmailStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  cancelled: 'Cancelled',
}

/** Target list. Empty arrays don't filter. Values are list keys / user ids of the company. */
export interface AudienceFilter {
  industries: string[]
  statuses: string[]
  sources: string[]
  ownerIds: string[]
  /**
   * A saved audience (Marketing › Audiences) the send starts from; the filters above narrow it further.
   * Resolved again by the server at send time (dynamic rules re-applied). Absent = no audience.
   */
  audienceId?: string | null
}

export type RecipientStatus = 'queued' | 'sent' | 'skipped' | 'failed'
export type SkipReason = 'dnc' | 'not_interested' | 'no_email' | 'duplicate' | 'limit' | 'removed' | 'cancelled'
export const SKIP_REASONS: SkipReason[] = ['dnc', 'not_interested', 'no_email', 'duplicate', 'limit', 'removed', 'cancelled']
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  cancelled: 'Send cancelled',
  dnc: 'Do Not Contact',
  not_interested: 'Not interested',
  no_email: 'No email address',
  duplicate: 'Duplicate email',
  limit: 'Monthly email limit reached',
  removed: 'Lead no longer exists',
}

export interface BulkEmailCounts {
  recipients: number
  queued: number
  sent: number
  skipped: number
  failed: number
  opened: number
  replied: number
  /** opened / sent, replied / sent (0–100, one decimal); null before anything was sent. */
  openRate: number | null
  replyRate: number | null
  skippedBy: Record<SkipReason, number>
}

export interface BulkEmail {
  id: string
  name: string
  campaignId: string | null
  campaignName: string | null
  /** Settings › Templates email template it started from (null = written from scratch). */
  templateId: string | null
  subject: string
  body: string
  audience: AudienceFilter
  status: BulkEmailStatus
  /** UTC instant; also given as company-local wall time + timezone. */
  scheduledAt: string | null
  scheduledLocal: string | null
  timezone: string
  startedAt: string | null
  sentAt: string | null
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
  counts: BulkEmailCounts
}

export interface BulkEmailInput {
  name: string
  campaignId?: string | null
  templateId?: string | null
  subject?: string
  body?: string
  audience?: Partial<AudienceFilter>
}
export type BulkEmailUpdateInput = Partial<BulkEmailInput>

export interface BulkEmailRecipient {
  id: string
  leadId: string | null
  contactId: string | null
  company: string
  name: string
  email: string
  status: RecipientStatus
  skipReason: SkipReason | null
  sentAt: string | null
  openedAt: string | null
  repliedAt: string | null
}

export interface BulkEmailDetail extends BulkEmail {
  recipients: BulkEmailRecipient[]
}

/** POST /marketing/emails/:id/preview-audience. */
export interface AudiencePreview {
  /** Leads matching the filter. */
  matched: number
  eligible: number
  excluded: { dnc: number; notInterested: number; noEmail: number; duplicate: number }
  /** Statuses excluded as "Not interested" (keys), for the explanation. */
  excludedStatuses: string[]
  /** Emails left this billing period (null = unlimited), minus other scheduled sends. */
  available: number | null
  sample: { leadId: string; company: string; name: string; email: string }[]
}

export interface TestSendResult {
  to: string
  from: string
  subject: string
  html: string
}

/* ---------------- Results & reports ---------------- */

export interface CampaignResults {
  campaign: Campaign
  costs: CampaignCost[]
  emails: BulkEmail[]
  kpis: {
    leads: number
    won: number
    wonValue: number
    spend: number
    budget: number | null
    costPerLead: number | null
    costPerWon: number | null
    sent: number
    opened: number
    replied: number
    openRate: number | null
    replyRate: number | null
    targetLeads: number | null
  }
  /** Leads created / won per week (week start, company-local). */
  timeline: { week: string; leads: number; won: number }[]
}

export interface MarketingOptions {
  currency: string
  timezone: string
  owners: { id: string; name: string; role: string }[]
  templates: { id: string; name: string; subject: string; body: string; purpose: string }[]
  campaigns: { id: string; name: string; status: CampaignStatus }[]
  /** Status keys a bulk email never goes to (besides Do Not Contact). */
  excludedStatuses: string[]
}

export interface MarketingReportRow {
  campaignId: string | null
  name: string
  channel: CampaignChannel | null
  status: CampaignStatus | null
  leads: number
  won: number
  wonValue: number
  spend: number
  costPerLead: number | null
  costPerWon: number | null
  sent: number
  opened: number
  replied: number
}

/** GET /marketing/reports/cost-per-lead?from=&to= (leads created in the period). */
export interface MarketingReport {
  from: string
  to: string
  currency: string
  rows: MarketingReportRow[]
  /** Leads of the period by source and campaign attribution. */
  sources: { source: string; leads: number; attributed: number; won: number }[]
  totals: { leads: number; attributed: number; spend: number; costPerLead: number | null }
}
