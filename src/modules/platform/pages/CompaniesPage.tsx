import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { Download, Lock } from 'lucide-react'
import type { PlatformCompanyQuery, PlatformCompanyRow } from '@/modules/platform/types'
import type { CountryCode } from '@/modules/tenancy/types'
import type { SubscriptionStatus } from '@/modules/billing/types'
import { useCompanies } from '@/modules/platform/hooks'
import { filterCompanies } from '@/modules/platform/filters'
import { buildCsv, csvFileName, downloadCsv, type CsvColumn } from '@/modules/platform/csv'
import { COUNTRIES, COUNTRY_LABEL, SUB_STATUS, SUB_STATUSES, fmtDate, fmtMoney, fmtRelative } from '@/modules/platform/format'
import { platformCompanyPath } from '@/modules/platform/permissions'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { SearchInput, SelectInput } from '@/shared/components/form/Field'

const col = createColumnHelper<PlatformCompanyRow>()

export const COMPANY_CSV: CsvColumn<PlatformCompanyRow>[] = [
  { header: 'Company', value: (r) => r.name },
  { header: 'Subdomain', value: (r) => r.subdomain },
  { header: 'Country', value: (r) => r.country },
  { header: 'Plan', value: (r) => r.planName },
  { header: 'Subscription status', value: (r) => SUB_STATUS[r.subscriptionStatus]?.label ?? r.subscriptionStatus },
  { header: 'Locked by platform', value: (r) => (r.companyStatus === 'suspended' ? 'yes' : 'no') },
  { header: 'Users', value: (r) => r.users },
  { header: 'Last activity', value: (r) => r.lastActivityAt ?? '' },
  { header: 'Created', value: (r) => r.createdAt },
  { header: 'MRR', value: (r) => r.mrr },
]

