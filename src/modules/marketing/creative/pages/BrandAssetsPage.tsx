import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { AlertTriangle, Grid2x2, Image as ImageIcon, List, Lock, Upload, X } from 'lucide-react'
import { ASSET_KINDS, ASSET_KIND_LABEL, type BrandAsset } from '@/modules/marketing/creative/types'
import { useBrandAssets, useCreativeAccess } from '@/modules/marketing/creative/hooks'
import { AssetKindBadge } from '@/modules/marketing/creative/components/badges'
import { AssetThumb } from '@/modules/marketing/creative/components/AssetPicker'
import { AssetDrawer } from '@/modules/marketing/creative/components/AssetDrawer'
import { UploadAssetModal } from '@/modules/marketing/creative/components/UploadAssetModal'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { formatBytes } from '@/modules/settings/branding'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

type View = 'grid' | 'list'

export default function BrandAssetsPage() {
  const { canView } = useCreativeAccess()
  if (!canView) return <NoMarketingAccess what="Brand assets" />
  return <BrandAssets />
}

function BrandAssets() {
  const { canEdit } = useCreativeAccess()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'list' ? 'list' : 'grid'
  const openId = params.get('asset')
  const query = useBrandAssets()
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<string[]>([])
  const [tag, setTag] = useState<string[]>([])
  const [campaign, setCampaign] = useState<string[]>([])
  const [expiring, setExpiring] = useState(false)
  const [archived, setArchived] = useState(false)
  const [uploading, setUploading] = useState(false)

  const setParam = (u: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(u)) {
          if (v) next.set(k, v)
          else next.delete(k)
        }
        return next
      },
      { replace: true },
    )

  const all = useMemo(() => query.data ?? [], [query.data])
  const items = useMemo(
    () =>
      all.filter((a) => {
        if (!archived && a.status === 'archived') return false
        if (kind.length && !kind.includes(a.kind)) return false
        if (tag.length && !a.tags.some((t) => tag.includes(t))) return false
        if (campaign.length && !campaign.includes(a.campaignId ?? '')) return false
        if (expiring && !a.expiringSoon && !a.expired) return false
        const q = search.trim().toLowerCase()
        return !q || [a.name, a.description, a.tags.join(' ')].join(' ').toLowerCase().includes(q)
      }),
    [all, kind, tag, campaign, expiring, archived, search],
  )
  const tags = [...new Set(all.flatMap((a) => a.tags))].sort()
  const campaigns = [...new Map(all.filter((a) => a.campaignId).map((a) => [a.campaignId!, a.campaignName])).entries()]
  const filtered = !!search || kind.length + tag.length + campaign.length > 0 || expiring
  const open = all.find((a) => a.id === openId) ?? null
  const expiringCount = all.filter((a) => a.status === 'active' && (a.expiringSoon || a.expired)).length

  return (
    <>
      <PageHeader
        title="Brand assets"
        description="Logos, images, videos, templates and fonts in one library, with usage rights and the campaigns they belong to."
        actions={
          canEdit && (
            <Button write onClick={() => setUploading(true)}>
              <Upload />
              Upload asset
            </Button>
          )
        }
      />
      <PageBody className="space-y-4">
        {expiringCount > 0 && (
          <button
            type="button"
            onClick={() => setExpiring(true)}
            className="flex w-full items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-start text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            {expiringCount} {expiringCount === 1 ? 'asset has' : 'assets have'} usage rights ending within 30 days (or already ended). Show them
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Tabs<View>
            label="Asset views"
            variant="pill"
            value={view}
            onChange={(v) => setParam({ view: v === 'grid' ? null : v })}
            items={[
              { id: 'grid', label: 'Grid', icon: <Grid2x2 /> },
              { id: 'list', label: 'List', icon: <List /> },
            ]}
          />
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
          <SearchInput aria-label="Search assets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets…" className="w-full sm:w-56" />
          <FacetFilter title="Kind" options={ASSET_KINDS.map((k) => ({ value: k, label: ASSET_KIND_LABEL[k] }))} selected={kind} onChange={setKind} />
          <FacetFilter title="Tag" options={tags.map((t) => ({ value: t, label: t }))} selected={tag} onChange={setTag} />
          <FacetFilter title="Campaign" options={campaigns.map(([value, label]) => ({ value, label }))} selected={campaign} onChange={setCampaign} />
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <Switch checked={expiring} onChange={setExpiring} label="Expiring soon" />
            Expiring soon
          </label>
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <Switch checked={archived} onChange={setArchived} label="Show archived" />
            Archived
          </label>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setKind([])
                setTag([])
                setCampaign([])
                setExpiring(false)
              }}
            >
              Reset
              <X />
            </Button>
          )}
        </div>
        {query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : query.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48 rounded-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ImageIcon aria-hidden />} title={all.length === 0 ? 'No assets yet' : 'No assets match'} body={all.length === 0 ? 'Upload logos, photos, templates and fonts your team uses.' : 'Try another search or clear the filters.'} />
        ) : view === 'grid' ? (
          <ul aria-label="Assets" className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setParam({ asset: a.id })} className={cn('group w-full overflow-hidden rounded-card border border-line bg-surface text-start shadow-xs transition hover:border-line-strong hover:shadow-soft', a.status === 'archived' && 'opacity-60')}>
                  <div className="aspect-[16/10] bg-sunken/60 p-2">
                    <AssetThumb asset={a} className="size-full border-0 bg-transparent" />
                  </div>
                  <div className="space-y-1 p-3">
                    <p className="flex items-center gap-1.5 truncate text-[0.8125rem] font-medium text-ink">
                      {a.system && <Lock className="size-3.5 shrink-0 text-muted" aria-label="System asset" />}
                      <span className="truncate">{a.name}</span>
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <AssetKindBadge kind={a.kind} />
                      {a.expired ? <Badge tone="red">Rights expired</Badge> : a.expiringSoon ? <Badge tone="amber">Expiring</Badge> : null}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <AssetTable items={items} onOpen={(id) => setParam({ asset: id })} />
        )}
      </PageBody>
      <AssetDrawer asset={open} onClose={() => setParam({ asset: null })} />
      <UploadAssetModal open={uploading} onClose={() => setUploading(false)} onSaved={(a) => setParam({ asset: a.id })} />
    </>
  )
}

