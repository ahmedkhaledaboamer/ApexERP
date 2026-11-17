import type { ReactNode } from 'react'
import { Card } from '@/shared/components/ui/Card'
import { REPORT_DESCRIPTIONS, REPORT_TITLES } from '@/modules/reports/lib/reportCatalog'
import type { ReportId } from '@/modules/reports/types'

/** Frame for one ready-made report: titled chart card, then its tables. */
export function ReportCard({
  id,
  action,
  chart,
  children,
}: {
  id: ReportId
  action?: ReactNode
  chart: ReactNode
  children?: ReactNode
}) {
  return (
    <section aria-labelledby={`report-${id}-title`} className="space-y-4">
      <Card className="p-1 print:break-inside-avoid print:shadow-none">
        <div className="flex flex-wrap items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 id={`report-${id}-title`} className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
              {REPORT_TITLES[id]}
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted">{REPORT_DESCRIPTIONS[id]}</p>
          </div>
          {action && <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">{action}</div>}
        </div>
        <div className="px-5 pb-5">{chart}</div>
      </Card>
      {children}
    </section>
  )
}
