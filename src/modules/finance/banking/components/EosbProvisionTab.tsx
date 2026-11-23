import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import * as m from '@/shared/api/financeBankingMappers'
import { useBankingOn } from '@/modules/finance/banking/api'
import { Amount, EntryLink, SimpleTable, errMsg, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SelectInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * Banking › EOSB provision: the monthly end-of-service accrual (Dr 6120 / Cr 2500 from the HR gratuity calculator),
 * opening / charge / used / closing per year; per employee for accounting full only. "Accrue" posts a closed month
 * (idempotent: an accrued month answers "already posted").
 */
export function EosbProvisionTab() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  const qc = useQueryClient()
  const toast = useToast()
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const q = useQuery({
    queryKey: ['finance', 'banking', uid, 'eosb', year],
    queryFn: async () => m.eosbProvisionMapper.fromApi((await http.get<unknown>(`/finance/eosb-provision?year=${year}`)).data),
    enabled: useBankingOn(),
    retry: false,
  })
  const run = useMutation({
    mutationFn: async (month: string) => m.eosbRunMapper.fromApi((await http.post<unknown>('/finance/eosb-provision/run', { month })).data),
    onSuccess: (r) => {
      toast.success(r.alreadyPosted ? `${monthName(r.month)} was already accrued` : `End-of-service provision accrued through ${monthName(r.month)}`)
      void qc.invalidateQueries({ queryKey: ['finance'] })
    },
    onError: (e) => toast.error('Not accrued', errMsg(e)),
  })
  if (q.isLoading) return <Skeleton className="h-64" />
  if (q.error) return <ErrorState message={`Couldn’t load the provision: ${errMsg(q.error)}`} onRetry={() => void q.refetch()} />
  const r = q.data!
  const years = [...new Set([r.year, String(Number(r.lastClosedMonth.slice(0, 4))), String(Number(r.lastClosedMonth.slice(0, 4)) - 1)])].sort().reverse()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="me-auto text-base font-semibold text-ink">End-of-service benefits provision</h2>
        <SelectInput aria-label="Year" className="w-28" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </SelectInput>
        {r.canRun && (
          <Button write loading={run.isPending} onClick={() => run.mutate(r.lastClosedMonth)}>Accrue {monthName(r.lastClosedMonth)}</Button>
        )}
      </div>
      <p className="text-[0.8125rem] text-muted">
        Each month the gratuity every employee has earned (UAE / KSA labour law, from the HR payroll calculator) is accrued: Dr 6120 End-of-service benefits / Cr 2500 provision. A final settlement uses the employee’s provision and only the difference is expensed.
      </p>
      <div className="grid grid-cols-2 gap-3 text-[0.8125rem] sm:grid-cols-5">
        {(
          [
            ['Opening', r.totals.opening],
            ['Charge', r.totals.charge],
            ['Used', r.totals.used],
            ['Closing', r.totals.closing],
            ['Ledger 2500', r.ledgerBalance],
          ] as [string, number][]
        ).map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line p-3">
            <p className="text-xs text-muted">{k} ({r.baseCurrency})</p>
            <p className="num font-semibold"><Amount value={v} /></p>
          </div>
        ))}
      </div>
      <SimpleTable label="Monthly accruals" head={<tr><th className={th}>Month</th><th className={th}>Status</th><th className={th}>Entry</th><th className={thEnd}>Employees</th><th className={thEnd}>Charge</th></tr>}>
        {r.months.map((x) => (
          <tr key={x.month}>
            <td className={td}>{monthName(x.month)}</td>
            <td className={td}>{x.status === 'posted' ? <Badge tone="green">Posted</Badge> : x.status === 'skipped_locked' ? <Badge tone="amber">Locked</Badge> : <Badge tone="neutral">Nothing</Badge>}</td>
            <td className={td}>{x.entryId ? <EntryLink id={x.entryId} number={x.entryNumber ?? x.entryId} /> : '—'}</td>
            <td className={`${tdEnd} num`}>{x.employees}</td>
            <td className={`${tdEnd} num`}><Amount value={x.charge} /></td>
          </tr>
        ))}
      </SimpleTable>
      {r.rows ? (
        <SimpleTable label="Provision per employee" head={<tr><th className={th}>Employee</th><th className={th}>Department</th><th className={thEnd}>Opening</th><th className={thEnd}>Charge</th><th className={thEnd}>Used</th><th className={thEnd}>Closing</th></tr>}>
          {r.rows.map((x) => (
            <tr key={x.employeeId}>
              <td className={td}>{x.employeeName}</td>
              <td className={td}>{x.departmentName || '—'}</td>
              <td className={`${tdEnd} num`}><Amount value={x.opening} /></td>
              <td className={`${tdEnd} num`}><Amount value={x.charge} /></td>
              <td className={`${tdEnd} num`}><Amount value={x.used} /></td>
              <td className={`${tdEnd} num`}><Amount value={x.closing} /></td>
            </tr>
          ))}
        </SimpleTable>
      ) : (
        <p className="text-[0.8125rem] text-muted">Amounts per employee are visible to the finance team with full access.</p>
      )}
    </div>
  )
}
