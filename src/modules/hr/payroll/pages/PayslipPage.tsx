import { Link, useParams } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Payslip } from '@/modules/hr/payroll/types'
import { ArrowLeft, Printer } from 'lucide-react'
import { monthLabel } from '@/modules/hr/payroll/calc'
import { usePayslip } from '@/modules/hr/payroll/api'
import { PAY_METHOD_LABEL } from '@/modules/hr/payroll/types'
import { HrError } from '@/modules/hr/components/PeopleBits'
import { fmt2 } from '@/modules/hr/payroll/components/bits'
import { PATHS } from '@/app/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'

/** `/hr/salary/payslips/:id`: a printable payslip (browser print, A4 portrait). Own payslip, or any for HR full. */
export default function PayslipPage() {
  const { id = '' } = useParams()
  return <PayslipScreen q={usePayslip(id)} backTo={`${PATHS.hrSalary}?tab=payslips`} backLabel="Payslips" />
}

/** The printable payslip for a query result; also used by the My HR portal (`/hr/me/payslips/:id`, own payslips for any role). */
export function PayslipScreen({ q, backTo, backLabel }: { q: UseQueryResult<Payslip, Error>; backTo: string; backLabel: string }) {
  const p = q.data
  return (
    <PageBody className="max-w-4xl">
      <PrintStyles orientation="portrait" margin="14mm" />
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link to={backTo} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {backLabel}
        </Link>
        <Button variant="secondary" onClick={() => window.print()} disabled={!p}>
          <Printer />
          Print
        </Button>
      </div>
      {q.error ? (
        <HrError error={q.error} onRetry={() => q.refetch()} />
      ) : !p ? (
        <Skeleton className="h-[32rem]" />
      ) : (
        <article aria-label={`Payslip ${monthLabel(p.month)}`} className="rounded-2xl border border-line bg-surface p-6 shadow-xs print:border-0 print:p-0 print:shadow-none sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{p.company.name}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Payslip · {monthLabel(p.month)}</h1>
              <p className="mt-1 text-[0.8125rem] text-muted">Period {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)} · paid {fmtDate(p.payDate)}</p>
            </div>
            <div className="text-end">
              <p className="text-xs text-muted">Net pay</p>
              <p className="num text-3xl font-semibold text-ink">{p.currency} {fmt2(p.net)}</p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line py-5 text-[0.8125rem] sm:grid-cols-4">
            {[
              ['Employee', p.employeeName],
              ['Employee no.', p.employeeNo],
              ['Job title', p.jobTitle],
              ['Department', p.departmentName ?? '—'],
              ['Days paid', `${p.paidDays} of ${p.daysInMonth}`],
              ['Unpaid leave / absence', `${p.unpaidLeaveDays} / ${p.absenceDays} days`],
              ['Paid by', PAY_METHOD_LABEL[p.payMethod]],
              ['Account', p.payMethod === 'bank' ? `${p.bankName} ${p.ibanMasked}`.trim() || '—' : '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="num mt-0.5 font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-6 py-5 sm:grid-cols-2">
            {(['earning', 'deduction'] as const).map((t) => {
              const items = p.items.filter((i) => i.type === t)
              const total = t === 'earning' ? p.gross : p.totalDeductions
              return (
                <section key={t} aria-label={t === 'earning' ? 'Earnings' : 'Deductions'}>
                  <h2 className="mb-2 text-[0.8125rem] font-semibold text-ink">{t === 'earning' ? 'Earnings' : 'Deductions'}</h2>
                  <table className="w-full text-[0.8125rem]">
                    <tbody className="divide-y divide-line">
                      {items.length ? (
                        items.map((i) => (
                          <tr key={i.code}>
                            <td className="py-1.5 pe-3 text-ink-2">
                              {i.label}
                              {i.note && <span className="block text-xs text-muted">{i.note}</span>}
                            </td>
                            <td className="num py-1.5 text-end">{fmt2(i.amount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td className="py-1.5 text-muted">None</td><td /></tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line-strong font-semibold">
                        <td className="py-2">{t === 'earning' ? 'Gross pay' : 'Total deductions'}</td>
                        <td className="num py-2 text-end">{fmt2(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </section>
              )
            })}
          </div>

          {p.items.some((i) => i.type === 'reimbursement') && (
            <section aria-label="Reimbursements" className="border-t border-line py-4">
              <h2 className="mb-2 text-[0.8125rem] font-semibold text-ink">Reimbursements (expense claims, not taxable)</h2>
              <ul className="space-y-1 text-[0.8125rem]">
                {p.items.filter((i) => i.type === 'reimbursement').map((i) => (
                  <li key={i.code} className="flex justify-between gap-3"><span className="text-ink-2">{i.label}</span><span className="num">{fmt2(i.amount)}</span></li>
                ))}
              </ul>
            </section>
          )}

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-muted">
            <span>Employer social insurance contribution (not deducted): {p.currency} {fmt2(p.employerSocialInsurance)}</span>
            <span className="num">{p.id} · {p.runId}</span>
          </footer>
        </article>
      )}
    </PageBody>
  )
}
