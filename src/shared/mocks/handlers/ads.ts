import { http, type HttpHandler } from 'msw'
import type { AdCampaignMapInput, AdConnectInput } from '@/modules/marketing/adsTypes'
import * as ads from '@/shared/mocks/services/ads'
import { getMarketingAnalytics } from '@/shared/mocks/services/marketingAnalytics'
import {
  ANALYTICS_QUERY,
  adAccountMapper,
  adCampaignMapInputMapper,
  adCampaignMapper,
  adConnectInputMapper,
  adConnectionMapper,
  marketingAnalyticsMapper,
} from '@/shared/api/adsMappers'
import { API, respondAs, userFrom } from './utils'

type Params = { id: string }

async function body<T>(request: Request, mapper: { fromApi(v: unknown): unknown }): Promise<T> {
  const raw = (await request.json().catch(() => null)) as unknown
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? mapper.fromApi(raw) : {}) as T
}

/**
 * Marketing › Ads integrations and Marketing analytics (plan module `marketing`, gated centrally for
 * /marketing/*; connecting / syncing also need `integrations`, checked in services/ads.ts).
 */
export const adsHandlers: HttpHandler[] = [
  http.get(`${API}/marketing/ads/connections`, ({ request }) => respondAs(adConnectionMapper, () => ads.getAdConnections(userFrom(request)))),
  http.post(`${API}/marketing/ads/connections`, async ({ request }) => {
    const input = await body<AdConnectInput>(request, adConnectInputMapper)
    return respondAs(adConnectionMapper, () => ads.connectAdAccount(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/ads/connections/:id`, ({ request, params }) =>
    respondAs(adConnectionMapper, () => ads.getAdConnection(userFrom(request), params.id)),
  ),
  http.delete<Params>(`${API}/marketing/ads/connections/:id`, ({ request, params }) =>
    respondAs(adConnectionMapper, () => ads.disconnectAdAccount(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/marketing/ads/connections/:id/sync`, ({ request, params }) =>
    respondAs(adConnectionMapper, () => ads.syncAdConnection(userFrom(request), params.id)),
  ),
  http.get<{ provider: string }>(`${API}/marketing/ads/providers/:provider/accounts`, ({ request, params }) =>
    respondAs(adAccountMapper, () => ads.getAdAccounts(userFrom(request), params.provider)),
  ),
  http.patch<Params>(`${API}/marketing/ads/campaigns/:id`, async ({ request, params }) => {
    const input = await body<AdCampaignMapInput>(request, adCampaignMapInputMapper)
    return respondAs(adCampaignMapper, () => ads.mapAdCampaign(userFrom(request), params.id, input))
  }),

  http.get(`${API}/marketing/analytics`, ({ request }) => {
    const p = new URL(request.url).searchParams
    const q = {
      preset: p.get(ANALYTICS_QUERY.preset) ?? undefined,
      from: p.get(ANALYTICS_QUERY.from) ?? undefined,
      to: p.get(ANALYTICS_QUERY.to) ?? undefined,
      compare: p.get(ANALYTICS_QUERY.compare) ?? undefined,
    }
    return respondAs(marketingAnalyticsMapper, () => getMarketingAnalytics(userFrom(request), q))
  }),
]
