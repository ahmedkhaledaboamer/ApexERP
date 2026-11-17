import type { Role, User } from '@/shared/types'

export interface Department {
  id: string
  name: string
}

/** A user as the Users & roles screen shows it. */
export interface SettingsUserRow extends User {
  departmentName: string
  /** '' when the user has no direct manager. */
  managerName: string
  directReports: number
  /** Leads they own that aren't won or lost (open or parked). */
  openLeads: number
}

export interface UserInput {
  name: string
  email: string
  mobile: string
  role: Role
  title: string
  departmentId: string
  managerId: string | null
}

export type UserUpdateInput = Partial<UserInput>

/** Deactivate either succeeds, or asks to confirm because the user still owns open leads (HTTP 409). */
export type DeactivateResult =
  | { status: 'deactivated'; user: SettingsUserRow }
  | { status: 'confirm'; openLeads: number; message: string }
