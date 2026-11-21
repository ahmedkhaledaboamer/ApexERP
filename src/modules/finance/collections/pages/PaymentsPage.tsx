import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Wallet } from 'lucide-react'
import type { PaymentMethod } from '@/modules/finance/collections/types'
import { MANUAL_METHODS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/modules/finance/collections/types'
import { usePayments, useFinanceScope } from '@/modules/finance/collections/api'
import { RecordPaymentDrawer, PaymentDetailDrawer } from '@/modules/finance/collections/components/PaymentDrawers'
import { LinksTab, PdcTab } from '@/modules/finance/collections/components/PdcLinksTabs'
import { Amount, FinError, PaymentStatusBadge, SimpleTable, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { Tabs } from '@/shared/components/ui/Tabs'

type Tab = 'payments' | 'pdc' | 'links'
const TABS: { id: Tab; label: string }[] = [
  { id: 'payments', label: 'Payments received' },
  { id: 'pdc', label: 'Post-dated cheques' },
  { id: 'links', label: 'Payment links' },
]

/**
 * `/finance/payments`: payments received (record, allocate, refund, void, receipt), post-dated cheques and
 * payment links. Accounting full writes; Sales Manager (view) reads. ?tab=, ?payment= (opens one), ?pdc=,
 * ?record=1&customer=&invoice= (opens the record drawer for an invoice).
 */
export default function PaymentsPage() {
  const { canWrite } = useFinanceScope()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'payments') as Tab
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (v) n.set(k, v)
      else n.delete(k)
      return n
    })
  const recording = params.get('record') === '1'

  return (
    <>
      <PageHeader
        icon={<IconTile><Wallet /></IconTile>}
        title="Payments"
        description="Money received against invoices, customer credit, post-dated cheques and online payment links."
        actions={canWrite && tab === 'payments' ? <Button write onClick={() => set('record', '1')}><Plus /> Record payment</Button> : undefined}
      >
        <Tabs label="Payments" items={TABS} value={tab} onChange={(t) => set('tab', t)} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'payments' && <PaymentsList onOpen={(id) => set('payment', id)} />}
          {tab === 'pdc' && <PdcTab canWrite={canWrite} highlight={params.get('pdc')} />}
          {tab === 'links' && <LinksTab canWrite={canWrite} />}
        </div>
      </PageBody>
      <PaymentDetailDrawer id={params.get('payment')} onClose={() => set('payment', null)} canWrite={canWrite} />
      {canWrite && (
        <RecordPaymentDrawer
          open={recording}
          initialCustomerId={params.get('customer')}
          initialInvoiceId={params.get('invoice')}
          onClose={() =>
            setParams((p) => {
              const n = new URLSearchParams(p)
              n.delete('record')
              n.delete('customer')
              n.delete('invoice')
              return n
            })
          }
          onRecorded={(p) =>
            setParams((prev) => {
              const n = new URLSearchParams(prev)
              n.delete('record')
              n.delete('customer')
              n.delete('invoice')
              n.set('payment', p.id)
              return n
            })
          }
        />
      )}
    </>
  )
}

function PaymentsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = usePayments({ q: q || undefined, method: method || undefined, status: status || undefined, from: from || undefined, to: to || undefined })
  if (list.error) return <FinError error={list.error} onRetry={() => list.refetch()} />
  const rows = list.data ?? []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter payments">
        <SearchInput aria-label="Search payments" placeholder="Receipt, customer, invoice, reference…" value={q} onChange={(e) => setQ(e.target.value)} className="w-72" />
        <SelectInput aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')} className="w-40">
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
        </SelectInput>
        <SelectInput aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-32">
          <option value="">Any status</option>
          <option value="posted">Posted</option>
          <option value="void">Void</option>
        </SelectInput>
        <TextInput aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <TextInput aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>
      {list.isPending ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <EmptyState icon={<Wallet />} title="No payments" body={`Payments by ${MANUAL_METHODS.map((m) => PAYMENT_METHOD_LABEL[m].toLowerCase()).join(', ')} or through a payment link appear here.`} />
      ) : (
        <SimpleTable
          label="Payments received"
          head={
            <tr>
              <th className={th}>Receipt</th>
              <th className={th}>Date</th>
              <th className={th}>Customer</th>
              <th className={th}>Method</th>
              <th className={th}>Invoices</th>
              <th className={thEnd}>Amount</th>
              <th className={thEnd}>Credit</th>
              <th className={th}>Status</th>
            </tr>
          }
        >
          {rows.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(p.id)}>
              <td className={td}>
                <button type="button" className="num font-medium text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(p.id) }}>{p.number}</button>
              </td>
              <td className={td}><span className="num">{fmtDate(p.date)}</span></td>
              <td className={td}>{p.customerName}</td>
              <td className={td}>{PAYMENT_METHOD_LABEL[p.method]}</td>
              <td className={td}><span className="num text-xs">{[...new Set(p.allocations.filter((a) => !a.reversedOn).map((a) => a.invoiceNumber))].join(', ') || '—'}</span></td>
              <td className={tdEnd}><Amount value={p.amount} currency={p.currency} strong /></td>
              <td className={tdEnd}>{p.unallocated > 0 ? <Amount value={p.unallocated} /> : <span className="text-muted">—</span>}</td>
              <td className={td}><PaymentStatusBadge status={p.status} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}
