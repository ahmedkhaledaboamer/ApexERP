import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrLetterTypes } from '@/shared/mocks/data/hrSelfService'
import { hrDisciplinary, hrPolicies } from '@/shared/mocks/data/hrCompliance'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { ADMIN, adminToken, api, userToken, type Co } from './harness'
import { hrOn } from './hrPeopleEndpoints'
import type { Endpoint, Sample } from './endpoints'

/**
 * Coverage-table entries of HR gaps part A (spread into ENDPOINTS, endpoints.ts): HR › Discipline and Policies
 * (handlers/hrCompliance.ts), letter revocation and the PUBLIC letter verification (handlers/hrSelfService.ts).
 * Samples run as the company admin (hr full, and an employee too: EMP-u1 / EMP-u101) unless `as` names the employee.
 * Crest's plan (Business) has no `hr`: every sample first turns it on for both companies (hrOn).
 */

let seq = 0
const uniq = () => `${Date.now().toString(36)}${++seq}`
const s = (build: (co: Co) => Sample | Promise<Sample>) => async (co: Co): Promise<Sample> => {
  hrOn()
  return build(co)
}
const len = (b: unknown) => (Array.isArray(b) ? b.length : -1)
const count = <T extends { companyId: string }>(rows: readonly T[]) => ({ of: len, expected: (co: Co) => rows.filter((r) => r.companyId === co).length })
const today = (co: Co) => companyDayOf(co).today

/** An active staff employee with a login (not the admin). */
function staff(co: Co) {
  const e = hrEmployees.find((x) => x.companyId === co && !!x.userId && x.userId !== ADMIN[co] && x.status === 'active')
  if (!e) throw new Error(`Compliance isolation table: no staff employee in ${co}`)
  return e
}
const record = (co: Co) => {
  const r = hrDisciplinary.find((x) => x.companyId === co && !x.withdrawnAt)
  if (!r) throw new Error(`Compliance isolation table: no disciplinary record in ${co}`)
  return r
}
/** A record waiting for its employee's acknowledgement (seeded: Apex HDA-3 · Hassan, Crest HDA-101 · Huda). */
const pendingAck = (co: Co) => {
  const r = hrDisciplinary.find((x) => x.companyId === co && x.ackStatus === 'pending' && !x.withdrawnAt && !!hrEmployees.find((e) => e.id === x.employeeId)?.userId)
  if (!r) throw new Error(`Compliance isolation table: no record waiting for acknowledgement in ${co}`)
  return { id: r.id, userId: hrEmployees.find((e) => e.id === r.employeeId)!.userId! }
}
const published = (co: Co) => {
  const p = hrPolicies.find((x) => x.companyId === co && x.status === 'published' && x.audience.kind === 'all')
  if (!p) throw new Error(`Compliance isolation table: no published policy in ${co}`)
  return p
}
/** A policy with a draft to publish (created through the API when the company has none). */
async function draftPolicy(co: Co): Promise<string> {
  const d = hrPolicies.find((x) => x.companyId === co && !!x.draft && x.status !== 'archived')
  if (d) return d.id
  const r = await api(adminToken(co), 'POST', '/hr/policies', { body: { title: `Iso policy ${uniq()}`, category: 'other', body: 'Text.' } })
  if (r.status !== 200) throw new Error(`Compliance isolation table: policy for ${co} answered ${r.status}: ${r.text}`)
  return r.body.id as string
}
/** An issued letter of the company (requested by a staff employee, approved by the admin): its request id. */
async function issuedLetter(co: Co): Promise<{ id: string; code: string }> {
  const e = staff(co)
  const type = hrLetterTypes.find((t) => t.companyId === co && t.code === 'employment_certificate')!
  const r = await api(userToken(e.userId!), 'POST', '/hr/letters/requests', { body: { letter_type_id: type.id, addressee: 'Iso Bank', purpose: 'isolation' } })
  if (r.status !== 200) throw new Error(`Compliance isolation table: letter request for ${co} answered ${r.status}: ${r.text}`)
  const ok = await api(adminToken(co), 'POST', `/hr/letters/requests/${r.body.id}/approve`, { body: {} })
  if (ok.status !== 200) throw new Error(`Compliance isolation table: approve for ${co} answered ${ok.status}: ${ok.text}`)
  return { id: r.body.id as string, code: ok.body.letter.verification_code as string }
}

