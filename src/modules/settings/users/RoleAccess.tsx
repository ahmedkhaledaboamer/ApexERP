import type { ModuleKey, Role, Scope } from '@/shared/types'
import { PERMISSION_MATRIX, SCOPE_LABELS } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

export const MODULE_LABELS: Record<ModuleKey, string> = {
  sales: 'Sales & CRM',
  services: 'Services',
  marketing: 'Marketing',
  accounting: 'Accounting',
  hr: 'HR',
  reports: 'Reports',
  settings: 'Settings',
  departments: 'Departments',
  tasks: 'Tasks',
}

const MODULE_ORDER: ModuleKey[] = ['sales', 'services', 'marketing', 'accounting', 'hr', 'reports', 'settings', 'departments', 'tasks']

export const SCOPE_TONE: Record<Scope, Tone> = {
  full: 'green',
  team: 'blue',
  own: 'sky',
  view: 'amber',
  hidden: 'neutral',
  marketing: 'pink',
  finance: 'teal',
  hr: 'brand',
}

/** One-line description per role, for the role picker. */
export const ROLE_HINTS: Record<Role, string> = {
  'Company Admin': 'Runs the system: users, settings and every module.',
  Management: 'Sees everything; settings are view-only.',
  'Sales Manager': 'Runs the sales team; reports for the team.',
  'Sales Agent': 'Works their own leads and customers.',
  'Marketing Manager': 'Owns marketing; reads sales.',
  Accountant: 'Owns accounting; reads sales and services.',
  'HR Manager': 'Owns HR only.',
  'Department Head': 'Leads a department: team sales and HR.',
  Employee: 'Their own records only.',
}

export const ROLE_TONE: Record<Role, Tone> = {
  'Company Admin': 'red',
  Management: 'brand',
  'Sales Manager': 'blue',
  'Sales Agent': 'sky',
  'Marketing Manager': 'pink',
  Accountant: 'teal',
  'HR Manager': 'amber',
  'Department Head': 'green',
  Employee: 'neutral',
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={ROLE_TONE[role]} variant="dot">
      {role}
    </Badge>
  )
}

/** The role's row of the permission matrix: what each module looks like to this role. */
export function RoleAccess({ role, className }: { role: Role; className?: string }) {
  const row = PERMISSION_MATRIX[role]
  return (
    <div className={cn('rounded-lg border border-line bg-sunken/40', className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2">
        <p className="text-[0.8125rem] font-medium text-ink">What a {role} can access</p>
        <p className="hidden text-xs text-muted sm:block">From the permission matrix</p>
      </div>
      <ul className="grid grid-cols-1 gap-x-4 px-3 py-1.5 sm:grid-cols-2">
        {MODULE_ORDER.map((m) => {
          const scope = row[m]
          return (
            <li key={m} className="flex items-center justify-between gap-3 py-1.5">
              <span className={cn('text-[0.8125rem]', scope === 'hidden' ? 'text-subtle' : 'text-ink-2')}>{MODULE_LABELS[m]}</span>
              <Badge tone={SCOPE_TONE[scope]} variant={scope === 'hidden' ? 'outline' : 'soft'}>
                {SCOPE_LABELS[scope]}
              </Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
