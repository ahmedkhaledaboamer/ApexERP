import { addMonths, format, parseISO } from 'date-fns'
import type { Employee } from '@/modules/hr/types'
import type {
  AssetCategory,
  AssetCondition,
  AssetStatus,
  ContractStatus,
  ContractType,
  DocumentType,
  EmergencyContact,
  EmployeeAddress,
  HrFile,
} from '@/modules/hr/peopleTypes'
import type { Tenant } from '@/shared/mocks/tenant'
import { addDaysIso } from '@/shared/lib/companyDay'
import { APEX_ID } from '@/shared/mocks/data/tenancy'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * HR › Employees, Employee contracts, Company assets: the stores behind services/hrEmployees.ts,
 * hrContracts.ts, hrAssets.ts and hrPeopleAlerts.ts (docs/API.md › HR).
 *
 *   hrProfiles     one per employee: emergency contact, address, bank (IBAN stored in full, served masked), offboarding
 *   hrDocuments    identity / work documents (number stored in full, served masked), expiry alert marks
 *   hrContracts    employment contracts with history (renewed → renewedFromId / renewedToId), alert marks
 *   hrAssets       the company asset register with its assignment history, warranty alert marks
 *   hrActivity     the employee's history (Activity tab)
 *
 * `alertMarks` hold the once-only reminders already sent, keyed by threshold AND the date they were computed
 * from (`d60:2027-01-05`), so a changed date re-arms them (like tasks.reminder_sent_at, cleared on change).
 * Synthetic data, different per company; ids are unique across companies.
 */

export interface ProfileRecord {
  employeeId: string
  emergencyContact: EmergencyContact
  address: EmployeeAddress
  bankName: string
  accountName: string
  /** Stored in full (a real backend encrypts it); never served in full except the HR-full reveal. */
  iban: string
  offboarding: { startedAt: string; completedAt: string | null; completedBy: string | null } | null
}

export interface DocumentRecord {
  id: string
  employeeId: string
  type: DocumentType
  /** Stored in full (encrypted in the backend); served as numberMasked. */
  number: string
  issueDate: string | null
  expiryDate: string | null
  issuingCountry: string
  file: HrFile | null
  notes: string
  alertMarks: string[]
  createdAt: string
  updatedAt: string
}

export interface ContractRecord {
  id: string
  employeeId: string
  type: ContractType
  startDate: string
  endDate: string | null
  probationMonths: number
  probationEndDate: string | null
  noticeDays: number
  hoursPerWeek: number
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowance: number
  currency: string
  status: ContractStatus
  signedDate: string | null
  file: HrFile | null
  notes: string
  renewedFromId: string | null
  renewedToId: string | null
  alertMarks: string[]
  createdAt: string
  updatedAt: string
}

export interface AssignmentRecord {
  id: string
  employeeId: string
  assignedDate: string
  assignedCondition: AssetCondition
  handoverNote: string
  returnedDate: string | null
  returnedCondition: AssetCondition | null
  returnNote: string
  lost: boolean
}

export interface AssetRecord {
  id: string
  tag: string
  name: string
  category: AssetCategory
  brand: string
  model: string
  serial: string
  purchaseDate: string | null
  cost: number | null
  currency: string
  condition: AssetCondition
  status: AssetStatus
  warrantyEnd: string | null
  notes: string
  assignments: AssignmentRecord[]
  alertMarks: string[]
  createdAt: string
  updatedAt: string
}

export interface ActivityRecord {
  id: string
  employeeId: string
  at: string
  actorId: string | null
  actorName: string
  action: string
  summary: string
}

/* ---------------- helpers ---------------- */

/** "•••• 1234" (the last 4 characters); "••••" for very short values; '' for none. */
export function maskLast4(value: string | null | undefined): string {
  const v = (value ?? '').replace(/\s+/g, '')
  if (!v) return ''
  return v.length <= 4 ? '••••' : `•••• ${v.slice(-4)}`
}

/** Next id `<prefix><n>` over every row of a store (ids stay unique across companies and survive restores). */
export function nextHrId(prefix: string, rows: readonly { id: string }[]): string {
  let max = 0
  for (const r of rows) if (r.id.startsWith(prefix)) max = Math.max(max, Number(r.id.slice(prefix.length)) || 0)
  return `${prefix}${max + 1}`
}

function luhnOk(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (dbl) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    dbl = !dbl
  }
  return sum % 10 === 0
}

/* ---------------- seed ---------------- */

