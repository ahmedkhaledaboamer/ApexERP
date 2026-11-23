import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Role, User } from '@/shared/types'
import { can, PERMISSION_MATRIX, scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { activeMembershipOf, addMembership } from '@/shared/mocks/data/tenancy'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { tokenFor } from '@/shared/mocks/server'
import { resetClock } from '@/shared/mocks/clock'
import { visibleLeads } from '@/shared/mocks/services/leads'
import { isClosedStatus } from '@/shared/mocks/data/lookups'
import { callApi } from './helpers'
// Every store registered before the seed snapshot (restoreSnapshot needs the same store set).
import '@/shared/mocks/handlers'

/**
 * AI assistant — TABLE-DRIVEN FROM PERMISSION_MATRIX, every role × both companies, through the real handlers:
 *   the same question answers within the caller's own scope (sales own / team / full; hidden → refused);
 *   finance questions are refused without accounting access; HR questions show only what the hr scope allows;
 *   write proposals are refused when the role can't make the change (sales view / hidden), offered otherwise;
 *   conversations of another user → 404; the plan gate (`ai` off → 403 module_not_in_plan).
 */

const COMPANIES = ['co_apex', 'co_crest'] as const
type Co = (typeof COMPANIES)[number]
const ROLES = Object.keys(PERMISSION_MATRIX) as Role[]

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
const roleOf = (u: User) => activeMembershipOf(u.id)?.role ?? u.role

function ensureRoleUsers(): void {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      if (users.some((u) => u.companyId === co && u.active && roleOf(u) === role)) continue
      const slug = role.toLowerCase().replace(/[^a-z]+/g, '-')
      const user: User = { id: `u-ai-${co}-${slug}`, companyId: co, name: `Assistant ${role} ${co}`, email: `ai-${slug}@${co}.test`, role, title: role, managerId: null, mobile: '', departmentId: '', active: true, twoFactorEnabled: false, lastLoginAt: null, createdAt: new Date().toISOString() }
      users.push(user)
      addMembership(user.id, co, role)
    }
  }
}
beforeEach(() => {
  restoreSnapshot(seed)
  resetClock()
  ensureRoleUsers()
})
const userFor = (co: Co, role: Role) => users.find((x) => x.companyId === co && x.active && roleOf(x) === role)!
const call = (u: User, method: string, path: string, body?: unknown) => callApi(tokenFor(u), method, path, body)

