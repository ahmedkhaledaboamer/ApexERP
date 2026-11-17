import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { Ban, Network, X } from 'lucide-react'
import { leadPath } from '@/app/paths'
import { LeadsHeader } from '@/modules/leads/components/LeadsHeader'
import { FollowUpLabel, followUpState } from '@/modules/leads/components/FollowUpLabel'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import type { LeadRow } from '@/modules/leads/types'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { useLookups, type LookupsApi } from '@/shared/hooks/useLookups'
import { useLeadAlerts } from '@/modules/alerts/hooks/useAlerts'
import { LeadAlertBadges } from '@/modules/alerts/components/LeadAlertBadges'
import type { Alert } from '@/modules/alerts/types'
import { useCatalog } from '@/modules/services/hooks/useServices'
import { CategoryIcon, UnmatchedChip } from '@/modules/leads/components/ServiceFields'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useDepartmentsQuery } from '@/modules/departments/hooks/useDepartments'
import { buildTree, walk } from '@/modules/departments/lib/tree'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { SearchInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'

export default function LeadsListPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState
          title="Leads aren’t part of your role"
          body={`${user.role} has no access to Sales & CRM. Ask a System Admin if you need it.`}
        />
      </PageBody>
    )
  }
  return <LeadsList scope={scope} />
}

