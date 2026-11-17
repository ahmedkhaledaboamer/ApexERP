import type { Row, SheetData } from 'write-excel-file/browser'
import type { AuditEntry } from '@/modules/settings/types'
import { fmtDate } from '@/shared/lib/utils'
import { ACTION_LABEL, entityLabel, fieldLabel } from './auditLabels'

const COLUMNS = [
  { header: 'Time', width: 20 },
  { header: 'User', width: 22 },
  { header: 'Action', width: 14 },
  { header: 'Entity', width: 26 },
  { header: 'Record', width: 14 },
  { header: 'Summary', width: 60 },
  { header: 'Changes', width: 70 },
]

/** Builds the audit log as an .xlsx in the browser and downloads it. The library loads on demand. */
export async function downloadAuditExcel(entries: AuditEntry[], subtitle: string): Promise<void> {
  const span = COLUMNS.length
  const pad = (value: string, extra: object = {}): Row => [{ value, columnSpan: span, ...extra }, ...Array.from({ length: span - 1 }, () => null)]
  const header: Row = COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold',
    backgroundColor: '#F4F4F6',
    bottomBorderStyle: 'thin',
    bottomBorderColor: '#DCDCE2',
  }))
  const body: Row[] = entries.map((e) => [
    { value: fmtDate(e.at, 'yyyy-MM-dd HH:mm'), type: String },
    { value: e.userName, type: String },
    { value: ACTION_LABEL[e.action] ?? e.action, type: String },
    { value: entityLabel(e.entity), type: String },
    { value: e.entityId, type: String },
    { value: e.summary, type: String },
    e.changes.length
      ? { value: e.changes.map((c) => `${fieldLabel(c.field)}: ${c.from} → ${c.to}`).join('\n'), type: String, wrap: true }
      : null,
  ])
  const data: SheetData = [pad('Audit log', { fontWeight: 'bold', fontSize: 14 }), pad(subtitle, { textColor: '#6E6E7A' }), [], header, ...body]

  const { default: writeExcelFile } = await import('write-excel-file/browser')
  await writeExcelFile([{ data, sheet: 'Audit log', columns: COLUMNS.map((c) => ({ width: c.width })), stickyRowsCount: 4 }], {
    fontFamily: 'Calibri',
    fontSize: 11,
  }).toFile(`audit-log-${fmtDate(new Date().toISOString(), 'yyyy-MM-dd')}.xlsx`)
}
