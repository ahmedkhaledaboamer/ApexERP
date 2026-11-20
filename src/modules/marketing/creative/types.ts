/**
 * Marketing › creative: CONTENT CALENDAR (content_items), DESIGN REQUESTS (design_requests) and
 * BRAND ASSETS (brand_assets). Plan module `marketing`. Wire names: src/shared/api/creativeMappers.ts;
 * contract: docs/API.md › Marketing › Content calendar / Design requests / Brand assets.
 */

/* ---------------- Shared ---------------- */

export interface CreativeComment {
  id: string
  authorId: string
  authorName: string
  body: string
  /** Mentioned user ids (people who can see the record). */
  mentions: string[]
  at: string
}

export interface CreativeEvent {
  id: string
  userId: string | null
  userName: string
  summary: string
  at: string
}

export interface AssetRef {
  id: string
  name: string
  kind: AssetKind
  /** Small image preview (data URL) or null. */
  url: string | null
}

/* ---------------- Content calendar ---------------- */

export type ContentType = 'social_post' | 'blog_post' | 'newsletter' | 'video' | 'case_study' | 'press_release' | 'other'
export const CONTENT_TYPES: ContentType[] = ['social_post', 'blog_post', 'newsletter', 'video', 'case_study', 'press_release', 'other']
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  social_post: 'Social post',
  blog_post: 'Blog post',
  newsletter: 'Newsletter',
  video: 'Video',
  case_study: 'Case study',
  press_release: 'Press release',
  other: 'Other',
}

export type ContentChannel = 'linkedin' | 'instagram' | 'facebook' | 'x' | 'tiktok' | 'youtube' | 'blog' | 'email' | 'website'
export const CONTENT_CHANNELS: ContentChannel[] = ['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'blog', 'email', 'website']
export const CONTENT_CHANNEL_LABEL: Record<ContentChannel, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  blog: 'Blog',
  email: 'Email',
  website: 'Website',
}

export type ContentStatus = 'idea' | 'draft' | 'in_review' | 'approved' | 'scheduled' | 'published' | 'archived'
export const CONTENT_STATUSES: ContentStatus[] = ['idea', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']
export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  idea: 'Idea',
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
}

/** Hours before publish_at the owner gets the stored reminder (once). */
export const CONTENT_REMINDER_HOURS = 24

export interface ContentItem {
  id: string
  title: string
  type: ContentType
  channels: ContentChannel[]
  status: ContentStatus
  ownerId: string | null
  ownerName: string
  /** The person asked to review (any marketing `full` role may approve). */
  reviewerId: string | null
  reviewerName: string
  approvedBy: string | null
  approvedByName: string
  approvedAt: string | null
  /** UTC instant; null = not planned yet. */
  publishAt: string | null
  /** "YYYY-MM-DDTHH:mm" in the company's timezone (derived from publishAt). */
  publishLocal: string | null
  timezone: string
  campaignId: string | null
  campaignName: string
  body: string
  notes: string
  assetIds: string[]
  assets: AssetRef[]
  publishedUrl: string | null
  publishedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  /** Scheduled, publish time passed, not published. */
  overdue: boolean
  /** The caller may approve it now (marketing full, not their own unless Company Admin, status in_review). */
  canApprove: boolean
  comments: CreativeComment[]
  history: CreativeEvent[]
}

export interface ContentInput {
  title?: string
  type?: ContentType
  channels?: ContentChannel[]
  ownerId?: string | null
  reviewerId?: string | null
  /** "YYYY-MM-DDTHH:mm" wall time in the company's timezone, or null to clear. */
  publishAt?: string | null
  campaignId?: string | null
  body?: string
  notes?: string
  assetIds?: string[]
  /** Create only: the starting status (idea or draft). */
  status?: ContentStatus
}

export interface ContentStatusInput {
  status: ContentStatus
  /** scheduled: optional new wall time (company timezone). */
  publishAt?: string
  /** published: the live URL (required). */
  publishedUrl?: string
}

export interface ContentQuery {
  status?: string
  type?: string
  channel?: string
  campaignId?: string
  ownerId?: string
  /** Company-local dates (publish day). */
  from?: string
  to?: string
}

/* ---------------- Design requests ---------------- */

export type DesignType = 'social_post' | 'banner' | 'brochure' | 'presentation' | 'video' | 'logo' | 'other'
export const DESIGN_TYPES: DesignType[] = ['social_post', 'banner', 'brochure', 'presentation', 'video', 'logo', 'other']
export const DESIGN_TYPE_LABEL: Record<DesignType, string> = {
  social_post: 'Social post',
  banner: 'Banner',
  brochure: 'Brochure',
  presentation: 'Presentation',
  video: 'Video',
  logo: 'Logo',
  other: 'Other',
}

export type DesignPriority = 'low' | 'medium' | 'high' | 'urgent'
export const DESIGN_PRIORITIES: DesignPriority[] = ['low', 'medium', 'high', 'urgent']
export const DESIGN_PRIORITY_LABEL: Record<DesignPriority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' }

