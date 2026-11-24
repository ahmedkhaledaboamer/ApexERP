import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, FileCode2, Mail, Pencil, Printer, Repeat, Send, Trash2, Undo2 } from 'lucide-react'
import { quotationPath } from '@/app/paths'
import type { InvoiceDetail, InvoiceJournal } from '@/modules/finance/invoices/types'
import { downloadXml, invoicesApi, useInvoice, useInvoiceMutation, useInvoicesScope } from '@/modules/finance/invoices/api'
import { fmtMoney } from '@/modules/finance/invoices/calc'
import { InvoiceDocument, InvoicePrintPortal } from '@/modules/finance/invoices/components/InvoiceDocument'
import { CreditNoteModal, RecurringModal, SendModal, VoidModal, invoicePath } from '@/modules/finance/invoices/components/InvoiceModals'
import { InvoiceStatusBadge } from './InvoicesPage'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** `/finance/invoices/:id`: the invoice (print view), its actions, journal entry, credit notes, sends, history and ZATCA data. */
export default function InvoiceDetailPage() {
  const { id = '' } = useParams()
  const q = useInvoice(id)
  if (q.isLoading) return <PageBody><Skeleton className="h-[40rem]" /></PageBody>
  if (q.isError || !q.data) return <PageBody><ErrorState message={q.error ? (q.error as Error).message : 'Invoice not found.'} /></PageBody>
  return <Detail inv={q.data} />
}

