import { addDays, format, subDays } from 'date-fns'
import type { Department } from '@/modules/departments/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

export type { Department }

/**
 * Synthetic department tree (mock). Membership is NOT stored here: a user's department is
 * `User.departmentId` (src/shared/mocks/db.ts), so Settings › Users & roles and the Departments
 * module always agree.
 */

const at = (daysAgo: number) => subDays(new Date(), daysAgo).toISOString()
const due = (inDays: number) => format(addDays(new Date(), inDays), 'yyyy-MM-dd')

const APEX = 'co_apex'
const CREST = 'co_crest'

export const departments: Tenant<Department>[] = [
  {
    id: 'd-management',
    companyId: APEX,
    name: 'Management',
    headId: 'u2',
    parentId: null,
    costCenter: 'CC-100',
    active: true,
    createdAt: at(700),
    updatedAt: at(30),
    goals: [
      { id: 'g-m1', title: 'Move the sales team fully off the Excel tracker', ownerId: 'u2', dueDate: due(20), status: 'Open', createdAt: at(40) },
      { id: 'g-m2', title: 'Sign 6 new retainer customers this quarter', ownerId: 'u3', dueDate: due(45), status: 'Open', createdAt: at(35) },
    ],
  },
  {
    id: 'd-sales',
    companyId: APEX,
    name: 'Sales',
    headId: 'u3',
    parentId: 'd-management',
    costCenter: 'CC-210',
    active: true,
    createdAt: at(650),
    updatedAt: at(12),
    goals: [
      { id: 'g-s1', title: 'Hit 100% of monthly activity targets across the team', ownerId: 'u3', dueDate: due(13), status: 'Open', createdAt: at(18) },
      { id: 'g-s2', title: 'Clear all overdue follow-ups every Friday', ownerId: 'u4', dueDate: due(3), status: 'Open', createdAt: at(10) },
      { id: 'g-s3', title: 'Import the 2025 lead tracker and resolve duplicates', ownerId: 'u5', dueDate: due(-6), status: 'Done', createdAt: at(50) },
    ],
  },
  {
    id: 'd-marketing',
    companyId: APEX,
    name: 'Marketing',
    headId: 'u7',
    parentId: 'd-management',
    costCenter: 'CC-220',
    active: true,
    createdAt: at(640),
    updatedAt: at(60),
    goals: [{ id: 'g-mk1', title: 'Launch the GITEX follow-up campaign', ownerId: 'u7', dueDate: due(9), status: 'Open', createdAt: at(15) }],
  },
  {
    id: 'd-delivery',
    companyId: APEX,
    name: 'Delivery',
    headId: 'u10',
    parentId: 'd-management',
    costCenter: 'CC-300',
    active: true,
    createdAt: at(620),
    updatedAt: at(25),
    goals: [
      { id: 'g-d1', title: 'Publish project templates for every active service', ownerId: 'u10', dueDate: due(25), status: 'Open', createdAt: at(20) },
      { id: 'g-d2', title: 'Keep average onboarding under 21 working days', ownerId: 'u11', dueDate: null, status: 'Open', createdAt: at(30) },
    ],
  },
  {
    id: 'd-finance',
    companyId: APEX,
    name: 'Finance',
    headId: 'u8',
    parentId: 'd-management',
    costCenter: 'CC-400',
    active: true,
    createdAt: at(610),
    updatedAt: at(90),
    goals: [{ id: 'g-f1', title: 'Prepare the chart of accounts for Phase 3', ownerId: 'u8', dueDate: due(60), status: 'Open', createdAt: at(8) }],
  },
  {
    id: 'd-hr',
    companyId: APEX,
    name: 'HR',
    headId: 'u9',
    parentId: 'd-management',
    costCenter: 'CC-500',
    active: true,
    createdAt: at(600),
    updatedAt: at(70),
    goals: [{ id: 'g-h1', title: 'Collect residency and passport expiry dates for all staff', ownerId: 'u9', dueDate: due(30), status: 'Open', createdAt: at(12) }],
  },
  {
    id: 'd-it',
    companyId: APEX,
    name: 'IT',
    headId: 'u1',
    parentId: 'd-management',
    costCenter: 'CC-600',
    active: true,
    createdAt: at(590),
    updatedAt: at(5),
    goals: [{ id: 'g-i1', title: 'Turn on two-factor sign-in for every admin', ownerId: 'u1', dueDate: due(7), status: 'Open', createdAt: at(4) }],
  },
  /* ---------------- Crest Logistics (co_crest) ---------------- */
  {
    id: 'c2-management',
    companyId: CREST,
    name: 'Management',
    headId: 'u102',
    parentId: null,
    costCenter: 'CL-100',
    active: true,
    createdAt: at(400),
    updatedAt: at(20),
    goals: [
      { id: 'g-c2-m1', title: 'Open the Dammam cross-dock by end of quarter', ownerId: 'u102', dueDate: due(50), status: 'Open', createdAt: at(30) },
    ],
  },
  {
    id: 'c2-sales',
    companyId: CREST,
    name: 'Sales',
    headId: 'u103',
    parentId: 'c2-management',
    costCenter: 'CL-210',
    active: true,
    createdAt: at(390),
    updatedAt: at(9),
    goals: [
      { id: 'g-c2-s1', title: 'Win 4 new contract-warehousing accounts in Riyadh', ownerId: 'u103', dueDate: due(40), status: 'Open', createdAt: at(14) },
      { id: 'g-c2-s2', title: 'Respond to every tender-portal lead within 48 hours', ownerId: 'u104', dueDate: due(10), status: 'Open', createdAt: at(7) },
    ],
  },
  {
    id: 'c2-ops',
    companyId: CREST,
    name: 'Operations',
    headId: 'u106',
    parentId: 'c2-management',
    costCenter: 'CL-300',
    active: true,
    createdAt: at(385),
    updatedAt: at(16),
    goals: [
      { id: 'g-c2-o1', title: 'Onboard new freight customers within 10 working days', ownerId: 'u106', dueDate: due(30), status: 'Open', createdAt: at(21) },
    ],
  },
  {
    id: 'c2-it',
    companyId: CREST,
    name: 'IT',
    headId: 'u101',
    parentId: 'c2-management',
    costCenter: 'CL-600',
    active: true,
    createdAt: at(380),
    updatedAt: at(4),
    goals: [{ id: 'g-c2-i1', title: 'Roll out fleet-tracking dashboards to all dispatchers', ownerId: 'u101', dueDate: due(25), status: 'Open', createdAt: at(6) }],
  },
]

/** One company's departments (the tree, heads and members never cross companies). */
export function departmentsOf(companyId: string): Tenant<Department>[] {
  return departments.filter((d) => d.companyId === companyId)
}

/** Delivery departments per company: projects created from won deals staff their tasks from here. */
const DELIVERY_DEPARTMENT: Record<string, string> = { [APEX]: 'd-delivery', [CREST]: 'c2-ops' }

registerArray('departments', departments)

/** The company's delivery department id (Won → project role resolution), or undefined. */
export function deliveryDepartmentId(companyId: string): string | undefined {
  return DELIVERY_DEPARTMENT[companyId]
}
