import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FilePlus2, Receipt, Repeat } from 'lucide-react'
import type { InvoiceStatus } from '@/modules/finance/types'
import { INVOICE_STATUS_LABEL, RECURRING_FREQUENCY_LABEL, type InvoiceRow, type RecurringSchedule } from '@/modules/finance/invoices/types'
import { invoicesApi, useCreditNotes, useInvoiceMeta, useInvoiceMutation, useInvoices, useInvoicesScope, useRecurring } from '@/modules/finance/invoices/api'
import { fmtMoney, round2 } from '@/modules/finance/invoices/calc'
import { FromSourceModal, invoicePath, type SourcePreset } from '@/modules/finance/invoices/components/InvoiceModals'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { StatCard } from '@/shared/components/ui/StatCard'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

type Tab = 'invoices' | 'credit-notes' | 'recurring'
const TABS: { id: Tab; label: string }[] = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'credit-notes', label: 'Credit notes' },
  { id: 'recurring', label: 'Recurring' },
]

const STATUS_TONE: Record<InvoiceStatus, Tone> = { draft: 'neutral', issued: 'blue', partially_paid: 'amber', paid: 'green', void: 'neutral' }

export function InvoiceStatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>
  return <Badge tone={STATUS_TONE[status]}>{INVOICE_STATUS_LABEL[status]}</Badge>
}

const fmtDate = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const th = 'px-3 py-2 text-start font-medium whitespace-nowrap'
const thEnd = 'px-3 py-2 text-end font-medium whitespace-nowrap'
const td = 'px-3 py-2.5 align-top'
const tdEnd = 'px-3 py-2.5 text-end align-top num whitespace-nowrap'

/**
 * `/finance/invoices`: Accounts & finance › Invoices. Tabs: invoices (filters: status, customer, issue-date range,
 * overdue; totals in base currency), credit notes, recurring schedules. ?tab=, ?status=, ?from=quotation|contract|won
 * &id= (opens "invoice a source" prefilled), ?credit_note= (journal links). Sales Managers read only.
 */
export default function InvoicesPage() {
  const [params, setParams] = useSearchParams()
  const { canWrite } = useInvoicesScope()
  const meta = useInvoiceMeta()
  const navigate = useNavigate()
  const tab = ((TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : params.get('credit_note') ? 'credit-notes' : 'invoices') as Tab)
  const setTab = (t: Tab) => setParams((p) => {
    const n = new URLSearchParams(p)
    n.set('tab', t)
    n.delete('credit_note')
    return n
  })
  const fromKind = params.get('from')
  const fromId = params.get('id')
  const preset: SourcePreset | null = fromKind && fromId ? (fromKind === 'quotation' ? { quotationId: fromId } : fromKind === 'contract' ? { contractId: fromId } : { leadId: fromId }) : null
  const [sourceOpen, setSourceOpen] = useState(false)
  const closeSource = () => {
    setSourceOpen(false)
    if (preset) setParams((p) => {
      const n = new URLSearchParams(p)
      n.delete('from')
      n.delete('id')
      return n
    })
  }

  return (
    <>
      <PageHeader
        icon={<IconTile><Receipt /></IconTile>}
        title="Invoices"
        description={
          meta.data
            ? `Tax invoices in ${meta.data.baseCurrency}${meta.data.zatcaEnabled ? ' · ZATCA (FATOORA) e-invoicing data' : ' · UAE VAT'} · VAT no. ${meta.data.vatNumber || 'not set'}`
            : 'Invoices from quotations, contracts and won deals, credit notes and recurring billing.'
        }
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" write onClick={() => setSourceOpen(true)}>
                <Repeat className="size-4" aria-hidden /> From quotation / contract
              </Button>
              <Button write onClick={() => navigate('/finance/invoices/new')}>
                <FilePlus2 className="size-4" aria-hidden /> New invoice
              </Button>
            </div>
          ) : (
            <Badge tone="neutral">View only</Badge>
          )
        }
      >
        <Tabs label="Invoices" items={TABS} value={tab} onChange={setTab} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'invoices' && <InvoicesTab />}
          {tab === 'credit-notes' && <CreditNotesTab highlight={params.get('credit_note')} />}
          {tab === 'recurring' && <RecurringTab canWrite={canWrite} />}
        </div>
      </PageBody>
      <FromSourceModal open={sourceOpen || (!!preset && canWrite)} onClose={closeSource} preset={preset} />
    </>
  )
}

