import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format, parseISO } from 'date-fns'
import { ListChecks } from 'lucide-react'
import { projectPath } from '@/app/paths'
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL, type ProjectInput } from '@/modules/tasks/types'
import { projectSchema, type ProjectValues } from '@/modules/tasks/projectSchemas'
import { useCreateProject } from '@/modules/tasks/hooks/useTasks'
import { useCustomersQuery, useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useProjectTemplate, useServicesQuery } from '@/modules/services/hooks/useServices'
import { templateTotals } from '@/modules/services/types'
import { addWorkingDays, isoDate, nextWorkingDay } from '@/modules/won/plan'
import { getRegion } from '@/shared/lib/region'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'
import { fmtHours } from './projectUi'

/** End date for a start date and a template length in working days. */
function suggestedEnd(start: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return ''
  return isoDate(addWorkingDays(parseISO(start), Math.max(0, days - 1), getRegion().weekend))
}

/** Projects › New project: customer, service, manager, dates, status, and tasks from the service template. */
export function NewProjectDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useCurrentUser()
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateProject()
  const customers = useCustomersQuery()
  const services = useServicesQuery()
  const people = useUsersQuery()

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<ProjectValues>({ resolver: zodResolver(projectSchema), mode: 'onTouched' })

  useEffect(() => {
    if (!open) return
    const start = isoDate(nextWorkingDay(new Date(), getRegion().weekend))
    reset({
      name: '',
      customerId: '',
      serviceId: '',
      managerId: me?.id ?? '',
      startDate: start,
      endDate: suggestedEnd(start, 20),
      status: 'planned',
      estimatedHours: 0,
      generateTasks: true,
    })
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const customerId = watch('customerId')
  const serviceId = watch('serviceId')
  const startDate = watch('startDate')
  const generate = watch('generateTasks')
  const template = useProjectTemplate(serviceId)
  const tplTasks = template.data?.tasks ?? []
  const totals = templateTotals(tplTasks)

  const activeServices = useMemo(() => (services.data ?? []).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name)), [services.data])
  const customer = customers.data?.find((c) => c.id === customerId)
  const service = activeServices.find((s) => s.id === serviceId)
  const managers = useMemo(() => (people.data ?? []).filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [people.data])

  // Suggest the service the customer bought, the name, the end date and the hours until edited by hand.
  useEffect(() => {
    if (!open || !customer || dirtyFields.serviceId || serviceId) return
    const bought = customer.serviceIds.find((id) => activeServices.some((s) => s.id === id))
    if (bought) setValue('serviceId', bought)
  }, [open, customer, activeServices, dirtyFields.serviceId, serviceId, setValue])

  useEffect(() => {
    if (!open || dirtyFields.name || !customer || !service) return
    setValue('name', `${service.name} — ${customer.name}`)
  }, [open, customer, service, dirtyFields.name, setValue])

  useEffect(() => {
    if (!open || dirtyFields.endDate || !service) return
    const days = generate && totals.days > 0 ? totals.days : Math.max(1, service.deliveryDays)
    setValue('endDate', suggestedEnd(startDate, days))
  }, [open, service, generate, totals.days, startDate, dirtyFields.endDate, setValue])

  useEffect(() => {
    if (!open || dirtyFields.estimatedHours) return
    setValue('estimatedHours', generate ? totals.hours : 0)
  }, [open, generate, totals.hours, dirtyFields.estimatedHours, setValue])

  const onSubmit = handleSubmit((v) => {
    // `generateTasks` rides along with the documented ProjectInput (server default: true).
    const input: ProjectInput & { generateTasks: boolean } = { ...v, name: v.name.trim() }
    create.mutate(input, {
      onSuccess: (row) => {
        toast.success('Project created', row.taskCount ? `${row.name} · ${row.taskCount} tasks` : row.name)
        onClose()
        navigate(projectPath(row.id))
      },
    })
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="New project"
      description="A delivery project for a customer, with its tasks from the service template."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="project-form" loading={create.isPending}>
            Create project
          </Button>
        </>
      }
    >
      <form id="project-form" noValidate onSubmit={onSubmit} className="space-y-5">
        <Field id="pr-customer" label="Customer" required error={errors.customerId?.message}>
          <SelectInput id="pr-customer" disabled={customers.isPending} invalid={!!errors.customerId} {...register('customerId')}>
            <option value="">{customers.isPending ? 'Loading customers…' : customers.isError ? 'Couldn’t load customers' : 'Choose a customer…'}</option>
            {[...(customers.data ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectInput>
        </Field>

        <Field id="pr-service" label="Service" required error={errors.serviceId?.message} hint={service ? `Delivery time ${service.deliveryDays} days` : undefined}>
          <SelectInput id="pr-service" disabled={services.isPending} invalid={!!errors.serviceId} {...register('serviceId')}>
            <option value="">{services.isPending ? 'Loading services…' : services.isError ? 'Couldn’t load services' : 'Choose a service…'}</option>
            {activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field id="pr-name" label="Project name" required error={errors.name?.message}>
          <TextInput id="pr-name" placeholder="e.g. Chatbot rollout — Al Noor Clinics" invalid={!!errors.name} {...register('name')} />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="pr-manager" label="Project manager" required error={errors.managerId?.message}>
            <SelectInput id="pr-manager" disabled={people.isPending} invalid={!!errors.managerId} {...register('managerId')}>
              <option value="">{people.isPending ? 'Loading people…' : 'Choose a person…'}</option>
              {managers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.title}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="pr-status" label="Status" required error={errors.status?.message}>
            <SelectInput id="pr-status" invalid={!!errors.status} {...register('status')}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="pr-start" label="Start date" required error={errors.startDate?.message}>
            <TextInput id="pr-start" type="date" invalid={!!errors.startDate} {...register('startDate')} />
          </Field>
          <Field
            id="pr-end"
            label="End date"
            required
            error={errors.endDate?.message}
            hint={startDate ? `Starts ${format(parseISO(startDate), 'EEE d MMM')}` : undefined}
          >
            <TextInput id="pr-end" type="date" invalid={!!errors.endDate} {...register('endDate')} />
          </Field>
        </div>

        <div className="rounded-lg border border-line-strong p-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-muted [&_svg]:size-4">
              <ListChecks aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="pr-generate" className="block text-[0.8125rem] font-medium text-ink">
                Generate tasks from the service template
              </label>
              <p className="mt-0.5 text-xs text-muted">
                {!serviceId
                  ? 'Pick a service to see its template.'
                  : template.isPending
                    ? 'Loading the template…'
                    : template.isError
                      ? 'Couldn’t load the template; the server will still use it.'
                      : tplTasks.length
                        ? `${tplTasks.length} task${tplTasks.length === 1 ? '' : 's'} · ${fmtHours(totals.hours)} · about ${totals.days} working days. Owners are matched by role; due dates follow the template offsets.`
                        : 'This service has no project template, so the project starts with no tasks.'}
              </p>
            </div>
            <Controller
              control={control}
              name="generateTasks"
              render={({ field }) => <Switch id="pr-generate" label="Generate tasks from the service template" checked={!!field.value} onChange={field.onChange} />}
            />
          </div>
        </div>

        <Field id="pr-hours" label="Estimated hours" required error={errors.estimatedHours?.message} hint={generate && totals.hours ? 'Defaults to the template total.' : undefined}>
          <TextInput id="pr-hours" type="number" inputMode="decimal" min={0} step={1} invalid={!!errors.estimatedHours} {...register('estimatedHours')} />
        </Field>

        {create.error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {create.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
