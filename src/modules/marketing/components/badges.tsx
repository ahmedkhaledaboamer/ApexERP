import { Badge, type Tone } from '@/shared/components/ui/Badge'
import {
  BULK_EMAIL_STATUS_LABEL,
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_LABEL,
  type BulkEmailStatus,
  type CampaignChannel,
  type CampaignStatus,
} from '@/modules/marketing/types'

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = { draft: 'neutral', active: 'green', paused: 'amber', completed: 'blue' }
export const BULK_STATUS_TONE: Record<BulkEmailStatus, Tone> = { draft: 'neutral', scheduled: 'sky', sending: 'amber', sent: 'green', cancelled: 'red' }
export const CHANNEL_TONE: Record<CampaignChannel, Tone> = { email: 'brand', social: 'blue', ads: 'pink', event: 'teal', referral: 'green', other: 'neutral' }

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={CAMPAIGN_STATUS_TONE[status]} variant="dot">
      {CAMPAIGN_STATUS_LABEL[status]}
    </Badge>
  )
}

export function BulkEmailStatusBadge({ status }: { status: BulkEmailStatus }) {
  return (
    <Badge tone={BULK_STATUS_TONE[status]} variant="dot">
      {BULK_EMAIL_STATUS_LABEL[status]}
    </Badge>
  )
}

export function ChannelBadge({ channel }: { channel: CampaignChannel }) {
  return (
    <Badge tone={CHANNEL_TONE[channel]} variant="outline">
      {CHANNEL_LABEL[channel]}
    </Badge>
  )
}
