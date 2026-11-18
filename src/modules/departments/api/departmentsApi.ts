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

import {
  DEPARTMENT_QUERY,
  departmentDetailMapper,
  departmentGoalMapper,
  departmentInputMapper,
  departmentMemberMapper,
  departmentRowMapper,
  moveMembersMapper,
  orgNodeMapper,
} from '@/shared/api/mappers'

/** Departments API: the departments columns on the wire (head_user_id, cost_center_code, is_active…), mapped both ways. */

const enc = encodeURIComponent

export async function getDepartments(includeInactive = false): Promise<DepartmentRow[]> {
  return departmentRowMapper.fromApiList((await http.get<unknown>('/departments', { params: includeInactive ? { [DEPARTMENT_QUERY.includeInactive]: true } : {} })).data)
}

export async function getOrgChart(): Promise<OrgNode[]> {
  return orgNodeMapper.fromApiList((await http.get<unknown>('/departments/org-chart')).data)
}

export async function getDepartment(id: string): Promise<DepartmentDetail> {
  return departmentDetailMapper.fromApi((await http.get<unknown>(`/departments/${enc(id)}`)).data)
}

export async function createDepartment(input: DepartmentInput): Promise<DepartmentRow> {
  return departmentRowMapper.fromApi((await http.post<unknown>('/departments', departmentInputMapper.toApi(input))).data)
}

export async function updateDepartment(id: string, input: DepartmentUpdateInput): Promise<DepartmentRow> {
  return departmentRowMapper.fromApi((await http.patch<unknown>(`/departments/${enc(id)}`, departmentInputMapper.toApi(input))).data)
}

export async function setDepartmentActive(id: string, active: boolean): Promise<DepartmentRow> {
  return departmentRowMapper.fromApi((await http.post<unknown>(`/departments/${enc(id)}/${active ? 'reactivate' : 'deactivate'}`)).data)
}

export async function moveMembers(input: MoveMembersInput): Promise<{ moved: number }> {
  return moveMembersMapper.fromApi((await http.post<unknown>('/departments/move-members', moveMembersMapper.toApi(input))).data)
}

export async function setMemberManager(deptId: string, userId: string, managerId: string | null): Promise<DepartmentMember> {
  return departmentMemberMapper.fromApi((await http.patch<unknown>(`/departments/${enc(deptId)}/members/${enc(userId)}`, departmentMemberMapper.toApi({ managerId }))).data)
}

export async function addGoal(deptId: string, input: GoalInput): Promise<DepartmentGoal> {
  return departmentGoalMapper.fromApi((await http.post<unknown>(`/departments/${enc(deptId)}/goals`, departmentGoalMapper.toApi(input as never))).data)
}

export async function updateGoal(deptId: string, goalId: string, input: Partial<GoalInput>): Promise<DepartmentGoal> {
  return departmentGoalMapper.fromApi((await http.patch<unknown>(`/departments/${enc(deptId)}/goals/${enc(goalId)}`, departmentGoalMapper.toApi(input as never))).data)
}

export async function deleteGoal(deptId: string, goalId: string): Promise<{ id: string }> {
  return departmentGoalMapper.fromApi((await http.delete<unknown>(`/departments/${enc(deptId)}/goals/${enc(goalId)}`)).data)
}
