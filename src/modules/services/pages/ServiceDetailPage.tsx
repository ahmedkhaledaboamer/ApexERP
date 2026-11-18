import { useCallback, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Building2,
  CalendarClock,
  CircleDollarSign,
  Clock,
  FileText,
  Hash,
  LayoutTemplate,
  Layers,
  Package,
  Pencil,
  Power,
  PowerOff,
  ShieldOff,
  Tag,
  UserPlus,
} from 'lucide-react'
import { customerPath, leadPath, PATHS, quotationPath } from '@/app/paths'
import { templateTotals, type ServiceDetail } from '@/modules/services/types'
import { useServiceQuery } from '@/modules/services/hooks/useServices'
import { QUOTATION_STATUS_TONE } from '@/modules/quotations/components/QuotationStatusBadge'
import { useLookups } from '@/shared/hooks/useLookups'
import { ApiError } from '@/shared/lib/apiError'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader, Property, PropertyList } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Can } from '@/shared/components/permissions/Can'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { ActiveBadge, CategoryIcon, deliveryText, Price, PricingBadge, useServicesAccess } from '@/modules/services/components/ServiceBits'
import { ServiceDrawer } from '@/modules/services/components/ServiceDrawer'
import { TemplateEditor } from '@/modules/services/components/TemplateEditor'
import { useServiceActivation } from '@/modules/services/components/useServiceActivation'

type Tab = 'overview' | 'template'

