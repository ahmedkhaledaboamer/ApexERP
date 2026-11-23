import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download, FileInput, FilePlus2, Wallet } from 'lucide-react'
import type { BillPaymentMethod, BillRow, BillStatus } from '@/modules/finance/purchases/types'
import { AP_BUCKETS, AP_BUCKET_LABEL, BILL_PAYMENT_METHOD_LABEL, BILL_STATUS_LABEL } from '@/modules/finance/purchases/types'
import {
  purchasesApi,
  useApAging,
  useBillPayments,
  useBills,
  useDebitNotes,
  useDueBills,
  usePayablesOverview,
  usePurchasesMeta,
  usePurchasesMutation,
  usePurchasesScope,
} from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, downloadText, errMsg, fmt2, td, tdEnd, th, thEnd, toCsv } from '@/modules/finance/collections/components/bits'
import { BillStatusBadge, ReasonModal, fmtDay } from '@/modules/finance/purchases/components/bits'
import { PATHS, financeBillPath, financeBillVoucherPath, financeSupplierStatementPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { PaymentRunsTab } from '@/modules/finance/purchases/components/PaymentRunsTab'
import { AdvancesTab } from '@/modules/finance/purchases/components/Advances'

type Tab = 'bills' | 'payments' | 'runs' | 'advances' | 'debit-notes' | 'payables'
const TABS: { id: Tab; label: string }[] = [
  { id: 'bills', label: 'Bills' },
  { id: 'payments', label: 'Payments' },
  { id: 'runs', label: 'Payment runs' },
  { id: 'advances', label: 'Advances' },
  { id: 'debit-notes', label: 'Debit notes' },
  { id: 'payables', label: 'Payables' },
]
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * `/finance/bills`: supplier bills (filters, multi-select → payment run), bill payments (vouchers, void), debit notes and
 * payables (AP aging by supplier as of a date with CSV export, due this week). ?tab=, ?status=. Sales Managers read only.
 */
export default function BillsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { canWrite } = usePurchasesScope()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'bills') as Tab
  const setTab = (t: Tab) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.set('tab', t)
    return n
  })
  return (
    <>
      <PageHeader
        icon={<IconTile><FileInput /></IconTile>}
        title="Bills"
        description="Supplier bills with PO matching and approvals, payments, debit notes and payables aging."
        actions={canWrite ? (
          <Button write onClick={() => navigate(PATHS.financeBillNew)}><FilePlus2 className="size-4" aria-hidden /> New bill</Button>
        ) : <Badge tone="neutral">View only</Badge>}
      >
        <Tabs label="Bills" items={TABS} value={tab} onChange={setTab} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'bills' && <BillsTab canWrite={canWrite} />}
          {tab === 'payments' && <PaymentsTab canWrite={canWrite} />}
          {tab === 'runs' && <PaymentRunsTab canWrite={canWrite} />}
          {tab === 'advances' && <AdvancesTab canWrite={canWrite} />}
          {tab === 'debit-notes' && <DebitNotesTab canWrite={canWrite} />}
          {tab === 'payables' && <PayablesTab />}
        </div>
      </PageBody>
    </>
  )
}

