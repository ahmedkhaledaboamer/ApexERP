import { useMemo, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { BarChart3, CircleDollarSign, Coins, FileSpreadsheet, Percent, Printer, Target, TrendingUp, Trophy, UserPlus } from 'lucide-react'
import {
  ANALYTICS_PRESETS,
  ANALYTICS_PRESET_LABEL,
  type AnalyticsCampaignRow,
  type AnalyticsKpis,
  type AnalyticsPreset,
  type AnalyticsQuery,
  type MarketingAnalytics,
} from '@/modules/marketing/analyticsTypes'
import { AD_PROVIDER_LABEL } from '@/modules/marketing/adsTypes'
import { CHANNEL_LABEL, type CampaignChannel } from '@/modules/marketing/types'
import { useAdsAccess, useMarketingAnalytics } from '@/modules/marketing/hooks/useAds'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { analyticsSheets } from '@/modules/marketing/lib/analyticsSheets'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, Meter, TOOLTIP_STYLE, fmtInt } from '@/modules/reports/components/chartKit'
import { fmtCompactMoney, fmtDate, fmtMoney } from '@/shared/lib/utils'
import { useEntitlements } from '@/modules/billing/hooks'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatCard, pctChange } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, Switch, TextInput } from '@/shared/components/form/Field'

/** Marketing › Analytics: one company-scoped dashboard (absorbs the old Marketing reports page). */
export default function MarketingAnalyticsPage() {
  const { canView, canAnalytics } = useAdsAccess()
  if (!canView || !canAnalytics) return <NoMarketingAccess what="Marketing analytics" />
  return <Analytics />
}

const pctText = (n: number | null) => (n === null ? '—' : `${n}%`)
const channelLabel = (c: CampaignChannel | 'none') => (c === 'none' ? 'No campaign' : CHANNEL_LABEL[c])

