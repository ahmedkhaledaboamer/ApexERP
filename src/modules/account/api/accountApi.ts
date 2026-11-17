import { http } from '@/shared/lib/axios'
import type { AccountInfo, ChangePasswordInput, PasswordChanged } from '@/modules/account/types'

export async function getAccount(): Promise<AccountInfo> {
  return (await http.get<AccountInfo>('/account')).data
}

export async function changePassword(input: ChangePasswordInput): Promise<PasswordChanged> {
  return (await http.post<PasswordChanged>('/account/password', input)).data
}
