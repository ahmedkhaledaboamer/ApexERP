import { http } from '@/shared/lib/axios'
import type {
  AssetInput,
  AssetQuery,
  AttachmentInput,
  BrandAsset,
  ContentInput,
  ContentItem,
  ContentQuery,
  ContentStatusInput,
  DesignInput,
  DesignOptions,
  DesignQuery,
  DesignRequest,
  DesignStatus,
  SaveToAssetsInput,
} from './types'
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

/** Marketing creative API (content calendar, design requests, brand assets); company and rights come from the token. */

const enc = encodeURIComponent

/** Query object with the wire names, without empty values. */
function params(q: object): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) if (v) out[Q[k as keyof typeof Q] ?? k] = String(v)
  return Object.keys(out).length ? out : undefined
}

/* ---- Content calendar ---- */

export async function getContentItems(q: ContentQuery = {}): Promise<ContentItem[]> {
  return contentItemMapper.fromApiList((await http.get<unknown>('/marketing/content', { params: params(q) })).data)
}
export async function getContentItem(id: string): Promise<ContentItem> {
  return contentItemMapper.fromApi((await http.get<unknown>(`/marketing/content/${enc(id)}`)).data)
}
export async function createContentItem(input: ContentInput): Promise<ContentItem> {
  return contentItemMapper.fromApi((await http.post<unknown>('/marketing/content', contentInputMapper.toApi(input))).data)
}
export async function updateContentItem(id: string, input: ContentInput): Promise<ContentItem> {
  return contentItemMapper.fromApi((await http.patch<unknown>(`/marketing/content/${enc(id)}`, contentInputMapper.toApi(input))).data)
}
export async function setContentStatus(id: string, input: ContentStatusInput): Promise<ContentItem> {
  return contentItemMapper.fromApi((await http.post<unknown>(`/marketing/content/${enc(id)}/status`, contentStatusMapper.toApi(input))).data)
}
export async function addContentComment(id: string, body: string): Promise<ContentItem> {
  return contentItemMapper.fromApi((await http.post<unknown>(`/marketing/content/${enc(id)}/comments`, { body })).data)
}

/* ---- Design requests ---- */

export async function getDesignOptions(): Promise<DesignOptions> {
  return designOptionsMapper.fromApi((await http.get<unknown>('/marketing/design-requests/options')).data)
}
export async function getDesignRequests(q: DesignQuery = {}): Promise<DesignRequest[]> {
  return designRequestMapper.fromApiList((await http.get<unknown>('/marketing/design-requests', { params: params(q) })).data)
}
export async function getDesignRequest(id: string): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.get<unknown>(`/marketing/design-requests/${enc(id)}`)).data)
}
export async function createDesignRequest(input: DesignInput): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.post<unknown>('/marketing/design-requests', designInputMapper.toApi(input))).data)
}
export async function updateDesignRequest(id: string, input: DesignInput): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.patch<unknown>(`/marketing/design-requests/${enc(id)}`, designInputMapper.toApi(input))).data)
}
export async function setDesignStatus(id: string, status: DesignStatus, note?: string): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.post<unknown>(`/marketing/design-requests/${enc(id)}/status`, { status, note })).data)
}
export async function addDesignComment(id: string, body: string): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.post<unknown>(`/marketing/design-requests/${enc(id)}/comments`, { body })).data)
}
export async function addDesignAttachment(id: string, file: AttachmentInput): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.post<unknown>(`/marketing/design-requests/${enc(id)}/attachments`, attachmentInputMapper.toApi(file))).data)
}
export async function removeDesignAttachment(id: string, attachmentId: string): Promise<DesignRequest> {
  return designRequestMapper.fromApi((await http.delete<unknown>(`/marketing/design-requests/${enc(id)}/attachments/${enc(attachmentId)}`)).data)
}
export async function saveDesignToAssets(id: string, input: SaveToAssetsInput = {}): Promise<BrandAsset> {
  return brandAssetMapper.fromApi((await http.post<unknown>(`/marketing/design-requests/${enc(id)}/save-to-assets`, saveToAssetsMapper.toApi(input))).data)
}

/* ---- Brand assets ---- */

export async function getBrandAssets(q: AssetQuery = {}): Promise<BrandAsset[]> {
  return brandAssetMapper.fromApiList((await http.get<unknown>('/marketing/assets', { params: params(q) })).data)
}
export async function createBrandAsset(input: AssetInput): Promise<BrandAsset> {
  return brandAssetMapper.fromApi((await http.post<unknown>('/marketing/assets', assetInputMapper.toApi(input))).data)
}
export async function updateBrandAsset(id: string, input: AssetInput): Promise<BrandAsset> {
  return brandAssetMapper.fromApi((await http.patch<unknown>(`/marketing/assets/${enc(id)}`, assetInputMapper.toApi(input))).data)
}
export async function deleteBrandAsset(id: string): Promise<void> {
  await http.delete(`/marketing/assets/${enc(id)}`)
}
