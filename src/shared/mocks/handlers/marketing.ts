import { http, type HttpHandler } from 'msw'
import type { AudienceFilter, BulkEmailInput, CampaignCostInput, CampaignInput } from '@/modules/marketing/types'
import * as svc from '@/shared/mocks/services/marketing'
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
import { defineMapper } from '@/shared/api/mapping'
import { API, respondAs, userFrom } from './utils'

type Params = { id: string }

/** A JSON body parsed with a mapper (empty or invalid body = {}). */
async function body<T>(request: Request, mapper: { fromApi(v: unknown): unknown }): Promise<T> {
  const raw = (await request.json().catch(() => null)) as unknown
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? mapper.fromApi(raw) : {}) as T
}
const plain = defineMapper()
const filtersBody = defineMapper<{ filters?: Partial<AudienceFilter> }>({ nested: { filters: defineMapper({ deep: true }) as never } })

/**
 * Marketing (plan module `marketing`): /marketing/* is gated centrally (userFrom →
 * enforceRequestPolicy → 403 module_not_in_plan). snake_case on the wire (shared/api/marketingMappers.ts).
 */
export const marketingHandlers: HttpHandler[] = [
  http.get(`${API}/marketing/options`, ({ request }) => respondAs(marketingOptionsMapper, () => svc.getMarketingOptions(userFrom(request)))),

  http.get(`${API}/marketing/campaigns`, ({ request }) => {
    const status = new URL(request.url).searchParams.get(MARKETING_QUERY.status) ?? undefined
    return respondAs(campaignMapper, () => svc.getCampaigns(userFrom(request), { status }))
  }),
  http.post(`${API}/marketing/campaigns`, async ({ request }) => {
    const input = await body<CampaignInput>(request, campaignInputMapper)
    return respondAs(campaignMapper, () => svc.createCampaign(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/campaigns/:id`, ({ request, params }) =>
    respondAs(campaignMapper, () => svc.getCampaign(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/marketing/campaigns/:id`, async ({ request, params }) => {
    const input = await body<CampaignInput>(request, campaignInputMapper)
    return respondAs(campaignMapper, () => svc.updateCampaign(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/campaigns/:id/costs`, async ({ request, params }) => {
    const input = await body<CampaignCostInput>(request, campaignCostInputMapper)
    return respondAs(campaignCostMapper, () => svc.addCampaignCost(userFrom(request), params.id, input))
  }),
  http.get<Params>(`${API}/marketing/campaigns/:id/results`, ({ request, params }) =>
    respondAs(campaignResultsMapper, () => svc.getCampaignResults(userFrom(request), params.id)),
  ),

  http.get(`${API}/marketing/emails`, ({ request }) => {
    const p = new URL(request.url).searchParams
    const q = { status: p.get(MARKETING_QUERY.status) ?? undefined, campaignId: p.get(MARKETING_QUERY.campaignId) ?? undefined }
    return respondAs(bulkEmailMapper, () => svc.getBulkEmails(userFrom(request), q))
  }),
  http.post(`${API}/marketing/emails`, async ({ request }) => {
    const input = await body<BulkEmailInput>(request, bulkEmailInputMapper)
    return respondAs(bulkEmailMapper, () => svc.createBulkEmail(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/emails/:id`, ({ request, params }) =>
    respondAs(bulkEmailMapper, () => svc.getBulkEmail(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/marketing/emails/:id`, async ({ request, params }) => {
    const input = await body<BulkEmailInput>(request, bulkEmailInputMapper)
    return respondAs(bulkEmailMapper, () => svc.updateBulkEmail(userFrom(request), params.id, input))
  }),
  http.delete<Params>(`${API}/marketing/emails/:id`, ({ request, params }) =>
    respondAs(bulkEmailMapper, () => svc.cancelBulkEmail(userFrom(request), params.id)),
  ),
  // Body (optional) `{ filters }`: preview an unsaved target list; without it, the saved one.
  http.post<Params>(`${API}/marketing/emails/:id/preview-audience`, async ({ request, params }) => {
    const input = await body<{ filters?: Partial<AudienceFilter> }>(request, filtersBody)
    return respondAs(audiencePreviewMapper, () => svc.previewAudience(userFrom(request), params.id, input.filters))
  }),
  http.post<Params>(`${API}/marketing/emails/:id/schedule`, async ({ request, params }) => {
    const input = await body<{ scheduledAt?: unknown }>(request, plain)
    return respondAs(bulkEmailMapper, () => svc.scheduleBulkEmail(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/emails/:id/send-now`, ({ request, params }) =>
    respondAs(bulkEmailMapper, () => svc.sendBulkEmailNow(userFrom(request), params.id)),
  ),
  http.post<Params>(`${API}/marketing/emails/:id/test`, async ({ request, params }) => {
    const input = await body<{ to?: unknown }>(request, plain)
    return respondAs(testSendMapper, () => svc.testBulkEmail(userFrom(request), params.id, input))
  }),

  http.get(`${API}/marketing/reports/cost-per-lead`, ({ request }) => {
    const p = new URL(request.url).searchParams
    return respondAs(marketingReportMapper, () =>
      svc.getMarketingReport(userFrom(request), { from: p.get(MARKETING_QUERY.from) ?? undefined, to: p.get(MARKETING_QUERY.to) ?? undefined }),
    )
  }),
]