function Analytics() {
  const toast = useToast()
  const ent = useEntitlements()
  const [preset, setPreset] = useState<AnalyticsPreset>('this_month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [compare, setCompare] = useState(true)
  const [exporting, setExporting] = useState(false)
  const customReady = preset !== 'custom' || (!!custom.from && !!custom.to && custom.from <= custom.to)
  const q: AnalyticsQuery = useMemo(() => (preset === 'custom' ? { preset, from: custom.from, to: custom.to, compare } : { preset, compare }), [preset, custom, compare])
  const query = useMarketingAnalytics(q, customReady)
  const a = query.data

  async function exportExcel() {
    if (!a) return
    setExporting(true)
    try {
      const sheets = analyticsSheets(a)
      await downloadExcel(`marketing-analytics-${a.from}-to-${a.to}`, sheets, `${fmtDate(a.from)} – ${fmtDate(a.to)} · ${a.currency} · Generated ${format(new Date(), 'd MMM yyyy HH:mm')}`)
      toast.success('Excel file downloaded', `${sheets.length} sheets, one per table`)
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
        title="Marketing Analytics"
        description="Spend, leads, cost per lead and return across campaigns, email, events and ads."
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
            <Switch checked={compare} onChange={setCompare} label="Compare to previous period" id="analytics-compare" />
          </div>
          {a && (
            <p className="ms-auto pb-2 text-xs text-muted" data-testid="analytics-range">
              {fmtDate(a.from)} – {fmtDate(a.to)} ({a.timezone})
              {a.previous ? ` · vs ${fmtDate(a.previous.from)} – ${fmtDate(a.previous.to)}` : ''}
            </p>
          )}
        </div>
        {a && (
          <div className="hidden border-b border-line pb-3 print:block">
            <h1 className="text-lg font-semibold">Marketing analytics</h1>
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
          <Dashboard a={a} eventsInPlan={ent.hasModule('events')} />
        ) : null}
      </PageBody>
    </>
  )
}

function Kpis({ k, prev, currency }: { k: AnalyticsKpis; prev: AnalyticsKpis | null; currency: string }) {
  const d = (cur: number | null, p: number | null | undefined) => (prev && cur !== null && p !== null && p !== undefined ? pctChange(cur, p) : undefined)
  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, currency))
  return (
    <section aria-label="Key figures" className="grid grid-cols-1 gap-4 min-[26.25rem]:grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 print:grid-cols-4">
      <StatCard label="Spend" icon={<Coins />} value={<span data-testid="kpi-spend">{money(k.spend)}</span>} delta={d(k.spend, prev?.spend)} hint="Campaign costs incl. ads" lowerIsBetter hintWithDelta />
      <StatCard label="Leads" icon={<UserPlus />} value={fmtInt(k.leads)} delta={d(k.leads, prev?.leads)} hint={`${k.attributedLeads} from a campaign`} hintWithDelta />
      <StatCard label="Cost per lead" icon={<Target />} value={<span data-testid="kpi-cpl">{money(k.costPerLead)}</span>} delta={d(k.costPerLead, prev?.costPerLead)} hint={`Spend ÷ ${k.attributedLeads} lead${k.attributedLeads === 1 ? '' : 's'} from a campaign`} lowerIsBetter hintWithDelta />
      <StatCard label="Won deals" icon={<Trophy />} value={fmtInt(k.won)} delta={d(k.won, prev?.won)} hint="Of the period’s leads" />
      <StatCard label="Won value" icon={<CircleDollarSign />} value={fmtCompactMoney(k.wonValue, currency)} delta={d(k.wonValue, prev?.wonValue)} />
      <StatCard label="ROI" icon={<TrendingUp />} value={pctText(k.roi)} hint={prev ? `Previous ${pctText(prev.roi)}` : '(won value − spend) ÷ spend'} />
      <StatCard label="Conversion rate" icon={<Percent />} value={pctText(k.conversionRate)} hint={prev ? `Previous ${pctText(prev.conversionRate)}` : 'Won ÷ leads'} />
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

function Dashboard({ a, eventsInPlan }: { a: MarketingAnalytics; eventsInPlan: boolean }) {
  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, a.currency))
  const timeline = a.timeline.map((p) => ({ ...p, label: a.bucket === 'month' ? fmtDate(p.start, 'MMM yyyy') : fmtDate(p.start, 'd MMM') }))
  const maxSource = Math.max(1, ...a.bySource.map((s) => s.leads))
  const top = a.funnel[0]?.count || 0
  return (
    <div className="space-y-6">
      <Kpis k={a.kpis} prev={a.previousKpis} currency={a.currency} />

      <Panel title="Leads and spend over time" description={`Leads created and campaign costs per ${a.bucket}.`}>
        <LegendRow className="mb-3">
          <Legend color={C.brand} label="Leads" />
          <Legend color={C.amber} label={`Spend (${a.currency})`} line />
        </LegendRow>
        <div dir="ltr" className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={timeline} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} minTickGap={16} />
              <YAxis yAxisId="l" allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={AXIS_TICK} />
              <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={56} tick={AXIS_TICK} tickFormatter={(v: number) => fmtCompactMoney(v, '').trim()} />
              <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v, name) => (name === 'Spend' ? fmtMoney(Number(v), a.currency) : v)} />
              <Bar yAxisId="l" dataKey="leads" name="Leads" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={22} />
              <Line yAxisId="r" dataKey="spend" name="Spend" stroke={C.amber} strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Leads by source" description="Leads created in the period, how many came from a campaign, and how many are won.">
          {a.bySource.length === 0 ? (
            <EmptyState title="No leads in this period" body="Pick a longer period." />
          ) : (
            <ul className="space-y-3" aria-label="Leads by source">
              {a.bySource.map((s) => (
                <li key={s.source} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                    <span className="truncate text-ink">{s.label}</span>
                    <span className="num text-ink-2">
                      {s.leads} <span className="text-muted">· {s.attributed} campaign · {s.won} won</span>
                    </span>
                  </div>
                  <Meter value={(s.leads / maxSource) * 100} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Funnel" description="How far the period’s leads got (status history and current status).">
          <ol className="space-y-2.5" aria-label="Funnel">
            {a.funnel.map((s) => (
              <li key={s.key} className="grid grid-cols-[6.5rem_1fr_5.5rem] items-center gap-3 text-[0.8125rem]">
                <span className="text-ink">{s.label}</span>
                <div className="h-6 overflow-hidden rounded-md bg-sunken">
                  <div className="h-full rounded-md bg-brand-500/80" style={{ width: `${top ? Math.max(2, (s.count / top) * 100) : 0}%` }} />
                </div>
                <span className="num text-end text-ink-2">
                  {s.count} <span className="text-muted">{s.rate === null ? '' : `· ${s.rate}%`}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel title="Leads and spend by channel" description="The channel of each lead’s campaign; spend is the campaign costs of that channel.">
        {a.byChannel.length === 0 ? (
          <EmptyState title="Nothing in this period" body="No leads or spend." />
        ) : (
          <div dir="ltr" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a.byChannel.map((c) => ({ ...c, label: channelLabel(c.channel) }))} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} interval={0} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={AXIS_TICK} />
                <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="leads" name="Leads" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar dataKey="won" name="Won" fill={C.green} radius={[3, 3, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <CampaignTable a={a} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Email performance" description="Bulk emails sent in the period.">
          <dl className="mb-4 grid grid-cols-3 gap-3 text-[0.8125rem]">
            <Figure label="Sent" value={fmtInt(a.email.sent)} />
            <Figure label="Open rate" value={pctText(a.email.openRate)} />
            <Figure label="Reply rate" value={pctText(a.email.replyRate)} />
          </dl>
          {a.email.sends.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No bulk emails sent in this period.</p>
          ) : (
            <ul className="divide-y divide-line text-[0.8125rem]">
              {a.email.sends.slice(0, 6).map((s) => (
                <li key={s.id} className="flex justify-between gap-2 py-2">
                  <span className="truncate text-ink">{s.name}</span>
                  <span className="num shrink-0 text-ink-2">
                    {s.sent} · {pctText(s.openRate)} open
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Events" description="Events starting in the period: attendees → leads → won.">
          {!a.events.included || !eventsInPlan ? (
            <p className="text-[0.8125rem] text-muted">Events aren’t part of your plan.</p>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-3 gap-3 text-[0.8125rem]">
                <Figure label="Attendees" value={fmtInt(a.events.attendees)} />
                <Figure label="Leads" value={fmtInt(a.events.leads)} />
                <Figure label="Won" value={fmtInt(a.events.won)} />
              </dl>
              {a.events.rows.length === 0 ? (
                <p className="text-[0.8125rem] text-muted">No events in this period.</p>
              ) : (
                <ul className="divide-y divide-line text-[0.8125rem]">
                  {a.events.rows.slice(0, 6).map((e) => (
                    <li key={e.eventId} className="flex justify-between gap-2 py-2">
                      <span className="truncate text-ink">{e.name}</span>
                      <span className="num shrink-0 text-ink-2">
                        {e.attendees} → {e.leads} → {e.won}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
        <Panel title="Ads" description="Synced ad spend and results per platform.">
          {a.ads.providers.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No ad account connected. Connect one in Ads Integrations.</p>
          ) : (
            <table className="w-full text-[0.8125rem]" aria-label="Ads by platform">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1.5 text-start font-medium">Platform</th>
                  <th className="py-1.5 text-end font-medium">Spend</th>
                  <th className="py-1.5 text-end font-medium">CTR</th>
                  <th className="py-1.5 text-end font-medium">CPC</th>
                  <th className="py-1.5 text-end font-medium">Leads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.ads.providers.map((r) => (
                  <tr key={r.provider}>
                    <td className="py-2 text-ink">{AD_PROVIDER_LABEL[r.provider]}</td>
                    <td className="num py-2 text-end">{money(r.spend)}</td>
                    <td className="num py-2 text-end">{pctText(r.ctr)}</td>
                    <td className="num py-2 text-end">{r.cpc === null ? '—' : `${r.cpc.toFixed(2)}`}</td>
                    <td className="num py-2 text-end">{r.leads}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-xs text-muted">
                <tr>
                  <td className="pt-2">{fmtInt(a.ads.totals.clicks)} clicks</td>
                  <td className="num pt-2 text-end">{money(a.ads.totals.spend)}</td>
                  <td className="num pt-2 text-end">{pctText(a.ads.totals.ctr)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Content output" description="Content Calendar items published in the period, and scheduled to publish in it.">
          <dl className="mb-4 grid grid-cols-2 gap-3 text-[0.8125rem]">
            <Figure label="Published" value={fmtInt(a.content.published)} />
            <Figure label="Scheduled" value={fmtInt(a.content.scheduled)} />
          </dl>
          {a.content.byType.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">Nothing published in this period.</p>
          ) : (
            <ul className="divide-y divide-line text-[0.8125rem]" aria-label="Published content by type">
              {a.content.byType.map((t) => (
                <li key={t.type} className="flex justify-between gap-2 py-2">
                  <span className="text-ink first-letter:uppercase">{t.type.replace(/_/g, ' ')}</span>
                  <span className="num text-ink-2">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Forms" description="Lead Generation form submissions in the period (spam excluded).">
          <dl className="mb-4 grid grid-cols-3 gap-3 text-[0.8125rem]">
            <Figure label="Submissions" value={fmtInt(a.forms.submissions)} />
            <Figure label="New leads" value={fmtInt(a.forms.leadsCreated)} />
            <Figure label="Existing leads" value={fmtInt(a.forms.linked)} />
          </dl>
          {a.forms.rows.length === 0 ? (
            <p className="text-[0.8125rem] text-muted">No form submissions in this period.</p>
          ) : (
            <ul className="divide-y divide-line text-[0.8125rem]" aria-label="Submissions by form">
              {a.forms.rows.slice(0, 6).map((f) => (
                <li key={f.formId} className="flex justify-between gap-2 py-2">
                  <span className="truncate text-ink">{f.name}</span>
                  <span className="num shrink-0 text-ink-2">
                    {f.submissions} · {f.leadsCreated} new
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num text-[1.0625rem] font-semibold text-ink">{value}</dd>
    </div>
  )
}

function CampaignTable({ a }: { a: MarketingAnalytics }) {
  const money = (n: number | null) => (n === null ? '—' : fmtMoney(n, a.currency))
  const columns = useMemo<ColumnDef<AnalyticsCampaignRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="text-xs text-muted">{CHANNEL_LABEL[row.original.channel]}</p>
          </div>
        ),
      },
      { accessorKey: 'spend', header: 'Spend', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{money(getValue<number>())}</span> },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' } },
      { accessorKey: 'costPerLead', header: 'Cost per lead', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num font-medium">{money(getValue<number | null>())}</span> },
      { accessorKey: 'won', header: 'Won', meta: { align: 'end' } },
      { accessorKey: 'wonValue', header: 'Won value', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{money(getValue<number>())}</span> },
      { accessorKey: 'roi', header: 'ROI', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{pctText(getValue<number | null>())}</span> },
      { accessorKey: 'sent', header: 'Emails sent', meta: { align: 'end' } },
      { accessorKey: 'opened', header: 'Opened', meta: { align: 'end' } },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.currency],
  )
  const table = useDataTable({ id: 'marketing-analytics-campaigns', data: a.campaigns, columns, defaultPageSize: 10, getRowId: (r) => r.campaignId })
  return (
    <Card className="print:break-inside-avoid print:shadow-none">
      <CardHeader title="Top campaigns" description="Spend and costs incurred in the period; leads created in the period with that campaign." />
      <CardBody>
        <DataTable table={table} empty={<EmptyState title="No campaign data" body="No campaign spend, leads or emails in this period." />} />
      </CardBody>
    </Card>
  )
}
