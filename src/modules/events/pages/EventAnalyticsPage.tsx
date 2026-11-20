import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { createColumnHelper } from '@tanstack/react-table'
import { BarChart3, CalendarCheck, CircleDollarSign, Coins, FileSpreadsheet, Percent, Printer, Smile, Target, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react'
import { ANALYTICS_PRESETS, ANALYTICS_PRESET_LABEL, type AnalyticsPreset } from '@/modules/marketing/analyticsTypes'
import type { EventAnalytics, EventAnalyticsKpis, EventAnalyticsQuery, EventAnalyticsRow, EventTypeSummary } from '@/modules/events/sectionsTypes'
import { EVENT_TYPE_LABEL } from '@/modules/events/types'
import { useEventAnalytics, useEventAnalyticsAccess } from '@/modules/events/hooks/useEventSections'
import { typeInsights } from '@/modules/events/lib/sections'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { downloadExcel, type ExportSheet } from '@/modules/reports/lib/exportExcel'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, TOOLTIP_STYLE, fmtInt } from '@/modules/reports/components/chartKit'
import { eventPath } from '@/app/paths'
import { fmtCompactMoney, fmtDate } from '@/shared/lib/utils'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard, pctChange } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, Switch, TextInput } from '@/shared/components/form/Field'

/**
 * Events › Event analytics: compare the events held in a period. Access: Marketing view AND Reports full |
 * marketing (like Marketing analytics); those roles see every event, so the numbers are the company's.
 */
export default function EventAnalyticsPage() {
  const allowed = useEventAnalyticsAccess()
  if (!allowed) return <NoMarketingAccess what="Event analytics" />
  return <Analytics />
}

const pctText = (n: number | null) => (n === null ? '—' : `${n}%`)

function Analytics() {
  const toast = useToast()
  const [preset, setPreset] = useState<AnalyticsPreset>('ytd')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [compare, setCompare] = useState(true)
  const [exporting, setExporting] = useState(false)
  const customReady = preset !== 'custom' || (!!custom.from && !!custom.to && custom.from <= custom.to)
  const q: EventAnalyticsQuery = useMemo(() => (preset === 'custom' ? { preset, from: custom.from, to: custom.to, compare } : { preset, compare }), [preset, custom, compare])
  const query = useEventAnalytics(q, customReady)
  const a = query.data

  async function exportExcel() {
    if (!a) return
    setExporting(true)
    try {
      const sheets = analyticsSheets(a)
      await downloadExcel(`event-analytics-${a.from}-to-${a.to}`, sheets, `${fmtDate(a.from)} – ${fmtDate(a.to)} · ${a.currency} · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`)
      toast.success('Excel file downloaded', `${sheets.length} sheets`)
    } catch {
      toast.error('Couldn’t create the Excel file', 'Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  function print() {
    toast.info('Choose “Save as PDF” in the print dialog')
    window.setTimeout(() => window.print(), 150)
  }

  return (
    <>
      <PrintStyles />
      <PageHeader
        className="print:hidden"
        title="Event analytics"
        description="Compare the events held in a period: attendance, leads, cost per lead, won deals, ROI and NPS."
        icon={<BarChart3 aria-hidden />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={exportExcel} loading={exporting} disabled={!a}>
              <FileSpreadsheet />
              Export Excel
            </Button>
            <Button variant="secondary" onClick={print} disabled={!a}>
              <Printer />
              Print / PDF
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-6">
        <div className="flex flex-wrap items-end gap-3 print:hidden" role="group" aria-label="Period">
          <label className="text-[0.8125rem] text-ink-2">
            <span className="mb-1 block text-xs text-muted">Period</span>
            <SelectInput aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as AnalyticsPreset)} className="w-44">
              {ANALYTICS_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {ANALYTICS_PRESET_LABEL[p]}
                </option>
              ))}
            </SelectInput>
          </label>
          {preset === 'custom' && (
            <>
              <label className="text-[0.8125rem]">
                <span className="mb-1 block text-xs text-muted">From</span>
                <TextInput type="date" aria-label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </label>
              <label className="text-[0.8125rem]">
                <span className="mb-1 block text-xs text-muted">To</span>
                <TextInput type="date" aria-label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </label>
            </>
          )}
          <div className="pb-1.5">
            <Switch checked={compare} onChange={setCompare} label="Compare to previous period" id="event-analytics-compare" />
          </div>
          {a && (
            <p className="ms-auto pb-2 text-xs text-muted" data-testid="event-analytics-range">
              {fmtDate(a.from)} – {fmtDate(a.to)} ({a.timezone})
              {a.previous ? ` · vs ${fmtDate(a.previous.from)} – ${fmtDate(a.previous.to)}` : ''}
            </p>
          )}
        </div>
        {a && (
          <div className="hidden border-b border-line pb-3 print:block">
            <h1 className="text-lg font-semibold">Event analytics</h1>
            <p className="text-sm text-muted">
              {fmtDate(a.from)} – {fmtDate(a.to)} · {a.currency}
            </p>
          </div>
        )}
        {!customReady ? (
          <EmptyState title="Pick a date range" body="Choose the first and last day (the first on or before the last)." />
        ) : query.isPending ? (
          <Skeleton className="h-96 rounded-card" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : a ? (
          <Dashboard a={a} />
        ) : null}
      </PageBody>
    </>
  )
}

