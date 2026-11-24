import { useMemo, useState } from 'react'
import { Copy, Pencil, Plus } from 'lucide-react'
import type { BudgetDetail, BudgetLine, BudgetStatus, SpreadPattern } from '@/modules/finance/planning/types'
import { BUDGET_STATUS_LABEL, SPREAD_LABEL } from '@/modules/finance/planning/types'
import { planningApi, useBudget, useBudgets, usePlanningMutation } from '@/modules/finance/planning/api'
import { useFinanceScope } from '@/modules/finance/ledger/api'
import { Amount, SimpleTable, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { FinError } from '@/modules/finance/collections/components/bits'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'
import { useNewParam } from '@/shared/hooks/useNewParam'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const monthShort = (ym: string) => `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]}`
export function BudgetStatusBadge({ status }: { status: BudgetStatus }) {
  return <Badge tone={status === 'approved' ? 'green' : 'amber'}>{BUDGET_STATUS_LABEL[status]}</Badge>
}
const compact = (n: number) => (n === 0 ? '—' : Math.round(n).toLocaleString('en-US'))

export function BudgetsTab({ open, onOpen }: { open: string | null; onOpen: (id: string | null) => void }) {
  const q = useBudgets()
  const { isFull } = useFinanceScope()
  const [creating, setCreating] = useState(false)
  useNewParam(() => setCreating(true), { when: isFull })
  const selected = open ?? q.data?.[0]?.id ?? null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] text-muted">One budget per fiscal year: department × account, monthly. Approval by Management locks it.</p>
        {isFull && <Button write onClick={() => setCreating(true)}><Plus />New budget</Button>}
      </div>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-32" /> : !q.data.length ? (
        <EmptyState title="No budgets yet" body="Create one for the fiscal year, from scratch or from last year’s actuals." />
      ) : (
        <SimpleTable label="Budgets" head={<tr><th className={th}>Fiscal year</th><th className={th}>Name</th><th className={th}>Status</th><th className={thEnd}>Expenses</th><th className={thEnd}>Revenue</th><th className={thEnd}>Lines</th></tr>}>
          {q.data.map((b) => (
            <tr key={b.id} className={cn('cursor-pointer hover:bg-hover', b.id === selected && 'bg-brand-50/50 dark:bg-brand-500/10')} onClick={() => onOpen(b.id)}>
              <td className={cn(td, 'num font-medium')}>{b.fiscalYear}</td>
              <td className={td}><button type="button" className="text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => { e.stopPropagation(); onOpen(b.id) }}>{b.name}</button></td>
              <td className={td}><BudgetStatusBadge status={b.status} /></td>
              <td className={tdEnd}><Amount value={b.expenseTotal} currency={b.currency} /></td>
              <td className={tdEnd}><Amount value={b.revenueTotal} blankZero /></td>
              <td className={tdEnd}>{b.lineCount}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {selected && <BudgetEditor id={selected} onDeleted={() => onOpen(null)} />}
      {creating && <CreateModal years={q.data?.map((b) => b.fiscalYear) ?? []} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id) }} />}
    </div>
  )
}

