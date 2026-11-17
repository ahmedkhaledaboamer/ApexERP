import { Link } from 'react-router-dom'
import { ArrowUpRight, Ban, MessageSquarePlus, Phone } from 'lucide-react'
import { leadPath } from '@/app/paths'
import { FollowUpLabel } from '@/modules/leads/components/FollowUpLabel'
import type { LeadRow } from '@/modules/leads/types'
import type { Alert } from '@/modules/alerts/types'
import { LeadAlertBadges } from '@/modules/alerts/components/LeadAlertBadges'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { RescheduleMenu } from './RescheduleMenu'

interface FollowUpRowProps {
  lead: LeadRow
  /** No-contact / stalled alerts for this lead, shown as small badges. */
  alerts?: Alert[]
  canEdit: boolean
  showOwner: boolean
  rescheduling: boolean
  onLog: (lead: LeadRow) => void
  onReschedule: (lead: LeadRow, iso: string, label: string) => void
}

/** One follow-up: who, where it stands, what's next, and the two actions an agent takes. */
export function FollowUpRow({ lead, alerts, canEdit, showOwner, rescheduling, onLog, onReschedule }: FollowUpRowProps) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-hover/50 sm:px-5 lg:flex-row lg:items-center lg:gap-4">
      {/* Company + contact */}
      <div className="flex min-w-0 flex-1 items-start gap-3 lg:items-center">
        <Avatar name={lead.company} size="lg" square />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <Link to={leadPath(lead.id)} className="truncate text-[0.875rem] font-semibold text-ink hover:underline">
              {lead.company}
            </Link>
            {lead.doNotContact && (
              <Badge tone="red" icon={<Ban aria-hidden />} className="shrink-0">
                Do not contact
              </Badge>
            )}
            <LeadAlertBadges alerts={alerts} className="shrink-0" />
          </p>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[0.8125rem] text-muted">
            <span className="truncate">{lead.contactName || lead.contactEmail}</span>
            {lead.mobile && (
              <>
                <span aria-hidden className="text-subtle">
                  ·
                </span>
                {lead.doNotContact ? (
                  <span className="num whitespace-nowrap line-through decoration-subtle">{lead.mobile}</span>
                ) : (
                  <a href={`tel:${lead.mobile.replace(/\s/g, '')}`} className="num inline-flex items-center gap-1 whitespace-nowrap hover:text-ink">
                    <Phone className="size-3" aria-hidden />
                    {lead.mobile}
                  </a>
                )}
              </>
            )}
          </p>
          {/* Compact meta for narrow screens */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8125rem] lg:hidden">
            <StatusBadge status={lead.status} />
            <FollowUpLabel date={lead.nextFollowUpDate} status={lead.status} withIcon />
            {showOwner && (
              <span className="flex items-center gap-1.5 text-ink-2">
                <Avatar name={lead.ownerName} size="xs" />
                {lead.ownerName}
              </span>
            )}
          </div>
          {lead.nextStep && <p className="mt-1.5 line-clamp-2 text-[0.8125rem] text-ink-2 lg:hidden">{lead.nextStep}</p>}
        </div>
      </div>

      {/* Wide-screen columns */}
      <div className="hidden w-28 shrink-0 lg:block">
        <StatusBadge status={lead.status} />
      </div>
      <p className="hidden min-w-0 flex-1 text-[0.8125rem] text-ink-2 lg:line-clamp-2" title={lead.nextStep || undefined}>
        {lead.nextStep || <span className="text-subtle">No next step recorded</span>}
      </p>
      {showOwner && (
        <div className="hidden w-40 shrink-0 items-center gap-2 text-[0.8125rem] text-ink-2 xl:flex">
          <Avatar name={lead.ownerName} size="sm" />
          <span className="truncate">{lead.ownerName}</span>
        </div>
      )}
      {showOwner && (
        <div className="hidden shrink-0 lg:block xl:hidden">
          <Tooltip label={lead.ownerName}>
            <Avatar name={lead.ownerName} size="sm" />
          </Tooltip>
        </div>
      )}
      <div className="hidden w-28 shrink-0 text-[0.8125rem] lg:block">
        <FollowUpLabel date={lead.nextFollowUpDate} status={lead.status} />
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5 ps-[3.25rem] lg:ps-0">
        {canEdit && (
          <>
            <Button variant="secondary" size="sm" onClick={() => onLog(lead)}>
              <MessageSquarePlus />
              Log activity
            </Button>
            <RescheduleMenu loading={rescheduling} onPick={(iso, label) => onReschedule(lead, iso, label)} />
          </>
        )}
        <Link
          to={leadPath(lead.id)}
          aria-label={`Open ${lead.company}`}
          title="Open lead"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
    </li>
  )
}
