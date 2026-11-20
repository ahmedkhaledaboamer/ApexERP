import type { User } from '@/shared/types'
import {
  ASSET_EXPIRY_DAYS,
  ASSET_KINDS,
  type AssetInput,
  type AssetQuery,
  type BrandAsset,
} from '@/modules/marketing/creative/types'
import { assetFileProblem, checkPreview, cleanTags } from '@/modules/marketing/creative/assetRules'
import { parseDataUrl } from '@/modules/settings/branding'
import { daysBetweenIso } from '@/shared/lib/companyDay'
import { brandAssets, contentItems, designRequests, nextCreativeId, type AssetRecord } from '@/shared/mocks/data/marketingCreative'
import { companyById } from '@/shared/mocks/data/tenancy'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { runCreativeReminders } from '@/shared/mocks/services/creativeReminders'
import { campaignOf, clean, dateField, nameOf, nowStamp, requireEdit, requireView } from './creativeShared'

/* ------------------------------------------------------------------------------------------
 * BRAND ASSETS (/marketing/assets*). Plan module `marketing`; Marketing column (view → reads, full →
 * writes). Files are metadata (name, mime_type, size_bytes, counted against storageMb) plus an
 * optional data-URL preview for small images; the type / size rules are modules/marketing/creative/
 * assetRules.ts (shared with the upload form). The company's branding logos (Settings › Branding)
 * are listed as read-only SYSTEM assets (ids SYS-logo-light / SYS-logo-dark / SYS-favicon, not
 * stored, never counted). Usage rights: "expiring soon" within ASSET_EXPIRY_DAYS (30) days; one
 * stored alert to the creator (services/creativeReminders.ts).
 * ---------------------------------------------------------------------------------------- */

const NOT_FOUND = 'That asset doesn’t exist.'
const NAME_MAX = 120
const SYSTEM_READ_ONLY = 'System assets come from Settings › Branding; change them there.'

function expiryOf(co: string, date: string | null): { expiringSoon: boolean; expired: boolean } {
  if (!date) return { expiringSoon: false, expired: false }
  const left = daysBetweenIso(companyDayOf(co).today, date)
  return { expired: left < 0, expiringSoon: left >= 0 && left <= ASSET_EXPIRY_DAYS }
}

export function assetView(a: Tenant<AssetRecord>): BrandAsset {
  const co = a.companyId
  const { companyId: _c, sourceAttachmentId: _s, expiryNotifiedAt: _e, ...rest } = a
  return {
    ...rest,
    tags: [...a.tags],
    campaignName: campaignOf(co, a.campaignId)?.name ?? '',
    system: false,
    ...expiryOf(co, a.usageRightsExpiresAt),
    createdByName: nameOf(co, a.createdBy),
  }
}

const SYSTEM_IMAGES = [
  { id: 'SYS-logo-light', key: 'logoUrl', name: 'Company logo (light theme)' },
  { id: 'SYS-logo-dark', key: 'logoDarkUrl', name: 'Company logo (dark theme)' },
  { id: 'SYS-favicon', key: 'faviconUrl', name: 'Favicon' },
] as const

/** The company's branding images as read-only assets (computed, never stored). */
export function systemAssets(co: string): BrandAsset[] {
  const company = companyById(co)
  const branding = company?.branding as Record<string, unknown> | undefined
  const at = company?.createdAt ?? new Date(0).toISOString()
  const out: BrandAsset[] = []
  for (const s of SYSTEM_IMAGES) {
    const url = branding?.[s.key]
    if (typeof url !== 'string' || !url) continue
    const parsed = url.startsWith('data:') ? parseDataUrl(url) : null
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
    const mime = parsed?.mime ?? (ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png')
    out.push({
      id: s.id,
      name: s.name,
      kind: 'logo',
      mimeType: mime,
      sizeBytes: parsed?.bytes.length ?? 0,
      url,
      tags: ['branding'],
      campaignId: null,
      campaignName: '',
      source: 'system',
      designRequestId: null,
      description: 'From Settings › Branding (read-only here).',
      usageRightsExpiresAt: null,
      status: 'active',
      system: true,
      expiringSoon: false,
      expired: false,
      createdBy: null,
      createdByName: 'System',
      createdAt: at,
      updatedAt: at,
    })
  }
  return out
}

async function assetFor(user: User, id: string): Promise<Tenant<AssetRecord>> {
  const a = findInTenant(brandAssets, user, (x) => x.id === id)
  if (!a) return fail(NOT_FOUND, 404)
  return a
}

export async function getBrandAssets(user: User, q: AssetQuery = {}): Promise<BrandAsset[]> {
  const co = await requireView(user)
  runCreativeReminders(co)
  const stored = scoped(brandAssets, user)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(assetView)
  const list = [...systemAssets(co), ...stored].filter((a) => {
    if (q.kind && a.kind !== q.kind) return false
    if (q.tag && !a.tags.includes(q.tag.toLowerCase())) return false
    if (q.campaignId && a.campaignId !== q.campaignId) return false
    if (q.status && a.status !== q.status) return false
    if (q.expiring === '1' && !a.expiringSoon && !a.expired) return false
    return true
  })
  return delay(list)
}

export async function getBrandAsset(user: User, id: string): Promise<BrandAsset> {
  const co = await requireView(user)
  const sys = systemAssets(co).find((a) => a.id === id)
  if (sys) return delay(sys)
  return delay(assetView(await assetFor(user, id)))
}

/** Metadata fields of a create / update body. */
function fields(co: string, input: AssetInput, existing?: AssetRecord): Partial<AssetRecord> | string {
  const out: Partial<AssetRecord> = {}
  if (input.name !== undefined || !existing) {
    const name = clean(input.name)
    if (!name) return 'Give the asset a name.'
    if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
    out.name = name
  }
  if (input.kind !== undefined || !existing) {
    if (!ASSET_KINDS.includes(input.kind as never)) return 'Pick a kind: logo, image, video, document, template, font or other.'
    out.kind = input.kind
    if (existing) {
      const problem = assetFileProblem(input.kind!, { name: existing.name, mimeType: existing.mimeType, sizeBytes: existing.sizeBytes })
      if (problem) return `This file can’t be a ${input.kind}: ${problem}`
    }
  }
  if (input.tags !== undefined) {
    const tags = cleanTags(input.tags)
    if (typeof tags === 'string') return tags
    out.tags = tags
  }
  if (input.campaignId !== undefined) {
    if (input.campaignId && !campaignOf(co, input.campaignId)) return 'That campaign doesn’t exist.'
    out.campaignId = input.campaignId || null
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return 'The description must be text.'
    out.description = input.description.trim().slice(0, 2000)
  }
  const exp = dateField(input.usageRightsExpiresAt, 'The usage rights date')
  if (exp && typeof exp === 'object') return exp.error
  if (exp !== undefined) out.usageRightsExpiresAt = exp
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'archived') return 'Status is active or archived.'
    out.status = input.status
  }
  return out
}

