import { Download } from 'lucide-react'
import type { BvaDepartment, BvaStatus } from '@/modules/finance/planning/types'
import { useBudget, useBudgets, useBudgetVsActual } from '@/modules/finance/planning/api'
import { Amount, SimpleTable, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { FinError, downloadText, toCsv } from '@/modules/finance/collections/components/bits'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { cn } from '@/shared/lib/utils'
import { BudgetStatusBadge } from './BudgetsTab'

const STATUS: Record<BvaStatus, { tone: Tone; label: string; bar: string }> = {
  ok: { tone: 'green', label: 'On track', bar: 'bg-brand-500' },
  warning: { tone: 'amber', label: 'Above 90 %', bar: 'bg-warning-500' },
  over: { tone: 'red', label: 'Over budget', bar: 'bg-danger-500' },
}
const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} %`)

function Meter({ label, value }: { label: string; value: number | null }) {
  const w = Math.min(100, Math.max(0, value ?? 0))
  const tone = value === null ? 'ok' : value >= 100 ? 'over' : value >= 90 ? 'warning' : 'ok'
  return (
    <div>
      <div className="flex justify-between text-xs text-muted"><span>{label}</span><span className="num text-ink-2">{pct(value)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
        <div className={cn('h-full rounded-full', STATUS[tone].bar)} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

function DeptCard({ d, currency }: { d: BvaDepartment; currency: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3" data-department={d.departmentId}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-ink">{d.departmentName}</p>
        <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
      </div>
      <Meter label="This month" value={d.monthPct} />
      <Meter label="Year to date" value={d.ytdPct} />
      <p className="text-xs text-muted">YTD <Amount value={d.ytdActual} currency={currency} /> of <Amount value={d.ytdBudget} /></p>
    </div>
  )
}

export function VsActualTab({ budgetId, department, month, onChange }: { budgetId: string | null; department: string | null; month: string | null; onChange: (p: Record<string, string | null>) => void }) {
  const list = useBudgets()
  const cur = new Date().getFullYear()
  const id = budgetId ?? list.data?.find((b) => b.fiscalYear === cur)?.id ?? list.data?.[0]?.id ?? null
  const detail = useBudget(id)
  const q = useBudgetVsActual(id, department, month)
  const r = q.data
  if (list.error) return <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
  if (list.data && !list.data.length) return <EmptyState title="No budget yet" body="Budget vs actual appears once a budget exists for the year." />
  const exportCsv = () => {
    if (!r) return
    const rows: (string | number)[][] = [
      ['Department', 'Account', 'Type', `Budget ${r.month}`, `Actual ${r.month}`, 'Month variance', 'YTD budget', 'YTD actual', 'YTD variance', 'Variance %', 'Used %'],
      ...r.rows.map((x) => [x.departmentName, `${x.accountCode} ${x.accountName}`, x.accountType, x.monthBudget, x.monthActual, x.monthVariance, x.ytdBudget, x.ytdActual, x.variance, x.variancePct ?? '', x.usedPct ?? '']),
    ]
    downloadText(`budget-vs-actual-${r.fiscalYear}-${r.month}.csv`, toCsv(rows))
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="bva-budget" label="Budget">
          <SelectInput id="bva-budget" value={id ?? ''} onChange={(e) => onChange({ budget: e.target.value, month: null, department: null })}>
            {list.data?.map((b) => <option key={b.id} value={b.id}>{b.fiscalYear} · {b.name}</option>)}
          </SelectInput>
        </Field>
        {detail.data && detail.data.departments.length > 1 && (
          <Field id="bva-dept" label="Department">
            <SelectInput id="bva-dept" value={department ?? ''} onChange={(e) => onChange({ department: e.target.value || null })}>
              <option value="">All departments</option>
              {detail.data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectInput>
          </Field>
        )}
        {r && (
          <Field id="bva-month" label="Month">
            <SelectInput id="bva-month" value={r.month} onChange={(e) => onChange({ month: e.target.value })}>
              {r.months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </SelectInput>
          </Field>
        )}
        <div className="ms-auto flex items-center gap-2">
          {r && <BudgetStatusBadge status={r.status} />}
          <Button variant="secondary" disabled={!r} onClick={exportCsv}><Download />Export CSV</Button>
        </div>
      </div>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !r ? <Skeleton className="h-96" /> : (
        <>
          {r.departmentScoped && <p className="text-[0.8125rem] text-muted">You see the department{r.departments.length === 1 ? '' : 's'} you head.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {r.departments.map((d) => <DeptCard key={d.departmentId} d={d} currency={r.currency} />)}
          </div>
          {!r.rows.length ? <EmptyState title="Nothing budgeted or spent" body="No budget lines or department actuals for this selection." /> : (
            <SimpleTable
              label="Budget vs actual"
              head={
                <tr>
                  <th className={th}>Department · account</th>
                  <th className={thEnd}>Budget {monthName(r.month)}</th>
                  <th className={thEnd}>Actual</th>
                  <th className={thEnd}>Variance</th>
                  <th className={thEnd}>YTD budget</th>
                  <th className={thEnd}>YTD actual</th>
                  <th className={thEnd}>YTD variance</th>
                  <th className={thEnd}>Used</th>
                </tr>
              }
              foot={
                <tr>
                  <td className={td}>Expenses total</td>
                  <td className={tdEnd}><Amount value={r.totals.monthExpenseBudget} /></td>
                  <td className={tdEnd}><Amount value={r.totals.monthExpenseActual} /></td>
                  <td className={tdEnd}><Amount value={r.totals.monthExpenseBudget - r.totals.monthExpenseActual} /></td>
                  <td className={tdEnd}><Amount value={r.totals.expenseBudget} /></td>
                  <td className={tdEnd}><Amount value={r.totals.expenseActual} /></td>
                  <td className={tdEnd}><Amount value={r.totals.expenseBudget - r.totals.expenseActual} currency={r.currency} /></td>
                  <td className={tdEnd}>{pct(r.totals.expenseBudget > 0 ? (r.totals.expenseActual / r.totals.expenseBudget) * 100 : null)}</td>
                </tr>
              }
            >
              {r.rows.map((x) => (
                <tr key={`${x.departmentId}-${x.accountId}`} data-row={`${x.departmentId}:${x.accountCode}`}>
                  <td className={td}>
                    <span className="text-muted">{x.departmentName}</span> · <span className="num text-muted">{x.accountCode}</span> {x.accountName}
                    {x.accountType === 'income' && <Badge tone="green" className="ms-1">Revenue</Badge>}
                  </td>
                  <td className={tdEnd}><Amount value={x.monthBudget} blankZero /></td>
                  <td className={tdEnd}><Amount value={x.monthActual} blankZero /></td>
                  <td className={tdEnd}><Amount value={x.monthVariance} /></td>
                  <td className={tdEnd}><Amount value={x.ytdBudget} blankZero /></td>
                  <td className={tdEnd}><Amount value={x.ytdActual} blankZero /></td>
                  <td className={tdEnd}><Amount value={x.variance} strong /></td>
                  <td className={cn(tdEnd, 'num', x.usedPct !== null && x.usedPct >= 100 && x.accountType === 'expense' && 'font-semibold text-danger-600')}>{pct(x.usedPct)}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
          <p className="text-xs text-muted">Variance is favourable when positive (expenses under budget, revenue over). Actuals are journal lines tagged with the department.{r.unassignedExpenseYtd ? ` Expenses without a department this year to date: ${r.unassignedExpenseYtd.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${r.currency}.` : ''}</p>
        </>
      )}
    </div>
  )
}
