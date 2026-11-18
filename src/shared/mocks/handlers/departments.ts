import { http } from 'msw'
import type { DepartmentInput, DepartmentUpdateInput, GoalInput, MoveMembersInput } from '@/modules/departments/types'
import * as svc from '@/shared/mocks/services/departments'
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
import { API, bodyAs, respondAs, userFrom } from './utils'

type P = { id: string }

/** Departments (departments columns on the wire). Static paths come before /departments/:id. */
export const departmentHandlers = [
  http.get(`${API}/departments/org-chart`, ({ request }) => respondAs(orgNodeMapper, () => svc.getOrgChart(userFrom(request)))),
  http.post(`${API}/departments/move-members`, async ({ request }) => {
    const body = await bodyAs<MoveMembersInput>(request, moveMembersMapper)
    return respondAs(moveMembersMapper, () => svc.moveMembers(userFrom(request), body))
  }),
  http.get(`${API}/departments`, ({ request }) => {
    const inactive = new URL(request.url).searchParams.get(DEPARTMENT_QUERY.includeInactive) === 'true'
    return respondAs(departmentRowMapper, () => svc.listDepartments(userFrom(request), inactive))
  }),
  http.post(`${API}/departments`, async ({ request }) => {
    const body = await bodyAs<DepartmentInput>(request, departmentInputMapper)
    return respondAs(departmentRowMapper, () => svc.createDepartment(userFrom(request), body))
  }),
  http.get<P>(`${API}/departments/:id`, ({ request, params }) => respondAs(departmentDetailMapper, () => svc.getDepartment(userFrom(request), params.id))),
  http.patch<P>(`${API}/departments/:id`, async ({ request, params }) => {
    const body = await bodyAs<DepartmentUpdateInput>(request, departmentInputMapper)
    return respondAs(departmentRowMapper, () => svc.updateDepartment(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/departments/:id/deactivate`, ({ request, params }) =>
    respondAs(departmentRowMapper, () => svc.setDepartmentActive(userFrom(request), params.id, false)),
  ),
  http.post<P>(`${API}/departments/:id/reactivate`, ({ request, params }) =>
    respondAs(departmentRowMapper, () => svc.setDepartmentActive(userFrom(request), params.id, true)),
  ),
  http.patch<P & { userId: string }>(`${API}/departments/:id/members/:userId`, async ({ request, params }) => {
    const { managerId } = await bodyAs<{ managerId: string | null }>(request, departmentMemberMapper)
    return respondAs(departmentMemberMapper, () => svc.setMemberManager(userFrom(request), params.id, params.userId, managerId))
  }),
  http.post<P>(`${API}/departments/:id/goals`, async ({ request, params }) => {
    const body = await bodyAs<GoalInput>(request, departmentGoalMapper)
    return respondAs(departmentGoalMapper, () => svc.addGoal(userFrom(request), params.id, body))
  }),
  http.patch<P & { goalId: string }>(`${API}/departments/:id/goals/:goalId`, async ({ request, params }) => {
    const body = await bodyAs<Partial<GoalInput>>(request, departmentGoalMapper)
    return respondAs(departmentGoalMapper, () => svc.updateGoal(userFrom(request), params.id, params.goalId, body))
  }),
  http.delete<P & { goalId: string }>(`${API}/departments/:id/goals/:goalId`, ({ request, params }) =>
    respondAs(departmentGoalMapper, () => svc.deleteGoal(userFrom(request), params.id, params.goalId)),
  ),
]
