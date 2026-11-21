import type { EmergencyContact, EmployeeAddress } from '@/modules/hr/peopleTypes'
import type { IssuedLetter, LetterCode, LetterStatus, NocPurpose, ProfileChangeStatus } from '@/modules/hr/selfservice/types'
import { defaultLetterTypes } from '@/modules/hr/selfservice/letters'
import type { Tenant } from '@/shared/mocks/tenant'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { registerArray, registerObject } from '@/shared/mocks/persist/registry'
import { hrProfiles } from '@/shared/mocks/data/hrPeople'

/**
 * HR › Self-service and HR letters: the stores behind services/hrSelfService.ts and services/hrLetters.ts
 * (docs/API.md › HR › Self-service, HR letters).
 *
 *   hr.profileChanges    an employee's request to change their emergency contact / address / mobile / bank account,
 *                        decided by HR full. The proposed IBAN is stored in full (a real backend encrypts it) and is
 *                        served masked, like the profile's; only the HR-full reveal answers it in full.
 *   hr.letterTypes       per company: the five letter types with their editable template text
 *   hr.letterRequests    requests (by the employee or by HR on their behalf) and, once issued, the frozen letter
 *                        (reference number, verification code, rendered text, letterhead, signatory)
 *   hr.letterSeq         the per-company yearly reference sequence: `<companyId>:<year>` → last number used
 *
 * `notified` holds the once-only notification keys already sent (submitted / issued / rejected …).
 * Synthetic data; ids are unique across companies (HPC-, HLT-, HLR-).
 */

export interface ProfileChangeRecord {
  id: string
  employeeId: string
  /** The user who filed it (the employee's login). */
  requestedBy: string
  requestedByName: string
  /** Only the parts being changed are set. `bank.iban` is stored in full while pending and wiped ('') once the request is closed. */
  proposed: { emergencyContact?: EmergencyContact; address?: EmployeeAddress; mobile?: string; bank?: { bankName: string; accountName: string; iban: string; ibanMasked: string } }
  /** The request changes the IBAN (approval is audited as a security event). */
  ibanChange: boolean
  /** Snapshot when filed; the IBAN only masked. */
  current: { emergencyContact?: EmergencyContact; address?: EmployeeAddress; mobile?: string; bank?: { bankName: string; accountName: string; ibanMasked: string } }
  note: string
  status: ProfileChangeStatus
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null
  decisionComment: string
  notified: string[]
  createdAt: string
  updatedAt: string
}

export interface LetterTypeRecord {
  id: string
  code: LetterCode
  name: string
  description: string
  body: string
  includesSalary: boolean
  active: boolean
  updatedAt: string
  updatedBy: string | null
  updatedByName: string | null
}

export interface LetterRequestRecord {
  id: string
  employeeId: string
  letterTypeId: string
  code: LetterCode
  /** The type's name when requested (a later rename doesn't change history). */
  typeName: string
  includesSalary: boolean
  addressee: string
  purpose: string
  nocPurpose: NocPurpose | null
  languageNote: string
  requestedBy: string
  requestedByName: string
  onBehalf: boolean
  status: LetterStatus
  overrideReason: string
  rejectionReason: string
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null
  letter: IssuedLetter | null
  notified: string[]
  createdAt: string
  updatedAt: string
}

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function seedTypes(): Tenant<LetterTypeRecord>[] {
  let n = 0
  const out: Tenant<LetterTypeRecord>[] = []
  for (const co of [APEX_ID, CREST_ID]) {
    const country = companyById(co)?.regional.country ?? (co === CREST_ID ? 'SA' : 'AE')
    for (const t of defaultLetterTypes(country)) {
      out.push({ companyId: co, id: `HLT-${++n}`, ...t, active: true, updatedAt: isoDaysAgo(200), updatedBy: null, updatedByName: null })
    }
  }
  return out
}

export const hrLetterTypes = registerArray<Tenant<LetterTypeRecord>>('hr.letterTypes', seedTypes())

const typeId = (co: string, code: LetterCode) => hrLetterTypes.find((t) => t.companyId === co && t.code === code)!.id