function BillsTab({ canWrite }: { canWrite: boolean }) {
  const [params, setParams] = useSearchParams()
  const meta = usePurchasesMeta()
  const overview = usePayablesOverview()
  const status = params.get('status') ?? ''
  const vendorId = params.get('vendor') ?? ''
  const overdue = params.get('overdue') === '1'
  const [q, setQ] = useState('')
  const set = (k: string, v: string) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v)
    else n.delete(k)
    return n
  })
  const list = useBills({ status: status || undefined, vendorId: vendorId || undefined, overdue, q: q || undefined })
  const rows = list.data ?? []
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [paying, setPaying] = useState(false)
  const picked = rows.filter((r) => selected[r.id] && (r.status === 'open' || r.status === 'partially_paid'))
  const base = overview.data?.baseCurrency ?? meta.data?.baseCurrency ?? ''
  const o = overview.data

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Open payables (${base})`} value={o ? fmt2(o.openBase) : '…'} hint={o ? `${o.openCount} bill${o.openCount === 1 ? '' : 's'}` : undefined} />
        <StatCard label={`Overdue (${base})`} value={o ? fmt2(o.overdueBase) : '…'} hint={o ? `${o.overdueCount} bill${o.overdueCount === 1 ? '' : 's'}` : undefined} alert={!!o && o.overdueCount > 0} />
        <StatCard label={`Due this week (${base})`} value={o ? fmt2(o.dueThisWeekBase) : '…'} hint={o ? `${o.dueThisWeekCount} bill${o.dueThisWeekCount === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Awaiting approval" value={o ? String(o.pendingBillApprovals) : '…'} hint={o ? `${o.pendingPoApprovals} purchase order${o.pendingPoApprovals === 1 ? '' : 's'}` : undefined} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <SearchInput aria-label="Search bills" placeholder="Number, supplier invoice, supplier" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <SelectInput aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} className="w-48">
          <option value="">All statuses</option>
          <option value="open">Open (unpaid / part paid)</option>
          <option value="awaiting">Awaiting my approval</option>
          {(Object.keys(BILL_STATUS_LABEL) as BillStatus[]).map((s) => <option key={s} value={s}>{BILL_STATUS_LABEL[s]}</option>)}
        </SelectInput>
        <SelectInput aria-label="Supplier" value={vendorId} onChange={(e) => set('vendor', e.target.value)} className="w-56">
          <option value="">All suppliers</option>
          {meta.data?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </SelectInput>
        <label className="flex h-9 items-center gap-2 text-[0.8125rem]">
          <Checkbox checked={overdue} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} /> Overdue only
        </label>
        {canWrite && (
          <Button className="ms-auto" write disabled={picked.length === 0} onClick={() => setPaying(true)}>
            <Wallet className="size-4" aria-hidden /> Pay selected{picked.length ? ` (${picked.length})` : ''}
          </Button>
        )}
      </div>
      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : list.error ? (
        <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No bills" body="Nothing matches these filters." icon={<FileInput />} />
      ) : (
        <SimpleTable
          label="Bills"
          head={
            <tr>
              {canWrite && <th className={th}><span className="sr-only">Select</span></th>}
              <th className={th}>Number</th>
              <th className={th}>Supplier</th>
              <th className={th}>Bill date</th>
              <th className={th}>Due</th>
              <th className={th}>Status</th>
              <th className={thEnd}>Total</th>
              <th className={thEnd}>Balance</th>
              <th className={thEnd}>Balance ({base})</th>
            </tr>
          }
        >
          {rows.map((r) => {
            const payable = r.status === 'open' || r.status === 'partially_paid'
            return (
              <tr key={r.id} className="hover:bg-hover/50">
                {canWrite && (
                  <td className={td}>
                    {payable && <Checkbox aria-label={`Select ${r.number}`} checked={!!selected[r.id]} onChange={(e) => setSelected((s) => ({ ...s, [r.id]: e.target.checked }))} />}
                  </td>
                )}
                <td className={td}>
                  <Link to={financeBillPath(r.id)} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">{r.number}</Link>
                  <span className="block text-xs text-muted">{r.supplierInvoiceNumber}{r.poNumber ? ` · ${r.poNumber}` : ''}{r.matchOk === false ? ' · match differences' : ''}</span>
                  {r.awaitingMe && <Badge tone="amber">Your approval</Badge>}
                </td>
                <td className={td}>{r.vendorName}</td>
                <td className={`${td} num whitespace-nowrap`}>{fmtDay(r.billDate)}</td>
                <td className={`${td} num whitespace-nowrap ${r.overdue ? 'text-danger-600' : ''}`}>
                  {fmtDay(r.dueDate)}
                  {r.overdue && <span className="block text-xs">{r.daysOverdue} days late</span>}
                </td>
                <td className={td}><BillStatusBadge status={r.status} overdue={r.overdue} /></td>
                <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(r.total)} {r.currency}</td>
                <td className={`${tdEnd} num whitespace-nowrap`}>{r.status === 'void' || r.status === 'draft' ? '—' : fmt2(r.balanceDue)}</td>
                <td className={`${tdEnd} num whitespace-nowrap`}>{r.status === 'void' || r.status === 'draft' ? '—' : fmt2(r.baseBalanceDue)}</td>
              </tr>
            )
          })}
        </SimpleTable>
      )}
      <PaymentRunDrawer open={paying} onClose={() => setPaying(false)} bills={picked} onDone={() => setSelected({})} />
    </div>
  )
}

