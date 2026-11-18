import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ColumnDef } from '@tanstack/react-table'
import { FileSpreadsheet } from 'lucide-react'
import { useLookups } from '@/shared/hooks/useLookups'
import { fmtCompactMoney, fmtMoney } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { DataTable, useDataTable } from '@/shared/components/data-table'
import { useCustomReport } from '@/modules/reports/hooks/useReports'
import { DIMENSION_LABELS, MEASURE_LABELS } from '@/modules/reports/lib/reportCatalog'
import { downloadExcel } from '@/modules/reports/lib/exportExcel'
import { customSheet } from '@/modules/reports/lib/reportSheets'
import type { CustomDimension, CustomMeasure, CustomReportRow } from '@/modules/reports/types'
import type { DateRange } from '@/modules/reports/lib/dateRange'
import { AXIS_TICK, C, CURSOR, fmtInt, fmtPct, TOOLTIP_STYLE } from './chartKit'

interface Props {
  open: boolean
  onClose: () => void
  range: DateRange
  ownerId: string
  /** Department filter from the page ('' = none). */
  departmentId?: string
  /** "1 – 30 Nov 2026 · My team", shown and written into the export. */
  context: string
}

const DIMENSIONS = Object.keys(DIMENSION_LABELS) as CustomDimension[]
const MEASURES = Object.keys(MEASURE_LABELS) as CustomMeasure[]

function formatMeasure(measure: CustomMeasure, v: number, compact = false): string {
  if (measure === 'count') return fmtInt(v)
  if (measure === 'conversion') return fmtPct(v)
  return compact ? fmtCompactMoney(v) : fmtMoney(v)
}

export function ReportBuilderDrawer({ open, onClose, range, ownerId, departmentId, context }: Props) {
  const toast = useToast()
  const lookups = useLookups()
  const [dimension, setDimension] = useState<CustomDimension>('industry')
  const [measure, setMeasure] = useState<CustomMeasure>('count')
  const [exporting, setExporting] = useState(false)
  const input = open
    ? { dimension, measure, from: range.from, to: range.to, ...(ownerId ? { ownerId } : {}), ...(departmentId ? { departmentId } : {}) }
    : null
  const report = useCustomReport(input)
  const rows = useMemo(() => report.data?.rows ?? [], [report.data])
  const shown = report.data?.input.measure ?? measure

  const columns = useMemo<ColumnDef<CustomReportRow>[]>(
    () => [
      { accessorKey: 'label', header: DIMENSION_LABELS[report.data?.input.dimension ?? dimension], cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span> },
      { accessorKey: 'value', header: MEASURE_LABELS[shown], meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{formatMeasure(shown, getValue<number>())}</span> },
      { accessorKey: 'leads', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-muted">{getValue<number>()}</span> },
    ],
    [dimension, shown, report.data?.input.dimension],
  )
  const table = useDataTable({ id: 'reports-builder', data: rows, columns, defaultPageSize: 10 })

  async function exportExcel() {
    if (!report.data) return
    setExporting(true)
    try {
      await downloadExcel(`custom-report-${range.from}-to-${range.to}`, [customSheet(report.data)], context)
      toast.success('Excel file downloaded')
    } catch {
      toast.error('Couldn’t create the Excel file', 'Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="xl"
      title="Report builder"
      description={context}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" onClick={exportExcel} loading={exporting} disabled={!report.data || rows.length === 0}>
            <FileSpreadsheet />
            Export to Excel
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="builder-dimension" label="Group by">
          <SelectInput id="builder-dimension" value={dimension} onChange={(e) => setDimension(e.target.value as CustomDimension)}>
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {DIMENSION_LABELS[d]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <div>
          <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">Measure</p>
          <Tabs<CustomMeasure>
            variant="pill"
            label="Measure"
            value={measure}
            onChange={setMeasure}
            className="flex w-full flex-wrap"
            items={MEASURES.map((m) => ({ id: m, label: m === 'count' ? 'Count' : m === 'value' ? 'Value' : m === 'wonValue' ? 'Won value' : 'Conversion' }))}
          />
        </div>
      </div>

      <div className="mt-6 rounded-card border border-line p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[0.875rem] font-semibold">
            {MEASURE_LABELS[shown]} by {DIMENSION_LABELS[report.data?.input.dimension ?? dimension].toLowerCase()}
          </h3>
          {report.data && (
            <p className="text-[0.8125rem] text-muted">
              {shown === 'conversion' ? 'Overall' : 'Total'}: <span className="num font-medium text-ink">{formatMeasure(shown, report.data.total)}</span>
            </p>
          )}
        </div>
        {report.isPending ? (
          <Skeleton className="h-64" />
        ) : report.isError ? (
          <ErrorState message={report.error.message} onRetry={() => report.refetch()} />
        ) : (
          <div dir="ltr" className={report.isFetching ? 'h-64 opacity-60 transition-opacity' : 'h-64 transition-opacity'}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fontSize: '0.6875rem' }} interval={0} angle={-30} textAnchor="end" height={64} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={shown === 'value' || shown === 'wonValue' ? 72 : 40}
                  tick={AXIS_TICK}
                  allowDecimals={shown === 'conversion'}
                  tickFormatter={(v: number) => formatMeasure(shown, v, true)}
                />
                <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [formatMeasure(shown, v), MEASURE_LABELS[shown]]} />
                <Bar dataKey="value" name={MEASURE_LABELS[shown]} fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {rows.map((r) => (
                    <Cell key={r.key} fill={report.data?.input.dimension === 'status' ? lookups.status(r.key).color : C.brand} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mt-4">
        <DataTable table={table} minWidth={420} loading={report.isPending} />
      </div>
      <p className="mt-3 text-xs text-muted">
        Count, value and conversion use leads created in the period; won value uses deals won in the period.
      </p>
    </Drawer>
  )
}
