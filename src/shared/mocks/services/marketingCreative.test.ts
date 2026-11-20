import { describe, expect, it } from 'vitest'
import { addDays, format } from 'date-fns'
import { notifications } from '@/shared/mocks/data/tasks'
import { brandAssets, contentItems, designRequests } from '@/shared/mocks/data/marketingCreative'
import { campaigns } from '@/shared/mocks/data/marketing'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { users } from '@/shared/mocks/db'
import { subOf, usedOf } from '@/shared/mocks/services/billing'
import { runCreativeReminders } from '@/shared/mocks/services/creativeReminders'
import { contentMoveProblem } from '@/modules/marketing/creative/rules'
import { assetFileProblem, attachmentProblem, checkPreview } from '@/modules/marketing/creative/assetRules'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { addDaysIso } from '@/shared/lib/companyDay'
import { APEX, CREST, api, sliceText as takeSnapshotText, useSeedPerTest, userToken, type Co } from '@/shared/mocks/isolation/harness'

/**
 * Marketing creative rules through the real handlers (content calendar, design requests, brand
 * assets): approval and scheduling rules, company-timezone publish times, reminders stored once,
 * design-request rights per requester / assignee / marketing role, storage limits, upload checks,
 * system assets, foreign ids in bodies, module gating.
 */

useSeedPerTest()

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
const HOUR = 3_600_000
const call = (as: string, method: string, path: string, body?: unknown) => api(userToken(as), method, path, { body })
const ok = async (as: string, method: string, path: string, body?: unknown) => {
  const r = await call(as, method, path, body)
  expect(r.status, `${method} ${path} as ${as}: ${r.text}`).toBe(200)
  return r.body
}
const notesFor = (link: string) => notifications.filter((n) => n.link.includes(link))

async function newContent(as: string, extra: Record<string, unknown> = {}) {
  return ok(as, 'POST', '/marketing/content', { title: `Post ${Math.random().toString(36).slice(2, 7)}`, type: 'social_post', channels: ['linkedin'], ...extra })
}

describe('content calendar: approval', () => {
  it('only marketing full roles approve, never their own item — except a Company Admin', async () => {
    const own = await newContent('u7', { status: 'in_review', publish_at: `${day(10)}T10:00` })
    expect(own.can_approve).toBe(false)
    const self = await call('u7', 'POST', `/marketing/content/${own.id}/status`, { status: 'approved' })
    expect(self.status).toBe(403)
    expect((await call('u3', 'POST', `/marketing/content/${own.id}/status`, { status: 'approved' })).status).toBe(403) // Sales Manager: view
    const approved = await ok('u2', 'POST', `/marketing/content/${own.id}/status`, { status: 'approved' })
    expect(approved).toMatchObject({ status: 'approved', approved_by: 'u2', approved_by_name: 'Layla Mansour' })
    expect(notesFor(own.id).some((n) => n.userId === 'u7' && n.title.includes('approved'))).toBe(true)

    const admins = await newContent('u1', { status: 'in_review' })
    expect(admins.can_approve).toBe(true)
    expect((await ok('u1', 'POST', `/marketing/content/${admins.id}/status`, { status: 'approved' })).status).toBe('approved')
  })

  it('approval needs the item in review', async () => {
    const draft = await newContent('u7', { status: 'draft' })
    const r = await call('u2', 'POST', `/marketing/content/${draft.id}/status`, { status: 'approved' })
    expect(r.status).toBe(409)
    expect(r.body.message).toMatch(/review/)
  })

  it('changing the copy of an approved item sends it back to review; notes do not', async () => {
    const c = await newContent('u7', { status: 'in_review', publish_at: `${day(10)}T10:00` })
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'approved' })
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled' })
    expect((await ok('u7', 'PATCH', `/marketing/content/${c.id}`, { notes: 'internal' })).status).toBe('scheduled')
    const edited = await ok('u7', 'PATCH', `/marketing/content/${c.id}`, { body: 'New copy' })
    expect(edited).toMatchObject({ status: 'in_review', approved_by: null })
  })
})

