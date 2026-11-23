import { leads, users } from '@/shared/mocks/db'
import { aiConversations, aiId } from '@/shared/mocks/data/ai'
import { nowIso } from '@/shared/mocks/clock'
import * as ai from '@/shared/mocks/services/ai'
import { ADMIN, type Co } from './harness'
import type { Endpoint } from './endpoints'

/**
 * Coverage-table entries of the AI assistant (handlers/ai.ts), spread into ENDPOINTS (endpoints.ts). Samples run as the
 * company admin and prepare their own conversation / pending proposal through the service (a fresh one per call, so the
 * spoofing re-runs stay valid). Conversations and proposals are the caller's own: any other id → 404 (also tested per
 * user in services/ai.test.ts and app/isolation/ai.isolation.test.ts).
 */

const M = 'ai'
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const admin = (co: Co) => users.find((u) => u.id === ADMIN[co])!

/** An open lead of the company (visible to the admin). */
export const aiLead = (co: Co) => leads.find((l) => l.companyId === co && !['Won', 'Lost', 'Not interested', 'Cold'].includes(l.status) && !l.doNotContact)!

/** A fresh conversation of the company admin. */
export async function aiConversation(co: Co): Promise<string> {
  return (await ai.createConversation(admin(co), { title: 'Isolation' })).id
}

/** The same, synchronously (REFS paths of scoped.isolation.test.ts). */
export function aiConversationNow(co: Co): string {
  const id = aiId('AIC')
  aiConversations.push({ companyId: co, id, userId: ADMIN[co], title: 'Isolation', focus: null, createdAt: nowIso(), updatedAt: nowIso() })
  return id
}

/** A fresh pending proposal of the company admin (a follow-up task on an own lead). */
export async function aiProposal(co: Co): Promise<string> {
  const conv = await aiConversation(co)
  const r = await ai.postMessage(admin(co), conv, { content: `Remind me tomorrow to call ${aiLead(co).id}` })
  const action = r.messages[1].actions[0]
  if (!action) throw new Error(`AI isolation: no proposal in ${co}: ${r.messages[1].content}`)
  return action.id
}

export const AI_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/ai/me', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'GET', path: '/ai/settings', kind: 'company-list', module: M, sample: () => ({}) },
  { method: 'PUT', path: '/ai/settings', kind: 'company-write', module: M, sample: () => ({ body: { tools: { get_kpis: true }, roles: { Employee: { enabled: true, write_tools: true } } } }) },
  { method: 'GET', path: '/ai/usage', kind: 'company-list', module: M, sample: () => ({}) },
  {
    method: 'GET', path: '/ai/conversations', kind: 'company-list', module: M,
    sample: async (co) => (await aiConversation(co), {}),
    count: { of: len, expected: (co) => aiConversations.filter((c) => c.companyId === co && c.userId === ADMIN[co]).length },
  },
  { method: 'POST', path: '/ai/conversations', kind: 'company-write', module: M, sample: () => ({ body: { title: 'Isolation chat' } }) },
  { method: 'GET', path: '/ai/conversations/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await aiConversation(co) } }) },
  { method: 'PATCH', path: '/ai/conversations/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await aiConversation(co) }, body: { title: 'Renamed' } }) },
  { method: 'DELETE', path: '/ai/conversations/:id', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await aiConversation(co) } }) },
  {
    method: 'POST', path: '/ai/conversations/:id/messages', kind: 'company-item', module: M,
    sample: async (co) => ({ params: { id: await aiConversation(co) }, body: { content: `Summarize ${aiLead(co).id}`, context: { type: 'lead', id: aiLead(co).id } } }),
  },
  { method: 'POST', path: '/ai/actions/:id/confirm', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await aiProposal(co) }, body: { input: { title: 'Call back' } } }) },
  { method: 'POST', path: '/ai/actions/:id/cancel', kind: 'company-item', module: M, sample: async (co) => ({ params: { id: await aiProposal(co) } }) },
]