const col = createColumnHelper<BrandAsset>()

function AssetTable({ items, onOpen }: { items: BrandAsset[]; onOpen: (id: string) => void }) {
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Asset',
        enableHiding: false,
        meta: { width: 300 },
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <AssetThumb asset={row.original} className="size-9 shrink-0" />
            <span className="truncate font-medium text-ink">{row.original.name}</span>
          </span>
        ),
      }),
      col.accessor('kind', { header: 'Kind', cell: ({ getValue }) => <AssetKindBadge kind={getValue()} /> }),
      col.accessor('sizeBytes', { header: 'Size', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-ink-2">{getValue() ? formatBytes(getValue()) : '—'}</span> }),
      col.accessor((a) => a.tags.join(', '), { id: 'tags', header: 'Tags', cell: ({ getValue }) => <span className="text-ink-2">{getValue() || '—'}</span> }),
      col.accessor('campaignName', { header: 'Campaign', cell: ({ getValue }) => <span className="text-ink-2">{getValue() || '—'}</span> }),
      col.accessor((a) => a.usageRightsExpiresAt ?? '', {
        id: 'rights',
        header: 'Usage rights',
        cell: ({ row }) => (
          <span className={cn('num whitespace-nowrap', row.original.expired ? 'text-danger-600' : row.original.expiringSoon ? 'text-warning-700' : 'text-ink-2')}>
            {row.original.usageRightsExpiresAt ? fmtDate(row.original.usageRightsExpiresAt) : '—'}
          </span>
        ),
      }),
      col.accessor('createdAt', { header: 'Added', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-assets', data: items, columns, defaultSorting: [{ id: 'createdAt', desc: true }], getRowId: (r) => r.id })
  return <DataTable table={table} onRowClick={(row) => onOpen(row.id)} empty={<EmptyState title="No assets match" body="Try another search or clear the filters." />} />
}
