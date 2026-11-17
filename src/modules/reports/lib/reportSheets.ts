import { format, parseISO } from 'date-fns'
import { ACTIVITY_LABELS, ACTIVITY_TYPES } from '@/shared/lib/constants'
import type { CustomReport, ReportId, SalesReport } from '@/modules/reports/types'
import { DIMENSION_LABELS, MEASURE_LABELS, REPORT_TITLES } from '@/modules/reports/lib/reportCatalog'
import { XL, type ExportSheet } from '@/modules/reports/lib/exportExcel'

const d = (iso: string) => format(parseISO(iso), 'd MMM yyyy')

/** Worksheet(s) for one ready-made report; the same rows the on-screen tables show. */
export function sheetsFor(id: ReportId, r: SalesReport): ExportSheet[] {
  const title = REPORT_TITLES[id]
  switch (id) {
    case 'status':
      return [
        {
          name: 'By status',
          title,
          columns: [{ header: 'Status', width: 18 }, { header: 'Leads', format: XL.int }, { header: 'Share', format: XL.pct }, { header: 'Value (AED)', format: XL.money, width: 16 }],
          rows: r.byStatus.map((s) => [s.label, s.count, s.share, s.value]),
        },
        {
          name: 'Stage conversion',
          title: 'Stage conversion, New → Won',
          columns: [{ header: 'Stage', width: 16 }, { header: 'Reached', format: XL.int }, { header: 'From previous', format: XL.pct, width: 16 }, { header: 'From New', format: XL.pct }],
          rows: r.funnel.map((f) => [f.label, f.reached, f.fromPrevious, f.fromStart]),
        },
      ]
    case 'industry':
      return [
        {
          name: 'By industry',
          title,
          columns: [
            { header: 'Industry', width: 24 },
            { header: 'Sub-industry', width: 22 },
            { header: 'Leads', format: XL.int },
            { header: 'Value (AED)', format: XL.money, width: 16 },
            { header: 'Won', format: XL.int },
            { header: 'Win rate', format: XL.pct },
          ],
          rows: r.byIndustry.flatMap((i) => [
            [i.label, 'All', i.leads, i.value, i.won, i.winRate],
            ...i.subIndustries.filter((s) => s.leads > 0).map((s) => [i.label, s.label, s.leads, s.value, s.won, s.winRate]),
          ]),
        },
      ]
    case 'source':
      return [
        {
          name: 'By source',
          title,
          columns: [
            { header: 'Source', width: 18 },
            { header: 'Leads', format: XL.int },
            { header: 'Won', format: XL.int },
            { header: 'Lost', format: XL.int },
            { header: 'Win rate', format: XL.pct },
            { header: 'Value (AED)', format: XL.money, width: 16 },
            { header: 'Won value (AED)', format: XL.money, width: 18 },
          ],
          rows: r.bySource.map((s) => [s.label, s.leads, s.won, s.lost, s.winRate, s.value, s.wonValue]),
        },
        {
          name: 'Source details',
          title: 'Source detail breakdown',
          columns: [{ header: 'Source', width: 18 }, { header: 'Detail', width: 36 }, { header: 'Leads', format: XL.int }, { header: 'Won', format: XL.int }, { header: 'Value (AED)', format: XL.money, width: 16 }],
          rows: r.bySource.flatMap((s) => s.details.map((x) => [s.label, x.detail, x.leads, x.won, x.value])),
        },
      ]
    case 'funnel':
      return [
        {
          name: 'Conversion over time',
          title,
          columns: [{ header: 'Month', width: 12 }, { header: 'Created', format: XL.int }, { header: 'Won', format: XL.int }, { header: 'Won value (AED)', format: XL.money, width: 18 }, { header: 'Conversion', format: XL.pct }],
          rows: r.funnelMonthly.map((m) => [m.label, m.created, m.won, m.wonValue, m.conversion]),
        },
      ]
    case 'agents':
      return [
        {
          name: 'Agent performance',
          title,
          columns: [
            { header: 'Agent', width: 20 },
            { header: 'Leads', format: XL.int },
            ...ACTIVITY_TYPES.map((t) => ({ header: ACTIVITY_LABELS[t], format: XL.int })),
            { header: 'Activities', format: XL.int },
            { header: 'Proposals', format: XL.int },
            { header: 'Won', format: XL.int },
            { header: 'Won value (AED)', format: XL.money, width: 18 },
            { header: 'Conversion', format: XL.pct },
            { header: 'Avg response (h)', format: XL.hours, width: 18 },
          ],
          rows: r.agents.map((a) => [
            a.name,
            a.leads,
            ...ACTIVITY_TYPES.map((t) => a.activities[t]),
            a.totalActivities,
            a.proposals,
            a.won,
            a.wonValue,
            a.conversion,
            a.avgResponseHours,
          ]),
        },
      ]
    case 'targets': {
      const keys = r.targets.rows[0]?.cells ?? []
      return [
        {
          name: 'Target completion',
          title: `${title} · ${r.targets.monthLabel}`,
          columns: [
            { header: 'Agent', width: 20 },
            ...keys.flatMap((c) => [
              { header: `${c.label} actual`, format: XL.int, width: 14 },
              { header: `${c.label} target`, format: XL.int, width: 14 },
            ]),
            { header: 'Overall', format: XL.pct },
          ],
          rows: r.targets.rows.map((row) => [row.name, ...row.cells.flatMap((c) => [c.actual, c.target]), row.overall]),
        },
      ]
    }
    case 'overdue':
      return [
        {
          name: 'Overdue follow-ups',
          title: 'Overdue follow-ups',
          columns: [{ header: 'Lead', width: 30 }, { header: 'Status', width: 14 }, { header: 'Owner', width: 20 }, { header: 'Due', width: 14 }, { header: 'Days overdue', format: XL.int, width: 14 }, { header: 'Next step', width: 44 }],
          rows: r.overdueFollowUps.map((f) => [f.company, f.status, f.ownerName, d(f.dueDate), f.daysOverdue, f.nextStep]),
        },
        {
          name: 'Overdue tasks',
          title: 'Overdue tasks',
          columns: [{ header: 'Task', width: 32 }, { header: 'Lead', width: 30 }, { header: 'Owner', width: 20 }, { header: 'Due', width: 14 }, { header: 'Days overdue', format: XL.int, width: 14 }, { header: 'Priority' }, { header: 'Status', width: 14 }],
          rows: r.overdueTasks.map((t) => [t.title, t.company, t.ownerName, d(t.dueDate), t.daysOverdue, t.priority, t.status]),
        },
      ]
  }
}

export function customSheet(r: CustomReport): ExportSheet {
  const { dimension, measure } = r.input
  const fmt = measure === 'conversion' ? XL.pct : measure === 'count' ? XL.int : XL.money
  return {
    name: 'Custom report',
    title: `${MEASURE_LABELS[measure]} by ${DIMENSION_LABELS[dimension].toLowerCase()}`,
    columns: [{ header: DIMENSION_LABELS[dimension], width: 24 }, { header: MEASURE_LABELS[measure], format: fmt, width: 22 }, { header: 'Leads', format: XL.int }],
    rows: [...r.rows.map((x) => [x.label, x.value, x.leads]), ['Total', r.total, r.rows.reduce((s, x) => s + x.leads, 0)]],
  }
}
