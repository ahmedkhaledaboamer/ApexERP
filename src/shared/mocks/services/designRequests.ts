import type { User } from '@/shared/types'
import {
  DESIGN_PRIORITIES,
  DESIGN_STATUSES,
  DESIGN_STATUS_LABEL,
  DESIGN_TYPES,
  ASSET_KINDS,
  type AttachmentInput,
  type BrandAsset,
  type DesignInput,
  type DesignOptions,
  type DesignQuery,
  type DesignRequest as DesignRecordView,
  type DesignStatus,
  type SaveToAssetsInput,
} from '@/modules/marketing/creative/types'
import { assetFileProblem, attachmentProblem, checkPreview, cleanTags, kindForMime } from '@/modules/marketing/creative/assetRules'
import { brandAssets, contentItems, designRequests, nextChildId, nextCreativeId, type AssetRecord, type DesignRecord } from '@/shared/mocks/data/marketingCreative'
import { campaigns } from '@/shared/mocks/data/marketing'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { users } from '@/shared/mocks/db'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { can } from '@/shared/lib/permissions'
import { assertCapacity, noteUsage } from '@/shared/mocks/services/billing'
import { parseMentions } from '@/shared/mocks/services/tasks'
import { designLink, runCreativeReminders } from '@/shared/mocks/services/creativeReminders'
import { assetView } from '@/shared/mocks/services/brandAssets'
import {
  COMMENT_MAX,
  addEvent,
  assetIdsProblem,
  assetRefs,
  campaignOf,
  canEditMarketing,
  canViewMarketing,
  clean,
  commentView,
  companyUser,
  dateField,
  eventView,
  nameOf,
  nowStamp,
  timezoneOf,
} from './creativeShared'

/* ------------------------------------------------------------------------------------------
 * DESIGN REQUESTS (/marketing/design-requests*). Plan module `marketing` (gated centrally), but NOT
 * the Marketing column alone (docs/API.md › Marketing › Design requests):
 *   - ANY active user of the company creates a request and sees / comments on their own requests;
 *   - the assignee (designer) sees and works on what's assigned to them;
 *   - marketing `full` roles see and manage every request (assign, edit, any status);
 *   - marketing `view` roles see every request read-only.
 * A request the caller can't see answers 404 exactly like a missing (or another company's) one.
 * Status flow: requested → in_progress → in_review → changes_requested ⇄ … → approved → delivered
 * (+ cancelled). Delivered requests can be saved to Brand assets (marketing full).
 * ---------------------------------------------------------------------------------------- */

const NOT_FOUND = 'That design request doesn’t exist.'
const TITLE_MAX = 200

/** Every move a manager may make; requester / assignee get a subset (nextStatuses). */
const FLOW: Record<DesignStatus, DesignStatus[]> = {
  requested: ['in_progress', 'cancelled'],
  in_progress: ['in_review', 'cancelled'],
  in_review: ['approved', 'changes_requested', 'in_progress', 'cancelled'],
  changes_requested: ['in_progress', 'in_review', 'cancelled'],
  approved: ['delivered', 'changes_requested', 'cancelled'],
  delivered: [],
  cancelled: ['requested'],
}
const ASSIGNEE_MOVES: DesignStatus[] = ['in_progress', 'in_review', 'delivered']
const REQUESTER_MOVES: DesignStatus[] = ['approved', 'changes_requested', 'cancelled']
const OPEN: DesignStatus[] = ['requested', 'in_progress', 'in_review', 'changes_requested', 'approved']

const isRequester = (user: User, r: DesignRecord) => r.requesterId === user.id
const isAssignee = (user: User, r: DesignRecord) => !!r.assigneeId && r.assigneeId === user.id

export function canSeeDesign(user: User, r: DesignRecord): boolean {
  return canViewMarketing(user) || isRequester(user, r) || isAssignee(user, r)
}

const canComment = (user: User, r: DesignRecord) => canEditMarketing(user) || isRequester(user, r) || isAssignee(user, r)

/** Statuses the caller may move the request to now. */
export function nextStatuses(user: User, r: DesignRecord): DesignStatus[] {
  const all = FLOW[r.status]
  if (canEditMarketing(user)) return all
  return all.filter((s) => (isAssignee(user, r) && ASSIGNEE_MOVES.includes(s)) || (isRequester(user, r) && REQUESTER_MOVES.includes(s)))
}

