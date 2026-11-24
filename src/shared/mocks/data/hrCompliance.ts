import type { DisciplinaryAttachment, DisciplinaryCategory, DisciplinaryType, PolicyAudience, PolicyCategory, PolicyDraft, PolicyStatus, PolicyVersion, AckStatus } from '@/modules/hr/compliance/types'
import { expiryDate } from '@/modules/hr/compliance/rules'
import type { Tenant } from '@/shared/mocks/tenant'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'

/**
 * HR › Discipline and Policies: the stores behind services/hrCompliance.ts (docs/API.md › HR › Discipline, Policies).
 *
 *   hr.disciplinary    warnings and disciplinary actions per employee: type, category, incident, description, attachments
 *                      (mock uploads, counted in the plan's storage), expiry, the employee's acknowledgement / appeal,
 *                      a payroll deduction's adjustment id (sourceRef `discipline:<id>`), withdrawal
 *   hr.policies        company policies with their published versions (text and / or a PDF), the draft of the next
 *                      version, the audience (all / departments / roles) and the once-only reminder marks
 *                      (`<employeeId>:v<version>:d<0|3|7>`; `*:` = every employee, used by the seed)
 *   hr.policyAcks      one row per employee and policy VERSION acknowledged (a new version needs a new one)
 *   hr.complianceSeq   per-company yearly case numbers (`<companyId>:<year>` → last number)
 *
 * Synthetic data; ids are unique across companies (HDA-1…, HDA-101…, HPOL-…, HPA-…).
 */

export interface DisciplinaryRecord {
  id: string
  caseNo: string
  employeeId: string
  type: DisciplinaryType
  category: DisciplinaryCategory
  incidentDate: string
  description: string
  descriptionAr: string
  /** Company day it was issued. */
  issueDate: string
  expiryMonths: number
  expiresOn: string | null
  suspensionDays: number | null
  suspensionStart: string | null
  deductionAmount: number | null
  deductionMonth: string | null
  currency: string | null
  /** hr.payAdjustments id of the deduction (null when none / removed on withdrawal). */
  adjustmentId: string | null
  attachments: DisciplinaryAttachment[]
  issuedBy: string | null
  issuedByName: string
  issuedByTitle: string
  ackStatus: AckStatus
  ackAt: string | null
  employeeComment: string
  withdrawnAt: string | null
  withdrawnBy: string | null
  withdrawnByName: string | null
  withdrawReason: string
  notified: string[]
  createdAt: string
  updatedAt: string
}

export interface PolicyVersionRecord extends PolicyVersion {
  publishedBy: string | null
}

