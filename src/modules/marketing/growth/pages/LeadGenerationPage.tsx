import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { Eye, FileInput, Link2, MousePointerClick, Plus, Send, Trophy, Users } from 'lucide-react'
import type { FormField, LeadForm } from '@/modules/marketing/growth/types'
import { useCreateForm, useFormsQuery, useGrowthAccess } from '@/modules/marketing/growth/hooks'
import { FormStatusBadge } from '@/modules/marketing/growth/components/bits'
import { LandingPagesTab } from '@/modules/marketing/growth/components/LandingPagesTab'
import { UtmLinksTab } from '@/modules/marketing/growth/components/UtmLinksTab'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { leadFormPath } from '@/modules/marketing/paths'
import { useLookups } from '@/shared/hooks/useLookups'
import { fmtPct } from '@/modules/reports/components/chartKit'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

type Tab = 'forms' | 'pages' | 'utm'
const TABS: { id: Tab; label: string }[] = [
  { id: 'forms', label: 'Forms' },
  { id: 'pages', label: 'Landing pages' },
  { id: 'utm', label: 'UTM links' },
]

export default function LeadGenerationPage() {
  const { canView } = useGrowthAccess()
  if (!canView) return <NoMarketingAccess what="Lead generation" />
  return <LeadGeneration />
}

function LeadGeneration() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'forms') as Tab
  return (
    <>
      <PageHeader title="Lead generation" description="Lead capture forms for your website, landing pages and tagged links. Every submission becomes a lead (or links the existing one)." />
      <PageBody className="space-y-6">
        <Tabs label="Lead generation" items={TABS} value={tab} onChange={(t) => setParams(t === 'forms' ? {} : { tab: t }, { replace: true })} />
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'forms' ? <FormsTab /> : tab === 'pages' ? <LandingPagesTab /> : <UtmLinksTab />}
        </div>
      </PageBody>
    </>
  )
}

/* ---------------- Forms ---------------- */

const col = createColumnHelper<LeadForm>()

function FormsTab() {
  const navigate = useNavigate()
  const { canEdit } = useGrowthAccess()
  const query = useFormsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canEdit })
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Form',
        enableHiding: false,
        meta: { width: 280 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="truncate text-xs text-muted">
              {row.original.source}
              {row.original.campaignName ? ` · ${row.original.campaignName}` : ''}
            </p>
          </div>
        ),
      }),
      col.accessor('status', { header: 'Status', cell: ({ getValue }) => <FormStatusBadge status={getValue()} /> }),
      col.accessor((r) => r.stats.views, { id: 'views', header: 'Views', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor((r) => r.stats.submissions, { id: 'submissions', header: 'Submissions', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor((r) => r.stats.conversionRate ?? -1, {
        id: 'conversion',
        header: 'Conversion',
        meta: { align: 'end' },
        cell: ({ row }) => <span className="num">{row.original.stats.conversionRate === null ? '—' : fmtPct(row.original.stats.conversionRate)}</span>,
      }),
      col.accessor((r) => r.stats.leadsCreated, {
        id: 'leads',
        header: 'Leads',
        meta: { align: 'end' },
        cell: ({ row }) => (
          <span className="num whitespace-nowrap">
            {row.original.stats.leadsCreated}
            <span className="text-muted"> · {row.original.stats.leadsLinked} linked</span>
          </span>
        ),
      }),
      col.accessor((r) => r.stats.wonDeals, { id: 'won', header: 'Won deals', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue()}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-lead-forms', data, columns, defaultSorting: [{ id: 'submissions', desc: true }], getRowId: (r) => r.id })

  const totals = data.reduce(
    (s, f) => ({ views: s.views + f.stats.views, subs: s.subs + f.stats.submissions, leads: s.leads + f.stats.leadsCreated, won: s.won + f.stats.wonDeals }),
    { views: 0, subs: 0, leads: 0, won: 0 },
  )

  return (
    <div className="space-y-6">
      {query.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[7.75rem] rounded-card" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Form views" value={totals.views.toLocaleString()} hint={`${data.filter((f) => f.status === 'active').length} active forms`} icon={<Eye aria-hidden />} />
          <StatCard label="Submissions" value={totals.subs.toLocaleString()} hint="Spam not counted" icon={<Send aria-hidden />} />
          <StatCard label="Conversion" value={totals.views ? fmtPct(Math.round((totals.subs / totals.views) * 1000) / 10) : '—'} hint="Submissions ÷ views" icon={<MousePointerClick aria-hidden />} />
          <StatCard label="Leads created" value={totals.leads} hint={`${totals.won} won deal${totals.won === 1 ? '' : 's'}`} icon={<Trophy aria-hidden />} />
        </div>
      )}
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(row) => navigate(leadFormPath(row.id))}
        toolbar={
          <>
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted">
              <Users className="size-4" aria-hidden />
              Views are counted when the hosted page, the embed or a landing page loads the form.
            </p>
            {canEdit && (
              <Button write size="sm" className="ms-auto" onClick={() => setCreating(true)}>
                <Plus />
                New form
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<FileInput aria-hidden />}
            title="No lead capture forms yet"
            body="Build a form, put it on your website with the embed code or share its hosted page, and every submission lands in Leads."
            action={
              canEdit ? (
                <Button write size="sm" onClick={() => setCreating(true)}>
                  <Plus />
                  New form
                </Button>
              ) : undefined
            }
          />
        }
      />
      <NewFormModal open={creating} onClose={() => setCreating(false)} onCreated={(f) => navigate(leadFormPath(f.id))} />
    </div>
  )
}

/** Fields a new form starts with (editable in the builder). */
const STARTER_FIELDS: FormField[] = [
  { key: 'contact_name', type: 'contact_name', label: 'Your name', required: true },
  { key: 'email', type: 'email', label: 'Work email', required: true },
  { key: 'company_name', type: 'company_name', label: 'Company', required: false },
  { key: 'message', type: 'message', label: 'Message', required: false },
]

function NewFormModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (f: LeadForm) => void }) {
  const lookups = useLookups()
  const create = useCreateForm()
  const toast = useToast()
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const defaultSource = lookups.sources.find((s) => s.key.toLowerCase() === 'website')?.key ?? lookups.sources[0]?.key ?? ''
  const chosen = source || defaultSource

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      { name, source: chosen, fields: STARTER_FIELDS },
      {
        onSuccess: (f) => {
          toast.success('Form created', 'Add fields, then copy the embed code or the link.')
          onClose()
          setName('')
          onCreated(f)
        },
        onError: (err) => toast.error('Not created', (err as Error).message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New lead capture form"
      description="It starts with name, email, company and message; change the fields in the builder."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="new-form" loading={create.isPending} disabled={!name.trim() || !chosen}>
            <Link2 />
            Create form
          </Button>
        </>
      }
    >
      <form id="new-form" onSubmit={submit} className="space-y-4">
        <Field id="nf-name" label="Name" required>
          <TextInput id="nf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Website contact form" autoFocus />
        </Field>
        <Field id="nf-source" label="Lead source" hint="Leads from this form get this source (Settings › Fixed lists).">
          <SelectInput id="nf-source" value={chosen} onChange={(e) => setSource(e.target.value)}>
            {lookups.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </Modal>
  )
}
