import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { Coins, Megaphone, Plus, Target, Users, X } from 'lucide-react'
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  type Campaign,
} from '@/modules/marketing/types'
import { useCampaignsQuery, useMarketingAccess } from '@/modules/marketing/hooks/useMarketing'
import { CampaignStatusBadge, ChannelBadge } from '@/modules/marketing/components/badges'
import { CampaignDrawer } from '@/modules/marketing/components/CampaignDrawer'
import { campaignPath } from '@/modules/marketing/paths'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { Meter } from '@/modules/reports/components/chartKit'
import { useNewParam } from '@/shared/hooks/useNewParam'

export default function CampaignsPage() {
  const { canView } = useMarketingAccess()
  if (!canView) return <NoMarketingAccess />
  return <CampaignList />
}

function CampaignList() {
  const user = useCurrentUser()!
  const navigate = useNavigate()
  const { canEdit } = useMarketingAccess()
  const query = useCampaignsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canEdit })
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({
    id: 'marketing-campaigns',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: campaignSearch,
    defaultSorting: [{ id: 'createdAt', desc: true }],
    getRowId: (r) => r.id,
  })
  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Channel, budget and goal of every campaign, what it cost and the leads it brought."
        actions={
          canEdit && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New campaign
            </Button>
          )
        }
      />
      <PageBody className="space-y-6">
        <Kpis data={data} loading={query.isPending} />
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(campaignPath(row.id))}
          toolbar={
            <>
              <SearchInput aria-label="Search campaigns" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" className="w-full sm:w-64" />
              <Facets table={table} data={data} />
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    table.resetColumnFilters()
                    setSearch('')
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
            </>
          }
          empty={
            <EmptyState
              icon={<Megaphone aria-hidden />}
              title={data.length === 0 ? 'No campaigns yet' : 'No campaigns match'}
              body={data.length === 0 ? 'Create a campaign to track its spend, the leads it brings and its cost per lead.' : 'Try another search or clear the filters.'}
              action={
                data.length === 0 && canEdit ? (
                  <Button write size="sm" onClick={() => setCreating(true)}>
                    <Plus />
                    New campaign
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
      <CampaignDrawer open={creating} onClose={() => setCreating(false)} campaign={null} currentUserId={user.id} onSaved={(c) => navigate(campaignPath(c.id))} />
    </>
  )
}

function Kpis({ data, loading }: { data: Campaign[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[7.75rem] rounded-card" />
        ))}
      </div>
    )
  }
  const active = data.filter((c) => c.status === 'active')
  const spend = data.reduce((s, c) => s + c.spend, 0)
  const leads = data.reduce((s, c) => s + c.leads, 0)
  const currency = data[0]?.currency
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Active campaigns" value={active.length} hint={`${data.length} in total`} icon={<Megaphone aria-hidden />} />
      <StatCard label="Total spend" value={fmtMoney(spend, currency)} hint="Sum of cost entries" icon={<Coins aria-hidden />} />
      <StatCard label="Attributed leads" value={leads} hint={`${data.reduce((s, c) => s + c.won, 0)} won`} icon={<Users aria-hidden />} />
      <StatCard label="Cost per lead" value={leads ? fmtMoney(spend / leads, currency) : '—'} hint="Spend ÷ attributed leads" icon={<Target aria-hidden />} />
    </div>
  )
}

function Facets({ table, data }: { table: Table<Campaign>; data: Campaign[] }) {
  const facet = (id: string, title: string, options: { value: string; label: string }[]) => {
    const column = table.getColumn(id)
    if (!column) return null
    return (
      <FacetFilter
        title={title}
        options={options}
        selected={(column.getFilterValue() as string[] | undefined) ?? []}
        onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
      />
    )
  }
  return (
    <>
      {facet('status', 'Status', CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABEL[s], count: data.filter((c) => c.status === s).length })))}
      {facet('channel', 'Channel', CAMPAIGN_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c], count: data.filter((x) => x.channel === c).length })))}
    </>
  )
}

const inSet: FilterFn<Campaign> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))
const col = createColumnHelper<Campaign>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Campaign',
      enableHiding: false,
      meta: { width: 300 },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.original.name}</p>
          <p className="truncate text-xs text-muted">
            {row.original.startDate ? fmtDate(row.original.startDate) : 'No start date'}
            {row.original.endDate ? ` – ${fmtDate(row.original.endDate)}` : ''}
          </p>
        </div>
      ),
    }),
    col.accessor('status', { header: 'Status', filterFn: inSet, cell: ({ getValue }) => <CampaignStatusBadge status={getValue()} /> }),
    col.accessor('channel', { header: 'Channel', filterFn: inSet, cell: ({ getValue }) => <ChannelBadge channel={getValue()} /> }),
    col.accessor('spend', {
      header: 'Spend vs budget',
      meta: { width: 200 },
      cell: ({ row }) => {
        const c = row.original
        const pct = c.budget ? Math.min(100, (c.spend / c.budget) * 100) : null
        return (
          <div className="min-w-[9rem] space-y-1">
            <p className="num text-[0.8125rem] whitespace-nowrap text-ink">
              {fmtMoney(c.spend, c.currency)}
              <span className="text-muted">{c.budget != null ? ` / ${fmtMoney(c.budget, c.currency)}` : ''}</span>
            </p>
            {pct !== null && <Meter value={pct} color={c.spend > (c.budget ?? 0) ? '#ef4444' : undefined} />}
          </div>
        )
      },
    }),
    col.accessor('leads', {
      header: 'Leads',
      meta: { align: 'end' },
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-ink">
          {row.original.leads}
          <span className="text-muted"> · {row.original.won} won</span>
        </span>
      ),
    }),
    col.accessor('costPerLead', {
      header: 'Cost per lead',
      meta: { align: 'end' },
      sortingFn: (a, b) => (a.original.costPerLead ?? Infinity) - (b.original.costPerLead ?? Infinity),
      cell: ({ row }) => <span className="num whitespace-nowrap text-ink">{row.original.costPerLead != null ? fmtMoney(row.original.costPerLead, row.original.currency) : '—'}</span>,
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      cell: ({ getValue }) =>
        getValue() ? (
          <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
            <Avatar name={getValue()} size="xs" />
            {getValue()}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('createdAt', { header: 'Created', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
  ]
}

const campaignSearch: FilterFn<Campaign> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const c = row.original
  return [c.name, c.goal, c.ownerName, c.sourceDetail, CHANNEL_LABEL[c.channel]].join(' ').toLowerCase().includes(q)
}
