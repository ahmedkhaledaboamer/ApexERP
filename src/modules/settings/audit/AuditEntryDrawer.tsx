import { ArrowRight, Clock, FileText, Hash, Tag, User } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import type { AuditEntry } from '@/modules/settings/types'
import { fmtDate } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Property, PropertyList } from '@/shared/components/ui/Card'
import { ACTION_LABEL, ACTION_TONE, entityLabel, fieldLabel } from './auditLabels'

/** One audit entry: who, what, when, and the field-by-field changes. */
export function AuditEntryDrawer({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!entry}
      onClose={onClose}
      width="lg"
      title={entry?.summary ?? ''}
      description={entry ? `${entry.id} · ${fmtDate(entry.at, 'd MMM yyyy, HH:mm:ss')}` : undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {entry && (
        <div className="space-y-6">
          <PropertyList>
            <Property label="Who" icon={<User />}>
              <span className="flex items-center gap-2">
                <Avatar name={entry.userName} size="xs" />
                {entry.userName}
              </span>
            </Property>
            <Property label="When" icon={<Clock />}>
              <span className="num">{fmtDate(entry.at, 'EEE d MMM yyyy, HH:mm')}</span>
              <span className="ms-1.5 text-muted">({formatDistanceToNowStrict(new Date(entry.at), { addSuffix: true })})</span>
            </Property>
            <Property label="Action" icon={<Tag />}>
              <Badge tone={ACTION_TONE[entry.action]}>{ACTION_LABEL[entry.action] ?? entry.action}</Badge>
            </Property>
            <Property label="Entity" icon={<FileText />}>
              {entityLabel(entry.entity)}
            </Property>
            <Property label="Record" icon={<Hash />}>
              <span className="font-mono text-xs">{entry.entityId}</span>
            </Property>
          </PropertyList>

          <section aria-labelledby="audit-changes">
            <h3 id="audit-changes" className="mb-2 text-[0.8125rem] font-semibold text-ink">
              Changes
              {entry.changes.length > 0 && <span className="num ms-1.5 font-normal text-muted">{entry.changes.length}</span>}
            </h3>
            {entry.changes.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[0.8125rem] text-muted">
                No field-level changes were recorded for this action.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {entry.changes.map((c, i) => (
                  <li key={`${c.field}-${i}`} className="px-3 py-2.5">
                    <p className="text-xs font-medium text-muted">{fieldLabel(c.field)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem]">
                      <span className="max-w-full rounded-md bg-danger-50 px-1.5 py-0.5 break-words text-danger-700 line-through decoration-danger-700/40 dark:bg-danger-500/10 dark:text-danger-500">
                        {c.from}
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-subtle" aria-label="changed to" />
                      <span className="max-w-full rounded-md bg-success-50 px-1.5 py-0.5 break-words text-success-700 dark:bg-success-500/10 dark:text-success-500">
                        {c.to}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
