import type { Employee } from '@/modules/hr/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * HR employees (shared core for every HR section). Seeded from the system users so every user is an
 * employee with the stable id `EMP-<userId>`; staff without a login (EMP-X<n>) are the NO_LOGIN rows
 * below. Profiles, documents, contracts and assets live in data/hrPeople.ts.
 *
 * Synthetic data only. Other HR seeds may reference `EMP-<userId>` ids directly.
 */

const NATIONALITIES_APEX = ['AE', 'IN', 'EG', 'JO', 'PH', 'LB', 'PK', 'GB']
const NATIONALITIES_CREST = ['SA', 'SA', 'EG', 'IN', 'SA', 'PK', 'JO']
const FEMALE = new Set(['Layla', 'Bincy', 'Priya', 'Sara', 'Mariam', 'Noura', 'Fatima', 'Leena', 'Hind', 'Reem', 'Huda'])

export const empIdForUser = (userId: string) => `EMP-${userId}`

/** Arabic names and job titles of some seeded staff (Arabic / bilingual HR letters); the others have none yet. */
const ARABIC: Record<string, { fullNameAr: string; jobTitleAr: string }> = {
  u2: { fullNameAr: 'ليلى منصور', jobTitleAr: 'المديرة العامة' },
  u9: { fullNameAr: 'مريم سعيد', jobTitleAr: 'مديرة الموارد البشرية' },
  u10: { fullNameAr: 'دانيال أورتيز', jobTitleAr: 'رئيس قسم التنفيذ' },
  u11: { fullNameAr: 'نورة الكتبي', jobTitleAr: 'مستشارة حلول' },
  u14: { fullNameAr: 'يوسف رحمن', jobTitleAr: 'مطوّر برمجيات' },
  u101: { fullNameAr: 'فيصل الحربي', jobTitleAr: 'مدير تقنية المعلومات' },
  u102: { fullNameAr: 'نورة القحطاني', jobTitleAr: 'المديرة العامة' },
  u105: { fullNameAr: 'طارق المطيري', jobTitleAr: 'مدير حسابات' },
  u106: { fullNameAr: 'سلطان الغامدي', jobTitleAr: 'رئيس العمليات' },
  u107: { fullNameAr: 'هدى الزهراني', jobTitleAr: 'منسقة عمليات' },
}

function seed(): Tenant<Employee>[] {
  const perCompany = new Map<string, number>()
  return users.map((u) => {
    const n = (perCompany.get(u.companyId) ?? 0) + 1
    perCompany.set(u.companyId, n)
    const apex = u.companyId === APEX_ID
    const nationalities = apex ? NATIONALITIES_APEX : NATIONALITIES_CREST
    const created = u.createdAt
    return {
      companyId: u.companyId,
      id: empIdForUser(u.id),
      userId: u.id,
      employeeNo: `${apex ? 'APX' : 'CRS'}-${String(n).padStart(4, '0')}`,
      fullName: u.name,
      jobTitle: u.title,
      ...(ARABIC[u.id] ?? {}),
      departmentId: u.departmentId,
      managerId: u.managerId ? empIdForUser(u.managerId) : null,
      email: u.email,
      mobile: u.mobile,
      nationality: nationalities[(n - 1) % nationalities.length],
      gender: FEMALE.has(u.name.split(' ')[0]) ? 'female' : 'male',
      dateOfBirth: `${1980 + ((n * 7) % 18)}-${String(((n * 5) % 12) + 1).padStart(2, '0')}-${String(((n * 11) % 27) + 1).padStart(2, '0')}`,
      hireDate: created.slice(0, 10),
      employmentType: 'full_time',
      status: u.active ? 'active' : 'terminated',
      exitDate: null,
      createdAt: created,
      updatedAt: created,
    }
  })
}

