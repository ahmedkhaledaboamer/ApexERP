import { addDays, format } from 'date-fns'
import { users } from '@/shared/mocks/db'
import { campaigns } from '@/shared/mocks/data/marketing'
import { brandAssets, contentItems, designRequests } from '@/shared/mocks/data/marketingCreative'
import { systemAssets } from '@/shared/mocks/services/brandAssets'
import { ADMIN, adminToken, api, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of the marketing creative endpoints (handlers/marketingCreative.ts: content
 * calendar, design requests, brand assets), spread into ENDPOINTS (endpoints.ts). Samples name the
 * company's own seed rows or create fresh ones through the API (as the company admin).
 */

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const own = <T extends { companyId: string }>(rows: readonly T[], co: Co) => rows.filter((r) => r.companyId === co)
function first<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const row = rows.find((r) => r.companyId === co && pred(r))
  if (!row) throw new Error(`Isolation table: no ${what} in ${co}`)
  return row
}

/** A valid 1×1 PNG and its byte length (brand asset upload with a preview). */
export const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
export const TINY_PNG_BYTES = 70

const campaign = (co: Co) => first(campaigns, co, 'campaign').id
const content = (co: Co) => first(contentItems, co, 'content item').id
const design = (co: Co) => first(designRequests, co, 'design request', (r) => r.status === 'requested').id
const asset = (co: Co) => first(brandAssets, co, 'brand asset').id
const designer = (co: Co) => first(users, co, 'designer', (u) => u.role === 'Employee' && u.active !== false).id

async function created(co: Co, method: string, path: string, body: unknown): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await api(adminToken(co), method, path, { body })
  if (r.status !== 200) throw new Error(`Isolation table: ${method} ${path} for ${co} answered ${r.status}: ${r.text}`)
  return r.body
}

/** A fresh content item in review (the admin may approve: Company Admin). */
const reviewContent = async (co: Co): Promise<string> =>
  (await created(co, 'POST', '/marketing/content', { title: `Isolation content ${uniq()}`, type: 'blog_post', channels: ['blog'], status: 'in_review', publish_at: `${day(5)}T10:00` })).id

/** A fresh design request assigned to a designer. */
const assignedRequest = async (co: Co): Promise<string> =>
  (await created(co, 'POST', '/marketing/design-requests', { title: `Isolation request ${uniq()}`, type: 'banner', brief: 'Isolation brief', assignee_id: designer(co) })).id

/** A design request with one attachment: [request id, attachment id]. */
async function withAttachment(co: Co): Promise<[string, string]> {
  const id = design(co)
  const r = await created(co, 'POST', `/marketing/design-requests/${id}/attachments`, { name: 'iso-brief.pdf', mime_type: 'application/pdf', size_bytes: 2048 })
  return [id, r.attachments[r.attachments.length - 1].id]
}

/** A delivered design request (the admin walks it through the flow). */
async function deliveredRequest(co: Co): Promise<string> {
  const id = await assignedRequest(co)
  await created(co, 'POST', `/marketing/design-requests/${id}/attachments`, { name: 'final.png', mime_type: 'image/png', size_bytes: TINY_PNG_BYTES, data_url: TINY_PNG })
  for (const status of ['in_progress', 'in_review', 'approved', 'delivered']) await created(co, 'POST', `/marketing/design-requests/${id}/status`, { status })
  return id
}

export const CREATIVE_ENDPOINTS: Endpoint[] = [
  /* ---- content calendar ---- */
  { method: 'GET', path: '/marketing/content', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: (co) => own(contentItems, co).length } },
  {
    method: 'POST', path: '/marketing/content', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { title: `Isolation post ${uniq()}`, type: 'social_post', channels: ['linkedin', 'x'], publish_at: `${day(7)}T09:30`, campaign_id: campaign(co), owner_id: ADMIN[co], asset_ids: [asset(co)] } }),
  },
  { method: 'GET', path: '/marketing/content/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: content(co) } }) },
  { method: 'PATCH', path: '/marketing/content/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: content(co) }, body: { notes: 'Isolation note' } }) },
  { method: 'POST', path: '/marketing/content/:id/status', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await reviewContent(co) }, body: { status: 'approved' } }) },
  { method: 'POST', path: '/marketing/content/:id/comments', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: content(co) }, body: { body: 'Isolation comment' } }) },

  /* ---- design requests ---- */
  { method: 'GET', path: '/marketing/design-requests/options', kind: 'company-list', module: 'marketing', sample: () => ({}) },
  { method: 'GET', path: '/marketing/design-requests', kind: 'company-list', module: 'marketing', sample: () => ({}), count: { of: len, expected: (co) => own(designRequests, co).length } },
  {
    method: 'POST', path: '/marketing/design-requests', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { title: `Isolation banner ${uniq()}`, type: 'banner', brief: 'A web banner', formats: ['1200×300 PNG'], due_date: day(5), priority: 'high', assignee_id: designer(co), campaign_id: campaign(co), content_item_id: content(co) } }),
  },
  { method: 'GET', path: '/marketing/design-requests/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: design(co) } }) },
  { method: 'PATCH', path: '/marketing/design-requests/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: design(co) }, body: { priority: 'urgent', assignee_id: designer(co) } }) },
  { method: 'POST', path: '/marketing/design-requests/:id/status', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await assignedRequest(co) }, body: { status: 'in_progress' } }) },
  { method: 'POST', path: '/marketing/design-requests/:id/comments', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: design(co) }, body: { body: 'Isolation comment' } }) },
  {
    method: 'POST', path: '/marketing/design-requests/:id/attachments', kind: 'company-item', module: 'marketing',
    sample: (co) => ({ params: { id: design(co) }, body: { name: 'iso.pdf', mime_type: 'application/pdf', size_bytes: 4096 } }),
  },
  {
    method: 'DELETE', path: '/marketing/design-requests/:id/attachments/:attachmentId', kind: 'company-item', module: 'marketing',
    sample: async (co) => {
      const [id, attachmentId] = await withAttachment(co)
      return { params: { id, attachmentId } }
    },
  },
  { method: 'POST', path: '/marketing/design-requests/:id/save-to-assets', kind: 'company-item', module: 'marketing', sample: async (co) => ({ params: { id: await deliveredRequest(co) }, body: { tags: ['iso'] } }) },

  /* ---- brand assets ---- */
  {
    method: 'GET', path: '/marketing/assets', kind: 'company-list', module: 'marketing', sample: () => ({}),
    count: { of: len, expected: (co) => own(brandAssets, co).length + systemAssets(co).length },
  },
  {
    method: 'POST', path: '/marketing/assets', kind: 'company-write', module: 'marketing',
    sample: (co) => ({ body: { name: `Isolation pixel ${uniq()}`, kind: 'image', mime_type: 'image/png', size_bytes: TINY_PNG_BYTES, data_url: TINY_PNG, tags: ['iso'], campaign_id: campaign(co), usage_rights_expires_at: day(60) } }),
  },
  { method: 'GET', path: '/marketing/assets/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: asset(co) } }) },
  { method: 'PATCH', path: '/marketing/assets/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: asset(co) }, body: { tags: ['iso', 'patched'], campaign_id: campaign(co) } }) },
  { method: 'DELETE', path: '/marketing/assets/:id', kind: 'company-item', module: 'marketing', sample: (co) => ({ params: { id: asset(co) } }) },
]
