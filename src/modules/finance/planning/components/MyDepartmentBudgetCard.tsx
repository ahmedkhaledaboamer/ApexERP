import { Link } from 'react-router-dom'
import { useBudgets, useBudgetVsActual } from '@/modules/finance/planning/api'
import { Amount, monthName } from '@/modules/finance/ledger/components/bits'
import { useFinanceScope } from '@/modules/finance/ledger/api'
import { cn } from '@/shared/lib/utils'

/**
 * "My department budget" (My HR portal slot `budget`): for a department head without accounting access, the month
 * and year-to-date spend of their department against the current year's budget, with a link to the full view.
 * Renders nothing for anyone else (accounting users have Budgets & forecast; others get 403 and see nothing).
 */
export function MyDepartmentBudgetCard() {
  const { scope } = useFinanceScope()
  const list = useBudgets(scope === 'hidden')
  const year = new Date().getFullYear()
  const id = list.data?.find((b) => b.fiscalYear === year)?.id ?? null
  const q = useBudgetVsActual(id, null, null)
  const r = q.data
  if (scope !== 'hidden' || !r || !r.departmentScoped || !r.departments.length) return null
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-label="My department budget">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Department budget · {monthName(r.month)}</h3>
        <Link to={`/finance/planning?tab=vs-actual&budget=${encodeURIComponent(r.budgetId)}`} className="text-[0.8125rem] text-brand-700 hover:underline dark:text-brand-300">Details</Link>
      </div>
      {r.departments.map((d) => (
        <div key={d.departmentId} className="text-[0.8125rem]">
          <p className="font-medium text-ink">{d.departmentName}</p>
          <p className="text-muted">
            This month <Amount value={d.monthActual} currency={r.currency} /> of <Amount value={d.monthBudget} /> ·{' '}
            <span className={cn(d.ytdPct !== null && d.ytdPct >= 100 && 'font-semibold text-danger-600')}>year to date {d.ytdPct === null ? '—' : `${d.ytdPct.toFixed(0)} %`}</span>
          </p>
        </div>
      ))}
    </section>
  )
}
