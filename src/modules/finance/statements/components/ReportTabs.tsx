import { Fragment, useMemo, useState } from 'react'
import { CheckCircle2, TriangleAlert, BookOpen } from 'lucide-react'
import { Amount, EntryLink, SimpleTable, SourceBadge, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { ACCOUNT_TYPE_LABEL } from '@/modules/finance/types'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { cn } from '@/shared/lib/utils'
import { useBalanceSheet, useCashFlow, useGeneralLedger, useProfitAndLoss, useTbCompare, type GlQuery, type PeriodQuery } from '../api'
import type { CashFlowLine, CompareKind, PnlSectionId, StatementDims, StatementsMeta } from '../types'
import { balanceSheetSheet, cashFlowSheet, generalLedgerSheet, pnlSheet, trialBalanceSheet } from '../exports'
import { ExportBar, Letterhead, PctCell, PeriodPicker, SectionRow, TotalRow, cellLabel, cellNum } from './bits'

/** The five report tabs of Financial statements: P&L, balance sheet, cash flow, general ledger, trial balance. */

const subtitleOf = (meta: StatementsMeta, text: string) => `${text} · ${meta.currency}`

/* ================= profit and loss ================= */

interface Drill {
  accountId: string
  label: string
  from: string
  to: string
  dims: StatementDims
}

export function ProfitAndLossTab({ meta }: { meta: StatementsMeta }) {
  const [period, setPeriod] = useState<PeriodQuery>({ period: 'ytd' })
  const [compare, setCompare] = useState<CompareKind[]>(['previous_period'])
  const [view, setView] = useState<'period' | 'monthly'>('period')
  const [dims, setDims] = useState<StatementDims>({})
  const [drill, setDrill] = useState<Drill | null>(null)
  const ready = period.period !== 'custom' || !!period.from
  const q = useProfitAndLoss({ ...period, compare, view, dims }, ready)
  const s = q.data
  const sheet = useMemo(() => (s ? pnlSheet(s) : null), [s])
  const span = s ? 1 + s.columns.length + (s.view === 'period' ? s.columns.length - 1 : 0) : 1
  const toggle = (k: CompareKind) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]))
  const dimSelect = (key: keyof StatementDims, label: string, options: { id: string; name: string }[]) => (
    <Field id={`pl-${key}`} label={label}>
      <SelectInput id={`pl-${key}`} value={dims[key] ?? ''} onChange={(e) => setDims({ ...dims, [key]: e.target.value || null })}>
        <option value="">All</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </SelectInput>
    </Field>
  )
  const filterText = s ? [s.dimNames.department, s.dimNames.project, s.dimNames.event, s.dimNames.customer].filter(Boolean).join(' · ') : ''
  const subtitle = s ? subtitleOf(meta, `${s.columns[0].label}${s.view === 'monthly' ? ' (monthly)' : ''}${filterText ? ` · ${filterText}` : ''}`) : ''
  const amountRow = (vals: number[]) => (
    <>
      {vals.map((v, i) => <td key={i} className={cellNum}><Amount value={v} /></td>)}
      {s?.view === 'period' && vals.slice(1).map((v, i) => <PctCell key={`p${i}`} now={vals[0]} before={v} />)}
    </>
  )
  const section = (id: PnlSectionId) => {
    const sec = s!.sections.find((x) => x.id === id)!
    return (
      <Fragment key={id}>
        <SectionRow label={sec.label} span={span} />
        {sec.lines.length === 0 && (
          <tr><td colSpan={span} className={cn(cellLabel, 'text-xs text-subtle')}>Nothing posted.</td></tr>
        )}
        {sec.lines.map((l) => (
          <tr key={l.accountId}>
            <td className={cellLabel}>
              <button
                type="button"
                className="text-start hover:text-brand-700 hover:underline dark:hover:text-brand-300"
                onClick={() => setDrill({ accountId: l.accountId, label: `${l.code} ${l.name}`, from: s!.columns[0].from!, to: s!.columns[s!.view === 'monthly' ? s!.columns.length - 1 : 0].to, dims })}
              >
                <span className="num me-2 text-muted">{l.code}</span>{' '}{l.name}
              </button>
            </td>
            {amountRow(l.amounts)}
          </tr>
        ))}
        <TotalRow label={`Total ${sec.label.toLowerCase()}`}>{amountRow(sec.totals)}</TotalRow>
      </Fragment>
    )
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <PeriodPicker id="pl" value={period} onChange={setPeriod} today={meta.today} />
        <Field id="pl-view" label="View">
          <SelectInput id="pl-view" value={view} onChange={(e) => setView(e.target.value as 'period' | 'monthly')}>
            <option value="period">Period</option>
            <option value="monthly">12-month trend</option>
          </SelectInput>
        </Field>
        {view === 'period' && (
          <fieldset className="flex items-center gap-3 pb-2 text-[0.8125rem]">
            <legend className="sr-only">Compare with</legend>
            <label className="inline-flex items-center gap-1.5"><Checkbox checked={compare.includes('previous_period')} onChange={() => toggle('previous_period')} /> Previous period</label>
            <label className="inline-flex items-center gap-1.5"><Checkbox checked={compare.includes('last_year')} onChange={() => toggle('last_year')} /> Last year</label>
          </fieldset>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          {dimSelect('departmentId', 'Department', meta.departments)}
          {dimSelect('projectId', 'Project', meta.projects)}
          {dimSelect('eventId', 'Event', meta.events)}
          {dimSelect('customerId', 'Customer', meta.customers)}
        </div>
        <ExportBar sheet={sheet} fileBase={`profit-and-loss-${s?.columns[0].to ?? meta.today}`} subtitle={subtitle} />
      </div>
      <Letterhead lh={meta.letterhead} title="Profit and loss" subtitle={subtitle} />
      {!ready ? (
        <p className="text-[0.8125rem] text-muted">Choose the start of the custom period.</p>
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[0.8125rem]" aria-label="Profit and loss">
            <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
              <tr>
                <th className={th}>{s.currency}</th>
                {s.columns.map((c) => <th key={c.key} className={thEnd}>{c.label}</th>)}
                {s.view === 'period' && s.columns.slice(1).map((c) => <th key={`p-${c.key}`} className={thEnd}>% vs {c.key === 'last_year' ? 'last year' : 'previous'}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {section('revenue')}
              {section('cost_of_sales')}
              <TotalRow label="Gross profit" tone="brand">{amountRow(s.totals.grossProfit)}</TotalRow>
              {section('operating_expenses')}
              <TotalRow label="Operating profit" tone="brand">{amountRow(s.totals.operatingProfit)}</TotalRow>
              {section('other_income')}
              {section('other_expenses')}
              <TotalRow label="Net profit" strong tone="brand">{amountRow(s.totals.netProfit)}</TotalRow>
            </tbody>
          </table>
        </div>
      )}
      {s && <p className="text-xs text-muted print:hidden">From the journal only (base currency). Year-end closing entries are left out, so a closed year still shows its activity. Click a line for its entries.</p>}
      <AccountDrill drill={drill} onClose={() => setDrill(null)} />
    </div>
  )
}

/** A P&L line's journal lines over the period (closing entries left out), with links to the entries. */
function AccountDrill({ drill, onClose }: { drill: Drill | null; onClose: () => void }) {
  const q = useGeneralLedger({ from: drill?.from, to: drill?.to, accountId: drill?.accountId, dims: drill?.dims, excludeClosing: true }, !!drill)
  const led = q.data?.accounts[0]
  return (
    <Drawer open={!!drill} onClose={onClose} width="xl" title={drill ? `Account activity: ${drill.label}` : 'Account activity'} description={drill ? `${fmtDate(drill.from)} – ${fmtDate(drill.to)}` : undefined}>
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} />
      ) : !q.data ? (
        <Skeleton className="h-64" />
      ) : !led || led.rows.length === 0 ? (
        <EmptyState title="No lines" body="Nothing posted to this account in the period." icon={<BookOpen />} />
      ) : (
        <SimpleTable
          label="Account activity"
          head={<tr><th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Memo</th><th className={th}>Source</th><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th></tr>}
          foot={<tr><td className={td} colSpan={4}>Total</td><td className={tdEnd}><Amount value={led.totals.debit} /></td><td className={tdEnd}><Amount value={led.totals.credit} /></td></tr>}
        >
          {led.rows.map((r, i) => (
            <tr key={`${r.entryId}-${i}`}>
              <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.date)}</td>
              <td className={td}><EntryLink id={r.entryId} number={r.number} /></td>
              <td className={td}>{r.memo}{r.description && r.description !== r.memo && <span className="block text-xs text-muted">{r.description}</span>}</td>
              <td className={td}><SourceBadge type={r.sourceType} /></td>
              <td className={tdEnd}><Amount value={r.debit} blankZero /></td>
              <td className={tdEnd}><Amount value={r.credit} blankZero /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </Drawer>
  )
}

/* ================= balance sheet ================= */

const prevFyEnd = (meta: StatementsMeta) => {
  const d = new Date(`${meta.fiscalYearStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function BalanceSheetTab({ meta }: { meta: StatementsMeta }) {
  const [asOf, setAsOf] = useState(meta.today)
  const [compareTo, setCompareTo] = useState(prevFyEnd(meta))
  const q = useBalanceSheet(asOf || undefined, compareTo || undefined)
  const s = q.data
  const sheet = useMemo(() => (s ? balanceSheetSheet(s) : null), [s])
  const span = 1 + (s?.columns.length ?? 1)
  const vals = (v: number[]) => v.map((x, i) => <td key={i} className={cellNum}><Amount value={x} /></td>)
  const subtitle = s ? subtitleOf(meta, `As of ${s.columns.map((c) => c.label).join(' vs ')}`) : ''
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="bs-asof" label="As of"><TextInput id="bs-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
          <Field id="bs-compare" label="Compare to"><TextInput id="bs-compare" type="date" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} /></Field>
          {s && <BalancedBadge ok={s.balanced} text={s.balanced ? 'Balanced' : `Out of balance by ${s.totals.difference.find((d) => d !== 0) ?? 0}`} />}
        </div>
        <ExportBar sheet={sheet} fileBase={`balance-sheet-${s?.columns[0].to ?? meta.today}`} subtitle={subtitle} />
      </div>
      <Letterhead lh={meta.letterhead} title="Balance sheet" subtitle={subtitle} />
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[0.8125rem]" aria-label="Balance sheet">
            <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
              <tr><th className={th}>{s.currency}</th>{s.columns.map((c) => <th key={c.key} className={thEnd}>{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(['assets', 'liabilities', 'equity'] as const).map((g) => (
                <Fragment key={g}>
                  {s.sections.filter((x) => x.group === g && (x.lines.length || x.id !== 'other_assets')).map((sec) => (
                    <Fragment key={sec.id}>
                      <SectionRow label={sec.label} span={span} />
                      {sec.lines.map((l) => (
                        <tr key={l.key}>
                          <td className={cn(cellLabel, l.kind !== 'account' && 'italic')}>{l.code && <span className="num me-2 text-muted">{l.code}</span>}{l.name}</td>
                          {vals(l.amounts)}
                        </tr>
                      ))}
                      <TotalRow label={`Total ${sec.label.toLowerCase()}`}>{vals(sec.totals)}</TotalRow>
                    </Fragment>
                  ))}
                  <TotalRow label={`Total ${g}`} tone="brand">{vals(s.totals[g])}</TotalRow>
                </Fragment>
              ))}
              <TotalRow label="Total liabilities and equity" strong tone="brand">{vals(s.totals.liabilitiesAndEquity)}</TotalRow>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BalancedBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className="pb-2 text-[0.8125rem]" role="status">
      {ok ? (
        <span className="inline-flex items-center gap-1 text-success-700 dark:text-success-500"><CheckCircle2 className="size-4" aria-hidden /> {text}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-danger-600"><TriangleAlert className="size-4" aria-hidden /> {text}</span>
      )}
    </p>
  )
}

/* ================= cash flow ================= */

export function CashFlowTab({ meta }: { meta: StatementsMeta }) {
  const [period, setPeriod] = useState<PeriodQuery>({ period: 'ytd' })
  const ready = period.period !== 'custom' || !!period.from
  const q = useCashFlow(period, ready)
  const s = q.data
  const sheet = useMemo(() => (s ? cashFlowSheet(s) : null), [s])
  const subtitle = s ? subtitleOf(meta, `${fmtDate(s.from)} – ${fmtDate(s.to)}`) : ''
  const lines = (ls: CashFlowLine[], indent = false) =>
    ls.map((l) => (
      <tr key={l.accountId}>
        <td className={cn(cellLabel, indent && 'ps-8')}><span className="num me-2 text-muted">{l.code}</span>{l.name}</td>
        <td className={cellNum}><Amount value={l.amount} /></td>
      </tr>
    ))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <PeriodPicker id="cf" value={period} onChange={setPeriod} today={meta.today} />
          {s && <BalancedBadge ok={s.reconciles} text={s.reconciles ? 'Reconciles to cash and bank' : `Does not reconcile (${s.check})`} />}
        </div>
        <ExportBar sheet={sheet} fileBase={`cash-flow-${s?.to ?? meta.today}`} subtitle={subtitle} />
      </div>
      <Letterhead lh={meta.letterhead} title="Cash flow statement" subtitle={subtitle} />
      {!ready ? (
        <p className="text-[0.8125rem] text-muted">Choose the start of the custom period.</p>
      ) : q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[0.8125rem]" aria-label="Cash flow statement">
            <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
              <tr><th className={th}>Indirect method</th><th className={thEnd}>{s.currency}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              <SectionRow label="Operating activities" span={2} />
              <tr><td className={cellLabel}>Net profit</td><td className={cellNum}><Amount value={s.operating.netProfit} /></td></tr>
              {s.operating.adjustments.length > 0 && <tr><td colSpan={2} className={cn(cellLabel, 'text-xs text-muted')}>Adjustments for non-cash items</td></tr>}
              {lines(s.operating.adjustments, true)}
              {s.operating.workingCapital.length > 0 && <tr><td colSpan={2} className={cn(cellLabel, 'text-xs text-muted')}>Changes in working capital</td></tr>}
              {lines(s.operating.workingCapital, true)}
              <TotalRow label="Net cash from operating activities"><td className={cellNum}><Amount value={s.operating.total} /></td></TotalRow>
              <SectionRow label="Investing activities" span={2} />
              {lines(s.investing.lines)}
              <TotalRow label="Net cash from investing activities"><td className={cellNum}><Amount value={s.investing.total} /></td></TotalRow>
              <SectionRow label="Financing activities" span={2} />
              {lines(s.financing.lines)}
              <TotalRow label="Net cash from financing activities"><td className={cellNum}><Amount value={s.financing.total} /></td></TotalRow>
              <TotalRow label="Net change in cash and bank" strong tone="brand"><td className={cellNum}><Amount value={s.netChange} /></td></TotalRow>
              <tr><td className={cellLabel}>Cash and bank at the start</td><td className={cellNum}><Amount value={s.openingCash} /></td></tr>
              <tr><td className={cellLabel}>Cash and bank at the end</td><td className={cellNum}><Amount value={s.closingCash} /></td></tr>
              <tr aria-label="Check line" className={s.reconciles ? '' : 'bg-danger-50'}>
                <td className={cellLabel}>Check: net change − (end − start), should be 0</td>
                <td className={cellNum} data-testid="cash-flow-check"><Amount value={s.check} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {s && <p className="text-xs text-muted print:hidden">Opening-balance entries count in the starting cash; year-end closing entries are left out.</p>}
    </div>
  )
}

/* ================= general ledger ================= */

export function GeneralLedgerTab({ meta }: { meta: StatementsMeta }) {
  const [f, setF] = useState<GlQuery>({ from: meta.fiscalYearStart, to: meta.today })
  const q = useGeneralLedger(f)
  const s = q.data
  const sheet = useMemo(() => (s ? generalLedgerSheet(s) : null), [s])
  const subtitle = s ? subtitleOf(meta, `${fmtDate(s.from)} – ${fmtDate(s.to)}`) : ''
  const postable = meta.accounts.filter((a) => !a.isHeader)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="gl-from" label="From"><TextInput id="gl-from" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} /></Field>
          <Field id="gl-to" label="To"><TextInput id="gl-to" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} /></Field>
          <Field id="gl-acc-from" label="Accounts from">
            <SelectInput id="gl-acc-from" value={f.accountFrom ?? ''} onChange={(e) => setF({ ...f, accountFrom: e.target.value || undefined })}>
              <option value="">First</option>
              {postable.map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="gl-acc-to" label="Accounts to">
            <SelectInput id="gl-acc-to" value={f.accountTo ?? ''} onChange={(e) => setF({ ...f, accountTo: e.target.value || undefined })}>
              <option value="">Last</option>
              {postable.map((a) => <option key={a.id} value={a.code}>{a.code} {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="gl-dept" label="Department">
            <SelectInput id="gl-dept" value={f.dims?.departmentId ?? ''} onChange={(e) => setF({ ...f, dims: { ...f.dims, departmentId: e.target.value || null } })}>
              <option value="">All</option>
              {meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectInput>
          </Field>
        </div>
        <ExportBar sheet={sheet} fileBase={`general-ledger-${s?.to ?? meta.today}`} subtitle={subtitle} />
      </div>
      <Letterhead lh={meta.letterhead} title="General ledger" subtitle={subtitle} />
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96" />
      ) : s.accounts.length === 0 ? (
        <EmptyState title="No activity" body="No account has a balance or postings for these filters." icon={<BookOpen />} />
      ) : (
        <div className="space-y-4">
          {s.accounts.map((a) => (
            <section key={a.account.id} aria-label={`Ledger ${a.account.code} ${a.account.name}`}>
              <h3 className="mb-1 text-[0.8125rem] font-semibold text-ink"><span className="num me-2 text-muted">{a.account.code}</span>{a.account.name} <span className="text-xs font-normal text-muted">· {ACCOUNT_TYPE_LABEL[a.account.type]}</span></h3>
              <SimpleTable
                label={`${a.account.code} ${a.account.name}`}
                head={<tr><th className={th}>Date</th><th className={th}>Entry</th><th className={th}>Memo</th><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th><th className={thEnd}>Balance</th></tr>}
                foot={<tr><td className={td} colSpan={3}>Closing balance</td><td className={tdEnd}><Amount value={a.totals.debit} /></td><td className={tdEnd}><Amount value={a.totals.credit} /></td><td className={tdEnd}><Amount value={a.closingBalance} strong /></td></tr>}
              >
                <tr><td className={cn(td, 'text-muted')} colSpan={5}>Opening balance</td><td className={tdEnd}><Amount value={a.openingBalance} /></td></tr>
                {a.rows.map((r, i) => (
                  <tr key={`${r.entryId}-${i}`}>
                    <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.date)}</td>
                    <td className={td}><EntryLink id={r.entryId} number={r.number} /></td>
                    <td className={td}>{r.memo}</td>
                    <td className={tdEnd}><Amount value={r.debit} blankZero /></td>
                    <td className={tdEnd}><Amount value={r.credit} blankZero /></td>
                    <td className={tdEnd}><Amount value={r.balance} /></td>
                  </tr>
                ))}
              </SimpleTable>
            </section>
          ))}
          <p className="text-xs text-muted">{s.accounts.length} accounts · movements {s.currency} {s.totals.debit.toLocaleString('en-US', { minimumFractionDigits: 2 })} debit / {s.totals.credit.toLocaleString('en-US', { minimumFractionDigits: 2 })} credit</p>
        </div>
      )}
    </div>
  )
}

/* ================= trial balance with comparatives ================= */

export function TrialBalanceTab({ meta }: { meta: StatementsMeta }) {
  const [asOf, setAsOf] = useState(meta.today)
  const [compareTo, setCompareTo] = useState(prevFyEnd(meta))
  const q = useTbCompare(asOf || undefined, compareTo || undefined)
  const s = q.data
  const sheet = useMemo(() => (s ? trialBalanceSheet(s) : null), [s])
  const subtitle = s ? subtitleOf(meta, `As of ${s.columns.map((c) => c.label).join(' vs ')}`) : ''
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="tbc-asof" label="As of"><TextInput id="tbc-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
          <Field id="tbc-compare" label="Compare to"><TextInput id="tbc-compare" type="date" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} /></Field>
          {s && <BalancedBadge ok={s.balanced.every(Boolean)} text={s.balanced.every(Boolean) ? 'Balanced' : 'Out of balance'} />}
        </div>
        <ExportBar sheet={sheet} fileBase={`trial-balance-${s?.columns[0].to ?? meta.today}`} subtitle={subtitle} />
      </div>
      <Letterhead lh={meta.letterhead} title="Trial balance" subtitle={subtitle} />
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-96" />
      ) : (
        <SimpleTable
          label="Trial balance with comparatives"
          head={
            <>
              <tr>
                <th className={th} rowSpan={2}>Code</th>
                <th className={th} rowSpan={2}>Account</th>
                {s.columns.map((c) => <th key={c.key} className={cn(thEnd, 'text-center')} colSpan={2}>{c.label}</th>)}
              </tr>
              <tr>{s.columns.map((c) => <Fragment key={c.key}><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th></Fragment>)}</tr>
            </>
          }
          foot={<tr><td className={td} colSpan={2}>Total ({s.currency})</td>{s.columns.map((c, i) => <Fragment key={c.key}><td className={tdEnd}><Amount value={s.totals.debit[i]} strong /></td><td className={tdEnd}><Amount value={s.totals.credit[i]} strong /></td></Fragment>)}</tr>}
        >
          {s.rows.map((r) => (
            <tr key={r.accountId}>
              <td className={cn(td, 'num')}>{r.code}</td>
              <td className={td}>{r.name}</td>
              {s.columns.map((c, i) => <Fragment key={c.key}><td className={tdEnd}><Amount value={r.debit[i]} blankZero /></td><td className={tdEnd}><Amount value={r.credit[i]} blankZero /></td></Fragment>)}
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}