export const HR_COMPLIANCE_ENDPOINTS: Endpoint[] = [
  /* ---- letters: revoke + public verification ---- */
  { method: 'POST', path: '/hr/letters/requests/:id/revoke', kind: 'company-item', module: 'hr', sample: s(async (co) => ({ params: { id: (await issuedLetter(co)).id }, body: { reason: 'Isolation check' }, expect: [200, 409] })) },
  {
    method: 'GET', path: '/public/letters/verify', kind: 'public', module: 'hr',
    reason:
      'Public verification of an HR letter (no sign-in by design: the QR code printed on the letter). The company comes from the address the page is opened on (Host; X-Workspace / ?workspace= in the mock), never from the code: a code is looked up in that company only, so another company’s code, an unknown workspace or a company without HR answer the same 404. Answers only the company name / logo, letter type, reference, issue date, a masked employee name (first name + initial) and valid / revoked — no pay, no employee number; rate-limited per client (hrCompliance.isolation.test.ts).',
  },

  /* ---- discipline ---- */
  { method: 'GET', path: '/hr/discipline', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrDisciplinary) },
  {
    method: 'POST', path: '/hr/discipline', kind: 'company-write', module: 'hr',
    sample: s((co) => ({ body: { employee_id: staff(co).id, type: 'verbal_warning', category: 'conduct', incident_date: today(co), description: `Isolation ${uniq()}` } })),
  },
  { method: 'GET', path: '/hr/discipline/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: record(co).id } })) },
  { method: 'GET', path: '/hr/discipline/:id/letter', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: record(co).id }, query: { language: 'en' } })) },
  { method: 'POST', path: '/hr/discipline/:id/attachments', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: record(co).id }, body: { attachments: [{ name: 'iso.pdf', size_bytes: 2048, mime_type: 'application/pdf' }] }, expect: [200, 422] })) },
  { method: 'POST', path: '/hr/discipline/:id/withdraw', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: record(co).id }, body: { reason: 'Isolation check' }, expect: [200, 409] })) },
  {
    method: 'POST', path: '/hr/discipline/:id/acknowledge', kind: 'company-item', module: 'hr',
    sample: s((co) => {
      const p = pendingAck(co)
      return { params: { id: p.id }, as: p.userId, body: { comment: 'Seen' }, expect: [200, 409] }
    }),
    note: 'The employee of the record only (403 for anyone else, 404 outside their scope).',
  },

  /* ---- policies ---- */
  { method: 'GET', path: '/hr/policies', kind: 'company-list', module: 'hr', sample: s(() => ({})), count: count(hrPolicies) },
  { method: 'POST', path: '/hr/policies', kind: 'company-write', module: 'hr', sample: s(() => ({ body: { title: `Iso policy ${uniq()}`, category: 'other', body: 'Text.', audience: { kind: 'all' } } })) },
  { method: 'GET', path: '/hr/policies/my', kind: 'company-list', module: 'hr', sample: s(() => ({})), note: 'The caller’s own policies (audience), with their acknowledgement state.' },
  { method: 'GET', path: '/hr/policies/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: published(co).id } })) },
  { method: 'PATCH', path: '/hr/policies/:id', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: published(co).id }, body: { change_note: `Isolation ${uniq()}` } })) },
  { method: 'POST', path: '/hr/policies/:id/publish', kind: 'company-item', module: 'hr', sample: s(async (co) => ({ params: { id: await draftPolicy(co) }, body: {}, expect: [200, 409] })) },
  { method: 'POST', path: '/hr/policies/:id/archive', kind: 'company-item', module: 'hr', sample: s(async (co) => ({ params: { id: await draftPolicy(co) }, expect: [200, 409] })) },
  { method: 'GET', path: '/hr/policies/:id/status', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: published(co).id } })) },
  { method: 'GET', path: '/hr/policies/:id/export', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: published(co).id } })) },
  { method: 'POST', path: '/hr/policies/:id/acknowledge', kind: 'company-item', module: 'hr', sample: s((co) => ({ params: { id: published(co).id }, body: { version: published(co).version } })) },
]

/** Helpers for the targeted tests (role tests). */
export const complianceFixtures = { issuedLetter, staff }
