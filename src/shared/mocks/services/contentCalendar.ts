import type { User } from '@/shared/types'
import {
  CONTENT_CHANNELS,
  CONTENT_STATUSES,
  CONTENT_STATUS_LABEL,
  CONTENT_TYPES,
  type ContentInput,
  type ContentItem,
  type ContentQuery,
  type ContentStatus,
  type ContentStatusInput,
} from '@/modules/marketing/creative/types'
import { zonedParts, zonedToUtc, isRealIsoDate, HH_MM } from '@/shared/lib/zonedTime'
import { contentItems, nextChildId, nextCreativeId, type ContentRecord } from '@/shared/mocks/data/marketingCreative'
import { pushNotification } from '@/shared/mocks/data/tasks'
import { users } from '@/shared/mocks/db'
import { nowMs } from '@/shared/mocks/clock'
import { delay, fail } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { can } from '@/shared/lib/permissions'
import { parseMentions } from '@/shared/mocks/services/tasks'
import { contentLink, runCreativeReminders } from '@/shared/mocks/services/creativeReminders'
import {
  COMMENT_MAX,
  addEvent,
  assetIdsProblem,
  assetRefs,
  campaignOf,
  canEditMarketing,
  clean,
  commentView,
  companyUser,
  eventView,
  nameOf,
  nowStamp,
  requireEdit,
  requireView,
  timezoneOf,
} from './creativeShared'

/* ------------------------------------------------------------------------------------------
 * CONTENT CALENDAR (/marketing/content*). Plan module `marketing`; rights from the Marketing column
 * (view → reads, full → writes). Rules (docs/API.md › Marketing › Content calendar):
 *   idea → draft → in_review → approved → scheduled → published (+ archived)
 *   - only a marketing `full` role approves, never the item's own owner — except a Company Admin;
 *     approval needs the item in review;
 *   - scheduled needs the item approved and publish_at in the future (company wall time → UTC);
 *   - published is marked by hand with the live URL (no social network API);
 *   - changing the title / type / channels / copy of an approved or scheduled item sends it back to
 *     review (the approval is cleared); a published item only takes notes, assets and campaign.
 * ---------------------------------------------------------------------------------------- */

const NOT_FOUND = 'That content item doesn’t exist.'
const TITLE_MAX = 200
const MAX_AHEAD_MS = 2 * 366 * 86_400_000
const WALL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i
/** Statuses a PATCH of content fields sends back to review. */
const APPROVED_STATES: ContentStatus[] = ['approved', 'scheduled']
const CONTENT_FIELDS = ['title', 'type', 'channels', 'body'] as const

/** Approval rule: marketing full; the owner never approves their own item unless they are a Company Admin. */
export function canApproveContent(user: User, c: Pick<ContentRecord, 'ownerId'>): boolean {
  if (!can(user.role, 'marketing', 'edit')) return false
  return c.ownerId !== user.id || user.role === 'Company Admin'
}

function view(c: Tenant<ContentRecord>, user: User): ContentItem {
  const co = c.companyId
  const tz = timezoneOf(co)
  const local = c.publishAt ? zonedParts(c.publishAt, tz) : null
  const { companyId: _c, reminderSentAt: _r, overdueNotifiedAt: _o, ...rest } = c
  return {
    ...rest,
    channels: [...c.channels],
    assetIds: [...c.assetIds],
    ownerName: nameOf(co, c.ownerId),
    reviewerName: nameOf(co, c.reviewerId),
    approvedByName: nameOf(co, c.approvedBy),
    publishLocal: local ? `${local.date}T${local.time}` : null,
    timezone: tz,
    campaignName: campaignOf(co, c.campaignId)?.name ?? '',
    assets: assetRefs(co, c.assetIds),
    overdue: c.status === 'scheduled' && !!c.publishAt && Date.parse(c.publishAt) <= nowMs(),
    canApprove: c.status === 'in_review' && canApproveContent(user, c),
    comments: c.comments.map((x) => commentView(co, x)),
    history: c.history.map((x) => eventView(co, x)),
  }
}

