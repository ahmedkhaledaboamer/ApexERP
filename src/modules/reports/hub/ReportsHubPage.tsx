import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Briefcase, CalendarClock, ChartPie, Clock, FolderKanban, Landmark, Megaphone, Star, Ticket, TrendingUp, Users } from 'lucide-react'
import { useCurrentUser } from '@/store/hooks'
import { scopeOf } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SearchInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { ScheduleModal } from '@/modules/reports/components/ScheduleModal'
import type { ScheduleReport } from '@/modules/reports/types'
import { HUB_AREAS, HUB_AREA_LABEL, type HubArea } from './catalog'
import { hubApi, useReportsHub, useToggleFavourite } from './api'
import type { HubReport } from './types'

/**
 * `/reports`: the Reports hub — every report the role can open, by area, with favourites and recently viewed (stored
 * per user on the server). The phase-1 sales items (leads by status / industry / source, conversion, agent performance,
 * target completion) are the ready-made Sales reports, linked here. Sales reports can be e-mailed on a schedule.
 */

const AREA_ICON: Record<HubArea, ReactNode> = {
  management: <TrendingUp />,
  sales: <Briefcase />,
  marketing: <Megaphone />,
  events: <Ticket />,
  projects: <FolderKanban />,
  hr: <Users />,
  finance: <Landmark />,
}

export default function ReportsHubPage() {
  const user = useCurrentUser()
  if (!user) return null
  if (scopeOf(user.role, 'reports') === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Reports aren’t part of your role" body={`As ${user.role}, you don’t have access to reports. Ask an administrator if you need them.`} />
      </PageBody>
    )
  }
  return <Hub email={user.email} />
}

function Hub({ email }: { email: string }) {
  const hub = useReportsHub()
  const [search, setSearch] = useState('')
  const [schedule, setSchedule] = useState<ScheduleReport | null>(null)
  const data = hub.data
  const reports = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (data?.reports ?? []).filter((r) => !s || r.title.toLowerCase().includes(s) || r.description.toLowerCase().includes(s) || HUB_AREA_LABEL[r.area].toLowerCase().includes(s))
  }, [data, search])

  return (
    <>
      <PageHeader
        title="Reports"
        icon={<IconTile><BarChart3 aria-hidden /></IconTile>}
        description="Every report you can open, by area. Star the ones you use most; recently viewed ones come back here."
        actions={
          data?.canSchedule ? (
            <Button variant="secondary" onClick={() => setSchedule('all')}>
              <CalendarClock />
              Scheduled e-mails
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-6">
        {hub.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : hub.isError || !data ? (
          <ErrorState message={hub.error instanceof Error ? hub.error.message : 'Couldn’t load the reports.'} onRetry={() => void hub.refetch()} />
        ) : (
          <>
            <SearchInput aria-label="Search reports" placeholder="Search reports" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            {!search && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Shortlist title="Favourites" icon={<Star />} empty="Star a report to keep it here." ids={data.favourites} reports={data.reports} />
                <Shortlist title="Recently viewed" icon={<Clock />} empty="Reports you open appear here." ids={data.recent.map((r) => r.reportId)} reports={data.reports} />
              </div>
            )}
            {reports.length === 0 ? (
              <Card><EmptyState title="No report matches" body="Try another word." /></Card>
            ) : (
              HUB_AREAS.map((area) => {
                const rows = reports.filter((r) => r.area === area)
                if (!rows.length) return null
                return (
                  <section key={area} aria-label={HUB_AREA_LABEL[area]} className="space-y-3">
                    <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold [&_svg]:size-4 [&_svg]:text-muted">
                      {AREA_ICON[area]}
                      {HUB_AREA_LABEL[area]}
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {rows.map((r) => (
                        <ReportTile key={r.id} r={r} canSchedule={data.canSchedule} onSchedule={setSchedule} />
                      ))}
                    </div>
                  </section>
                )
              })
            )}
          </>
        )}
      </PageBody>
      <ScheduleModal open={schedule !== null} onClose={() => setSchedule(null)} defaultReport={schedule ?? 'all'} defaultEmail={email} />
    </>
  )
}

function Shortlist({ title, icon, empty, ids, reports }: { title: string; icon: ReactNode; empty: string; ids: string[]; reports: HubReport[] }) {
  const rows = ids.map((id) => reports.find((r) => r.id === id)).filter((r): r is HubReport => !!r)
  return (
    <Card className="p-4">
      <h2 className="mb-2 flex items-center gap-2 text-[0.8125rem] font-semibold [&_svg]:size-4 [&_svg]:text-muted">
        {icon}
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-[0.8125rem] text-muted">{empty}</p>
      ) : (
        <ul aria-label={title} className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="py-1.5">
              <OpenLink r={r} className="text-[0.8125rem] font-medium text-brand-700 hover:underline dark:text-brand-300" />
              <span className="ms-2 text-xs text-muted">{HUB_AREA_LABEL[r.area]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Opens a report and records it as recently viewed (fire and forget). */
function OpenLink({ r, className }: { r: HubReport; className?: string }) {
  return (
    <Link to={r.path} className={className} onClick={() => void hubApi.viewed(r.id).catch(() => undefined)}>
      {r.title}
    </Link>
  )
}

function ReportTile({ r, canSchedule, onSchedule }: { r: HubReport; canSchedule: boolean; onSchedule: (id: ScheduleReport) => void }) {
  const toast = useToast()
  const toggle = useToggleFavourite()
  return (
    <Card className="flex flex-col gap-2 p-4" data-report={r.id}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-muted [&_svg]:size-4"><ChartPie /></span>
        <div className="min-w-0 flex-1">
          <OpenLink r={r} className="text-[0.875rem] font-semibold text-ink hover:text-brand-700 hover:underline dark:hover:text-brand-300" />
          <p className="mt-0.5 text-[0.8125rem] text-muted">{r.description}</p>
        </div>
        <button
          type="button"
          aria-label={r.favourite ? `Remove ${r.title} from favourites` : `Add ${r.title} to favourites`}
          aria-pressed={r.favourite}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ id: r.id, on: !r.favourite }, { onError: (e) => toast.error('Couldn’t update favourites', e instanceof Error ? e.message : '') })}
          className={cn('rounded-md p-1 transition-colors hover:bg-hover [&_svg]:size-4', r.favourite ? 'text-warning-500' : 'text-subtle')}
        >
          <Star fill={r.favourite ? 'currentColor' : 'none'} />
        </button>
      </div>
      {canSchedule && r.schedule && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onSchedule(r.schedule!)}>
            <CalendarClock />
            Schedule e-mail
          </Button>
        </div>
      )}
    </Card>
  )
}
