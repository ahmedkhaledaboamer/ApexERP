import { Eye } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Badge, DOT } from '@/shared/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { KIND_LABEL, type DraftStatus } from './draft'

/** Live preview of the pipeline board from the statuses being edited (active open statuses, in order). */
export function PipelinePreview({ statuses }: { statuses: DraftStatus[] }) {
  const active = statuses.filter((s) => s.active)
  const open = active.filter((s) => s.kind === 'open')
  const off = active.filter((s) => s.kind !== 'open')
  const inactive = statuses.filter((s) => !s.active)

  return (
    <Card>
      <CardHeader
        icon={<Eye />}
        title="Pipeline preview"
        description="The board’s columns as they’ll appear: active open statuses, left to right. Updates as you edit."
      />
      <CardBody>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-[0.8125rem] text-muted">
            No active open statuses: the pipeline would be empty.
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <ol className="flex gap-2.5" aria-label="Pipeline columns">
              {open.map((s, i) => (
                <li key={s._id} className="w-[9.5rem] shrink-0 rounded-lg border border-line bg-sunken/50 p-2">
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[s.tone])} />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{s.label.trim() || 'Untitled'}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[0.6875rem] text-muted">
                    <span>Stage {i + 1}</span>
                    <span className="num font-medium text-ink-2">{Number.isFinite(s.probability) ? s.probability : 0}%</span>
                  </div>
                  <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.probability || 0)}%`, background: s.color }} />
                  </div>
                  <div aria-hidden className="mt-2.5 space-y-1.5">
                    <div className="h-7 rounded-md border border-line bg-surface" />
                    <div className="h-7 rounded-md border border-line bg-surface" style={{ opacity: Math.max(0.25, 0.7 - i * 0.06) }} />
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {(off.length > 0 || inactive.length > 0) && (
          <div className="mt-4 space-y-2 text-[0.8125rem]">
            {off.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 text-xs text-muted">Off the board</span>
                {off.map((s) => (
                  <Badge key={s._id} tone={s.tone} variant="dot">
                    {s.label.trim() || 'Untitled'} · {KIND_LABEL[s.kind]}
                  </Badge>
                ))}
              </div>
            )}
            {inactive.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 text-xs text-muted">Inactive</span>
                {inactive.map((s) => (
                  <Badge key={s._id} variant="outline">
                    {s.label.trim() || 'Untitled'}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