/** Every company on the platform: filters, search, sorting, CSV export of what's shown. */
export default function CompaniesPage() {
  const query = useCompanies()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const filters: PlatformCompanyQuery = {
    status: (params.get('status') as PlatformCompanyQuery['status']) || undefined,
    plan: params.get('plan') || undefined,
    country: (params.get('country') as CountryCode) || undefined,
    q,
  }
  const setFilter = (key: 'status' | 'plan' | 'country', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const all = useMemo(() => query.data ?? [], [query.data])
  const rows = useMemo(() => filterCompanies(all, filters), [all, filters.status, filters.plan, filters.country, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const showMrr = all.some((r) => r.mrr !== null)
  const plans = useMemo(() => {
    const m = new Map<string, string>()
    all.forEach((r) => m.set(r.planId, r.planName))
    return [...m]
  }, [all])

  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Company',
        cell: (c) => (
          <Link
            to={platformCompanyPath(c.row.original.id)}
            data-company-id={c.row.original.id}
            onClick={(e) => e.stopPropagation()}
            className="block min-w-0"
          >
            <span className="block truncate font-medium text-ink hover:underline">{c.getValue()}</span>
            <span className="block truncate font-mono text-xs text-subtle">{c.row.original.subdomain}</span>
          </Link>
        ),
      }),
      col.accessor('planName', { header: 'Plan', cell: (c) => <Badge variant="outline">{c.getValue()}</Badge> }),
      col.accessor('subscriptionStatus', {
        header: 'Status',
        cell: (c) => {
          const s = SUB_STATUS[c.getValue()] ?? { label: c.getValue(), tone: 'neutral' as const }
          return (
            <span className="flex flex-wrap items-center gap-1" data-status={c.getValue()} data-locked={c.row.original.companyStatus === 'suspended' || undefined}>
              <Badge tone={s.tone} variant="dot">
                {s.label}
              </Badge>
              {c.row.original.companyStatus === 'suspended' && (
                <Badge tone="red" icon={<Lock aria-hidden />}>
                  Locked
                </Badge>
              )}
            </span>
          )
        },
      }),
      col.accessor('country', { header: 'Country', cell: (c) => <span title={COUNTRY_LABEL[c.getValue()]}>{c.getValue()}</span> }),
      col.accessor('users', { header: 'Users', meta: { align: 'end' }, cell: (c) => <span className="num">{c.getValue()}</span> }),
      col.accessor((r) => r.lastActivityAt ?? '', {
        id: 'lastActivityAt',
        header: 'Last activity',
        cell: (c) => (
          <span className="whitespace-nowrap text-muted" title={c.row.original.lastActivityAt ?? undefined}>
            {fmtRelative(c.row.original.lastActivityAt)}
          </span>
        ),
      }),
      col.accessor('createdAt', { header: 'Created', cell: (c) => <span className="whitespace-nowrap text-muted">{fmtDate(c.getValue())}</span> }),
      ...(showMrr
        ? [
            col.accessor((r) => r.mrr ?? -1, {
              id: 'mrr',
              header: 'MRR',
              meta: { align: 'end' as const },
              cell: (c) => <span className="num">{fmtMoney(c.row.original.mrr)}</span>,
            }),
          ]
        : []),
    ],
    [showMrr],
  )

  const table = useDataTable({ id: 'platform-companies', data: rows, columns, defaultSorting: [{ id: 'createdAt', desc: true }], getRowId: (r) => r.id })

  function exportCsv() {
    const sorted = table.getSortedRowModel().rows.map((r) => r.original)
    const cols = showMrr ? COMPANY_CSV : COMPANY_CSV.filter((c) => c.header !== 'MRR')
    downloadCsv(csvFileName('companies'), buildCsv(sorted, cols))
  }

  const filtered = !!(filters.status || filters.plan || filters.country || q.trim())

  return (
    <>
      <PageHeader title="Companies" description="Every workspace on the platform. Open one to see its subscription, usage and support tools." />
      <PageBody>
        <div id="companies-table" data-count={rows.length}>
          <DataTable
            table={table}
            loading={query.isPending}
            error={query.error}
            onRetry={() => query.refetch()}
            onRowClick={(r) => navigate(platformCompanyPath(r.id))}
            minWidth={960}
            empty={
              <EmptyState
                title={filtered ? 'No companies match' : 'No companies yet'}
                body={filtered ? 'Try other filters or clear the search.' : 'Companies appear here after sign-up.'}
              />
            }
            toolbar={
              <>
                <SearchInput
                  id="companies-search"
                  aria-label="Search companies"
                  placeholder="Search name or subdomain…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-full sm:w-64"
                />
                <SelectInput
                  id="companies-filter-status"
                  aria-label="Filter by status"
                  value={filters.status ?? ''}
                  onChange={(e) => setFilter('status', e.target.value)}
                  className="h-8 w-40"
                >
                  <option value="">All statuses</option>
                  {SUB_STATUSES.map((s: SubscriptionStatus) => (
                    <option key={s} value={s}>
                      {SUB_STATUS[s].label}
                    </option>
                  ))}
                  <option value="locked">Locked by platform</option>
                </SelectInput>
                <SelectInput
                  id="companies-filter-plan"
                  aria-label="Filter by plan"
                  value={filters.plan ?? ''}
                  onChange={(e) => setFilter('plan', e.target.value)}
                  className="h-8 w-36"
                >
                  <option value="">All plans</option>
                  {plans.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </SelectInput>
                <SelectInput
                  id="companies-filter-country"
                  aria-label="Filter by country"
                  value={filters.country ?? ''}
                  onChange={(e) => setFilter('country', e.target.value)}
                  className="h-8 w-44"
                >
                  <option value="">All countries</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>
                      {COUNTRY_LABEL[c]}
                    </option>
                  ))}
                </SelectInput>
                <span className="num ms-auto text-xs text-muted" id="companies-count">
                  {rows.length} of {all.length}
                </span>
                <Button id="companies-export" size="sm" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
                  <Download />
                  Export CSV
                </Button>
              </>
            }
          />
        </div>
      </PageBody>
    </>
  )
}
