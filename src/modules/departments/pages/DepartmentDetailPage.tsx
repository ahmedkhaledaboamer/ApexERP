import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Crown,
  FolderTree,
  Hash,
  Info,
  ListChecks,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ShieldOff,
  Target,
  Trophy,
  UserCheck,
  Users,
} from 'lucide-react'
import { departmentPath, leadPath, PATHS } from '@/app/paths'
import type { Priority } from '@/shared/types'
import type { DepartmentDetail, DepartmentTask } from '@/modules/departments/types'
import { useDepartmentQuery } from '@/modules/departments/hooks/useDepartments'
import { DepartmentActiveBadge, DepartmentIcon, plural, useDepartmentsAccess } from '@/modules/departments/components/DepartmentBits'
import { DepartmentDrawer } from '@/modules/departments/components/DepartmentDrawer'
import { DepartmentGoalsTab } from '@/modules/departments/components/DepartmentGoalsTab'
import { DepartmentMembersTab } from '@/modules/departments/components/DepartmentMembersTab'
import { useDepartmentActivation } from '@/modules/departments/components/useDepartmentActivation'
import { ApiError } from '@/shared/lib/apiError'
import { PRIORITY_STYLES } from '@/shared/lib/constants'
import { cn, fmtCompactMoney, fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Gauge } from '@/shared/components/ui/Gauge'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Can } from '@/shared/components/permissions/Can'
import { PageBody } from '@/shared/components/layout/PageHeader'

type Tab = 'members' | 'subs' | 'tasks' | 'figures' | 'goals'
const TABS: Tab[] = ['members', 'subs', 'tasks', 'figures', 'goals']

/** Departments > a department: members, sub-departments, tasks, figures and goals. */
export default function DepartmentDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { isFull, scope } = useDepartmentsAccess()
  const query = useDepartmentQuery(id)
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab') as Tab | null
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'members'
  const [drawer, setDrawer] = useState<'edit' | 'sub' | null>(null)
  const activation = useDepartmentActivation()

  function goTo(next: Tab) {
    const p = new URLSearchParams(params)
    if (next === 'members') p.delete('tab')
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
            icon={<ShieldOff />}
            title={query.error.message}
            body="Check the link, or pick the department from the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.departments)}>
                Back to departments
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

  const d = query.data
  // Client gate (matrix) AND the server's flags.
  const canStructure = isFull && d.can.edit
  const head = d.members.find((m) => m.isHead)
  const overdue = d.tasks.filter((t) => t.overdue).length

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted">
            <Link to={PATHS.departments} className="hover:text-ink">
              Departments
            </Link>
            {d.path.map((p, i) => (
              <span key={p.id} className="flex min-w-0 items-center gap-1">
                <span className="text-subtle">/</span>
                {i === d.path.length - 1 ? (
                  <span aria-current="page" className="truncate text-ink-2">
                    {p.name}
                  </span>
                ) : (
                  <Link to={departmentPath(p.id)} className="truncate hover:text-ink">
                    {p.name}
                  </Link>
                )}
              </span>
            ))}
          </nav>

          <div className="mt-3 flex flex-wrap items-start gap-4">
            <DepartmentIcon size="lg" muted={!d.active} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.01em] break-words">{d.name}</h1>
                <DepartmentActiveBadge active={d.active} />
                {scope === 'view' && (
                  <Badge tone="amber" icon={<ShieldOff />}>
                    View only
                  </Badge>
                )}
                {scope === 'team' && d.can.manageMembers && (
                  <Badge tone="blue" icon={<Users />}>
                    Your team
                  </Badge>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8125rem] text-muted">
                {head ? (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={head.name} size="xs" />
                    <span className="text-ink-2">{head.name}</span>
                    <span className="text-subtle">· Head</span>
                  </span>
                ) : (
                  <Badge tone={d.active ? 'amber' : 'neutral'} variant="dot">
                    No head
                  </Badge>
                )}
                <span className="num flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden />
                  {plural(d.memberCount, 'member')}
                </span>
                {d.costCenter && (
                  <span className="flex items-center gap-1" title="Cost center (Accounting, phase 3)">
                    <Hash className="size-3.5" aria-hidden />
                    <span className="font-mono text-xs">{d.costCenter}</span>
                  </span>
                )}
                {d.parentName && (
                  <span className="flex items-center gap-1">
                    <FolderTree className="size-3.5" aria-hidden />
                    Under {d.parentName}
                  </span>
                )}
              </div>
            </div>
            {canStructure && (
              <Can module="departments" action="edit">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setDrawer('edit')}>
                    <Pencil />
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" loading={activation.pendingId === d.id} onClick={() => activation.setActive(d, !d.active)}>
                    {d.active ? <PowerOff /> : <Power />}
                    {d.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </Can>
            )}
          </div>

          <Tabs<Tab>
            label="Department sections"
            value={tab}
            onChange={goTo}
            className="mt-5 overflow-x-auto border-b-0"
            items={[
              { id: 'members', label: 'Members', icon: <Users />, count: d.members.length },
              { id: 'subs', label: 'Sub-departments', icon: <FolderTree />, count: d.children.length },
              {
                id: 'tasks',
                label: 'Tasks',
                icon: overdue ? <AlertTriangle className="text-danger-600" aria-label={`${overdue} overdue`} /> : <ListChecks />,
                count: d.tasks.length,
              },
              { id: 'figures', label: 'Figures', icon: <BarChart3 /> },
              { id: 'goals', label: 'Goals', icon: <Target />, count: d.openGoals },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'members' && (
            <DepartmentMembersTab dept={d} canMove={canStructure && d.can.manageMembers} canManage={d.can.manageMembers && (isFull || scope === 'team')} />
          )}
          {tab === 'subs' && <SubDepartments d={d} canCreate={canStructure && d.active} onNew={() => setDrawer('sub')} />}
          {tab === 'tasks' && <Tasks d={d} />}
          {tab === 'figures' && <Figures d={d} />}
          {tab === 'goals' && <DepartmentGoalsTab dept={d} canEdit={d.can.editGoals && (isFull || scope === 'team')} />}
        </div>
      </PageBody>

      {canStructure && (
        <>
          <DepartmentDrawer open={drawer === 'edit'} onClose={() => setDrawer(null)} department={d} />
          <DepartmentDrawer open={drawer === 'sub'} onClose={() => setDrawer(null)} defaultParentId={d.id} openAfterCreate />
          {activation.modal}
        </>
      )}
    </div>
  )
}