function Kpis({ k, prev, currency }: { k: EventAnalyticsKpis; prev: EventAnalyticsKpis | null; currency: string }) {
  const d = (cur: number | null, p: number | null | undefined) => (prev && cur !== null && p !== null && p !== undefined ? pctChange(cur, p) : undefined)
  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-4 min-[26.25rem]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">
      <StatCard label="Events held" icon={<CalendarCheck />} value={<span data-testid="kpi-events">{fmtInt(k.events)}</span>} delta={d(k.events, prev?.events)} />
      <StatCard label="Attendees" icon={<Users />} value={fmtInt(k.attendees)} delta={d(k.attendees, prev?.attendees)} hint={`${k.checkedIn} checked in`} hintWithDelta />
      <StatCard label="Check-in rate" icon={<Percent />} value={pctText(k.checkInRate)} hint={prev ? `Previous ${pctText(prev.checkInRate)}` : 'Checked in ÷ attendees'} />
      <StatCard label="Leads" icon={<Target />} value={fmtInt(k.leadsCreated + k.leadsLinked)} delta={d(k.leadsCreated + k.leadsLinked, prev ? prev.leadsCreated + prev.leadsLinked : undefined)} hint={`${k.leadsCreated} new · ${k.leadsLinked} linked`} hintWithDelta />
      <StatCard label="Won deals" icon={<Trophy />} value={fmtInt(k.dealsWon)} delta={d(k.dealsWon, prev?.dealsWon)} hint={moneyIn(k.wonValue, currency)} hintWithDelta />
      <StatCard label="Actual cost" icon={<Coins />} value={moneyIn(k.actualCost, currency)} delta={d(k.actualCost, prev?.actualCost)} lowerIsBetter />
      <StatCard label="Cost per lead" icon={<CircleDollarSign />} value={<span data-testid="kpi-cpl">{moneyIn(k.costPerLead, currency)}</span>} delta={d(k.costPerLead, prev?.costPerLead)} hint="Actual cost (else budget) ÷ new leads" lowerIsBetter hintWithDelta />
      <StatCard label="ROI" icon={<TrendingUp />} value={pctText(k.roi)} hint={prev ? `Previous ${pctText(prev.roi)}` : '(won value − actual cost) ÷ actual cost'} />
      <StatCard label="Average NPS" icon={<Smile />} value={k.averageNps === null ? '—' : String(k.averageNps)} hint={prev ? `Previous ${prev.averageNps ?? '—'}` : 'Mean of the events’ NPS'} />
      <StatCard label="Won value" icon={<CircleDollarSign />} value={fmtCompactMoney(k.wonValue, currency)} delta={d(k.wonValue, prev?.wonValue)} />
    </section>
  )
}

