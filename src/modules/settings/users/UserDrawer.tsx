import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { Crown, Info } from 'lucide-react'
import { departmentPath } from '@/app/paths'
import { useDepartmentsQuery as useOrgDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { departmentOptions, headConflict, headsIndex } from '@/modules/settings/users/departmentHeads'
import { cn } from '@/shared/lib/utils'
import type { Role } from '@/shared/types'
import type { SettingsUserRow, UserInput } from '@/modules/settings/users/types'
import { useCreateUser, useDepartmentsQuery, useUpdateUser } from '@/modules/settings/hooks/useSettingsUsers'
import { ROLES } from '@/shared/lib/constants'
import { isMobile, mobileError, mobileExample, mobileSample } from '@/shared/lib/phone'
import { getRegion } from '@/shared/lib/region'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { ROLE_HINTS, RoleAccess } from './RoleAccess'
import { useBranding, useRegion } from '@/modules/tenancy/hooks'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the person’s full name.').max(80, 'Keep it under 80 characters.'),
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email address.'),
  mobile: z
    .string()
    .trim()
    .min(1, 'Mobile is required.')
    .refine((v) => isMobile(v, getRegion().country), () => ({ message: mobileError(getRegion().country) })),
  role: z.enum(ROLES as [Role, ...Role[]], { errorMap: () => ({ message: 'Pick a role.' }) }),
  title: z.string().trim().max(80, 'Keep it under 80 characters.'),
  departmentId: z.string().min(1, 'Pick a department.'),
  managerId: z.string(),
})

type Values = z.infer<typeof schema>

const EMPTY: Values = { name: '', email: '', mobile: '', role: 'Sales Agent', title: '', departmentId: '', managerId: '' }

interface UserDrawerProps {
  open: boolean
  onClose: () => void
  /** Edit this user; omit to add one. */
  user: SettingsUserRow | null
  /** Everyone, for the manager picker. */
  allUsers: SettingsUserRow[]
  currentUserId: string
  readOnly: boolean
}

/** Ids of everyone who reports to `id`, directly or not; they can't become `id`'s manager. */
function reportsUnder(id: string, all: SettingsUserRow[]): Set<string> {
  const out = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    for (const u of all) {
      if (u.managerId === cur && !out.has(u.id)) {
        out.add(u.id)
        queue.push(u.id)
      }
    }
  }
  return out
}

