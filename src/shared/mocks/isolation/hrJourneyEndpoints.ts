import { addDays, format } from 'date-fns'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrJourneys, hrJourneyTemplates } from '@/shared/mocks/data/hrJourney'
import { adminToken, api, type Co } from './harness'
import { hrOn } from './hrPeopleEndpoints'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Onboarding & offboarding (handlers/hrJourney.ts), spread into ENDPOINTS
 * (endpoints.ts). Samples run as the company admin (hr full) on the seeded running onboarding of each company
 * (EMP-X3 / EMP-X103). `hr` is turned on for both companies first (Crest's plan has no HR: hrOn).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')

function journey(co: Co) {
  const j = hrJourneys.find((x) => x.companyId === co && x.status === 'active' && x.kind === 'onboarding')
  if (!j) throw new Error(`Journey isolation table: no running onboarding in ${co}`)
  return j
}
const openItem = (co: Co) => {
  const j = journey(co)
  const item = j.items.find((i) => i.status === 'open' && !i.system) ?? j.items.find((i) => !i.system)
  if (!item) throw new Error(`Journey isolation table: no item in ${co}`)
  return { id: j.id, itemId: item.id }
}
const template = (co: Co) => {
  const t = hrJourneyTemplates.find((x) => x.companyId === co)
  if (!t) throw new Error(`Journey isolation table: no template in ${co}`)
  return t
}
/** An active employee (with a login, not the admin) without a running onboarding. */
const staff = (co: Co) => {
  const e = hrEmployees.find((x) => x.companyId === co && x.status === 'active' && !!x.userId && !['u1', 'u101'].includes(x.userId) && !hrJourneys.some((j) => j.employeeId === x.id && j.status === 'active'))
  if (!e) throw new Error(`Journey isolation table: no employee in ${co}`)
  return e
}
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)

const s = (build: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  hrOn()
  return build(co)
}

const ITEM_BODY = { title: 'Iso item', owner_role: 'hr', due_date: day(5) }

export const HR_JOURNEY_ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/hr/journeys/my-tasks', kind: 'company-list', module: 'hr', sample: s(() => ({})), note: 'Any role (assignee inbox); also runs the journey reminder tick of the caller’s company only.' },
  { method: 'GET', path: '/hr/journeys/options', kind: 'company-search', module: 'hr', sample: s(() => ({})) },
  { method: 'GET', path: '/hr/journeys/templates', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: { of: len, expected: (co: Co) => hrJourneyTemplates.filter((t) => t.companyId === co).length } },
  {
    method: 'POST', path: '/hr/journeys/templates', kind: 'company-write', module: 'hr',
    sample: s(() => ({ body: { kind: 'onboarding', name: `Iso template ${uniq()}`, items: [{ title: 'Iso step', owner_role: 'hr', due_offset_days: 1 }] } })),
  },
  { method: 'GET', path: '/hr/journeys/templates/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: template(co).id } })) },
  { method: 'PATCH', path: '/hr/journeys/templates/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: template(co).id }, body: { description: 'Reviewed' } })) },
  {
    method: 'DELETE', path: '/hr/journeys/templates/:id', kind: 'company-item', module: 'hr',
    sample: s(async (co) => {
      const r = await api(adminToken(co), 'POST', '/hr/journeys/templates', { body: { kind: 'offboarding', name: `Iso delete ${uniq()}`, items: [{ title: 'Iso step', owner_role: 'hr', due_offset_days: 0 }] } })
      return { params: { id: r.body.id }, expect: [200, 404] }
    }),
  },
  { method: 'GET', path: '/hr/journeys', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: { of: len, expected: (co: Co) => hrJourneys.filter((j) => j.companyId === co).length } },
  { method: 'POST', path: '/hr/journeys', kind: 'company-write', module: 'hr', sample: s((co) => ({ body: { employee_id: staff(co).id, kind: 'onboarding' }, expect: [200, 409] })) },
  { method: 'GET', path: '/hr/journeys/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: journey(co).id } })) },
  { method: 'POST', path: '/hr/journeys/:id/activate', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: journey(co).id }, expect: [200, 409, 422] })) },
  { method: 'POST', path: '/hr/journeys/:id/cancel', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: journey(co).id }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/journeys/:id/items', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: journey(co).id }, body: ITEM_BODY })) },
  { method: 'PATCH', path: '/hr/journeys/:id/items/:itemId', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: openItem(co), body: { due_date: day(9) } })) },
  {
    method: 'DELETE', path: '/hr/journeys/:id/items/:itemId', kind: 'company-item', module: 'hr',
    sample: s(async (co) => {
      const r = await api(adminToken(co), 'POST', `/hr/journeys/${journey(co).id}/items`, { body: { ...ITEM_BODY, title: `Iso delete ${uniq()}` } })
      const added = (r.body.items as { id: string; title: string }[]).at(-1)!
      return { params: { id: journey(co).id, itemId: added.id }, expect: [200, 404] }
    }),
  },
  { method: 'POST', path: '/hr/journeys/:id/items/:itemId/complete', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: openItem(co), body: { note: 'Done' }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/journeys/:id/items/:itemId/reopen', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: openItem(co), expect: [200, 409] })) },
]
