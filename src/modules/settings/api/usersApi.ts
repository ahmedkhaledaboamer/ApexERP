import { http } from '@/shared/lib/axios'
import type {
  DeactivateResult,
  Department,
  SettingsUserRow,
  UserInput,
  UserUpdateInput,
} from '@/modules/settings/users/types'

export async function getSettingsUsers(): Promise<SettingsUserRow[]> {
  return (await http.get<SettingsUserRow[]>('/settings/users')).data
}

export async function getDepartments(): Promise<Department[]> {
  return (await http.get<Department[]>('/settings/departments')).data
}

export async function createUser(input: UserInput): Promise<SettingsUserRow> {
  return (await http.post<SettingsUserRow>('/settings/users', input)).data
}

export async function updateUser(id: string, input: UserUpdateInput): Promise<SettingsUserRow> {
  return (await http.patch<SettingsUserRow>(`/settings/users/${id}`, input)).data
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
  return { status: 'deactivated', user: res.data as SettingsUserRow }
}

export async function reactivateUser(id: string): Promise<SettingsUserRow> {
  return (await http.post<SettingsUserRow>(`/settings/users/${id}/reactivate`)).data
}
