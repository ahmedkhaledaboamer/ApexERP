import { Link } from 'react-router-dom'
import { BookOpen, Landmark, LayoutDashboard, Lock, Plus, Receipt, TrendingUp } from 'lucide-react'
import { useFinanceOverview, useFinanceScope } from '@/modules/finance/ledger/api'
import { Amount, EntryLink, SimpleTable, SourceBadge, errMsg, fmtDate, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { StatCard, pctChange } from '@/shared/components/ui/StatCard'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Button } from '@/shared/components/ui/Button'

/**
 * `/finance`: Finance overview — cash and bank balances, receivables (total / overdue, from the invoices), revenue this
 * month vs last, the VAT payable estimate (output − input) and the latest journal entries. Sales Manager: read only.
 */
export default function FinanceOverviewPage() {
  const { isFull } = useFinanceScope()
  const q = useFinanceOverview()
  const o = q.data
  const cur = o?.currency ?? ''
  return (
    <>
      <PageHeader
        icon={<IconTile><LayoutDashboard /></IconTile>}
        title="Finance overview"
        description={o ? `Base currency ${o.currency}${o.lockDate ? ` · books locked up to ${fmtDate(o.lockDate)}` : ''}` : 'Cash, receivables, revenue and VAT at a glance.'}
        actions={
          isFull ? (
            <Link to="/finance/journal?new=1">
              <Button write variant="secondary">
                <Plus className="size-4" aria-hidden /> Journal entry
              </Button>
            </Link>
          ) : undefined
        }
      />
      <PageBody className="space-y-6">
        {q.isError ? (
          <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
        ) : !o ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Cash and bank" icon={<Landmark />} value={<Amount value={o.cashTotal} currency={cur} />} hint={`${o.cash.length} accounts`} to="/finance/accounts" />
              <StatCard
                label="Receivables"
                icon={<Receipt />}
                value={<Amount value={o.receivables.total} currency={cur} />}
                hint={o.receivables.overdueCount ? `${cur} ${fmtMoney(o.receivables.overdue)} overdue · ${o.receivables.overdueCount} invoice${o.receivables.overdueCount === 1 ? '' : 's'}` : `${o.receivables.openCount} open invoice${o.receivables.openCount === 1 ? '' : 's'}, none overdue`}
                alert={o.receivables.overdueCount > 0}
              />
              <StatCard
                label={`Revenue · ${monthName(o.revenue.month)}`}
                icon={<TrendingUp />}
                value={<Amount value={o.revenue.thisMonth} currency={cur} />}
                delta={pctChange(o.revenue.thisMonth, o.revenue.lastMonth)}
                deltaLabel={`vs ${monthName(o.revenue.previousMonth)} (${fmtMoney(o.revenue.lastMonth)})`}
              />
              <StatCard
                label="VAT payable (estimate)"
                icon={<BookOpen />}
                value={<Amount value={o.vat.payable} currency={cur} />}
                hint={`Output ${fmtMoney(o.vat.output)} − input ${fmtMoney(o.vat.input)}`}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_2fr]">
              <Card>
                <CardHeader title="Cash and bank accounts" description="Ledger balances in base currency, today." icon={<Landmark />} />
                <CardBody>
                  <ul className="divide-y divide-line" aria-label="Cash and bank accounts">
                    {o.cash.map((c) => (
                      <li key={c.accountId} className="flex items-center justify-between gap-3 py-2 text-[0.8125rem]">
                        <span className="min-w-0 truncate">
                          <span className="num me-2 text-muted">{c.code}</span>
                          {c.name}
                        </span>
                        <Amount value={c.balance} />
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Latest journal entries"
                  icon={<BookOpen />}
                  action={<Link to="/finance/journal" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">All entries</Link>}
                />
                <CardBody>
                  {o.latest.length === 0 ? (
                    <p className="text-[0.8125rem] text-muted">Nothing posted yet.</p>
                  ) : (
                    <SimpleTable
                      label="Latest journal entries"
                      head={
                        <tr>
                          <th className={th}>Entry</th>
                          <th className={th}>Date</th>
                          <th className={th}>Memo</th>
                          <th className={th}>Source</th>
                          <th className={thEnd}>Amount</th>
                        </tr>
                      }
                    >
                      {o.latest.map((e) => (
                        <tr key={e.id}>
                          <td className={td}><EntryLink id={e.id} number={e.number} /></td>
                          <td className={td}>{fmtDate(e.date)}</td>
                          <td className={td}>{e.memo}</td>
                          <td className={td}><SourceBadge type={e.sourceType} /></td>
                          <td className={tdEnd}><Amount value={e.total} /></td>
                        </tr>
                      ))}
                    </SimpleTable>
                  )}
                </CardBody>
              </Card>
            </div>
            {o.lockDate && (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Lock className="size-3.5" aria-hidden /> No posting on or before {fmtDate(o.lockDate)}.
              </p>
            )}
          </>
        )}
      </PageBody>
    </>
  )
}