/** Requester edits the brief while it's requested or changes are requested; managers always (except closed). */
function canEditBrief(user: User, r: DesignRecord): boolean {
  if (r.status === 'delivered' || r.status === 'cancelled') return false
  if (canEditMarketing(user)) return true
  return isRequester(user, r) && (r.status === 'requested' || r.status === 'changes_requested')
}

function view(r: Tenant<DesignRecord>, user: User): DesignRecordView {
  const co = r.companyId
  const { companyId: _c, reminderSentAt: _r, overdueNotifiedAt: _o, ...rest } = r
  const today = companyDayOf(co).today
  // People who can't see Marketing don't get campaign / content names.
  const marketing = canViewMarketing(user)
  return {
    ...rest,
    formats: [...r.formats],
    assetIds: [...r.assetIds],
    savedAssetIds: [...r.savedAssetIds],
    requesterName: nameOf(co, r.requesterId),
    assigneeName: nameOf(co, r.assigneeId),
    campaignName: marketing ? (campaignOf(co, r.campaignId)?.name ?? '') : '',
    contentItemTitle: marketing ? (contentItems.find((c) => c.id === r.contentItemId && c.companyId === co)?.title ?? '') : '',
    assets: assetRefs(co, r.assetIds),
    attachments: r.attachments.map((a) => ({ ...a, uploadedByName: nameOf(co, a.uploadedBy) })),
    overdue: OPEN.includes(r.status) && !!r.dueDate && r.dueDate < today,
    canManage: canEditMarketing(user),
    canEdit: canEditBrief(user, r),
    canComment: canComment(user, r),
    nextStatuses: nextStatuses(user, r),
    comments: r.comments.map((x) => commentView(co, x)),
    history: r.history.map((x) => eventView(co, x)),
  }
}

async function requestFor(user: User, id: string): Promise<Tenant<DesignRecord>> {
  const r = findInTenant(designRequests, user, (x) => x.id === id)
  // Not visible to the caller → exactly like a missing id.
  if (!r || !canSeeDesign(user, r)) return fail(NOT_FOUND, 404)
  return r
}

export async function getDesignOptions(user: User): Promise<DesignOptions> {
  const co = tenantOf(user)
  const manage = canEditMarketing(user)
  const viewAll = canViewMarketing(user)
  return delay({
    canViewAll: viewAll,
    canManage: manage,
    timezone: timezoneOf(co),
    designers: manage
      ? users
          .filter((u) => u.companyId === co && u.active !== false)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title ?? '' }))
      : [],
    campaigns: viewAll ? campaigns.filter((c) => c.companyId === co).map((c) => ({ id: c.id, name: c.name })) : [],
    contentItems: viewAll ? contentItems.filter((c) => c.companyId === co && c.status !== 'archived').map((c) => ({ id: c.id, title: c.title })) : [],
  })
}

export async function getDesignRequests(user: User, q: DesignQuery = {}): Promise<DesignRecordView[]> {
  const co = tenantOf(user)
  runCreativeReminders(co)
  const list = scoped(designRequests, user).filter((r) => {
    if (!canSeeDesign(user, r)) return false
    if (q.mine === '1' && !isRequester(user, r) && !isAssignee(user, r)) return false
    if (q.status && r.status !== q.status) return false
    if (q.assigneeId && r.assigneeId !== q.assigneeId) return false
    return true
  })
  list.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  return delay(list.map((r) => view(r, user)))
}

export async function getDesignRequest(user: User, id: string): Promise<DesignRecordView> {
  runCreativeReminders(tenantOf(user))
  return delay(view(await requestFor(user, id), user))
}

