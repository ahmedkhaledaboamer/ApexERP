import { format, subDays } from 'date-fns'
import type { AudienceFilter, BulkEmailStatus, CampaignChannel, CampaignStatus, RecipientStatus, SkipReason } from '@/modules/marketing/types'
import { leads } from '@/shared/mocks/db'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Marketing tables (database design §13): campaigns, campaign_costs, bulk_emails,
 * bulk_email_recipients. Every row carries companyId (tenant key). Seed ids live in per-company
 * blocks (Apex 1xxx, Crest 5xxx) like the leads; new rows take ids from a shared counter.
 */

export interface CampaignRecord {
  id: string
  name: string
  channel: CampaignChannel
  status: CampaignStatus
  budget: number | null
  currency: string
  startDate: string | null
  endDate: string | null
  goal: string
  targetLeads: number | null
  ownerId: string | null
  sourceDetail: string
  createdAt: string
  updatedAt: string
}

export interface CampaignCostRecord {
  id: string
  campaignId: string
  date: string
  amount: number
  note: string
  createdAt: string
}

export interface BulkEmailRecord {
  id: string
  name: string
  campaignId: string | null
  templateId: string | null
  subject: string
  body: string
  audience: AudienceFilter
  status: BulkEmailStatus
  /** UTC instant of the scheduled start. */
  scheduledAt: string | null
  startedAt: string | null
  sentAt: string | null
  /** Linked event (Events › Invite an audience / follow-up): fills the {{event.*}} variables. */
  eventId?: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface RecipientRecord {
  id: string
  bulkEmailId: string
  leadId: string | null
  contactId: string | null
  email: string
  status: RecipientStatus
  skipReason: SkipReason | null
  /** Queue order inside the company (FIFO): when the recipient was queued, then its index. */
  queuedAt: string
  seq: number
  sentAt: string | null
  openedAt: string | null
  repliedAt: string | null
}

const NOW = new Date()
const daysAgo = (n: number) => subDays(NOW, n)
const isoDay = (n: number) => format(daysAgo(n), 'yyyy-MM-dd')

function campaign(
  companyId: string,
  id: string,
  name: string,
  channel: CampaignChannel,
  status: CampaignStatus,
  currency: string,
  budget: number | null,
  start: number | null,
  end: number | null,
  goal: string,
  targetLeads: number | null,
  ownerId: string,
  sourceDetail: string,
): Tenant<CampaignRecord> {
  const createdAt = daysAgo((start ?? 5) + 3).toISOString()
  return {
    companyId,
    id,
    name,
    channel,
    status,
    budget,
    currency,
    startDate: start === null ? null : isoDay(start),
    endDate: end === null ? null : isoDay(end),
    goal,
    targetLeads,
    ownerId,
    sourceDetail,
    createdAt,
    updatedAt: createdAt,
  }
}

export const campaigns: Tenant<CampaignRecord>[] = registerArray('campaigns', [
  campaign('co_apex', 'CMP-1001', 'Q4 LinkedIn outreach', 'social', 'active', 'AED', 25000, 75, -30, 'Book discovery meetings with healthcare and real estate decision makers.', 12, 'u7', 'utm_source=linkedin&utm_campaign=q4-outreach'),
  campaign('co_apex', 'CMP-1002', 'GITEX Global 2026 booth', 'event', 'completed', 'AED', 60000, 120, 100, 'Collect qualified leads at the stand and follow up within a week.', 15, 'u7', 'Hall 4 stand B12'),
  campaign('co_apex', 'CMP-1003', 'Year-end nurture emails', 'email', 'draft', 'AED', 5000, null, null, 'Re-engage open leads before budgets reset in January.', null, 'u7', 'utm_source=newsletter&utm_campaign=year-end'),
  campaign('co_crest', 'CMP-5001', 'Riyadh Logistics Expo', 'event', 'completed', 'SAR', 90000, 140, 110, 'Meet procurement heads of manufacturers and retailers.', 10, 'u102', 'Riyadh Front, booth 21'),
  campaign('co_crest', 'CMP-5002', 'LinkedIn sponsored content Q4', 'ads', 'active', 'SAR', 30000, 60, -20, 'Generate inbound leads for cold-chain and warehousing.', 8, 'u102', 'utm_source=linkedin&utm_medium=paid'),
])

function cost(companyId: string, id: string, campaignId: string, day: number, amount: number, note: string): Tenant<CampaignCostRecord> {
  return { companyId, id, campaignId, date: isoDay(day), amount, note, createdAt: daysAgo(day).toISOString() }
}

export const campaignCosts: Tenant<CampaignCostRecord>[] = registerArray('campaignCosts', [
  cost('co_apex', 'CC-1001', 'CMP-1001', 70, 6000, 'Sponsored InMail, October'),
  cost('co_apex', 'CC-1002', 'CMP-1001', 40, 7500, 'Sponsored InMail, November'),
  cost('co_apex', 'CC-1003', 'CMP-1002', 125, 42000, 'Stand rental and build'),
  cost('co_apex', 'CC-1004', 'CMP-1002', 118, 9500, 'Printed material and giveaways'),
  cost('co_crest', 'CC-5001', 'CMP-5001', 145, 65000, 'Booth and travel'),
  cost('co_crest', 'CC-5002', 'CMP-5002', 55, 12000, 'Sponsored posts, first month'),
])

export const bulkEmails: Tenant<BulkEmailRecord>[] = registerArray('bulkEmails', [])
export const bulkEmailRecipients: Tenant<RecipientRecord>[] = registerArray('bulkEmailRecipients', [])

/** Shared id counter for new marketing rows. */
let nextSeq = 1
registerValue('marketing.seq', () => nextSeq, (v) => { nextSeq = Number(v) || 1 })
export function nextMarketingId(prefix: 'CMP' | 'CC' | 'BE' | 'BER'): string {
  return `${prefix}-${9000 + nextSeq++}`
}

/** The queue worker's last processed slot (ms since epoch, slot-aligned); 0 = never ran. */
export const queueState = { lastSlot: 0, cursor: 0 }
registerValue('marketing.queue', () => ({ ...queueState }), (v) => {
  const s = (v ?? {}) as Partial<typeof queueState>
  queueState.lastSlot = Number(s.lastSlot) || 0
  queueState.cursor = Number(s.cursor) || 0
})

/* ---------------- Seed attribution (leads.campaign_id) ---------------- */

/** Seed leads from a campaign's source point at it, so cost per lead has data from day one. */
const ATTRIBUTION: { companyId: string; source: string; campaignId: string }[] = [
  { companyId: 'co_apex', source: 'LinkedIn', campaignId: 'CMP-1001' },
  { companyId: 'co_apex', source: 'Event', campaignId: 'CMP-1002' },
  { companyId: 'co_crest', source: 'Trade Show', campaignId: 'CMP-5001' },
  { companyId: 'co_crest', source: 'LinkedIn', campaignId: 'CMP-5002' },
]
for (const lead of leads) {
  if (lead.campaignId !== undefined) continue
  lead.campaignId = ATTRIBUTION.find((a) => a.companyId === lead.companyId && a.source === lead.sourceType)?.campaignId ?? null
}
