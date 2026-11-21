import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Plus, Trash2 } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgingBucket, CashForecast, ForecastBucket, ForecastCategory } from '@/modules/finance/planning/types'
import { AGING_LABEL, FORECAST_CATEGORY_LABEL, INFLOW_CATEGORIES, OUTFLOW_CATEGORIES } from '@/modules/finance/planning/types'
import { planningApi, useForecast, usePlanningMutation } from '@/modules/finance/planning/api'
import { Amount, SimpleTable, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { fmtMoney } from '@/modules/finance/ledger/calc'
import { FinError, downloadText, toCsv } from '@/modules/finance/collections/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { Segmented } from '@/shared/components/ui/Segmented'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

/** Inflow / outflow hues (validated for CVD and contrast on the light and dark surfaces); the balance line is the brand colour. */
const COLOR = { inflow: '#0d9488', outflow: '#d97706', balance: 'var(--color-brand-600)', minimum: 'var(--color-ink-3, #8a8a85)' }
type View = 'weeks' | 'months'

const catSum = (b: ForecastBucket, c: ForecastCategory) => b.byCategory.find((x) => x.category === c)?.amount ?? 0
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))

export function ForecastTab() {
  const q = useForecast()
  const [view, setView] = useState<View>('weeks')
  const f = q.data
  if (q.error) return <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
  if (!f) return <Skeleton className="h-[32rem]" />
  const buckets = view === 'weeks' ? f.weeks : f.months
  const last = buckets[buckets.length - 1]
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label={`Cash today (${fmtDate(f.today)})`} value={f.openingCash} currency={f.currency} />
        <Kpi label={`Lowest balance · ${f.lowestWeek.label}`} value={f.lowestWeek.closing} currency={f.currency} warn={f.lowestWeek.belowMinimum} />
        <Kpi label={`Closing after ${view === 'weeks' ? '13 weeks' : '6 months'}`} value={last.closing} currency={f.currency} />
        <Kpi label="Minimum cash" value={f.settings.minimumCash} currency={f.currency} />
      </div>
      {f.lowestWeek.belowMinimum && (
        <p role="alert" className="flex gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-[0.8125rem] dark:bg-warning-500/10" data-testid="lowest-week-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
          {f.lowestWeek.negative ? 'Cash goes negative' : 'Cash falls below the minimum'} in {f.lowestWeek.label}: <Amount value={f.lowestWeek.closing} currency={f.currency} strong />. Chase collections or move payments.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<View> label="Forecast view" size="sm" value={view} onChange={setView} options={[{ value: 'weeks', label: '13 weeks' }, { value: 'months', label: '6 months' }]} />
        <Button variant="secondary" onClick={() => downloadText(`cash-forecast-${view}-${f.today}.csv`, forecastCsv(f, buckets))}><Download />Export CSV</Button>
      </div>
      <ForecastChart f={f} buckets={buckets} />
      <ForecastTable f={f} buckets={buckets} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Assumptions f={f} />
        <ManualLines f={f} />
      </div>
      <details className="rounded-xl border border-line bg-surface px-4 py-3 text-[0.8125rem]">
        <summary className="cursor-pointer font-medium text-ink">All expected movements ({f.items.length})</summary>
        <div className="mt-3">
          <SimpleTable label="Forecast items" head={<tr><th className={th}>Date</th><th className={th}>Source</th><th className={th}>Item</th><th className={thEnd}>Amount</th><th className={thEnd}>Probability</th><th className={thEnd}>Expected</th></tr>}>
            {f.items.map((i) => (
              <tr key={i.id}>
                <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(i.date)}</td>
                <td className={td}>{FORECAST_CATEGORY_LABEL[i.category]}</td>
                <td className={td}>{i.link ? <Link to={i.link} className="text-brand-700 hover:underline dark:text-brand-300">{i.label}</Link> : i.label}</td>
                <td className={tdEnd}><Amount value={i.gross} /></td>
                <td className={tdEnd}>{i.probability} %</td>
                <td className={tdEnd}><Amount value={i.amount} strong /></td>
              </tr>
            ))}
          </SimpleTable>
        </div>
      </details>
      <ul className="list-disc space-y-1 ps-5 text-xs text-muted">{f.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  )
}

function Kpi({ label, value, currency, warn }: { label: string; value: number; currency: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface px-4 py-3', warn && 'border-warning-300')}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg"><Amount value={value} currency={currency} strong /></p>
    </div>
  )
}

function ForecastChart({ f, buckets }: { f: CashForecast; buckets: ForecastBucket[] }) {
  const data = buckets.map((b) => ({ label: b.key.startsWith('W') ? b.key : b.label, range: `${fmtDate(b.from)} – ${fmtDate(b.to)}`, inflows: b.inflows, outflows: b.outflows, closing: b.closing }))
  return (
    <figure className="rounded-xl border border-line bg-surface p-3" aria-label="Cash-flow forecast chart">
      <figcaption className="mb-2 text-xs text-muted">Expected inflows and outflows per period, and the closing cash balance ({f.currency}).</figcaption>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted, #6b6b66)" />
            <YAxis tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} width={48} stroke="var(--color-muted, #6b6b66)" />
            <Tooltip
              cursor={{ fill: 'var(--color-hover)' }}
              contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink)', borderRadius: 8, fontSize: 12 }}
              labelFormatter={(_, p) => (p?.[0]?.payload as { range?: string } | undefined)?.range ?? ''}
              formatter={(v: number, name: string) => [`${f.currency} ${fmtMoney(v)}`, name]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {f.settings.minimumCash > 0 && <ReferenceLine y={f.settings.minimumCash} stroke={COLOR.minimum} strokeDasharray="4 4" label={{ value: 'Minimum cash', fontSize: 11, position: 'insideTopLeft', fill: 'var(--color-muted, #6b6b66)' }} />}
            <ReferenceLine y={0} stroke="var(--color-line-strong, #c9c9c4)" />
            <Bar dataKey="inflows" name="Inflows" fill={COLOR.inflow} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="outflows" name="Outflows" fill={COLOR.outflow} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Line dataKey="closing" name="Closing balance" stroke={COLOR.balance} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function ForecastTable({ f, buckets }: { f: CashForecast; buckets: ForecastBucket[] }) {
  const lowKey = f.lowestWeek.key
  const row = (label: string, get: (b: ForecastBucket) => number, strong?: boolean) => (
    <tr className={cn(strong && 'font-semibold')}>
      <td className={cn(td, 'sticky start-0 whitespace-nowrap bg-surface')}>{label}</td>
      {buckets.map((b) => <td key={b.key} className={cn(tdEnd, b.key === lowKey && 'bg-warning-50/60 dark:bg-warning-500/10')}><Amount value={get(b)} strong={strong} blankZero={!strong} /></td>)}
    </tr>
  )
  return (
    <SimpleTable
      label="Cash-flow forecast table"
      head={<tr><th className={cn(th, 'sticky start-0 bg-sunken')}>{f.currency}</th>{buckets.map((b) => <th key={b.key} className={cn(thEnd, b.key === lowKey && 'text-warning-700')} title={`${b.from} – ${b.to}`}>{b.key.startsWith('W') ? `${b.key} · ${fmtDate(b.from).replace(/ \d{4}$/, '')}` : b.label}</th>)}</tr>}
    >
      {row('Opening cash', (b) => b.opening, true)}
      {INFLOW_CATEGORIES.map((c) => <Fragment key={c}>{row(`+ ${FORECAST_CATEGORY_LABEL[c]}`, (b) => catSum(b, c))}</Fragment>)}
      {row('+ Manual inflows', (b) => Math.max(0, catSum(b, 'manual')))}
      {row('Total inflows', (b) => b.inflows, true)}
      {OUTFLOW_CATEGORIES.map((c) => <Fragment key={c}>{row(`− ${FORECAST_CATEGORY_LABEL[c]}`, (b) => catSum(b, c))}</Fragment>)}
      {row('− Manual outflows', (b) => Math.min(0, catSum(b, 'manual')))}
      {row('Total outflows', (b) => b.outflows, true)}
      {row('Net cash flow', (b) => b.net)}
      {row('Closing cash', (b) => b.closing, true)}
    </SimpleTable>
  )
}

export function forecastCsv(f: CashForecast, buckets: ForecastBucket[]): string {
  const rows: (string | number)[][] = [
    ['Line', ...buckets.map((b) => `${b.label} (${b.from} – ${b.to})`)],
    ['Opening cash', ...buckets.map((b) => b.opening.toFixed(2))],
    ...[...INFLOW_CATEGORIES, ...OUTFLOW_CATEGORIES, 'manual' as ForecastCategory].map((c) => [FORECAST_CATEGORY_LABEL[c], ...buckets.map((b) => catSum(b, c).toFixed(2))]),
    ['Total inflows', ...buckets.map((b) => b.inflows.toFixed(2))],
    ['Total outflows', ...buckets.map((b) => b.outflows.toFixed(2))],
    ['Net', ...buckets.map((b) => b.net.toFixed(2))],
    ['Closing cash', ...buckets.map((b) => b.closing.toFixed(2))],
  ]
  return toCsv([[`Cash-flow forecast from ${f.today} (${f.currency})`], ...rows])
}

function Assumptions({ f }: { f: CashForecast }) {
  const toast = useToast()
  const s = f.settings
  const [probs, setProbs] = useState<Record<string, string>>({})
  const [bounced, setBounced] = useState('')
  const [inPct, setInPct] = useState('')
  const [outPct, setOutPct] = useState('')
  const [minCash, setMinCash] = useState('')
  useEffect(() => {
    setProbs(Object.fromEntries(s.probabilities.map((p) => [p.bucket, String(p.pct)])))
    setBounced(String(s.bouncedPdcPct))
    setInPct(String(s.inflowAdjustPct))
    setOutPct(String(s.outflowAdjustPct))
    setMinCash(String(s.minimumCash))
  }, [s])
  const m = usePlanningMutation(() =>
    planningApi.forecastSettings({
      probabilities: s.probabilities.map((p) => ({ bucket: p.bucket, pct: Number(probs[p.bucket]) })),
      bouncedPdcPct: Number(bounced),
      inflowAdjustPct: Number(inPct),
      outflowAdjustPct: Number(outPct),
      minimumCash: Number(minCash),
    }),
  )
  const dis = !f.canEdit
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Forecast assumptions">
      <h3 className="text-sm font-semibold text-ink">Collection probability and scenario</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {s.probabilities.map((p) => (
          <Field key={p.bucket} id={`fp-${p.bucket}`} label={`${AGING_LABEL[p.bucket as AgingBucket]} (%)`}>
            <TextInput id={`fp-${p.bucket}`} type="number" min={0} max={100} disabled={dis} value={probs[p.bucket] ?? ''} onChange={(e) => setProbs({ ...probs, [p.bucket]: e.target.value })} />
          </Field>
        ))}
        <Field id="fp-bounced" label="Cheques after a bounce (%)"><TextInput id="fp-bounced" type="number" disabled={dis} value={bounced} onChange={(e) => setBounced(e.target.value)} /></Field>
        <Field id="fp-in" label="Scenario: inflows ± %"><TextInput id="fp-in" type="number" disabled={dis} value={inPct} onChange={(e) => setInPct(e.target.value)} /></Field>
        <Field id="fp-out" label="Scenario: outflows ± %"><TextInput id="fp-out" type="number" disabled={dis} value={outPct} onChange={(e) => setOutPct(e.target.value)} /></Field>
        <Field id="fp-min" label={`Minimum cash (${f.currency})`}><TextInput id="fp-min" type="number" disabled={dis} value={minCash} onChange={(e) => setMinCash(e.target.value)} /></Field>
      </div>
      {f.canEdit && <div className="mt-3 flex justify-end"><Button write size="sm" loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: () => toast.success('Assumptions saved'), onError: (e) => toast.error('Not saved', e.message) })}>Save assumptions</Button></div>}
    </section>
  )
}

