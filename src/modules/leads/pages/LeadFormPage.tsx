import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { addDays, format } from 'date-fns'
import {
  AlertTriangle,
  Ban,
  Building2,
  CircleCheck,
  Factory,
  KanbanSquare,
  Plus,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  UserRound,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import type { DuplicateMatch, LeadCreateInput, LeadDetail, LeadUpdateInput } from '@/modules/leads/types'
import { leadPath, PATHS } from '@/app/paths'
import {
  useCreateLead,
  useLeadDuplicateCheck,
  useLeadOwnersQuery,
  useLeadQuery,
  useLeadsQuery,
  useMoveLeadStage,
  useUpdateLead,
} from '@/modules/leads/hooks/useLeads'
import { leadFormSchema, type LeadFormValues } from '@/modules/leads/schemas'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { ServiceMultiSelect, ServiceSelect, UnmatchedServiceNotice } from '@/modules/leads/components/ServiceFields'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import { useLookups } from '@/shared/hooks/useLookups'
import { useLastSource } from '@/modules/leads/lastSource'
import { can, scopeOf } from '@/shared/lib/permissions'
import { formatUaeMobile, normalizeUaeMobile } from '@/shared/lib/phone'
import { ApiError } from '@/shared/lib/apiError'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'

/**
 * Full lead form (spec: Leads › "Quick add (few fields) and full add"). Serves /leads/new and
 * /leads/:id/edit. New leads start as New and are auto-assigned unless a manager picks the owner.
 */
export default function LeadFormPage() {
  const user = useCurrentUser()
  const { id } = useParams()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  const mode = id ? 'edit' : 'create'
  if (scope === 'hidden' || !can(user.role, 'sales', mode === 'edit' ? 'edit' : 'create')) {
    return (
      <PageBody>
        <EmptyState
          icon={<ShieldAlert aria-hidden />}
          title={mode === 'edit' ? 'You can’t edit leads' : 'You can’t add leads'}
          body={`${user.role} has ${scope === 'hidden' ? 'no access to' : 'read-only access to'} Sales & CRM.`}
          action={
            <Link to={PATHS.leads}>
              <Button tabIndex={-1} variant="secondary" size="sm">
                Back to leads
              </Button>
            </Link>
          }
        />
      </PageBody>
    )
  }
  const isManager = scope === 'full' || scope === 'team'
  return id ? <EditLoader id={id} isManager={isManager} /> : <LeadForm key="new" isManager={isManager} />
}

function EditLoader({ id, isManager }: { id: string; isManager: boolean }) {
  const navigate = useNavigate()
  const query = useLeadQuery(id)
  if (query.isPending) return <FormSkeleton />
  if (query.isError) {
    const gone = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)
    return (
      <PageBody>
        {gone ? (
          <EmptyState
            title={query.error.message}
            body="Check the link, or find the lead from the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.leads)}>
                Back to leads
              </Button>
            }
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }
  return <LeadForm key={query.data.id} lead={query.data} isManager={isManager} />
}

/* ------------------------------------------------------------------------------------------
 * Form
 * ---------------------------------------------------------------------------------------- */

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd')
}

function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T09:00:00`).toISOString() : null
}

/** Active lookup items as options, plus the record's current value if it has since been deactivated. */
function optionsWith(list: { key: string; label: string }[], current: string, labelOf: (key: string) => string) {
  const opts = list.map((i) => ({ value: i.key, label: i.label }))
  if (current && !list.some((i) => i.key === current)) opts.push({ value: current, label: `${labelOf(current)} (inactive)` })
  return opts
}

function defaultsFor(lead: LeadDetail | undefined, startStatus: string): LeadFormValues {
  if (!lead) {
    return {
      company: '',
      website: '',
      sourceType: '',
      sourceDetail: '',
      industry: '',
      subIndustry: '',
      contacts: [{ name: '', title: '', mobile: '', email: '', isDecisionMaker: true }],
      status: startStatus,
      initialStatus: startStatus,
      lossReason: '',
      ownerId: '',
      value: '',
      nextFollowUpDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      nextStep: '',
      companyServices: [],
      serviceIds: [],
      recommendedServiceId: '',
      doNotContact: false,
      note: '',
    }
  }
  const contacts =
    lead.contacts.length > 0
      ? lead.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          title: c.title,
          mobile: c.mobile ? formatUaeMobile(c.mobile) : '',
          email: c.email,
          isDecisionMaker: c.isDecisionMaker,
        }))
      : [
          {
            name: lead.contactName,
            title: '',
            mobile: lead.mobile ? formatUaeMobile(lead.mobile) : '',
            email: lead.contactEmail,
            isDecisionMaker: false,
          },
        ]
  return {
    company: lead.company,
    website: lead.website ?? '',
    sourceType: lead.sourceType,
    sourceDetail: lead.sourceDetail,
    industry: lead.industry,
    subIndustry: lead.subIndustry,
    contacts,
    status: lead.status,
    initialStatus: lead.status,
    lossReason: '',
    ownerId: lead.ownerId,
    value: lead.value ? String(lead.value) : '',
    nextFollowUpDate: toDateInput(lead.nextFollowUpDate),
    nextStep: lead.nextStep,
    companyServices: lead.companyServices,
    serviceIds: lead.serviceIds,
    recommendedServiceId: lead.recommendedServiceId ?? '',
    doNotContact: lead.doNotContact,
    note: '',
  }
}

const SECTIONS = [
  { id: 'company', label: 'Company & source', icon: Building2 },
  { id: 'industry', label: 'Industry', icon: Factory },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'notes', label: 'Notes & consent', icon: Ban },
] as const

function LeadForm({ lead, isManager }: { lead?: LeadDetail; isManager: boolean }) {
  const mode = lead ? 'edit' : 'create'
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateLead()
  const update = useUpdateLead()
  const move = useMoveLeadStage()
  const owners = useLeadOwnersQuery(isManager)
  const catalog = useCatalog()
  const leadsList = useLeadsQuery()
  const lookups = useLookups()
  const startStatus = lookups.openStatuses[0]?.key ?? ''
  const initial = useMemo(() => defaultsFor(lead, startStatus), [lead, startStatus])
  // Validation reads the live lookups; the record's own (possibly deactivated) values stay valid.
  const lookupsRef = useRef(lookups)
  lookupsRef.current = lookups
  // Services must be ACTIVE catalog items (checked once the catalog has loaded; the server re-checks).
  const activeIdsRef = useRef<Set<string> | undefined>(undefined)
  activeIdsRef.current = catalog.data ? new Set(catalog.active.map((s) => s.id)) : undefined
  const resolver: Resolver<LeadFormValues> = (values, ctx, opts) =>
    zodResolver(leadFormSchema(lookupsRef.current, lead, activeIdsRef.current))(values, ctx, opts)
  const [override, setOverride] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isDirty, submitCount },
  } = useForm<LeadFormValues>({ resolver, defaultValues: initial, mode: 'onTouched' })
  const contactsArray = useFieldArray({ control, name: 'contacts' })

  const company = useWatch({ control, name: 'company' })
  const website = useWatch({ control, name: 'website' })
  const contacts = useWatch({ control, name: 'contacts' })
  const industry = useWatch({ control, name: 'industry' })
  const status = useWatch({ control, name: 'status' })
  const recommended = useWatch({ control, name: 'recommendedServiceId' })
  const ownerId = useWatch({ control, name: 'ownerId' })
  const closed = lookups.isClosed(status)
  const target = lookups.status(status)
  const sourceType = useWatch({ control, name: 'sourceType' })
  const subIndustry = useWatch({ control, name: 'subIndustry' })

  // New lead: the start status arrives with the lookups.
  useEffect(() => {
    if (!lead && startStatus && !getValues('status')) {
      setValue('status', startStatus, { shouldDirty: false })
      setValue('initialStatus', startStatus, { shouldDirty: false })
    }
  }, [lead, startStatus, getValues, setValue])

  // New lead: default the (still required) source to the agent's last used one, if still active.
  const lastSource = useLastSource()
  useEffect(() => {
    if (!lead && lastSource && !getValues('sourceType')) setValue('sourceType', lastSource, { shouldDirty: false })
  }, [lead, lastSource, getValues, setValue])

  // Duplicate probe. When editing, only fields that changed are checked (as on the server), so
  // a lead never warns about data it already had.
  const initialEmails = useMemo(() => initial.contacts.map((c) => c.email.trim().toLowerCase()), [initial])
  const emails = (contacts ?? []).map((c) => c.email ?? '')
  const probe = {
    company: !lead || company.trim().toLowerCase() !== initial.company.trim().toLowerCase() ? company : '',
    website: !lead || website.trim() !== initial.website.trim() ? website : '',
    emails: lead ? emails.filter((e) => e.trim() && !initialEmails.includes(e.trim().toLowerCase())) : emails,
    excludeId: lead?.id,
  }
  const duplicates = useLeadDuplicateCheck(probe)
  const probeEmpty = probe.company.trim().length <= 2 && !probe.website.includes('.') && probe.emails.every((e) => !e.includes('@'))
  const matches: DuplicateMatch[] = probeEmpty ? [] : (duplicates.data ?? [])
  const blocked = matches.length > 0 && !(isManager && override)

  useEffect(() => {
    if (matches.length === 0 && override) setOverride(false)
  }, [matches.length, override])

  useLeaveGuard(isDirty && !saving)

  // AI suggestion: an active catalog service for this industry, from the category with the most
  // fitting services.
  const suggestion = useMemo(() => {
    if (!industry || !catalog.data) return null
    const fits = catalog.active.filter((s) => s.industries.includes(industry))
    if (fits.length === 0) return null
    const counts = new Map<string, number>()
    for (const s of fits) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
    const best = [...fits].sort((a, b) => (counts.get(b.category) ?? 0) - (counts.get(a.category) ?? 0))[0]
    return { service: best, count: fits.length }
  }, [industry, catalog.data, catalog.active])

  useEffect(() => {
    if (mode === 'create' && suggestion && !getValues('recommendedServiceId')) {
      setValue('recommendedServiceId', suggestion.service.id, { shouldDirty: false })
    }
  }, [mode, suggestion, getValues, setValue])

  const tagSuggestions = useMemo(() => {
    const all = new Set<string>()
    for (const l of leadsList.data ?? []) for (const t of l.companyServices) all.add(t)
    return [...all].sort((a, b) => a.localeCompare(b))
  }, [leadsList.data])

  const ownerOptions = owners.data ?? []
  const selectedOwner = ownerOptions.find((o) => o.id === ownerId)

  function cancel() {
    if (isDirty && !window.confirm('Discard your changes?')) return
    navigate(lead ? leadPath(lead.id) : PATHS.leads)
  }

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null)
    if (blocked) {
      document.getElementById('duplicate-notice')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const contactRows = v.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      mobile: c.mobile ? (normalizeUaeMobile(c.mobile) ?? c.mobile) : '',
      email: c.email.toLowerCase(),
      isDecisionMaker: c.isDecisionMaker,
    }))
    const value = v.value ? Number(v.value.replace(/,/g, '')) : 0
    const force = matches.length > 0 && isManager && override
    setSaving(true)
    try {
      if (!lead) {
        const input: LeadCreateInput = {
          company: v.company,
          website: v.website,
          sourceType: v.sourceType,
          sourceDetail: v.sourceDetail,
          industry: v.industry,
          subIndustry: v.subIndustry,
          contacts: contactRows,
          ownerId: isManager && v.ownerId ? v.ownerId : null,
          value,
          nextFollowUpDate: fromDateInput(v.nextFollowUpDate),
          nextStep: v.nextStep,
          companyServices: v.companyServices,
          serviceIds: v.serviceIds,
          recommendedServiceId: v.recommendedServiceId || null,
          doNotContact: v.doNotContact,
          note: v.note,
          force,
        }
        const created = await create.mutateAsync(input)
        toast.success('Lead created', `${created.company} is ${lookups.statusLabel(created.status)} and assigned to ${created.ownerName}.`)
        navigate(leadPath(created.id))
        return
      }

      const input: LeadUpdateInput = {
        company: v.company,
        website: v.website,
        sourceType: v.sourceType,
        sourceDetail: v.sourceDetail,
        industry: v.industry,
        subIndustry: v.subIndustry,
        contacts: contactRows,
        ownerId: isManager && v.ownerId ? v.ownerId : undefined,
        value,
        nextFollowUpDate: closed ? null : fromDateInput(v.nextFollowUpDate),
        nextStep: v.nextStep,
        companyServices: v.companyServices,
        serviceIds: v.serviceIds,
        // Sent only when changed, so unrelated edits never touch a legacy unmatched text.
        recommendedServiceId:
          (v.recommendedServiceId || null) !== (lead.recommendedServiceId ?? null) ? v.recommendedServiceId || null : undefined,
        doNotContact: v.doNotContact,
        force,
      }
      await update.mutateAsync({ id: lead.id, input })
      if (v.status !== lead.status) {
        try {
          await move.mutateAsync({
            id: lead.id,
            status: v.status,
            lossReason: v.lossReason || undefined,
            nextStep: v.nextStep || undefined,
            nextFollowUpDate: fromDateInput(v.nextFollowUpDate) ?? undefined,
          })
          toast.success('Lead saved', `Moved to ${lookups.statusLabel(v.status)}.`)
        } catch (e) {
          toast.error('Details saved, stage not changed', e instanceof Error ? e.message : undefined)
        }
      } else {
        toast.success('Lead saved')
      }
      navigate(leadPath(lead.id))
    } catch (e) {
      setSaving(false)
      const message = e instanceof Error ? e.message : 'Something went wrong.'
      setServerError(message)
      if (!(e instanceof ApiError && e.status === 409)) toast.error(lead ? 'Lead not saved' : 'Lead not created', message)
    }
  })

  const errorCount = submitCount > 0 ? countErrors(errors) : 0

  return (
    <form noValidate onSubmit={onSubmit} className="flex min-h-full flex-col">
      {/* Header */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[75rem] px-4 pt-6 pb-5 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.leads} className="hover:text-ink">
              Leads
            </Link>
            <span className="text-subtle">/</span>
            {lead ? (
              <>
                <Link to={leadPath(lead.id)} className="truncate hover:text-ink">
                  {lead.company}
                </Link>
                <span className="text-subtle">/</span>
                <span className="text-ink-2">Edit</span>
              </>
            ) : (
              <span className="text-ink-2">New lead</span>
            )}
          </nav>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{lead ? `Edit ${lead.company}` : 'New lead'}</h1>
            {lead ? (
              <StatusBadge status={lead.status} soft />
            ) : (
              <Badge tone="blue">Starts as {lookups.openStatuses[0]?.label ?? '…'}</Badge>
            )}
          </div>
          <p className="mt-1 text-[0.8125rem] text-muted">
            {lead
              ? 'Changes to the name, website or emails are checked for duplicates again.'
              : 'Every field you can fill now saves a call later. Duplicates are checked as you type.'}
          </p>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[75rem] flex-1 grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[11.25rem_minmax(0,1fr)] lg:px-10 xl:grid-cols-[11.25rem_minmax(0,1fr)_16.25rem]">
        {/* Section nav */}
        <nav aria-label="Form sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#section-${s.id}`}
                  data-leave-ok
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className="flex h-8 items-center gap-2 rounded-md px-2 text-[0.8125rem] text-muted hover:bg-hover hover:text-ink [&_svg]:size-3.5"
                >
                  <s.icon aria-hidden />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          {matches.length > 0 && (
            <DuplicateNotice
              matches={matches}
              isManager={isManager}
              override={override}
              onOverride={setOverride}
              mode={mode}
            />
          )}
          {serverError && (
            <p role="alert" className="rounded-lg bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
              {serverError}
            </p>
          )}

          {/* Company & source */}
          <Section id="company" title="Company & source" description="Source must come from the list; put the link or name in Source detail.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="lf-company" label="Company" required error={errors.company?.message} className="sm:col-span-2">
                <TextInput
                  id="lf-company"
                  autoComplete="organization"
                  placeholder="e.g. Al Noor Medical Centre"
                  invalid={!!errors.company}
                  aria-describedby={errors.company ? 'lf-company-error' : undefined}
                  {...register('company')}
                />
              </Field>
              <Field id="lf-website" label="Website" error={errors.website?.message} hint="Used to spot duplicates by domain.">
                <TextInput
                  id="lf-website"
                  inputMode="url"
                  placeholder="company.ae"
                  invalid={!!errors.website}
                  {...register('website')}
                />
              </Field>
              <Field id="lf-source" label="Source type" required error={errors.sourceType?.message}>
                <SelectInput
                  id="lf-source"
                  invalid={!!errors.sourceType}
                  aria-busy={lookups.isLoading || undefined}
                  {...register('sourceType')}
                >
                  <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
                  {optionsWith(lookups.sources, sourceType, lookups.sourceLabel).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field
                id="lf-source-detail"
                label="Source detail"
                error={errors.sourceDetail?.message}
                hint="Link or name, e.g. GITEX 2025 or a directory URL."
                className="sm:col-span-2"
              >
                <TextInput id="lf-source-detail" invalid={!!errors.sourceDetail} {...register('sourceDetail')} />
              </Field>
            </div>
          </Section>

          {/* Industry */}
          <Section id="industry" title="Industry" description="Pick the industry, then the sub-industry within it.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="lf-industry" label="Industry" required error={errors.industry?.message}>
                <SelectInput
                  id="lf-industry"
                  invalid={!!errors.industry}
                  {...register('industry', {
                    onChange: () => setValue('subIndustry', '', { shouldDirty: true }),
                  })}
                >
                  <option value="">{lookups.isLoading ? 'Loading…' : 'Choose…'}</option>
                  {optionsWith(lookups.industries, industry, lookups.industryLabel).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field id="lf-sub" label="Sub-industry" error={errors.subIndustry?.message} hint={industry ? undefined : 'Pick an industry first.'}>
                <SelectInput id="lf-sub" invalid={!!errors.subIndustry} {...register('subIndustry')}>
                  <option value="">{industry ? 'Choose…' : '—'}</option>
                  {optionsWith(lookups.subIndustriesOf(industry), subIndustry, (k) => lookups.subIndustryLabel(industry, k)).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            </div>
          </Section>

          {/* Contacts */}
          <Section
            id="contacts"
            title={`Contacts · ${contactsArray.fields.length}`}
            description="The first contact is the primary one shown on the lead."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => contactsArray.append({ name: '', title: '', mobile: '', email: '', isDecisionMaker: false })}
                disabled={contactsArray.fields.length >= 10}
              >
                <Plus />
                Add contact
              </Button>
            }
          >
            {errors.contacts?.root?.message || errors.contacts?.message ? (
              <p className="mb-3 text-xs text-danger-600">{errors.contacts?.root?.message ?? errors.contacts?.message}</p>
            ) : null}
            <ul className="space-y-3">
              {contactsArray.fields.map((field, i) => {
                const e = errors.contacts?.[i]
                const mobilePath = `contacts.${i}.mobile` as const
                return (
                  <li key={field.id} className="rounded-xl border border-line bg-canvas/50 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-md bg-sunken text-muted [&_svg]:size-3.5">
                        <UserRound aria-hidden />
                      </span>
                      <span className="text-[0.8125rem] font-medium">Contact {i + 1}</span>
                      {i === 0 && <Badge tone="neutral">Primary</Badge>}
                      <div className="ms-auto flex items-center gap-1">
                        {i > 0 && (
                          <Button variant="ghost" size="xs" onClick={() => contactsArray.move(i, 0)}>
                            Make primary
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          aria-label={`Remove contact ${i + 1}`}
                          disabled={contactsArray.fields.length === 1}
                          onClick={() => contactsArray.remove(i)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field id={`lf-c${i}-name`} label="Name" required error={e?.name?.message}>
                        <TextInput id={`lf-c${i}-name`} autoComplete="name" invalid={!!e?.name} {...register(`contacts.${i}.name`)} />
                      </Field>
                      <Field id={`lf-c${i}-title`} label="Title" error={e?.title?.message}>
                        <TextInput id={`lf-c${i}-title`} placeholder="e.g. Operations Manager" {...register(`contacts.${i}.title`)} />
                      </Field>
                      <Field id={`lf-c${i}-mobile`} label="Mobile" error={e?.mobile?.message} hint="+971 5X XXX XXXX">
                        <TextInput
                          id={`lf-c${i}-mobile`}
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+971 50 123 4567"
                          invalid={!!e?.mobile}
                          {...register(mobilePath, {
                            onBlur: (ev: { target: { value: string } }) => {
                              const n = normalizeUaeMobile(ev.target.value)
                              if (n) setValue(mobilePath, formatUaeMobile(n), { shouldValidate: true, shouldDirty: true })
                            },
                          })}
                        />
                      </Field>
                      <Field id={`lf-c${i}-email`} label="Email" error={e?.email?.message}>
                        <TextInput
                          id={`lf-c${i}-email`}
                          type="email"
                          autoComplete="email"
                          placeholder="name@company.ae"
                          invalid={!!e?.email}
                          {...register(`contacts.${i}.email`)}
                        />
                      </Field>
                    </div>
                    <Controller
                      control={control}
                      name={`contacts.${i}.isDecisionMaker`}
                      render={({ field: f }) => (
                        <div className="mt-3 flex items-center gap-2.5">
                          <Switch id={`lf-c${i}-dm`} checked={f.value} onChange={f.onChange} label="Decision maker" />
                          <label htmlFor={`lf-c${i}-dm`} className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
                            {f.value && <Star className="size-3.5 text-brand-600" aria-hidden />}
                            Decision maker
                          </label>
                        </div>
                      )}
                    />
                  </li>
                )
              })}
            </ul>
          </Section>

          {/* Pipeline */}
          <Section id="pipeline" title="Pipeline" description={lead ? 'Stage changes follow the same rules as the board.' : 'New leads start as New and are assigned to a sales agent.'}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {lead ? (
                <Field id="lf-status" label="Status" required error={errors.status?.message}>
                  <SelectInput id="lf-status" {...register('status')}>
                    {optionsWith(lookups.statuses, lead.status, lookups.statusLabel).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              ) : (
                <div>
                  <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Status</p>
                  <div className="flex h-9 items-center gap-2 rounded-lg border border-line bg-sunken px-3">
                    {startStatus ? <StatusBadge status={startStatus} /> : <Skeleton className="h-5 w-16" />}
                    <span className="text-xs text-muted">Set automatically</span>
                  </div>
                </div>
              )}

              {isManager ? (
                <Field
                  id="lf-owner"
                  label="Owner"
                  error={errors.ownerId?.message}
                  hint={
                    owners.isError
                      ? 'Couldn’t load owners; the lead will be auto-assigned.'
                      : selectedOwner
                        ? `${selectedOwner.openLeads} open leads today.`
                        : lead
                          ? undefined
                          : 'Goes to the sales agent with the fewest open leads.'
                  }
                >
                  <SelectInput id="lf-owner" aria-busy={owners.isPending || undefined} {...register('ownerId')}>
                    {!lead && <option value="">Auto-assign</option>}
                    {lead && !ownerOptions.some((o) => o.id === lead.ownerId) && <option value={lead.ownerId}>{lead.ownerName}</option>}
                    {ownerOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {o.openLeads} open
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              ) : (
                <div>
                  <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Owner</p>
                  <div className="flex h-9 items-center rounded-lg border border-line bg-sunken px-3 text-[0.8125rem] text-muted">
                    {lead ? lead.ownerName : 'You (assigned automatically)'}
                  </div>
                </div>
              )}

              {lead && target.requires === 'loss-reason' && status !== lead.status && (
                <Field id="lf-loss" label="Reason" required error={errors.lossReason?.message} className="sm:col-span-2">
                  <SelectInput id="lf-loss" invalid={!!errors.lossReason} {...register('lossReason')}>
                    <option value="">Choose…</option>
                    {lookups.lossReasons.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              )}
              {lead && target.requires === 'convert' && status !== lead.status && (
                <p className="rounded-lg bg-success-50 px-3 py-2 text-[0.8125rem] text-success-700 sm:col-span-2 dark:bg-success-700/20 dark:text-success-500">
                  Saving as {target.label} converts this lead into a customer.
                </p>
              )}

              <Field id="lf-value" label="Estimated value (AED)" error={errors.value?.message}>
                <TextInput id="lf-value" inputMode="decimal" placeholder="0" invalid={!!errors.value} className="num" {...register('value')} />
              </Field>
              <Field
                id="lf-followup"
                label="Next follow-up"
                required={!closed}
                error={errors.nextFollowUpDate?.message}
                hint={closed ? 'Not needed for a closed lead.' : undefined}
              >
                <TextInput
                  id="lf-followup"
                  type="date"
                  readOnly={closed}
                  aria-disabled={closed || undefined}
                  className={closed ? 'bg-sunken text-subtle' : undefined}
                  invalid={!!errors.nextFollowUpDate}
                  {...register('nextFollowUpDate')}
                />
              </Field>
              <Field
                id="lf-next-step"
                label="Next step"
                required={target.requires === 'next-step'}
                error={errors.nextStep?.message}
                className="sm:col-span-2"
              >
                <TextInput id="lf-next-step" placeholder="e.g. Send chatbot demo video" invalid={!!errors.nextStep} {...register('nextStep')} />
              </Field>
            </div>
          </Section>

          {/* Services */}
          <Section id="services" title="Services" description="What the company does, and what we could sell them.">
            <div className="space-y-5">
              <Controller
                control={control}
                name="companyServices"
                render={({ field }) => (
                  <Field
                    id="lf-company-services"
                    label="Services the company offers"
                    error={errors.companyServices?.message}
                    hint="Type and press Enter or comma. Short tags, not sentences."
                  >
                    <TagInput id="lf-company-services" value={field.value} onChange={field.onChange} suggestions={tagSuggestions} />
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="serviceIds"
                render={({ field }) => (
                  <fieldset>
                    <legend className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Our services of interest</legend>
                    <ServiceMultiSelect catalog={catalog.all} loading={catalog.isPending} value={field.value} onChange={field.onChange} />
                    {errors.serviceIds?.message && (
                      <p className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">{errors.serviceIds.message}</p>
                    )}
                  </fieldset>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="recommendedServiceId"
                  render={({ field }) => (
                    <Field id="lf-recommended" label="Recommended service" error={errors.recommendedServiceId?.message} hint="From the service catalog.">
                      <ServiceSelect
                        id="lf-recommended"
                        catalog={catalog.all}
                        loading={catalog.isPending}
                        value={field.value}
                        onChange={(v) => field.onChange(v)}
                        invalid={!!errors.recommendedServiceId}
                      />
                    </Field>
                  )}
                />
                <div className="flex items-end">
                  {suggestion ? (
                    <div className="flex w-full items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-xs text-brand-800 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200">
                      <Sparkles className="size-3.5 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1">
                        AI suggests <strong>{suggestion.service.name}</strong> · {suggestion.count} catalog{' '}
                        {suggestion.count === 1 ? 'service fits' : 'services fit'} {lookups.industryLabel(industry)}
                      </span>
                      {recommended !== suggestion.service.id && (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => setValue('recommendedServiceId', suggestion.service.id, { shouldDirty: true, shouldValidate: true })}
                        >
                          Use
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      {catalog.isPending ? 'Loading the service catalog…' : 'Pick an industry to get an AI suggestion.'}
                    </p>
                  )}
                </div>
              </div>
              {lead?.recommendedServiceText && !recommended && (
                <UnmatchedServiceNotice
                  text={lead.recommendedServiceText}
                  catalog={catalog.all}
                  onPick={(sid) => setValue('recommendedServiceId', sid, { shouldDirty: true, shouldValidate: true })}
                />
              )}
            </div>
          </Section>

          {/* Notes & consent */}
          <Section id="notes" title="Notes & consent">
            <div className="space-y-4">
              {lead ? (
                <p className="text-[0.8125rem] text-muted">
                  Notes are kept as a log on the{' '}
                  <Link to={leadPath(lead.id)} className="font-medium text-ink underline decoration-line underline-offset-2">
                    lead page
                  </Link>
                  .
                </p>
              ) : (
                <Field id="lf-note" label="First note" error={errors.note?.message} hint="Saved to the lead’s notes log.">
                  <TextArea id="lf-note" placeholder="Context from the first conversation, where you met, etc." {...register('note')} />
                </Field>
              )}
              <Controller
                control={control}
                name="doNotContact"
                render={({ field }) => (
                  <div
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3.5',
                      field.value ? 'border-danger-500/40 bg-danger-50 dark:bg-danger-700/15' : 'border-line',
                    )}
                  >
                    <Switch id="lf-dnc" checked={field.value} onChange={field.onChange} label="Do not contact" />
                    <label htmlFor="lf-dnc" className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-medium">Do not contact</span>
                      <span className="block text-xs text-muted">Blocks calls, emails and WhatsApp to this lead.</span>
                    </label>
                  </div>
                )}
              />
            </div>
          </Section>
        </div>

        {/* Side summary */}
        <aside className="hidden xl:block">
          <div className="sticky top-6 space-y-4">
            <Card>
              <CardHeader title="Duplicate check" />
              <CardBody className="text-[0.8125rem]">
                {probeEmpty ? (
                  <p className="text-muted">Type a company, website or email to check.</p>
                ) : duplicates.isFetching && matches.length === 0 ? (
                  <p className="flex items-center gap-2 text-muted">
                    <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                    Checking…
                  </p>
                ) : matches.length > 0 ? (
                  <p className="flex items-center gap-2 text-warning-700 dark:text-warning-500">
                    <AlertTriangle className="size-4" aria-hidden />
                    {matches.length} possible {matches.length === 1 ? 'duplicate' : 'duplicates'}
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-success-700 dark:text-success-500">
                    <CircleCheck className="size-4" aria-hidden />
                    No matching leads
                  </p>
                )}
                <p className="mt-2 text-xs text-muted">Checked by company name, website/email domain and email. Free-mail domains are ignored.</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Rules" />
              <CardBody>
                <ul className="space-y-1.5 text-xs text-muted">
                  <li>Status, source and industry come from lists.</li>
                  <li>Services are picked from the service catalog.</li>
                  <li>Mobiles use the UAE format +971 5X XXX XXXX.</li>
                  <li>A follow-up date is required unless the lead is closed.</li>
                </ul>
              </CardBody>
            </Card>
          </div>
        </aside>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-[75rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <p className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
            {errorCount > 0 ? (
              <span className="text-danger-600 dark:text-danger-500">
                {errorCount} {errorCount === 1 ? 'field needs' : 'fields need'} attention.
              </span>
            ) : blocked ? (
              <span className="text-warning-700 dark:text-warning-500">
                {isManager ? 'Confirm the duplicate override to save.' : 'Possible duplicate — open the existing lead instead.'}
              </span>
            ) : isDirty ? (
              'Unsaved changes'
            ) : lead ? (
              'No changes yet'
            ) : (
              'Fields marked * are required'
            )}
          </p>
          <Button variant="secondary" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={blocked || (!!lead && !isDirty)}>
            {matches.length > 0 && override ? (lead ? 'Save anyway' : 'Create anyway') : lead ? 'Save changes' : 'Create lead'}
          </Button>
        </div>
      </div>
    </form>
  )
}

function countErrors(errors: object): number {
  let n = 0
  for (const v of Object.values(errors)) {
    if (!v || typeof v !== 'object') continue
    if ('message' in v && typeof (v as { message?: unknown }).message === 'string') n++
    else n += countErrors(v as object)
  }
  return n
}

/* ------------------------------------------------------------------------------------------
 * Pieces
 * ---------------------------------------------------------------------------------------- */

function Section({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card id={`section-${id}`} className="scroll-mt-6">
      <CardHeader title={title} description={description} action={action} />
      <CardBody className="border-t border-line pt-4">{children}</CardBody>
    </Card>
  )
}

const REASON_LABEL: Record<DuplicateMatch['reason'], string> = {
  company: 'same company name',
  domain: 'same domain',
  email: 'same email',
}

function DuplicateNotice({
  matches,
  isManager,
  override,
  onOverride,
  mode,
}: {
  matches: DuplicateMatch[]
  isManager: boolean
  override: boolean
  onOverride: (v: boolean) => void
  mode: 'create' | 'edit'
}) {
  return (
    <div
      id="duplicate-notice"
      role="alert"
      className="rounded-xl border border-warning-500/40 bg-warning-50 p-4 text-[0.8125rem] dark:bg-warning-700/15"
    >
      <p className="flex items-center gap-2 font-medium text-warning-700 dark:text-warning-500">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {matches.length === 1 ? 'This looks like an existing lead' : `This matches ${matches.length} existing leads`}
      </p>
      <ul className="mt-2.5 space-y-2">
        {matches.slice(0, 5).map((m) => (
          <li key={m.leadId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={leadPath(m.leadId)}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
            >
              {m.company}
            </Link>
            <StatusBadge status={m.status} />
            <span className="text-muted">
              {m.ownerName} · {REASON_LABEL[m.reason]}
            </span>
          </li>
        ))}
      </ul>
      {isManager ? (
        <label className="mt-3 flex items-start gap-2 text-ink-2">
          <Checkbox checked={override} onChange={(e) => onOverride(e.target.checked)} className="mt-0.5" />
          <span>
            I’ve checked — {mode === 'create' ? 'create it anyway' : 'save it anyway'}. <span className="text-muted">(Managers only)</span>
          </span>
        </label>
      ) : (
        <p className="mt-3 text-muted">
          Duplicates are blocked. Open the existing lead (it opens in a new tab), or ask your manager if this really is a different company.
        </p>
      )}
    </div>
  )
}

/** Free-text tags with suggestions; Enter or comma adds, Backspace on empty removes the last. */
function TagInput({
  id,
  value,
  onChange,
  suggestions,
}: {
  id: string
  value: string[]
  onChange: (v: string[]) => void
  suggestions: string[]
}) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase())

  function add(raw: string) {
    const parts = raw
      .split(/[,;\n]/)
      .map((p) => p.trim().replace(/\s+/g, ' '))
      .filter((p) => p && p.length <= 40)
    const next = [...value]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    if (next.length !== value.length) onChange(next.slice(0, 20))
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (text.trim()) add(text)
    } else if (e.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const q = text.trim().toLowerCase()
  const shown = suggestions.filter((s) => !has(s) && (!q || s.toLowerCase().includes(q))).slice(0, 8)

  return (
    <div>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 shadow-xs transition-[border-color,box-shadow]',
          focused ? 'border-brand-500 shadow-[var(--shadow-focus)]' : 'border-line-strong hover:border-subtle',
        )}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md bg-sunken ps-2 pe-1 text-xs text-ink-2 ring-1 ring-line ring-inset">
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(value.filter((v) => v !== t))
              }}
              className="rounded p-0.5 text-subtle hover:bg-hover hover:text-ink"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={text}
          onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (text.trim()) add(text)
          }}
          placeholder={value.length === 0 ? 'e.g. Dental implants, Teeth whitening' : ''}
          className="h-6 min-w-32 flex-1 bg-transparent text-[0.8125rem] outline-none placeholder:text-subtle"
        />
      </div>
      {shown.length > 0 && (focused || value.length === 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">Used on other leads:</span>
          {shown.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-dashed border-line-strong px-2 text-xs text-muted hover:border-subtle hover:text-ink"
            >
              <Plus className="size-3" aria-hidden />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="mx-auto max-w-[75rem] space-y-5 px-4 py-6 sm:px-6 lg:px-10">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-72" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  )
}