function PaymentRunDrawer({ open, onClose, bills, onDone }: { open: boolean; onClose: () => void; bills: BillRow[]; onDone: () => void }) {
  const toast = useToast()
  const meta = usePurchasesMeta()
  const m = meta.data
  const [date, setDate] = useState('')
  const [account, setAccount] = useState('')
  const [method, setMethod] = useState<BillPaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !m) return
    setDate(m.today)
    setAccount(m.paymentAccounts.find((a) => a.code === '1120')?.id ?? m.paymentAccounts[0]?.id ?? '')
    setMethod('bank_transfer')
    setReference('')
    setAmounts(Object.fromEntries(bills.map((b) => [b.id, String(b.balanceDue)])))
    setError(null)
  }, [open, m, bills])
  const groups = useMemo(() => {
    const g = new Map<string, BillRow[]>()
    for (const b of bills) g.set(`${b.vendorId}|${b.currency}`, [...(g.get(`${b.vendorId}|${b.currency}`) ?? []), b])
    return [...g.values()]
  }, [bills])
  const save = usePurchasesMutation(() => purchasesApi.run({ date, paymentAccountId: account, method, reference, items: bills.map((b) => ({ billId: b.id, amount: Number(amounts[b.id]) || 0 })) }))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Payment run"
      description={`${bills.length} bill${bills.length === 1 ? '' : 's'} · one payment voucher per supplier and currency`}
      width="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => {
            setError(null)
            save.mutate(undefined, {
              onSuccess: (run) => {
                toast.success(`Payment run ${run.number}: ${run.payments.length} voucher${run.payments.length === 1 ? '' : 's'}`)
                onDone()
                onClose()
              },
              onError: (e) => setError(errMsg(e)),
            })
          }}>Pay {bills.length} bill{bills.length === 1 ? '' : 's'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="run-date" label="Payment date"><TextInput id="run-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="run-account" label="Pay from">
            <SelectInput id="run-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              {m?.paymentAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="run-method" label="Method">
            <SelectInput id="run-method" value={method} onChange={(e) => setMethod(e.target.value as BillPaymentMethod)}>
              {(Object.keys(BILL_PAYMENT_METHOD_LABEL) as BillPaymentMethod[]).map((k) => <option key={k} value={k}>{BILL_PAYMENT_METHOD_LABEL[k]}</option>)}
            </SelectInput>
          </Field>
          <Field id="run-ref" label="Reference" hint="Defaults to the run number"><TextInput id="run-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        {groups.map((g) => (
          <div key={`${g[0].vendorId}-${g[0].currency}`} className="rounded-xl border border-line p-3">
            <p className="mb-2 flex justify-between text-[0.8125rem] font-medium">
              <span>{g[0].vendorName}</span>
              <span className="num">{fmt2(r2(g.reduce((s, b) => s + (Number(amounts[b.id]) || 0), 0)))} {g[0].currency}</span>
            </p>
            {g.map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-1 text-[0.8125rem]">
                <span className="num min-w-0 flex-1">{b.number} <span className="text-xs text-muted">· {b.supplierInvoiceNumber} · due {fmtDay(b.dueDate)} · balance {fmt2(b.balanceDue)}</span></span>
                <TextInput aria-label={`Pay ${b.number}`} type="number" min="0" step="0.01" className="num w-32" value={amounts[b.id] ?? ''} onChange={(e) => setAmounts((x) => ({ ...x, [b.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        ))}
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
      </div>
    </Drawer>
  )
}

function PaymentsTab({ canWrite }: { canWrite: boolean }) {
  const list = useBillPayments()
  const toast = useToast()
  const [voiding, setVoiding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const voidIt = usePurchasesMutation((a: { id: string; reason: string }) => purchasesApi.voidPayment(a.id, a.reason))
  if (list.isLoading) return <Skeleton className="h-48" />
  if (list.error) return <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
  const rows = list.data ?? []
  if (!rows.length) return <EmptyState title="No bill payments" body="Pay bills from the Bills tab or a bill." icon={<Wallet />} />
  return (
    <>
      <SimpleTable
        label="Bill payments"
        head={
          <tr>
            <th className={th}>Voucher</th>
            <th className={th}>Supplier</th>
            <th className={th}>Date</th>
            <th className={th}>Paid from</th>
            <th className={th}>Bills</th>
            <th className={th}>Status</th>
            <th className={thEnd}>Amount</th>
            {canWrite && <th className={thEnd}><span className="sr-only">Actions</span></th>}
          </tr>
        }
      >
        {rows.map((p) => (
          <tr key={p.id}>
            <td className={td}><Link to={financeBillVoucherPath(p.id)} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">{p.number}</Link></td>
            <td className={td}>{p.vendorName}</td>
            <td className={`${td} num`}>{fmtDay(p.date)}</td>
            <td className={td}>{p.paymentAccountName}<span className="block text-xs text-muted">{BILL_PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span></td>
            <td className={`${td} text-xs`}>{p.allocations.map((a) => <Link key={a.billId} to={financeBillPath(a.billId)} className="num me-2 text-brand-700 hover:underline dark:text-brand-300">{a.billNumber}</Link>)}</td>
            <td className={td}>{p.status === 'void' ? <Badge tone="neutral">Void</Badge> : <Badge tone="green" variant="dot">Posted</Badge>}</td>
            <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(p.amount)} {p.currency}</td>
            {canWrite && <td className={tdEnd}>{p.status === 'posted' && <Button size="xs" variant="ghost" write onClick={() => setVoiding(p.id)}>Void</Button>}</td>}
          </tr>
        ))}
      </SimpleTable>
      <ReasonModal
        open={!!voiding}
        title="Void payment"
        confirm="Void payment"
        onClose={() => { setVoiding(null); setError(null) }}
        busy={voidIt.isPending}
        error={error}
        onConfirm={(reason) => voidIt.mutate({ id: voiding!, reason }, { onSuccess: () => { toast.success('Payment voided'); setVoiding(null) }, onError: (e) => setError(errMsg(e)) })}
      />
    </>
  )
}

function DebitNotesTab({ canWrite }: { canWrite: boolean }) {
  const list = useDebitNotes()
  const toast = useToast()
  const [voiding, setVoiding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const voidIt = usePurchasesMutation((a: { id: string; reason: string }) => purchasesApi.voidDebitNote(a.id, a.reason))
  if (list.isLoading) return <Skeleton className="h-48" />
  if (list.error) return <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
  const rows = list.data ?? []
  if (!rows.length) return <EmptyState title="No debit notes" body="Record a supplier’s credit from an open bill (Debit note)." icon={<FileInput />} />
  return (
    <>
    <SimpleTable
      label="Debit notes"
      head={<tr><th className={th}>Number</th><th className={th}>Bill</th><th className={th}>Supplier</th><th className={th}>Date</th><th className={th}>Reason</th><th className={thEnd}>VAT</th><th className={thEnd}>Total</th>{canWrite && <th className={thEnd}><span className="sr-only">Actions</span></th>}</tr>}
    >
      {rows.map((d) => (
        <tr key={d.id}>
          <td className={`${td} num font-medium`}>{d.number}{d.status === 'void' && <Badge tone="neutral" className="ms-2">Void</Badge>}</td>
          <td className={td}><Link to={financeBillPath(d.billId)} className="num text-brand-700 hover:underline dark:text-brand-300">{d.billNumber}</Link></td>
          <td className={td}>{d.vendorName}</td>
          <td className={`${td} num`}>{fmtDay(d.date)}</td>
          <td className={td}>{d.reason}</td>
          <td className={`${tdEnd} num`}>{fmt2(d.taxAmount)}</td>
          <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(d.total)} {d.currency}</td>
          {canWrite && <td className={tdEnd}>{d.status !== 'void' && <Button size="xs" variant="ghost" write onClick={() => setVoiding(d.id)}>Void</Button>}</td>}
        </tr>
      ))}
    </SimpleTable>
    <ReasonModal
      open={!!voiding}
      title="Void debit note"
      confirm="Void debit note"
      onClose={() => { setVoiding(null); setError(null) }}
      busy={voidIt.isPending}
      error={error}
      onConfirm={(reason) => voidIt.mutate({ id: voiding!, reason }, { onSuccess: () => { toast.success('Debit note voided: the bill’s balance is back'); setVoiding(null) }, onError: (e) => setError(errMsg(e)) })}
    />
    </>
  )
}

function PayablesTab() {
  const meta = usePurchasesMeta()
  const [asOf, setAsOf] = useState('')
  const aging = useApAging(asOf || undefined)
  const due = useDueBills(7)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const a = aging.data
  const exportCsv = () => {
    if (!a) return
    const rows: (string | number)[][] = [['Supplier', ...AP_BUCKETS.map((b) => AP_BUCKET_LABEL[b]), `Total (${a.baseCurrency})`, 'Unapplied advances', 'Net']]
    for (const r of a.rows) rows.push([r.vendorName, ...AP_BUCKETS.map((b) => r[b].toFixed(2)), r.total.toFixed(2), r.advances.toFixed(2), r.net.toFixed(2)])
    rows.push(['Total', ...AP_BUCKETS.map((b) => a.totals[b].toFixed(2)), a.totals.total.toFixed(2), a.totals.advances.toFixed(2), a.totals.net.toFixed(2)])
    downloadText(`ap-aging-${a.asOf}.csv`, toCsv(rows))
  }
  return (
    <div className="space-y-6">
      <section aria-label="AP aging" className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="me-auto text-base font-semibold text-ink">Aging by supplier</h2>
          <label className="flex flex-col text-xs text-muted">
            As of
            <TextInput type="date" aria-label="As of" value={asOf || meta.data?.today || ''} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
          </label>
          <Button variant="secondary" disabled={!a} onClick={exportCsv}><Download className="size-4" aria-hidden /> Export CSV</Button>
        </div>
        {aging.isLoading ? (
          <Skeleton className="h-48" />
        ) : aging.error ? (
          <FinError error={aging.error as Error} onRetry={() => void aging.refetch()} />
        ) : !a || a.rows.length === 0 ? (
          <EmptyState title="Nothing payable" body="No open supplier balances on this date." icon={<FileInput />} />
        ) : (
          <SimpleTable
            label="AP aging"
            head={<tr><th className={th}>Supplier</th>{AP_BUCKETS.map((b) => <th key={b} className={thEnd}>{AP_BUCKET_LABEL[b]}</th>)}<th className={thEnd}>Total ({a.baseCurrency})</th><th className={thEnd}>Advances</th><th className={thEnd}>Net</th></tr>}
            foot={<tr><td className={td}>Total</td>{AP_BUCKETS.map((b) => <td key={b} className={`${tdEnd} num`}>{fmt2(a.totals[b])}</td>)}<td className={`${tdEnd} num`}>{fmt2(a.totals.total)}</td><td className={`${tdEnd} num`}>{a.totals.advances ? `−${fmt2(a.totals.advances)}` : '—'}</td><td className={`${tdEnd} num`}>{fmt2(a.totals.net)}</td></tr>}
          >
            {a.rows.map((r) => (
              <Fragment key={r.vendorId}>
                <tr>
                  <td className={td}>
                    <button type="button" className="inline-flex items-center gap-1 text-start font-medium text-ink hover:underline" aria-expanded={!!open[r.vendorId]} onClick={() => setOpen((o) => ({ ...o, [r.vendorId]: !o[r.vendorId] }))}>
                      {open[r.vendorId] ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />}
                      {r.vendorName}
                    </button>
                    <Link to={financeSupplierStatementPath(r.vendorId)} className="ms-2 text-xs text-brand-700 hover:underline dark:text-brand-300">Statement</Link>
                  </td>
                  {AP_BUCKETS.map((b) => <td key={b} className={`${tdEnd} num`}>{r[b] ? fmt2(r[b]) : '—'}</td>)}
                  <td className={`${tdEnd} num font-medium`}>{fmt2(r.total)}</td>
                  <td className={`${tdEnd} num`}>{r.advances ? `−${fmt2(r.advances)}` : '—'}</td>
                  <td className={`${tdEnd} num`}>{fmt2(r.net)}</td>
                </tr>
                {open[r.vendorId] && r.bills.map((x) => (
                  <tr key={x.id} className="bg-sunken/40 text-xs">
                    <td className={`${td} ps-9`}>
                      <Link to={financeBillPath(x.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{x.number}</Link>
                      <span className="text-muted"> · {x.supplierInvoiceNumber} · due {fmtDay(x.dueDate)}{x.daysOverdue ? ` · ${x.daysOverdue} days` : ''}</span>
                    </td>
                    {AP_BUCKETS.map((b) => <td key={b} className={`${tdEnd} num`}>{x.bucket === b ? fmt2(x.balanceBase) : ''}</td>)}
                    <td className={`${tdEnd} num`}>{x.currency !== a.baseCurrency ? `${fmt2(x.balance)} ${x.currency}` : ''}</td>
                    <td className={tdEnd} />
                    <td className={tdEnd} />
                  </tr>
                ))}
              </Fragment>
            ))}
          </SimpleTable>
        )}
      </section>

      <section aria-label="Due this week" className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Due this week (and overdue)</h2>
        {due.isLoading ? (
          <Skeleton className="h-32" />
        ) : due.error ? (
          <FinError error={due.error as Error} onRetry={() => void due.refetch()} />
        ) : !due.data?.length ? (
          <p className="text-[0.8125rem] text-muted">Nothing due in the next 7 days.</p>
        ) : (
          <SimpleTable label="Due this week" head={<tr><th className={th}>Bill</th><th className={th}>Supplier</th><th className={th}>Due</th><th className={thEnd}>Balance</th><th className={thEnd}>Balance (base)</th></tr>}>
            {due.data.map((d) => (
              <tr key={d.id}>
                <td className={td}><Link to={financeBillPath(d.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{d.number}</Link><span className="block text-xs text-muted">{d.supplierInvoiceNumber}</span></td>
                <td className={td}>{d.vendorName}</td>
                <td className={`${td} num ${d.overdue ? 'text-danger-600' : ''}`}>{fmtDay(d.dueDate)}{d.overdue && <span className="block text-xs">Overdue</span>}</td>
                <td className={`${tdEnd} num`}>{fmt2(d.balanceDue)} {d.currency}</td>
                <td className={`${tdEnd} num`}>{fmt2(d.baseBalanceDue)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </section>
    </div>
  )
}
