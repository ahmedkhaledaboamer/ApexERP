import { http } from 'msw'
import type { DepartmentInput, DepartmentUpdateInput, GoalInput, MoveMembersInput } from '@/modules/departments/types'
import * as svc from '@/shared/mocks/services/departments'
import { API, respond, userFrom } from './utils'

type P = { id: string }

/** Departments. Static paths come before /departments/:id. */
export const departmentHandlers = [
  http.get(`${API}/departments/org-chart`, ({ request }) => respond(() => svc.getOrgChart(userFrom(request)))),
  http.post(`${API}/departments/move-members`, async ({ request }) => {
    const body = (await request.json()) as MoveMembersInput
    return respond(() => svc.moveMembers(userFrom(request), body))
  }),
  http.get(`${API}/departments`, ({ request }) => {
    const inactive = new URL(request.url).searchParams.get('includeInactive') === 'true'
    return respond(() => svc.listDepartments(userFrom(request), inactive))
  }),
  http.post(`${API}/departments`, async ({ request }) => {
    const body = (await request.json()) as DepartmentInput
    return respond(() => svc.createDepartment(userFrom(request), body))
  }),
  http.get<P>(`${API}/departments/:id`, ({ request, params }) => respond(() => svc.getDepartment(userFrom(request), params.id))),
  http.patch<P>(`${API}/departments/:id`, async ({ request, params }) => {
    const body = (await request.json()) as DepartmentUpdateInput
    return respond(() => svc.updateDepartment(userFrom(request), params.id, body))
  }),
  http.post<P>(`${API}/departments/:id/deactivate`, ({ request, params }) =>
    respond(() => svc.setDepartmentActive(userFrom(request), params.id, false)),
  ),
  http.post<P>(`${API}/departments/:id/reactivate`, ({ request, params }) =>
    respond(() => svc.setDepartmentActive(userFrom(request), params.id, true)),
  ),
  http.patch<P & { userId: string }>(`${API}/departments/:id/members/:userId`, async ({ request, params }) => {
    const { managerId } = (await request.json()) as { managerId: string | null }
    return respond(() => svc.setMemberManager(userFrom(request), params.id, params.userId, managerId))
  }),
  http.post<P>(`${API}/departments/:id/goals`, async ({ request, params }) => {
    const body = (await request.json()) as GoalInput
    return respond(() => svc.addGoal(userFrom(request), params.id, body))
  }),
  http.patch<P & { goalId: string }>(`${API}/departments/:id/goals/:goalId`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<GoalInput>
    return respond(() => svc.updateGoal(userFrom(request), params.id, params.goalId, body))
  }),
  http.delete<P & { goalId: string }>(`${API}/departments/:id/goals/:goalId`, ({ request, params }) =>
    respond(() => svc.deleteGoal(userFrom(request), params.id, params.goalId)),
  ),
]
