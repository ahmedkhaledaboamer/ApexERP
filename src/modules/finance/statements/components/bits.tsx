import type { ReactNode } from 'react'
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react'
import type { ExportSheet } from '@/modules/reports/lib/exportExcel'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { downloadCsv } from '@/modules/platform/csv'
import { Button } from '@/shared/components/ui/Button'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'
import type { PeriodQuery } from '../api'
import type { PeriodKind, StatementLetterhead } from '../types'
import { sheetToCsv } from '../exports'

/** Shared pieces of the statements screens: period picker, export / print bar, printed letterhead, statement rows. */

export const PERIOD_LABEL: Record<PeriodKind, string> = { month: 'Month', quarter: 'Quarter', ytd: 'Year to date', fiscal_year: 'Fiscal year', custom: 'Custom' }

export function PeriodPicker({ id, value, onChange, today }: { id: string; value: PeriodQuery; onChange: (v: PeriodQuery) => void; today: string }) {
  return (
    <>
      <Field id={`${id}-period`} label="Period">
        <SelectInput id={`${id}-period`} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKind })}>
          {(Object.keys(PERIOD_LABEL) as PeriodKind[]).map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
        </SelectInput>
      </Field>
      {value.period === 'custom' ? (
        <>
          <Field id={`${id}-from`} label="From"><TextInput id={`${id}-from`} type="date" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} /></Field>
          <Field id={`${id}-to`} label="To"><TextInput id={`${id}-to`} type="date" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} /></Field>
        </>
      ) : (
        <Field id={`${id}-date`} label={value.period === 'ytd' ? 'Up to' : 'Containing'}>
          <TextInput id={`${id}-date`} type="date" value={value.date ?? today} onChange={(e) => onChange({ ...value, date: e.target.value || undefined })} />
        </Field>
      )}
    </>
  )
}

/** CSV, Excel and print (browser print → PDF) for the statement on screen. */
export function ExportBar({ sheet, fileBase, subtitle }: { sheet: ExportSheet | null; fileBase: string; subtitle: string }) {
  const toast = useToast()
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="secondary" size="sm" disabled={!sheet} onClick={() => sheet && downloadCsv(`${fileBase}.csv`, sheetToCsv(sheet))}>
        <FileDown aria-hidden /> CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!sheet}
        onClick={() => sheet && void downloadExcel(fileBase, [sheet], subtitle).catch(() => toast.error('Export failed', 'The Excel file could not be built.'))}
      >
        <FileSpreadsheet aria-hidden /> Excel
      </Button>
      <Button variant="secondary" size="sm" onClick={() => window.print()}>
        <Printer aria-hidden /> Print / PDF
      </Button>
    </div>
  )
}

/** Company letterhead, printed only (legal name, address, tax number) above the statement title. */
export function Letterhead({ lh, title, subtitle }: { lh: StatementLetterhead | undefined; title: string; subtitle: string }) {
  if (!lh) return null
  return (
    <header className="mb-4 hidden items-start justify-between gap-4 border-b border-line pb-4 print:flex" aria-label="Letterhead">
      <div className="flex items-start gap-3">
        {lh.logoUrl ? <img src={lh.logoUrl} alt="" className="h-12 w-auto max-w-40 object-contain" /> : <span className="grid size-12 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-white">{lh.monogram}</span>}
        <div>
          <p className="font-semibold text-ink">{lh.legalName}</p>
          {lh.addressLines.map((l) => <p key={l} className="text-xs text-muted">{l}</p>)}
          {lh.taxNumber && <p className="text-xs text-muted">{lh.taxLabel} {lh.taxNumber}</p>}
        </div>
      </div>
      <div className="text-end">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        <p className="text-[0.8125rem] text-muted">{subtitle}</p>
      </div>
    </header>
  )
}

/* ---------------- statement table rows ---------------- */

export const cellNum = 'px-3 py-1.5 text-end whitespace-nowrap num'
export const cellLabel = 'px-3 py-1.5'

export function SectionRow({ label, span }: { label: string; span: number }) {
  return (
    <tr className="bg-sunken/40">
      <th scope="rowgroup" colSpan={span} className="px-3 pt-3 pb-1 text-start text-xs font-semibold tracking-wide text-muted uppercase">{label}</th>
    </tr>
  )
}

export function TotalRow({ label, children, strong, tone }: { label: ReactNode; children: ReactNode; strong?: boolean; tone?: 'brand' }) {
  return (
    <tr className={cn('font-semibold', strong && 'border-t-2 border-line-strong', tone === 'brand' && 'bg-brand-50/60 dark:bg-brand-500/10')}>
      <th scope="row" className={cn(cellLabel, 'text-start font-semibold')}>{label}</th>
      {children}
    </tr>
  )
}

export function PctCell({ now, before }: { now: number; before: number }) {
  if (before === 0) return <td className={cn(cellNum, 'text-subtle')}>—</td>
  const p = Math.round(((now - before) / Math.abs(before)) * 1000) / 10
  return <td className={cn(cellNum, 'text-xs', p > 0 ? 'text-success-700 dark:text-success-500' : p < 0 ? 'text-danger-600' : 'text-muted')}>{p > 0 ? '+' : ''}{p.toFixed(1)}%</td>
}
