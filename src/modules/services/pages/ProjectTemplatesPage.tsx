import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight, Clock, LayoutTemplate, ListChecks, TriangleAlert } from 'lucide-react'
import { servicePath } from '@/app/paths'
import type { ServiceRow } from '@/modules/services/types'
import { useServicesQuery } from '@/modules/services/hooks/useServices'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Checkbox, SearchInput } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { CategoryIcon, useServicesAccess } from '@/modules/services/components/ServiceBits'

type Show = 'all' | 'with' | 'missing'

const templatePath = (id: string) => `${servicePath(id)}?tab=template`

/** Services > Project templates: which services have delivery tasks set up, with totals. Editing happens on the service page. */
export default function ProjectTemplatesPage() {
  const query = useServicesQuery()
  const lookups = useLookups()
  const { canEdit } = useServicesAccess()
  const [params, setParams] = useSearchParams()
  const raw = params.get('show')
  const show: Show = raw === 'with' || raw === 'missing' ? raw : 'all'
  const includeInactive = params.get('inactive') === '1'
  const q = params.get('q') ?? ''

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const scope = useMemo(() => (query.data ?? []).filter((s) => includeInactive || s.active), [query.data, includeInactive])
  const term = q.trim().toLowerCase()
  const list = scope
    .filter((s) => (show === 'with' ? s.templateTasks > 0 : show === 'missing' ? s.templateTasks === 0 : true))
    .filter((s) => !term || `${s.name} ${lookups.serviceCategoryLabel(s.category)}`.toLowerCase().includes(term))
    .sort((a, b) => Number(a.templateTasks > 0) - Number(b.templateTasks > 0) || a.name.localeCompare(b.name))

  const withTemplate = scope.filter((s) => s.templateTasks > 0)
  const missing = scope.length - withTemplate.length
  const avgHours = withTemplate.length ? withTemplate.reduce((t, s) => t + s.templateHours, 0) / withTemplate.length : 0

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <LayoutTemplate />
          </IconTile>
        }
        title="Project templates"
        description="Ready-made delivery tasks per service. A won deal creates its project from the template."
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
            <section aria-label="Template coverage" className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <StatCard
                label="Services with a template"
                icon={<LayoutTemplate />}
                value={`${withTemplate.length} / ${scope.length}`}
                progress={scope.length ? (withTemplate.length / scope.length) * 100 : 0}
              />
              <StatCard label="Without a template" icon={<TriangleAlert />} value={missing} alert={missing > 0} hint={missing ? 'Won deals can’t create their project' : 'All covered'} />
              <StatCard label="Average effort" icon={<Clock />} value={`${Math.round(avgHours)} h`} hint="per template" />
            </section>
          )
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SearchInput aria-label="Search services" value={q} onChange={(e) => setParam('q', e.target.value || null)} placeholder="Search services…" className="w-full sm:w-64" />
          <Segmented<Show>
            label="Show"
            size="sm"
            value={show}
            onChange={(v) => setParam('show', v === 'all' ? null : v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'with', label: 'With template' },
              { value: 'missing', label: 'Missing' },
            ]}
          />
          <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-2">
            <Checkbox checked={includeInactive} onChange={(e) => setParam('inactive', e.target.checked ? '1' : null)} />
            Include inactive services
          </label>
        </div>

        <Card>
          {query.isPending ? (
            <div aria-busy="true" aria-label="Loading services" className="space-y-3 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : query.isError ? (
            <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<LayoutTemplate />}
              title={show === 'missing' && !term ? 'Every service has a template' : 'No services match'}
              body={show === 'missing' && !term ? 'Won deals can create their project for every service in scope.' : 'Try another search or filter.'}
              action={
                (show !== 'all' || term) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setParams(new URLSearchParams(), { replace: true })}
                  >
                    Show all
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-line" aria-label="Services and their templates">
              {list.map((s) => (
                <TemplateRow key={s.id} s={s} categoryLabel={lookups.serviceCategoryLabel(s.category)} canEdit={canEdit} />
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  )
}

function TemplateRow({ s, categoryLabel, canEdit }: { s: ServiceRow; categoryLabel: string; canEdit: boolean }) {
  const has = s.templateTasks > 0
  return (
    <li>
      <Link to={templatePath(s.id)} className="group flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-hover/60">
        <span className={cn('flex min-w-0 flex-1 basis-60 items-center gap-3', !s.active && 'opacity-60')}>
          <CategoryIcon category={s.category} size="sm" />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate text-[0.8125rem] font-medium text-ink">{s.name}</span>
              {!s.active && <Badge>Inactive</Badge>}
            </span>
            <span className="block truncate text-xs text-muted">{categoryLabel}</span>
          </span>
        </span>
        {has ? (
          <span className="num flex items-center gap-4 text-[0.8125rem] text-ink-2">
            <span className="flex items-center gap-1.5">
              <ListChecks className="size-3.5 text-muted" aria-hidden />
              {s.templateTasks} tasks
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5 text-muted" aria-hidden />
              {s.templateHours} h
            </span>
          </span>
        ) : (
          <Badge tone="amber" variant="dot">
            No template
          </Badge>
        )}
        <span className="ms-auto flex items-center gap-1 text-xs font-medium text-muted group-hover:text-ink">
          {has ? (canEdit ? 'Edit' : 'View') : canEdit ? 'Set up' : 'View'}
          <ChevronRight className="size-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  )
}
