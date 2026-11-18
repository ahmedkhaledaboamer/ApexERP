import type { QuotationStatus } from '@/modules/quotations/types'
import { Badge } from '@/shared/components/ui/Badge'
import { QUOTATION_STATUS_LABEL, QUOTATION_STATUS_TONE } from '@/shared/domain/enums'

export { QUOTATION_STATUS_LABEL, QUOTATION_STATUS_TONE }

/** Quotation status as a dot chip; `soft` gives the tinted pill for headers. */
export function QuotationStatusBadge({ status, soft = false }: { status: QuotationStatus; soft?: boolean }) {
  return (
    <Badge tone={QUOTATION_STATUS_TONE[status]} variant={soft ? 'soft' : 'dot'}>
      {QUOTATION_STATUS_LABEL[status]}
    </Badge>
  )
}