function fields(user: User, input: DesignInput, existing?: DesignRecord): Partial<DesignRecord> | { error: string; status: number } {
  const co = tenantOf(user)
  const bad = (error: string, status = 422) => ({ error, status })
  const out: Partial<DesignRecord> = {}
  if (input.title !== undefined || !existing) {
    const title = clean(input.title)
    if (!title) return bad('Give the request a title.')
    if (title.length > TITLE_MAX) return bad(`Keep the title under ${TITLE_MAX} characters.`)
    out.title = title
  }
  if (input.type !== undefined || !existing) {
    if (!DESIGN_TYPES.includes(input.type as never)) return bad('Pick a type: social post, banner, brochure, presentation, video, logo or other.')
    out.type = input.type
  }
  if (input.brief !== undefined || !existing) {
    const brief = typeof input.brief === 'string' ? input.brief.trim() : ''
    if (!brief) return bad('Describe what you need in the brief.')
    if (brief.length > 10_000) return bad('Keep the brief under 10,000 characters.')
    out.brief = brief
  }
  if (input.formats !== undefined) {
    const f = input.formats
    if (!Array.isArray(f) || f.some((x) => typeof x !== 'string')) return bad('Formats must be a list.')
    const list = [...new Set(f.map((x) => x.trim()).filter(Boolean))]
    if (list.length > 10 || list.some((x) => x.length > 60)) return bad('Use up to 10 formats of 60 characters.')
    out.formats = list
  }
  const due = dateField(input.dueDate, 'The due date')
  if (due && typeof due === 'object') return bad(due.error)
  if (due !== undefined) out.dueDate = due
  if (input.priority !== undefined) {
    if (!DESIGN_PRIORITIES.includes(input.priority as never)) return bad('Pick a priority: low, medium, high or urgent.')
    out.priority = input.priority
  }
  if (input.assigneeId !== undefined && (input.assigneeId || existing?.assigneeId)) {
    if (!canEditMarketing(user)) return bad('Only marketing can assign a designer.', 403)
    if (input.assigneeId && !companyUser(co, input.assigneeId)) return bad('Pick a designer from your team.')
    out.assigneeId = input.assigneeId || null
  }
  // Campaigns and content items are Marketing data: unknown to roles that can't see Marketing.
  if (input.campaignId !== undefined) {
    if (input.campaignId && (!canViewMarketing(user) || !campaignOf(co, input.campaignId))) return bad('That campaign doesn’t exist.')
    out.campaignId = input.campaignId || null
  }
  if (input.contentItemId !== undefined) {
    if (input.contentItemId && (!canViewMarketing(user) || !contentItems.some((c) => c.id === input.contentItemId && c.companyId === co))) {
      return bad('That content item doesn’t exist.')
    }
    out.contentItemId = input.contentItemId || null
  }
  if (input.assetIds !== undefined) {
    if (Array.isArray(input.assetIds) && input.assetIds.length > 0 && !canViewMarketing(user)) return bad('That asset doesn’t exist.')
    const ids = assetIdsProblem(co, input.assetIds)
    if (typeof ids === 'string') return bad(ids)
    out.assetIds = ids
  }
  return out
}

function notify(r: Tenant<DesignRecord>, userId: string | null | undefined, actor: User, title: string): void {
  if (!userId || userId === actor.id || !companyUser(r.companyId, userId)) return
  pushNotification({ companyId: r.companyId, userId, type: 'marketing', title, body: r.title, link: designLink(r.id) })
}

/** Any active user of the company (plan module `marketing` required, checked centrally). */
export async function createDesignRequest(user: User, input: DesignInput): Promise<DesignRecordView> {
  const co = tenantOf(user)
  const f = fields(user, input ?? {})
  if ('error' in f) return fail(f.error, f.status)
  const at = nowStamp()
  const row: Tenant<DesignRecord> = stamp(
    {
      id: nextCreativeId('DR'),
      title: f.title!,
      type: f.type!,
      brief: f.brief!,
      formats: f.formats ?? [],
      dueDate: f.dueDate ?? null,
      priority: f.priority ?? 'medium',
      status: 'requested',
      requesterId: user.id,
      assigneeId: f.assigneeId ?? null,
      campaignId: f.campaignId ?? null,
      contentItemId: f.contentItemId ?? null,
      assetIds: f.assetIds ?? [],
      attachments: [],
      deliveredAt: null,
      savedAssetIds: [],
      createdAt: at,
      updatedAt: at,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      comments: [],
      history: [],
    },
    user,
  )
  addEvent(row, user, 'Requested', at)
  designRequests.push(row)
  if (row.assigneeId) {
    addEvent(row, user, `Assigned to ${nameOf(co, row.assigneeId)}`, at)
    notify(row, row.assigneeId, user, `${user.name} assigned you a design request`)
  } else {
    // Unassigned: the marketing managers are told a new request is waiting.
    for (const u of users) {
      if (u.companyId === co && u.active !== false && can(u.role, 'marketing', 'edit')) notify(row, u.id, user, `New design request from ${user.name}`)
    }
  }
  return delay(view(row, user))
}

