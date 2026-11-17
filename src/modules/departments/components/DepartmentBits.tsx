import { CheckCircle2, CircleSlash, Network } from 'lucide-react'
import type { Role } from '@/shared/types'
import type { DepartmentRow } from '@/modules/departments/types'
import { can, scopeOf } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

/**
 * What the signed-in role may do in Departments (client-side gate; the server decides again and
 * returns `detail.can`). Only full scope changes structure and moves people.
 */
export function useDepartmentsAccess() {
  const user = useCurrentUser()
  const scope = user ? scopeOf(user.role, 'departments') : 'hidden'
  return {
    user,
    scope,
    /** Admin / Management / HR: create, edit, (de)activate, move members. */
    isFull: scope === 'full',
    /** The matrix allows edits at all (full or team). */
    canEditModule: !!user && can(user.role, 'departments', 'edit'),
  }
}

export function apiStatus(e: unknown): number {
  return e instanceof ApiError ? e.status : 0
}

export function DepartmentActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="green" icon={<CheckCircle2 />}>
      Active
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<CircleSlash />}>
      Inactive
    </Badge>
  )
}

/** Square tile with the department glyph. */
export function DepartmentIcon({ size = 'md', muted }: { size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border',
        muted
          ? 'border-line bg-sunken text-muted'
          : 'border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300',
        size === 'sm' && 'size-7 [&_svg]:size-3.5',
        size === 'md' && 'size-9 [&_svg]:size-[1.125rem]',
        size === 'lg' && 'size-12 rounded-xl [&_svg]:size-6',
      )}
    >
      <Network />
    </span>
  )
}

const ROLE_TONE: Record<Role, Tone> = {
  'System Admin': 'red',
  Management: 'brand',
  'Sales Manager': 'blue',
  'Sales Agent': 'sky',
  'Marketing Manager': 'pink',
  Accountant: 'teal',
  'HR Manager': 'amber',
  'Department Head': 'brand',
  Employee: 'neutral',
}

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={ROLE_TONE[role] ?? 'neutral'} variant="dot">
      {role}
    </Badge>
  )
}

/**
 * Depth-first order of the visible departments (children under their parent, A–Z). Depth is
 * relative to what the caller can see, so a team-scoped head's subtree starts at 0.
 */
export function treeOrder(rows: Pick<DepartmentRow, 'id' | 'name' | 'parentId'>[]): Map<string, { order: number; depth: number }> {
  const ids = new Set(rows.map((r) => r.id))
  const byParent = new Map<string | null, typeof rows>()
  for (const r of rows) {
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null
    byParent.set(key, [...(byParent.get(key) ?? []), r])
  }
  const out = new Map<string, { order: number; depth: number }>()
  let i = 0
  const walk = (parent: string | null, depth: number) => {
    for (const r of [...(byParent.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.has(r.id)) continue
      out.set(r.id, { order: i++, depth })
      walk(r.id, depth + 1)
    }
  }
  walk(null, 0)
  // Anything left (a broken parent chain) goes last, at top level.
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, { order: i++, depth: 0 })
  return out
}

/** All descendants of `id` (any active state), for excluding cycle-making parents. */
export function descendantsOf(id: string, rows: Pick<DepartmentRow, 'id' | 'parentId'>[]): Set<string> {
  const out = new Set<string>([id])
  let added = true
  while (added) {
    added = false
    for (const r of rows) {
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id)
        added = true
      }
    }
  }
  return out
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
