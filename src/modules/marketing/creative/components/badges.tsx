import { Badge, type Tone } from '@/shared/components/ui/Badge'
import {
  ASSET_KIND_LABEL,
  CONTENT_CHANNEL_LABEL,
  CONTENT_STATUS_LABEL,
  DESIGN_PRIORITY_LABEL,
  DESIGN_STATUS_LABEL,
  type AssetKind,
  type ContentChannel,
  type ContentStatus,
  type DesignPriority,
  type DesignStatus,
} from '@/modules/marketing/creative/types'

export const CONTENT_STATUS_TONE: Record<ContentStatus, Tone> = {
  idea: 'neutral',
  draft: 'neutral',
  in_review: 'amber',
  approved: 'teal',
  scheduled: 'sky',
  published: 'green',
  archived: 'neutral',
}

export const DESIGN_STATUS_TONE: Record<DesignStatus, Tone> = {
  requested: 'neutral',
  in_progress: 'blue',
  in_review: 'amber',
  changes_requested: 'pink',
  approved: 'teal',
  delivered: 'green',
  cancelled: 'red',
}

export const PRIORITY_TONE: Record<DesignPriority, Tone> = { low: 'neutral', medium: 'blue', high: 'amber', urgent: 'red' }

/** Calendar chip colours per status (ring + soft background, light and dark). */
export const CONTENT_CHIP: Record<ContentStatus, string> = {
  idea: 'bg-sunken text-ink-2 ring-line',
  draft: 'bg-sunken text-ink-2 ring-line-strong',
  in_review: 'bg-warning-50 text-warning-700 ring-warning-100 dark:bg-warning-500/15 dark:text-warning-500 dark:ring-warning-500/20',
  approved: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/20',
  scheduled: 'bg-info-50 text-info-700 ring-info-100 dark:bg-info-500/15 dark:text-info-500 dark:ring-info-500/20',
  published: 'bg-success-50 text-success-700 ring-success-100 dark:bg-success-500/15 dark:text-success-500 dark:ring-success-500/20',
  archived: 'bg-sunken text-muted ring-line line-through',
}

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  return (
    <Badge tone={CONTENT_STATUS_TONE[status]} variant="dot">
      {CONTENT_STATUS_LABEL[status]}
    </Badge>
  )
}

export function DesignStatusBadge({ status }: { status: DesignStatus }) {
  return (
    <Badge tone={DESIGN_STATUS_TONE[status]} variant="dot">
      {DESIGN_STATUS_LABEL[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: DesignPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{DESIGN_PRIORITY_LABEL[priority]}</Badge>
}

export function ChannelChips({ channels, max = 3 }: { channels: ContentChannel[]; max?: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      {channels.slice(0, max).map((c) => (
        <Badge key={c} variant="outline">
          {CONTENT_CHANNEL_LABEL[c]}
        </Badge>
      ))}
      {channels.length > max && <Badge variant="outline">+{channels.length - max}</Badge>}
    </span>
  )
}

export function AssetKindBadge({ kind }: { kind: AssetKind }) {
  return <Badge tone="brand">{ASSET_KIND_LABEL[kind]}</Badge>
}
