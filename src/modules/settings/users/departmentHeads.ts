import type { DepartmentRow } from '@/modules/departments/types'
import { buildTree, walk } from '@/modules/departments/lib/tree'

export interface HeadedDepartment {
  id: string
  name: string
}

/** userId → the active departments they head. */
export function headsIndex(departments: DepartmentRow[]): Map<string, HeadedDepartment[]> {
  const out = new Map<string, HeadedDepartment[]>()
  for (const d of departments) {
    if (!d.active || !d.headId) continue
    const list = out.get(d.headId) ?? []
    list.push({ id: d.id, name: d.name })
    out.set(d.headId, list)
  }
  return out
}

export interface DepartmentOption {
  id: string
  /** Indented by depth with non-breaking spaces (native <option> can't be styled). */
  label: string
  active: boolean
}

/**
 * Department picker options in tree order: active departments only, plus `keepId` (the current
 * value) when it is inactive so the field doesn't silently change.
 */
export function departmentOptions(departments: DepartmentRow[], keepId?: string): DepartmentOption[] {
  const out: DepartmentOption[] = []
  walk(buildTree(departments, (a, b) => a.name.localeCompare(b.name)), (t) => {
    const d = t.node
    if (!d.active && d.id !== keepId) return
    out.push({ id: d.id, label: `${'   '.repeat(t.depth)}${d.name}${d.active ? '' : ' (inactive)'}`, active: d.active })
  })
  return out
}

/** The department named in the server's "X heads Y. Pick a new head…" refusal (HTTP 422). */
export function headConflict(message: string, departments: DepartmentRow[]): HeadedDepartment | null {
  if (!/Pick a new head/i.test(message)) return null
  const hit = [...departments].sort((a, b) => b.name.length - a.name.length).find((d) => message.includes(`heads ${d.name}.`))
  return hit ? { id: hit.id, name: hit.name } : null
}