describe('content calendar: scheduling and publishing', () => {
  it('scheduled needs approval and a publish time in the future', async () => {
    const c = await newContent('u7', { status: 'in_review' })
    expect((await call('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled', publish_at: `${day(5)}T09:00` })).status).toBe(409)
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'approved' })
    const noTime = await call('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled' })
    expect(noTime.status).toBe(422)
    const past = await call('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled', publish_at: `${day(-1)}T09:00` })
    expect(past.status).toBe(422)
    expect(past.body.message).toMatch(/future/)
    const s = await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled', publish_at: `${day(5)}T09:00` })
    expect(s).toMatchObject({ status: 'scheduled', publish_local: `${day(5)}T09:00` })
    // A scheduled item can't be dragged into the past (calendar rollback case).
    expect((await call('u7', 'PATCH', `/marketing/content/${c.id}`, { publish_at: `${day(-2)}T09:00` })).status).toBe(422)
    expect((await ok('u7', 'PATCH', `/marketing/content/${c.id}`, { publish_at: `${day(6)}T09:00` })).publish_local).toBe(`${day(6)}T09:00`)
  })

  it('publish time is wall time in the company timezone (Dubai +4, Riyadh +3)', async () => {
    const date = day(20)
    const apex = await newContent('u1', { publish_at: `${date}T10:00` })
    const crest = await newContent('u101', { publish_at: `${date}T10:00` })
    expect(apex.publish_at).toBe(`${date}T06:00:00.000Z`)
    expect(crest.publish_at).toBe(`${date}T07:00:00.000Z`)
    expect(apex).toMatchObject({ publish_local: `${date}T10:00`, timezone: 'Asia/Dubai' })
    expect(crest.timezone).toBe('Asia/Riyadh')
    expect((await call('u1', 'POST', '/marketing/content', { title: 'x', type: 'video', channels: ['youtube'], publish_at: '2030-02-30T10:00' })).status).toBe(422)
  })

  it('published is marked by hand with the live URL; then only archiving', async () => {
    const c = await newContent('u7', { status: 'in_review' })
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'approved' })
    expect((await call('u7', 'POST', `/marketing/content/${c.id}/status`, { status: 'published' })).status).toBe(422)
    expect((await call('u7', 'POST', `/marketing/content/${c.id}/status`, { status: 'published', published_url: 'javascript:alert(1)' })).status).toBe(422)
    const p = await ok('u7', 'POST', `/marketing/content/${c.id}/status`, { status: 'published', published_url: 'https://www.linkedin.com/posts/x' })
    expect(p.published_url).toBe('https://www.linkedin.com/posts/x')
    expect(p.published_at).toBeTruthy()
    expect((await call('u7', 'POST', `/marketing/content/${c.id}/status`, { status: 'draft' })).status).toBe(409)
    expect((await call('u7', 'PATCH', `/marketing/content/${c.id}`, { title: 'Changed' })).status).toBe(409)
    expect((await ok('u7', 'POST', `/marketing/content/${c.id}/status`, { status: 'archived' })).status).toBe('archived')
  })

  it('the board’s client rules match the server (refusal messages before calling it)', () => {
    const now = Date.now()
    const item = { status: 'in_review' as const, ownerId: 'u7', publishAt: new Date(now + 86_400_000).toISOString() }
    expect(contentMoveProblem(item, 'approved', { id: 'u7', role: 'Marketing Manager' })).toMatch(/own content/)
    expect(contentMoveProblem(item, 'approved', { id: 'u1', role: 'Company Admin' })).toBeNull()
    expect(contentMoveProblem(item, 'scheduled', { id: 'u2', role: 'Management' })).toMatch(/approval/)
    expect(contentMoveProblem({ ...item, status: 'approved', publishAt: new Date(now - 1000).toISOString() }, 'scheduled', { id: 'u2', role: 'Management' }, now)).toMatch(/future/)
    expect(contentMoveProblem(item, 'draft', { id: 'u3', role: 'Sales Manager' })).toMatch(/view/)
  })
})

