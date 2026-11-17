import { useState, type ReactNode } from 'react'
import { differenceInSeconds, formatDistanceToNowStrict } from 'date-fns'
import { CalendarClock, CheckCircle2, Clock, DatabaseBackup, Loader2, Play, RotateCcw, XCircle } from 'lucide-react'
import type { BackupRun, BackupStatus } from '@/modules/settings/security/types'
import { useBackupsQuery, useRunBackup } from '@/modules/settings/hooks/useSecurity'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'

const STATUS: Record<BackupStatus, { label: string; tone: Tone; icon: ReactNode }> = {
  running: { label: 'Running', tone: 'blue', icon: <Loader2 className="animate-spin" /> },
  success: { label: 'Succeeded', tone: 'green', icon: <CheckCircle2 /> },
  failed: { label: 'Failed', tone: 'red', icon: <XCircle /> },
}

function duration(run: BackupRun): string {
  if (!run.finishedAt) return '—'
  const s = Math.max(0, differenceInSeconds(new Date(run.finishedAt), new Date(run.startedAt)))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function size(mb: number | null): string {
  if (mb === null) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(0)} MB`
}

/** Backup schedule, health and history. Admins can run one by hand. */
export function BackupsCard({ canEdit }: { canEdit: boolean }) {
  const query = useBackupsQuery()
  const run = useRunBackup()
  const toast = useToast()
  const [showAll, setShowAll] = useState(false)
  const running = query.data?.history.some((r) => r.status === 'running') ?? false
  const lastFailed = query.data?.history.find((r) => r.status !== 'running')?.status === 'failed'

  function start() {
    run.mutate(undefined, {
      onSuccess: () => toast.info('Backup started', 'It runs in the background; this list updates when it finishes.'),
      onError: (e) => toast.error('Couldn’t start the backup', e.message),
    })
  }

  const history = query.data ? (showAll ? query.data.history : query.data.history.slice(0, 6)) : []

  return (
    <Card>
      <CardHeader
        icon={<DatabaseBackup />}
        title="Backups"
        description="Automatic copies of all ERP data, kept off-site."
        action={
          canEdit && (
            <Button variant="secondary" size="sm" loading={run.isPending} disabled={running || !query.data} onClick={start}>
              {!run.isPending && <Play />}
              {running ? 'Backup running…' : 'Run backup now'}
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        {query.isPending ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-40 w-full rounded-lg" />
          </>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                icon={lastFailed ? <XCircle /> : <CheckCircle2 />}
                tone={lastFailed ? 'danger' : 'success'}
                label="Last successful"
                value={query.data.lastSuccessAt ? formatDistanceToNowStrict(new Date(query.data.lastSuccessAt), { addSuffix: true }) : 'Never'}
                hint={lastFailed ? 'The latest run failed' : fmtDate(query.data.lastSuccessAt, 'd MMM, HH:mm')}
              />
              <Tile
                icon={<CalendarClock />}
                label="Next scheduled"
                value={formatDistanceToNowStrict(new Date(query.data.nextAt), { addSuffix: true })}
                hint={fmtDate(query.data.nextAt, 'd MMM, HH:mm')}
              />
              <Tile icon={<Clock />} label="Schedule" value={query.data.schedule.split(' at ')[0]} hint={query.data.schedule} />
              <Tile icon={<RotateCcw />} label="Retention" value={`${query.data.retentionDays} days`} hint="Older copies are removed" />
            </div>

            <div className="overflow-hidden rounded-lg border border-line">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-[0.8125rem]">
                  <thead className="bg-sunken/70">
                    <tr className="border-b border-line text-xs text-muted">
                      <th scope="col" className="h-9 px-3 ps-4 text-start font-medium">Started</th>
                      <th scope="col" className="h-9 px-3 text-start font-medium">Type</th>
                      <th scope="col" className="h-9 px-3 text-start font-medium">Status</th>
                      <th scope="col" className="h-9 px-3 text-end font-medium">Duration</th>
                      <th scope="col" className="h-9 px-3 pe-4 text-end font-medium">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r) => (
                      <tr key={r.id} className="border-b border-line last:border-0">
                        <td className="h-11 px-3 ps-4 whitespace-nowrap">
                          <span className="num text-ink">{fmtDate(r.startedAt, 'd MMM yyyy, HH:mm')}</span>
                        </td>
                        <td className="px-3 whitespace-nowrap text-ink-2">
                          {r.trigger === 'manual' ? `Manual${r.triggeredBy ? ` · ${r.triggeredBy}` : ''}` : 'Scheduled'}
                        </td>
                        <td className="px-3">
                          <span title={r.note || undefined}>
                            <Badge tone={STATUS[r.status].tone} icon={STATUS[r.status].icon}>
                              {STATUS[r.status].label}
                            </Badge>
                          </span>
                        </td>
                        <td className="num px-3 text-end text-ink-2">{duration(r)}</td>
                        <td className="num px-3 pe-4 text-end text-ink-2">{size(r.sizeMb)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {query.data.history.length > 6 && (
                <div className="border-t border-line px-4 py-2">
                  <Button variant="ghost" size="xs" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show fewer' : `Show all ${query.data.history.length} runs`}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Tile({
  icon,
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  icon: ReactNode
  label: string
  value: string
  hint: string
  tone?: 'neutral' | 'success' | 'danger'
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <span
          className={cn(
            '[&_svg]:size-3.5',
            tone === 'success' && 'text-success-600',
            tone === 'danger' && 'text-danger-600',
          )}
        >
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-1.5 truncate text-[0.9375rem] font-semibold text-ink">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>
    </div>
  )
}
