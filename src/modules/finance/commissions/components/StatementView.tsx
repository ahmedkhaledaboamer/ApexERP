import type { CommissionStatement } from '@/modules/finance/commissions/types'
import { COMMISSION_BASIS_LABEL, COMMISSION_STATUS_LABEL } from '@/modules/finance/commissions/types'
import { Amount, EntryLink, SimpleTable, fmtDate, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { Badge, type Tone } from '@/shared/components/ui/Badge'

const TONE: Record<CommissionStatement['status'], Tone> = { pending_manager: 'amber', pending_accountant: 'sky', approved: 'green', rejected: 'red' }
export function StatementStatus({ s }: { s: CommissionStatement }) {
  return <Badge tone={TONE[s.status]}>{COMMISSION_STATUS_LABEL[s.status]}</Badge>
}

/** A statement's calculation detail: per invoice / deal, clawbacks, totals, approvals and where it was posted. */
export function StatementView({ s }: { s: CommissionStatement }) {
  return (
    <div className="space-y-4 text-[0.8125rem]">
      <div className="flex flex-wrap items-center gap-2">
        <StatementStatus s={s} />
        <span className="text-muted">{s.number} · {monthName(s.month)} · {s.planName} ({COMMISSION_BASIS_LABEL[s.basis]})</span>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Target achievement', `${s.achievement.toFixed(1)} %`],
          ['Rate', `${s.rate} %`],
          ['Commissionable', <Amount key="b" value={s.baseTotal} currency={s.currency} />],
          ['Commission', <Amount key="t" value={s.total} currency={s.currency} strong />],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num mt-0.5 font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {s.capped && <p className="text-muted">Capped at the plan’s monthly maximum (gross {s.gross.toFixed(2)}).</p>}
      {s.lines.length ? (
        <SimpleTable label="Commission detail" head={<tr><th className={th}>Document</th><th className={th}>Customer</th><th className={th}>Date</th><th className={thEnd}>Base</th><th className={thEnd}>Rate</th><th className={thEnd}>Commission</th></tr>}>
          {s.lines.map((l) => (
            <tr key={`${l.kind}-${l.refId}`}>
              <td className={td}>{l.kind === 'clawback' ? <Badge tone="red">Clawback</Badge> : null} {l.refNumber}<div className="text-xs text-muted">{l.note}</div></td>
              <td className={td}>{l.customerName}</td>
              <td className={td}>{fmtDate(l.date)}</td>
              <td className={tdEnd}><Amount value={l.baseAmount} /></td>
              <td className={tdEnd}>{l.rate} %</td>
              <td className={tdEnd}><Amount value={l.kind === 'clawback' ? -l.commission : l.commission} /></td>
            </tr>
          ))}
        </SimpleTable>
      ) : <p className="text-muted">Nothing commissionable this month.</p>}
      <ul className="space-y-0.5 text-muted">
        {s.approvals.map((a) => <li key={a.step}>{a.step === 'sales_manager' ? 'Sales Manager' : 'Accountant'} approval: {a.userName} · {fmtDate(a.at)}</li>)}
        {s.rejectedReason && <li className="text-danger-600">Rejected: {s.rejectedReason}</li>}
        {s.journalEntryId && <li>Posted: <EntryLink id={s.journalEntryId} number={s.journalNumber ?? ''} /></li>}
        {s.payrollMonth && <li>Paid with the payroll of {monthName(s.payrollMonth)}</li>}
        {s.payrollNote && <li>{s.payrollNote}</li>}
      </ul>
    </div>
  )
}