/** "YYYY-MM-DDTHH:mm" in the company timezone → UTC ISO, or an error. */
export function wallToUtc(co: string, raw: unknown): string | { error: string } {
  const m = typeof raw === 'string' ? WALL.exec(raw.trim()) : null
  if (!m || !isRealIsoDate(m[1]) || !HH_MM.test(m[2])) return { error: 'Publish time uses the format YYYY-MM-DDTHH:mm (company time).' }
  const utc = zonedToUtc(m[1], m[2], timezoneOf(co))
  if (Date.parse(utc) - nowMs() > MAX_AHEAD_MS) return { error: 'Plan content at most two years ahead.' }
  return utc
}

async function itemFor(user: User, id: string): Promise<Tenant<ContentRecord>> {
  const c = findInTenant(contentItems, user, (x) => x.id === id)
  if (!c) return fail(NOT_FOUND, 404)
  return c
}

export async function getContentItems(user: User, q: ContentQuery = {}): Promise<ContentItem[]> {
  const co = await requireView(user, 'Marketing')
  runCreativeReminders(co)
  const tz = timezoneOf(co)
  const list = scoped(contentItems, user).filter((c) => {
    if (q.status && c.status !== q.status) return false
    if (q.type && c.type !== q.type) return false
    if (q.channel && !c.channels.includes(q.channel as never)) return false
    if (q.campaignId && c.campaignId !== q.campaignId) return false
    if (q.ownerId && c.ownerId !== q.ownerId) return false
    if (q.from || q.to) {
      if (!c.publishAt) return false
      const d = zonedParts(c.publishAt, tz).date
      if (q.from && d < q.from) return false
      if (q.to && d > q.to) return false
    }
    return true
  })
  list.sort((a, b) => (a.publishAt ?? '9999').localeCompare(b.publishAt ?? '9999') || b.createdAt.localeCompare(a.createdAt))
  return delay(list.map((c) => view(c, user)))
}

export async function getContentItem(user: User, id: string): Promise<ContentItem> {
  const co = await requireView(user)
  runCreativeReminders(co)
  return delay(view(await itemFor(user, id), user))
}

