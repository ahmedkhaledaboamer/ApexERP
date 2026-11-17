import type { Role } from '@/shared/types'

/**
 * Departments module API shapes (spec: Departments — structure and linking employees to them).
 * Membership has ONE source of truth: `User.departmentId`. Moving a member here and changing a
 * user's department in Settings › Users & roles are the same change.
 */

export type GoalStatus = 'Open' | 'Done'

export interface DepartmentGoal {
  id: string
  title: string
  ownerId: string | null
  /** yyyy-MM-dd or null. */
  dueDate: string | null
  status: GoalStatus
  createdAt: string
}

export interface Department {
  id: string
  name: string
  /** Must be a member of this department (or null). */
  headId: string | null
  /** null = top level. No cycles. */
  parentId: string | null
  goals: DepartmentGoal[]
  /** Free text placeholder for Accounting (phase 3). */
  costCenter: string
  /** Departments are deactivated, never deleted. */
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface DepartmentRow extends Omit<Department, 'goals'> {
  headName: string | null
  parentName: string | null
  /** Active users whose departmentId is this one. */
  memberCount: number
  /** Direct sub-departments (active). */
  childCount: number
  /** Depth in the tree (0 = top level). */
  depth: number
  /** Open lead tasks owned by members (until the Tasks module exists). */
  openTasks: number
  overdueTasks: number
  openGoals: number
}

export interface DepartmentMember {
  id: string
  name: string
  email: string
  title: string
  role: Role
  managerId: string | null
  managerName: string | null
  active: boolean
  isHead: boolean
}

export interface DepartmentTask {
  id: string
  title: string
  ownerId: string
  ownerName: string
  dueDate: string
  status: string
  priority: string
  overdue: boolean
  /** The lead the task belongs to (lead tasks until the Tasks module exists). */
  leadId: string | null
  leadCompany: string | null
}

/** Sales-related figures only for now (spec: headcount, leads owned, targets, overdue follow-ups). */
export interface DepartmentFigures {
  headcount: number
  /** Including sub-departments. */
  headcountWithSubs: number
  leadsOwned: number
  openLeads: number
  openPipelineValue: number
  wonThisMonth: number
  overdueFollowUps: number
  /** Activity-target completion this month across members with targets, %, or null if none. */
  targetsCompletion: number | null
  membersWithTargets: number
}

export interface DepartmentDetail extends DepartmentRow {
  goals: DepartmentGoal[]
  members: DepartmentMember[]
  children: { id: string; name: string; headName: string | null; memberCount: number; active: boolean }[]
  /** Root → this department. */
  path: { id: string; name: string }[]
  tasks: DepartmentTask[]
  figures: DepartmentFigures
  /** What the caller may do here (server-decided). */
  can: { edit: boolean; manageMembers: boolean; editGoals: boolean }
}

/** One node of the org chart (flat; build the tree from parentId). */
export interface OrgNode {
  id: string
  name: string
  parentId: string | null
  active: boolean
  head: { id: string; name: string; title: string } | null
  memberCount: number
  /** Shown only for context (an ancestor of the viewer's departments); not openable by the viewer. */
  context: boolean
}

export interface DepartmentInput {
  name: string
  parentId: string | null
  headId: string | null
  costCenter?: string
  active?: boolean
}

export type DepartmentUpdateInput = Partial<Omit<DepartmentInput, 'active'>> & {
  /** When the new head isn't a member yet, move them into this department as part of the change. */
  moveHeadIn?: boolean
}

export interface MoveMembersInput {
  userIds: string[]
  toDepartmentId: string
  /** Optional new direct manager for the moved users. */
  managerId?: string | null
}

export interface GoalInput {
  title: string
  ownerId: string | null
  dueDate: string | null
  status?: GoalStatus
}
