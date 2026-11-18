import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlarmClock, Building2, CalendarDays, FolderKanban, Layers, Trophy } from 'lucide-react'
import { customerPath, leadPath, PATHS, servicePath } from '@/app/paths'
import { useProjectQuery } from '@/modules/tasks/hooks/useTasks'
import { DatesButton, ManagerControl, StatusControl } from '@/modules/tasks/projects/ProjectControls'
import { fmtHours, ProgressBar, type ProjectDetail } from '@/modules/tasks/projects/projectUi'
import { ProjectTasksTab } from '@/modules/tasks/projects/ProjectTasksTab'
import { ProjectTimeline } from '@/modules/tasks/projects/ProjectTimeline'
import { ProjectHours } from '@/modules/tasks/projects/ProjectHours'
import { ProjectActivity, ProjectFiles } from '@/modules/tasks/projects/ProjectFilesActivity'
import { ApiError } from '@/shared/lib/apiError'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { PageBody } from '@/shared/components/layout/PageHeader'

type Tab = 'tasks' | 'timeline' | 'hours' | 'files' | 'activity'
const TABS: Tab[] = ['tasks', 'timeline', 'hours', 'files', 'activity']

/** Task Management › a project: header, then Tasks, Timeline, Hours, Files and Activity. */
export default function ProjectDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const query = useProjectQuery(id)
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'tasks'

  function goTo(next: Tab) {
    const p = new URLSearchParams(params)
    if (next === 'tasks') p.delete('tab')
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
            icon={<FolderKanban aria-hidden />}
            title={query.error.message}
            body="Check the link, or find the project in the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.projects)}>
                Back to projects
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

  const p = query.data as ProjectDetail
  const files = p.tasks.reduce((s, t) => s + t.attachments.length, 0)

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-muted">
            <Link to={PATHS.projects} className="hover:text-ink">
              Projects
            </Link>
            <span className="text-subtle">/</span>
            <span className="truncate text-ink-2">{p.name}</span>
          </nav>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-muted [&_svg]:size-5">
              <FolderKanban aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 text-xl font-semibold tracking-[-0.01em] break-words">{p.name}</h1>
                <StatusControl project={p} />
                {p.leadId && (
                  <Link to={leadPath(p.leadId)} className="rounded-md focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none" title="Open the won lead">
                    <Badge tone="green" icon={<Trophy />} className="hover:brightness-95">
                      From Won deal
                    </Badge>
                  </Link>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-ink-2">
                <Link to={customerPath(p.customerId)} className="inline-flex min-w-0 items-center gap-1.5 hover:text-ink hover:underline">
                  <Building2 className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{p.customerName}</span>
                </Link>
                <Link to={servicePath(p.serviceId)} className="inline-flex min-w-0 items-center gap-1.5 hover:text-ink hover:underline">
                  <Layers className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{p.serviceName}</span>
                </Link>
                <ManagerControl project={p} />
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5 text-muted" aria-hidden />
                  <span className="num">
                    {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
                  </span>
                  <DatesButton project={p} />
                </span>
                <span className="font-mono text-xs text-muted">{p.id}</span>
              </div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Summary label="Progress" value={`${p.progress}%`} hint={`${p.doneCount} of ${p.taskCount} tasks done`}>
              <ProgressBar value={p.progress} showLabel={false} />
            </Summary>
            <Summary
              label="Hours"
              value={`${fmtHours(p.loggedHours)} / ${fmtHours(p.estimatedHours)}`}
              hint={p.estimatedHours ? `${Math.round((p.loggedHours / p.estimatedHours) * 100)}% of the estimate logged` : 'No estimate set'}
              alert={p.estimatedHours > 0 && p.loggedHours > p.estimatedHours}
            >
              <ProgressBar value={p.estimatedHours ? (p.loggedHours / p.estimatedHours) * 100 : 0} showLabel={false} />
            </Summary>
            <Summary
              label="Overdue tasks"
              value={String(p.overdueCount)}
              hint={p.overdueCount ? 'Past their due date and not done' : 'Everything on schedule'}
              alert={p.overdueCount > 0}
              icon={<AlarmClock />}
            />
          </dl>

          <Tabs<Tab>
            label="Project sections"
            value={tab}
            onChange={goTo}
            className="mt-5 overflow-x-auto border-b-0"
            items={[
              { id: 'tasks', label: 'Tasks', count: p.taskCount },
              { id: 'timeline', label: 'Timeline' },
              { id: 'hours', label: 'Hours' },
              { id: 'files', label: 'Files', count: files },
              { id: 'activity', label: 'Activity' },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'tasks' && <ProjectTasksTab project={p} />}
          {tab === 'timeline' && <ProjectTimeline project={p} />}
          {tab === 'hours' && <ProjectHours project={p} />}
          {tab === 'files' && <ProjectFiles project={p} />}
          {tab === 'activity' && <ProjectActivity project={p} />}
        </div>
      </PageBody>
    </div>
  )
}

function Summary({
  label,
  value,
  hint,
  alert,
  icon,
  children,
}: {
  label: string
  value: string
  hint: string
  alert?: boolean
  icon?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-line bg-sunken/40 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted [&_svg]:size-3.5">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 space-y-1.5">
        <p className={cn('num text-lg leading-tight font-semibold', alert ? 'text-danger-600' : 'text-ink')}>{value}</p>
        {children}
        <p className="truncate text-xs text-muted">{hint}</p>
      </dd>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] space-y-4 px-4 py-6 sm:px-6 lg:px-10">
          <Skeleton className="h-3 w-24" />
          <div className="flex gap-4">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-72 max-w-full" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
      <PageBody>
        <Skeleton className="h-64 rounded-card" />
      </PageBody>
    </div>
  )
}