/**
 * Staff without a login (`EMP-X<n>`), 3 per company. The numbers are unique across companies (Apex X1…,
 * Crest X101…) so an id never names two records. Synthetic people.
 */
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const NO_LOGIN: (Omit<Employee, 'employeeNo' | 'createdAt' | 'updatedAt' | 'userId' | 'status' | 'exitDate' | 'employmentType'> & {
  companyId: string
  daysAgo: number
  employmentType?: Employee['employmentType']
})[] = [
  { companyId: APEX_ID, id: 'EMP-X1', fullName: 'Suresh Pillai', jobTitle: 'Office Driver', departmentId: 'd-management', managerId: 'EMP-u2', email: '', mobile: '+971 50 330 4471', nationality: 'IN', gender: 'male', dateOfBirth: '1984-03-12', hireDate: '', daysAgo: 900 },
  { companyId: APEX_ID, id: 'EMP-X2', fullName: 'Joy Fernandes', jobTitle: 'Office Assistant', departmentId: 'd-hr', managerId: 'EMP-u9', email: 'joy.f@apexaora.ae', mobile: '+971 55 210 9083', nationality: 'PH', gender: 'female', dateOfBirth: '1993-08-02', hireDate: '', daysAgo: 420, employmentType: 'part_time' },
  { companyId: APEX_ID, id: 'EMP-X3', fullName: 'Imran Sheikh', jobTitle: 'Site Technician', departmentId: 'd-delivery', managerId: 'EMP-u10', email: 'imran.s@apexaora.ae', mobile: '+971 52 118 6620', nationality: 'PK', gender: 'male', dateOfBirth: '1996-11-21', hireDate: '', daysAgo: 80 },
  { companyId: CREST_ID, id: 'EMP-X101', fullName: 'Yasser Al Amri', jobTitle: 'Warehouse Supervisor', departmentId: 'c2-ops', managerId: 'EMP-u106', email: 'yasser@crestlogistics.sa', mobile: '+966 55 410 2287', nationality: 'SA', gender: 'male', dateOfBirth: '1988-06-14', hireDate: '', daysAgo: 1300 },
  { companyId: CREST_ID, id: 'EMP-X102', fullName: 'Ramesh Nair', jobTitle: 'Forklift Operator', departmentId: 'c2-ops', managerId: 'EMP-u106', email: '', mobile: '+966 50 771 3094', nationality: 'IN', gender: 'male', dateOfBirth: '1990-01-30', hireDate: '', daysAgo: 610 },
  { companyId: CREST_ID, id: 'EMP-X103', fullName: 'Joseph Mathew', jobTitle: 'Fleet Driver', departmentId: 'c2-ops', managerId: 'EMP-u106', email: '', mobile: '+966 53 902 4415', nationality: 'IN', gender: 'male', dateOfBirth: '1994-09-09', hireDate: '', daysAgo: 80, employmentType: 'contractor' },
]

function seedNoLogin(fromUsers: Tenant<Employee>[]): Tenant<Employee>[] {
  return NO_LOGIN.map(({ daysAgo, employmentType, ...e }) => {
    const n = fromUsers.filter((x) => x.companyId === e.companyId).length + NO_LOGIN.filter((x) => x.companyId === e.companyId).findIndex((x) => x.id === e.id) + 1
    const created = isoDaysAgo(daysAgo)
    return {
      ...e,
      userId: null,
      employeeNo: `${e.companyId === APEX_ID ? 'APX' : 'CRS'}-${String(n).padStart(4, '0')}`,
      hireDate: created.slice(0, 10),
      employmentType: employmentType ?? 'full_time',
      status: 'active',
      exitDate: null,
      createdAt: created,
      updatedAt: created,
    }
  })
}

function seedAll(): Tenant<Employee>[] {
  const fromUsers = seed()
  return [...fromUsers, ...seedNoLogin(fromUsers)]
}

export const hrEmployees = registerArray<Tenant<Employee>>('hrEmployees', seedAll())

export const employeesOf = (companyId: string) => hrEmployees.filter((e) => e.companyId === companyId)
export const employeeById = (companyId: string, id: string) => hrEmployees.find((e) => e.companyId === companyId && e.id === id)
export const employeeForUser = (companyId: string, userId: string) => hrEmployees.find((e) => e.companyId === companyId && e.userId === userId)
