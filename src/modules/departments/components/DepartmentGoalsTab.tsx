import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format, isBefore, parseISO, startOfDay } from 'date-fns'
import { CalendarClock, Check, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import type { User } from '@/shared/types'
import type { DepartmentDetail, DepartmentGoal } from '@/modules/departments/types'
import { goalSchema, type GoalFormInput, type GoalValues } from '@/modules/departments/schemas'
import { useAddGoal, useDeleteGoal, useUpdateGoal } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'

interface GoalsTabProps {
  dept: DepartmentDetail
  /** Full scope or this department's head (`can.editGoals`). */
  canEdit: boolean
}

const isOverdue = (g: DepartmentGoal) => g.status === 'Open' && !!g.dueDate && isBefore(parseISO(g.dueDate), startOfDay(new Date()))

/** Department goals: an editable checklist with owner and due date. */
export function DepartmentGoalsTab({ dept, canEdit }: GoalsTabProps) {
  const usersQuery = useUsersQuery()
  const add = useAddGoal(dept.id)
  const update = useUpdateGoal(dept.id)
  const remove = useDeleteGoal(dept.id)
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<DepartmentGoal | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const people = useMemo(() => (usersQuery.data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [usersQuery.data])
  const nameOf = useMemo(() => new Map((usersQuery.data ?? []).map((u) => [u.id, u.name])), [usersQuery.data])
  const open = dept.goals.filter((g) => g.status === 'Open')
  const done = dept.goals.filter((g) => g.status === 'Done')

  function toggle(g: DepartmentGoal) {
    setPendingId(g.id)
    update.mutate(
      { goalId: g.id, input: { status: g.status === 'Open' ? 'Done' : 'Open' } },
      {
        onError: (e) => toast.error('Couldn’t update the goal', e.message),
        onSettled: () => setPendingId(null),
      },
    )
  }

  function confirmDelete() {
    if (!deleting) return
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Goal removed', deleting.title)
        setDeleting(null)
      },
      onError: (e) => toast.error('Couldn’t remove the goal', e.message),
    })
  }

  const row = (g: DepartmentGoal) =>
    editingId === g.id ? (
      <li key={g.id} className="px-5 py-3">
        <GoalForm
          people={people}
          deptId={dept.id}
          initial={g}
          pending={update.isPending}
          error={update.error?.message}
          onCancel={() => setEditingId(null)}
          onSubmit={(v) =>
            update.mutate(
              { goalId: g.id, input: v },
              {
                onSuccess: () => {
                  toast.success('Goal saved', v.title)
                  setEditingId(null)
                },
              },
            )
          }
        />
      </li>
    ) : (
      <li key={g.id} className="group flex items-start gap-3 px-5 py-3">
        {canEdit ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={g.status === 'Done'}
            aria-label={g.status === 'Done' ? `Reopen “${g.title}”` : `Mark “${g.title}” done`}
            disabled={pendingId === g.id}
            onClick={() => toggle(g)}
            className={cn(
              'mt-0.5 flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50',
              g.status === 'Done' ? 'border-success-600 bg-success-600 text-white' : 'border-line-strong hover:border-success-600',
            )}
          >
            {g.status === 'Done' && <Check className="size-3" aria-hidden />}
          </button>
        ) : (
          <span
            aria-label={g.status}
            className={cn(
              'mt-0.5 flex size-[1.125rem] shrink-0 items-center justify-center rounded-full border',
              g.status === 'Done' ? 'border-success-600 bg-success-600 text-white' : 'border-line-strong',
            )}
          >
            {g.status === 'Done' && <Check className="size-3" aria-hidden />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-[0.8125rem] font-medium break-words', g.status === 'Done' ? 'text-muted line-through' : 'text-ink')}>{g.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {g.ownerId ? (
              <span className="flex items-center gap-1.5">
                <Avatar name={nameOf.get(g.ownerId) ?? '?'} size="xs" />
                {nameOf.get(g.ownerId) ?? 'Unknown owner'}
              </span>
            ) : (
              <span>No owner</span>
            )}
            <span className={cn('flex items-center gap-1', isOverdue(g) && 'font-medium text-danger-600 dark:text-danger-500')}>
              <CalendarClock className="size-3.5" aria-hidden />
              {g.dueDate ? `${isOverdue(g) ? 'Overdue · ' : 'Due '}${fmtDate(g.dueDate)}` : 'No due date'}
            </span>
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <Button variant="ghost" size="xs" iconOnly aria-label={`Edit “${g.title}”`} onClick={() => {
                update.reset()
                setEditingId(g.id)
              }}
            >
              <Pencil />
            </Button>
            <Button variant="ghost" size="xs" iconOnly aria-label={`Remove “${g.title}”`} onClick={() => setDeleting(g)}>
              <Trash2 />
            </Button>
          </div>
        )}
      </li>
    )

  return (
    <Card>
      <CardHeader
        icon={<Target />}
        title="Department goals"
        description={`${open.length} open · ${done.length} done${canEdit ? '' : ' · Only the head or an admin can edit goals'}`}
        action={
          canEdit &&
          !adding && (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus />
              Add goal
            </Button>
          )
        }
      />
      {dept.goals.length === 0 && !adding ? (
        <EmptyState
          icon={<Target />}
          title="No goals yet"
          body={canEdit ? 'Add what this team is working towards, with an owner and a due date.' : 'The head hasn’t set goals for this department yet.'}
          action={
            canEdit ? (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add goal
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {open.map(row)}
          {done.map(row)}
        </ul>
      )}
      {adding && (
        <div className="border-t border-line px-5 py-4">
          <GoalForm
            people={people}
            deptId={dept.id}
            pending={add.isPending}
            error={add.error?.message}
            onCancel={() => {
              setAdding(false)
              add.reset()
            }}
            onSubmit={(v) =>
              add.mutate(v, {
                onSuccess: () => {
                  toast.success('Goal added', v.title)
                  setAdding(false)
                },
              })
            }
          />
        </div>
      )}
      {canEdit &&
        createPortal(
          <Modal
            open={!!deleting}
            onClose={() => setDeleting(null)}
            size="sm"
            title="Remove this goal?"
            description={deleting ? `“${deleting.title}” will be removed. The change is kept in the audit log.` : undefined}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDeleting(null)}>
                  Keep it
                </Button>
                <Button variant="danger" loading={remove.isPending} onClick={confirmDelete}>
                  Remove goal
                </Button>
              </>
            }
          >
            <p className="text-[0.8125rem] text-ink-2">Mark it done instead if the goal was reached.</p>
          </Modal>,
          document.body,
        )}
    </Card>
  )
}

