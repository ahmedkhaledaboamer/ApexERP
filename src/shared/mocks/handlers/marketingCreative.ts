import { http, type HttpHandler } from 'msw'
import type {
  AssetInput,
  AttachmentInput,
  ContentInput,
  ContentStatusInput,
  DesignInput,
  SaveToAssetsInput,
} from '@/modules/marketing/creative/types'
import * as content from '@/shared/mocks/services/contentCalendar'
import * as design from '@/shared/mocks/services/designRequests'
import * as assets from '@/shared/mocks/services/brandAssets'
import {
  CREATIVE_QUERY as Q,
  assetInputMapper,
  attachmentInputMapper,
  brandAssetMapper,
  contentInputMapper,
  contentItemMapper,
  contentStatusMapper,
  designInputMapper,
  designOptionsMapper,
  designRequestMapper,
  saveToAssetsMapper,
} from '@/shared/api/creativeMappers'
import { defineMapper } from '@/shared/api/mapping'
import { API, respond, respondAs, userFrom } from './utils'

type Params = { id: string }

/** A JSON body parsed with a mapper (empty or invalid body = {}). */
async function body<T>(request: Request, mapper: { fromApi(v: unknown): unknown }): Promise<T> {
  const raw = (await request.json().catch(() => null)) as unknown
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? mapper.fromApi(raw) : {}) as T
}
const plain = defineMapper()
const query = (request: Request) => new URL(request.url).searchParams
const opt = (p: URLSearchParams, k: string) => p.get(k) ?? undefined

/**
 * Marketing creative: content calendar, design requests, brand assets (plan module `marketing`,
 * gated centrally in userFrom). Rights per endpoint: services/contentCalendar.ts, designRequests.ts,
 * brandAssets.ts; contract docs/API.md › Marketing. snake_case on the wire (shared/api/creativeMappers.ts).
 * Fixed paths (/options) are registered before their /:id siblings.
 */
export const marketingCreativeHandlers: HttpHandler[] = [
  /* ---- Content calendar ---- */
  http.get(`${API}/marketing/content`, ({ request }) => {
    const p = query(request)
    const q = {
      status: opt(p, Q.status),
      type: opt(p, Q.type),
      channel: opt(p, Q.channel),
      campaignId: opt(p, Q.campaignId),
      ownerId: opt(p, Q.ownerId),
      from: opt(p, Q.from),
      to: opt(p, Q.to),
    }
    return respondAs(contentItemMapper, () => content.getContentItems(userFrom(request), q))
  }),
  http.post(`${API}/marketing/content`, async ({ request }) => {
    const input = await body<ContentInput>(request, contentInputMapper)
    return respondAs(contentItemMapper, () => content.createContentItem(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/content/:id`, ({ request, params }) =>
    respondAs(contentItemMapper, () => content.getContentItem(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/marketing/content/:id`, async ({ request, params }) => {
    const input = await body<ContentInput>(request, contentInputMapper)
    return respondAs(contentItemMapper, () => content.updateContentItem(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/content/:id/status`, async ({ request, params }) => {
    const input = await body<Partial<ContentStatusInput>>(request, contentStatusMapper)
    return respondAs(contentItemMapper, () => content.setContentStatus(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/content/:id/comments`, async ({ request, params }) => {
    const input = await body<{ body?: unknown }>(request, plain)
    return respondAs(contentItemMapper, () => content.addContentComment(userFrom(request), params.id, input))
  }),

  /* ---- Design requests (any active user of the company; see services/designRequests.ts) ---- */
  http.get(`${API}/marketing/design-requests/options`, ({ request }) =>
    respondAs(designOptionsMapper, () => design.getDesignOptions(userFrom(request))),
  ),
  http.get(`${API}/marketing/design-requests`, ({ request }) => {
    const p = query(request)
    const q = { status: opt(p, Q.status), assigneeId: opt(p, Q.assigneeId), mine: opt(p, Q.mine) }
    return respondAs(designRequestMapper, () => design.getDesignRequests(userFrom(request), q))
  }),
  http.post(`${API}/marketing/design-requests`, async ({ request }) => {
    const input = await body<DesignInput>(request, designInputMapper)
    return respondAs(designRequestMapper, () => design.createDesignRequest(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/design-requests/:id`, ({ request, params }) =>
    respondAs(designRequestMapper, () => design.getDesignRequest(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/marketing/design-requests/:id`, async ({ request, params }) => {
    const input = await body<DesignInput>(request, designInputMapper)
    return respondAs(designRequestMapper, () => design.updateDesignRequest(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/design-requests/:id/status`, async ({ request, params }) => {
    const input = await body<{ status?: unknown; note?: unknown }>(request, plain)
    return respondAs(designRequestMapper, () => design.setDesignStatus(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/design-requests/:id/comments`, async ({ request, params }) => {
    const input = await body<{ body?: unknown }>(request, plain)
    return respondAs(designRequestMapper, () => design.addDesignComment(userFrom(request), params.id, input))
  }),
  http.post<Params>(`${API}/marketing/design-requests/:id/attachments`, async ({ request, params }) => {
    const input = await body<Partial<AttachmentInput>>(request, attachmentInputMapper)
    return respondAs(designRequestMapper, () => design.addDesignAttachment(userFrom(request), params.id, input))
  }),
  http.delete<{ id: string; attachmentId: string }>(`${API}/marketing/design-requests/:id/attachments/:attachmentId`, ({ request, params }) =>
    respondAs(designRequestMapper, () => design.removeDesignAttachment(userFrom(request), params.id, params.attachmentId)),
  ),
  http.post<Params>(`${API}/marketing/design-requests/:id/save-to-assets`, async ({ request, params }) => {
    const input = await body<SaveToAssetsInput>(request, saveToAssetsMapper)
    return respondAs(brandAssetMapper, () => design.saveDesignToAssets(userFrom(request), params.id, input))
  }),

  /* ---- Brand assets ---- */
  http.get(`${API}/marketing/assets`, ({ request }) => {
    const p = query(request)
    const q = { kind: opt(p, Q.kind), tag: opt(p, Q.tag), campaignId: opt(p, Q.campaignId), status: opt(p, Q.status), expiring: opt(p, Q.expiring) }
    return respondAs(brandAssetMapper, () => assets.getBrandAssets(userFrom(request), q))
  }),
  http.post(`${API}/marketing/assets`, async ({ request }) => {
    const input = await body<AssetInput>(request, assetInputMapper)
    return respondAs(brandAssetMapper, () => assets.createBrandAsset(userFrom(request), input))
  }),
  http.get<Params>(`${API}/marketing/assets/:id`, ({ request, params }) =>
    respondAs(brandAssetMapper, () => assets.getBrandAsset(userFrom(request), params.id)),
  ),
  http.patch<Params>(`${API}/marketing/assets/:id`, async ({ request, params }) => {
    const input = await body<AssetInput>(request, assetInputMapper)
    return respondAs(brandAssetMapper, () => assets.updateBrandAsset(userFrom(request), params.id, input))
  }),
  http.delete<Params>(`${API}/marketing/assets/:id`, ({ request, params }) => respond(() => assets.deleteBrandAsset(userFrom(request), params.id))),
]