/** Validates a create / update body: cleaned fields or an error. */
function fields(co: string, input: ContentInput, existing?: ContentRecord): Partial<ContentRecord> | string {
  const out: Partial<ContentRecord> = {}
  if (input.title !== undefined || !existing) {
    const title = clean(input.title)
    if (!title) return 'Give the content a title.'
    if (title.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`
    out.title = title
  }
  if (input.type !== undefined || !existing) {
    if (!CONTENT_TYPES.includes(input.type as never)) return 'Pick a type: social post, blog post, newsletter, video, case study, press release or other.'
    out.type = input.type
  }
  if (input.channels !== undefined || !existing) {
    const ch = input.channels
    if (!Array.isArray(ch) || ch.length === 0) return 'Pick at least one channel.'
    if (ch.some((x) => !CONTENT_CHANNELS.includes(x))) return 'Unknown channel.'
    out.channels = CONTENT_CHANNELS.filter((x) => ch.includes(x))
  }
  if (input.ownerId !== undefined) {
    if (!input.ownerId || !companyUser(co, input.ownerId)) return 'Pick an owner from your team.'
    out.ownerId = input.ownerId
  }
  if (input.reviewerId !== undefined) {
    if (input.reviewerId) {
      const r = companyUser(co, input.reviewerId)
      if (!r || !can(r.role, 'marketing', 'edit')) return 'Pick a reviewer who can approve marketing content.'
    }
    out.reviewerId = input.reviewerId || null
  }
  if (input.publishAt !== undefined) {
    if (input.publishAt === null || input.publishAt === '') out.publishAt = null
    else {
      const utc = wallToUtc(co, input.publishAt)
      if (typeof utc !== 'string') return utc.error
      out.publishAt = utc
    }
  }
  if (input.campaignId !== undefined) {
    if (input.campaignId && !campaignOf(co, input.campaignId)) return 'That campaign doesn’t exist.'
    out.campaignId = input.campaignId || null
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string') return 'The copy must be text.'
    if (input.body.length > 20_000) return 'Keep the copy under 20,000 characters.'
    out.body = input.body
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') return 'Notes must be text.'
    out.notes = input.notes.slice(0, 5000)
  }
  if (input.assetIds !== undefined) {
    const ids = assetIdsProblem(co, input.assetIds)
    if (typeof ids === 'string') return ids
    out.assetIds = ids
  }
  return out
}

export async function createContentItem(user: User, input: ContentInput): Promise<ContentItem> {
  const co = await requireEdit(user, 'content')
  const f = fields(co, input ?? {})
  if (typeof f === 'string') return fail(f, 422)
  const status = input?.status ?? 'idea'
  if (!['idea', 'draft', 'in_review'].includes(status)) return fail('New content starts as an idea, a draft or in review.', 422)
  const at = nowStamp()
  const id = nextCreativeId('CI')
  const row: Tenant<ContentRecord> = stamp(
    {
      id,
      title: f.title!,
      type: f.type!,
      channels: f.channels!,
      status,
      ownerId: f.ownerId ?? user.id,
      reviewerId: f.reviewerId ?? null,
      approvedBy: null,
      approvedAt: null,
      publishAt: f.publishAt ?? null,
      campaignId: f.campaignId ?? null,
      body: f.body ?? '',
      notes: f.notes ?? '',
      assetIds: f.assetIds ?? [],
      publishedUrl: null,
      publishedAt: null,
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
      reminderSentAt: null,
      overdueNotifiedAt: null,
      comments: [],
      history: [],
    },
    user,
  )
  addEvent(row, user, `Created as ${CONTENT_STATUS_LABEL[status]}`, at)
  contentItems.push(row)
  if (status === 'in_review') notifyReviewer(row, user)
  return delay(view(row, user))
}

function notifyReviewer(c: Tenant<ContentRecord>, user: User): void {
  if (!c.reviewerId || c.reviewerId === user.id || !companyUser(c.companyId, c.reviewerId)) return
  pushNotification({ companyId: c.companyId, userId: c.reviewerId, type: 'marketing', title: `${user.name} asked you to review content`, body: c.title, link: contentLink(c.id) })
}

function clearReminders(c: ContentRecord): void {
  c.reminderSentAt = null
  c.overdueNotifiedAt = null
}

export async function updateContentItem(user: User, id: string, input: ContentInput): Promise<ContentItem> {
  const co = await requireView(user)
  const c = await itemFor(user, id)
  await requireEdit(user, 'content')
  const body = input ?? {}
  const f = fields(co, body, c)
  if (typeof f === 'string') return fail(f, 422)
  if (c.status === 'published' && Object.keys(f).some((k) => !['notes', 'assetIds', 'campaignId'].includes(k))) {
    return fail('Published content can’t be changed; only notes, assets and campaign. Archive it or create a new item.', 409)
  }
  if (c.status === 'archived' && Object.keys(f).some((k) => k !== 'notes')) return fail('Restore the item to a draft before changing it.', 409)
  const at = nowStamp()
  if ('publishAt' in f && f.publishAt !== c.publishAt) {
    if (c.status === 'scheduled') {
      if (!f.publishAt) return fail('Scheduled content needs a publish time. Move it back to approved first to clear it.', 422)
      if (Date.parse(f.publishAt) <= nowMs()) return fail('Pick a publish time in the future.', 422)
    }
    clearReminders(c)
    const tz = timezoneOf(co)
    const label = f.publishAt ? (({ date, time }) => `${date} ${time}`)(zonedParts(f.publishAt, tz)) : 'no date'
    addEvent(c, user, `Publish time set to ${label}`, at)
  }
  const contentChanged = CONTENT_FIELDS.some((k) => k in f && JSON.stringify(f[k]) !== JSON.stringify(c[k]))
  Object.assign(c, f, { updatedAt: at })
  if (contentChanged && APPROVED_STATES.includes(c.status)) {
    c.status = 'in_review'
    c.approvedBy = null
    c.approvedAt = null
    addEvent(c, user, 'Changed after approval: back to review', at)
    notifyReviewer(c, user)
  } else if (Object.keys(f).some((k) => k !== 'publishAt')) addEvent(c, user, 'Edited', at)
  return delay(view(c, user))
}

/** POST /marketing/content/:id/status: the only way to change the status (board, drawer). */
export async function setContentStatus(user: User, id: string, input: Partial<ContentStatusInput>): Promise<ContentItem> {
  const co = await requireView(user)
  const c = await itemFor(user, id)
  await requireEdit(user, 'content')
  const to = input?.status
  if (!CONTENT_STATUSES.includes(to as never)) return fail('Unknown status.', 422)
  const target = to as ContentStatus
  const from = c.status
  if (target === from) return fail(`It is already ${CONTENT_STATUS_LABEL[from].toLowerCase()}.`, 409)
  if (from === 'published' && target !== 'archived') return fail('Published content can only be archived.', 409)
  if (from === 'archived' && !['idea', 'draft'].includes(target)) return fail('Restore archived content as an idea or a draft first.', 409)
  const at = nowStamp()

  switch (target) {
    case 'approved': {
      if (from !== 'in_review' && from !== 'scheduled') return fail('Send it for review before approving it.', 409)
      if (from === 'in_review') {
        if (!canApproveContent(user, c)) return fail('You can’t approve your own content. Ask another marketing manager (or a Company Admin).', 403)
        c.approvedBy = user.id
        c.approvedAt = at
        if (c.ownerId && c.ownerId !== user.id) {
          pushNotification({ companyId: co, userId: c.ownerId, type: 'marketing', title: `${user.name} approved your content`, body: c.title, link: contentLink(c.id) })
        }
      }
      break
    }
    case 'scheduled': {
      if (from !== 'approved') return fail(from === 'in_review' ? 'It needs approval before it can be scheduled.' : 'Only approved content can be scheduled.', 409)
      if (input.publishAt !== undefined) {
        const utc = wallToUtc(co, input.publishAt)
        if (typeof utc !== 'string') return fail(utc.error, 422)
        if (utc !== c.publishAt) clearReminders(c)
        c.publishAt = utc
      }
      if (!c.publishAt) return fail('Set a publish time before scheduling.', 422)
      if (Date.parse(c.publishAt) <= nowMs()) return fail('Pick a publish time in the future.', 422)
      clearReminders(c)
      break
    }
    case 'published': {
      if (from !== 'approved' && from !== 'scheduled') return fail('Only approved or scheduled content can be marked published.', 409)
      const url = clean(input.publishedUrl)
      if (!url || !URL_RE.test(url) || url.length > 500) return fail('Paste the link to the live post (https://…).', 422)
      c.publishedUrl = url
      c.publishedAt = at
      break
    }
    case 'idea':
    case 'draft':
    case 'in_review': {
      if (APPROVED_STATES.includes(from)) {
        c.approvedBy = null
        c.approvedAt = null
      }
      break
    }
    case 'archived':
      break
  }
  c.status = target
  c.updatedAt = at
  addEvent(c, user, `${CONTENT_STATUS_LABEL[from]} → ${CONTENT_STATUS_LABEL[target]}${target === 'published' ? ` (${c.publishedUrl})` : ''}`, at)
  if (target === 'in_review') notifyReviewer(c, user)
  return delay(view(c, user))
}

/** Comments: marketing full roles. @mentions notify mentioned people who can see Marketing. */
export async function addContentComment(user: User, id: string, input: { body?: unknown }): Promise<ContentItem> {
  const co = await requireView(user)
  const c = await itemFor(user, id)
  if (!canEditMarketing(user)) return fail('Your role can view marketing but not comment.', 403)
  const body = clean(input?.body)
  if (!body) return fail('Write a comment.', 422)
  if (body.length > COMMENT_MAX) return fail(`Keep comments under ${COMMENT_MAX} characters.`, 422)
  const mentions = parseMentions(body, tenantOf(user)).filter((uid) => {
    const u = users.find((x) => x.id === uid && x.companyId === co)
    return !!u && can(u.role, 'marketing', 'view')
  })
  const at = nowStamp()
  c.comments.push({ id: nextChildId(c.id, 'c'), authorId: user.id, body, mentions, at })
  c.updatedAt = at
  for (const uid of mentions) {
    if (uid === user.id) continue
    pushNotification({ companyId: co, userId: uid, type: 'mention', title: `${user.name} mentioned you`, body: `${c.title}: ${body.length > 120 ? `${body.slice(0, 117)}…` : body}`, link: contentLink(c.id) })
  }
  return delay(view(c, user))
}
