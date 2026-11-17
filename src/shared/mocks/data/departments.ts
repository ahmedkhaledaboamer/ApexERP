import { addDays, format, subDays } from 'date-fns'
import type { Department } from '@/modules/departments/types'

export type { Department }

/**
 * Synthetic department tree (mock). Membership is NOT stored here: a user's department is
 * `User.departmentId` (src/shared/mocks/db.ts), so Settings › Users & roles and the Departments
 * module always agree.
 */

const at = (daysAgo: number) => subDays(new Date(), daysAgo).toISOString()
const due = (inDays: number) => format(addDays(new Date(), inDays), 'yyyy-MM-dd')

export const departments: Department[] = [
  {
    id: 'd-management',
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
    name: 'IT',
    headId: 'u1',
    parentId: 'd-management',
    costCenter: 'CC-600',
    active: true,
    createdAt: at(590),
    updatedAt: at(5),
    goals: [{ id: 'g-i1', title: 'Turn on two-factor sign-in for every admin', ownerId: 'u1', dueDate: due(7), status: 'Open', createdAt: at(4) }],
  },
]