describe('content reminders (stored once, company time)', () => {
  it('owner reminder 24 h before publish_at, overdue notice once, re-armed by a new time', async () => {
    const c = await newContent('u7', { status: 'in_review', publish_at: `${day(10)}T10:00` })
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'approved' })
    await ok('u2', 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled' })
    const at = Date.parse(c.publish_at)
    const crestBefore = notifications.filter((n) => n.companyId === CREST).length

    expect(runCreativeReminders(APEX, new Date(at - 25 * HOUR)).contentDue).toBe(0)
    expect(runCreativeReminders(APEX, new Date(at - 23 * HOUR)).contentDue).toBe(1)
    expect(runCreativeReminders(APEX, new Date(at - 22 * HOUR)).contentDue).toBe(0)
    expect(notesFor(c.id).filter((n) => n.type === 'marketing-due' && n.userId === 'u7')).toHaveLength(1)

    expect(runCreativeReminders(APEX, new Date(at + 60_000)).contentOverdue).toBe(1)
    expect(runCreativeReminders(APEX, new Date(at + 2 * HOUR)).contentOverdue).toBe(0)
    expect(notesFor(c.id).filter((n) => n.type === 'marketing-overdue')).toHaveLength(1)
    // Another company's tick never touches Apex, and Apex's never Crest.
    expect(notifications.filter((n) => n.companyId === CREST).length).toBe(crestBefore)

    await ok('u7', 'PATCH', `/marketing/content/${c.id}`, { publish_at: `${day(12)}T10:00` })
    const next = Date.parse((await ok('u7', 'GET', `/marketing/content/${c.id}`)).publish_at)
    expect(runCreativeReminders(APEX, new Date(next - 2 * HOUR)).contentDue).toBe(1)
  })

  it('the reminder uses the instant: the same wall time reminds Crest an hour later than Apex', async () => {
    const date = day(15)
    const apex = await newContent('u1', { status: 'in_review', publish_at: `${date}T10:00` })
    const crest = await newContent('u101', { status: 'in_review', publish_at: `${date}T10:00` })
    for (const [as, c] of [['u1', apex], ['u101', crest]] as const) {
      await ok(as, 'POST', `/marketing/content/${c.id}/status`, { status: 'approved' })
      await ok(as, 'POST', `/marketing/content/${c.id}/status`, { status: 'scheduled' })
    }
    // 10:00 Dubai = 06:00Z, 10:00 Riyadh = 07:00Z. At 06:30Z the day before, Apex is 23.5 h away (remind), Crest 24.5 h (not yet).
    const probe = new Date(`${day(14)}T06:30:00.000Z`)
    expect(runCreativeReminders(APEX, probe).contentDue).toBe(1)
    expect(runCreativeReminders(CREST, probe).contentDue).toBe(0)
  })

  it('design requests: due-soon and overdue notices to assignee and requester, once', async () => {
    // Due tomorrow on the company's calendar (Dubai), whatever the machine's timezone.
    const tomorrow = addDaysIso(companyDayOf(APEX).today, 1)
    const r = await ok('u4', 'POST', '/marketing/design-requests', { title: 'Flyer', type: 'brochure', brief: 'A5 flyer', due_date: tomorrow })
    await ok('u7', 'PATCH', `/marketing/design-requests/${r.id}`, { assignee_id: 'u17' })
    const tick = runCreativeReminders(APEX)
    expect(tick.designDue).toBe(2)
    expect(runCreativeReminders(APEX).designDue).toBe(0)
    expect(notesFor(r.id).filter((n) => n.type === 'marketing-due').map((n) => n.userId).sort()).toEqual(['u17', 'u4'])
    runCreativeReminders(APEX, new Date(Date.now() + 3 * 86_400_000))
    runCreativeReminders(APEX, new Date(Date.now() + 4 * 86_400_000))
    expect(notesFor(r.id).filter((n) => n.type === 'marketing-overdue').map((n) => n.userId).sort()).toEqual(['u17', 'u4'])
  })

  it('brand assets: usage-rights alert 30 days ahead, once, re-armed by a new date', async () => {
    const a = await ok('u7', 'POST', '/marketing/assets', { name: 'Stock photo', kind: 'image', mime_type: 'image/jpeg', size_bytes: 5000, usage_rights_expires_at: day(40) })
    expect(runCreativeReminders(APEX).assetExpiry).toBe(1) // the seed's BA-1003 (20 days)
    expect(notesFor(a.id)).toHaveLength(0)
    await ok('u7', 'PATCH', `/marketing/assets/${a.id}`, { usage_rights_expires_at: day(25) })
    expect(runCreativeReminders(APEX).assetExpiry).toBe(1)
    expect(runCreativeReminders(APEX).assetExpiry).toBe(0)
    expect(notesFor(a.id).filter((n) => n.userId === 'u7')).toHaveLength(1)
    expect((await ok('u7', 'GET', '/marketing/assets?expiring=1')).map((x: { id: string }) => x.id)).toContain(a.id)
  })
})