export async function updateDesignRequest(user: User, id: string, input: DesignInput): Promise<DesignRecordView> {
  const r = await requestFor(user, id)
  if (!canEditBrief(user, r)) {
    return fail(canEditMarketing(user) || isRequester(user, r) ? 'This request is closed.' : 'Only the requester or marketing can change the request.', 403)
  }
  const f = fields(user, input ?? {}, r)
  if ('error' in f) return fail(f.error, f.status)
  const at = nowStamp()
  if ('dueDate' in f && f.dueDate !== r.dueDate) {
    r.reminderSentAt = null
    r.overdueNotifiedAt = null
  }
  const reassigned = 'assigneeId' in f && f.assigneeId !== r.assigneeId
  Object.assign(r, f, { updatedAt: at })
  if (reassigned) {
    addEvent(r, user, r.assigneeId ? `Assigned to ${nameOf(r.companyId, r.assigneeId)}` : 'Unassigned', at)
    notify(r, r.assigneeId, user, `${user.name} assigned you a design request`)
  }
  if (Object.keys(f).some((k) => k !== 'assigneeId')) addEvent(r, user, 'Edited the request', at)
  return delay(view(r, user))
}

export async function setDesignStatus(user: User, id: string, input: { status?: unknown; note?: unknown }): Promise<DesignRecordView> {
  const r = await requestFor(user, id)
  const to = input?.status
  if (!DESIGN_STATUSES.includes(to as never)) return fail('Unknown status.', 422)
  const target = to as DesignStatus
  if (target === r.status) return fail(`It is already ${DESIGN_STATUS_LABEL[target].toLowerCase()}.`, 409)
  if (!FLOW[r.status].includes(target)) return fail(`A ${DESIGN_STATUS_LABEL[r.status].toLowerCase()} request can’t move to ${DESIGN_STATUS_LABEL[target].toLowerCase()}.`, 409)
  if (!nextStatuses(user, r).includes(target)) {
    return fail(canViewMarketing(user) && !canEditMarketing(user) ? 'Your role can view design requests but not change them.' : 'You can’t make that change on this request.', 403)
  }
  if ((target === 'in_progress' || target === 'in_review') && !r.assigneeId) return fail('Assign a designer first.', 422)
  if (target === 'delivered' && r.attachments.length === 0) return fail('Attach the final file before delivering.', 422)
  const at = nowStamp()
  const from = r.status
  r.status = target
  r.updatedAt = at
  if (target === 'delivered') r.deliveredAt = at
  const note = clean(input?.note).slice(0, COMMENT_MAX)
  addEvent(r, user, `${DESIGN_STATUS_LABEL[from]} → ${DESIGN_STATUS_LABEL[target]}`, at)
  if (note) r.comments.push({ id: nextChildId(r.id, 'c'), authorId: user.id, body: note, mentions: [], at })
  const label = DESIGN_STATUS_LABEL[target].toLowerCase()
  notify(r, r.requesterId, user, `Your design request is ${label}`)
  notify(r, r.assigneeId, user, `${user.name} set a design request to ${label}`)
  return delay(view(r, user))
}

/**
 * The requester, the assignee and marketing `full` roles comment (marketing `view` roles read only).
 * @mentions reach only people who can see the request.
 */
export async function addDesignComment(user: User, id: string, input: { body?: unknown }): Promise<DesignRecordView> {
  const r = await requestFor(user, id)
  if (!canComment(user, r)) return fail('Your role can view design requests but not change them.', 403)
  const body = clean(input?.body)
  if (!body) return fail('Write a comment.', 422)
  if (body.length > COMMENT_MAX) return fail(`Keep comments under ${COMMENT_MAX} characters.`, 422)
  const co = r.companyId
  const mentions = parseMentions(body, co).filter((uid) => {
    const u = users.find((x) => x.id === uid && x.companyId === co)
    return !!u && canSeeDesign(u, r)
  })
  const at = nowStamp()
  r.comments.push({ id: nextChildId(r.id, 'c'), authorId: user.id, body, mentions, at })
  r.updatedAt = at
  for (const uid of mentions) notify(r, uid, user, `${user.name} mentioned you`)
  return delay(view(r, user))
}

