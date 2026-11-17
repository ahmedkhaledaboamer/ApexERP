import { http } from '@/shared/lib/axios'
import type {
  DepartmentDetail,
  DepartmentGoal,
  DepartmentInput,
  DepartmentMember,
  DepartmentRow,
  DepartmentUpdateInput,
  GoalInput,
  MoveMembersInput,
  OrgNode,
} from '@/modules/departments/types'

const enc = encodeURIComponent

export async function getDepartments(includeInactive = false): Promise<DepartmentRow[]> {
  return (await http.get<DepartmentRow[]>('/departments', { params: includeInactive ? { includeInactive: true } : {} })).data
}

export async function getOrgChart(): Promise<OrgNode[]> {
  return (await http.get<OrgNode[]>('/departments/org-chart')).data
}

export async function getDepartment(id: string): Promise<DepartmentDetail> {
  return (await http.get<DepartmentDetail>(`/departments/${enc(id)}`)).data
}

export async function createDepartment(input: DepartmentInput): Promise<DepartmentRow> {
  return (await http.post<DepartmentRow>('/departments', input)).data
}

export async function updateDepartment(id: string, input: DepartmentUpdateInput): Promise<DepartmentRow> {
  return (await http.patch<DepartmentRow>(`/departments/${enc(id)}`, input)).data
}

export async function setDepartmentActive(id: string, active: boolean): Promise<DepartmentRow> {
  return (await http.post<DepartmentRow>(`/departments/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data
}

export async function moveMembers(input: MoveMembersInput): Promise<{ moved: number }> {
  return (await http.post<{ moved: number }>('/departments/move-members', input)).data
}

export async function setMemberManager(deptId: string, userId: string, managerId: string | null): Promise<DepartmentMember> {
  return (await http.patch<DepartmentMember>(`/departments/${enc(deptId)}/members/${enc(userId)}`, { managerId })).data
}

export async function addGoal(deptId: string, input: GoalInput): Promise<DepartmentGoal> {
  return (await http.post<DepartmentGoal>(`/departments/${enc(deptId)}/goals`, input)).data
}

export async function updateGoal(deptId: string, goalId: string, input: Partial<GoalInput>): Promise<DepartmentGoal> {
  return (await http.patch<DepartmentGoal>(`/departments/${enc(deptId)}/goals/${enc(goalId)}`, input)).data
}

export async function deleteGoal(deptId: string, goalId: string): Promise<{ id: string }> {
  return (await http.delete<{ id: string }>(`/departments/${enc(deptId)}/goals/${enc(goalId)}`)).data
}
