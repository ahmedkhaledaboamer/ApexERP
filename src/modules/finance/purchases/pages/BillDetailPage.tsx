import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, FileInput, Paperclip, Pencil, Send, Trash2, Wallet, X } from 'lucide-react'
import type { Bill, BillPaymentMethod, JournalView } from '@/modules/finance/purchases/types'
import { BILL_PAYMENT_METHOD_LABEL } from '@/modules/finance/purchases/types'
import { purchasesApi, useBill, usePurchasesMeta, usePurchasesMutation } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, errMsg, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { BillStatusBadge, Facts, HistoryList, ReasonModal, Section, fmtDay } from '@/modules/finance/purchases/components/bits'
import { ApprovalTimeline } from '@/modules/finance/purchases/components/ApprovalTimeline'
import { PATHS, financeBillPath, financeBillVoucherPath, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { ApplyAdvanceModal } from '@/modules/finance/purchases/components/Advances'

const MAX_FILE = 512 * 1024
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']

/** `/finance/bills/:id`: one supplier bill — totals, PO match, lines, approvals, journal, payments, debit notes, files. */
export default function BillDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const q = useBill(id)
  const meta = usePurchasesMeta()
  const b = q.data
  const [modal, setModal] = useState<'reject' | 'void' | 'debit' | 'advance' | null>(null)
  const [voidingDn, setVoidingDn] = useState<string | null>(null)
  const voidDn = usePurchasesMutation((a: { id: string; reason: string }) => purchasesApi.voidDebitNote(a.id, a.reason))
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  type Kind = 'submit' | 'post' | 'approve' | 'reject' | 'void' | 'delete'
  const act = usePurchasesMutation(async (a: { kind: Kind; reason?: string }) => {
    if (a.kind === 'reject') return purchasesApi.rejectBill(id, a.reason!)
    if (a.kind === 'void') return purchasesApi.voidBill(id, a.reason!)
    if (a.kind === 'delete') return purchasesApi.deleteBill(id)
    return purchasesApi.billAction(id, a.kind)
  })
  const run = (kind: Kind, reason?: string, done?: string) => {
    setError(null)
    act.mutate({ kind, reason }, {
      onSuccess: () => {
        setModal(null)
        if (done) toast.success(done)
        if (kind === 'delete') navigate(PATHS.financeBills)
      },
      onError: (e) => setError(errMsg(e)),
    })
  }
  const attach = usePurchasesMutation((f: { name: string; mimeType: string; dataUrl: string }) => purchasesApi.attach(id, f))
  const detach = usePurchasesMutation((attachmentId: string) => purchasesApi.detach(id, attachmentId))
  const onFile = (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (!FILE_TYPES.includes(file.type)) return setError('Attach a PDF or an image (PNG, JPEG, WebP).')
    if (file.size > MAX_FILE) return setError('Files can be at most 512 KB.')
    const reader = new FileReader()
    reader.onload = () => attach.mutate({ name: file.name, mimeType: file.type, dataUrl: String(reader.result) }, { onSuccess: () => toast.success('File attached'), onError: (e) => setError(errMsg(e)) })
    reader.readAsDataURL(file)
  }

  if (q.error) return <PageBody><FinError error={q.error as Error} onRetry={() => void q.refetch()} /></PageBody>
  if (!b) return <PageBody><Skeleton className="h-96" /></PageBody>
  const base = meta.data?.baseCurrency ?? ''
  const name = (list: { id: string; name: string }[] | undefined, v: string | null) => (v ? (list?.find((x) => x.id === v)?.name ?? v) : '')

  return (
    <>
      <PageHeader
        icon={<IconTile><FileInput /></IconTile>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{b.number}</span>
            <BillStatusBadge status={b.status} overdue={b.overdue} />
          </span>
        }
        description={`${b.vendorName} · supplier invoice ${b.supplierInvoiceNumber}${b.poNumber ? ` · PO ${b.poNumber}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={PATHS.financeBills} className="inline-flex h-9 items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> Bills
            </Link>
            {b.can.edit && <Button variant="secondary" write onClick={() => navigate(`${financeBillPath(b.id)}/edit`)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
            {b.can.delete && <Button variant="ghost" write onClick={() => run('delete', undefined, 'Draft deleted')}><Trash2 className="size-4" aria-hidden /> Delete</Button>}
            {b.can.submit && <Button variant={b.can.post ? 'secondary' : 'primary'} write loading={act.isPending} onClick={() => run('submit', undefined, 'Submitted')}><Send className="size-4" aria-hidden /> Submit for approval</Button>}
            {b.can.post && <Button write loading={act.isPending} onClick={() => run('post', undefined, 'Bill posted')}>Post bill</Button>}
            {b.can.reject && <Button variant="danger" write onClick={() => setModal('reject')}><X className="size-4" aria-hidden /> Reject</Button>}
            {b.can.approve && <Button write loading={act.isPending} onClick={() => run('approve', undefined, 'Approved')}><Check className="size-4" aria-hidden /> Approve</Button>}
            {b.can.pay && <Button write onClick={() => setPaying(true)}><Wallet className="size-4" aria-hidden /> Record payment</Button>}
            {b.can.applyAdvance && <Button variant="secondary" write onClick={() => setModal('advance')}>Apply advance</Button>}
            {b.can.debitNote && <Button variant="secondary" write onClick={() => setModal('debit')}>Debit note</Button>}
            {b.can.attach && (
              <>
                <Button variant="secondary" write loading={attach.isPending} onClick={() => fileRef.current?.click()}><Paperclip className="size-4" aria-hidden /> Attach file</Button>
                <input ref={fileRef} type="file" className="hidden" accept={FILE_TYPES.join(',')} aria-label="Attach file" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
              </>
            )}
            {b.can.void && <Button variant="ghost" write onClick={() => setModal('void')}>Void</Button>}
          </div>
        }
      />
      <PageBody className="space-y-4">
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        {b.status === 'rejected' && b.rejectionReason && <p className="rounded-lg bg-danger-50 p-3 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10">Rejected: {b.rejectionReason}</p>}
        {b.status === 'void' && b.voidReason && <p className="rounded-lg bg-sunken p-3 text-[0.8125rem] text-ink-2">Void: {b.voidReason}</p>}

        <Section title="Bill">
          <Facts
            items={[
              ['Supplier', b.vendorName],
              ['Supplier VAT no.', b.vendorVatNumber || 'Not VAT registered'],
              ['Bill date', fmtDay(b.billDate)],
              ['Due date', <span key="d" className={b.overdue ? 'text-danger-600' : ''}>{fmtDay(b.dueDate)}{b.overdue ? ` · ${b.daysOverdue} days late` : ''}</span>],
              ['Terms', `${b.termsDays} days`],
              ['Currency', b.currency === base || !base ? b.currency : `${b.currency} (rate ${b.exchangeRate})`],
              ['Entered by', b.requesterName],
              ['Purchase order', b.poId ? <Link key="po" to={financePurchaseOrderPath(b.poId)} className="num text-brand-700 hover:underline dark:text-brand-300">{b.poNumber}</Link> : '—'],
            ]}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[0.8125rem] sm:grid-cols-4 lg:grid-cols-7">
            {([
              ['Subtotal', b.subtotal],
              ['VAT', b.taxTotal],
              ['Recoverable VAT', b.recoverableTax],
              ['Total', b.total],
              ['Paid', b.amountPaid],
              ['Debit notes', b.amountCredited],
              ['Balance', b.balanceDue],
            ] as [string, number][]).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className={`num mt-0.5 ${k === 'Balance' ? 'font-semibold text-ink' : 'text-ink'}`}>{fmt2(v)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">Amounts in {b.currency}{b.currency !== base && base ? ` · balance ${fmt2(b.baseBalanceDue)} ${base}` : ''}</p>
        </Section>

        {b.poId && (
          <Section title="Purchase order match">
            <p className="text-[0.8125rem]">
              <Badge tone={b.match.ok ? 'green' : 'amber'}>{b.match.ok ? 'Matched' : 'Differences'}</Badge>
              <span className="ms-2 text-ink-2">{b.match.kind === 'three_way' ? '3-way (order, receipt, bill)' : '2-way (order, bill)'} · price tolerance {b.match.tolerancePct}%</span>
            </p>
            {b.match.issues.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-[0.8125rem] text-warning-700 dark:text-warning-500">
                {b.match.issues.map((i, n) => <li key={`${i.lineId}-${n}`}>{i.description}: {i.message}</li>)}
              </ul>
            )}
          </Section>
        )}

        <SimpleTable
          label="Bill lines"
          head={
            <tr>
              <th className={th}>Description</th>
              <th className={th}>Account / dimensions</th>
              <th className={thEnd}>Qty</th>
              <th className={thEnd}>Unit price</th>
              <th className={th}>Tax</th>
              <th className={thEnd}>VAT</th>
              <th className={thEnd}>Total</th>
            </tr>
          }
        >
          {b.lines.map((l) => (
            <tr key={l.id}>
              <td className={td}>{l.description}</td>
              <td className={`${td} text-xs text-muted`}>
                {(() => {
                  const a = meta.data?.accounts.find((x) => x.id === l.accountId)
                  return a ? `${a.code} · ${a.name}` : l.accountId
                })()}
                {[name(meta.data?.departments, l.departmentId), name(meta.data?.projects, l.projectId), name(meta.data?.events, l.eventId)].filter(Boolean).map((x) => <span key={x} className="block">{x}</span>)}
              </td>
              <td className={`${tdEnd} num`}>{l.quantity}</td>
              <td className={`${tdEnd} num`}>{fmt2(l.unitPrice)}</td>
              <td className={td}>{l.taxCodeId}{l.taxAmount > 0 && !l.vatRecoverable && <span className="block text-xs text-muted">not recoverable</span>}</td>
              <td className={`${tdEnd} num`}>{fmt2(l.taxAmount)}</td>
              <td className={`${tdEnd} num`}>{fmt2(l.total)}</td>
            </tr>
          ))}
        </SimpleTable>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Approvals">
            <ApprovalTimeline steps={b.approvals} baseCurrency={base} pending={b.status === 'pending_approval'} />
          </Section>
          <Section title="Payments, advances and debit notes">
            {b.payments.length === 0 && b.debitNotes.length === 0 && b.advances.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">None yet.</p>
            ) : (
              <ul className="space-y-1.5 text-[0.8125rem]">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Link to={financeBillVoucherPath(p.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{p.number}</Link>
                    <span className="text-muted">{fmtDay(p.date)}</span>
                    {p.status === 'void' && <Badge tone="neutral">Void</Badge>}
                    <span className="num ms-auto">{fmt2(p.amount)} {b.currency}</span>
                  </li>
                ))}
                {b.advances.map((x, i) => (
                  <li key={`${x.advanceId}-${i}`} className="flex items-center gap-2">
                    <span className="num font-medium">{x.number}</span>
                    <span className="text-muted">{fmtDay(x.date)} · advance applied</span>
                    <span className="num ms-auto">{fmt2(x.amount)} {b.currency}</span>
                  </li>
                ))}
                {b.debitNotes.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <span className="num font-medium">{d.number}</span>
                    <span className="text-muted">{fmtDay(d.date)} · {d.reason}</span>
                    {d.status === 'void' && <Badge tone="neutral">Void</Badge>}
                    {d.canVoid && <Button size="xs" variant="ghost" write onClick={() => setVoidingDn(d.id)}>Void</Button>}
                    <span className="num ms-auto">{fmt2(d.total)} {b.currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Attachments">
            {b.attachments.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">No files. Attach the supplier’s invoice (PDF or image, up to 512 KB).</p>
            ) : (
              <ul className="space-y-1.5 text-[0.8125rem]">
                {b.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <a href={a.dataUrl} download={a.name} className="text-brand-700 hover:underline dark:text-brand-300">{a.name}</a>
                    <span className="text-xs text-muted">{Math.ceil(a.sizeBytes / 1024)} KB · {a.uploadedByName}</span>
                    {b.can.attach && (
                      <Button variant="ghost" size="xs" iconOnly write aria-label={`Remove ${a.name}`} className="ms-auto" onClick={() => detach.mutate(a.id, { onError: (e) => setError(errMsg(e)) })}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="History">
            <HistoryList items={b.history} />
          </Section>
        </div>

        {b.journal && <JournalTable title={`Journal entry ${b.journal.number}`} j={b.journal} />}
        {b.voidJournal && <JournalTable title={`Reversal ${b.voidJournal.number}`} j={b.voidJournal} />}
      </PageBody>

      <ReasonModal open={modal === 'reject'} title="Reject bill" confirm="Reject" onClose={() => setModal(null)} onConfirm={(r) => run('reject', r, 'Rejected')} busy={act.isPending} error={error} />
      <ReasonModal open={modal === 'void'} title="Void bill" confirm="Void bill" onClose={() => setModal(null)} onConfirm={(r) => run('void', r, 'Bill voided')} busy={act.isPending} error={error} />
      <DebitNoteModal open={modal === 'debit'} onClose={() => setModal(null)} bill={b} today={meta.data?.today ?? ''} />
      <ApplyAdvanceModal open={modal === 'advance'} onClose={() => setModal(null)} billId={b.id} balance={b.balanceDue} advances={b.unappliedAdvances} />
      <ReasonModal
        open={!!voidingDn}
        title="Void debit note"
        confirm="Void debit note"
        onClose={() => setVoidingDn(null)}
        busy={voidDn.isPending}
        error={error}
        onConfirm={(reason) => voidDn.mutate({ id: voidingDn!, reason }, { onSuccess: () => { toast.success('Debit note voided'); setVoidingDn(null) }, onError: (e) => setError(errMsg(e)) })}
      />
      <PayDrawer open={paying} onClose={() => setPaying(false)} bill={b} />
    </>
  )
}

function JournalTable({ title, j }: { title: string; j: JournalView }) {
  return (
    <Section title={title}>
      <p className="mb-2 text-xs text-muted">{fmtDay(j.date)} · {j.memo}{j.status === 'reversed' ? ' · reversed' : ''}</p>
      <SimpleTable label={title} head={<tr><th className={th}>Account</th><th className={th}>Description</th><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th></tr>}>
        {j.lines.map((l, i) => (
          <tr key={i}>
            <td className={td}><span className="num">{l.accountCode}</span> {l.accountName}</td>
            <td className={td}>{l.description}</td>
            <td className={`${tdEnd} num`}>{l.debit ? fmt2(l.debit) : ''}</td>
            <td className={`${tdEnd} num`}>{l.credit ? fmt2(l.credit) : ''}</td>
          </tr>
        ))}
      </SimpleTable>
    </Section>
  )
}

function DebitNoteModal({ open, onClose, bill, today }: { open: boolean; onClose: () => void; bill: Bill; today: string }) {
  const toast = useToast()
  const [date, setDate] = useState(today)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setDate(today)
    setReason('')
    setAmount('')
    setError(null)
  }, [open, today])
  const save = usePurchasesMutation(() => purchasesApi.createDebitNote({ billId: bill.id, date, reason, amount: Number(amount) }))
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Debit note"
      description={`A credit from the supplier against this bill (gross, incl. VAT; at most ${fmt2(bill.balanceDue)} ${bill.currency}).`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Debit note recorded'); onClose() }, onError: (e) => setError(errMsg(e)) })}>Record debit note</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="dn-date" label="Date"><TextInput id="dn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="dn-amount" label={`Amount (${bill.currency})`}><TextInput id="dn-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field id="dn-reason" label="Reason"><TextInput id="dn-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
      </div>
    </Modal>
  )
}

function PayDrawer({ open, onClose, bill }: { open: boolean; onClose: () => void; bill: Bill }) {
  const toast = useToast()
  const meta = usePurchasesMeta()
  const m = meta.data
  const [date, setDate] = useState('')
  const [account, setAccount] = useState('')
  const [method, setMethod] = useState<BillPaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [charges, setCharges] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !m) return
    setDate(m.today)
    setAccount(m.paymentAccounts.find((a) => a.code === '1120')?.id ?? m.paymentAccounts[0]?.id ?? '')
    setMethod('bank_transfer')
    setReference('')
    setAmount(String(bill.balanceDue))
    setRate('')
    setCharges('')
    setError(null)
  }, [open, m, bill.balanceDue])
  const foreign = !!m && bill.currency !== m.baseCurrency
  const save = usePurchasesMutation(() =>
    purchasesApi.pay({
      vendorId: bill.vendorId,
      date,
      paymentAccountId: account,
      method,
      reference,
      exchangeRate: foreign && rate ? Number(rate) : null,
      bankCharges: Number(charges) || 0,
      allocations: [{ billId: bill.id, amount: Number(amount) }],
    }),
  )
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record payment"
      description={`${bill.vendorName} · balance ${fmt2(bill.balanceDue)} ${bill.currency}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => {
            setError(null)
            save.mutate(undefined, { onSuccess: (p) => { toast.success(`Payment ${p.number} recorded`); onClose() }, onError: (e) => setError(errMsg(e)) })
          }}>Record payment</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pay-date" label="Payment date"><TextInput id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="pay-account" label="Pay from">
          <SelectInput id="pay-account" value={account} onChange={(e) => setAccount(e.target.value)}>
            {m?.paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="pay-method" label="Method">
          <SelectInput id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}>
            {(Object.keys(BILL_PAYMENT_METHOD_LABEL) as BillPaymentMethod[]).map((k) => <option key={k} value={k}>{BILL_PAYMENT_METHOD_LABEL[k]}</option>)}
          </SelectInput>
        </Field>
        <Field id="pay-ref" label="Reference"><TextInput id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field id="pay-amount" label={`Amount (${bill.currency})`}><TextInput id="pay-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {foreign && (
          <Field id="pay-rate" label={`Rate to ${m?.baseCurrency}`} hint={`Bill rate ${bill.exchangeRate}; default from Finance settings`}>
            <TextInput id="pay-rate" type="number" step="any" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        )}
        <Field id="pay-charges" label={`Bank charges (${m?.baseCurrency ?? ''})`}><TextInput id="pay-charges" type="number" min="0" step="0.01" value={charges} onChange={(e) => setCharges(e.target.value)} /></Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600 sm:col-span-2">{error}</p>}
      </div>
    </Drawer>
  )
}