describe('design requests: who sees and does what', () => {
  it('any active user requests; a Sales Agent sees only their own and what is assigned to them', async () => {
    const mine = await ok('u4', 'POST', '/marketing/design-requests', { title: 'Pitch one-pager', type: 'brochure', brief: 'For a clinic', priority: 'high' })
    expect(mine).toMatchObject({ requester_id: 'u4', status: 'requested', can_manage: false, can_edit: true })
    const list = await ok('u4', 'GET', '/marketing/design-requests')
    expect(list.every((r: { requester_id: string; assignee_id: string | null }) => r.requester_id === 'u4' || r.assignee_id === 'u4')).toBe(true)
    expect(list.map((r: { id: string }) => r.id)).toContain(mine.id)
    // Another agent: invisible, exactly like a missing id.
    const other = await call('u5', 'GET', `/marketing/design-requests/${mine.id}`)
    const missing = await call('u5', 'GET', '/marketing/design-requests/DR-nope')
    expect(other.status).toBe(404)
    expect(other.body).toEqual(missing.body)
    expect((await ok('u5', 'GET', '/marketing/design-requests')).some((r: { id: string }) => r.id === mine.id)).toBe(false)
    // Requesters can't assign or link Marketing data.
    expect((await call('u4', 'POST', '/marketing/design-requests', { title: 'x', type: 'logo', brief: 'y', assignee_id: 'u17' })).status).toBe(403)
    expect((await call('u4', 'POST', '/marketing/design-requests', { title: 'x', type: 'logo', brief: 'y', campaign_id: 'CMP-1001' })).status).toBe(422)
    const opts = await ok('u4', 'GET', '/marketing/design-requests/options')
    expect(opts).toMatchObject({ can_view_all: false, can_manage: false, designers: [], campaigns: [] })
  })

  it('assignee works the request; requester approves; marketing delivers to Brand assets', async () => {
    const r = await ok('u4', 'POST', '/marketing/design-requests', { title: 'Webinar banner', type: 'banner', brief: '1200×300' })
    expect((await call('u17', 'GET', `/marketing/design-requests/${r.id}`)).status).toBe(404) // not assigned yet
    await ok('u7', 'PATCH', `/marketing/design-requests/${r.id}`, { assignee_id: 'u17' })
    expect(notesFor(r.id).some((n) => n.userId === 'u17')).toBe(true)
    const seen = await ok('u17', 'GET', `/marketing/design-requests/${r.id}`)
    expect(seen.next_statuses).toEqual(['in_progress'])
    expect((await call('u17', 'PATCH', `/marketing/design-requests/${r.id}`, { brief: 'changed' })).status).toBe(403)
    await ok('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'in_progress' })
    expect((await call('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'approved' })).status).toBe(409) // not a valid move from in_progress
    await ok('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'in_review' })
    expect((await call('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'approved' })).status).toBe(403) // the requester approves
    await ok('u4', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'approved' })
    expect((await call('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'delivered' })).status).toBe(422) // no file yet
    await ok('u17', 'POST', `/marketing/design-requests/${r.id}/attachments`, { name: 'banner.png', mime_type: 'image/png', size_bytes: 120_000 })
    const delivered = await ok('u17', 'POST', `/marketing/design-requests/${r.id}/status`, { status: 'delivered' })
    expect(delivered.delivered_at).toBeTruthy()
    expect((await call('u4', 'POST', `/marketing/design-requests/${r.id}/save-to-assets`, {})).status).toBe(403)
    const asset = await ok('u7', 'POST', `/marketing/design-requests/${r.id}/save-to-assets`, { tags: ['Webinar'] })
    expect(asset).toMatchObject({ source: 'design_request', design_request_id: r.id, kind: 'image', tags: ['webinar'] })
    expect((await call('u7', 'POST', `/marketing/design-requests/${r.id}/save-to-assets`, {})).status).toBe(409)
    expect((await ok('u7', 'GET', `/marketing/design-requests/${r.id}`)).saved_asset_ids).toEqual([asset.id])
  })

  it('marketing view roles read every request but change nothing', async () => {
    const id = designRequests.find((r) => r.companyId === APEX && r.requesterId === 'u4')!.id
    expect((await call('u3', 'GET', `/marketing/design-requests/${id}`)).status).toBe(200)
    expect((await call('u3', 'PATCH', `/marketing/design-requests/${id}`, { priority: 'low' })).status).toBe(403)
    expect((await call('u3', 'POST', `/marketing/design-requests/${id}/status`, { status: 'cancelled' })).status).toBe(403)
    expect((await call('u3', 'POST', `/marketing/design-requests/${id}/comments`, { body: 'Hi' })).status).toBe(403)
  })

  it('@mentions reach only people who can see the request', async () => {
    const r = await ok('u4', 'POST', '/marketing/design-requests', { title: 'Logo refresh', type: 'logo', brief: 'x' })
    await ok('u4', 'POST', `/marketing/design-requests/${r.id}/comments`, { body: '@Karim Nasser and @Ahmed Al Falasi please look' })
    const mentioned = notesFor(r.id).filter((n) => n.title.includes('mentioned'))
    expect(mentioned.map((n) => n.userId)).toEqual(['u3']) // Ahmed (an agent) can't see it
  })
})

describe('storage and upload checks', () => {
  function nearLimit(co: Co) {
    const real = usedOf(co, 'storageMb')
    usageSimulation.push({ companyId: co, key: 'storageMb', offset: 51200 - 1 - real })
  }

  it('attachments and uploaded assets count against storageMb; a file that doesn’t fit is refused (402)', async () => {
    const before = usedOf(CREST, 'storageMb')
    const id = designRequests.find((r) => r.companyId === CREST)!.id
    await ok('u101', 'POST', `/marketing/design-requests/${id}/attachments`, { name: 'brief.pdf', mime_type: 'application/pdf', size_bytes: 3 * 1024 * 1024 })
    expect(usedOf(CREST, 'storageMb')).toBeCloseTo(before + 3, 1)
    nearLimit(CREST)
    const big = await call('u101', 'POST', `/marketing/design-requests/${id}/attachments`, { name: 'video.mp4', mime_type: 'video/mp4', size_bytes: 2 * 1024 * 1024 })
    expect(big.status).toBe(402)
    expect(big.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'storageMb' })
    const asset = await call('u101', 'POST', '/marketing/assets', { name: 'Clip', kind: 'video', mime_type: 'video/mp4', size_bytes: 2 * 1024 * 1024 })
    expect(asset.status).toBe(402)
    expect((await call('u101', 'POST', '/marketing/assets', { name: 'Small', kind: 'document', mime_type: 'application/pdf', size_bytes: 300 * 1024 })).status).toBe(200)
  })

  it('a design file saved to Brand assets is counted once', async () => {
    const r = designRequests.find((x) => x.id === 'DR-1003')!
    const asset = brandAssets.find((a) => a.id === 'BA-1004')!
    expect(asset.sourceAttachmentId).toBe(r.attachments[0].id)
    const before = usedOf(APEX, 'storageMb')
    asset.sourceAttachmentId = null
    expect(usedOf(APEX, 'storageMb')).toBeGreaterThan(before)
  })

  it('type, size and real content are checked (shared with the upload form)', async () => {
    expect(assetFileProblem('logo', { name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 })).toMatch(/Logo files must be one of: PNG, JPG/)
    expect(assetFileProblem('image', { name: 'a.png', mimeType: 'image/png', sizeBytes: 21 * 1024 * 1024 })).toMatch(/limit is 20 MB/)
    expect(attachmentProblem({ name: 'a.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 })).toMatch(/isn’t accepted/)
    const fake = `data:image/png;base64,${btoa('not a png at all')}`
    expect(checkPreview(fake, 'image/png', 16)).toMatchObject({ ok: false })
    const evil = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`
    expect(checkPreview(evil, 'image/svg+xml', new TextEncoder().encode(decodeURIComponent(evil.split(',')[1])).length)).toMatchObject({ ok: false })

    const bad = await call('u7', 'POST', '/marketing/assets', { name: 'Fake', kind: 'image', mime_type: 'image/png', size_bytes: 16, data_url: fake })
    expect(bad.status).toBe(422)
    expect(bad.body.message).toMatch(/content doesn’t match/)
    expect((await call('u7', 'POST', '/marketing/assets', { name: 'Wrong kind', kind: 'font', mime_type: 'image/png', size_bytes: 10 })).status).toBe(422)
    expect((await call('u7', 'POST', '/marketing/assets', { name: 'Size lie', kind: 'image', mime_type: 'image/png', size_bytes: 99, data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' })).status).toBe(422)
    const good = await ok('u7', 'POST', '/marketing/assets', { name: 'Pixel', kind: 'image', mime_type: 'image/png', size_bytes: 70, data_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', tags: ['Brand', 'brand', ' Web '] })
    expect(good.url).toMatch(/^data:image\/png;base64,/)
    expect(good.tags).toEqual(['brand', 'web'])
  })
})

describe('brand assets: system logos, delete', () => {
  it('the company’s branding logos are read-only system assets', async () => {
    const list = await ok('u7', 'GET', '/marketing/assets')
    const sys = list.find((a: { id: string }) => a.id === 'SYS-logo-light')
    expect(sys).toMatchObject({ system: true, source: 'system', kind: 'logo' })
    expect((await call('u7', 'PATCH', '/marketing/assets/SYS-logo-light', { name: 'x' })).status).toBe(409)
    expect((await call('u7', 'DELETE', '/marketing/assets/SYS-logo-light')).status).toBe(409)
    // Crest has no logo: no system asset, and the id answers 404.
    expect((await ok('u101', 'GET', '/marketing/assets')).some((a: { system: boolean }) => a.system)).toBe(false)
    expect((await call('u101', 'GET', '/marketing/assets/SYS-logo-light')).status).toBe(404)
  })

  it('deleting an asset unlinks it from content items', async () => {
    expect(contentItems.find((c) => c.id === 'CI-1001')!.assetIds).toContain('BA-1003')
    await ok('u7', 'DELETE', '/marketing/assets/BA-1003')
    expect(contentItems.find((c) => c.id === 'CI-1001')!.assetIds).not.toContain('BA-1003')
    expect((await call('u7', 'GET', '/marketing/assets/BA-1003')).status).toBe(404)
  })
})

describe('foreign ids in bodies behave like missing ones', () => {
  const crestCampaign = () => campaigns.find((c) => c.companyId === CREST)!.id
  const crestAsset = () => brandAssets.find((a) => a.companyId === CREST)!.id
  const crestContent = () => contentItems.find((c) => c.companyId === CREST)!.id
  const crestUser = () => users.find((u) => u.companyId === CREST && u.role === 'Management')!.id
  const cases: [string, string, (id: string) => Record<string, unknown>, () => string][] = [
    ['content campaign', '/marketing/content', (id) => ({ title: 'x', type: 'video', channels: ['youtube'], campaign_id: id }), crestCampaign],
    ['content owner', '/marketing/content', (id) => ({ title: 'x', type: 'video', channels: ['youtube'], owner_id: id }), crestUser],
    ['content reviewer', '/marketing/content', (id) => ({ title: 'x', type: 'video', channels: ['youtube'], reviewer_id: id }), crestUser],
    ['content assets', '/marketing/content', (id) => ({ title: 'x', type: 'video', channels: ['youtube'], asset_ids: [id] }), crestAsset],
    ['design assignee', '/marketing/design-requests', (id) => ({ title: 'x', type: 'logo', brief: 'y', assignee_id: id }), crestUser],
    ['design campaign', '/marketing/design-requests', (id) => ({ title: 'x', type: 'logo', brief: 'y', campaign_id: id }), crestCampaign],
    ['design content item', '/marketing/design-requests', (id) => ({ title: 'x', type: 'logo', brief: 'y', content_item_id: id }), crestContent],
    ['design assets', '/marketing/design-requests', (id) => ({ title: 'x', type: 'logo', brief: 'y', asset_ids: [id] }), crestAsset],
    ['asset campaign', '/marketing/assets', (id) => ({ name: 'x', kind: 'document', mime_type: 'application/pdf', size_bytes: 10, campaign_id: id }), crestCampaign],
  ]
  for (const [name, path, body, foreignId] of cases) {
    it(`Apex: ${name} with a Crest id`, async () => {
      const crest = takeSnapshotText(CREST)
      const foreign = await call('u1', 'POST', path, body(foreignId()))
      const missing = await call('u1', 'POST', path, body('zz-missing'))
      expect(foreign.status).toBe(422)
      expect(foreign.body).toEqual(missing.body)
      expect(takeSnapshotText(CREST)).toBe(crest)
    })
  }
})

describe('module gating', () => {
  it('a company without the marketing module gets 403 module_not_in_plan, even for design requests', async () => {
    const sub = subOf(CREST)
    sub.planId = 'starter'
    sub.planVersion = 1
    for (const [as, path] of [
      ['u104', '/marketing/design-requests'],
      ['u101', '/marketing/content'],
      ['u101', '/marketing/assets'],
    ] as const) {
      const r = await call(as, 'GET', path)
      expect(r.status, path).toBe(403)
      expect(r.body).toMatchObject({ code: 'module_not_in_plan', module: 'marketing' })
    }
    expect((await call('u4', 'GET', '/marketing/design-requests')).status).toBe(200)
  })
})
