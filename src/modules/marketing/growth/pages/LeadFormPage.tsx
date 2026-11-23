import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Eye, MousePointerClick, Pause, Play, Plus, Save, Send, Trash2, Trophy, X } from 'lucide-react'
import {
  FORM_FIELD_LABEL,
  FORM_FIELD_TYPES,
  MAX_CUSTOM_FIELDS,
  type FormField,
  type FormFieldType,
  type FormSubmission,
  type LeadForm,
} from '@/modules/marketing/growth/types'
import { useDeleteForm, useFormQuery, useGrowthAccess, useSubmissionsQuery, useUpdateForm } from '@/modules/marketing/growth/hooks'
import { useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { CopyField, embedSnippets, FormStatusBadge, OutcomeBadge, usePublicUrls } from '@/modules/marketing/growth/components/bits'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { MARKETING_PATHS, publicFormPath } from '@/modules/marketing/paths'
import { leadPath } from '@/app/paths'
import { fmtPct } from '@/modules/reports/components/chartKit'
import { useLookups } from '@/shared/hooks/useLookups'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

export default function LeadFormPage() {
  const { canView } = useGrowthAccess()
  if (!canView) return <NoMarketingAccess what="Lead generation" />
  return <LeadFormScreen />
}

function LeadFormScreen() {
  const { id = '' } = useParams()
  const query = useFormQuery(id)
  if (query.isPending) {
    return (
      <PageBody className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 rounded-card" />
      </PageBody>
    )
  }
  if (query.isError) {
    return (
      <PageBody>
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </PageBody>
    )
  }
  return <Builder key={`${query.data.id}:${query.data.updatedAt}`} form={query.data} />
}

type Draft = Pick<LeadForm, 'name' | 'fields' | 'source' | 'campaignId' | 'ownerIds' | 'successMessage' | 'redirectUrl' | 'consentText'>
const draftOf = (f: LeadForm): Draft => ({
  name: f.name,
  fields: f.fields,
  source: f.source,
  campaignId: f.campaignId,
  ownerIds: f.ownerIds,
  successMessage: f.successMessage,
  redirectUrl: f.redirectUrl,
  consentText: f.consentText,
})

function Builder({ form }: { form: LeadForm }) {
  const { canEdit } = useGrowthAccess()
  const navigate = useNavigate()
  const toast = useToast()
  const lookups = useLookups()
  const options = useMarketingOptions()
  const update = useUpdateForm()
  const remove = useDeleteForm()
  const [d, setD] = useState<Draft>(() => draftOf(form))
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(form))
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  function save() {
    update.mutate(
      { id: form.id, input: { ...d, redirectUrl: d.redirectUrl?.trim() || null } },
      { onSuccess: () => toast.success('Form saved'), onError: (err) => toast.error('Not saved', (err as Error).message) },
    )
  }
  function toggleStatus() {
    const status = form.status === 'active' ? 'paused' : 'active'
    update.mutate(
      { id: form.id, input: { status } },
      { onSuccess: () => toast.info(status === 'paused' ? 'Form paused: visitors see it as closed' : 'Form active again'), onError: (err) => toast.error('Not changed', (err as Error).message) },
    )
  }

  const setField = (i: number, patch: Partial<FormField>) => set('fields', d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const move = (i: number, by: -1 | 1) => {
    const list = [...d.fields]
    const j = i + by
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    set('fields', list)
  }
  const used = new Set(d.fields.map((f) => f.type))
  const customs = d.fields.filter((f) => f.type === 'custom').length
  const addable = FORM_FIELD_TYPES.filter((t) => (t === 'custom' ? customs < MAX_CUSTOM_FIELDS : !used.has(t)))
  function addField(type: FormFieldType) {
    let key: string = type
    if (type === 'custom') {
      let n = 1
      while (d.fields.some((f) => f.key === `custom_${n}`)) n++
      key = `custom_${n}`
    }
    set('fields', [...d.fields, { key, type, label: FORM_FIELD_LABEL[type], required: false }])
  }

  return (
    <>
      <PageHeader
        title={form.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={MARKETING_PATHS.leadGeneration} className="inline-flex items-center gap-1 text-muted hover:text-ink">
              <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              Lead generation
            </Link>
            <FormStatusBadge status={form.status} />
          </span>
        }
        actions={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              {form.stats.submissions + form.stats.spam === 0 && (
                <Button write variant="ghost" onClick={() => remove.mutate(form.id, { onSuccess: () => navigate(MARKETING_PATHS.leadGeneration), onError: (err) => toast.error('Not deleted', (err as Error).message) })}>
                  <Trash2 />
                  Delete
                </Button>
              )}
              <Button write variant="secondary" onClick={toggleStatus} loading={update.isPending && !dirty}>
                {form.status === 'active' ? <Pause /> : <Play />}
                {form.status === 'active' ? 'Pause' : 'Activate'}
              </Button>
              <Button write disabled={!dirty} loading={update.isPending && dirty} onClick={save}>
                <Save />
                Save form
              </Button>
            </div>
          )
        }
      />
      <PageBody className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Views" value={form.stats.views.toLocaleString()} hint="Hosted page, embed and landing pages" icon={<Eye aria-hidden />} />
          <StatCard label="Submissions" value={form.stats.submissions} hint={`${form.stats.spam} spam caught`} icon={<Send aria-hidden />} />
          <StatCard label="Conversion rate" value={form.stats.conversionRate === null ? '—' : fmtPct(form.stats.conversionRate)} hint="Submissions ÷ views" icon={<MousePointerClick aria-hidden />} />
          <StatCard
            label="Leads created"
            value={form.stats.leadsCreated}
            hint={`${form.stats.leadsLinked} linked · ${form.stats.limitReached} over plan limit · ${form.stats.wonDeals} won`}
            icon={<Trophy aria-hidden />}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_26rem]">
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Fields"
                description="Lead fields in the order visitors see them. Message and custom answers go to the lead’s first note."
                action={
                  canEdit &&
                  addable.length > 0 && (
                    <Menu
                      trigger={(props) => (
                        <Button variant="secondary" size="sm" {...props}>
                          <Plus />
                          Add field
                        </Button>
                      )}
                    >
                      {addable.map((t) => (
                        <MenuItem key={t} onSelect={() => addField(t)}>
                          {FORM_FIELD_LABEL[t]}
                        </MenuItem>
                      ))}
                    </Menu>
                  )
                }
              />
              <CardBody className="p-0">
                <ol className="divide-y divide-line" aria-label="Form fields">
                  {d.fields.map((f, i) => (
                    <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Badge tone={f.type === 'custom' ? 'brand' : 'neutral'} className="w-36 shrink-0 justify-center">
                        {FORM_FIELD_LABEL[f.type]}
                      </Badge>
                      <TextInput aria-label={`Label of ${FORM_FIELD_LABEL[f.type]}`} value={f.label} readOnly={!canEdit} onChange={(e) => setField(i, { label: e.target.value })} className="min-w-[12rem] flex-1" />
                      <label className="flex items-center gap-1.5 text-[0.8125rem] text-ink-2">
                        <Checkbox checked={f.required} disabled={!canEdit} onChange={(e) => setField(i, { required: e.target.checked })} aria-label={`${f.label} required`} />
                        Required
                      </label>
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="xs" iconOnly aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                            <ArrowUp />
                          </Button>
                          <Button variant="ghost" size="xs" iconOnly aria-label={`Move ${f.label} down`} disabled={i === d.fields.length - 1} onClick={() => move(i, 1)}>
                            <ArrowDown />
                          </Button>
                          <Button variant="ghost" size="xs" iconOnly aria-label={`Remove ${f.label}`} onClick={() => set('fields', d.fields.filter((_, j) => j !== i))}>
                            <X />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Routing & after submit" description="Where the leads go and what visitors see." />
              <CardBody className="space-y-4">
                <Field id="lf-name" label="Form name" required>
                  <TextInput id="lf-name" value={d.name} readOnly={!canEdit} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field id="lf-source" label="Lead source" required>
                    <SelectInput id="lf-source" value={d.source} disabled={!canEdit} onChange={(e) => set('source', e.target.value)}>
                      {lookups.sources.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field id="lf-campaign" label="Campaign" hint="New leads are attributed to it (cost per lead).">
                    <SelectInput id="lf-campaign" value={d.campaignId ?? ''} disabled={!canEdit} onChange={(e) => set('campaignId', e.target.value || null)}>
                      <option value="">No campaign</option>
                      {(options.data?.campaigns ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
                <div>
                  <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Default owners</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <FacetFilter
                      title="Owners"
                      options={(options.data?.owners ?? []).map((o) => ({ value: o.id, label: `${o.name} · ${o.role}` }))}
                      selected={d.ownerIds}
                      onChange={(v) => canEdit && set('ownerIds', v)}
                    />
                    <span className="text-xs text-muted">
                      {d.ownerIds.length ? `New leads go to ${d.ownerIds.length} people in turn (round-robin).` : 'None: the first active Sales Agent gets new leads.'}
                    </span>
                  </div>
                </div>
                <Field id="lf-success" label="Success message">
                  <TextArea id="lf-success" rows={2} value={d.successMessage} readOnly={!canEdit} onChange={(e) => set('successMessage', e.target.value)} />
                </Field>
                <Field id="lf-redirect" label="Redirect URL" hint="Optional: send visitors to this page instead of showing the message.">
                  <TextInput id="lf-redirect" value={d.redirectUrl ?? ''} readOnly={!canEdit} placeholder="https://…" onChange={(e) => set('redirectUrl', e.target.value)} />
                </Field>
                <Field id="lf-consent" label="Consent checkbox text" hint="Leave empty for no checkbox. When set, visitors must tick it to submit.">
                  <TextArea id="lf-consent" rows={2} value={d.consentText} readOnly={!canEdit} onChange={(e) => set('consentText', e.target.value)} />
                </Field>
              </CardBody>
            </Card>
          </div>
          <SharePanel form={form} />
        </div>

        <Submissions formId={form.id} />
      </PageBody>
    </>
  )
}

function SharePanel({ form }: { form: LeadForm }) {
  const urls = usePublicUrls()
  const { hosted, iframe, script } = embedSnippets(form, urls.url(publicFormPath(form.publicKey)))
  return (
    <Card className="h-fit">
      <CardHeader title="Share & embed" description="Put the form on your website or share its hosted page." />
      <CardBody className="space-y-4">
        <CopyField label="Hosted page" value={hosted} testId="form-hosted-url" />
        <a href={hosted} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-600 hover:underline">
          <ExternalLink className="size-3.5" aria-hidden />
          Open the hosted page
        </a>
        <CopyField label="Embed (iframe)" value={iframe} code />
        <CopyField label="Embed (JavaScript, auto height)" value={script} code />
        {form.status === 'paused' && <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">Paused: visitors see “not accepting responses”.</p>}
      </CardBody>
    </Card>
  )
}

const col = createColumnHelper<FormSubmission>()

function Submissions({ formId }: { formId: string }) {
  const query = useSubmissionsQuery(formId)
  const data = useMemo(() => query.data ?? [], [query.data])
  const columns = useMemo(
    () => [
      col.accessor('submittedAt', { header: 'Submitted', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue(), 'd MMM yyyy, HH:mm')}</span> }),
      col.accessor('name', {
        header: 'Who',
        meta: { width: 240 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name || row.original.companyName || '—'}</p>
            <p className="truncate text-xs text-muted">{[row.original.email, row.original.companyName].filter(Boolean).join(' · ')}</p>
          </div>
        ),
      }),
      col.accessor('channel', { header: 'Via', cell: ({ getValue }) => <span className="text-ink-2">{getValue() === 'landing' ? 'Landing page' : getValue() === 'embed' ? 'Embed' : 'Hosted page'}</span> }),
      col.accessor('outcome', {
        header: 'Outcome',
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            <OutcomeBadge outcome={row.original.outcome} />
            {row.original.doNotContact && <Badge tone="red">Do Not Contact</Badge>}
          </span>
        ),
      }),
      col.accessor('leadId', {
        header: 'Lead',
        cell: ({ getValue }) =>
          getValue() ? (
            <Link to={leadPath(getValue()!)} className="text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>
              {getValue()}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          ),
      }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-form-submissions', data, columns, defaultSorting: [{ id: 'submittedAt', desc: true }], getRowId: (r) => r.id })
  return (
    <section aria-label="Submissions" className="space-y-3">
      <h2 className="text-base font-semibold text-ink">Submissions</h2>
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={<EmptyState icon={<Send aria-hidden />} title="No submissions yet" body="Share the hosted page or embed the form; submissions show up here with what happened to each lead." />}
      />
    </section>
  )
}
