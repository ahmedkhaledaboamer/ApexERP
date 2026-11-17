import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, FileText, Plus } from 'lucide-react'
import { newQuotationPath, quotationPath } from '@/app/paths'
import { useQuotationsQuery } from '@/modules/quotations/hooks/useQuotations'
import { fmtAed } from '@/modules/quotations/lib/totals'
import { QuotationStatusBadge } from '@/modules/quotations/components/QuotationStatusBadge'
import { ValidUntil } from '@/modules/quotations/components/ValidUntil'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'

/** Quotations for one lead (lead page and CRM profile), with a shortcut to start a new one. */
export function LeadQuotations({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const navigate = useNavigate()
  const query = useQuotationsQuery(leadId)
  const list = query.data ?? []
  const open = list.filter((q) => q.status === 'Draft' || q.status === 'Sent' || q.status === 'Viewed').length

  const newButton = canEdit ? (
    <Button size="sm" onClick={() => navigate(newQuotationPath({ leadId }))}>
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
            <li key={q.id}>
              <Link
                to={quotationPath(q.id)}
                className="group flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 transition-colors hover:bg-hover"
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
                <span className="num ms-12 text-[0.8125rem] font-semibold text-ink sm:ms-0">{fmtAed(q.totals.total)}</span>
                <ChevronRight className="hidden size-4 text-subtle transition-transform group-hover:translate-x-0.5 sm:block" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