function request(co: string, id: string, employeeId: string, userId: string, name: string, code: LetterCode, daysAgo: number, extra: Partial<LetterRequestRecord>): Tenant<LetterRequestRecord> {
  const t = hrLetterTypes.find((x) => x.companyId === co && x.code === code)!
  const at = isoDaysAgo(daysAgo)
  return {
    companyId: co,
    id,
    employeeId,
    letterTypeId: typeId(co, code),
    code,
    typeName: t.name,
    includesSalary: t.includesSalary,
    addressee: 'To whom it may concern',
    purpose: '',
    nocPurpose: null,
    languageNote: '',
    requestedBy: userId,
    requestedByName: name,
    onBehalf: false,
    status: 'pending',
    overrideReason: '',
    rejectionReason: '',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    letter: null,
    // Seeded requests count as already announced (no notification burst on first load).
    notified: ['submitted'],
    createdAt: at,
    updatedAt: at,
    ...extra,
  }
}

/** Synthetic pending requests so the HR inbox isn't empty: different per company. */
function seedRequests(): Tenant<LetterRequestRecord>[] {
  return [
    request(APEX_ID, 'HLR-1', 'EMP-u14', 'u14', 'Yusuf Rahman', 'salary_certificate', 2, { addressee: 'Emirates NBD', purpose: 'a car loan application' }),
    request(APEX_ID, 'HLR-2', 'EMP-u12', 'u12', 'Hassan Qureshi', 'noc', 1, { addressee: 'The Consulate General of Türkiye, Dubai', purpose: 'a tourist visa for travel from 12 to 20 December', nocPurpose: 'visa', languageNote: 'English is fine.' }),
    request(CREST_ID, 'HLR-101', 'EMP-u107', 'u107', 'Huda Al Zahrani', 'employment_certificate', 3, { addressee: 'Riyad Bank', purpose: 'opening a savings account' }),
  ]
}

const profile = (co: string, employeeId: string) => hrProfiles.find((p) => p.companyId === co && p.employeeId === employeeId)

function seedChanges(): Tenant<ProfileChangeRecord>[] {
  const at = (n: number) => isoDaysAgo(n)
  // A function: every request gets its own `notified` array (a shared one would leak keys across companies).
  const base = () => ({ ibanChange: false, status: 'pending' as const, decidedBy: null, decidedByName: null, decidedAt: null, decisionComment: '', notified: ['submitted'] })
  return [
    {
      companyId: APEX_ID, id: 'HPC-1', employeeId: 'EMP-u15', requestedBy: 'u15', requestedByName: 'Leena Joseph',
      proposed: { emergencyContact: { name: 'Thomas Joseph', relation: 'Brother', phone: '+971 50 771 2290' } },
      current: { emergencyContact: { ...(profile(APEX_ID, 'EMP-u15')?.emergencyContact ?? { name: '', relation: '', phone: '' }) } },
      note: 'My brother moved to Dubai; please use him as my emergency contact.', ...base(), createdAt: at(1), updatedAt: at(1),
    },
    {
      companyId: CREST_ID, id: 'HPC-101', employeeId: 'EMP-u105', requestedBy: 'u105', requestedByName: 'Tariq Al Mutairi',
      proposed: { address: { line1: 'Al Olaya District, Building 14, Apt 6', city: 'Riyadh', country: 'SA' } },
      current: { address: { ...(profile(CREST_ID, 'EMP-u105')?.address ?? { line1: '', city: '', country: '' }) } },
      note: 'Moved last week.', ...base(), createdAt: at(2), updatedAt: at(2),
    },
  ]
}

export const hrLetterRequests = registerArray<Tenant<LetterRequestRecord>>('hr.letterRequests', seedRequests())
export const hrProfileChanges = registerArray<Tenant<ProfileChangeRecord>>('hr.profileChanges', seedChanges())
/** `<companyId>:<year>` → the last reference number used. */
export const hrLetterSeq = registerObject<Record<string, number>>('hr.letterSeq', {})

/** Next number of the company's yearly letter sequence (starts at 1 every year). */
export function nextLetterSeq(companyId: string, year: number): number {
  const key = `${companyId}:${year}`
  hrLetterSeq[key] = (hrLetterSeq[key] ?? 0) + 1
  return hrLetterSeq[key]
}

/** Every proposed IBAN still stored in full (the HR secrets guard checks none leaves in a GET). */
export function pendingIbans(): string[] {
  return hrProfileChanges.map((c) => c.proposed.bank?.iban ?? '').filter((v) => v.length >= 15)
}