/** Add or edit a user. Shows the chosen role's row of the permission matrix. */
export function UserDrawer({ open, onClose, user, allUsers, currentUserId, readOnly }: UserDrawerProps) {
  const region = useRegion()
  const emailDomain = useBranding().emailSenderAddress.split('@')[1] || 'company.com'
  const editing = !!user
  const isSelf = user?.id === currentUserId
  const create = useCreateUser()
  const update = useUpdateUser()
  const settingsDepartments = useDepartmentsQuery()
  const orgDepartments = useOrgDepartmentsQuery(true)
  const toast = useToast()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY, mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    reset(
      user
        ? {
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            role: user.role,
            title: user.title,
            departmentId: user.departmentId,
            managerId: user.managerId ?? '',
          }
        : EMPTY,
    )
    create.reset()
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user])

  const role = watch('role')
  const departmentId = watch('departmentId')

  // Department picker: active departments in tree order (the current one stays visible if inactive).
  // Falls back to the plain settings list if the Departments module can't be read.
  const rows = orgDepartments.data
  const deptOptions = useMemo(
    () =>
      rows
        ? departmentOptions(rows, user?.departmentId)
        : (settingsDepartments.data ?? []).map((d) => ({ id: d.id, label: d.name, active: true })),
    [rows, settingsDepartments.data, user?.departmentId],
  )
  const deptsLoading = orgDepartments.isPending && settingsDepartments.isPending
  const headOf = useMemo(() => headsIndex(rows ?? []), [rows])
  const headed = user ? (headOf.get(user.id) ?? []) : []
  const movingHead = editing && headed.length > 0 && departmentId !== user?.departmentId

  const managers = useMemo(() => {
    const blocked = user ? reportsUnder(user.id, allUsers) : new Set<string>()
    return allUsers
      .filter((u) => u.active && u.id !== user?.id && !blocked.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allUsers, user])
  // A deactivated current manager stays visible so the field doesn't silently change.
  const currentManager = user?.managerId ? allUsers.find((u) => u.id === user.managerId) : undefined

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  // "X heads Y. Pick a new head for Y first (Departments)." → link to Y.
  const conflict = error && (error as { status?: number }).status === 422 ? headConflict(error.message, rows ?? []) : null

  const onSubmit = handleSubmit((v) => {
    const input: UserInput = {
      name: v.name,
      email: v.email,
      mobile: v.mobile,
      role: v.role,
      title: v.title,
      departmentId: v.departmentId,
      managerId: v.managerId || null,
    }
    if (user) {
      update.mutate(
        { id: user.id, input },
        {
          onSuccess: (row) => {
            toast.success('User saved', row.name)
            onClose()
          },
        },
      )
    } else {
      create.mutate(input, {
        onSuccess: (row) => {
          toast.success('User added', `${row.name} can now sign in as ${row.role}.`)
          onClose()
        },
      })
    }
  })

  const title = readOnly ? (user?.name ?? 'User') : editing ? 'Edit user' : 'Add user'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={title}
      description={readOnly ? 'View only. A Company Admin can change users.' : editing ? user?.email : 'They sign in with this email.'}
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button write type="submit" form="user-form" loading={pending} disabled={editing && !isDirty}>
              {editing ? 'Save changes' : 'Add user'}
            </Button>
          </>
        )
      }
    >
      <form id="user-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <fieldset disabled={readOnly} className="space-y-4">
          <legend className="sr-only">Details</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="us-name" label="Full name" required error={errors.name?.message}>
              <TextInput id="us-name" autoComplete="off" invalid={!!errors.name} {...register('name')} />
            </Field>
            <Field id="us-title" label="Job title" error={errors.title?.message}>
              <TextInput id="us-title" placeholder="e.g. Account Executive" invalid={!!errors.title} {...register('title')} />
            </Field>
            <Field id="us-email" label="Work email" required error={errors.email?.message}>
              <TextInput
                id="us-email"
                type="email"
                autoComplete="off"
                placeholder={`name@${emailDomain}`}
                invalid={!!errors.email}
                aria-describedby={errors.email ? 'us-email-error' : undefined}
                {...register('email')}
              />
            </Field>
            <Field id="us-mobile" label="Mobile" required error={errors.mobile?.message} hint={mobileExample(region.country)}>
              <TextInput
                id="us-mobile"
                type="tel"
                inputMode="tel"
                placeholder={mobileSample(region.country)}
                invalid={!!errors.mobile}
                aria-describedby={errors.mobile ? 'us-mobile-error' : 'us-mobile-hint'}
                {...register('mobile')}
              />
            </Field>
            <div>
              <Field
                id="us-dept"
                label="Department"
                required
                error={errors.departmentId?.message}
                hint={headed.length ? undefined : 'Active departments only. This is their department membership.'}
              >
                <SelectInput
                  id="us-dept"
                  invalid={!!errors.departmentId}
                  aria-describedby={headed.length ? 'us-dept-head' : 'us-dept-hint'}
                  {...register('departmentId')}
                >
                  <option value="">{deptsLoading ? 'Loading…' : 'Choose a department…'}</option>
                  {deptOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              {headed.length > 0 && (
                <p
                  id="us-dept-head"
                  className={cn(
                    'mt-1.5 flex items-start gap-1.5 text-xs',
                    movingHead ? 'text-warning-700 dark:text-warning-500' : 'text-muted',
                  )}
                >
                  <Crown aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-500" />
                  <span>
                    Head of{' '}
                    {headed.map((d, i) => (
                      <span key={d.id}>
                        {i > 0 && ', '}
                        <Link to={departmentPath(d.id)} onClick={onClose} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                          {d.name}
                        </Link>
                      </span>
                    ))}
                    .{movingHead && ' Pick a new head there before moving them to another department.'}
                  </span>
                </p>
              )}
            </div>
            <Field id="us-manager" label="Direct manager" error={errors.managerId?.message} hint="Active people only; no one who reports to them.">
              <SelectInput id="us-manager" invalid={!!errors.managerId} aria-describedby="us-manager-hint" {...register('managerId')}>
                <option value="">No manager</option>
                {currentManager && !currentManager.active && (
                  <option value={currentManager.id}>{currentManager.name} (deactivated)</option>
                )}
                {managers.map((m) => {
                  const heads = headOf.get(m.id)
                  return (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.role}
                      {heads?.length ? ` · Head of ${heads.map((d) => d.name).join(', ')}` : ''}
                    </option>
                  )
                })}
              </SelectInput>
            </Field>
          </div>

          <Field
            id="us-role"
            label="Role"
            required
            error={errors.role?.message}
            hint={isSelf && !readOnly ? 'You can’t change your own role.' : ROLE_HINTS[role]}
          >
            {isSelf ? (
              // Not registered: a disabled field would submit as undefined. The form keeps the loaded role.
              <TextInput id="us-role" value={role} readOnly disabled aria-describedby="us-role-hint" />
            ) : (
              <SelectInput id="us-role" invalid={!!errors.role} aria-describedby="us-role-hint" {...register('role')}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </fieldset>

        {role && <RoleAccess role={role} />}

        {!editing && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            New users start without two-factor authentication; they turn it on from Settings › Security after first sign-in.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {error.message}
            {conflict && (
              <>
                {' '}
                <Link
                  to={departmentPath(conflict.id)}
                  onClick={onClose}
                  className="font-medium whitespace-nowrap underline underline-offset-2 hover:no-underline"
                >
                  Open {conflict.name}
                </Link>
              </>
            )}
          </p>
        )}
      </form>
    </Drawer>
  )
}
