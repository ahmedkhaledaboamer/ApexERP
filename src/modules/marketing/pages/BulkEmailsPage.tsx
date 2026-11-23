import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { Mail, Plus } from 'lucide-react'
import { BULK_EMAIL_STATUSES, BULK_EMAIL_STATUS_LABEL, type BulkEmail } from '@/modules/marketing/types'
import { useBulkEmailsQuery, useMarketingAccess } from '@/modules/marketing/hooks/useMarketing'
import { BulkEmailStatusBadge } from '@/modules/marketing/components/badges'
import { NewBulkEmailModal } from '@/modules/marketing/components/NewBulkEmailModal'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { bulkEmailPath } from '@/modules/marketing/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

export default function BulkEmailsPage() {
  const { canView } = useMarketingAccess()
  if (!canView) return <NoMarketingAccess />
  return <BulkEmailList />
}

function BulkEmailList() {
  const navigate = useNavigate()
  const { canEdit } = useMarketingAccess()
  const query = useBulkEmailsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: canEdit })
  const columns = useMemo(() => buildColumns(), [])
  const table = useDataTable({
    id: 'marketing-emails',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: (row, _id, value: string) =>
      [row.original.name, row.original.subject, row.original.campaignName ?? ''].join(' ').toLowerCase().includes(String(value).trim().toLowerCase()),
    defaultSorting: [{ id: 'createdAt', desc: true }],
    getRowId: (r) => r.id,
  })
  const status = table.getColumn('status')

  return (
    <>
      <PageHeader
        title="Bulk email"
        description="Emails to a target list by industry, status and source. Do Not Contact and Not interested leads are always left out."
        actions={
          canEdit && (
            <Button write onClick={() => setCreating(true)}>
              <Plus />
              New bulk email
            </Button>
          )
        }
      />
      <PageBody>
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(bulkEmailPath(row.id))}
          toolbar={
            <>
              <SearchInput aria-label="Search bulk emails" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, subject, campaign…" className="w-full sm:w-64" />
              {status && (
                <FacetFilter
                  title="Status"
                  options={BULK_EMAIL_STATUSES.map((s) => ({ value: s, label: BULK_EMAIL_STATUS_LABEL[s], count: data.filter((e) => e.status === s).length }))}
                  selected={(status.getFilterValue() as string[] | undefined) ?? []}
                  onChange={(v) => status.setFilterValue(v.length ? v : undefined)}
                />
              )}
            </>
          }
          empty={
            <EmptyState
              icon={<Mail aria-hidden />}
              title={data.length === 0 ? 'No bulk emails yet' : 'No bulk emails match'}
              body={data.length === 0 ? 'Build an email from a template, pick a target list and send it now or later.' : 'Try another search or clear the filters.'}
              action={
                data.length === 0 && canEdit ? (
                  <Button write size="sm" onClick={() => setCreating(true)}>
                    <Plus />
                    New bulk email
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
      <NewBulkEmailModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

const inSet: FilterFn<BulkEmail> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))
const col = createColumnHelper<BulkEmail>()

function buildColumns() {
  return [
    col.accessor('name', {
      header: 'Bulk email',
      enableHiding: false,
      meta: { width: 320 },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.original.name}</p>
          <p className="truncate text-xs text-muted">{row.original.subject || 'No subject yet'}</p>
        </div>
      ),
    }),
    col.accessor('status', { header: 'Status', filterFn: inSet, cell: ({ getValue }) => <BulkEmailStatusBadge status={getValue()} /> }),
    col.accessor('campaignName', { header: 'Campaign', cell: ({ getValue }) => <span className="text-ink-2">{getValue() ?? '—'}</span> }),
    col.accessor((e) => e.counts.sent, {
      id: 'sent',
      header: 'Sent',
      meta: { align: 'end' },
      cell: ({ row }) => <span className="num text-ink">{row.original.counts.sent}</span>,
    }),
    col.accessor((e) => e.counts.openRate ?? -1, {
      id: 'openRate',
      header: 'Opened',
      meta: { align: 'end' },
      cell: ({ row }) => <span className="num text-ink">{row.original.counts.openRate === null ? '—' : `${row.original.counts.openRate}%`}</span>,
    }),
    col.accessor((e) => e.counts.replyRate ?? -1, {
      id: 'replyRate',
      header: 'Replied',
      meta: { align: 'end' },
      cell: ({ row }) => <span className="num text-ink">{row.original.counts.replyRate === null ? '—' : `${row.original.counts.replyRate}%`}</span>,
    }),
    col.accessor((e) => e.sentAt ?? e.scheduledAt ?? '', {
      id: 'when',
      header: 'Sent / scheduled',
      cell: ({ row }) => {
        const e = row.original
        const when = e.sentAt ?? e.startedAt ?? e.scheduledAt
        return <span className="num whitespace-nowrap text-muted">{when ? fmtDate(when, 'd MMM yyyy, HH:mm') : '—'}</span>
      },
    }),
    col.accessor('createdAt', { header: 'Created', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
  ]
}
