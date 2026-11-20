import { addDays, format, subDays } from 'date-fns'
import type {
  AssetKind,
  AssetSource,
  AssetStatus,
  ContentChannel,
  ContentStatus,
  ContentType,
  DesignPriority,
  DesignStatus,
  DesignType,
} from '@/modules/marketing/creative/types'
import { registerArray, registerValue } from '@/shared/mocks/persist/registry'
import type { Tenant } from '@/shared/mocks/tenant'

/**
 * Marketing creative tables (not in the database design yet: docs/DB-ALIGNMENT.md › Design gaps ›
 * Marketing (creative)): content_items, design_requests (+ attachments / comments as polymorphic
 * rows of the design's `attachments` / `comments`), brand_assets. Every row carries companyId.
 * Seed ids live in per-company blocks (Apex 1xxx, Crest 5xxx); new rows take ids from a shared counter.
 */

export interface CommentRecord {
  id: string
  authorId: string
  body: string
  mentions: string[]
  at: string
}

export interface EventRecord {
  id: string
  userId: string | null
  summary: string
  at: string
}

export interface ContentRecord {
  id: string
  title: string
  type: ContentType
  channels: ContentChannel[]
  status: ContentStatus
  ownerId: string | null
  reviewerId: string | null
  approvedBy: string | null
  approvedAt: string | null
  /** UTC instant. */
  publishAt: string | null
  campaignId: string | null
  body: string
  notes: string
  assetIds: string[]
  publishedUrl: string | null
  publishedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  /** Stored reminder N hours before publish_at (once; cleared when publish_at changes). */
  reminderSentAt: string | null
  /** Stored overdue notice (once; cleared when publish_at changes). */
  overdueNotifiedAt: string | null
  comments: CommentRecord[]
  history: EventRecord[]
}

export interface AttachmentRecord {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  url: string | null
  uploadedBy: string
  uploadedAt: string
}

export interface DesignRecord {
  id: string
  title: string
  type: DesignType
  brief: string
  formats: string[]
  dueDate: string | null
  priority: DesignPriority
  status: DesignStatus
  requesterId: string
  assigneeId: string | null
  campaignId: string | null
  contentItemId: string | null
  assetIds: string[]
  attachments: AttachmentRecord[]
  deliveredAt: string | null
  savedAssetIds: string[]
  createdAt: string
  updatedAt: string
  reminderSentAt: string | null
  overdueNotifiedAt: string | null
  comments: CommentRecord[]
  history: EventRecord[]
}

export interface AssetRecord {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  sizeBytes: number
  url: string | null
  tags: string[]
  campaignId: string | null
  source: Exclude<AssetSource, 'system'>
  designRequestId: string | null
  /** Saved from a design-request attachment: the same stored file (storage counted once, on the attachment). */
  sourceAttachmentId: string | null
  description: string
  usageRightsExpiresAt: string | null
  status: AssetStatus
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** Stored "usage rights expire soon" alert (once; cleared when the date changes). */
  expiryNotifiedAt: string | null
}

/* ---------------- Seed helpers ---------------- */

const NOW = new Date()
const iso = (d: Date) => d.toISOString()
const day = (n: number) => format(addDays(NOW, n), 'yyyy-MM-dd')
/** An instant `days` from now at `hour`:00 UTC (seeds only; the API converts company wall time). */
const at = (days: number, hour: number) => {
  const d = addDays(NOW, days)
  d.setUTCHours(hour, 0, 0, 0)
  return iso(d)
}
const ago = (n: number) => iso(subDays(NOW, n))

