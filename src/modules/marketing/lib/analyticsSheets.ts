import { AD_PROVIDER_LABEL } from '@/modules/marketing/adsTypes'
import type { MarketingAnalytics } from '@/modules/marketing/analyticsTypes'
import { CHANNEL_LABEL } from '@/modules/marketing/types'
import { XL, type ExportSheet } from '@/modules/reports/lib/exportExcel'

/** The analytics dashboard as Excel sheets (one per table), built from the API payload only. */
export function analyticsSheets(a: MarketingAnalytics): ExportSheet[] {
  const k = a.kpis
  const p = a.previousKpis
  const kpiRow = (label: string, cur: number | null, prev: number | null | undefined) => [label, cur, p ? (prev ?? null) : null]
  const channel = (c: string) => (c === 'none' ? 'No campaign' : CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c)
  return [
    {
      name: 'Summary',
      title: 'Marketing analytics: key figures',
      columns: [{ header: 'Figure', width: 28 }, { header: 'This period', format: XL.money, width: 16 }, { header: 'Previous period', format: XL.money, width: 18 }],
      rows: [
        kpiRow(`Spend (${a.currency})`, k.spend, p?.spend),
        kpiRow('Leads', k.leads, p?.leads),
        kpiRow('Leads from a campaign', k.attributedLeads, p?.attributedLeads),
        kpiRow(`Cost per lead (${a.currency})`, k.costPerLead, p?.costPerLead),
        kpiRow('Won deals', k.won, p?.won),
        kpiRow(`Won value (${a.currency})`, k.wonValue, p?.wonValue),
        kpiRow('ROI (%)', k.roi, p?.roi),
        kpiRow('Conversion rate (%)', k.conversionRate, p?.conversionRate),
      ],
    },
    {
      name: 'Over time',
      title: `Leads and spend by ${a.bucket}`,
      columns: [{ header: 'From', width: 14 }, { header: 'Leads', format: XL.int }, { header: `Spend (${a.currency})`, format: XL.money, width: 16 }],
      rows: a.timeline.map((t) => [t.start, t.leads, t.spend]),
    },
    {
      name: 'Campaigns',
      title: 'Campaigns: spend, leads, cost per lead, won and ROI',
      columns: [
        { header: 'Campaign', width: 32 },
        { header: 'Channel', width: 12 },
        { header: `Spend (${a.currency})`, format: XL.money, width: 16 },
        { header: 'Leads', format: XL.int },
        { header: 'Cost per lead', format: XL.money, width: 14 },
        { header: 'Won', format: XL.int },
        { header: 'Won value', format: XL.money, width: 14 },
        { header: 'ROI (%)', format: XL.pct },
        { header: 'Emails sent', format: XL.int },
        { header: 'Opened', format: XL.int },
        { header: 'Replied', format: XL.int },
      ],
      rows: a.campaigns.map((r) => [r.name, channel(r.channel), r.spend, r.leads, r.costPerLead, r.won, r.wonValue, r.roi, r.sent, r.opened, r.replied]),
    },
    {
      name: 'Sources',
      title: 'Leads by source',
      columns: [{ header: 'Source', width: 22 }, { header: 'Leads', format: XL.int }, { header: 'From a campaign', format: XL.int, width: 16 }, { header: 'Won', format: XL.int }],
      rows: a.bySource.map((s) => [s.label, s.leads, s.attributed, s.won]),
    },
    {
      name: 'Channels',
      title: 'Leads and spend by channel',
      columns: [{ header: 'Channel', width: 16 }, { header: 'Leads', format: XL.int }, { header: `Spend (${a.currency})`, format: XL.money, width: 16 }, { header: 'Won', format: XL.int }],
      rows: a.byChannel.map((c) => [channel(c.channel), c.leads, c.spend, c.won]),
    },
    {
      name: 'Funnel',
      title: 'Funnel of the leads created in the period',
      columns: [{ header: 'Stage', width: 16 }, { header: 'Leads', format: XL.int }, { header: '% of new', format: XL.pct }],
      rows: a.funnel.map((s) => [s.label, s.count, s.rate]),
    },
    {
      name: 'Email',
      title: 'Bulk email performance',
      columns: [{ header: 'Bulk email', width: 32 }, { header: 'Sent', format: XL.int }, { header: 'Open rate', format: XL.pct }, { header: 'Reply rate', format: XL.pct }],
      rows: [...a.email.sends.map((s) => [s.name, s.sent, s.openRate, s.replyRate]), ['All bulk emails', a.email.sent, a.email.openRate, a.email.replyRate]],
    },
    {
      name: 'Events',
      title: 'Events: attendees → leads → won',
      columns: [{ header: 'Event', width: 32 }, { header: 'Date', width: 12 }, { header: 'Attendees', format: XL.int }, { header: 'Leads', format: XL.int }, { header: 'Won', format: XL.int }],
      rows: a.events.rows.map((e) => [e.name, e.startsOn, e.attendees, e.leads, e.won]),
    },
    {
      name: 'Ads',
      title: 'Ads by platform',
      columns: [
        { header: 'Platform', width: 16 },
        { header: `Spend (${a.currency})`, format: XL.money, width: 16 },
        { header: 'Impressions', format: XL.int, width: 14 },
        { header: 'Clicks', format: XL.int },
        { header: 'CTR (%)', format: XL.pct },
        { header: 'CPC', format: '#,##0.00' },
        { header: 'Leads', format: XL.int },
      ],
      rows: a.ads.providers.map((r) => [AD_PROVIDER_LABEL[r.provider], r.spend, r.impressions, r.clicks, r.ctr, r.cpc, r.leads]),
    },
    {
      name: 'Content',
      title: `Content output: ${a.content.published} published, ${a.content.scheduled} scheduled`,
      columns: [{ header: 'Type', width: 18 }, { header: 'Published', format: XL.int }],
      rows: a.content.byType.map((t) => [t.type.replace(/_/g, ' '), t.count]),
    },
    {
      name: 'Forms',
      title: 'Lead Generation forms',
      columns: [{ header: 'Form', width: 32 }, { header: 'Submissions', format: XL.int, width: 14 }, { header: 'New leads', format: XL.int }],
      rows: [...a.forms.rows.map((f) => [f.name, f.submissions, f.leadsCreated]), ['All forms', a.forms.submissions, a.forms.leadsCreated]],
    },
  ]
}