export async function createBrandAsset(user: User, input: AssetInput): Promise<BrandAsset> {
  const co = await requireEdit(user, 'brand assets')
  const body = input ?? {}
  const f = fields(co, body)
  if (typeof f === 'string') return fail(f, 422)
  const mimeType = clean(body.mimeType).toLowerCase()
  const file = { name: f.name, mimeType, sizeBytes: body.sizeBytes }
  const problem = assetFileProblem(f.kind!, file)
  if (problem) return fail(problem, 422)
  const size = body.sizeBytes as number
  let url: string | null = null
  if (body.dataUrl) {
    const p = checkPreview(body.dataUrl, mimeType, size)
    if (!p.ok) return fail(p.message, 422)
    url = p.dataUrl
  }
  assertCapacity(co, 'storageMb', size / (1024 * 1024))
  const at = nowStamp()
  const row: Tenant<AssetRecord> = stamp(
    {
      id: nextCreativeId('BA'),
      name: f.name!,
      kind: f.kind!,
      mimeType,
      sizeBytes: size,
      url,
      tags: f.tags ?? [],
      campaignId: f.campaignId ?? null,
      source: 'upload',
      designRequestId: null,
      sourceAttachmentId: null,
      description: f.description ?? '',
      usageRightsExpiresAt: f.usageRightsExpiresAt ?? null,
      status: f.status ?? 'active',
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
      expiryNotifiedAt: null,
    },
    user,
  )
  brandAssets.push(row)
  noteUsage(co)
  return delay(assetView(row))
}

export async function updateBrandAsset(user: User, id: string, input: AssetInput): Promise<BrandAsset> {
  const co = await requireView(user)
  if (systemAssets(co).some((a) => a.id === id)) {
    await requireEdit(user, 'brand assets')
    return fail(SYSTEM_READ_ONLY, 409)
  }
  const a = await assetFor(user, id)
  await requireEdit(user, 'brand assets')
  const body = { ...(input ?? {}) }
  // The file itself can't be replaced; upload a new asset instead.
  delete body.mimeType
  delete body.sizeBytes
  delete body.dataUrl
  const f = fields(co, body, a)
  if (typeof f === 'string') return fail(f, 422)
  if ('usageRightsExpiresAt' in f && f.usageRightsExpiresAt !== a.usageRightsExpiresAt) a.expiryNotifiedAt = null
  Object.assign(a, f, { updatedAt: nowStamp() })
  return delay(assetView(a))
}

/** Hard delete: frees storage and unlinks the asset from content items and design requests. */
export async function deleteBrandAsset(user: User, id: string): Promise<{ id: string; deleted: true }> {
  const co = await requireView(user)
  if (systemAssets(co).some((a) => a.id === id)) {
    await requireEdit(user, 'brand assets')
    return fail(SYSTEM_READ_ONLY, 409)
  }
  const a = await assetFor(user, id)
  await requireEdit(user, 'brand assets')
  brandAssets.splice(brandAssets.indexOf(a), 1)
  for (const c of contentItems) if (c.companyId === co && c.assetIds.includes(id)) c.assetIds = c.assetIds.filter((x) => x !== id)
  for (const r of designRequests) {
    if (r.companyId !== co) continue
    if (r.assetIds.includes(id)) r.assetIds = r.assetIds.filter((x) => x !== id)
    if (r.savedAssetIds.includes(id)) r.savedAssetIds = r.savedAssetIds.filter((x) => x !== id)
  }
  return delay({ id, deleted: true as const })
}
