import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, FileText, Plus, Trophy } from 'lucide-react'
import { newQuotationPath, quotationPath } from '@/app/paths'
import { useQuotationsQuery } from '@/modules/quotations/hooks/useQuotations'
import { fmtAmount } from '@/modules/quotations/lib/totals'
import { QuotationStatusBadge } from '@/modules/quotations/components/QuotationStatusBadge'
import { ValidUntil } from '@/modules/quotations/components/ValidUntil'
import { Button } from '@/shared/components/ui/Button'
import { Can } from '@/shared/components/permissions'
import { useOpenWonDialog } from '@/modules/won/hooks'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'

/** Quotations for one lead (lead page and CRM profile), with a shortcut to start a new one. */
export function LeadQuotations({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const navigate = useNavigate()
  const query = useQuotationsQuery(leadId)
  const openWon = useOpenWonDialog()
  const list = query.data ?? []
  const open = list.filter((q) => q.status === 'draft' || q.status === 'sent' || q.status === 'viewed').length

  const newButton = canEdit ? (
    <Button write size="sm" onClick={() => navigate(newQuotationPath({ leadId }))}>
      <Plus />
      New quotation
    </Button>
  ) : undefined

  return (
    <Card>
      <CardHeader
        title="Quotations"
        description={
          query.isSuccess && list.length > 0
            ? `${list.length} ${list.length === 1 ? 'quotation' : 'quotations'}${open ? `, ${open} open` : ''}`
            : 'Built from the service catalog and sent from the system.'
        }
        action={list.length > 0 ? newButton : undefined}
      />
      {query.isPending ? (
        <div className="space-y-3 px-5 pb-5">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          className="border-t border-line"
          icon={<FileText aria-hidden />}
          title="No quotations yet"
          body={
            canEdit
              ? 'Build one from the service catalog. Sending it moves the lead to Proposal and logs the email here.'
              : 'Quotations for this lead will show up here.'
          }
          action={newButton}
        />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {list.map((q) => (
            <li key={q.id} className="flex items-center">
              <Link
                to={quotationPath(q.id)}
                className="group flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 transition-colors hover:bg-hover"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken/60 text-muted">
                  <FileText className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-[0.8125rem] font-medium text-ink">{q.title}</span>
                    <QuotationStatusBadge status={q.status} />
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className="font-mono">{q.number}</span>
                    <span aria-hidden>·</span>
                    <span className="flex items-center gap-1">
                      Valid until <ValidUntil date={q.validUntil} status={q.status} className="text-xs" />
                    </span>
                  </p>
                </div>
                <span className="num ms-12 text-[0.8125rem] font-semibold text-ink sm:ms-0">{fmtAmount(q.totals.total, q.currency)}</span>
                <ChevronRight className="hidden size-4 text-subtle transition-transform group-hover:translate-x-0.5 sm:block rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </Link>
              {canEdit && q.status === 'accepted' && !q.customerId && (
                <Can module="sales" action="edit">
                  <div className="pe-4">
                    <Button write size="xs" variant="secondary" onClick={() => openWon(leadId, q.id)} aria-label={`Win deal from ${q.number}`}>
                      <Trophy className="text-success-600" />
                      <span className="hidden sm:inline">Win deal</span>
                    </Button>
                  </div>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
