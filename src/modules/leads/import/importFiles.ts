import type { ImportFailure } from '@/modules/leads/types'
import { TARGET_FIELDS, type CleanRow, type ImportLists, type TargetKey } from './importModel'

/** Excel downloads for the import wizard (template and error report), via write-excel-file. */

const HEADER = { fontWeight: 'bold' as const, backgroundColor: '#F4F4F6' }

async function writer() {
  return (await import('write-excel-file/browser')).default
}

/**
 * Template with every column, two example rows and a sheet of the allowed values — the active
 * lookup items (Settings > Fixed lists), by label.
 */
export async function downloadTemplate(lists: ImportLists): Promise<void> {
  const write = await writer()
  const pick = <T extends { label: string }>(list: T[], i: number) => list[Math.min(i, list.length - 1)]
  const ind1 = pick(lists.industries, 0)
  const ind2 = pick(lists.industries, 4)
  const listed = (i: number, ind?: (typeof lists.industries)[number]): Partial<Record<TargetKey, string>> => ({
    sourceType: pick(lists.sources, i)?.label ?? '',
    industry: ind?.label ?? '',
    subIndustry: ind?.subIndustries.find((s) => s.active)?.label ?? '',
    status: pick(lists.statuses, i)?.label ?? '',
  })
  const first = listed(0, ind1)
  const second: Partial<Record<TargetKey, string>> = {
    company: 'Gulf Star Logistics LLC',
    website: 'gulfstarlogistics.ae',
    contactName: 'Suresh Menon',
    contactTitle: 'Operations Director',
    mobile: '+971 55 987 6543',
    email: 'suresh@gulfstarlogistics.ae',
    isDecisionMaker: 'No',
    sourceDetail: 'linkedin.com/in/sureshmenon',
    owner: '',
    nextFollowUpDate: '2026-12-01',
    nextStep: '',
    value: '',
    companyServices: 'Sea freight, Customs clearance',
    recommendedService: 'Document OCR',
    notes: '',
    doNotContact: 'No',
    ...listed(3, ind2),
  }
  const leadsSheet = [
    TARGET_FIELDS.map((f) => ({ value: f.required ? `${f.label} *` : f.label, ...HEADER })),
    TARGET_FIELDS.map((f) => first[f.key] ?? f.example),
    TARGET_FIELDS.map((f) => second[f.key] ?? ''),
  ]
  const allowed: string[][] = [['Source', 'Industry', 'Sub-industries', 'Status']]
  const height = Math.max(lists.sources.length, lists.industries.length, lists.statuses.length)
  for (let i = 0; i < height; i++) {
    const ind = lists.industries[i]
    allowed.push([
      lists.sources[i]?.label ?? '',
      ind?.label ?? '',
      ind ? ind.subIndustries.filter((s) => s.active).map((s) => s.label).join(', ') : '',
      lists.statuses[i]?.label ?? '',
    ])
  }
  await write([
    { sheet: 'Leads', data: leadsSheet, columns: TARGET_FIELDS.map((f) => ({ width: Math.max(14, f.label.length + 4) })), stickyRowsCount: 1 },
    {
      sheet: 'Allowed values',
      data: allowed.map((r, i) => (i === 0 ? r.map((v) => ({ value: v, ...HEADER })) : r)),
      columns: [{ width: 18 }, { width: 24 }, { width: 48 }, { width: 18 }],
    },
  ]).toFile('lead-import-template.xlsx')
}

export interface ReportLine extends ImportFailure {
  outcome: 'Failed' | 'Skipped' | 'Imported with warnings'
}

/** Rows that weren't imported (or were cleaned), with the reason and the original cells. */
export async function downloadReport(lines: ReportLine[], rows: CleanRow[], fileName: string): Promise<void> {
  const write = await writer()
  const byRow = new Map(rows.map((r) => [r.data.row, r]))
  const header = ['Row', 'Outcome', 'Reason', ...TARGET_FIELDS.map((f) => f.label)].map((v) => ({ value: v, ...HEADER }))
  const data = [
    header,
    ...lines
      .sort((a, b) => a.row - b.row)
      .map((l) => {
        const raw = byRow.get(l.row)?.raw ?? {}
        return [l.row, l.outcome, l.reason, ...TARGET_FIELDS.map((f) => raw[f.key] ?? '')]
      }),
  ]
  const base = fileName.replace(/\.(xlsx|csv)$/i, '')
  await write(data, {
    sheet: 'Import report',
    columns: [{ width: 7 }, { width: 22 }, { width: 60 }, ...TARGET_FIELDS.map(() => ({ width: 18 }))],
    stickyRowsCount: 1,
  }).toFile(`${base}-import-report.xlsx`)
}
