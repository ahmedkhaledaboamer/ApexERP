import { addDays, format } from 'date-fns'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrAssets, hrContracts, hrDocuments } from '@/shared/mocks/data/hrPeople'
import { adminToken, api, type Co } from './harness'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Employees, Employee contracts and Company assets (handlers/hrPeople.ts),
 * spread into ENDPOINTS (endpoints.ts). Samples run as the company admin (hr full).
 *
 * Crest's plan (Business) has no `hr` module, so every sample first turns `hr` on for BOTH companies with a
 * platform module override (hrOn), before the suite snapshots the other company: the isolation checks then
 * run on real answers in both directions instead of a 403 module_not_in_plan.
 */

export function hrOn(): void {
  for (const co of ['co_apex', 'co_crest']) {
    if (!moduleOverrides.some((o) => o.companyId === co && o.module === 'hr' && o.enabled)) {
      moduleOverrides.push({ companyId: co, module: 'hr', enabled: true, reason: 'isolation suite', by: 'p1', at: new Date().toISOString() })
    }
  }
}

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')

function one<T extends { companyId: string }>(rows: readonly T[], co: Co, what: string, pred: (r: T) => boolean = () => true): T {
  const r = rows.find((x) => x.companyId === co && pred(x))
  if (!r) throw new Error(`HR isolation table: no ${what} in ${co}`)
  return r
}
const noLogin = (co: Co) => one(hrEmployees, co, 'employee without a login', (e) => !e.userId)
const staff = (co: Co) => one(hrEmployees, co, 'employee with a login', (e) => !!e.userId && e.status === 'active' && !['u1', 'u101'].includes(e.userId))
const activeContract = (co: Co) => one(hrContracts, co, 'active contract', (c) => c.status === 'active')
const document = (co: Co) => one(hrDocuments, co, 'document')
const assetIn = (co: Co, status: string) => one(hrAssets, co, `${status} asset`, (a) => a.status === status)
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const count = <T extends { companyId: string }>(rows: readonly T[]) => ({ of: len, expected: (co: Co) => rows.filter((r) => r.companyId === co).length })

/** Every sample: HR on for both companies, then the request. */
const s = (build: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  hrOn()
  return build(co)
}

export const HR_PEOPLE_ENDPOINTS: Endpoint[] = [
  /* ---- employees ---- */
  { method: 'GET', path: '/hr/employees', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrEmployees), note: 'Also runs the HR reminder tick of the caller’s company only.' },
  { method: 'GET', path: '/hr/employees/export', kind: 'company-export', module: 'hr', sample: s(() => ({})), count: count(hrEmployees) },
  { method: 'POST', path: '/hr/employees', kind: 'company-write', module: 'hr', sample: s((co) => ({ body: { full_name: `Iso Hire ${uniq()}`, job_title: 'Analyst', hire_date: day(0), nationality: co === 'co_apex' ? 'AE' : 'SA' } })) },
  { method: 'GET', path: '/hr/users/unlinked', kind: 'company-search', module: 'hr', sample: s(() => ({})) },
  { method: 'GET', path: '/hr/employees/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: staff(co).id } })) },
  { method: 'PATCH', path: '/hr/employees/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: staff(co).id }, body: { job_title: 'Updated title', emergency_contact: { name: 'Iso Contact' } } })) },
  { method: 'POST', path: '/hr/employees/:id/reveal', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: staff(co).id }, body: { field: 'iban' } })) },
  { method: 'POST', path: '/hr/employees/:id/link-user', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: noLogin(co).id }, body: { user_id: null } })) },
  {
    method: 'POST', path: '/hr/employees/:id/offboarding/complete', kind: 'company-item', module: 'hr',
    // Valid call on an employee who isn't leaving: 422 (start the offboarding first).
    sample: s((co) => ({ params: { id: staff(co).id }, expect: [200, 422] })),
  },
  { method: 'POST', path: '/hr/employees/:id/documents', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: staff(co).id }, body: { type: 'work_permit', number: 'WP-ISO-7781', expiry_date: day(400) } })) },
  { method: 'PATCH', path: '/hr/documents/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: document(co).id }, body: { notes: 'Checked' } })) },
  {
    method: 'DELETE', path: '/hr/documents/:id', kind: 'company-item', module: 'hr',
    sample: s(async (co) => {
      const r = await api(adminToken(co), 'POST', `/hr/employees/${staff(co).id}/documents`, { body: { type: 'other', number: `DEL-${uniq()}` } })
      return { params: { id: r.body.id }, expect: [200, 404] }
    }),
  },
  { method: 'POST', path: '/hr/documents/:id/reveal', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: document(co).id } })) },

  /* ---- contracts ---- */
  { method: 'GET', path: '/hr/contracts', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrContracts) },
  { method: 'POST', path: '/hr/contracts', kind: 'company-write', module: 'hr', sample: s((co) => ({ body: { employee_id: staff(co).id, type: 'unlimited', start_date: day(30) } })) },
  { method: 'GET', path: '/hr/contracts/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: activeContract(co).id } })) },
  { method: 'PATCH', path: '/hr/contracts/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: activeContract(co).id }, body: { notes: 'Reviewed' } })) },
  { method: 'POST', path: '/hr/contracts/:id/renew', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: activeContract(co).id }, body: {}, expect: [200, 422] })) },

  /* ---- assets ---- */
  { method: 'GET', path: '/hr/assets', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrAssets) },
  { method: 'POST', path: '/hr/assets', kind: 'company-write', module: 'hr', sample: s(() => ({ body: { tag: `ISO-${uniq()}`, name: 'Iso laptop', category: 'laptop' } })) },
  { method: 'GET', path: '/hr/assets/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: assetIn(co, 'assigned').id } })) },
  { method: 'PATCH', path: '/hr/assets/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: assetIn(co, 'in_stock').id }, body: { notes: 'Shelf B' } })) },
  { method: 'POST', path: '/hr/assets/:id/assign', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: assetIn(co, 'in_stock').id }, body: { employee_id: staff(co).id, date: day(0), condition: 'good' }, expect: [200, 422] })) },
  { method: 'POST', path: '/hr/assets/:id/return', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: assetIn(co, 'assigned').id }, body: { date: day(0), condition: 'good' }, expect: [200, 422] })) },
  { method: 'POST', path: '/hr/assets/:id/lost', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: assetIn(co, 'assigned').id }, body: { note: 'Lost in transit' }, expect: [200, 422] })) },
]
