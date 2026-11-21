import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { Laptop, Plus } from 'lucide-react'
import type { AssetRow } from '@/modules/hr/peopleTypes'
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_STATUSES, ASSET_STATUS_LABEL } from '@/modules/hr/peopleTypes'
import { useAssetsQuery, useHrScope } from '@/modules/hr/hooks/useHrPeople'
import { AssetStatusBadge, HrError, Money } from '@/modules/hr/components/PeopleBits'
import { AssetActions, AssetDetailDrawer, AssetDrawer, AssignModal, LostModal, ReturnModal } from '@/modules/hr/components/AssetComponents'
import { fmtDate } from '@/shared/lib/utils'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Button } from '@/shared/components/ui/Button'
import { SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

type Action = { kind: 'assign' | 'return' | 'lost' | 'edit'; asset: AssetRow } | null

/** `/hr/assets`: the company asset register (HR full manages; team / own see what their people hold). */
export default function AssetsPage() {
  const { canManage } = useHrScope()
  const query = useAssetsQuery()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [statuses, setStatuses] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState<Action>(null)
  const viewing = params.get('asset')
  const all = useMemo(() => query.data ?? [], [query.data])
  const data = useMemo(() => all.filter((a) => !statuses.length || statuses.includes(a.status)).filter((a) => !categories.length || categories.includes(a.category)), [all, statuses, categories])
  const columns = useMemo(() => buildColumns(canManage, setAction), [canManage])
  const table = useDataTable({ id: 'hr-assets', data, columns, globalFilter: search, globalFilterFn: assetSearch, defaultHidden: ['serial', 'warrantyEnd'], getRowId: (r) => r.id })

  return (
    <>
      <PageHeader
        icon={<IconTile><Laptop /></IconTile>}
        title="Company Assets"
        description={query.data ? `${all.length} assets · ${all.filter((a) => a.status === 'assigned').length} assigned · ${all.filter((a) => a.status === 'in_stock').length} in stock` : 'Asset register and hand-overs.'}
        actions={canManage && <Button write onClick={() => setCreating(true)}><Plus />New asset</Button>}
      />
      <PageBody>
        {query.error ? (
          <HrError error={query.error} onRetry={() => query.refetch()} />
        ) : (
          <DataTable
            table={table}
            loading={query.isPending}
            onRowClick={(row) => setParams({ asset: row.id })}
            toolbar={
              <>
                <SearchInput aria-label="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag, name, serial, holder…" className="w-full sm:w-64" />
                <FacetFilter title="Status" options={ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABEL[s], count: all.filter((a) => a.status === s).length }))} selected={statuses} onChange={setStatuses} />
                <FacetFilter title="Category" options={ASSET_CATEGORIES.map((c) => ({ value: c, label: ASSET_CATEGORY_LABEL[c], count: all.filter((a) => a.category === c).length }))} selected={categories} onChange={setCategories} />
                <div className="ms-auto"><ColumnPicker table={table} /></div>
              </>
            }
            empty={<EmptyState icon={<Laptop />} title={all.length ? 'No assets match' : 'No assets yet'} body={all.length ? 'Try another filter.' : 'Register the first company asset.'} />}
          />
        )}
      </PageBody>
      {canManage && <AssetDrawer open={creating || action?.kind === 'edit'} onClose={() => { setCreating(false); setAction(null) }} asset={action?.kind === 'edit' ? action.asset : null} />}
      {action?.kind === 'assign' && <AssignModal asset={action.asset} onClose={() => setAction(null)} />}
      {action?.kind === 'return' && <ReturnModal asset={action.asset} onClose={() => setAction(null)} />}
      {action?.kind === 'lost' && <LostModal asset={action.asset} onClose={() => setAction(null)} />}
      <AssetDetailDrawer id={viewing} onClose={() => setParams({})} />
    </>
  )
}

const col = createColumnHelper<AssetRow>()

function buildColumns(canManage: boolean, act: (a: Action) => void) {
  const cols = [
    col.accessor('tag', { header: 'Tag', enableHiding: false, cell: ({ getValue }) => <span className="num font-medium text-ink">{getValue()}</span> }),
    col.accessor('name', {
      header: 'Asset',
      cell: ({ row }) => (
        <span className="min-w-0">
          <span className="block truncate text-ink">{row.original.name}</span>
          <span className="block truncate text-xs text-muted">{[row.original.brand, row.original.model].filter(Boolean).join(' ')}</span>
        </span>
      ),
    }),
    col.accessor('category', { header: 'Category', cell: ({ getValue }) => ASSET_CATEGORY_LABEL[getValue()] }),
    col.accessor('status', { header: 'Status', cell: ({ getValue }) => <AssetStatusBadge status={getValue()} /> }),
    col.accessor((r) => r.assignedToName ?? '', { id: 'holder', header: 'Held by', cell: ({ row }) => row.original.assignedToName ?? <span className="text-muted">—</span> }),
    col.accessor('serial', { header: 'Serial' }),
    col.accessor((r) => r.warrantyEnd ?? '', { id: 'warrantyEnd', header: 'Warranty end', cell: ({ row }) => <span className="num">{fmtDate(row.original.warrantyEnd) || '—'}</span> }),
    col.accessor((r) => r.cost ?? -1, { id: 'cost', header: 'Cost', meta: { align: 'end' }, cell: ({ row }) => <Money value={row.original.cost} currency={row.original.currency} /> }),
  ]
  if (!canManage) return cols
  return [
    ...cols,
    col.display({
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: ({ row }) => (
        <span onClick={(e) => e.stopPropagation()}>
          <AssetActions
            asset={row.original}
            onAssign={() => act({ kind: 'assign', asset: row.original })}
            onReturn={() => act({ kind: 'return', asset: row.original })}
            onLost={() => act({ kind: 'lost', asset: row.original })}
            onEdit={() => act({ kind: 'edit', asset: row.original })}
          />
        </span>
      ),
    }),
  ]
}

const assetSearch: FilterFn<AssetRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const a = row.original
  return [a.tag, a.name, a.brand, a.model, a.serial, a.assignedToName ?? ''].join(' ').toLowerCase().includes(q)
}