function CreateModal({ years, onClose, onCreated }: { years: number[]; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const cur = new Date().getFullYear()
  const options = [cur - 1, cur, cur + 1, cur + 2].filter((y) => !years.includes(y))
  const [year, setYear] = useState(String(options[0] ?? cur + 1))
  const [name, setName] = useState('')
  const [from, setFrom] = useState(String(cur))
  const [pct, setPct] = useState('0')
  const m = usePlanningMutation(() => planningApi.create({ fiscalYear: Number(year), name: name || undefined, copyFromYear: from ? Number(from) : null, adjustPct: Number(pct) || 0 }))
  return (
    <Modal
      open
      onClose={onClose}
      title="New budget"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write disabled={!options.length} loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (b) => { toast.success('Budget created', `${b.lines.length} lines`); onCreated(b.id) }, onError: (e) => toast.error('Not created', e.message) })}>Create</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="bud-year" label="Fiscal year" required>
          <SelectInput id="bud-year" value={year} onChange={(e) => setYear(e.target.value)}>{options.map((y) => <option key={y} value={y}>{y}</option>)}</SelectInput>
        </Field>
        <Field id="bud-name" label="Name"><TextInput id="bud-name" value={name} placeholder={`Operating budget ${year}`} onChange={(e) => setName(e.target.value)} /></Field>
        <Field id="bud-from" label="Start from actuals of">
          <SelectInput id="bud-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Nothing (empty budget)</option>
            {[cur, cur - 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </SelectInput>
        </Field>
        <Field id="bud-pct" label="Adjust by %" hint="e.g. 5 for +5 %, -10 for −10 %"><TextInput id="bud-pct" type="number" value={pct} disabled={!from} onChange={(e) => setPct(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function BudgetEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const q = useBudget(id)
  const toast = useToast()
  const [editing, setEditing] = useState<BudgetLine | 'new' | null>(null)
  const [copying, setCopying] = useState(false)
  const approve = usePlanningMutation(() => planningApi.approve(id))
  const reopen = usePlanningMutation(() => planningApi.reopen(id))
  const remove = usePlanningMutation(() => planningApi.remove(id))
  const b = q.data
  const groups = useMemo(() => {
    const m = new Map<string, BudgetLine[]>()
    for (const l of b?.lines ?? []) m.set(l.departmentName, [...(m.get(l.departmentName) ?? []), l])
    return [...m]
  }, [b])
  if (q.error) return <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
  if (!b) return <Skeleton className="h-64" />
  return (
    <section className="space-y-3" aria-label={`Budget ${b.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{b.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
            {fmtDate(b.from)} – {fmtDate(b.to)} <BudgetStatusBadge status={b.status} />
            {b.approvedByName && <span>· approved by {b.approvedByName} {fmtDate(b.approvedAt)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.can.edit && <Button variant="secondary" write onClick={() => setCopying(true)}><Copy />Copy actuals</Button>}
          {b.can.edit && <Button variant="secondary" write onClick={() => setEditing('new')}><Plus />Add line</Button>}
          {b.can.delete && <Button variant="ghost" write onClick={() => remove.mutate(undefined, { onSuccess: () => { toast.success('Budget deleted'); onDeleted() }, onError: (e) => toast.error('Not deleted', e.message) })}>Delete</Button>}
          {b.can.reopen && <Button variant="secondary" write loading={reopen.isPending} onClick={() => reopen.mutate(undefined, { onSuccess: () => toast.success('Budget reopened'), onError: (e) => toast.error('Not reopened', e.message) })}>Reopen</Button>}
          {b.status === 'draft' && <Button write disabled={!b.can.approve} title={b.can.approve ? undefined : 'Management or a Company Admin approves (at least one line).'} loading={approve.isPending} onClick={() => approve.mutate(undefined, { onSuccess: () => toast.success('Budget approved and locked'), onError: (e) => toast.error('Not approved', e.message) })}>Approve</Button>}
        </div>
      </div>
      {!b.lines.length ? (
        <EmptyState title="No lines yet" body={b.can.edit ? 'Add lines per department and account, or copy last year’s actuals.' : 'Nothing budgeted.'} />
      ) : (
        <SimpleTable
          label="Budget lines"
          head={<tr><th className={th}>Account</th>{b.months.map((m) => <th key={m} className={thEnd}>{monthShort(m)}</th>)}<th className={thEnd}>Annual</th>{b.can.edit && <th className={th} />}</tr>}
          foot={<tr><td className={td}>Total</td>{b.months.map((m, i) => <td key={m} className={cn(tdEnd, 'num')}>{compact(b.lines.reduce((s, l) => s + (l.accountType === 'expense' ? l.months[i] : 0), 0))}</td>)}<td className={tdEnd}><Amount value={b.expenseTotal} currency={b.currency} /></td>{b.can.edit && <td />}</tr>}
        >
          {groups.map(([dept, lines]) => [
            <tr key={`d-${dept}`} className="bg-sunken/40"><td colSpan={b.months.length + 2 + (b.can.edit ? 1 : 0)} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{dept}</td></tr>,
            ...lines.map((l) => (
              <tr key={l.id} data-line={`${l.departmentId}:${l.accountCode}`}>
                <td className={cn(td, 'whitespace-nowrap')}><span className="num text-muted">{l.accountCode}</span> {l.accountName}{l.accountType === 'income' && <Badge tone="green" className="ms-1">Revenue</Badge>}</td>
                {l.months.map((v, i) => <td key={i} className={cn(tdEnd, 'num text-ink-2')}>{compact(v)}</td>)}
                <td className={tdEnd}><Amount value={l.annual} strong /></td>
                {b.can.edit && <td className={td}><Button variant="ghost" size="xs" iconOnly aria-label={`Edit ${l.accountName}`} onClick={() => setEditing(l)}><Pencil /></Button></td>}
              </tr>
            )),
          ])}
        </SimpleTable>
      )}
      {editing && <LineModal b={b} line={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {copying && <CopyModal b={b} onClose={() => setCopying(false)} />}
    </section>
  )
}

function LineModal({ b, line, onClose }: { b: BudgetDetail; line: BudgetLine | null; onClose: () => void }) {
  const toast = useToast()
  const [dept, setDept] = useState(line?.departmentId ?? b.departments[0]?.id ?? '')
  const [account, setAccount] = useState(line?.accountId ?? b.accounts.find((a) => a.type === 'expense')?.id ?? '')
  const [mode, setMode] = useState<'annual' | 'months'>(line ? 'months' : 'annual')
  const [annual, setAnnual] = useState(line ? String(line.annual) : '')
  const [pattern, setPattern] = useState<SpreadPattern>('even')
  const [months, setMonths] = useState<string[]>(line ? line.months.map(String) : Array(12).fill('0'))
  const m = usePlanningMutation((remove: boolean) =>
    planningApi.putLines(b.id, [remove ? { departmentId: dept, accountId: account, months: Array(12).fill(0) } : mode === 'annual' ? { departmentId: dept, accountId: account, annual: Number(annual) || 0, pattern } : { departmentId: dept, accountId: account, months: months.map((x) => Number(x) || 0) }]),
  )
  const done = (msg: string) => ({ onSuccess: () => { toast.success(msg); onClose() }, onError: (e: Error) => toast.error('Not saved', e.message) })
  return (
    <Modal
      open
      onClose={onClose}
      title={line ? `${line.departmentName} · ${line.accountCode} ${line.accountName}` : 'Add a budget line'}
      footer={
        <>
          {line && <Button variant="ghost" write onClick={() => m.mutate(true, done('Line removed'))}>Remove line</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write disabled={!dept || !account} loading={m.isPending} onClick={() => m.mutate(false, done('Line saved'))}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!line && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="bl-dept" label="Department" required>
              <SelectInput id="bl-dept" value={dept} onChange={(e) => setDept(e.target.value)}>{b.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectInput>
            </Field>
            <Field id="bl-acc" label="Account" required>
              <SelectInput id="bl-acc" value={account} onChange={(e) => setAccount(e.target.value)}>{b.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}{a.type === 'income' ? ' (revenue)' : ''}</option>)}</SelectInput>
            </Field>
          </div>
        )}
        <div className="flex gap-2 text-[0.8125rem]">
          <Button size="sm" variant={mode === 'annual' ? 'primary' : 'secondary'} onClick={() => setMode('annual')}>Annual amount</Button>
          <Button size="sm" variant={mode === 'months' ? 'primary' : 'secondary'} onClick={() => setMode('months')}>Month by month</Button>
        </div>
        {mode === 'annual' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="bl-annual" label={`Annual amount (${b.currency})`} required><TextInput id="bl-annual" type="number" min={0} value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
            <Field id="bl-pattern" label="Spread">
              <SelectInput id="bl-pattern" value={pattern} onChange={(e) => setPattern(e.target.value as SpreadPattern)}>{(Object.keys(SPREAD_LABEL) as SpreadPattern[]).map((p) => <option key={p} value={p}>{SPREAD_LABEL[p]}</option>)}</SelectInput>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {b.months.map((ym, i) => (
              <Field key={ym} id={`bl-m${i}`} label={monthShort(ym)}>
                <TextInput id={`bl-m${i}`} type="number" min={0} value={months[i]} onChange={(e) => setMonths(months.map((x, j) => (j === i ? e.target.value : x)))} />
              </Field>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function CopyModal({ b, onClose }: { b: BudgetDetail; onClose: () => void }) {
  const toast = useToast()
  const [year, setYear] = useState(String(b.fiscalYear - 1))
  const [pct, setPct] = useState('0')
  const [dept, setDept] = useState('')
  const m = usePlanningMutation(() => planningApi.copyActuals(b.id, { fromYear: Number(year), adjustPct: Number(pct) || 0, departmentId: dept || null }))
  return (
    <Modal
      open
      onClose={onClose}
      title="Copy actuals"
      description="Replaces the lines (of one department, or all) with that year’s actuals by department and account, adjusted by the percentage."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (r) => { toast.success('Actuals copied', `${r.lines.length} lines`); onClose() }, onError: (e) => toast.error('Not copied', e.message) })}>Copy</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field id="cp-year" label="Actuals of"><SelectInput id="cp-year" value={year} onChange={(e) => setYear(e.target.value)}>{[b.fiscalYear, b.fiscalYear - 1, b.fiscalYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}</SelectInput></Field>
        <Field id="cp-pct" label="Adjust by %"><TextInput id="cp-pct" type="number" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
        <Field id="cp-dept" label="Department"><SelectInput id="cp-dept" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All</option>{b.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectInput></Field>
      </div>
    </Modal>
  )
}