function Panel({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`print:break-inside-avoid print:shadow-none ${className ?? ''}`}>
      <CardHeader title={title} description={description} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

function Dashboard({ a }: { a: EventAnalytics }) {
  if (!a.rows.length) {
    return (
      <div className="space-y-6">
        <Kpis k={a.kpis} prev={a.previousKpis} currency={a.currency} />
        <EmptyState icon={<CalendarCheck />} title="No events held in this period" body="Pick a longer period, e.g. year to date." />
      </div>
    )
  }
  const perEvent = [...a.rows].reverse().map((r) => ({ name: r.name, leads: r.leads, won: r.wonValue }))
  const cplByType = a.byType.map((t) => ({ label: EVENT_TYPE_LABEL[t.type], cpl: t.costPerLead ?? 0 }))
  const trend = a.trend.map((p) => ({ ...p, label: fmtDate(`${p.month}-01`, 'MMM yyyy') }))
  const insight = typeInsights(a.byType)
  return (
    <div className="space-y-6">
      <Kpis k={a.kpis} prev={a.previousKpis} currency={a.currency} />

      {insight.best && (
        <section aria-label="Insights" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Insight tone="good" type={insight.best} by={insight.by} currency={a.currency} />
          {insight.worst && <Insight tone="bad" type={insight.worst} by={insight.by} currency={a.currency} />}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Leads and won value per event" description="Distinct leads from each event (new + linked) and the value of the won ones.">
          <LegendRow className="mb-3">
            <Legend color={C.brand} label="Leads" />
            <Legend color={C.green} label={`Won value (${a.currency})`} />
          </LegendRow>
          <div dir="ltr" className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={perEvent} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
                <YAxis yAxisId="l" allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={AXIS_TICK} />
                <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} tickFormatter={(v: number) => fmtCompactMoney(v, '').trim()} />
                <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v, name) => (name === 'Won value' ? moneyIn(Number(v), a.currency) : v)} />
                <Bar yAxisId="l" dataKey="leads" name="Leads" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar yAxisId="r" dataKey="won" name="Won value" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={28} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Cost per lead by event type" description="Actual cost (else budget) ÷ new leads, per type.">
          <div dir="ltr" className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cplByType} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} />
                <YAxis tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} tickFormatter={(v: number) => fmtCompactMoney(v, '').trim()} />
                <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => moneyIn(Number(v), a.currency)} />
                <Bar dataKey="cpl" name="Cost per lead" fill={C.amber} radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Attendance rate" description="Checked in ÷ attendees of the events starting each month.">
          <TrendChart data={trend} dataKey="checkInRate" name="Check-in rate" color={C.blue} unit="%" />
        </Panel>
        <Panel title="NPS" description="Net promoter score of the survey answers, by the month the event started.">
          <TrendChart data={trend} dataKey="nps" name="NPS" color={C.green} />
        </Panel>
      </div>

      <EventTable a={a} />
    </div>
  )
}

