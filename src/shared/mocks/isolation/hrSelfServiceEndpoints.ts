import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrPayrollRuns } from '@/shared/mocks/data/hrPayroll'
import { hrLetterRequests, hrLetterTypes, hrProfileChanges } from '@/shared/mocks/data/hrSelfService'
import { ADMIN, adminToken, api, userToken, type Co } from './harness'
import { hrOn } from './hrPeopleEndpoints'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR › Self-service and HR letters (handlers/hrSelfService.ts), spread into ENDPOINTS
 * (endpoints.ts). Samples run as the company admin (hr full, and an employee too: EMP-u1 / EMP-u101); the requests
 * they decide are filed by another employee of the same company (prepared through the API).
 *
 * Crest's plan (Business) has no `hr`: every sample first turns it on for both companies (hrOn), so the isolation
 * checks run on real answers in both directions.
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`

/** An active employee with a login (not the admin) and no pending profile change. */
function staff(co: Co) {
  const e = hrEmployees.find(
    (x) => x.companyId === co && !!x.userId && x.userId !== ADMIN[co] && x.status === 'active' && !hrProfileChanges.some((c) => c.employeeId === x.id && c.status === 'pending'),
  )
  if (!e) throw new Error(`Self-service isolation table: no staff employee in ${co}`)
  return e
}
const typeOf = (co: Co, code: string) => {
  const t = hrLetterTypes.find((x) => x.companyId === co && x.code === code)
  if (!t) throw new Error(`Self-service isolation table: no ${code} letter type in ${co}`)
  return t
}
const pendingLetter = (co: Co) => {
  const r = hrLetterRequests.find((x) => x.companyId === co && x.status === 'pending')
  if (!r) throw new Error(`Self-service isolation table: no pending letter request in ${co}`)
  return r
}
const pendingChange = (co: Co) => {
  const r = hrProfileChanges.find((x) => x.companyId === co && x.status === 'pending')
  if (!r) throw new Error(`Self-service isolation table: no pending profile change in ${co}`)
  return r
}
/** A paid payslip of the admin's own employee record. */
function ownPayslip(co: Co): string {
  const me = `EMP-${ADMIN[co]}`
  for (const r of hrPayrollRuns) if (r.companyId === co && r.status === 'paid') for (const l of r.lines) if (l.employeeId === me && l.paidDays > 0) return l.id
  throw new Error(`Self-service isolation table: no paid payslip of ${me}`)
}
const IBAN: Record<Co, string> = { co_apex: 'AE460260001015333439101', co_crest: 'SA4420000001234567891234' }

/** A pending bank account change filed by a staff employee (for the reveal). */
async function bankChange(co: Co): Promise<string> {
  const e = staff(co)
  const r = await api(userToken(e.userId!), 'POST', '/hr/profile-changes', { body: { bank: { bank_name: 'Iso Bank', account_name: e.fullName, iban: IBAN[co] } } })
  if (r.status !== 200) throw new Error(`Self-service isolation table: bank change for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id as string
}

/** An issued letter of the company (requested by a staff employee, approved by the admin): its verification code. */
async function issuedCode(co: Co): Promise<string> {
  const e = staff(co)
  const r = await api(userToken(e.userId!), 'POST', '/hr/letters/requests', { body: { letter_type_id: typeOf(co, 'employment_certificate').id, addressee: 'Iso Bank', purpose: 'isolation' } })
  if (r.status !== 200) throw new Error(`Self-service isolation table: letter request for ${co} answered ${r.status}: ${r.text}`)
  const ok = await api(adminToken(co), 'POST', `/hr/letters/requests/${r.body.id}/approve`, { body: {} })
  if (ok.status !== 200) throw new Error(`Self-service isolation table: approve for ${co} answered ${ok.status}: ${ok.text}`)
  return ok.body.letter.verification_code as string
}

const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const count = <T extends { companyId: string }>(rows: readonly T[]) => ({ of: len, expected: (co: Co) => rows.filter((r) => r.companyId === co).length })

const s = (build: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  hrOn()
  return build(co)
}

export const HR_SELF_SERVICE_ENDPOINTS: Endpoint[] = [
  /* ---- portal ---- */
  { method: 'GET', path: '/hr/me', kind: 'company-list', module: 'hr', sample: s(() => ({})), note: 'The caller’s own employee record only (any role with one; 403 no_employee_record otherwise).' },
  { method: 'GET', path: '/hr/me/payslips/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: ownPayslip(co) } })) },

  /* ---- profile change requests ---- */
  { method: 'GET', path: '/hr/profile-changes', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrProfileChanges) },
  { method: 'POST', path: '/hr/profile-changes', kind: 'company-write', module: 'hr', sample: s(() => ({ body: { mobile: `+971 50 ${String(Date.now()).slice(-3)} ${String(++seq).padStart(4, '0')}`, note: `iso ${uniq()}` }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/profile-changes/:id/approve', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingChange(co).id }, body: { comment: 'ok' }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/profile-changes/:id/reject', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingChange(co).id }, body: { reason: 'Isolation check' }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/profile-changes/:id/cancel', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingChange(co).id }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/profile-changes/:id/reveal', kind: 'company-item', module: 'hr', sample: s(async (co) => ({ params: { id: await bankChange(co) }, expect: [200, 422] })) },

  /* ---- HR inbox ---- */
  { method: 'GET', path: '/hr/self-service/inbox', kind: 'company-list', module: 'hr', sample: s(() => ({})) },

  /* ---- letters ---- */
  { method: 'GET', path: '/hr/letters/types', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrLetterTypes) },
  { method: 'PATCH', path: '/hr/letters/types/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: typeOf(co, 'noc').id }, body: { description: `Isolation ${uniq()}` } })) },
  { method: 'POST', path: '/hr/letters/types/:id/reset', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: typeOf(co, 'noc').id } })) },
  {
    method: 'GET', path: '/hr/letters/verify', kind: 'company-search', module: 'hr',
    sample: s(async (co) => ({ query: { code: await issuedCode(co) } })),
    note: 'Looks the code up in the caller’s company only: another company’s code answers valid: false, like an unknown one.',
  },
  { method: 'GET', path: '/hr/letters/requests', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrLetterRequests) },
  { method: 'POST', path: '/hr/letters/requests', kind: 'company-write', module: 'hr', sample: s((co) => ({ body: { letter_type_id: typeOf(co, 'employment_certificate').id, employee_id: staff(co).id, addressee: 'Iso Embassy', purpose: 'isolation' }, expect: [200, 409] })) },
  { method: 'GET', path: '/hr/letters/requests/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingLetter(co).id } })) },
  { method: 'POST', path: '/hr/letters/requests/:id/approve', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingLetter(co).id }, body: {}, expect: [200, 409, 422] })) },
  { method: 'POST', path: '/hr/letters/requests/:id/reject', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingLetter(co).id }, body: { reason: 'Isolation check' }, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/letters/requests/:id/cancel', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: pendingLetter(co).id }, expect: [200, 409] })) },
]