const TODAY = new Date().toISOString().slice(0, 10)
const d = (n: number) => addDaysIso(TODAY, n)
const NOW = new Date().toISOString()
const pad = (n: number, w: number) => String(Math.abs(Math.trunc(n))).padStart(w, '0').slice(-w)
const plusMonths = (iso: string, months: number) => format(addMonths(parseISO(iso), months), 'yyyy-MM-dd')

const companyEmployees = (co: string): Tenant<Employee>[] => hrEmployees.filter((e) => e.companyId === co)

const RELATIONS = ['Spouse', 'Brother', 'Sister', 'Father', 'Mother', 'Friend']
const EMERGENCY_APEX = ['Anita Varghese', 'Tom Wilson', 'Rania Fawzi', 'Kamal Adel', 'Meera Pillai', 'Sami Daher', 'Grace Lim', 'Zainab Ali']
const EMERGENCY_CREST = ['Abeer Al Harthy', 'Mansour Al Qarni', 'Salma Fathy', 'Deepa Menon', 'Nasser Al Yami', 'Arif Hussain', 'Lubna Haddad']

function seedProfiles(): Tenant<ProfileRecord>[] {
  const out: Tenant<ProfileRecord>[] = []
  for (const co of [APEX_ID, 'co_crest']) {
    const apex = co === APEX_ID
    companyEmployees(co).forEach((e, i) => {
      const names = apex ? EMERGENCY_APEX : EMERGENCY_CREST
      out.push({
        companyId: co,
        employeeId: e.id,
        emergencyContact: {
          name: names[i % names.length],
          relation: RELATIONS[i % RELATIONS.length],
          phone: apex ? `+971 50 ${pad(600 + i * 13, 3)} ${pad(1200 + i * 377, 4)}` : `+966 55 ${pad(300 + i * 17, 3)} ${pad(4100 + i * 211, 4)}`,
        },
        address: apex
          ? { line1: `${['Al Barsha 1', 'JLT Cluster D', 'Al Nahda 2', 'Business Bay', 'Mirdif'][i % 5]}, Building ${10 + i}`, city: 'Dubai', country: 'AE' }
          : { line1: `${['Al Olaya', 'Al Malqa', 'Al Nakheel', 'Al Sulimaniyah'][i % 4]} District, Street ${20 + i}`, city: 'Riyadh', country: 'SA' },
        bankName: apex ? ['Emirates NBD', 'ADCB', 'Mashreq'][i % 3] : ['Al Rajhi Bank', 'SNB', 'Riyad Bank'][i % 3],
        accountName: e.fullName,
        // Synthetic IBANs (country + check digits + bank code + account), not real accounts.
        iban: apex ? `AE${pad(10 + i * 7, 2)}0${pad(260 + i, 2)}${pad(1000000000 + i * 7654321, 16)}` : `SA${pad(20 + i * 3, 2)}80${pad(5000000000 + i * 1234567, 20)}`,
        offboarding: null,
      })
    })
  }
  return out
}

const PASSPORT_LETTERS = 'NPKLAZ'
const FILE_SCAN = (name: string): HrFile => ({ name, sizeBytes: 182_000, mimeType: 'application/pdf', url: null })

/** Per company: which document expires soon / has expired (employee id → type → days from today). */
const DOC_OVERRIDES: Record<string, Partial<Record<DocumentType, number>>> = {
  'EMP-u11': { residence_visa: 45 },
  'EMP-u14': { passport: 20 },
  'EMP-X1': { labour_card: -10 },
  'EMP-u107': { iqama: 30 },
  'EMP-X102': { passport: 50 },
  'EMP-u104': { iqama: -5 },
}

