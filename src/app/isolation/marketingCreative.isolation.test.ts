import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, Scope, User } from '@/shared/types'
import { PERMISSION_MATRIX, can, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { brandAssets, contentItems, designRequests } from '@/shared/mocks/data/marketingCreative'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { callApi } from './helpers'

/**
 * Marketing creative per role, TABLE-DRIVEN FROM PERMISSION_MATRIX (Marketing column), for every
 * role in both companies, through the real MSW handlers:
 *  - content calendar and brand assets: hidden → 403; view → reads 200, writes 403; full → 200;
 *  - design requests: EVERY active user creates a request and sees / comments on / cancels their
 *    own; the assignee sees and works what is assigned to them; marketing view roles see every
 *    request read-only (writes 403); marketing full roles see and manage all (assign, status);
 *    anyone else gets 404 for a request that isn't theirs (exactly like a missing id);
 *  - another company's content / request / asset is 404 for every role that may reach the endpoint.
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const HANDLED: readonly Scope[] = ['full', 'view', 'hidden']

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role
const ADMIN: Record<Co, string> = { co_apex: 'u1', co_crest: 'u101' }

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    const dept = departments.find((d) => d.companyId === co && d.parentId === null)
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = {
        id: `u-cre-${co}-${slug}`,
        companyId: co,
        name: `Creative ${role} ${co}`,
        email: `cre-${slug}@${co}.test`,
        role,
        title: role,
        managerId: null,
        mobile: '',
        departmentId: dept?.id ?? '',
        active: true,
        twoFactorEnabled: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}

beforeEach(() => {
  restoreSnapshot(seed)
  ensureRoleUsers()
})

const userFor = (co: Co, role: Role) => {
  const u = users.find((x) => x.companyId === co && x.active && roleOf(x) === role)
  if (!u) throw new Error(`No ${role} in ${co}`)
  return u
}
const other = (co: Co): Co => (co === 'co_apex' ? 'co_crest' : 'co_apex')
const contentOf = (co: Co) => contentItems.find((c) => c.companyId === co)!.id
const assetOf = (co: Co) => brandAssets.find((a) => a.companyId === co)!.id
/** A seed request of the company that this user neither asked for nor is assigned to. */
const strangersRequest = (co: Co, uid: string) => designRequests.find((r) => r.companyId === co && r.requesterId !== uid && r.assigneeId !== uid && r.status !== 'delivered' && r.status !== 'cancelled')!.id
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

describe('Marketing creative per role, derived from PERMISSION_MATRIX (both companies)', () => {
  it('the matrix only uses marketing scopes this suite handles', () => {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) expect(HANDLED, role).toContain(scopeOf(role, 'marketing'))
  })

  for (const co of COMPANIES) {
    for (const role of Object.keys(PERMISSION_MATRIX) as Role[]) {
      it(`${co} · ${role}`, async () => {
        const u = userFor(co, role)
        const token = tokenFor(u)
        const where = `${u.id} (${role}, marketing=${scopeOf(role, 'marketing')})`
        const view = can(role, 'marketing', 'view')
        const edit = can(role, 'marketing', 'edit')
        const read = view ? 200 : 403
        const write = edit ? 200 : 403

        /* Content calendar + brand assets: the Marketing column. */
        for (const path of ['/marketing/content', `/marketing/content/${contentOf(co)}`, '/marketing/assets', `/marketing/assets/${assetOf(co)}`]) {
          expect((await callApi(token, 'GET', path)).status, `${where} GET ${path}`).toBe(read)
        }
        const content = await callApi(token, 'POST', '/marketing/content', { title: `Role probe ${role}`, type: 'social_post', channels: ['linkedin'] })
        expect(content.status, `${where} create content`).toBe(write)
        expect((await callApi(token, 'PATCH', `/marketing/content/${contentOf(co)}`, { notes: 'probe' })).status, `${where} patch content`).toBe(write)
        expect((await callApi(token, 'POST', `/marketing/content/${contentOf(co)}/comments`, { body: 'probe' })).status, `${where} comment content`).toBe(write)
        const asset = await callApi(token, 'POST', '/marketing/assets', { name: `Probe ${role}`, kind: 'document', mime_type: 'application/pdf', size_bytes: 1000 })
        expect(asset.status, `${where} upload asset`).toBe(write)
        expect((await callApi(token, 'PATCH', `/marketing/assets/${assetOf(co)}`, { tags: ['probe'] })).status, `${where} patch asset`).toBe(write)

        /* Design requests: everyone requests; visibility per requester / assignee / Marketing column. */
        const mine = await callApi(token, 'POST', '/marketing/design-requests', { title: `Probe ${role}`, type: 'banner', brief: 'Probe brief', due_date: day(9) })
        expect(mine.status, `${where} create request`).toBe(200)
        expect(mine.body.can_manage, where).toBe(edit)
        expect((await callApi(token, 'POST', `/marketing/design-requests/${mine.body.id}/comments`, { body: 'mine' })).status, `${where} comment own`).toBe(200)
        expect((await callApi(token, 'POST', `/marketing/design-requests/${mine.body.id}/attachments`, { name: 'ref.pdf', mime_type: 'application/pdf', size_bytes: 1000 })).status, `${where} attach own`).toBe(200)

        const list = await callApi(token, 'GET', '/marketing/design-requests')
        expect(list.status, where).toBe(200)
        const ids = (list.body as { id: string; requester_id: string; assignee_id: string | null }[])
        if (view) expect(ids.length, `${where} sees every request`).toBe(designRequests.filter((r) => r.companyId === co).length)
        else expect(ids.every((r) => r.requester_id === u.id || r.assignee_id === u.id), `${where} sees only own / assigned`).toBe(true)

        const theirs = strangersRequest(co, u.id)
        expect((await callApi(token, 'GET', `/marketing/design-requests/${theirs}`)).status, `${where} GET someone else's request`).toBe(view ? 200 : 404)
        expect((await callApi(token, 'PATCH', `/marketing/design-requests/${theirs}`, { priority: 'urgent' })).status, `${where} PATCH someone else's`).toBe(edit ? 200 : view ? 403 : 404)
        expect((await callApi(token, 'POST', `/marketing/design-requests/${theirs}/comments`, { body: 'x' })).status, `${where} comment someone else's`).toBe(edit ? 200 : view ? 403 : 404)
        // Assigning is marketing-full only.
        expect((await callApi(token, 'PATCH', `/marketing/design-requests/${mine.body.id}`, { assignee_id: ADMIN[co] })).status, `${where} assign`).toBe(edit ? 200 : 403)

        // As an assignee: the admin assigns them a fresh request; they see it and start work.
        const admin = tokenFor(users.find((x) => x.id === ADMIN[co])!)
        const assigned = await callApi(admin, 'POST', '/marketing/design-requests', { title: `For ${role}`, type: 'logo', brief: 'Assigned probe', assignee_id: u.id })
        expect(assigned.status, where).toBe(200)
        expect((await callApi(token, 'GET', `/marketing/design-requests/${assigned.body.id}`)).status, `${where} sees assigned`).toBe(200)
        expect((await callApi(token, 'POST', `/marketing/design-requests/${assigned.body.id}/status`, { status: 'in_progress' })).status, `${where} starts assigned`).toBe(200)

        // The requester may cancel their own request.
        expect((await callApi(token, 'POST', `/marketing/design-requests/${mine.body.id}/status`, { status: 'cancelled' })).status, `${where} cancel own`).toBe(200)

        /* Another company's rows: 404 for anyone who reaches the endpoint (403 first for hidden on content/assets). */
        const them = other(co)
        expect((await callApi(token, 'GET', `/marketing/content/${contentOf(them)}`)).status, `${where} foreign content`).toBe(view ? 404 : 403)
        expect((await callApi(token, 'GET', `/marketing/assets/${assetOf(them)}`)).status, `${where} foreign asset`).toBe(view ? 404 : 403)
        expect((await callApi(token, 'GET', `/marketing/design-requests/${designRequests.find((r) => r.companyId === them)!.id}`)).status, `${where} foreign request`).toBe(404)
      })
    }
  }
})