/** Services > a service: details, usage across sales, packages and the delivery template. */
export default function ServiceDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const lookups = useLookups()
  const { canEdit } = useServicesAccess()
  const query = useServiceQuery(id)
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'template' ? 'template' : 'overview'
  const [editing, setEditing] = useState(false)
  const [templateDirty, setTemplateDirty] = useState(false)
  const activation = useServiceActivation()
  const onDirtyChange = useCallback((d: boolean) => setTemplateDirty(d), [])

  function goTo(next: Tab) {
    const p = new URLSearchParams(params)
    if (next === 'overview') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
  }

  if (query.isPending) return <DetailSkeleton />
  if (query.isError) {
    const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)
    return (
      <PageBody>
        {notFound ? (
          <EmptyState
            title={query.error.message}
            body="Check the link, or find the service in the catalog."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.services)}>
                Back to the catalog
              </Button>
            }
          />
        ) : (
          <Card>
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          </Card>
        )}
      </PageBody>
    )
  }

  const s = query.data
  const totals = templateTotals(s.template.tasks)

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.services} className="hover:text-ink">
              Service catalog
            </Link>
            <span className="text-subtle">/</span>
            <span className="truncate text-ink-2">{s.name}</span>
          </nav>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <CategoryIcon category={s.category} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.01em]">{s.name}</h1>
                <ActiveBadge active={s.active} />
                {!canEdit && (
                  <Badge tone="amber" icon={<ShieldOff />}>
                    View only
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem] text-muted">
                <Badge tone="neutral" icon={<Tag />}>
                  {lookups.serviceCategoryLabel(s.category)}
                </Badge>
                <PricingBadge type={s.pricingType} />
                <Price value={s.price} currency={s.currency} type={s.pricingType} className="font-semibold" />
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden />
                  {deliveryText(s.deliveryDays)}
                </span>
                <span className="font-mono text-xs">{s.id}</span>
              </div>
            </div>
            <Can module="services" action="edit">
              <div className="flex flex-wrap items-center gap-2">
                <Button write variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </Button>
                <Button write
                  variant="secondary"
                  size="sm"
                  loading={activation.pendingId === s.id}
                  onClick={() => activation.setActive(s, !s.active)}
                >
                  {s.active ? <PowerOff /> : <Power />}
                  {s.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            </Can>
          </div>

          <Tabs<Tab>
            label="Service sections"
            value={tab}
            onChange={goTo}
            className="mt-5 overflow-x-auto border-b-0"
            items={[
              { id: 'overview', label: 'Overview' },
              {
                id: 'template',
                label: 'Project template',
                count: s.templateTasks,
                icon: templateDirty ? <span aria-label="unsaved" className="size-1.5 rounded-full bg-warning-500" /> : undefined,
              },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        {tab === 'overview' && (
          <div role="tabpanel" id="tab-panel-overview" aria-labelledby="tab-overview">
            <Overview s={s} totals={totals} onTemplate={() => goTo('template')} />
          </div>
        )}
        {/* Kept mounted so unsaved template edits survive a tab switch. */}
        <div role="tabpanel" id="tab-panel-template" aria-labelledby="tab-template" hidden={tab !== 'template'}>
          <TemplateEditor serviceId={s.id} serviceName={s.name} canEdit={canEdit} onDirtyChange={onDirtyChange} />
        </div>
      </PageBody>

      {canEdit && <ServiceDrawer open={editing} onClose={() => setEditing(false)} service={s} />}
      {canEdit && activation.modal}
    </div>
  )
}

/* ---------------- Overview ---------------- */

function Overview({ s, totals, onTemplate }: { s: ServiceDetail; totals: { hours: number; days: number }; onTemplate: () => void }) {
  const lookups = useLookups()
  return (
    <div className="space-y-6">
      <section aria-label="Usage" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Leads recommending it"
          icon={<UserPlus />}
          value={s.usage.leadsRecommending}
          hint={s.usage.leadsInterested ? `${s.usage.leadsInterested} leads interested` : 'No other lead interest yet'}
        />
        <StatCard label="Quotations" icon={<FileText />} value={s.usage.quotations} hint="containing this service" />
        <StatCard label="Customers" icon={<Building2 />} value={s.usage.customers} hint="bought it (live contracts)" />
        <StatCard label="Packages" icon={<Package />} value={s.packageCount} hint={s.packageCount ? 'bundles include it' : 'Not in any package'} to={PATHS.servicePackages} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="About this service" icon={<Layers />} />
            <CardBody className="space-y-4">
              <p className="text-[0.8125rem] leading-relaxed whitespace-pre-line text-ink-2">
                {s.description || <span className="text-muted">No description yet.</span>}
              </p>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Suitable industries</p>
                {s.industries.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {s.industries.map((k) => (
                      <Badge key={k} variant="outline">
                        {lookups.industryLabel(k)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-[0.8125rem] text-muted">Suits any industry.</p>
                )}
              </div>
            </CardBody>
          </Card>

          <LinkList
            title="Leads recommending it"
            icon={<UserPlus />}
            count={s.usage.leadsRecommending}
            empty="No lead has this as its recommended service."
            items={s.recommendingLeads.map((l) => {
              const st = lookups.status(l.status)
              return {
                id: l.id,
                to: leadPath(l.id),
                title: l.company,
                sub: l.ownerName,
                avatar: l.company,
                aside: (
                  <Badge tone={st.tone} variant="dot">
                    {st.label}
                  </Badge>
                ),
              }
            })}
          />

          <LinkList
            title="Recent quotations"
            icon={<FileText />}
            count={s.usage.quotations}
            empty="No quotation includes this service yet."
            items={s.recentQuotations.map((q) => ({
              id: q.id,
              to: quotationPath(q.id),
              title: (
                <>
                  <span className="font-mono text-xs text-muted">{q.number}</span> {q.company}
                </>
              ),
              sub: fmtDate(q.createdAt),
              aside: (
                <span className="flex items-center gap-2">
                  <span className="num text-[0.8125rem] text-ink">{fmtMoney(q.total)}</span>
                  <Badge tone={(QUOTATION_STATUS_TONE as Record<string, Tone>)[q.status] ?? 'neutral'} variant="dot">
                    {q.status}
                  </Badge>
                </span>
              ),
            }))}
          />
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="pt-0">
              <PropertyList>
                <Property label="Category" icon={<Tag />}>
                  {lookups.serviceCategoryLabel(s.category)}
                </Property>
                <Property label="Pricing" icon={<CircleDollarSign />}>
                  <span className="flex flex-wrap items-center gap-2">
                    <Price value={s.price} currency={s.currency} type={s.pricingType} />
                  </span>
                </Property>
                <Property label="Delivery time" icon={<Clock />}>
                  {deliveryText(s.deliveryDays)}
                </Property>
                <Property label="Status" icon={<Power />}>
                  <ActiveBadge active={s.active} />
                </Property>
                <Property label="Updated" icon={<CalendarClock />}>
                  {fmtDate(s.updatedAt)}
                </Property>
                <Property label="ID" icon={<Hash />}>
                  <span className="font-mono text-xs">{s.id}</span>
                </Property>
              </PropertyList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Project template"
              icon={<LayoutTemplate />}
              action={
                <Button variant="ghost" size="xs" onClick={onTemplate}>
                  {s.template.tasks.length ? 'Open' : 'Set up'}
                </Button>
              }
            />
            <CardBody className="pt-0">
              {s.template.tasks.length ? (
                <>
                  <p className="num text-[0.8125rem] text-ink-2">
                    {s.template.tasks.length} tasks · {totals.hours} h · {totals.days} working days
                  </p>
                  <ol className="mt-2 space-y-1 text-[0.8125rem] text-muted">
                    {s.template.tasks.slice(0, 4).map((t, i) => (
                      <li key={t.id} className="truncate">
                        <span className="num me-1.5 text-subtle">{i + 1}.</span>
                        {t.title}
                      </li>
                    ))}
                    {s.template.tasks.length > 4 && <li className="text-xs">+{s.template.tasks.length - 4} more</li>}
                  </ol>
                </>
              ) : (
                <p className="text-[0.8125rem] text-muted">No delivery tasks yet. Won deals can’t create a project for this service until it has a template.</p>
              )}
            </CardBody>
          </Card>

          <LinkList
            title="Customers who bought it"
            icon={<Building2 />}
            count={s.customers.length}
            empty="No customer has a contract with this service."
            items={s.customers.map((c) => ({ id: c.id, to: customerPath(c.id), title: c.name, avatar: c.name }))}
          />

          <LinkList
            title="Packages"
            icon={<Package />}
            count={s.packages.length}
            empty="Not part of any package."
            items={s.packages.map((p) => ({
              id: p.id,
              to: `${PATHS.servicePackages}#${encodeURIComponent(p.id)}`,
              title: p.name,
              aside: <ActiveBadge active={p.active} />,
            }))}
          />
        </aside>
      </div>
    </div>
  )
}

interface LinkItem {
  id: string
  to: string
  title: ReactNode
  sub?: ReactNode
  avatar?: string
  aside?: ReactNode
}

function LinkList({ title, icon, count, items, empty }: { title: string; icon: ReactNode; count: number; items: LinkItem[]; empty: string }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <span className="num rounded bg-sunken px-1 text-[0.6875rem] font-normal text-muted">{count}</span>
          </span>
        }
        icon={icon}
        description={count > items.length ? `Showing the ${items.length} most recent` : undefined}
      />
      {items.length === 0 ? (
        <p className="px-5 pb-5 text-[0.8125rem] text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((it) => (
            <li key={it.id}>
              <Link to={it.to} className="flex min-w-0 items-center gap-3 px-5 py-2.5 transition-colors hover:bg-hover/60">
                {it.avatar && <Avatar name={it.avatar} size="xs" square />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium text-ink">{it.title}</span>
                  {it.sub && <span className="block truncate text-xs text-muted">{it.sub}</span>}
                </span>
                {it.aside && <span className="shrink-0">{it.aside}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading service">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-6 sm:px-6 lg:px-10">
          <Skeleton className="h-3 w-40" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-64 max-w-full" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
        </div>
      </div>
      <PageBody className="space-y-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[7.75rem] rounded-card" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </PageBody>
    </div>
  )
}