function seedDocuments(): Tenant<DocumentRecord>[] {
  const out: Tenant<DocumentRecord>[] = []
  let seq = 0
  const add = (co: string, e: Employee, type: DocumentType, number: string, country: string, days: number, years: number, file: HrFile | null = null) => {
    const expiry = d(DOC_OVERRIDES[e.id]?.[type] ?? days)
    const issue = addDaysIso(expiry, -Math.round(years * 365))
    seq++
    out.push({
      companyId: co,
      id: `HDOC-${seq}`,
      employeeId: e.id,
      type,
      number,
      issueDate: issue,
      expiryDate: expiry,
      issuingCountry: country,
      file,
      notes: '',
      alertMarks: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
  }
  for (const co of [APEX_ID, 'co_crest']) {
    const apex = co === APEX_ID
    companyEmployees(co).forEach((e, i) => {
      const passportNo = `${PASSPORT_LETTERS[i % PASSPORT_LETTERS.length]}${pad(23456781 + i * 7919 + (apex ? 0 : 3301), 8)}`
      add(co, e, 'passport', passportNo, e.nationality || (apex ? 'AE' : 'SA'), 400 + ((i * 137) % 1500), 10, i % 3 === 0 ? FILE_SCAN('passport-scan.pdf') : null)
      if (apex) {
        let eid = `7841${pad(1980 + (i % 20), 4)}${pad(1234567 + i * 4441, 7)}${i % 10}`
        if (luhnOk(eid)) eid = eid.slice(0, -1) + String((Number(eid.slice(-1)) + 1) % 10)
        const eidText = `${eid.slice(0, 3)}-${eid.slice(3, 7)}-${eid.slice(7, 14)}-${eid.slice(14)}`
        add(co, e, 'emirates_id', eidText, 'AE', 200 + ((i * 89) % 700), 2)
        if (e.nationality !== 'AE') {
          add(co, e, 'residence_visa', `201/${2024 + (i % 2)}/${pad(3456789 + i * 1013, 7)}`, 'AE', 200 + ((i * 89) % 700), 2, i % 4 === 0 ? FILE_SCAN('residence-visa.pdf') : null)
          add(co, e, 'labour_card', pad(81234567 + i * 3131, 8), 'AE', 200 + ((i * 89) % 700), 2)
        }
      } else {
        if (e.nationality !== 'SA') add(co, e, 'iqama', `2${pad(412345678 + i * 7777, 9)}`, 'SA', 150 + ((i * 71) % 500), 1, i % 3 === 1 ? FILE_SCAN('iqama.pdf') : null)
        else add(co, e, 'other', `1${pad(51203874 + i * 3333, 9)}`, 'SA', 900 + i * 30, 10)
        if (i % 2 === 0) add(co, e, 'medical_insurance', `MED-${pad(552100 + i * 31, 6)}`, 'SA', 120 + ((i * 53) % 240), 1)
        if (e.jobTitle.toLowerCase().includes('driver') || e.jobTitle.toLowerCase().includes('forklift')) add(co, e, 'driving_license', `DL-${pad(7712000 + i * 97, 7)}`, 'SA', 700, 5)
      }
      if (apex && e.jobTitle.toLowerCase().includes('driver')) add(co, e, 'driving_license', `DL-${pad(5521000 + i * 97, 7)}`, 'AE', 820, 5)
    })
  }
  return out
}

const CONTRACT_OVERRIDES: Record<string, Partial<ContractRecord>> = {
  // Apex: internship, a limited contract ending soon, the part-timer, one in probation.
  'EMP-u17': { type: 'internship', endDate: d(120), probationMonths: 0 },
  'EMP-u15': { type: 'limited', endDate: d(25) },
  'EMP-X2': { type: 'part_time', hoursPerWeek: 24 },
  'EMP-X3': { probationMonths: 3 },
  // Crest: a consultancy in probation, a limited contract ending within 60 days.
  'EMP-X103': { type: 'consultancy', probationMonths: 3, hoursPerWeek: 40 },
  'EMP-u104': { type: 'limited', endDate: d(40) },
  'EMP-X102': { type: 'limited', endDate: d(500) },
}
/** Employees whose current contract renewed an earlier one (history kept). */
const RENEWED = new Set(['EMP-u4', 'EMP-u105'])

function seedContracts(): Tenant<ContractRecord>[] {
  const out: Tenant<ContractRecord>[] = []
  let seq = 0
  for (const co of [APEX_ID, 'co_crest']) {
    const currency = co === APEX_ID ? 'AED' : 'SAR'
    companyEmployees(co).forEach((e, i) => {
      const basic = Math.round((6000 + ((i * 1733) % 22000)) / 500) * 500
      const base = (): Tenant<ContractRecord> => ({
        companyId: co,
        id: '',
        employeeId: e.id,
        type: 'unlimited',
        startDate: e.hireDate,
        endDate: null,
        probationMonths: 6,
        probationEndDate: null,
        noticeDays: 30,
        hoursPerWeek: 48,
        basicSalary: basic,
        housingAllowance: Math.round(basic * 0.25),
        transportAllowance: i % 2 ? 1000 : 800,
        otherAllowance: i % 3 === 0 ? 500 : 0,
        currency,
        status: 'active',
        signedDate: e.hireDate,
        file: i % 4 === 0 ? FILE_SCAN('employment-contract.pdf') : null,
        notes: '',
        renewedFromId: null,
        renewedToId: null,
        alertMarks: [],
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
      })
      if (RENEWED.has(e.id)) {
        const old = base()
        old.id = `HCT-${++seq}`
        old.type = 'limited'
        old.startDate = d(-1100)
        old.endDate = d(-371)
        old.signedDate = d(-1110)
        old.status = 'renewed'
        old.probationEndDate = plusMonths(old.startDate, old.probationMonths)
        const cur = base()
        cur.id = `HCT-${++seq}`
        cur.type = 'limited'
        cur.startDate = d(-370)
        cur.endDate = d(360)
        cur.signedDate = d(-380)
        cur.probationMonths = 0
        cur.basicSalary = basic + 1000
        cur.renewedFromId = old.id
        old.renewedToId = cur.id
        out.push(old, cur)
        return
      }
      const c = { ...base(), ...(CONTRACT_OVERRIDES[e.id] ?? {}) }
      c.id = `HCT-${++seq}`
      if (c.type === 'limited' && !c.endDate) c.endDate = d(300 + i * 15)
      if (c.type === 'part_time') {
        c.basicSalary = Math.round(c.basicSalary / 2)
        c.housingAllowance = 0
      }
      c.probationEndDate = c.probationMonths ? plusMonths(c.startDate, c.probationMonths) : null
      out.push(c)
    })
  }
  return out
}

type AssetSeed = [AssetCategory, string, string, string, number, string | null, AssetStatus?, number?]
// category, name, brand, model, cost, assigned employee id (null = not assigned), status override, warranty days
const ASSETS_APEX: AssetSeed[] = [
  ['laptop', 'MacBook Pro 14"', 'Apple', 'M3 Pro 2024', 9800, 'EMP-u11', undefined, 20],
  ['phone', 'iPhone 15', 'Apple', 'A3090', 3800, 'EMP-u11'],
  ['access_card', 'Office access card', 'HID', 'iCLASS SE', 60, 'EMP-u11'],
  ['laptop', 'ThinkPad X1 Carbon', 'Lenovo', 'Gen 11', 7200, 'EMP-u14'],
  ['laptop', 'ThinkPad X1 Carbon', 'Lenovo', 'Gen 11', 7200, 'EMP-u15'],
  ['laptop', 'Dell XPS 15', 'Dell', '9530', 8400, 'EMP-u16'],
  ['laptop', 'MacBook Air 13"', 'Apple', 'M2 2023', 5200, 'EMP-u17'],
  ['laptop', 'Dell Latitude 7440', 'Dell', '7440', 6100, 'EMP-u10'],
  ['phone', 'Galaxy S24', 'Samsung', 'SM-S921B', 3300, 'EMP-u10'],
  ['vehicle', 'Toyota Hiace van', 'Toyota', 'Hiace 2022', 118000, 'EMP-X1'],
  ['sim', 'Etisalat business SIM', 'Etisalat', 'Business Plus', 0, 'EMP-X1'],
  ['tablet', 'iPad Air', 'Apple', 'M2 11"', 2900, 'EMP-X3'],
  ['laptop', 'Dell Latitude 5440', 'Dell', '5440', 4300, 'EMP-u9'],
  ['laptop', 'Dell Latitude 5440', 'Dell', '5440', 4300, null],
  ['laptop', 'ThinkPad T14', 'Lenovo', 'Gen 4', 4800, null],
  ['phone', 'Galaxy A55', 'Samsung', 'SM-A556E', 1500, null],
  ['laptop', 'HP EliteBook 840', 'HP', 'G9', 5100, null, 'in_repair'],
  ['furniture', 'Ergonomic chair', 'Herman Miller', 'Aeron', 5600, null, 'retired'],
]
const ASSETS_CREST: AssetSeed[] = [
  ['laptop', 'ThinkPad T14s', 'Lenovo', 'Gen 4', 5400, 'EMP-u107', undefined, 25],
  ['phone', 'Galaxy S23', 'Samsung', 'SM-S911B', 3100, 'EMP-u107'],
  ['laptop', 'Dell Latitude 7440', 'Dell', '7440', 6000, 'EMP-u106'],
  ['phone', 'iPhone 14', 'Apple', 'A2882', 3200, 'EMP-u106'],
  ['laptop', 'HP ProBook 450', 'HP', 'G10', 3600, 'EMP-u104'],
  ['laptop', 'HP ProBook 450', 'HP', 'G10', 3600, 'EMP-u105'],
  ['vehicle', 'Isuzu NPR truck', 'Isuzu', 'NPR 2021', 165000, 'EMP-X103'],
  ['vehicle', 'Toyota Hilux pickup', 'Toyota', 'Hilux 2023', 112000, 'EMP-X101'],
  ['sim', 'STC business SIM', 'STC', 'Business 200', 0, 'EMP-X103'],
  ['tablet', 'Galaxy Tab Active5', 'Samsung', 'SM-X306B', 2400, 'EMP-X102'],
  ['access_card', 'Warehouse access card', 'HID', 'Prox II', 45, 'EMP-X101'],
  ['laptop', 'ThinkPad E14', 'Lenovo', 'Gen 5', 3300, null],
  ['phone', 'Galaxy A35', 'Samsung', 'SM-A356E', 1200, null],
  ['tablet', 'Galaxy Tab Active5', 'Samsung', 'SM-X306B', 2400, null],
  ['laptop', 'HP ProBook 440', 'HP', 'G9', 3100, null, 'in_repair'],
  ['furniture', 'Standing desk', 'Flexispot', 'E7', 2100, null, 'retired'],
]

function seedAssets(): Tenant<AssetRecord>[] {
  const out: Tenant<AssetRecord>[] = []
  let seq = 0
  let aseq = 0
  for (const [co, list] of [[APEX_ID, ASSETS_APEX], ['co_crest', ASSETS_CREST]] as const) {
    const currency = co === APEX_ID ? 'AED' : 'SAR'
    list.forEach(([category, name, brand, model, cost, assignee, status, warrantyDays], i) => {
      const purchase = d(-(120 + i * 37))
      const assignments: AssignmentRecord[] = []
      // A returned earlier assignment on a few assets (history).
      if (i % 5 === 1) {
        const prev = companyEmployees(co).find((e) => e.id !== assignee && e.userId)
        if (prev) {
          assignments.push({
            id: `HAA-${++aseq}`,
            employeeId: prev.id,
            assignedDate: addDaysIso(purchase, 3),
            assignedCondition: 'new',
            handoverNote: 'Issued at onboarding.',
            returnedDate: addDaysIso(purchase, 60),
            returnedCondition: 'good',
            returnNote: 'Returned on a device refresh.',
            lost: false,
          })
        }
      }
      if (assignee) {
        assignments.push({
          id: `HAA-${++aseq}`,
          employeeId: assignee,
          assignedDate: addDaysIso(purchase, i % 5 === 1 ? 65 : 3),
          assignedCondition: i % 5 === 1 ? 'good' : 'new',
          handoverNote: category === 'vehicle' ? 'Keys, registration card and fuel card handed over.' : 'Handed over with charger.',
          returnedDate: null,
          returnedCondition: null,
          returnNote: '',
          lost: false,
        })
      }
      seq++
      out.push({
        companyId: co,
        id: `HAS-${seq}`,
        tag: `AST-${pad(i + 1, 3)}`,
        name,
        category,
        brand,
        model,
        serial: `${brand.slice(0, 2).toUpperCase()}${pad(840000 + i * 7311 + (co === APEX_ID ? 0 : 50000), 7)}`,
        purchaseDate: purchase,
        cost,
        currency,
        condition: status === 'in_repair' ? 'damaged' : status === 'retired' ? 'poor' : 'good',
        status: assignee ? 'assigned' : (status ?? 'in_stock'),
        warrantyEnd: category === 'furniture' || category === 'sim' || category === 'access_card' ? null : d(warrantyDays ?? 200 + i * 31),
        notes: '',
        assignments,
        alertMarks: [],
        createdAt: `${purchase}T08:00:00.000Z`,
        updatedAt: `${purchase}T08:00:00.000Z`,
      })
    })
  }
  return out
}

function seedActivity(): Tenant<ActivityRecord>[] {
  return hrEmployees.map((e, i) => ({
    companyId: e.companyId,
    id: `HACT-${i + 1}`,
    employeeId: e.id,
    at: e.createdAt,
    actorId: null,
    actorName: 'System',
    action: 'created',
    summary: e.userId ? 'Employee record created from the user account' : 'Employee record created',
  }))
}

export const hrProfiles = registerArray<Tenant<ProfileRecord>>('hrProfiles', seedProfiles())
export const hrDocuments = registerArray<Tenant<DocumentRecord>>('hrDocuments', seedDocuments())
export const hrContracts = registerArray<Tenant<ContractRecord>>('hrContracts', seedContracts())
export const hrAssets = registerArray<Tenant<AssetRecord>>('hrAssets', seedAssets())
export const hrActivity = registerArray<Tenant<ActivityRecord>>('hrActivity', seedActivity())

/** Bytes of HR files (document scans, contract files) of a company: part of the plan's storageMb. */
export function hrStorageBytes(companyId: string): number {
  let bytes = 0
  for (const x of hrDocuments) if (x.companyId === companyId && x.file) bytes += x.file.sizeBytes
  for (const x of hrContracts) if (x.companyId === companyId && x.file) bytes += x.file.sizeBytes
  return bytes
}