function LeadsList({ scope }: { scope: ReturnType<typeof scopeOf> }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useLeadsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const lookups = useLookups()
  const leadAlerts = useLeadAlerts()
  const catalog = useCatalog()
  const depts = useOwnerDepartments()
  const columns = useMemo(() => buildColumns(lookups, leadAlerts, catalog, depts), [lookups, leadAlerts, catalog, depts])

  const table = useDataTable({
    id: 'leads',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: leadSearch,
    defaultHidden: ['createdAt', 'sourceType', 'recommendedService', 'department'],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search

  return (
    <>
      <LeadsHeader count={query.data?.length} scope={scope} />
      <PageBody>
        <DataTable
          table={table}
          loading={query.isPending || lookups.isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => navigate(leadPath(row.id))}
          toolbar={
            <>
              <SearchInput
                aria-label="Search leads"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search company, contact, email…"
                className="w-full sm:w-64"
              />
              <Facets table={table} data={data} lookups={lookups} catalog={catalog} depts={depts} />
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
              <div className="ms-auto">
                <ColumnPicker table={table} />
              </div>
            </>
          }
          empty={
            <EmptyState
              title={data.length === 0 ? 'No leads yet' : 'No leads match'}
              body={data.length === 0 ? 'Leads you own or can see will show up here.' : 'Try another search or clear the filters.'}
            />
          }
        />
      </PageBody>
    </>
  )
}

/* ---------------- Filters ---------------- */

/**
 * Facets list the active lookup items in their configured order, plus any value only found on
 * existing records (e.g. a since-deactivated source) so those leads stay filterable.
 */
function withUsed<T extends { key: string }>(listed: T[], used: string[]): string[] {
  return [...new Set([...listed.map((i) => i.key), ...used.filter(Boolean)])]
}

type Catalog = ReturnType<typeof useCatalog>

/** Facet/filter value of the owner's department: a department id, or one of these markers. */
const NO_DEPARTMENT = '__none'
const OTHER_DEPARTMENT = '__other'

interface OwnerDepartments {
  /** Department key of a lead's owner (membership = the owner's `User.departmentId`). */
  keyOf: (ownerId: string) => string
  label: (key: string) => string
  /** Visible departments in tree order (parents before children). */
  order: string[]
  active: (key: string) => boolean
}

/**
 * Owner → department, from the users list and the departments the viewer may see. A department
 * outside the viewer's Departments scope can't be named, so those owners group as "Other".
 */
function useOwnerDepartments(): OwnerDepartments {
  const users = useUsersQuery()
  const departments = useDepartmentsQuery(true)
  return useMemo(() => {
    const byId = new Map((departments.data ?? []).map((d) => [d.id, d]))
    const deptOfUser = new Map((users.data ?? []).map((u) => [u.id, u.departmentId]))
    const keyOf = (ownerId: string) => {
      const d = deptOfUser.get(ownerId)
      if (!d) return NO_DEPARTMENT
      return byId.has(d) ? d : OTHER_DEPARTMENT
    }
    const label = (key: string) =>
      key === NO_DEPARTMENT ? 'No department' : (byId.get(key)?.name ?? 'Other departments')
    const order: string[] = []
    walk(buildTree(departments.data ?? [], (a, b) => a.name.localeCompare(b.name)), (t) => order.push(t.node.id))
    return { keyOf, label, order, active: (key: string) => byId.get(key)?.active !== false }
  }, [users.data, departments.data])
}

/** Facet/filter value of the recommended service: a catalog id, or one of these markers. */
const UNMATCHED = '__unmatched'
const NO_SERVICE = '__none'
const recommendedKey = (l: LeadRow) => l.recommendedServiceId ?? (l.recommendedServiceText ? UNMATCHED : NO_SERVICE)

function Facets({
  table,
  data,
  lookups,
  catalog,
  depts,
}: {
  table: Table<LeadRow>
  data: LeadRow[]
  lookups: LookupsApi
  catalog: Catalog
  depts: OwnerDepartments
}) {
  const count = (fn: (l: LeadRow) => boolean) => data.filter(fn).length
  const facet = (id: string, title: string, options: FacetOption[]) => {
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
  const owners = [...new Set(data.map((l) => l.ownerName))].sort()
  const closed = lookups.closedStatusKeys
  const usedDepts = new Set(data.map((l) => depts.keyOf(l.ownerId)))
  const deptKeys = [...depts.order, OTHER_DEPARTMENT, NO_DEPARTMENT].filter((k) => usedDepts.has(k))
  const statuses = withUsed(lookups.statuses, data.map((l) => l.status))
  const industries = withUsed(lookups.industries, data.map((l) => l.industry)).filter((i) => data.some((l) => l.industry === i))
  const sources = withUsed(lookups.sources, data.map((l) => l.sourceType))
  // Recommended service: services used on the leads (catalog order by category, then name).
  const recIds = [...new Set(data.map((l) => l.recommendedServiceId).filter((x): x is string => !!x))].sort(
    (a, b) => catalog.nameOf(a).localeCompare(catalog.nameOf(b)),
  )

  return (
    <>
      {facet(
        'status',
        'Status',
        statuses.map((s) => ({
          value: s,
          label: lookups.statusLabel(s),
          icon: <span className={`size-2 rounded-full ${DOT[lookups.status(s).tone]}`} aria-hidden />,
          count: count((l) => l.status === s),
        })),
      )}
      {facet(
        'ownerName',
        'Owner',
        owners.map((o) => ({ value: o, label: o, icon: <Avatar name={o} size="xs" />, count: count((l) => l.ownerName === o) })),
      )}
      {deptKeys.length > 0 &&
        facet(
          'department',
          'Department',
          deptKeys.map((k) => ({
            value: k,
            label: depts.active(k) ? depts.label(k) : `${depts.label(k)} (inactive)`,
            icon: <Network className="size-3.5 text-muted" aria-hidden />,
            count: count((l) => depts.keyOf(l.ownerId) === k),
          })),
        )}
      {facet(
        'industry',
        'Industry',
        industries.map((i) => ({ value: i, label: lookups.industryLabel(i), count: count((l) => l.industry === i) })),
      )}
      {facet(
        'sourceType',
        'Source',
        sources.map((s) => ({ value: s, label: lookups.sourceLabel(s), count: count((l) => l.sourceType === s) })),
      )}
      {facet('recommendedService', 'Service', [
        ...recIds.map((sid) => ({
          value: sid,
          label: catalog.nameOf(sid),
          icon: <CategoryIcon category={catalog.byId(sid)?.category} className="size-4 [&_svg]:size-2.5" />,
          count: count((l) => l.recommendedServiceId === sid),
        })),
        { value: UNMATCHED, label: 'Unmatched text', count: count((l) => recommendedKey(l) === UNMATCHED) },
        { value: NO_SERVICE, label: 'No recommendation', count: count((l) => recommendedKey(l) === NO_SERVICE) },
      ])}
      {facet('nextFollowUpDate', 'Follow-up', [
        { value: 'overdue', label: 'Overdue', count: count((l) => followUpState(l.nextFollowUpDate, l.status, closed) === 'overdue') },
        { value: 'today', label: 'Today', count: count((l) => followUpState(l.nextFollowUpDate, l.status, closed) === 'today') },
        { value: 'upcoming', label: 'Upcoming', count: count((l) => followUpState(l.nextFollowUpDate, l.status, closed) === 'upcoming') },
        { value: 'none', label: 'No follow-up', count: count((l) => followUpState(l.nextFollowUpDate, l.status, closed) === 'none') },
      ])}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<LeadRow> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<LeadRow>()

function buildColumns(lookups: LookupsApi, leadAlerts: Map<string, Alert[]>, catalog: Catalog, depts: OwnerDepartments) {
  const followUpFilter: FilterFn<LeadRow> = (row, _id, values: string[] | undefined) =>
    !values?.length || values.includes(followUpState(row.original.nextFollowUpDate, row.original.status, lookups.closedStatusKeys))
  return [
    col.accessor('company', {
      header: 'Company',
      enableHiding: false,
      meta: { width: 300 },
      cell: ({ row }) => {
        const l = row.original
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={l.company} size="sm" square />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5">
                <span className="truncate font-medium text-ink">{l.company}</span>
                {l.doNotContact && (
                  <span title="Do not contact">
                    <Ban className="size-3.5 shrink-0 text-danger-600" aria-label="Do not contact" />
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted">{l.contactName || l.contactEmail}</p>
              <LeadAlertBadges alerts={leadAlerts.get(l.id)} className="mt-1" />
            </div>
          </div>
        )
      },
    }),
    col.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      sortingFn: (a, b) => lookups.status(a.original.status).order - lookups.status(b.original.status).order,
      cell: ({ getValue }) => <StatusBadge status={getValue()} />,
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          <Avatar name={getValue()} size="xs" />
          {getValue()}
        </span>
      ),
    }),
    col.accessor((l) => depts.keyOf(l.ownerId), {
      id: 'department',
      header: 'Department',
      filterFn: inSet,
      sortingFn: (a, b) => depts.label(depts.keyOf(a.original.ownerId)).localeCompare(depts.label(depts.keyOf(b.original.ownerId))),
      cell: ({ getValue }) => {
        const k = getValue()
        if (k === NO_DEPARTMENT) return <span className="text-subtle">—</span>
        return (
          <span className="whitespace-nowrap text-ink-2">
            {depts.label(k)}
            {!depts.active(k) && <span className="ms-1 text-xs text-subtle">(inactive)</span>}
          </span>
        )
      },
    }),
    col.accessor('industry', {
      header: 'Industry',
      filterFn: inSet,
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Badge>{lookups.industryLabel(row.original.industry)}</Badge>
          {row.original.subIndustry && (
            <span className="truncate text-xs text-muted">{lookups.subIndustryLabel(row.original.industry, row.original.subIndustry)}</span>
          )}
        </span>
      ),
    }),
    col.accessor('sourceType', {
      header: 'Source',
      filterFn: inSet,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-ink-2" title={row.original.sourceDetail || undefined}>
          {lookups.sourceLabel(row.original.sourceType)}
        </span>
      ),
    }),
    col.accessor(recommendedKey, {
      id: 'recommendedService',
      header: 'Recommended service',
      filterFn: inSet,
      sortingFn: (a, b) => catalog.nameOf(a.original.recommendedServiceId).localeCompare(catalog.nameOf(b.original.recommendedServiceId)),
      cell: ({ row }) => {
        const l = row.original
        if (l.recommendedServiceId) {
          const s = catalog.byId(l.recommendedServiceId)
          return (
            <span className="flex max-w-[16rem] items-center gap-1.5 text-ink-2">
              <CategoryIcon category={s?.category} />
              <span className="truncate">{catalog.nameOf(l.recommendedServiceId)}</span>
              {s && !s.active && <span className="text-xs text-subtle">(inactive)</span>}
            </span>
          )
        }
        return l.recommendedServiceText ? <UnmatchedChip text={l.recommendedServiceText} className="max-w-[16rem]" /> : <span className="text-subtle">—</span>
      },
    }),
    col.accessor('value', {
      header: 'Value',

      meta: { align: 'end' },
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-ink">{getValue() ? fmtMoney(getValue()) : '—'}</span>,
    }),
    col.accessor('nextFollowUpDate', {
      header: 'Next follow-up',
      filterFn: followUpFilter,
      sortingFn: 'datetime',
      sortUndefined: 'last',
      cell: ({ row }) => <FollowUpLabel date={row.original.nextFollowUpDate} status={row.original.status} />,
    }),
    col.accessor('createdAt', {
      header: 'Added',
      cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span>,
    }),
  ]
}

/** Searches the fields an agent would type: company, contact, email, industry, owner, mobile. */
const leadSearch: FilterFn<LeadRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const l = row.original
  return [l.company, l.contactName, l.contactEmail, l.industry, l.subIndustry, l.ownerName, l.mobile]
    .join(' ')
    .toLowerCase()
    .includes(q)
}
