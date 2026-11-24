import { Link } from 'react-router-dom'
import { Inbox } from 'lucide-react'
import { useApprovalsInbox } from '@/modules/finance/purchases/approvalsInbox'
import { APPROVER_LABEL } from '@/modules/finance/purchases/types'
import { fmt2 } from '@/modules/finance/collections/components/bits'
import { Section, fmtDay } from '@/modules/finance/purchases/components/bits'
import { financeBillPath, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'

/**
 * `/finance/approvals`: the caller's approvals inbox — purchase orders, supplier bills and expense claims waiting for
 * their step. Plan-gated only (department heads use it without accounting access; reached from My HR and the user
 * menu). Each row opens the document, where Approve / Reject act on it.
 */
export default function ApprovalsInboxPage() {
  const inbox = useApprovalsInbox()
  const pos = inbox.pos.data ?? []
  const bills = inbox.bills.data ?? []
  const claims = inbox.claims.data ?? []
  const row = 'flex items-center justify-between gap-3 py-2 text-[0.8125rem]'
  const link = 'min-w-0 truncate text-brand-700 hover:underline dark:text-brand-300'
  return (
    <>
      <PageHeader icon={<IconTile><Inbox /></IconTile>} title="Approvals" description="Purchase requests, supplier bills and expense claims waiting for your decision." />
      <PageBody className="space-y-4">
        {inbox.loading ? (
          <Skeleton className="h-48" />
        ) : inbox.count === 0 ? (
          <EmptyState title="Nothing to approve" body="Requests waiting for your decision show here." icon={<Inbox />} />
        ) : (
          <>
            {pos.length > 0 && (
              <Section title={`Purchase requests (${pos.length})`}>
                <ul className="divide-y divide-line" aria-label="Purchase requests awaiting my approval">
                  {pos.map((p) => (
                    <li key={p.id} className={row}>
                      <Link to={financePurchaseOrderPath(p.id)} className={link}>
                        <span className="num">{p.number}</span> · {p.vendorName}
                        <span className="block text-xs text-muted">{p.requesterName}{p.departmentName ? ` · ${p.departmentName}` : ''} · {fmtDay(p.orderDate)}{p.pendingStep ? ` · step: ${APPROVER_LABEL[p.pendingStep]}` : ''}</span>
                      </Link>
                      <span className="num shrink-0">{fmt2(p.total)} {p.currency}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {bills.length > 0 && (
              <Section title={`Supplier bills (${bills.length})`}>
                <ul className="divide-y divide-line" aria-label="Bills awaiting my approval">
                  {bills.map((b) => (
                    <li key={b.id} className={row}>
                      <Link to={financeBillPath(b.id)} className={link}>
                        <span className="num">{b.number}</span> · {b.vendorName}
                        <span className="block text-xs text-muted">Supplier invoice {b.supplierInvoiceNumber} · {fmtDay(b.billDate)}</span>
                      </Link>
                      <span className="num shrink-0">{fmt2(b.total)} {b.currency}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {claims.length > 0 && (
              <Section title={`Expense claims (${claims.length})`}>
                <ul className="divide-y divide-line" aria-label="Expense claims awaiting my approval">
                  {claims.map((c) => (
                    <li key={c.id} className={row}>
                      <Link to={`/finance/expenses?tab=claims&claim=${encodeURIComponent(c.id)}`} className={link}>
                        <span className="num">{c.number}</span> · {c.title}
                        <span className="block text-xs text-muted">{c.employeeName}</span>
                      </Link>
                      <span className="num shrink-0">{fmt2(c.total)} {c.currency}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}
