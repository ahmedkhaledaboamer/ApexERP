import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crown, Info } from 'lucide-react'
import { managerValue, moveMembersSchema } from '@/modules/departments/schemas'
import { useDepartmentsQuery, useMoveMembers } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { plural } from '@/modules/departments/components/DepartmentBits'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SearchInput, SelectInput } from '@/shared/components/form/Field'

interface AddMembersDialogProps {
  open: boolean
  onClose: () => void
  to: { id: string; name: string }
}

/**
 * "Add members": moves people from their current department into this one. A person belongs to
 * exactly one department, so each candidate shows where they are now. Full scope only.
 */
export function AddMembersDialog({ open, onClose, to }: AddMembersDialogProps) {
  const usersQuery = useUsersQuery()
  const depts = useDepartmentsQuery(true)
  const move = useMoveMembers()
  const toast = useToast()
  const [selected, setSelected] = useState<string[]>([])
  const [manager, setManager] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelected([])
    setManager('')
    setSearch('')
    setError(null)
    move.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const deptName = useMemo(() => new Map((depts.data ?? []).map((d) => [d.id, d.name])), [depts.data])
  const headOf = useMemo(() => new Map((depts.data ?? []).filter((d) => d.headId && d.active).map((d) => [d.headId as string, d.name])), [depts.data])

  const candidates = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.active !== false && u.departmentId !== to.id).sort((a, b) => a.name.localeCompare(b.name)),
    [usersQuery.data, to.id],
  )
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((u) => `${u.name} ${u.title} ${u.email} ${deptName.get(u.departmentId) ?? ''}`.toLowerCase().includes(q))
  }, [candidates, search, deptName])

  const managers = useMemo(() => {
    const active = (usersQuery.data ?? []).filter((u) => u.active !== false && !selected.includes(u.id))
    return {
      here: active.filter((u) => u.departmentId === to.id).sort((a, b) => a.name.localeCompare(b.name)),
      others: active.filter((u) => u.departmentId !== to.id).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }, [usersQuery.data, selected, to.id])

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function submit() {
    const parsed = moveMembersSchema.safeParse({ userIds: selected, toDepartmentId: to.id, managerId: manager })
    if (!parsed.success) {
      setError(parsed.error.flatten().fieldErrors.userIds?.[0] ?? 'Check the form.')
      return
    }
    setError(null)
    move.mutate(
      { userIds: parsed.data.userIds, toDepartmentId: to.id, managerId: managerValue(parsed.data.managerId) },
      {
        onSuccess: (res) => {
          toast.success(`Added ${plural(res.moved, 'person', 'people')}`, `Now in ${to.name}`)
          onClose()
        },
        onError: (e) => setError(e.message),
      },
    )
  }

  return createPortal(
    <Modal
      open={open}
      onClose={() => !move.isPending && onClose()}
      title={`Add members to ${to.name}`}
      description="People belong to one department. Adding them here moves them out of their current one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <Button write onClick={submit} loading={move.isPending}>
            {selected.length ? `Add ${plural(selected.length, 'person', 'people')}` : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SearchInput aria-label="Search people" placeholder="Search name, title or department…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {usersQuery.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[0.8125rem] text-muted">Everyone active is already in {to.name}.</p>
        ) : (
          <ul className={cn('max-h-72 divide-y divide-line overflow-y-auto rounded-lg border', error && !selected.length ? 'border-danger-500' : 'border-line')}>
            {shown.map((u) => {
              const heads = headOf.get(u.id)
              return (
                <li key={u.id}>
                  <label className={cn('flex items-center gap-3 px-3 py-2', heads ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-hover')}>
                    <Checkbox checked={selected.includes(u.id)} disabled={!!heads} onChange={() => toggle(u.id)} aria-label={`Select ${u.name}`} />
                    <Avatar name={u.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-medium text-ink">{u.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {u.title || u.role} · {deptName.get(u.departmentId) ?? 'No department'}
                      </span>
                    </span>
                    {heads && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted" title={`Pick a new head for ${heads} before moving them`}>
                        <Crown className="size-3.5" aria-hidden />
                        Heads {heads}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
            {shown.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No one matches “{search}”.</li>}
          </ul>
        )}

        <Field id="am-manager" label="Direct manager" hint="Optional. Applies to everyone added.">
          <SelectInput id="am-manager" value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">Keep their current managers</option>
            <option value="__none">No manager</option>
            {managers.here.length > 0 && (
              <optgroup label={`In ${to.name}`}>
                {managers.here.map((u) => (
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

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </Modal>,
    document.body,
  )
}
