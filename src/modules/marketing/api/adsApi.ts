import { http } from '@/shared/lib/axios'
import type { AdAccountOption, AdCampaign, AdConnection, AdConnectionDetail, AdConnectInput, AdProvider } from '@/modules/marketing/adsTypes'
import type { AnalyticsQuery, MarketingAnalytics } from '@/modules/marketing/analyticsTypes'
import {
  ANALYTICS_QUERY,
  adAccountMapper,
  adCampaignMapInputMapper,
  adCampaignMapper,
  adConnectInputMapper,
  adConnectionMapper,
  marketingAnalyticsMapper,
} from '@/shared/api/adsMappers'

/** Ads integrations and marketing analytics (plan module `marketing`; connecting also needs `integrations`). */

const enc = encodeURIComponent

export async function getAdConnections(): Promise<AdConnection[]> {
  return adConnectionMapper.fromApiList((await http.get<unknown>('/marketing/ads/connections')).data)
}

export async function getAdConnection(id: string): Promise<AdConnectionDetail> {
  return adConnectionMapper.fromApi((await http.get<unknown>(`/marketing/ads/connections/${enc(id)}`)).data)
}

export async function getAdAccounts(provider: AdProvider): Promise<AdAccountOption[]> {
  return adAccountMapper.fromApiList((await http.get<unknown>(`/marketing/ads/providers/${enc(provider)}/accounts`)).data)
}

export async function connectAdAccount(input: AdConnectInput): Promise<AdConnectionDetail> {
  return adConnectionMapper.fromApi((await http.post<unknown>('/marketing/ads/connections', adConnectInputMapper.toApi(input))).data)
}

export async function disconnectAdAccount(id: string): Promise<AdConnectionDetail> {
  return adConnectionMapper.fromApi((await http.delete<unknown>(`/marketing/ads/connections/${enc(id)}`)).data)
}

export async function syncAdConnection(id: string): Promise<AdConnectionDetail> {
  return adConnectionMapper.fromApi((await http.post<unknown>(`/marketing/ads/connections/${enc(id)}/sync`)).data)
}

export async function mapAdCampaign(id: string, campaignId: string | null): Promise<AdCampaign> {
  return adCampaignMapper.fromApi((await http.patch<unknown>(`/marketing/ads/campaigns/${enc(id)}`, adCampaignMapInputMapper.toApi({ campaignId }))).data)
}

export async function getMarketingAnalytics(q: AnalyticsQuery): Promise<MarketingAnalytics> {
  const params: Record<string, string> = { [ANALYTICS_QUERY.preset]: q.preset, [ANALYTICS_QUERY.compare]: q.compare ? 'true' : 'false' }
  if (q.preset === 'custom') {
    params[ANALYTICS_QUERY.from] = q.from ?? ''
    params[ANALYTICS_QUERY.to] = q.to ?? ''
  }
  return marketingAnalyticsMapper.fromApi((await http.get<unknown>('/marketing/analytics', { params })).data)
}