function ManualLines({ f }: { f: CashForecast }) {
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(f.today)
  const [amount, setAmount] = useState('')
  const [recurrence, setRecurrence] = useState<'once' | 'weekly' | 'monthly'>('once')
  const add = usePlanningMutation(() => planningApi.addLine({ label, date, amount: Number(amount), recurrence }))
  const del = usePlanningMutation((id: string) => planningApi.removeLine(id))
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Manual lines">
      <h3 className="text-sm font-semibold text-ink">Manual lines</h3>
      <p className="mt-0.5 text-xs text-muted">Known movements the books don’t show yet: + cash in, − cash out.</p>
      <ul className="mt-3 divide-y divide-line text-[0.8125rem]">
        {!f.settings.lines.length && <li className="py-1.5 text-muted">None.</li>}
        {f.settings.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
            <span>{l.label} <span className="text-xs text-muted">· {fmtDate(l.date)}{l.recurrence !== 'once' ? ` · ${l.recurrence}` : ''}</span></span>
            <span className="flex items-center gap-1"><Amount value={l.amount} />{f.canEdit && <Button variant="ghost" size="xs" iconOnly aria-label={`Remove ${l.label}`} onClick={() => del.mutate(l.id, { onError: (e) => toast.error('Not removed', e.message) })}><Trash2 /></Button>}</span>
          </li>
        ))}
      </ul>
      {f.canEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_7rem_7rem_auto] sm:items-end">
          <Field id="fl-label" label="Label"><TextInput id="fl-label" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field id="fl-date" label="Date"><TextInput id="fl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="fl-amount" label="Amount"><TextInput id="fl-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field id="fl-rec" label="Repeat">
            <SelectInput id="fl-rec" value={recurrence} onChange={(e) => setRecurrence(e.target.value as 'once' | 'weekly' | 'monthly')}><option value="once">Once</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></SelectInput>
          </Field>
          <Button write size="sm" disabled={!label.trim() || !Number(amount)} loading={add.isPending} onClick={() => add.mutate(undefined, { onSuccess: () => { toast.success('Line added'); setLabel(''); setAmount('') }, onError: (e) => toast.error('Not added', e.message) })}><Plus />Add</Button>
        </div>
      )}
    </section>
  )
}