/** Asks one question in a fresh conversation; returns the assistant's message (wire shape). */
async function ask(u: User, content: string, context?: { type: string; id: string }) {
  const c = await call(u, 'POST', '/ai/conversations', {})
  expect(c.status, JSON.stringify(c.body)).toBe(200)
  const r = await call(u, 'POST', `/ai/conversations/${c.body.id}/messages`, { content, ...(context ? { context } : {}) })
  expect(r.status, `${u.role}: ${content} → ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200)
  return r.body.messages[1] as {
    content: string
    blocks: { type: string; code?: string; title?: string; rows?: Record<string, string>[]; cards?: { type: string; id: string }[]; text?: string }[]
    tool_results: { name: string; status: string }[]
    actions: { id: string; tool: string; status: string }[]
  }
}
const cardIds = (m: Awaited<ReturnType<typeof ask>>, type: string) => m.blocks.flatMap((b) => b.cards ?? []).filter((c) => c.type === type).map((c) => c.id)

describe('AI assistant: the same questions per role (both companies)', () => {
  for (const co of COMPANIES) {
    for (const role of ROLES) {
      it(`${co} · ${role} (sales ${PERMISSION_MATRIX[role].sales}, accounting ${PERMISSION_MATRIX[role].accounting}, hr ${PERMISSION_MATRIX[role].hr})`, async () => {
        const u = userFor(co, role)
        const r = roleOf(u)
        const sales = scopeOf(r, 'sales')
        const visible = new Set(visibleLeads(u).map((l) => l.id))

        // 1. Follow-ups: only leads the user owns (or, for "team", may see).
        const fu = await ask(u, 'What should I follow up today?')
        expect(fu.tool_results[0]).toMatchObject({ name: 'get_my_follow_ups', status: 'ok' })
        for (const id of cardIds(fu, 'lead')) expect(visible.has(id), `${role}: ${id}`).toBe(true)

        // 2. Pipeline: refused without sales; own numbers for own / view scopes; by owner for team / full.
        const pipe = await ask(u, 'How is the team doing this month?')
        if (sales === 'hidden') {
          expect(pipe.tool_results[0].status).toBe('refused')
        } else {
          expect(pipe.tool_results[0].status).toBe('ok')
          const byOwner = pipe.blocks.find((b) => b.type === 'table' && b.title?.startsWith('By owner'))
          expect(!!byOwner, role).toBe(sales === 'team' || sales === 'full')
          if (byOwner) {
            const owners = new Set(visibleLeads(u).map((l) => users.find((x) => x.id === l.ownerId)?.name))
            for (const row of byOwner.rows ?? []) expect(owners.has(row.owner), `${role}: ${row.owner}`).toBe(true)
          }
        }

        // 3. Finance: refused without accounting access, a table otherwise.
        const fin = await ask(u, 'Which invoices are overdue?')
        if (scopeOf(r, 'accounting') === 'hidden') {
          expect(fin.tool_results[0].status, role).toBe('refused')
          expect(fin.content).toContain('You don’t have access to finance data')
          expect(fin.blocks.some((b) => b.type === 'table')).toBe(false)
        } else {
          expect(fin.tool_results[0].status, role).toBe('ok')
        }
        const kpi = await ask(u, 'What is our revenue this month?')
        expect(kpi.tool_results[0].status, role).toBe(scopeOf(r, 'accounting') === 'hidden' ? 'refused' : 'ok')

        // 4. HR: Crest's plan has no HR; in Apex, own / hidden hr scopes only ever see themselves.
        const hr = await ask(u, 'Who is on leave next week?')
        if (co === 'co_crest') expect(hr.tool_results[0].status).toBe('refused')
        else if (['own', 'hidden'].includes(scopeOf(r, 'hr'))) {
          const names = hr.blocks.flatMap((b) => (b.type === 'table' ? (b.rows ?? []).map((x) => x.name) : []))
          expect(names.every((n) => n === u.name), `${role}: ${names}`).toBe(true)
        }

        // 5. Writes: a stage move is proposed only when the role may change leads; never applied before confirm.
        const lead = visibleLeads(u).find((l) => !isClosedStatus(co, l.status) && !l.doNotContact && l.status !== 'Meeting')
        if (lead) {
          const move = await ask(u, `Move ${lead.id} to Meeting`)
          if (can(r, 'sales', 'edit')) {
            expect(move.actions, `${role}: ${move.content}`).toHaveLength(1)
            expect(move.actions[0]).toMatchObject({ tool: 'move_lead_stage', status: 'pending' })
            expect(visibleLeads(u).find((l) => l.id === lead.id)!.status).toBe(lead.status)
          } else {
            expect(move.actions, role).toHaveLength(0)
            expect(move.blocks.find((b) => b.type === 'refusal')?.code).toBe('forbidden')
          }
        } else {
          const move = await ask(u, 'Move L-1001 to Meeting')
          expect(move.actions).toHaveLength(0)
        }
        const task = await ask(u, 'Remind me tomorrow to send the weekly report')
        expect(task.actions.length, role).toBe(can(r, 'tasks', 'create') ? 1 : 0)
      })
    }
  }
})

describe('AI assistant: privacy and the plan gate', () => {
  for (const co of COMPANIES) {
    it(`${co}: another user's conversation and proposal → 404, not listed; the admin sees counts only`, async () => {
      const rep = userFor(co, 'Sales Agent')
      const admin = userFor(co, 'Company Admin')
      const lead = visibleLeads(rep).find((l) => !isClosedStatus(co, l.status) && !l.doNotContact)!
      const conv = await call(rep, 'POST', '/ai/conversations', {})
      const posted = await call(rep, 'POST', `/ai/conversations/${conv.body.id}/messages`, { content: `Remind me tomorrow to call ${lead.id}` })
      const action = posted.body.messages[1].actions[0]
      expect(action.status).toBe('pending')
      for (const [m, p] of [
        ['GET', `/ai/conversations/${conv.body.id}`],
        ['PATCH', `/ai/conversations/${conv.body.id}`],
        ['DELETE', `/ai/conversations/${conv.body.id}`],
        ['POST', `/ai/conversations/${conv.body.id}/messages`],
        ['POST', `/ai/actions/${action.id}/confirm`],
        ['POST', `/ai/actions/${action.id}/cancel`],
      ] as const) {
        const r = await call(admin, m, p, { title: 'x', content: 'hi' })
        expect(r.status, `${m} ${p}`).toBe(404)
      }
      expect((await call(admin, 'GET', '/ai/conversations')).body.map((c: { id: string }) => c.id)).not.toContain(conv.body.id)
      const usage = await call(admin, 'GET', '/ai/usage')
      expect(usage.status).toBe(200)
      expect(usage.body.by_user.find((x: { user_id: string }) => x.user_id === rep.id).requests).toBe(1)
      expect(JSON.stringify(usage.body)).not.toContain(lead.id)
      expect((await call(rep, 'GET', '/ai/usage')).status).toBe(403)
      // The owner confirms: the task is created as them.
      const ok = await call(rep, 'POST', `/ai/actions/${action.id}/confirm`, {})
      expect(ok.body.action.status).toBe('confirmed')
    })
  }

  it('without the ai module every /ai endpoint answers 403 module_not_in_plan', async () => {
    moduleOverrides.push({ companyId: 'co_crest', module: 'ai', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const rep = userFor('co_crest', 'Sales Agent')
    for (const [m, p] of [
      ['GET', '/ai/me'],
      ['GET', '/ai/conversations'],
      ['POST', '/ai/conversations'],
    ] as const) {
      const r = await call(rep, m, p, {})
      expect(r.status, p).toBe(403)
      expect(r.body.code, p).toBe('module_not_in_plan')
    }
    expect((await call(userFor('co_apex', 'Sales Agent'), 'GET', '/ai/me')).status).toBe(200)
  })

  it('the assistant turned off for a role → 403 ai_disabled for that role only', async () => {
    const admin = userFor('co_apex', 'Company Admin')
    const put = await call(admin, 'PUT', '/ai/settings', { roles: { 'Sales Agent': { enabled: false } } })
    expect(put.status).toBe(200)
    expect(put.body.roles['Sales Agent']).toMatchObject({ enabled: false, write_tools: true })
    const rep = userFor('co_apex', 'Sales Agent')
    const conv = await call(rep, 'POST', '/ai/conversations', {})
    expect(conv.status).toBe(403)
    expect(conv.body.code).toBe('ai_disabled')
    expect((await call(rep, 'GET', '/ai/me')).body.enabled).toBe(false)
    expect((await call(userFor('co_apex', 'Sales Manager'), 'POST', '/ai/conversations', {})).status).toBe(200)
    // Crest's settings are its own.
    expect((await call(userFor('co_crest', 'Sales Agent'), 'POST', '/ai/conversations', {})).status).toBe(200)
  })
})
