import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarRange, Check, ChevronDown, UserCog } from 'lucide-react'
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectStatus, type ProjectUpdateInput } from '@/modules/tasks/types'
import { projectDatesSchema, type ProjectDatesValues } from '@/modules/tasks/projectSchemas'
import { useUpdateProject } from '@/modules/tasks/hooks/useTasks'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { ApiError } from '@/shared/lib/apiError'
import { DOT } from '@/shared/components/ui/Badge'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { Menu, MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextInput } from '@/shared/components/form/Field'
import { PROJECT_STATUS_TONE, ProjectStatusBadge, type ProjectDetail } from './projectUi'
import { useReadOnly } from '@/shared/lib/readOnly'

/** PATCH with a toast; `force` (complete with open tasks) rides along with the documented input. */
function usePatch(p: ProjectDetail) {
  const update = useUpdateProject()
  const toast = useToast()
  function patch(input: ProjectUpdateInput & { force?: boolean }, done: string, opts: { onSuccess?: () => void; onError?: (e: Error) => void } = {}) {
    update.mutate(
      { id: p.id, input },
      {
        onSuccess: () => {
          toast.success(done, p.name)
          opts.onSuccess?.()
        },
        onError: (e) => (opts.onError ? opts.onError(e) : toast.error('Project not updated', e.message)),
      },
    )
  }
  // Read-only workspace: managers see the plain values instead of the menus.
  const readOnly = useReadOnly()
  return { patch, pending: update.isPending, readOnly }
}

/** Status badge; managers get a menu. Completing with open tasks asks first, then sends `force`. */
export function StatusControl({ project: p }: { project: ProjectDetail }) {
  const { patch, pending, readOnly } = usePatch(p)
  const [confirm, setConfirm] = useState<string | null>(null)
  const open = p.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length

  if (!p.canManage || readOnly) return <ProjectStatusBadge status={p.status} />

  function pick(s: ProjectStatus) {
    if (s === p.status) return
    if (s === 'completed' && open > 0) {
      setConfirm(`${open} task${open === 1 ? ' is' : 's are'} still open.`)
      return
    }
    patch({ status: s }, `Status: ${PROJECT_STATUS_LABEL[s]}`, {
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) setConfirm(e.message)
      },
    })
  }

  return (
    <>
      <Menu
        align="start"
        className="w-48"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            disabled={pending}
            aria-label={`Status: ${PROJECT_STATUS_LABEL[p.status]}. Change status`}
            className="inline-flex items-center gap-0.5 rounded-md focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none disabled:opacity-60"
          >
            <ProjectStatusBadge status={p.status} />
            <ChevronDown className="size-3.5 text-muted" aria-hidden />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Project status</MenuLabel>
            {PROJECT_STATUSES.map((s) => (
              <MenuItem
                key={s}
                active={s === p.status}
                icon={<span className={`size-2 rounded-full ${DOT[PROJECT_STATUS_TONE[s]]}`} aria-hidden />}
                hint={s === p.status ? <Check className="size-3.5" aria-hidden /> : undefined}
                onSelect={() => {
                  close()
                  pick(s)
                }}
              >
                {PROJECT_STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title="Complete with open tasks?"
        description={confirm ?? undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Keep it open
            </Button>
            <Button write
              loading={pending}
              onClick={() => patch({ status: 'completed', force: true }, 'Project completed', { onSuccess: () => setConfirm(null) })}
            >
              Complete anyway
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-ink-2">Open tasks stay open on their owners’ lists. You can reopen the project later.</p>
      </Modal>
    </>
  )
}

/** Manager avatar + name; managers can hand the project to another active person. */
export function ManagerControl({ project: p }: { project: ProjectDetail }) {
  const { patch, pending, readOnly } = usePatch(p)
  const people = useUsersQuery()
  const [filter, setFilter] = useState('')
  const options = useMemo(
    () =>
      (people.data ?? [])
        .filter((u) => u.active !== false && u.name.toLowerCase().includes(filter.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people.data, filter],
  )
  const label = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={p.managerName} size="xs" />
      <span className="truncate">{p.managerName}</span>
    </span>
  )
  if (!p.canManage || readOnly) return label
  return (
    <Menu
      align="start"
      className="w-64"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          disabled={pending}
          aria-label={`Manager: ${p.managerName}. Change manager`}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 -ms-1 hover:bg-hover focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
        >
          {label}
          <UserCog className="size-3.5 shrink-0 text-muted" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Change project manager</MenuLabel>
          <div className="px-2 pb-1.5">
            <TextInput aria-label="Find a person" placeholder="Find a person…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8" />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {people.isPending && <p className="px-3 py-2 text-xs text-muted">Loading people…</p>}
            {people.isError && <p className="px-3 py-2 text-xs text-danger-600">Couldn’t load people.</p>}
            {options.map((u) => (
              <MenuItem
                key={u.id}
                active={u.id === p.managerId}
                icon={<Avatar name={u.name} size="xs" />}
                hint={u.id === p.managerId ? <Check className="size-3.5" aria-hidden /> : undefined}
                onSelect={() => {
                  close()
                  if (u.id !== p.managerId) patch({ managerId: u.id }, `Manager: ${u.name}`)
                }}
              >
                <span className="block truncate">{u.name}</span>
              </MenuItem>
            ))}
            {people.data && !options.length && <p className="px-3 py-2 text-xs text-muted">No one matches.</p>}
          </div>
        </>
      )}
    </Menu>
  )
}

/** Edit start/end dates (end ≥ start). */
export function DatesButton({ project: p }: { project: ProjectDetail }) {
  const [open, setOpen] = useState(false)
  const { patch, pending } = usePatch(p)
  const [error, setError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProjectDatesValues>({ resolver: zodResolver(projectDatesSchema), mode: 'onTouched' })

  useEffect(() => {
    if (open) {
      reset({ startDate: p.startDate, endDate: p.endDate })
      setError(null)
    }
  }, [open, p.startDate, p.endDate, reset])

  if (!p.canManage) return null
  const onSubmit = handleSubmit((v) =>
    patch(v, 'Dates saved', { onSuccess: () => setOpen(false), onError: (e) => setError(e.message) }),
  )
  return (
    <>
      <Button write variant="ghost" size="xs" iconOnly aria-label="Edit dates" title="Edit dates" onClick={() => setOpen(true)}>
        <CalendarRange />
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Project dates"
        description="Task due dates don’t move with the project."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button write type="submit" form="project-dates" loading={pending}>
              Save dates
            </Button>
          </>
        }
      >
        <form id="project-dates" noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="pd-start" label="Start date" required error={errors.startDate?.message}>
            <TextInput id="pd-start" type="date" invalid={!!errors.startDate} {...register('startDate')} />
          </Field>
          <Field id="pd-end" label="End date" required error={errors.endDate?.message}>
            <TextInput id="pd-end" type="date" invalid={!!errors.endDate} {...register('endDate')} />
          </Field>
          {error && (
            <p role="alert" className="text-xs text-danger-600 sm:col-span-2">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  )
}