export type DesignStatus = 'requested' | 'in_progress' | 'in_review' | 'changes_requested' | 'approved' | 'delivered' | 'cancelled'
export const DESIGN_STATUSES: DesignStatus[] = ['requested', 'in_progress', 'in_review', 'changes_requested', 'approved', 'delivered', 'cancelled']
export const DESIGN_STATUS_LABEL: Record<DesignStatus, string> = {
  requested: 'Requested',
  in_progress: 'In progress',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/** Days before the due date the assignee and requester get the stored reminder (once). */
export const DESIGN_REMINDER_DAYS = 1

export interface DesignAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  /** Small image preview (data URL) or null (metadata only in the mock). */
  url: string | null
  uploadedBy: string
  uploadedByName: string
  uploadedAt: string
}

export interface DesignRequest {
  id: string
  title: string
  type: DesignType
  brief: string
  /** Free-text formats / sizes, e.g. "1080×1080 PNG". */
  formats: string[]
  /** Company-local date (YYYY-MM-DD) or null. */
  dueDate: string | null
  priority: DesignPriority
  status: DesignStatus
  requesterId: string
  requesterName: string
  assigneeId: string | null
  assigneeName: string
  campaignId: string | null
  campaignName: string
  contentItemId: string | null
  contentItemTitle: string
  assetIds: string[]
  assets: AssetRef[]
  attachments: DesignAttachment[]
  deliveredAt: string | null
  /** Brand assets saved from this request. */
  savedAssetIds: string[]
  createdAt: string
  updatedAt: string
  overdue: boolean
  /** The caller's rights on this request (server-computed). */
  canManage: boolean
  canEdit: boolean
  /** Requester, assignee or marketing full (also may attach files). */
  canComment: boolean
  /** Statuses the caller may move it to now. */
  nextStatuses: DesignStatus[]
  comments: CreativeComment[]
  history: CreativeEvent[]
}

export interface DesignInput {
  title?: string
  type?: DesignType
  brief?: string
  formats?: string[]
  dueDate?: string | null
  priority?: DesignPriority
  assigneeId?: string | null
  campaignId?: string | null
  contentItemId?: string | null
  assetIds?: string[]
}

export interface DesignQuery {
  status?: string
  assigneeId?: string
  /** "1": only what I requested or what is assigned to me. */
  mine?: string
}

export interface AttachmentInput {
  name: string
  mimeType: string
  sizeBytes: number
  /** Optional small image preview (≤ 1 MB, PNG / JPG / WebP / SVG / GIF). */
  dataUrl?: string | null
}

export interface DesignOptions {
  /** Marketing view (sees every request). */
  canViewAll: boolean
  /** Marketing full (assigns, sets any status). */
  canManage: boolean
  timezone: string
  /** Active users who can be assigned (managers only; empty otherwise). */
  designers: { id: string; name: string; role: string; title: string }[]
  /** Marketing view only. */
  campaigns: { id: string; name: string }[]
  contentItems: { id: string; title: string }[]
}

/* ---------------- Brand assets ---------------- */

export type AssetKind = 'logo' | 'image' | 'video' | 'document' | 'template' | 'font' | 'other'
export const ASSET_KINDS: AssetKind[] = ['logo', 'image', 'video', 'document', 'template', 'font', 'other']
export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  logo: 'Logo',
  image: 'Image',
  video: 'Video',
  document: 'Document',
  template: 'Template',
  font: 'Font',
  other: 'Other',
}

export type AssetSource = 'upload' | 'design_request' | 'system'
export type AssetStatus = 'active' | 'archived'

/** Days before usage_rights_expires_at the asset counts as "expiring soon" and the alert goes out (once). */
export const ASSET_EXPIRY_DAYS = 30

export interface BrandAsset {
  id: string
  name: string
  kind: AssetKind
  mimeType: string
  sizeBytes: number
  /** Data URL preview for small images; null otherwise. */
  url: string | null
  tags: string[]
  campaignId: string | null
  campaignName: string
  source: AssetSource
  designRequestId: string | null
  description: string
  /** Company-local date or null. */
  usageRightsExpiresAt: string | null
  status: AssetStatus
  /** Read-only system asset (the company's branding logos, Settings › Branding). */
  system: boolean
  expiringSoon: boolean
  expired: boolean
  createdBy: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface AssetInput {
  name?: string
  kind?: AssetKind
  mimeType?: string
  sizeBytes?: number
  dataUrl?: string | null
  tags?: string[]
  campaignId?: string | null
  description?: string
  usageRightsExpiresAt?: string | null
  status?: AssetStatus
}

export interface AssetQuery {
  kind?: string
  tag?: string
  campaignId?: string
  status?: string
  /** "1": usage rights end within ASSET_EXPIRY_DAYS (or already ended). */
  expiring?: string
}

export interface SaveToAssetsInput {
  /** The delivered file to keep (default: the newest attachment). */
  attachmentId?: string
  name?: string
  kind?: AssetKind
  tags?: string[]
}
