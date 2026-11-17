import type { CellObject, Row, Sheet, SheetData } from 'write-excel-file/browser'

export type ExportCell = string | number | null

export interface ExportColumn {
  header: string
  /** Width in characters. */
  width?: number
  /** Excel number format for numeric cells, e.g. `#,##0` or `0.0"%"`. */
  format?: string
}

/** One worksheet: a title block, a header row and plain values. */
export interface ExportSheet {
  name: string
  title: string
  columns: ExportColumn[]
  rows: ExportCell[][]
}

export const XL = { money: '#,##0', int: '#,##0', pct: '0.0"%"', hours: '0.0' }

const INVALID = /[[\]:*?/\\]/g

function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(INVALID, ' ').slice(0, 31).trim() || 'Sheet'
  let candidate = base
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base.slice(0, 28)} ${n}`
  used.add(candidate.toLowerCase())
  return candidate
}

function toData(sheet: ExportSheet, subtitle: string): SheetData {
  const span = Math.max(1, sheet.columns.length)
  const pad = (cell: CellObject): Row => [cell, ...Array.from({ length: span - 1 }, () => null)]
  const header: Row = sheet.columns.map((c) => ({
    value: c.header,
    fontWeight: 'bold',
    backgroundColor: '#F4F4F6',
    bottomBorderStyle: 'thin',
    bottomBorderColor: '#DCDCE2',
    align: c.format ? 'right' : 'left',
  }))
  const body: Row[] = sheet.rows.map((r) =>
    r.map((v, i) => {
      if (v === null || v === '') return null
      if (typeof v === 'number') return { value: v, type: Number, format: sheet.columns[i]?.format ?? XL.int }
      return { value: v, type: String }
    }),
  )
  return [
    pad({ value: sheet.title, fontWeight: 'bold', fontSize: 14, columnSpan: span }),
    pad({ value: subtitle, textColor: '#6E6E7A', columnSpan: span }),
    [],
    header,
    ...body,
  ]
}

/** The workbook as write-excel-file sheets: one per report table. */
export function buildWorkbook(sheets: ExportSheet[], subtitle: string): Sheet<Blob>[] {
  const used = new Set<string>()
  return sheets.map((s) => ({
    data: toData(s, subtitle),
    sheet: sheetName(s.name, used),
    columns: s.columns.map((c) => ({ width: c.width ?? Math.max(12, c.header.length + 4) })),
    stickyRowsCount: 4,
  }))
}

/** Builds the .xlsx in the browser and triggers the download. */
export async function downloadExcel(fileName: string, sheets: ExportSheet[], subtitle: string): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  await writeExcelFile(buildWorkbook(sheets, subtitle), { fontFamily: 'Calibri', fontSize: 11 }).toFile(
    fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`,
  )
}