function TrendChart({ data, dataKey, name, color, unit = '' }: { data: { label: string }[]; dataKey: string; name: string; color: string; unit?: string }) {
  return (
    <div dir="ltr" className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} width={36} tick={AXIS_TICK} />
          <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v) => (v === null || v === undefined ? '—' : `${v}${unit}`)} />
          <Line dataKey={dataKey} name={name} stroke={color} strokeWidth={2} dot={{ r: 3 }} type="monotone" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function Insight({ tone, type, by, currency }: { tone: 'good' | 'bad'; type: EventTypeSummary; by: 'roi' | 'cpl' | null; currency: string }) {
  const label = EVENT_TYPE_LABEL[type.type]
  const figure = by === 'roi' ? `ROI ${pctText(type.roi)}` : `${moneyIn(type.costPerLead, currency)} per lead`
  return (
    <Card className="print:break-inside-avoid">
      <CardBody className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone === 'good' ? 'bg-success-500/10 text-success-600' : 'bg-danger-500/10 text-danger-600'}`}>
          {tone === 'good' ? <TrendingUp className="size-4" aria-hidden /> : <TrendingDown className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 text-[0.8125rem]" data-testid={tone === 'good' ? 'insight-best' : 'insight-worst'}>
          <p className="font-medium text-ink">
            {tone === 'good' ? 'Best' : 'Weakest'} event type: {label}
          </p>
          <p className="text-muted">
            {figure} · {type.events} event{type.events === 1 ? '' : 's'} · {type.leadsCreated} new lead{type.leadsCreated === 1 ? '' : 's'} · {moneyIn(type.wonValue, currency)} won
          </p>
        </div>
      </CardBody>
    </Card>
  )
}

function EventTable({ a }: { a: EventAnalytics }) {
  const columns = useMemo(() => {
    const col = createColumnHelper<EventAnalyticsRow>()
    const money = (n: number | null) => moneyIn(n, a.currency)
    const num = (n: number | null) => n ?? -Infinity
    return [
      col.accessor('name', {
        header: 'Event',
        enableHiding: false,
        meta: { width: 240 },
        cell: ({ row }) => (
          <Link to={eventPath(row.original.id)} className="truncate font-medium text-ink hover:underline">
            {row.original.name}
          </Link>
        ),
      }),
      col.accessor('type', { header: 'Type', cell: ({ getValue }) => EVENT_TYPE_LABEL[getValue()] }),
      col.accessor('startDate', { header: 'Dates', cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{row.original.startDate === row.original.endDate ? fmtDate(row.original.startDate) : `${fmtDate(row.original.startDate)} – ${fmtDate(row.original.endDate)}`}</span> }),
      col.accessor('attendees', { header: 'Attendees', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue()}</span> }),
      col.accessor((r) => num(r.checkInRate), { id: 'checkIn', header: 'Check-in', meta: { align: 'end' }, cell: ({ row }) => <span className="num">{pctText(row.original.checkInRate)}</span> }),
      col.accessor('leads', { header: 'Leads', meta: { align: 'end' }, cell: ({ row }) => <span className="num" title={`${row.original.leadsCreated} new · ${row.original.leadsLinked} linked`}>{row.original.leads}</span> }),
      col.accessor((r) => num(r.costPerLead), {
        id: 'cpl',
        header: 'Cost per lead',
        meta: { align: 'end' },
        cell: ({ row }) => (
          <span className="num" data-testid={`cpl-${row.original.id}`} title={row.original.costPerLeadBasis === 'budget' ? 'From the budget (no actual cost yet)' : undefined}>
            {money(row.original.costPerLead)}
            {row.original.costPerLeadBasis === 'budget' ? <span className="text-xs text-muted"> *</span> : null}
          </span>
        ),
      }),
      col.accessor('wonValue', { header: 'Won', meta: { align: 'end' }, cell: ({ row }) => <span className="num">{row.original.dealsWon} · {money(row.original.wonValue)}</span> }),
      col.accessor((r) => num(r.roi), { id: 'roi', header: 'ROI', meta: { align: 'end' }, cell: ({ row }) => <span className="num">{pctText(row.original.roi)}</span> }),
      col.accessor((r) => num(r.nps), { id: 'nps', header: 'NPS', meta: { align: 'end' }, cell: ({ row }) => <span className="num">{row.original.nps ?? '—'}</span> }),
    ]
  }, [a.currency])
  const table = useDataTable({ id: 'event-analytics-events', data: a.rows, columns, getRowId: (r) => r.id })
  return (
    <section aria-label="Events in the period" className="space-y-2">
      <DataTable table={table} minWidth={1000} />
      <p className="text-xs text-muted">* Cost per lead from the planned budget: the event has no actual cost yet (same rule as the event page).</p>
    </section>
  )
}

/** Excel workbook: KPIs, events, event types (one sheet each). */
function analyticsSheets(a: EventAnalytics): ExportSheet[] {
  const k = a.kpis
  return [
    {
      name: 'Summary',
      title: 'Event analytics',
      columns: [{ header: 'Figure', width: 28 }, { header: 'Value', width: 18 }, ...(a.previousKpis ? [{ header: 'Previous period', width: 18 }] : [])],
      rows: (
        [
          ['Events held', k.events, a.previousKpis?.events],
          ['Attendees', k.attendees, a.previousKpis?.attendees],
          ['Checked in', k.checkedIn, a.previousKpis?.checkedIn],
          ['Check-in rate %', k.checkInRate, a.previousKpis?.checkInRate],
          ['New leads', k.leadsCreated, a.previousKpis?.leadsCreated],
          ['Linked leads', k.leadsLinked, a.previousKpis?.leadsLinked],
          ['Won deals', k.dealsWon, a.previousKpis?.dealsWon],
          [`Won value (${a.currency})`, k.wonValue, a.previousKpis?.wonValue],
          [`Actual cost (${a.currency})`, k.actualCost, a.previousKpis?.actualCost],
          [`Cost per lead (${a.currency})`, k.costPerLead, a.previousKpis?.costPerLead],
          ['ROI %', k.roi, a.previousKpis?.roi],
          ['Average NPS', k.averageNps, a.previousKpis?.averageNps],
        ] as [string, number | null, number | null | undefined][]
      ).map(([label, cur, prev]) => (a.previousKpis ? [label, cur, prev ?? null] : [label, cur])),
    },
    {
      name: 'Events',
      title: 'Events in the period',
      columns: ['Event', 'Type', 'Start', 'End', 'Attendees', 'Checked in', 'Check-in %', 'Leads', 'New leads', 'Cost per lead', 'CPL basis', 'Deals won', 'Won value', 'Actual cost', 'ROI %', 'NPS'].map((header) => ({ header, width: header === 'Event' ? 32 : 14 })),
      rows: a.rows.map((r) => [r.name, EVENT_TYPE_LABEL[r.type], r.startDate, r.endDate, r.attendees, r.checkedIn, r.checkInRate, r.leads, r.leadsCreated, r.costPerLead, r.costPerLeadBasis ?? '', r.dealsWon, r.wonValue, r.actualCost, r.roi, r.nps]),
    },
    {
      name: 'Event types',
      title: 'By event type',
      columns: ['Type', 'Events', 'New leads', 'Cost', 'Cost per lead', 'Won value', 'ROI %'].map((header) => ({ header, width: 14 })),
      rows: a.byType.map((t) => [EVENT_TYPE_LABEL[t.type], t.events, t.leadsCreated, t.cost, t.costPerLead, t.wonValue, t.roi]),
    },
  ]
}