/* ---------------- Form ---------------- */

interface GoalFormProps {
  people: User[]
  deptId: string
  initial?: DepartmentGoal
  pending: boolean
  error?: string
  onCancel: () => void
  onSubmit: (values: GoalValues) => void
}

function GoalForm({ people, deptId, initial, pending, error, onCancel, onSubmit }: GoalFormProps) {
  const prefix = initial ? `goal-${initial.id}` : 'goal-new'
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GoalFormInput, unknown, GoalValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: { title: initial?.title ?? '', ownerId: initial?.ownerId ?? '', dueDate: initial?.dueDate ?? '' },
  })

  useEffect(() => {
    reset({ title: initial?.title ?? '', ownerId: initial?.ownerId ?? '', dueDate: initial?.dueDate ?? '' })
    // Only when switching goals; a background refetch mustn't wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id, reset])

  const here = people.filter((u) => u.departmentId === deptId)
  const others = people.filter((u) => u.departmentId !== deptId)
  const ownerKnown = !initial?.ownerId || people.some((u) => u.id === initial.ownerId)

  return (
    <form
      noValidate
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
      className="space-y-3"
    >
      <Field id={`${prefix}-title`} label="Goal" required error={errors.title?.message}>
        <TextInput id={`${prefix}-title`} autoFocus maxLength={160} placeholder="e.g. Answer every inbound lead within 2 hours" invalid={!!errors.title} {...register('title')} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-owner`} label="Owner" error={errors.ownerId?.message}>
          <SelectInput id={`${prefix}-owner`} invalid={!!errors.ownerId} {...register('ownerId')}>
            <option value="">No owner</option>
            {!ownerKnown && initial?.ownerId && <option value={initial.ownerId}>Inactive user</option>}
            {here.length > 0 && (
              <optgroup label="This department">
                {here.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Others">
              {others.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          </SelectInput>
        </Field>
        <Field id={`${prefix}-due`} label="Due date" error={errors.dueDate?.message}>
          <TextInput id={`${prefix}-due`} type="date" min={initial ? undefined : format(new Date(), 'yyyy-MM-dd')} invalid={!!errors.dueDate} {...register('dueDate')} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          {initial ? 'Save goal' : 'Add goal'}
        </Button>
      </div>
    </form>
  )
}
