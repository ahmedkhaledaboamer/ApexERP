import { http } from '@/shared/lib/axios'
import type {
  DeactivateResult,
  Department,
  SettingsUserRow,
  UserInput,
  UserUpdateInput,
} from '@/modules/settings/users/types'
import { departmentOptionMapper, settingsUserMapper } from '@/shared/api/mappers'

/** Settings › Users: the users columns on the wire (department_id, manager_id, is_active…), mapped both ways. */

export async function getSettingsUsers(): Promise<SettingsUserRow[]> {
  return settingsUserMapper.fromApiList((await http.get<unknown>('/settings/users')).data)
}

export async function getDepartments(): Promise<Department[]> {
  return departmentOptionMapper.fromApiList((await http.get<unknown>('/settings/departments')).data)
}

export async function createUser(input: UserInput): Promise<SettingsUserRow> {
  return settingsUserMapper.fromApi((await http.post<unknown>('/settings/users', settingsUserMapper.toApi(input as never))).data)
}

export async function updateUser(id: string, input: UserUpdateInput): Promise<SettingsUserRow> {
  return settingsUserMapper.fromApi((await http.patch<unknown>(`/settings/users/${id}`, settingsUserMapper.toApi(input as never))).data)
}

/**
 * Deactivates a user. Without `confirm`, a user who still owns open leads comes back as
 * `{ status: 'confirm' }` (HTTP 409 with `openLeads`) so the screen can warn first.
 */
export async function deactivateUser(id: string, confirm = false): Promise<DeactivateResult> {
  const res = await http.post<SettingsUserRow | { message: string; openLeads: number }>(
    `/settings/users/${id}/deactivate`,
    { confirm },
    { validateStatus: (s) => (s >= 200 && s < 300) || s === 409 },
  )
  if (res.status === 409) {
    const body = res.data as { message: string; openLeads: number }
    return { status: 'confirm', openLeads: body.openLeads, message: body.message }
  }
  return { status: 'deactivated', user: settingsUserMapper.fromApi(res.data) }
}

export async function reactivateUser(id: string): Promise<SettingsUserRow> {
  return settingsUserMapper.fromApi((await http.post<unknown>(`/settings/users/${id}/reactivate`)).data)
}
