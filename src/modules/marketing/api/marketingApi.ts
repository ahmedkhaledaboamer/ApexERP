import { http } from '@/shared/lib/axios'
import type {
  AudienceFilter,
  AudiencePreview,
  BulkEmail,
  BulkEmailDetail,
  BulkEmailInput,
  BulkEmailUpdateInput,
  Campaign,
  CampaignCost,
  CampaignCostInput,
  CampaignInput,
  CampaignResults,
  CampaignUpdateInput,
  MarketingOptions,
  MarketingReport,
  TestSendResult,
} from '@/modules/marketing/types'
import {
  MARKETING_QUERY,
  audiencePreviewMapper,
  bulkEmailInputMapper,
  bulkEmailMapper,
  campaignCostInputMapper,
  campaignCostMapper,
  campaignInputMapper,
  campaignMapper,
  campaignResultsMapper,
  marketingOptionsMapper,
  marketingReportMapper,
  testSendMapper,
} from '@/shared/api/marketingMappers'

/**
 * Marketing API (plan module `marketing`). The server decides company and rights from the token;
 * bodies and answers are in the design's columns (shared/api/marketingMappers.ts).
 */

const enc = encodeURIComponent

export async function getMarketingOptions(): Promise<MarketingOptions> {
  return marketingOptionsMapper.fromApi((await http.get<unknown>('/marketing/options')).data)
}

export async function getCampaigns(): Promise<Campaign[]> {
  return campaignMapper.fromApiList((await http.get<unknown>('/marketing/campaigns')).data)
}

export async function getCampaign(id: string): Promise<Campaign> {
  return campaignMapper.fromApi((await http.get<unknown>(`/marketing/campaigns/${enc(id)}`)).data)
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  return campaignMapper.fromApi((await http.post<unknown>('/marketing/campaigns', campaignInputMapper.toApi(input))).data)
}

export async function updateCampaign(id: string, input: CampaignUpdateInput): Promise<Campaign> {
  return campaignMapper.fromApi((await http.patch<unknown>(`/marketing/campaigns/${enc(id)}`, campaignInputMapper.toApi(input))).data)
}

export async function addCampaignCost(id: string, input: CampaignCostInput): Promise<CampaignCost> {
  return campaignCostMapper.fromApi((await http.post<unknown>(`/marketing/campaigns/${enc(id)}/costs`, campaignCostInputMapper.toApi(input))).data)
}

export async function getCampaignResults(id: string): Promise<CampaignResults> {
  return campaignResultsMapper.fromApi((await http.get<unknown>(`/marketing/campaigns/${enc(id)}/results`)).data)
}

export async function getBulkEmails(params: { campaignId?: string } = {}): Promise<BulkEmail[]> {
  const query = params.campaignId ? { [MARKETING_QUERY.campaignId]: params.campaignId } : undefined
  return bulkEmailMapper.fromApiList((await http.get<unknown>('/marketing/emails', { params: query })).data)
}

export async function getBulkEmail(id: string): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.get<unknown>(`/marketing/emails/${enc(id)}`)).data)
}

export async function createBulkEmail(input: BulkEmailInput): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.post<unknown>('/marketing/emails', bulkEmailInputMapper.toApi(input))).data)
}

export async function updateBulkEmail(id: string, input: BulkEmailUpdateInput): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.patch<unknown>(`/marketing/emails/${enc(id)}`, bulkEmailInputMapper.toApi(input))).data)
}

/** DELETE = cancel (draft, scheduled, or the rest of a send in progress). */
export async function cancelBulkEmail(id: string): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.delete<unknown>(`/marketing/emails/${enc(id)}`)).data)
}

export async function previewAudience(id: string, filters?: AudienceFilter): Promise<AudiencePreview> {
  const body = filters ? bulkEmailInputMapper.toApi({ audience: filters }) : {}
  return audiencePreviewMapper.fromApi((await http.post<unknown>(`/marketing/emails/${enc(id)}/preview-audience`, body)).data)
}

/** `local` = "YYYY-MM-DDTHH:mm" in the company's timezone. */
export async function scheduleBulkEmail(id: string, local: string): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.post<unknown>(`/marketing/emails/${enc(id)}/schedule`, { scheduled_at: local })).data)
}

export async function sendBulkEmailNow(id: string): Promise<BulkEmailDetail> {
  return bulkEmailMapper.fromApi((await http.post<unknown>(`/marketing/emails/${enc(id)}/send-now`)).data)
}

export async function testBulkEmail(id: string, to: string): Promise<TestSendResult> {
  return testSendMapper.fromApi((await http.post<unknown>(`/marketing/emails/${enc(id)}/test`, { to })).data)
}

export async function getMarketingReport(from: string, to: string): Promise<MarketingReport> {
  const params = { [MARKETING_QUERY.from]: from, [MARKETING_QUERY.to]: to }
  return marketingReportMapper.fromApi((await http.get<unknown>('/marketing/reports/cost-per-lead', { params })).data)
}
