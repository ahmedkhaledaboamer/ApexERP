import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BadgePercent, Package, PackagePlus, Pencil, Plus, ShieldOff } from 'lucide-react'
import { servicePath } from '@/app/paths'
import type { PackageRow } from '@/modules/services/types'
import { usePackagesQuery, useSetPackageActive } from '@/modules/services/hooks/useServices'
import { cn, fmtCompactMoney, fmtMoney } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { Can } from '@/shared/components/permissions/Can'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ActiveBadge, CategoryIcon, useServicesAccess } from '@/modules/services/components/ServiceBits'
import { PackageDrawer } from '@/modules/services/components/PackageDrawer'
import { useReadOnly } from '@/shared/lib/readOnly'

type Show = 'active' | 'inactive' | 'all'
type DrawerState = { pkg: PackageRow | null } | null

/** Services > Packages: bundles of services sold at a package price. */
export default function PackagesPage() {
  const query = usePackagesQuery()
  const { canEdit } = useServicesAccess()
  const [show, setShow] = useState<Show>('active')
  const [q, setQ] = useState('')
  const [drawer, setDrawer] = useState<DrawerState>(null)
  const { hash } = useLocation()
  const target = hash ? decodeURIComponent(hash.slice(1)) : ''

  const all = useMemo(() => query.data ?? [], [query.data])
  // A link to a specific package (#P-1) shows it even when it's inactive.
  const targetPkg = all.find((p) => p.id === target)
  const effectiveShow: Show = targetPkg && !targetPkg.active && show === 'active' ? 'all' : show
  const term = q.trim().toLowerCase()
  const list = all
    .filter((p) => (effectiveShow === 'all' ? true : effectiveShow === 'active' ? p.active : !p.active))
    .filter((p) => !term || [p.name, p.description, ...p.lines.map((l) => l.name)].join(' ').toLowerCase().includes(term))

  useEffect(() => {
    if (!target || !query.data) return
    document.getElementById(`package-${target}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [target, query.data])

  const active = all.filter((p) => p.active)
  const avgSaving = active.length ? active.reduce((s, p) => s + p.savingPct, 0) / active.length : 0

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Package />
          </IconTile>
        }
        title="Packages"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Bundles of services sold at a package price.</span>
            {!canEdit && (
              <Badge tone="amber" icon={<ShieldOff />}>
                View only
              </Badge>
            )}
          </span>
        }
        actions={
          <Can module="services" action="edit">
            <Button write size="sm" onClick={() => setDrawer({ pkg: null })}>
              <Plus />
              New package
            </Button>
          </Can>
        }
      />
      <PageBody className="space-y-5">
        {query.isPending ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-[7.75rem] rounded-card" />
            ))}
          </div>
        ) : (
          query.data && (
            <section aria-label="Package figures" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <StatCard label="Active packages" icon={<Package />} value={active.length} hint={`${all.length - active.length} inactive`} />
              <StatCard label="Average saving" icon={<BadgePercent />} value={`${avgSaving.toFixed(0)}%`} hint="vs buying the services separately" />
              <StatCard
                label="Package value"
                icon={<PackagePlus />}
                value={fmtCompactMoney(active.reduce((s, p) => s + p.packagePrice, 0))}
                hint="sum of active package prices"
              />
            </section>
          )
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput aria-label="Search packages" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search packages or services…" className="w-full sm:w-64" />
          <Segmented<Show>
            label="Show"
            size="sm"
            value={effectiveShow}
            onChange={setShow}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>

        {query.isPending ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-72 rounded-card" />
            ))}
          </div>
        ) : query.isError ? (
          <Card>
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          </Card>
        ) : list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Package />}
              title={all.length === 0 ? 'No packages yet' : 'No packages match'}
              body={all.length === 0 ? 'Bundle two or more services and offer them at a package price.' : 'Try another search or show all packages.'}
              action={
                all.length === 0 ? (
                  <Can module="services" action="edit">
                    <Button write size="sm" onClick={() => setDrawer({ pkg: null })}>
                      <Plus />
                      New package
                    </Button>
                  </Can>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQ('')
                      setShow('all')
                    }}
                  >
                    Show all
                  </Button>
                )
              }
            />
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((p) => (
              <li key={p.id} id={`package-${p.id}`}>
                <PackageCard pkg={p} highlighted={p.id === target} canEdit={canEdit} onEdit={() => setDrawer({ pkg: p })} />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
      {canEdit && <PackageDrawer open={!!drawer} onClose={() => setDrawer(null)} pkg={drawer?.pkg} />}
    </>
  )
}

function PackageCard({ pkg: p, highlighted, canEdit, onEdit }: { pkg: PackageRow; highlighted: boolean; canEdit: boolean; onEdit: () => void }) {
  const setActive = useSetPackageActive()
  const readOnly = useReadOnly()
  const toast = useToast()
  const inactiveServices = p.lines.filter((l) => !l.active)

  function toggle(active: boolean) {
    setActive.mutate(
      { id: p.id, active },
      {
        onSuccess: () => toast.success(active ? 'Package reactivated' : 'Package deactivated', p.name),
        onError: (e) => toast.error(active ? 'Couldn’t reactivate the package' : 'Couldn’t deactivate the package', e.message),
      },
    )
  }

  return (
    <Card className={cn('flex h-full flex-col', !p.active && 'bg-sunken/40', highlighted && 'ring-2 ring-brand-500')}>
      <div className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={cn('text-[0.9375rem] font-semibold', !p.active && 'text-ink-2')}>{p.name}</h2>
            {!p.active && <ActiveBadge active={false} />}
          </div>
          {p.description && <p className="mt-1 line-clamp-2 text-[0.8125rem] text-muted">{p.description}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${p.name}`} onClick={onEdit}>
              <Pencil />
            </Button>
            <Switch checked={p.active} disabled={readOnly || setActive.isPending} onChange={toggle} label={`${p.name} active`} />
          </div>
        )}
      </div>

      <ul className="mt-3 flex-1 divide-y divide-line border-y border-line" aria-label={`Services in ${p.name}`}>
        {p.lines.map((l) => (
          <li key={l.serviceId}>
            <Link to={servicePath(l.serviceId)} className="flex min-w-0 items-center gap-3 px-5 py-2 transition-colors hover:bg-hover/60">
              <CategoryIcon category={l.category} size="sm" />
              <span className={cn('min-w-0 flex-1 truncate text-[0.8125rem]', l.active ? 'text-ink' : 'text-muted line-through')}>{l.name}</span>
              {!l.active && <Badge tone="amber">Inactive</Badge>}
              {l.quantity > 1 && <span className="num shrink-0 rounded bg-sunken px-1.5 text-xs font-medium text-ink-2">×{l.quantity}</span>}
              <span className="num shrink-0 text-xs text-muted">{fmtMoney(l.price * l.quantity, p.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
        <div>
          <p className="num text-xs text-muted line-through" aria-label={`List price ${fmtMoney(p.listPrice, p.currency)}`}>
            {fmtMoney(p.listPrice, p.currency)}
          </p>
          <p className="num text-xl font-semibold tracking-[-0.01em] text-ink">{fmtMoney(p.packagePrice, p.currency)}</p>
        </div>
        {p.saving > 0 ? (
          <Badge tone="green" icon={<BadgePercent />}>
            Save {fmtMoney(p.saving, p.currency)} · {p.savingPct.toFixed(0)}%
          </Badge>
        ) : p.saving < 0 ? (
          <Badge tone="red">Costs {fmtMoney(-p.saving, p.currency)} more than separately</Badge>
        ) : (
          <Badge>No saving</Badge>
        )}
      </div>
      {!p.active && inactiveServices.length > 0 && canEdit && (
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
          Includes inactive services ({inactiveServices.map((l) => l.name).join(', ')}). Remove them or reactivate them before reactivating the package.
        </p>
      )}
    </Card>
  )
}
