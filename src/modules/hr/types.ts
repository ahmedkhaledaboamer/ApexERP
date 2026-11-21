/**
 * HR core contract (shared by every HR section: employees, contracts, assets, attendance, leave,
 * recruitment, training, salary, reports). Field names are the UI's camelCase; the API speaks
 * snake_case through the mapping layer (src/shared/api/mapping.ts), like every other module.
 *
 * ID convention (stable, so every HR seed can reference employees without importing each other):
 *   - an employee who is also a system user:  `EMP-<userId>`  (EMP-u1, EMP-u101 …)
 *   - an employee without a login:            `EMP-X<n>`      (EMP-X1 …)
 * Employees are company-scoped (Tenant<Employee> on the server); the client never sends company_id.
 */

export type EmploymentStatus = 'onboarding' | 'active' | 'on_leave' | 'notice' | 'terminated'
export const EMPLOYMENT_STATUSES: EmploymentStatus[] = ['onboarding', 'active', 'on_leave', 'notice', 'terminated']
export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  on_leave: 'On leave',
  notice: 'Notice period',
  terminated: 'Left',
}

export type EmploymentType = 'full_time' | 'part_time' | 'contractor' | 'intern'
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contractor: 'Contractor',
  intern: 'Intern',
}

export type Gender = 'male' | 'female'

/** The employee record every HR section links to (employee_id). Details live in each section's own store. */
export interface Employee {
  id: string
  /** System user behind this employee, if any (null for staff without a login). */
  userId: string | null
  /** Company employee number, unique per company (e.g. APX-0001). */
  employeeNo: string
  fullName: string
  jobTitle: string
  departmentId: string | null
  /** Direct manager (an employee id). */
  managerId: string | null
  email: string
  mobile: string
  nationality: string // ISO 3166-1 alpha-2, e.g. AE, IN, EG
  gender: Gender | null
  dateOfBirth: string | null // yyyy-MM-dd
  hireDate: string // yyyy-MM-dd, company-local
  employmentType: EmploymentType
  status: EmploymentStatus
  /** Last working day when leaving (notice / terminated). */
  exitDate: string | null
  createdAt: string
  updatedAt: string
}