function Detail({ inv }: { inv: InvoiceDetail }) {
  const { canWrite } = useInvoicesScope()
  const navigate = useNavigate()
  const toast = useToast()
  const [modal, setModal] = useState<null | 'void' | 'credit' | 'send' | 'recurring'>(null)
  const issue = useInvoiceMutation(() => invoicesApi.issue(inv.id))
  const remove = useInvoiceMutation(() => invoicesApi.remove(inv.id))
  const xml = useInvoiceMutation(() => invoicesApi.xml(inv.id))
  const title = inv.status === 'draft' ? `Draft invoice ${inv.id}` : inv.number

  const doIssue = () =>
    issue.mutate(undefined, {
      onSuccess: (d) => toast.success(`Invoice ${d.number} issued`, `Journal entry ${d.journal?.number ?? ''} posted`),
      onError: (e) => toast.error('Couldn’t issue the invoice', errMsg(e)),
    })
  const doDelete = () =>
    remove.mutate(undefined, {
      onSuccess: () => {
        toast.success('Draft deleted')
        navigate('/finance/invoices')
      },
      onError: (e) => toast.error('Couldn’t delete the draft', errMsg(e)),
    })
  const doXml = () =>
    xml.mutate(undefined, {
      onSuccess: (f) => {
        downloadXml(f)
        toast.success('ZATCA XML downloaded', f.filename)
      },
      onError: (e) => toast.error('Couldn’t export the XML', errMsg(e)),
    })

  return (
    <>
      <PageHeader
        title={title}
        description={`${inv.customerName} · ${fmtMoney(inv.total, inv.currency)}${inv.dueDate ? ` · due ${inv.dueDate}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={inv.status} overdue={inv.overdue} />
            <Button variant="ghost" onClick={() => navigate('/finance/invoices')}>
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Invoices
            </Button>
            {inv.can.edit && (
              <Button variant="secondary" write onClick={() => navigate(`${invoicePath(inv.id)}/edit`)}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            )}
            {inv.can.edit && (
              <Button variant="ghost" write onClick={doDelete} loading={remove.isPending}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            )}
            {inv.can.issue && (
              <Button write onClick={doIssue} loading={issue.isPending}>
                <Send className="size-4" aria-hidden /> Issue
              </Button>
            )}
            {inv.can.send && (
              <Button variant="secondary" write onClick={() => setModal('send')}>
                <Mail className="size-4" aria-hidden /> Send
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden /> Print / PDF
            </Button>
            {inv.can.xml && (
              <Button variant="secondary" write onClick={doXml} loading={xml.isPending}>
                <FileCode2 className="size-4" aria-hidden /> ZATCA XML
              </Button>
            )}
            {inv.can.credit && (
              <Button variant="secondary" write onClick={() => setModal('credit')}>
                <Undo2 className="size-4" aria-hidden /> Credit note
              </Button>
            )}
            {canWrite && inv.status !== 'void' && !inv.recurringId && (
              <Button variant="ghost" write onClick={() => setModal('recurring')}>
                <Repeat className="size-4" aria-hidden /> Make recurring
              </Button>
            )}
            {inv.can.void && (
              <Button variant="ghost" write onClick={() => setModal('void')}>
                <Ban className="size-4" aria-hidden /> Void
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="relative overflow-x-auto rounded-xl border border-line bg-zinc-100 p-3 sm:p-6 dark:bg-zinc-900">
            <InvoiceDocument inv={inv} className="shadow-sm" />
          </div>
          <aside className="space-y-4">
            <Card>
              <CardHeader title="Balance" />
              <CardBody>
                <dl className="num grid grid-cols-[1fr_auto] gap-y-1.5 text-[0.8125rem]">
                  <dt className="text-muted">Total</dt>
                  <dd className="text-end">{fmtMoney(inv.total, inv.currency)}</dd>
                  <dt className="text-muted">Credited</dt>
                  <dd className="text-end" data-testid="invoice-credited">{fmtMoney(inv.amountCredited, inv.currency)}</dd>
                  <dt className="text-muted">Paid</dt>
                  <dd className="text-end">{fmtMoney(inv.amountPaid, inv.currency)}</dd>
                  <dt className="font-semibold">Balance due</dt>
                  <dd className="text-end font-semibold" data-testid="invoice-balance">{fmtMoney(inv.balanceDue, inv.currency)}</dd>
                  {inv.currency !== inv.baseCurrency && (
                    <>
                      <dt className="text-muted">In {inv.baseCurrency}</dt>
                      <dd className="text-end">{fmtMoney(inv.baseTotal, inv.baseCurrency)}</dd>
                    </>
                  )}
                </dl>
                {(inv.quotationNumber || inv.contractTitle || inv.projectName || inv.eventName || inv.recurringId) && (
                  <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[0.8125rem] text-muted">
                    {inv.quotationNumber && <li>Quotation {inv.quotationId && <Link className="text-brand-700 hover:underline dark:text-brand-300" to={quotationPath(inv.quotationId)}>{inv.quotationNumber}</Link>}{inv.billingPct && inv.billingPct < 100 ? ` · ${inv.billingPct}%` : ''}</li>}
                    {inv.contractTitle && <li>Contract: {inv.contractTitle}</li>}
                    {inv.projectName && <li>Project: {inv.projectName}</li>}
                    {inv.eventName && <li>Event: {inv.eventName}</li>}
                    {inv.recurringId && <li>Recurring schedule {inv.recurringId}</li>}
                  </ul>
                )}
              </CardBody>
            </Card>

            {inv.journal && <JournalCard title="Journal entry" journal={inv.journal} />}
            {inv.voidJournal && <JournalCard title="Void (reversal)" journal={inv.voidJournal} />}

            {inv.creditNotes.length > 0 && (
              <Card>
                <CardHeader title="Credit notes" />
                <CardBody>
                  <ul className="space-y-1.5 text-[0.8125rem]">
                    {inv.creditNotes.map((c) => (
                      <li key={c.id} className="flex justify-between gap-2">
                        <Link className="num text-brand-700 hover:underline dark:text-brand-300" to={`/finance/invoices?tab=credit-notes&credit_note=${encodeURIComponent(c.id)}`}>{c.number}</Link>
                        <span className="num">{fmtMoney(c.total, inv.currency)}</span>
                        <span className="w-full text-xs text-muted">{c.date} · {c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            {inv.zatca && (
              <Card>
                <CardHeader title="ZATCA e-invoicing" description="Phase-2 data, not yet submitted." />
                <CardBody>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">Type</dt>
                    <dd>{inv.zatca.typeCode} · {inv.zatca.subtype === '0100000' ? 'standard (B2B)' : 'simplified (B2C)'}</dd>
                    <dt className="text-muted">UUID</dt>
                    <dd className="font-mono break-all">{inv.zatca.uuid}</dd>
                    <dt className="text-muted">ICV</dt>
                    <dd className="num">{inv.zatca.icv}</dd>
                    <dt className="text-muted">PIH</dt>
                    <dd className="font-mono break-all">{inv.zatca.pih}</dd>
                    <dt className="text-muted">Hash</dt>
                    <dd className="font-mono break-all">{inv.zatca.invoiceHash}</dd>
                    <dt className="text-muted">Status</dt>
                    <dd>Not submitted</dd>
                  </dl>
                  <p className="mt-3 text-xs text-muted">
                    Cryptographic stamping (XAdES), clearance (B2B) and reporting (B2C) with ZATCA need the backend and CSID onboarding. The XML download is the unsigned UBL 2.1 document.
                  </p>
                </CardBody>
              </Card>
            )}
            {!inv.zatca && inv.seller.country === 'AE' && (
              <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-xs text-muted">
                UAE e-invoicing (Peppol PINT AE through an accredited service provider) is planned: the invoice data is kept so it can be sent once the backend connects an ASP.
              </p>
            )}

            {(inv.sendLog.length > 0 || inv.history.length > 0) && (
              <Card>
                <CardHeader title="Activity" />
                <CardBody>
                  <ol className="space-y-2 text-xs">
                    {[...inv.history].reverse().map((h, i) => (
                      <li key={`${h.at}-${i}`} className="flex flex-col">
                        <span className={cn(h.action === 'voided' && 'text-danger-600')}>{h.summary}</span>
                        <span className="text-muted">{h.byName} · {when(h.at)}</span>
                      </li>
                    ))}
                  </ol>
                </CardBody>
              </Card>
            )}
          </aside>
        </div>
      </PageBody>
      <InvoicePrintPortal inv={inv} />
      <VoidModal inv={inv} open={modal === 'void'} onClose={() => setModal(null)} />
      <CreditNoteModal inv={inv} open={modal === 'credit'} onClose={() => setModal(null)} />
      <SendModal inv={inv} open={modal === 'send'} onClose={() => setModal(null)} />
      <RecurringModal inv={inv} open={modal === 'recurring'} onClose={() => setModal(null)} />
    </>
  )
}

function JournalCard({ title, journal }: { title: string; journal: InvoiceJournal }) {
  return (
    <Card data-testid="invoice-journal">
      <CardHeader
        title={title}
        description={`${journal.number} · ${journal.date}${journal.status === 'reversed' ? ' · reversed' : ''}`}
        action={
          <Link className="text-xs text-brand-700 hover:underline dark:text-brand-300" to={`/finance/journal?entry=${encodeURIComponent(journal.id)}`}>
            Open in journal
          </Link>
        }
      />
      <CardBody>
        <table className="w-full text-xs" aria-label={title}>
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-start font-medium">Account</th>
              <th className="py-1 text-end font-medium">Debit</th>
              <th className="py-1 text-end font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {journal.lines.map((l, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{l.accountCode} {l.accountName}</td>
                <td className="num py-1 text-end">{l.debit ? fmtMoney(l.debit) : ''}</td>
                <td className="num py-1 text-end">{l.credit ? fmtMoney(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  )
}