/** Requester, assignee or marketing full; counted against the plan's storageMb. */
export async function addDesignAttachment(user: User, id: string, input: Partial<AttachmentInput>): Promise<DesignRecordView> {
  const r = await requestFor(user, id)
  if (!canComment(user, r)) return fail('Your role can view design requests but not change them.', 403)
  if (r.status === 'cancelled') return fail('This request is cancelled.', 409)
  const file = { name: clean(input?.name), mimeType: clean(input?.mimeType).toLowerCase(), sizeBytes: input?.sizeBytes }
  const problem = attachmentProblem(file)
  if (problem) return fail(problem, 422)
  let url: string | null = null
  if (input?.dataUrl) {
    const p = checkPreview(input.dataUrl, file.mimeType, file.sizeBytes as number)
    if (!p.ok) return fail(p.message, 422)
    url = p.dataUrl
  }
  assertCapacity(r.companyId, 'storageMb', (file.sizeBytes as number) / (1024 * 1024))
  const at = nowStamp()
  r.attachments.push({ id: nextChildId(r.id, 'a'), name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes as number, url, uploadedBy: user.id, uploadedAt: at })
  r.updatedAt = at
  addEvent(r, user, `Attached ${file.name}`, at)
  noteUsage(r.companyId)
  return delay(view(r, user))
}

/** The uploader or marketing full. A file already saved to Brand assets stays there (the asset keeps it). */
export async function removeDesignAttachment(user: User, id: string, attachmentId: string): Promise<DesignRecordView> {
  const r = await requestFor(user, id)
  const a = r.attachments.find((x) => x.id === attachmentId)
  if (!a) return fail('That attachment doesn’t exist.', 404)
  if (!canEditMarketing(user) && a.uploadedBy !== user.id) return fail('Only the person who uploaded it (or marketing) can remove it.', 403)
  for (const asset of brandAssets) if (asset.companyId === r.companyId && asset.sourceAttachmentId === a.id) asset.sourceAttachmentId = null
  r.attachments = r.attachments.filter((x) => x.id !== attachmentId)
  const at = nowStamp()
  r.updatedAt = at
  addEvent(r, user, `Removed ${a.name}`, at)
  return delay(view(r, user))
}

/** Delivered request → a brand asset (source design_request), marketing full only. */
export async function saveDesignToAssets(user: User, id: string, input: SaveToAssetsInput): Promise<BrandAsset> {
  const r = await requestFor(user, id)
  if (!canEditMarketing(user)) return fail('Only marketing can save files to Brand assets.', 403)
  if (r.status !== 'delivered') return fail('Only delivered requests can be saved to Brand assets.', 409)
  const file = input?.attachmentId ? r.attachments.find((a) => a.id === input.attachmentId) : r.attachments[r.attachments.length - 1]
  if (!file) return fail(input?.attachmentId ? 'That attachment doesn’t exist.' : 'There is no delivered file to save.', 422)
  if (brandAssets.some((a) => a.companyId === r.companyId && a.sourceAttachmentId === file.id)) return fail('That file is already in Brand assets.', 409)
  const kind = input?.kind ?? kindForMime(file.mimeType)
  if (!ASSET_KINDS.includes(kind)) return fail('Unknown asset kind.', 422)
  const problem = assetFileProblem(kind, { name: file.name, mimeType: file.mimeType, sizeBytes: 1 })
  if (problem) return fail(problem, 422)
  const tags = cleanTags(input?.tags ?? [])
  if (typeof tags === 'string') return fail(tags, 422)
  const name = clean(input?.name) || r.title
  if (name.length > 120) return fail('Keep the name under 120 characters.', 422)
  const at = nowStamp()
  const asset: Tenant<AssetRecord> = stamp(
    {
      id: nextCreativeId('BA'),
      name,
      kind,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      url: file.url,
      tags,
      campaignId: r.campaignId,
      source: 'design_request',
      designRequestId: r.id,
      sourceAttachmentId: file.id,
      description: r.brief.slice(0, 2000),
      usageRightsExpiresAt: null,
      status: 'active',
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
      expiryNotifiedAt: null,
    },
    user,
  )
  brandAssets.push(asset)
  r.savedAssetIds.push(asset.id)
  r.updatedAt = at
  addEvent(r, user, `Saved ${file.name} to Brand assets`, at)
  return delay(assetView(asset))
}
