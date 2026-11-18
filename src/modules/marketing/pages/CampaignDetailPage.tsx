import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, Coins, Mail, MailOpen, Pencil, Plus, Reply, Target, Trophy, Users } from 'lucide-react'
import type { CampaignResults } from '@/modules/marketing/types'
import { useAddCampaignCost, useCampaignResults, useMarketingAccess } from '@/modules/marketing/hooks/useMarketing'
import { BulkEmailStatusBadge, CampaignStatusBadge, ChannelBadge } from '@/modules/marketing/components/badges'
import { CampaignDrawer } from '@/modules/marketing/components/CampaignDrawer'
import { NewBulkEmailModal } from '@/modules/marketing/components/NewBulkEmailModal'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { bulkEmailPath, MARKETING_PATHS } from '@/modules/marketing/paths'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

export default function CampaignDetailPage() {
  const { canView } = useMarketingAccess()
  if (!canView) return <NoMarketingAccess />
  return <CampaignDetail />
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

function CampaignDetail() {
  const { id = '' } = useParams()
  const user = useCurrentUser()!
  const { canEdit } = useMarketingAccess()
  const query = useCampaignResults(id)
  const [editing, setEditing] = useState(false)
  const [addingCost, setAddingCost] = useState(false)
  const [newEmail, setNewEmail] = useState(false)

  if (query.isPending) {
    return (
      <PageBody className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[7.75rem] rounded-card" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-card" />
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
  const r = query.data
  const c = r.campaign
  const k = r.kpis
  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, c.currency))

  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={MARKETING_PATHS.campaigns} className="inline-flex items-center gap-1 text-muted hover:text-ink">
              <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              Campaigns
            </Link>
            <CampaignStatusBadge status={c.status} />
            <ChannelBadge channel={c.channel} />
          </span>
        }
        actions={
          canEdit && (
            <div className="flex gap-2">
              <Button write variant="secondary" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
              <Button write onClick={() => setAddingCost(true)}>
                <Plus />
                Add cost
              </Button>
            </div>
          )
        }
      />
      <PageBody className="space-y-6">
        <section aria-label="Campaign results" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Spend"
            value={money(k.spend)}
            hint={k.budget !== null ? `of ${money(k.budget)} budget` : 'No budget set'}
            progress={k.budget ? Math.min(100, (k.spend / k.budget) * 100) : undefined}
            alert={k.budget !== null && k.spend > k.budget}
            icon={<Coins aria-hidden />}
          />
          <StatCard
            label="Leads"
            value={k.leads}
            hint={k.targetLeads !== null ? `Target ${k.targetLeads}` : 'Leads attributed to this campaign'}
            progress={k.targetLeads ? Math.min(100, (k.leads / k.targetLeads) * 100) : undefined}
            icon={<Users aria-hidden />}
          />
          <StatCard label="Cost per lead" value={money(k.costPerLead)} hint={`Cost per won deal ${money(k.costPerWon)}`} icon={<Target aria-hidden />} />
          <StatCard label="Won" value={k.won} hint={`${money(k.wonValue)} won value`} icon={<Trophy aria-hidden />} />
          <StatCard label="Emails sent" value={k.sent} hint={`${r.emails.length} bulk ${r.emails.length === 1 ? 'email' : 'emails'}`} icon={<Mail aria-hidden />} />
          <StatCard label="Opened" value={k.opened} hint={`Open rate ${pct(k.openRate)}`} icon={<MailOpen aria-hidden />} />
          <StatCard label="Replied" value={k.replied} hint={`Reply rate ${pct(k.replyRate)}`} icon={<Reply aria-hidden />} />
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Leads and won deals over time" description="Per week, leads created with this campaign and the ones won." />
            <CardBody>
              <Timeline data={r.timeline} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <PropertyList>
                <Property label="Owner">{c.ownerName || '—'}</Property>
                <Property label="Dates">
                  {c.startDate ? fmtDate(c.startDate) : '—'} – {c.endDate ? fmtDate(c.endDate) : '—'}
                </Property>
                <Property label="Budget">{money(c.budget)}</Property>
                <Property label="Source / UTM">{c.sourceDetail || '—'}</Property>
                <Property label="Goal">{c.goal || '—'}</Property>
              </PropertyList>
            </CardBody>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <CostsCard results={r} canEdit={canEdit} onAdd={() => setAddingCost(true)} />
          <EmailsCard results={r} canEdit={canEdit} onNew={() => setNewEmail(true)} />
        </div>
      </PageBody>
      <CampaignDrawer open={editing} onClose={() => setEditing(false)} campaign={c} currentUserId={user.id} />
      <AddCostModal open={addingCost} onClose={() => setAddingCost(false)} campaignId={c.id} currency={c.currency} />
      <NewBulkEmailModal open={newEmail} onClose={() => setNewEmail(false)} campaignId={c.id} />
    </>
  )
}

