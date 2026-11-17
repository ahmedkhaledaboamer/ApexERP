import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Info } from 'lucide-react'
import { managerValue, moveMembersSchema } from '@/modules/departments/schemas'
import { useDepartmentsQuery, useMoveMembers, useUpdateDepartment } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { plural, treeOrder } from '@/modules/departments/components/DepartmentBits'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SearchInput, SelectInput } from '@/shared/components/form/Field'

interface MoveMembersDialogProps {
  open: boolean
  onClose: () => void
  /** The department people leave. */
  from: { id: string; name: string; headId: string | null }
  /** Ticked when the dialog opens (e.g. everyone, before deactivating). */
  preselectedIds?: string[]
  /** Extra context shown above the list. */
  intro?: ReactNode
  onMoved?: (moved: number) => void
}

/**
 * Bulk "Move members": moves people from one department to another (the same field as their
 * department in Settings › Users & roles). The head can't be moved while heading, so picking
 * them removes them as head first. Full scope only; callers gate it.
 */
export function MoveMembersDialog({ open, onClose, from, preselectedIds, intro, onMoved }: MoveMembersDialogProps) {
  const usersQuery = useUsersQuery()
  const depts = useDepartmentsQuery(false)
  const move = useMoveMembers()
  const update = useUpdateDepartment()
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [manager, setManager] = useState('')
  const [search, setSearch] = useState('')
  const [errors, setErrors] = useState<{ userIds?: string; toDepartmentId?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected(preselectedIds ?? [])
    setTarget('')
    setManager('')
    setSearch('')
    setErrors({})
    setServerError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const members = useMemo(
    () =>
      (usersQuery.data ?? [])
        .filter((u) => u.departmentId === from.id && u.active !== false)
        .sort((a, b) => Number(b.id === from.headId) - Number(a.id === from.headId) || a.name.localeCompare(b.name)),
    [usersQuery.data, from.id, from.headId],
  )
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? members.filter((m) => `${m.name} ${m.title} ${m.email}`.toLowerCase().includes(q)) : members
  }, [members, search])

  const targets = useMemo(() => {
    const rows = (depts.data ?? []).filter((d) => d.active)
    const order = treeOrder(rows)
    return rows
      .filter((d) => d.id !== from.id)
      .sort((a, b) => (order.get(a.id)?.order ?? 0) - (order.get(b.id)?.order ?? 0))
      .map((d) => ({ id: d.id, label: `${'  '.repeat(order.get(d.id)?.depth ?? 0)}${d.name}` }))
  }, [depts.data, from.id])

  const managers = useMemo(() => {
    const active = (usersQuery.data ?? []).filter((u) => u.active !== false && !selected.includes(u.id))
    return {
      inTarget: active.filter((u) => u.departmentId === target).sort((a, b) => a.name.localeCompare(b.name)),
      others: active.filter((u) => u.departmentId !== target).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [usersQuery.data, selected, target])

  const headPicked = !!from.headId && selected.includes(from.headId)
  const headName = members.find((m) => m.id === from.headId)?.name
  const pending = move.isPending || update.isPending
  const allShown = shown.length > 0 && shown.every((m) => selected.includes(m.id))

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function submit() {
    const parsed = moveMembersSchema.safeParse({ userIds: selected, toDepartmentId: target, managerId: manager })
    if (!parsed.success) {
      const f = parsed.error.flatten().fieldErrors
      setErrors({ userIds: f.userIds?.[0], toDepartmentId: f.toDepartmentId?.[0] })
      return
    }
    setErrors({})
    setServerError(null)
    try {
      if (headPicked) await update.mutateAsync({ id: from.id, input: { headId: null } })
      const res = await move.mutateAsync({
        userIds: parsed.data.userIds,
        toDepartmentId: parsed.data.toDepartmentId,
        managerId: managerValue(parsed.data.managerId),
      })
      const to = targets.find((t) => t.id === parsed.data.toDepartmentId)?.label.trim() ?? 'the new department'
      toast.success(`Moved ${plural(res.moved, 'person', 'people')}`, `${from.name} → ${to}`)
      onMoved?.(res.moved)
      onClose()
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Couldn’t move them.')
    }
  }

  return createPortal(
    <Modal
      open={open}
      onClose={() => !pending && onClose()}
      title={`Move members out of ${from.name}`}
      description="They’re moved to the department you pick. Settings › Users & roles shows the same change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!members.length}>
            {selected.length ? `Move ${plural(selected.length, 'person', 'people')}` : 'Move'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {intro}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem] font-medium text-ink-2">
              People <span className="num font-normal text-muted">· {selected.length} of {members.length} selected</span>
            </p>
            {shown.length > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                onClick={() =>
                  setSelected((s) => (allShown ? s.filter((id) => !shown.some((m) => m.id === id)) : [...new Set([...s, ...shown.map((m) => m.id)])]))
                }
              >
                {allShown ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {members.length > 6 && <SearchInput aria-label="Search members" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />}
          {usersQuery.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[0.8125rem] text-muted">{from.name} has no active members.</p>
          ) : (
            <ul className={cn('max-h-64 divide-y divide-line overflow-y-auto rounded-lg border', errors.userIds ? 'border-danger-500' : 'border-line')}>
              {shown.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover">
                    <Checkbox checked={selected.includes(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} />
                    <Avatar name={m.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-medium text-ink">{m.name}</span>
                      <span className="block truncate text-xs text-muted">{m.title || m.role}</span>
                    </span>
                    {m.id === from.headId && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-700 dark:text-warning-500">
                        <Crown className="size-3.5" aria-hidden />
                        Head
                      </span>
                    )}
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No one matches “{search}”.</li>}
            </ul>
          )}
          {errors.userIds && <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{errors.userIds}</p>}
        </div>

        {headPicked && (
          <p className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
            <Crown className="mt-0.5 size-4 shrink-0" aria-hidden />
            {headName ?? 'The head'} heads {from.name}. They’ll be removed as head first; {from.name} will have no head until you pick one.
          </p>
        )}

        <Field id="mm-target" label="Move to" required error={errors.toDepartmentId}>
          <SelectInput id="mm-target" value={target} onChange={(e) => setTarget(e.target.value)} invalid={!!errors.toDepartmentId} disabled={depts.isPending}>
            <option value="">{depts.isPending ? 'Loading…' : 'Choose a department…'}</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field id="mm-manager" label="Direct manager" hint="Optional. Applies to everyone moved.">
          <SelectInput id="mm-manager" value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">Keep their current managers</option>
            <option value="__none">No manager</option>
            {managers.inTarget.length > 0 && (
              <optgroup label="In the new department">
                {managers.inTarget.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Everyone else">
              {managers.others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          </SelectInput>
        </Field>

        {serverError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {serverError}
          </p>
        )}
      </div>
    </Modal>,
    document.body,
  )
}
