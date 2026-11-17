import type { QuotationStatus } from '@/modules/quotations/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

export const QUOTATION_STATUS_TONE: Record<QuotationStatus, Tone> = {
  Draft: 'neutral',
  Sent: 'blue',
  Viewed: 'brand',
  Accepted: 'green',
  Rejected: 'red',
  Expired: 'amber',
}

/** Quotation status as a dot chip; `soft` gives the tinted pill for headers. */
export function QuotationStatusBadge({ status, soft = false }: { status: QuotationStatus; soft?: boolean }) {
  return (
    <Badge tone={QUOTATION_STATUS_TONE[status]} variant={soft ? 'soft' : 'dot'}>
      {status}
    </Badge>
  )
}