function Timeline({ data }: { data: CampaignResults['timeline'] }) {
  if (!data.length || data.every((w) => !w.leads && !w.won)) {
    return <EmptyState title="No leads yet" body="Leads created with this campaign show up here, week by week." />
  }
  const rows = data.map((w) => ({ ...w, label: fmtDate(w.week, 'd MMM') }))
  return (
    <div className="space-y-3">
      <LegendRow>
        <Legend color={C.brand} label="Leads" />
        <Legend color={C.green} label="Won" />
      </LegendRow>
      <div dir="ltr" className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={AXIS_TICK} />
            <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="leads" name="Leads" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="won" name="Won" fill={C.green} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CostsCard({ results, canEdit, onAdd }: { results: CampaignResults; canEdit: boolean; onAdd: () => void }) {
  const c = results.campaign
  return (
    <Card>
      <CardHeader
        title="Cost entries"
        description="Actual spend; cost per lead = total ÷ attributed leads."
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" onClick={onAdd}>
              <Plus />
              Add cost
            </Button>
          )
        }
      />
      <CardBody>
        {results.costs.length === 0 ? (
          <EmptyState title="No costs yet" body="Add what the campaign cost so its cost per lead can be worked out." />
        ) : (
          <ul aria-label="Cost entries" className="divide-y divide-line">
            {results.costs.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-[0.8125rem]">
                <div className="min-w-0">
                  <p className="truncate text-ink">{x.note || 'Cost'}</p>
                  <p className="num text-xs text-muted">{fmtDate(x.date)}</p>
                </div>
                <span className="num font-medium whitespace-nowrap text-ink">{fmtMoney(x.amount, c.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function EmailsCard({ results, canEdit, onNew }: { results: CampaignResults; canEdit: boolean; onNew: () => void }) {
  const navigate = useNavigate()
  return (
    <Card>
      <CardHeader
        title="Bulk emails"
        description="Emails sent for this campaign."
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" onClick={onNew}>
              <Plus />
              New bulk email
            </Button>
          )
        }
      />
      <CardBody>
        {results.emails.length === 0 ? (
          <EmptyState title="No bulk emails yet" body="Send a bulk email for this campaign to track opens and replies here." />
        ) : (
          <ul aria-label="Linked bulk emails" className="divide-y divide-line">
            {results.emails.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => navigate(bulkEmailPath(e.id))} className="flex w-full items-center justify-between gap-3 py-2.5 text-start text-[0.8125rem] hover:bg-hover">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{e.name}</p>
                    <p className="text-xs text-muted">
                      {e.counts.sent} sent · {e.counts.opened} opened · {e.counts.replied} replied
                    </p>
                  </div>
                  <BulkEmailStatusBadge status={e.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function AddCostModal({ open, onClose, campaignId, currency }: { open: boolean; onClose: () => void; campaignId: string; currency: string }) {
  const add = useAddCampaignCost()
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const n = Number(amount)
    if (!amount || !(n > 0)) return setError('Enter the amount spent.')
    add.mutate(
      { id: campaignId, input: { amount: n, date, note } },
      {
        onSuccess: () => {
          toast.success('Cost added', fmtMoney(n, currency))
          setAmount('')
          setNote('')
          setError('')
          onClose()
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add cost"
      description="Money spent on this campaign (ads, stands, printing…)."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="add-cost" loading={add.isPending}>
            Add cost
          </Button>
        </div>
      }
    >
      <form id="add-cost" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cost-amount" label={`Amount (${currency})`} required error={error || undefined}>
            <TextInput id="cost-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field id="cost-date" label="Date" required>
            <TextInput id="cost-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field id="cost-note" label="Note">
          <TextInput id="cost-note" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Sponsored posts, December" />
        </Field>
      </form>
    </Modal>
  )
}
