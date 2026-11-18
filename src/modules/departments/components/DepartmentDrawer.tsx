import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { ArrowRightLeft, Info } from 'lucide-react'
import { departmentPath } from '@/app/paths'
import type { DepartmentRow } from '@/modules/departments/types'
import { departmentSchema, type DepartmentFormInput, type DepartmentValues } from '@/modules/departments/schemas'
import { useCreateDepartment, useDepartmentsQuery, useUpdateDepartment } from '@/modules/departments/hooks/useDepartments'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { apiStatus, descendantsOf, treeOrder } from '@/modules/departments/components/DepartmentBits'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'

interface DepartmentDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this department; omit to create one. */
  department?: DepartmentRow | null
  /** Pre-picked parent for a new department. */
  defaultParentId?: string | null
  /** After creating, open the new department's page. */
  openAfterCreate?: boolean
}

const EMPTY: DepartmentFormInput = { name: '', parentId: '', headId: '', costCenter: '' }

/** New / edit department: name, parent, head, cost center. Full scope only (callers gate it). */
export function DepartmentDrawer({ open, onClose, department, defaultParentId, openAfterCreate }: DepartmentDrawerProps) {
  const editing = !!department
  const create = useCreateDepartment()
  const update = useUpdateDepartment()
  const toast = useToast()
  const navigate = useNavigate()
  const depts = useDepartmentsQuery(true)
  const usersQuery = useUsersQuery()
  /** Set when the server says the new head isn't a member yet (409): ask before moving them in. */
  const [confirmHead, setConfirmHead] = useState<DepartmentValues | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<DepartmentFormInput, unknown, DepartmentValues>({ resolver: zodResolver(departmentSchema), mode: 'onTouched', defaultValues: EMPTY })

  useEffect(() => {
    if (!open) return
    reset(
      department
        ? { name: department.name, parentId: department.parentId ?? '', headId: department.headId ?? '', costCenter: department.costCenter }
        : { ...EMPTY, parentId: defaultParentId ?? '' },
    )
    setConfirmHead(null)
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, department?.id])

  const rows = useMemo(() => depts.data ?? [], [depts.data])
  const deptName = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows])
  /** Who heads which department: a head can't be moved out of theirs. */
  const headOf = useMemo(() => new Map(rows.filter((r) => r.headId).map((r) => [r.headId as string, r])), [rows])

  const parentOptions = useMemo(() => {
    const blocked = department ? descendantsOf(department.id, rows) : new Set<string>()
    const order = treeOrder(rows.filter((r) => r.active))
    return rows
      .filter((r) => r.active && !blocked.has(r.id))
      .sort((a, b) => (order.get(a.id)?.order ?? 0) - (order.get(b.id)?.order ?? 0))
      .map((r) => ({ id: r.id, label: `${'  '.repeat(order.get(r.id)?.depth ?? 0)}${r.name}` }))
  }, [rows, department])

  const people = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [usersQuery.data],
  )

  const headId = watch('headId')
  const head = people.find((u) => u.id === headId)
  const headIsOutsider = !!head && head.departmentId !== department?.id

  const pending = create.isPending || update.isPending
  const error = confirmHead ? null : (create.error ?? update.error)

  function close() {
    if (isDirty && !pending && !window.confirm('Discard your changes to this department?')) return
    onClose()
  }

  function save(v: DepartmentValues, moveHeadIn = false) {
    if (department) {
      const input = {
        name: v.name,
        parentId: v.parentId,
        costCenter: v.costCenter,
        ...(v.headId !== department.headId ? { headId: v.headId, moveHeadIn } : {}),
      }
      update.mutate(
        { id: department.id, input },
        {
          onSuccess: (row) => {
            toast.success('Department saved', row.name)
            setConfirmHead(null)
            onClose()
          },
          onError: (e) => {
            if (apiStatus(e) === 409 && v.headId && !moveHeadIn) setConfirmHead(v)
          },
        },
      )
      return
    }
    create.mutate(
      { name: v.name, parentId: v.parentId, headId: v.headId, costCenter: v.costCenter },
      {
        onSuccess: (row) => {
          toast.success('Department created', row.name)
          onClose()
          if (openAfterCreate) navigate(departmentPath(row.id))
        },
      },
    )
  }

  const onSubmit = handleSubmit((v) => save(v))
  const confirmName = confirmHead ? people.find((u) => u.id === confirmHead.headId)?.name ?? 'this person' : ''

  return (
    <Drawer
      open={open}
      onClose={close}
      width="md"
      title={editing ? 'Edit department' : 'New department'}
      description={department ? department.name : 'Add a department to the company structure.'}
      footer={
        confirmHead ? undefined : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button write type="submit" form="department-form" loading={pending}>
              {editing ? 'Save department' : 'Create department'}
            </Button>
          </>
        )
      }
    >
      <form id="department-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <Field id="dp-name" label="Department name" required error={errors.name?.message}>
          <TextInput id="dp-name" placeholder="e.g. Customer success" maxLength={80} invalid={!!errors.name} {...register('name')} />
        </Field>

        <Field id="dp-parent" label="Parent department" error={errors.parentId?.message} hint="Leave empty for a top-level department. Inactive departments can’t be parents.">
          <SelectInput id="dp-parent" disabled={depts.isPending} invalid={!!errors.parentId} {...register('parentId')}>
            <option value="">{depts.isPending ? 'Loading…' : 'None (top level)'}</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field
          id="dp-head"
          label="Head"
          error={errors.headId?.message}
          hint={
            head && headIsOutsider
              ? editing
                ? `${head.name} is in ${deptName.get(head.departmentId) ?? 'another department'}. You’ll be asked to confirm moving them in.`
                : `${head.name} will be moved into this department (from ${deptName.get(head.departmentId) ?? 'their current one'}).`
              : 'The head must be a member. Someone picked from another department will be moved into this department.'
          }
        >
          <SelectInput id="dp-head" disabled={usersQuery.isPending} invalid={!!errors.headId} {...register('headId')}>
            <option value="">{usersQuery.isPending ? 'Loading…' : 'No head yet'}</option>
            {people.map((u) => {
              const heads = headOf.get(u.id)
              const blocked = !!heads && heads.id !== department?.id
              return (
                <option key={u.id} value={u.id} disabled={blocked}>
                  {u.name} · {deptName.get(u.departmentId) ?? 'No department'}
                  {blocked ? ` (heads ${heads.name})` : ''}
                </option>
              )
            })}
          </SelectInput>
        </Field>

        <Field id="dp-cc" label="Cost center" error={errors.costCenter?.message} hint="Optional. Used by Accounting in phase 3.">
          <TextInput id="dp-cc" placeholder="e.g. CC-210" maxLength={40} invalid={!!errors.costCenter} {...register('costCenter')} />
        </Field>

        {confirmHead && department && (
          <div role="alertdialog" aria-labelledby="dp-confirm-title" className="space-y-3 rounded-lg border border-warning-100 bg-warning-50 p-4 dark:border-warning-500/20 dark:bg-warning-500/10">
            <p id="dp-confirm-title" className="flex items-start gap-2 text-[0.8125rem] font-medium text-ink">
              <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-warning-700 dark:text-warning-500" aria-hidden />
              Move {confirmName} into {confirmHead.name || department.name} and make them head?
            </p>
            <p className="text-xs text-ink-2">
              They leave their current department. Their leads, targets and team visibility follow the new department. This is the same change as editing their
              department in Settings › Users & roles.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmHead(null)} disabled={update.isPending}>
                Back
              </Button>
              <Button write size="sm" loading={update.isPending} onClick={() => save(confirmHead, true)}>
                Move and make head
              </Button>
            </div>
            {update.error && apiStatus(update.error) !== 409 && (
              <p role="alert" className="text-xs text-danger-700 dark:text-danger-500">
                {update.error.message}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
