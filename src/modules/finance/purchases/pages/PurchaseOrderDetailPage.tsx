import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ClipboardList, PackageCheck, Pencil, Printer, Receipt, Send, Trash2, X } from 'lucide-react'
import { APPROVER_LABEL, BILL_STATUS_LABEL } from '@/modules/finance/purchases/types'
import { purchasesApi, usePurchaseOrder, usePurchasesMeta, usePurchasesMutation } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, errMsg, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { Facts, HistoryList, PoStatusBadge, ReasonModal, Section, fmtDay } from '@/modules/finance/purchases/components/bits'
import { ApprovalTimeline } from '@/modules/finance/purchases/components/ApprovalTimeline'
import { PATHS, financeBillPath, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { AdvanceDrawer } from '@/modules/finance/purchases/components/Advances'

/** `/finance/purchase-orders/:id`: one PO — lines, approvals, receipts, bills, history and the actions the caller may take. */
export default function PurchaseOrderDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const q = usePurchaseOrder(id)
  const meta = usePurchasesMeta()
  const po = q.data
  const [modal, setModal] = useState<'reject' | 'cancel' | null>(null)
  const [receiving, setReceiving] = useState(false)
  const [payingAdvance, setPayingAdvance] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = usePurchasesMutation(async (a: { kind: 'submit' | 'approve' | 'close' | 'reject' | 'cancel' | 'delete'; reason?: string }) => {
    if (a.kind === 'reject') return purchasesApi.rejectPo(id, a.reason!)
    if (a.kind === 'cancel') return purchasesApi.cancelPo(id, a.reason!)
    if (a.kind === 'delete') return purchasesApi.deletePo(id)
    return purchasesApi.poAction(id, a.kind)
  })
  const run = (kind: 'submit' | 'approve' | 'close' | 'reject' | 'cancel' | 'delete', reason?: string, done?: string) => {
    setError(null)
    act.mutate({ kind, reason }, {
      onSuccess: () => {
        setModal(null)
        if (done) toast.success(done)
        if (kind === 'delete') navigate(PATHS.financePurchaseOrders)
      },
      onError: (e) => setError(errMsg(e)),
    })
  }

  if (q.error) return <PageBody><FinError error={q.error as Error} onRetry={() => void q.refetch()} /></PageBody>
  if (!po) return <PageBody><Skeleton className="h-96" /></PageBody>
  const base = meta.data?.baseCurrency ?? ''

  return (
    <>
      <PageHeader
        icon={<IconTile><ClipboardList /></IconTile>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{po.number}</span>
            <PoStatusBadge status={po.status} />
          </span>
        }
        description={`${po.vendorName} · requested by ${po.requesterName}${po.departmentName ? ` (${po.departmentName})` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={PATHS.financePurchaseOrders} className="inline-flex h-9 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Purchase orders
            </Link>
            <Button variant="secondary" onClick={() => navigate(`${financePurchaseOrderPath(po.id)}/print`)}><Printer className="size-4" aria-hidden /> Print</Button>
            {po.can.edit && <Button variant="secondary" write onClick={() => navigate(`${financePurchaseOrderPath(po.id)}/edit`)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
            {po.can.delete && <Button variant="ghost" write onClick={() => run('delete', undefined, 'Draft deleted')}><Trash2 className="size-4" aria-hidden /> Delete</Button>}
            {po.can.cancel && <Button variant="ghost" write onClick={() => setModal('cancel')}>Cancel order</Button>}
            {po.can.submit && <Button write loading={act.isPending} onClick={() => run('submit', undefined, 'Submitted for approval')}><Send className="size-4" aria-hidden /> Submit for approval</Button>}
            {po.can.reject && <Button variant="danger" write onClick={() => setModal('reject')}><X className="size-4" aria-hidden /> Reject</Button>}
            {po.can.approve && <Button write loading={act.isPending} onClick={() => run('approve', undefined, 'Approved')}><Check className="size-4" aria-hidden /> Approve</Button>}
            {po.can.receive && <Button variant="secondary" write onClick={() => setReceiving(true)}><PackageCheck className="size-4" aria-hidden /> Receive goods</Button>}
            {po.can.bill && <Button variant="secondary" write onClick={() => navigate(`${PATHS.financeBillNew}?po=${encodeURIComponent(po.id)}`)}><Receipt className="size-4" aria-hidden /> Create bill</Button>}
            {po.can.payAdvance && <Button variant="secondary" write onClick={() => setPayingAdvance(true)}>Pay advance</Button>}
            {po.can.close && <Button variant="ghost" write onClick={() => run('close', undefined, 'Order closed')}>Close</Button>}
          </div>
        }
      />
      <PageBody className="space-y-4">
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        {po.rejectionReason && po.status === 'rejected' && <p className="rounded-lg bg-danger-50 p-3 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">Rejected: {po.rejectionReason}</p>}
        {po.cancelReason && <p className="rounded-lg bg-sunken p-3 text-[0.8125rem] text-ink-2">Cancelled: {po.cancelReason}</p>}
        <Section title="Order">
          <Facts
            items={[
              ['Supplier', po.vendorName],
              ['Order date', fmtDay(po.orderDate)],
              ['Expected by', fmtDay(po.expectedDate)],
              ['Currency', po.currency === base || !base ? po.currency : `${po.currency} (rate ${po.exchangeRate})`],
              ['Total', <span key="t" className="num font-semibold">{fmt2(po.total)} {po.currency}</span>],
              ['Total in base', <span key="b" className="num">{fmt2(po.baseTotal)} {base}</span>],
              ['Waiting for', po.pendingStep ? APPROVER_LABEL[po.pendingStep] : '—'],
              ['Delivery address', po.deliveryAddress || '—'],
              ...(po.advancePct
                ? ([['Advance', <span key="adv" className="num">{po.advancePct}% = {fmt2(po.advanceDue)} {po.currency}{po.advances.length ? ` · paid ${fmt2(po.advancePaid)}` : ''}</span>]] as [string, ReactNode][])
                : []),
            ]}
          />
          {po.notes && <p className="mt-3 text-[0.8125rem] text-ink-2">{po.notes}</p>}
        </Section>

        <SimpleTable
          label="Order lines"
          head={
            <tr>
              <th className={th}>Description</th>
              <th className={thEnd}>Qty</th>
              <th className={thEnd}>Received</th>
              <th className={thEnd}>Billed</th>
              <th className={thEnd}>Unit price</th>
              <th className={th}>Tax</th>
              <th className={thEnd}>Total</th>
            </tr>
          }
          foot={
            <tr>
              <td className={td} colSpan={6}>Total (VAT {fmt2(po.taxTotal)})</td>
              <td className={`${tdEnd} num`}>{fmt2(po.total)} {po.currency}</td>
            </tr>
          }
        >
          {po.lines.map((l) => (
            <tr key={l.id}>
              <td className={td}>
                {l.description}
                <span className="block text-xs text-muted">{[meta.data?.accounts.find((a) => a.id === l.accountId)?.name, meta.data?.events.find((e) => e.id === l.eventId)?.name, meta.data?.projects.find((p) => p.id === l.projectId)?.name].filter(Boolean).join(' · ')}</span>
              </td>
              <td className={`${tdEnd} num`}>{l.quantity}</td>
              <td className={`${tdEnd} num`}>{l.receivedQty}</td>
              <td className={`${tdEnd} num`}>{l.billedQty}</td>
              <td className={`${tdEnd} num`}>{fmt2(l.unitPrice)}</td>
              <td className={td}>{l.taxCodeId}</td>
              <td className={`${tdEnd} num`}>{fmt2(l.total)}</td>
            </tr>
          ))}
        </SimpleTable>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section title="Approvals">
            <ApprovalTimeline steps={po.approvals} baseCurrency={base} pending={po.status === 'pending_approval'} />
          </Section>
          <Section title="Receipts">
            {po.receipts.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">Nothing received yet.</p>
            ) : (
              <ul className="space-y-2 text-[0.8125rem]">
                {po.receipts.map((r) => (
                  <li key={r.id}>
                    <span className="num font-medium">{fmtDay(r.date)}</span> · {r.byName}
                    {r.note && <span className="text-muted"> · {r.note}</span>}
                    <span className="block text-xs text-muted">{r.lines.map((x) => `${x.quantity} × ${x.description}`).join('; ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {po.bills.length > 0 && (
            <Section title="Bills">
              <ul className="space-y-1 text-[0.8125rem]">
                {po.bills.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <Link to={financeBillPath(b.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{b.number}</Link>
                    <Badge tone="neutral">{BILL_STATUS_LABEL[b.status]}</Badge>
                    <span className="num ms-auto">{fmt2(b.total)} {po.currency}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="History">
            <HistoryList items={po.history} />
          </Section>
        </div>
      </PageBody>

      <ReasonModal open={modal === 'reject'} title="Reject purchase order" confirm="Reject" onClose={() => setModal(null)} onConfirm={(r) => run('reject', r, 'Rejected')} busy={act.isPending} error={error} />
      <ReasonModal open={modal === 'cancel'} title="Cancel purchase order" confirm="Cancel order" onClose={() => setModal(null)} onConfirm={(r) => run('cancel', r, 'Order cancelled')} busy={act.isPending} error={error} />
      <AdvanceDrawer open={payingAdvance} onClose={() => setPayingAdvance(false)} po={{ id: po.id, number: po.number, vendorId: po.vendorId, currency: po.currency, due: Math.max(0, Math.round((po.advanceDue - po.advancePaid) * 100) / 100) }} />
      <ReceiveDrawer open={receiving} onClose={() => setReceiving(false)} poId={po.id} lines={po.lines} today={meta.data?.today ?? ''} />
    </>
  )
}

function ReceiveDrawer({ open, onClose, poId, lines, today }: { open: boolean; onClose: () => void; poId: string; lines: { id: string; description: string; quantity: number; receivedQty: number }[]; today: string }) {
  const toast = useToast()
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setDate(today)
    setNote('')
    setError(null)
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(Math.max(0, Math.round((l.quantity - l.receivedQty) * 1000) / 1000))])))
  }, [open, lines, today])
  const save = usePurchasesMutation(() => purchasesApi.receivePo(poId, { date, note, lines: lines.map((l) => ({ lineId: l.id, quantity: Number(qty[l.id]) || 0 })).filter((l) => l.quantity > 0) }))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Receive goods / services"
      description="Record what arrived. Bills are matched against received quantities (3-way match)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => {
            setError(null)
            save.mutate(undefined, { onSuccess: () => { toast.success('Receipt recorded'); onClose() }, onError: (e) => setError(errMsg(e)) })
          }}>Confirm receipt</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field id="rcv-date" label="Receipt date"><TextInput id="rcv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {lines.map((l) => (
          <div key={l.id} className="flex items-center gap-3 text-[0.8125rem]">
            <span className="min-w-0 flex-1">{l.description}<span className="block text-xs text-muted">Ordered {l.quantity} · received {l.receivedQty}</span></span>
            <TextInput aria-label={`Receive ${l.description}`} type="number" min="0" step="any" className="num w-28" value={qty[l.id] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [l.id]: e.target.value }))} />
          </div>
        ))}
        <Field id="rcv-note" label="Note"><TextInput id="rcv-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
      </div>
    </Drawer>
  )
}