export interface PolicyRecord {
  id: string
  title: string
  category: PolicyCategory
  status: PolicyStatus
  /** Current published version (0 = never published). */
  version: number
  versions: PolicyVersionRecord[]
  draft: PolicyDraft | null
  audience: PolicyAudience
  reminderMarks: string[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface PolicyAckRecord {
  id: string
  policyId: string
  version: number
  employeeId: string
  userId: string
  at: string
}

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const iso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function dis(
  co: string,
  id: string,
  caseNo: string,
  employeeId: string,
  type: DisciplinaryType,
  category: DisciplinaryCategory,
  daysAgo: number,
  months: number,
  description: string,
  extra: Partial<DisciplinaryRecord> = {},
): Tenant<DisciplinaryRecord> {
  const issueDate = day(daysAgo)
  const by = co === APEX_ID ? { issuedBy: 'u9', issuedByName: 'Mariam Saeed', issuedByTitle: 'HR Manager' } : { issuedBy: 'u101', issuedByName: 'Faisal Al Harbi', issuedByTitle: 'IT Manager' }
  return {
    companyId: co,
    id,
    caseNo,
    employeeId,
    type,
    category,
    incidentDate: day(daysAgo + 2),
    description,
    descriptionAr: '',
    issueDate,
    expiryMonths: months,
    expiresOn: expiryDate(issueDate, months),
    suspensionDays: null,
    suspensionStart: null,
    deductionAmount: null,
    deductionMonth: null,
    currency: null,
    adjustmentId: null,
    attachments: [],
    ...by,
    ackStatus: 'pending',
    ackAt: null,
    employeeComment: '',
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnByName: null,
    withdrawReason: '',
    // Seeded records count as already announced (no notification burst on first load).
    notified: ['issued'],
    createdAt: iso(daysAgo),
    updatedAt: iso(daysAgo),
    ...extra,
  }
}

const year = (n: number) => day(n).slice(0, 4)

function seedDisciplinary(): Tenant<DisciplinaryRecord>[] {
  return [
    // Apex: Yusuf (EMP-u14, reports to the Delivery head u10) has a lapsed verbal and an active written warning (acknowledged).
    dis(APEX_ID, 'HDA-1', `APX-DA-${year(300)}-0001`, 'EMP-u14', 'verbal_warning', 'attendance', 300, 6, 'Late arrival on four days in one month without notice.', {
      ackStatus: 'acknowledged', ackAt: iso(299),
    }),
    dis(APEX_ID, 'HDA-2', `APX-DA-${year(40)}-0002`, 'EMP-u14', 'written_warning', 'attendance', 40, 12, 'Absent without approved leave on two working days; the manager was not informed.', {
      ackStatus: 'acknowledged', ackAt: iso(38), employeeComment: 'Family emergency; I will inform my manager next time.',
      attachments: [{ id: 'HDAF-1', name: 'attendance-extract.pdf', sizeBytes: 48_000, mimeType: 'application/pdf', url: null }],
    }),
    // Apex: Hassan (EMP-u12, reports to u10) — a verbal warning waiting for his acknowledgement.
    dis(APEX_ID, 'HDA-3', `APX-DA-${year(6)}-0003`, 'EMP-u12', 'verbal_warning', 'conduct', 6, 6, 'Raised voice at a colleague during the partner review meeting.'),
    // Crest: Huda (EMP-u107, reports to the Operations head u106) — a written warning waiting for acknowledgement.
    dis(CREST_ID, 'HDA-101', `CRS-DA-${year(5)}-0001`, 'EMP-u107', 'written_warning', 'performance', 5, 12, 'Shipment documents filed late three times in October, delaying customs clearance.', {
      descriptionAr: 'تأخر تقديم مستندات الشحن ثلاث مرات خلال شهر أكتوبر، مما أدى إلى تأخير التخليص الجمركي.',
    }),
    // Crest: Tariq (EMP-u105, Sales) — an acknowledged verbal warning.
    dis(CREST_ID, 'HDA-102', `CRS-DA-${year(60)}-0002`, 'EMP-u105', 'verbal_warning', 'policy_breach', 60, 6, 'Shared a customer price list outside the company without approval.', {
      ackStatus: 'acknowledged', ackAt: iso(59),
    }),
  ]
}

const ALL: PolicyAudience = { kind: 'all', departmentIds: [], roles: [] }

function version(v: number, daysAgo: number, body: string, by: string, byName: string, changeNote = ''): PolicyVersionRecord {
  return { version: v, body, file: null, effectiveDate: day(daysAgo), changeNote, publishedAt: iso(daysAgo), publishedBy: by, publishedByName: byName }
}

const CONDUCT_V1 = [
  '# Our standards',
  'Everyone at the company treats colleagues, customers and partners with respect.',
  '- Be honest and transparent in all business dealings.',
  '- No harassment, bullying or discrimination of any kind.',
  '- Protect company information and customer data.',
  '# Reporting',
  'Report concerns to your manager or HR. **Retaliation against anyone who reports in good faith is not tolerated.**',
].join('\n')
const CONDUCT_V2 = `${CONDUCT_V1}\n# Gifts and hospitality\n- Declare any gift worth more than 250 in the local currency to HR within five working days.`

function seedPolicies(): Tenant<PolicyRecord>[] {
  const apex = { by: 'u9', name: 'Mariam Saeed' }
  const crest = { by: 'u101', name: 'Faisal Al Harbi' }
  return [
    {
      companyId: APEX_ID, id: 'HPOL-1', title: 'Code of conduct', category: 'code_of_conduct', status: 'published', version: 2,
      versions: [version(1, 300, CONDUCT_V1, apex.by, apex.name), version(2, 20, CONDUCT_V2, apex.by, apex.name, 'Added the gifts and hospitality rule.')],
      draft: null, audience: ALL, reminderMarks: ['*:v1:d0', '*:v1:d3', '*:v1:d7', '*:v2:d0', '*:v2:d3', '*:v2:d7'],
      createdBy: apex.by, createdAt: iso(300), updatedAt: iso(20),
    },
    {
      companyId: APEX_ID, id: 'HPOL-2', title: 'IT acceptable use', category: 'it_security', status: 'published', version: 1,
      versions: [version(1, 90, '# Devices and accounts\n- Lock your screen when you leave your desk.\n- Never share passwords; use the company password manager.\n- Report lost devices to IT the same day.', apex.by, apex.name)],
      draft: null, audience: { kind: 'departments', departmentIds: ['d-delivery', 'd-it'], roles: [] }, reminderMarks: ['*:v1:d0', '*:v1:d3', '*:v1:d7'],
      createdBy: apex.by, createdAt: iso(90), updatedAt: iso(90),
    },
    {
      companyId: APEX_ID, id: 'HPOL-3', title: 'Travel and expenses', category: 'expenses', status: 'draft', version: 0, versions: [],
      draft: { body: '# Booking travel\n- Economy class for flights under 6 hours.\n- Submit expense claims within 30 days with receipts.', file: null, effectiveDate: day(-14), changeNote: '' },
      audience: ALL, reminderMarks: [], createdBy: apex.by, createdAt: iso(3), updatedAt: iso(3),
    },
    {
      companyId: CREST_ID, id: 'HPOL-101', title: 'Code of conduct', category: 'code_of_conduct', status: 'published', version: 1,
      versions: [version(1, 120, '# Standards of conduct\n- Respect colleagues and customers.\n- Follow the Saudi Labour Law and company rules.\n- Keep customer shipment data confidential.', crest.by, crest.name)],
      draft: null, audience: ALL, reminderMarks: ['*:v1:d0', '*:v1:d3', '*:v1:d7'], createdBy: crest.by, createdAt: iso(120), updatedAt: iso(120),
    },
    {
      companyId: CREST_ID, id: 'HPOL-102', title: 'Warehouse safety', category: 'health_safety', status: 'published', version: 1,
      versions: [version(1, 30, '# Warehouse floor\n- Safety shoes and high-visibility vests at all times.\n- Only certified staff drive forklifts.\n- Report every incident and near miss the same day.', crest.by, crest.name)],
      draft: null, audience: { kind: 'departments', departmentIds: ['c2-ops'], roles: [] }, reminderMarks: ['*:v1:d0', '*:v1:d3', '*:v1:d7'],
      createdBy: crest.by, createdAt: iso(30), updatedAt: iso(30),
    },
  ]
}

function ack(co: string, id: string, policyId: string, v: number, userId: string, daysAgo: number): Tenant<PolicyAckRecord> {
  return { companyId: co, id, policyId, version: v, employeeId: `EMP-${userId}`, userId, at: iso(daysAgo) }
}

function seedAcks(): Tenant<PolicyAckRecord>[] {
  return [
    // Apex code of conduct: several acknowledged v1 long ago; v2 (20 days ago) re-acknowledged by some only.
    ...['u1', 'u2', 'u3', 'u4', 'u9', 'u10', 'u11', 'u14'].map((u, i) => ack(APEX_ID, `HPA-${i + 1}`, 'HPOL-1', 1, u, 290 - i)),
    ...['u1', 'u2', 'u9', 'u10'].map((u, i) => ack(APEX_ID, `HPA-${20 + i}`, 'HPOL-1', 2, u, 18 - i)),
    ...['u1', 'u10', 'u11'].map((u, i) => ack(APEX_ID, `HPA-${30 + i}`, 'HPOL-2', 1, u, 80 - i)),
    ...['u101', 'u102', 'u106'].map((u, i) => ack(CREST_ID, `HPA-${101 + i}`, 'HPOL-101', 1, u, 110 - i)),
    ack(CREST_ID, 'HPA-120', 'HPOL-102', 1, 'u106', 25),
  ]
}

export const hrDisciplinary = registerArray<Tenant<DisciplinaryRecord>>('hr.disciplinary', seedDisciplinary())
export const hrPolicies = registerArray<Tenant<PolicyRecord>>('hr.policies', seedPolicies())
export const hrPolicyAcks = registerArray<Tenant<PolicyAckRecord>>('hr.policyAcks', seedAcks())
/** `<companyId>:<year>` → the last disciplinary case number used. */
export const hrComplianceSeq = registerObject<Record<string, number>>('hr.complianceSeq', { [`${APEX_ID}:${year(6)}`]: 3, [`${CREST_ID}:${year(5)}`]: 2 })

/** Next number of the company's yearly case sequence (seeded cases count). */
export function nextCaseSeq(companyId: string, y: number): number {
  const key = `${companyId}:${y}`
  const used = hrDisciplinary.filter((r) => r.companyId === companyId && r.issueDate.startsWith(String(y))).length
  hrComplianceSeq[key] = Math.max(hrComplianceSeq[key] ?? 0, used) + 1
  return hrComplianceSeq[key]
}

/** Bytes of discipline attachments and policy PDFs of a company: part of the plan's storageMb (data/hrPeople.ts hrStorageBytes). */
export function hrComplianceStorageBytes(companyId: string): number {
  let bytes = 0
  for (const r of hrDisciplinary) if (r.companyId === companyId) for (const f of r.attachments) bytes += f.sizeBytes
  for (const p of hrPolicies) {
    if (p.companyId !== companyId) continue
    for (const v of p.versions) if (v.file) bytes += v.file.sizeBytes
    if (p.draft?.file) bytes += p.draft.file.sizeBytes
  }
  return bytes
}