/* ---------------- Sub-departments ---------------- */

function SubDepartments({ d, canCreate, onNew }: { d: DepartmentDetail; canCreate: boolean; onNew: () => void }) {
  const newButton = canCreate && (
    <Can module="departments" action="edit">
      <Button size="sm" variant="secondary" onClick={onNew}>
        <Plus />
        New sub-department
      </Button>
    </Can>
  )
  return (
    <Card>
      <CardHeader icon={<FolderTree />} title="Sub-departments" description={`Directly under ${d.name}`} action={d.children.length > 0 ? newButton : undefined} />
      {d.children.length === 0 ? (
        <EmptyState icon={<FolderTree />} title="No sub-departments" body={`Nothing sits under ${d.name} yet.`} action={newButton || undefined} />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {d.children.map((c) => (
            <li key={c.id}>
              <Link to={departmentPath(c.id)} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-hover/60">
                <DepartmentIcon size="sm" muted={!c.active} />
                <span className={cn('min-w-0 flex-1', !c.active && 'opacity-60')}>
                  <span className="block truncate text-[0.8125rem] font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-xs text-muted">{c.headName ? `Head: ${c.headName}` : 'No head'}</span>
                </span>
                <span className="num shrink-0 text-xs text-muted">{plural(c.memberCount, 'member')}</span>
                {!c.active && <DepartmentActiveBadge active={false} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Tasks ---------------- */

function Tasks({ d }: { d: DepartmentDetail }) {
  const overdue = d.tasks.filter((t) => t.overdue)
  const upcoming = d.tasks.filter((t) => !t.overdue)
  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-[0.8125rem] text-info-700 dark:bg-info-500/10 dark:text-info-500">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Open lead tasks owned by members. Project tasks arrive with the Tasks module.
      </p>
      {d.tasks.length === 0 ? (
        <Card>
          <EmptyState icon={<ListChecks />} title="No open tasks" body="Nobody in this department has an open lead task." />
        </Card>
      ) : (
        <>
          {overdue.length > 0 && <TaskGroup title="Overdue" tone="danger" tasks={overdue} />}
          <TaskGroup title="Upcoming" tasks={upcoming} />
        </>
      )}
    </div>
  )
}

function TaskGroup({ title, tasks, tone }: { title: string; tasks: DepartmentTask[]; tone?: 'danger' }) {
  return (
    <Card>
      <CardHeader
        icon={tone === 'danger' ? <AlertTriangle className="text-danger-600" /> : <CalendarClock />}
        title={
          <span className={cn(tone === 'danger' && 'text-danger-700 dark:text-danger-500')}>
            {title} <span className="num font-normal text-muted">· {tasks.length}</span>
          </span>
        }
      />
      {tasks.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[0.8125rem] text-muted">Nothing upcoming.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
              <div className="min-w-0 flex-1 basis-60">
                <p className="truncate text-[0.8125rem] font-medium text-ink">{t.title}</p>
                <p className="truncate text-xs text-muted">
                  {t.leadId ? (
                    <Link to={leadPath(t.leadId)} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                      {t.leadCompany ?? 'Open lead'}
                    </Link>
                  ) : (
                    'No lead'
                  )}
                  <span className="text-subtle"> · {t.status}</span>
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <Avatar name={t.ownerName} size="xs" />
                {t.ownerName}
              </span>
              <span className={cn('text-xs font-medium', PRIORITY_STYLES[t.priority as Priority] ?? 'text-muted')}>{t.priority}</span>
              <span className={cn('num flex w-28 items-center justify-end gap-1 text-xs', t.overdue ? 'font-medium text-danger-600 dark:text-danger-500' : 'text-muted')}>
                <CalendarClock className="size-3.5" aria-hidden />
                {fmtDate(t.dueDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ---------------- Figures ---------------- */

function Figures({ d }: { d: DepartmentDetail }) {
  const f = d.figures
  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 rounded-lg bg-info-50 px-3 py-2 text-[0.8125rem] text-info-700 dark:bg-info-500/10 dark:text-info-500">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        Sales figures only for now. Members’ leads, follow-ups and activity targets this month.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Department figures" className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <StatCard
            label="Headcount"
            icon={<Users />}
            value={f.headcount}
            hint={f.headcountWithSubs > f.headcount ? `${f.headcountWithSubs} including sub-departments` : 'Active members'}
          />
          <StatCard label="Leads owned" icon={<UserCheck />} value={f.leadsOwned} hint={`${f.openLeads} open · ${fmtCompactMoney(f.openPipelineValue)} pipeline`} />
          <StatCard label="Won this month" icon={<Trophy />} value={f.wonThisMonth} hint="Leads moved to won" />
          <StatCard
            label="Overdue follow-ups"
            icon={<AlertTriangle />}
            value={f.overdueFollowUps}
            alert={f.overdueFollowUps > 0}
            hint={f.overdueFollowUps ? 'Open leads past their next follow-up' : 'Everyone is on schedule'}
          />
        </section>
        <Card>
          <CardHeader icon={<Target />} title="Targets completion" description="Activity targets this month" />
          <CardBody>
            {f.targetsCompletion === null ? (
              <EmptyState className="py-6" icon={<CircleDollarSign />} title="No targets set" body="None of the members has an activity target this month." />
            ) : (
              <>
                <Gauge
                  percent={f.targetsCompletion}
                  label="of targets"
                  color={f.targetsCompletion >= 100 ? 'var(--color-success-500)' : f.targetsCompletion >= 60 ? 'var(--color-brand-500)' : 'var(--color-warning-500)'}
                />
                <p className="mt-3 text-center text-xs text-muted">Average across {plural(f.membersWithTargets, 'member')} with targets</p>
              </>
            )}
          </CardBody>
        </Card>
      </div>
      {d.memberCount === 0 && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Crown className="size-3.5" aria-hidden />
          Figures fill in once the department has members.
        </p>
      )}
    </div>
  )
}

/* ---------------- Loading ---------------- */

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading department">
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
          <Skeleton className="h-8 w-80 max-w-full" />
        </div>
      </div>
      <PageBody>
        <Skeleton className="h-96 rounded-card" />
      </PageBody>
    </div>
  )
}