/** A small SVG thumbnail (seed previews). */
export function svgThumb(label: string, bg: string, fg = '#ffffff'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" rx="12" fill="${bg}"/><text x="160" y="110" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="${fg}" text-anchor="middle">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const ev = (id: string, userId: string, summary: string, when: string): EventRecord => ({ id, userId, summary, at: when })
const cm = (id: string, authorId: string, body: string, when: string, mentions: string[] = []): CommentRecord => ({ id, authorId, body, mentions, at: when })

function content(
  companyId: string,
  id: string,
  title: string,
  type: ContentType,
  channels: ContentChannel[],
  status: ContentStatus,
  ownerId: string,
  reviewerId: string | null,
  publishAt: string | null,
  campaignId: string | null,
  body: string,
  extra: Partial<ContentRecord> = {},
): Tenant<ContentRecord> {
  const createdAt = ago(14)
  const approved = ['approved', 'scheduled', 'published'].includes(status)
  return {
    companyId,
    id,
    title,
    type,
    channels,
    status,
    ownerId,
    reviewerId,
    approvedBy: approved ? reviewerId : null,
    approvedAt: approved ? ago(3) : null,
    publishAt,
    campaignId,
    body,
    notes: '',
    assetIds: [],
    publishedUrl: null,
    publishedAt: null,
    createdBy: ownerId,
    createdAt,
    updatedAt: createdAt,
    reminderSentAt: null,
    overdueNotifiedAt: null,
    comments: [],
    history: [ev(`${id}-e1`, ownerId, 'Created', createdAt)],
    ...extra,
  }
}

export const contentItems: Tenant<ContentRecord>[] = registerArray('contentItems', [
  content('co_apex', 'CI-1001', 'Healthcare CRM case study: Al Noor Clinics', 'case_study', ['linkedin', 'blog'], 'scheduled', 'u7', 'u2', at(4, 6), 'CMP-1001',
    'How Al Noor Clinics cut patient follow-up time by 40% after moving their referrals into one pipeline.', {
      assetIds: ['BA-1003'],
      comments: [cm('CI-1001-c1', 'u2', 'Approved. Please tag the clinic’s page when it goes out.', ago(3))],
    }),
  content('co_apex', 'CI-1002', 'Q4 product update newsletter', 'newsletter', ['email'], 'in_review', 'u7', 'u2', at(9, 5), 'CMP-1003',
    'What shipped this quarter: AI lead scoring, WhatsApp templates and the new mobile app.'),
  content('co_apex', 'CI-1003', 'GITEX recap carousel', 'social_post', ['linkedin', 'instagram'], 'published', 'u7', 'u1', at(-20, 7), 'CMP-1002',
    'Five things we learned from 300 conversations at GITEX Global.', { publishedUrl: 'https://www.linkedin.com/company/apex-aora/posts/gitex-recap', publishedAt: at(-20, 7), assetIds: ['BA-1004'] }),
  content('co_apex', 'CI-1004', 'Behind the scenes: our delivery team', 'video', ['youtube', 'instagram'], 'draft', 'u7', null, at(16, 10), null,
    'A two-minute walk-through of how a project goes from signed quote to go-live.'),
  content('co_apex', 'CI-1005', 'Real estate lead nurturing playbook', 'blog_post', ['blog', 'linkedin'], 'idea', 'u7', null, null, 'CMP-1001',
    'Outline: speed to lead, WhatsApp follow-ups, viewing reminders.'),
  content('co_apex', 'CI-1006', 'Year-end offer announcement', 'social_post', ['linkedin', 'facebook', 'x'], 'approved', 'u7', 'u2', at(12, 6), 'CMP-1003',
    'Book a discovery call before 31 December and get onboarding at half price.'),
  content('co_crest', 'CI-5001', 'Cold-chain warehouse opening in Dammam', 'press_release', ['website', 'linkedin'], 'scheduled', 'u102', 'u101', at(5, 7), 'CMP-5002',
    'Crest Logistics opens a 12,000 m² temperature-controlled warehouse serving the Eastern Province.', { assetIds: ['BA-5002'] }),
  content('co_crest', 'CI-5002', 'Riyadh Logistics Expo highlights', 'video', ['youtube', 'linkedin'], 'published', 'u102', 'u101', at(-100, 8), 'CMP-5001',
    'Two minutes from booth 21: the route-planning demo and the partner signing.', { publishedUrl: 'https://www.youtube.com/watch?v=crest-expo-2026', publishedAt: at(-100, 8) }),
  content('co_crest', 'CI-5003', 'Ramadan delivery schedule', 'social_post', ['instagram', 'x'], 'draft', 'u102', null, at(20, 9), null,
    'Adjusted pickup windows for retail partners during Ramadan.'),
  content('co_crest', 'CI-5004', 'How we cut last-mile costs for a retailer', 'case_study', ['blog', 'email'], 'in_review', 'u103', 'u102', at(11, 6), 'CMP-5002',
    'Route consolidation and shared hubs saved a Jeddah retailer 18% on deliveries.'),
])

function design(
  companyId: string,
  id: string,
  title: string,
  type: DesignType,
  status: DesignStatus,
  priority: DesignPriority,
  requesterId: string,
  assigneeId: string | null,
  dueIn: number | null,
  brief: string,
  formats: string[],
  extra: Partial<DesignRecord> = {},
): Tenant<DesignRecord> {
  const createdAt = ago(6)
  return {
    companyId,
    id,
    title,
    type,
    brief,
    formats,
    dueDate: dueIn === null ? null : day(dueIn),
    priority,
    status,
    requesterId,
    assigneeId,
    campaignId: null,
    contentItemId: null,
    assetIds: [],
    attachments: [],
    deliveredAt: null,
    savedAssetIds: [],
    createdAt,
    updatedAt: createdAt,
    reminderSentAt: null,
    overdueNotifiedAt: null,
    comments: [],
    history: [ev(`${id}-e1`, requesterId, 'Requested', createdAt)],
    ...extra,
  }
}

export const designRequests: Tenant<DesignRecord>[] = registerArray('designRequests', [
  design('co_apex', 'DR-1001', 'Case study cover for Al Noor Clinics', 'social_post', 'in_progress', 'high', 'u7', 'u17', 3,
    'Cover image for the LinkedIn post and blog header. Use the clinic’s photo and our brand colours.', ['1200×627 PNG', '1080×1080 PNG'], {
      campaignId: 'CMP-1001',
      contentItemId: 'CI-1001',
      comments: [cm('DR-1001-c1', 'u17', 'First draft by Thursday.', ago(2))],
    }),
  design('co_apex', 'DR-1002', 'One-pager for the healthcare pitch', 'brochure', 'requested', 'medium', 'u4', null, 10,
    'A printable one-pager summarising our healthcare CRM offer for a clinic group meeting.', ['A4 PDF'], {
      attachments: [{ id: 'DR-1002-a1', name: 'pitch-notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 48_000, url: null, uploadedBy: 'u4', uploadedAt: ago(6) }],
    }),
  design('co_apex', 'DR-1003', 'GITEX booth banner', 'banner', 'delivered', 'high', 'u7', 'u17', -110,
    'Roll-up banner for stand B12.', ['85×200 cm PDF'], {
      campaignId: 'CMP-1002',
      deliveredAt: ago(112),
      savedAssetIds: ['BA-1004'],
      attachments: [{ id: 'DR-1003-a1', name: 'gitex-rollup-final.pdf', mimeType: 'application/pdf', sizeBytes: 2_400_000, url: null, uploadedBy: 'u17', uploadedAt: ago(112) }],
    }),
  design('co_apex', 'DR-1004', 'Proposal deck refresh', 'presentation', 'in_review', 'medium', 'u3', 'u17', 6,
    'Refresh the sales proposal template with the new colours and case studies.', ['16:9 PPTX']),
  design('co_crest', 'DR-5001', 'Dammam warehouse opening visuals', 'social_post', 'in_progress', 'urgent', 'u102', 'u107', 2,
    'Three square visuals and a story format for the warehouse opening.', ['1080×1080 PNG', '1080×1920 PNG'], { contentItemId: 'CI-5001', campaignId: 'CMP-5002' }),
  design('co_crest', 'DR-5002', 'Fleet livery mock-up', 'other', 'requested', 'low', 'u104', null, 25,
    'Mock-up of the new truck livery for the customer presentation.', ['PNG']),
])

function asset(
  companyId: string,
  id: string,
  name: string,
  kind: AssetKind,
  mimeType: string,
  sizeBytes: number,
  url: string | null,
  tags: string[],
  createdBy: string,
  extra: Partial<AssetRecord> = {},
): Tenant<AssetRecord> {
  const createdAt = ago(30)
  return {
    companyId,
    id,
    name,
    kind,
    mimeType,
    sizeBytes,
    url,
    tags,
    campaignId: null,
    source: 'upload',
    designRequestId: null,
    sourceAttachmentId: null,
    description: '',
    usageRightsExpiresAt: null,
    status: 'active',
    createdBy,
    createdAt,
    updatedAt: createdAt,
    expiryNotifiedAt: null,
    ...extra,
  }
}

export const brandAssets: Tenant<AssetRecord>[] = registerArray('brandAssets', [
  asset('co_apex', 'BA-1001', 'Apex Aora icon (white)', 'logo', 'image/svg+xml', 4_200, svgThumb('Apex Aora', '#4338ca'), ['logo', 'icon'], 'u7', { description: 'For dark backgrounds.' }),
  asset('co_apex', 'BA-1002', 'Brand guidelines 2026', 'document', 'application/pdf', 3_800_000, null, ['guidelines'], 'u7'),
  asset('co_apex', 'BA-1003', 'Al Noor Clinics photo shoot', 'image', 'image/jpeg', 2_100_000, svgThumb('Clinic shoot', '#0f766e'), ['healthcare', 'photo'], 'u7', {
    campaignId: 'CMP-1001',
    description: 'Licensed stock + client photos; credit the clinic.',
    usageRightsExpiresAt: day(20),
  }),
  asset('co_apex', 'BA-1004', 'GITEX roll-up banner', 'template', 'application/pdf', 2_400_000, null, ['event', 'gitex'], 'u7', {
    campaignId: 'CMP-1002',
    source: 'design_request',
    designRequestId: 'DR-1003',
    sourceAttachmentId: 'DR-1003-a1',
  }),
  asset('co_apex', 'BA-1005', 'Inter font family', 'font', 'font/woff2', 310_000, null, ['typography'], 'u7'),
  asset('co_crest', 'BA-5001', 'Crest Logistics wordmark', 'logo', 'image/svg+xml', 3_900, svgThumb('CREST', '#b45309'), ['logo'], 'u102'),
  asset('co_crest', 'BA-5002', 'Dammam warehouse aerial', 'image', 'image/jpeg', 3_400_000, svgThumb('Dammam hub', '#1d4ed8'), ['warehouse', 'photo'], 'u102', {
    campaignId: 'CMP-5002',
    usageRightsExpiresAt: day(200),
  }),
  asset('co_crest', 'BA-5003', 'Fleet stock footage', 'video', 'video/mp4', 48_000_000, null, ['fleet', 'video'], 'u102', { usageRightsExpiresAt: day(12) }),
])

/** Shared id counter for new creative rows and their nested comments / attachments / history. */
let seq = 1
registerValue('marketingCreative.seq', () => seq, (v) => { seq = Number(v) || 1 })
export function nextCreativeId(prefix: 'CI' | 'DR' | 'BA'): string {
  return `${prefix}-${9000 + seq++}`
}
export function nextChildId(parentId: string, kind: 'c' | 'e' | 'a'): string {
  return `${parentId}-${kind}${100 + seq++}`
}

/** Bytes stored by the company's creative files (design-request attachments + uploaded brand assets). */
export function creativeStorageBytes(companyId: string): number {
  let bytes = 0
  for (const r of designRequests) if (r.companyId === companyId) for (const a of r.attachments) bytes += a.sizeBytes
  for (const a of brandAssets) if (a.companyId === companyId && !a.sourceAttachmentId) bytes += a.sizeBytes
  return bytes
}