function InvoicesTab() {
  const [params, setParams] = useSearchParams()
  const meta = useInvoiceMeta()
  const status = params.get('status') ?? ''
  const customerId = params.get('customer') ?? ''
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const overdue = params.get('overdue') === '1'
  const set = (k: string, v: string) => setParams((p) => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v)
    else n.delete(k)
    return n
  })
  const list = useInvoices({ status: status || undefined, customerId: customerId || undefined, from: from || undefined, to: to || undefined, overdue, q: q || undefined })
  const rows = list.data ?? []
  const base = meta.data?.baseCurrency ?? ''
  const totals = useMemo(() => {
    const live = rows.filter((r) => r.status !== 'void' && r.status !== 'draft')
    return {
      invoiced: round2(live.reduce((s, r) => s + r.baseTotal, 0)),
      open: round2(live.reduce((s, r) => s + r.baseBalanceDue, 0)),
      overdue: round2(live.filter((r) => r.overdue).reduce((s, r) => s + r.baseBalanceDue, 0)),
      overdueCount: live.filter((r) => r.overdue).length,
      drafts: rows.filter((r) => r.status === 'draft').length,
    }
  }, [rows])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Invoiced (${base})`} value={fmtMoney(totals.invoiced)} hint="Issued, excl. drafts and void" />
        <StatCard label={`Open balance (${base})`} value={fmtMoney(totals.open)} />
        <StatCard label={`Overdue (${base})`} value={fmtMoney(totals.overdue)} hint={`${totals.overdueCount} invoice${totals.overdueCount === 1 ? '' : 's'}`} alert={totals.overdueCount > 0} />
        <StatCard label="Drafts" value={String(totals.drafts)} />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <SearchInput aria-label="Search invoices" placeholder="Number or customer" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />
        <SelectInput aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} className="w-44">
          <option value="">All statuses</option>
          <option value="open">Open (issued / part paid)</option>
          {(Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]).map((s) => (
            <option key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Customer" value={customerId} onChange={(e) => set('customer', e.target.value)} className="w-56">
          <option value="">All customers</option>
          {meta.data?.customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SelectInput>
        <label className="flex flex-col text-xs text-muted">
          From
          <TextInput type="date" aria-label="Issued from" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </label>
        <label className="flex flex-col text-xs text-muted">
          To
          <TextInput type="date" aria-label="Issued to" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </label>
        <label className="flex h-9 items-center gap-2 text-[0.8125rem]">
          <Checkbox checked={overdue} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} /> Overdue only
        </label>
      </div>

      {list.isLoading ? (
        <Skeleton className="h-64" />
      ) : list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No invoices" body="Nothing matches these filters." icon={<Receipt />} />
      ) : (
        <InvoiceTable rows={rows} base={base} />
      )}
    </div>
  )
}

function InvoiceTable({ rows, base }: { rows: InvoiceRow[]; base: string }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-[0.8125rem]" aria-label="Invoices">
        <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
          <tr>
            <th className={th}>Number</th>
            <th className={th}>Customer</th>
            <th className={th}>Issued</th>
            <th className={th}>Due</th>
            <th className={th}>Status</th>
            <th className={thEnd}>Total</th>
            <th className={thEnd}>Balance</th>
            <th className={thEnd}>Balance ({base})</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-hover/50">
              <td className={td}>
                <Link to={invoicePath(r.id)} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">
                  {r.status === 'draft' ? `Draft ${r.id}` : r.number}
                </Link>
                {r.kind === 'simplified' && <span className="ms-1.5 text-[0.6875rem] text-muted">simplified</span>}
                {r.milestone && <span className="block text-xs text-muted">{r.milestone}</span>}
              </td>
              <td className={td}>{r.customerName}</td>
              <td className={cn(td, 'num whitespace-nowrap')}>{fmtDate(r.issueDate)}</td>
              <td className={cn(td, 'num whitespace-nowrap', r.overdue && 'text-danger-600')}>
                {fmtDate(r.dueDate)}
                {r.overdue && <span className="block text-xs">{r.daysOverdue} days late</span>}
              </td>
              <td className={td}><InvoiceStatusBadge status={r.status} overdue={r.overdue} /></td>
              <td className={tdEnd}>{fmtMoney(r.total, r.currency)}</td>
              <td className={tdEnd}>{r.status === 'void' || r.status === 'draft' ? '—' : fmtMoney(r.balanceDue, r.currency)}</td>
              <td className={tdEnd}>{r.status === 'void' || r.status === 'draft' ? '—' : fmtMoney(r.baseBalanceDue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreditNotesTab({ highlight }: { highlight: string | null }) {
  const list = useCreditNotes()
  if (list.isLoading) return <Skeleton className="h-48" />
  if (list.isError) return <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
  const rows = list.data ?? []
  if (rows.length === 0) return <EmptyState title="No credit notes" body="Issue one from an invoice (Credit note)." icon={<Receipt />} />
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-[0.8125rem]" aria-label="Credit notes">
        <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
          <tr>
            <th className={th}>Number</th>
            <th className={th}>Invoice</th>
            <th className={th}>Customer</th>
            <th className={th}>Date</th>
            <th className={th}>Reason</th>
            <th className={thEnd}>Total</th>
            <th className={thEnd}>Customer credit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.id} className={cn(highlight === c.id && 'bg-brand-50/60 dark:bg-brand-500/10')}>
              <td className={cn(td, 'num font-medium')}>{c.number}</td>
              <td className={td}>
                <Link to={invoicePath(c.invoiceId)} className="num text-brand-700 hover:underline dark:text-brand-300">{c.invoiceNumber}</Link>
              </td>
              <td className={td}>{c.customerName}</td>
              <td className={cn(td, 'num')}>{fmtDate(c.date)}</td>
              <td className={td}>{c.reason}</td>
              <td className={tdEnd}>{fmtMoney(c.total, c.currency)}</td>
              <td className={tdEnd}>{c.excessAmount > 0 ? fmtMoney(c.excessAmount, c.currency) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecurringTab({ canWrite }: { canWrite: boolean }) {
  const list = useRecurring()
  const toast = useToast()
  const update = useInvoiceMutation((a: { id: string; status: RecurringSchedule['status'] }) => invoicesApi.updateRecurring(a.id, { status: a.status }))
  if (list.isLoading) return <Skeleton className="h-48" />
  if (list.isError) return <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
  const rows = list.data ?? []
  if (rows.length === 0) return <EmptyState title="No recurring invoices" body="Open an invoice and choose Make recurring, or schedule a monthly contract." icon={<Repeat />} />
  const act = (id: string, status: RecurringSchedule['status']) =>
    update.mutate({ id, status }, { onError: (e) => toast.error('Couldn’t update the schedule', (e as Error).message) })
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-[0.8125rem]" aria-label="Recurring invoices">
        <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
          <tr>
            <th className={th}>Customer</th>
            <th className={th}>Frequency</th>
            <th className={th}>Next</th>
            <th className={th}>Mode</th>
            <th className={th}>Status</th>
            <th className={thEnd}>Amount</th>
            <th className={th}>Generated</th>
            {canWrite && <th className={thEnd}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                {r.customerName}
                <span className="block text-xs text-muted">{r.id}{r.lastError ? ` · ${r.lastError}` : ''}</span>
              </td>
              <td className={td}>{RECURRING_FREQUENCY_LABEL[r.frequency]}</td>
              <td className={cn(td, 'num')}>{fmtDate(r.nextDate)}</td>
              <td className={td}>{r.mode === 'auto_issue' ? 'Issue automatically' : 'Draft for review'}</td>
              <td className={td}><Badge tone={r.status === 'active' ? 'green' : r.status === 'paused' ? 'amber' : 'neutral'}>{r.status}</Badge></td>
              <td className={tdEnd}>{fmtMoney(r.amount, r.template.currency)}</td>
              <td className={td}>
                {r.generated.slice(-3).map((g) => (
                  <Link key={g.invoiceId} to={invoicePath(g.invoiceId)} className="me-2 num text-brand-700 hover:underline dark:text-brand-300">{g.period}</Link>
                ))}
              </td>
              {canWrite && (
                <td className={cn(td, 'text-end whitespace-nowrap')}>
                  {r.status === 'active' && <Button size="xs" variant="ghost" write onClick={() => act(r.id, 'paused')}>Pause</Button>}
                  {r.status === 'paused' && <Button size="xs" variant="ghost" write onClick={() => act(r.id, 'active')}>Resume</Button>}
                  {r.status !== 'ended' && <Button size="xs" variant="ghost" write onClick={() => act(r.id, 'ended')}>End</Button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
