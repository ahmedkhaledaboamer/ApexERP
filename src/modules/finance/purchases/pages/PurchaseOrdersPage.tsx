import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, FilePlus2 } from 'lucide-react'
import type { PoStatus } from '@/modules/finance/purchases/types'
import { APPROVER_LABEL, PO_STATUS_LABEL } from '@/modules/finance/purchases/types'
import { usePurchaseOrders, usePurchasesMeta, usePurchasesScope } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { PoStatusBadge, fmtDay } from '@/modules/finance/purchases/components/bits'
import { PATHS, financePurchaseOrderPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput } from '@/shared/components/form/Field'

type View = 'all' | 'mine' | 'awaiting'

/**
 * `/finance/purchase-orders`: purchase requests and orders. Every employee requests purchases for their own department
 * (self-service) and sees their own; department heads also see their department's and the ones awaiting them; the
 * finance team sees all. ?view=mine|awaiting, ?status=.
 */
export default function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { scope } = usePurchasesScope()
  const meta = usePurchasesMeta()
  const view = (['all', 'mine', 'awaiting'].includes(params.get('view') ?? '') ? params.get('view') : 'all') as View
  const status = params.get('status') ?? ''
  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (v) n.set(k, v)
      else n.delete(k)
      return n
    })
  const list = usePurchaseOrders({ view: view === 'all' ? undefined : view, status: status || undefined })
  const awaiting = usePurchaseOrders({ view: 'awaiting' })
  const rows = list.data ?? []
  const base = meta.data?.baseCurrency ?? ''

  return (
    <>
      <PageHeader
        icon={<IconTile><ClipboardList /></IconTile>}
        title="Purchase orders"
        description="Purchase requests with amount-based approvals, printable orders and goods / service receipts."
        actions={
          <Button write onClick={() => navigate(PATHS.financePurchaseOrderNew)}>
            <FilePlus2 className="size-4" aria-hidden /> New purchase request
          </Button>
        }
      >
        <Tabs
          label="Purchase orders"
          items={[
            { id: 'all' as View, label: scope === 'hidden' ? 'Visible to me' : 'All' },
            { id: 'mine' as View, label: 'My requests' },
            { id: 'awaiting' as View, label: 'Awaiting my approval', count: awaiting.data?.length },
          ]}
          value={view}
          onChange={(v) => set('view', v === 'all' ? '' : v)}
        />
      </PageHeader>
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <SelectInput aria-label="Status" className="w-52" value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="open">Open (approved, not closed)</option>
            {(Object.keys(PO_STATUS_LABEL) as PoStatus[]).map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
          </SelectInput>
          {scope === 'hidden' && <Badge tone="neutral">You see your own requests{meta.data ? ', your department’s (as its head) and approvals' : ''}</Badge>}
        </div>
        {list.isLoading ? (
          <Skeleton className="h-64" />
        ) : list.error ? (
          <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No purchase orders" body={view === 'awaiting' ? 'Nothing is waiting for your approval.' : 'Create a purchase request to get started.'} icon={<ClipboardList />} />
        ) : (
          <SimpleTable
            label="Purchase orders"
            head={
              <tr>
                <th className={th}>Number</th>
                <th className={th}>Supplier</th>
                <th className={th}>Requester</th>
                <th className={th}>Department</th>
                <th className={th}>Date</th>
                <th className={th}>Status</th>
                <th className={th}>Waiting for</th>
                <th className={thEnd}>Total</th>
                <th className={thEnd}>Total ({base})</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-hover/50">
                <td className={td}>
                  <Link to={financePurchaseOrderPath(r.id)} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">{r.number}</Link>
                  {r.awaitingMe && <Badge tone="amber" className="ms-2">Your approval</Badge>}
                </td>
                <td className={td}>{r.vendorName}</td>
                <td className={td}>{r.requesterName}</td>
                <td className={td}>{r.departmentName || '—'}</td>
                <td className={`${td} num whitespace-nowrap`}>{fmtDay(r.orderDate)}</td>
                <td className={td}><PoStatusBadge status={r.status} /></td>
                <td className={td}>{r.pendingStep ? APPROVER_LABEL[r.pendingStep] : '—'}</td>
                <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(r.total)} {r.currency}</td>
                <td className={`${tdEnd} num whitespace-nowrap`}>{fmt2(r.baseTotal)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </PageBody>
    </>
  )
}
