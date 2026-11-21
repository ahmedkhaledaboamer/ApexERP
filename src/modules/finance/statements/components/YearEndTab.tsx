import { useState } from 'react'
import { Lock, LockOpen, CalendarCheck } from 'lucide-react'
import { Amount, EntryLink, SimpleTable, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Field, TextArea, TextInput } from '@/shared/components/form/Field'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'
import { useCloseYear, useReopenYear, useYearEnd, useYearEndPreview } from '../api'
import type { FiscalYearRow } from '../types'

/**
 * Year-end close: fiscal years with their status, the closing-entry preview (every income / expense account to zero,
 * the result to retained earnings), close (Company Admin / Accountant: posts the entry on the last day and locks the
 * books up to it) and re-open (Company Admin, with a reason: reverses the entry, restores the lock date).
 */
export function YearEndTab() {
  const q = useYearEnd()
  const y = q.data
  const [selected, setSelected] = useState<string | null>(null)
  const [reopening, setReopening] = useState<FiscalYearRow | null>(null)
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  if (!y) return <Skeleton className="h-72" />
  const tone = (s: FiscalYearRow['status']) => (s === 'closed' ? 'green' : s === 'open' ? 'amber' : 'neutral')
  const label = (s: FiscalYearRow['status']) => (s === 'closed' ? 'Closed' : s === 'open' ? 'Ended, open' : 'In progress')
  return (
    <div className="space-y-6">
      <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
        <Lock className="size-4" aria-hidden />
        {y.lockDate ? <span>Books locked up to <strong className="text-ink">{fmtDate(y.lockDate)}</strong></span> : <span>No lock date set</span>}
        <span>· Fiscal year starts in month {y.fiscalYearStartMonth}</span>
        {y.retainedEarnings && <span>· Result goes to {y.retainedEarnings.code} {y.retainedEarnings.name}</span>}
      </p>
      <SimpleTable
        label="Fiscal years"
        head={<tr><th className={th}>Fiscal year</th><th className={th}>Period</th><th className={th}>Status</th><th className={thEnd}>Net profit ({y.currency})</th><th className={th}>Closing entry</th><th className={thEnd}>Actions</th></tr>}
      >
        {y.years.map((r) => (
          <tr key={r.end} className={cn(selected === r.end && 'bg-brand-50/50 dark:bg-brand-500/10')}>
            <td className={cn(td, 'font-medium')}>{r.label}</td>
            <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.start)} – {fmtDate(r.end)}</td>
            <td className={td}><Badge tone={tone(r.status)}>{label(r.status)}</Badge></td>
            <td className={tdEnd}><Amount value={r.netProfit} /></td>
            <td className={td}>{r.entryId && r.entryNumber ? <EntryLink id={r.entryId} number={r.entryNumber} /> : <span className="text-subtle">—</span>}</td>
            <td className={tdEnd}>
              <div className="flex justify-end gap-2">
                {r.status !== 'closed' && (
                  <Button size="xs" variant="secondary" onClick={() => setSelected(r.end)} aria-label={`Preview the close of ${r.label}`}>Preview</Button>
                )}
                {r.canReopen && (
                  <Button size="xs" variant="secondary" write onClick={() => setReopening(r)}>
                    <LockOpen aria-hidden /> Re-open
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </SimpleTable>
      {selected && <Preview end={selected} onDone={() => setSelected(null)} />}
      {y.history.length > 0 && (
        <Card>
          <CardHeader title="Close history" icon={<CalendarCheck />} />
          <CardBody>
            <ul className="divide-y divide-line text-[0.8125rem]" aria-label="Close history">
              {y.history.map((h) => (
                <li key={h.id} className="py-2">
                  <span className="font-medium">{fmtDate(h.fiscalYearStart)} – {fmtDate(h.fiscalYearEnd)}</span> closed by {h.closedByName} on {fmtDate(h.closedAt)}
                  {h.entryNumber && <> ({h.entryNumber})</>}
                  {h.status === 'reopened' && <span className="text-muted"> · re-opened by {h.reopenedByName} on {fmtDate(h.reopenedAt)}: {h.reopenReason}</span>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {reopening && <ReopenModal row={reopening} onClose={() => setReopening(null)} />}
    </div>
  )
}

function Preview({ end, onDone }: { end: string; onDone: () => void }) {
  const toast = useToast()
  const q = useYearEndPreview(end)
  const p = q.data
  const close = useCloseYear()
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader title={p ? `Closing entry preview · ${p.label}` : 'Closing entry preview'} description={p ? `Dated ${fmtDate(p.end)} · income and expense accounts to zero, the result to retained earnings` : undefined} icon={<CalendarCheck />} />
      <CardBody>
        {q.isError ? (
          <ErrorState message={errMsg(q.error)} />
        ) : !p ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="space-y-4">
            {p.lines.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">No income or expense to close in this year: closing only locks the books.</p>
            ) : (
              <SimpleTable
                label="Closing entry lines"
                head={<tr><th className={th}>Account</th><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th></tr>}
                foot={<tr><td className={td}>Total ({p.currency})</td><td className={tdEnd}><Amount value={p.totals.debit} /></td><td className={tdEnd}><Amount value={p.totals.credit} /></td></tr>}
              >
                {p.lines.map((l) => (
                  <tr key={l.accountId}>
                    <td className={td}><span className="num me-2 text-muted">{l.code}</span>{l.name}</td>
                    <td className={tdEnd}><Amount value={l.debit} blankZero /></td>
                    <td className={tdEnd}><Amount value={l.credit} blankZero /></td>
                  </tr>
                ))}
              </SimpleTable>
            )}
            <dl className="grid gap-2 text-[0.8125rem] sm:grid-cols-3">
              <div><dt className="text-xs text-muted">Net {p.netProfit >= 0 ? 'profit' : 'loss'}</dt><dd><Amount value={p.netProfit} currency={p.currency} strong /></dd></div>
              <div><dt className="text-xs text-muted">Lock date now</dt><dd>{p.lockDate ? fmtDate(p.lockDate) : 'None'}</dd></div>
              <div><dt className="text-xs text-muted">Lock date after the close</dt><dd>{p.newLockDate ? fmtDate(p.newLockDate) : 'None'}</dd></div>
            </dl>
            {p.blockedReason && <p role="note" className="text-[0.8125rem] text-warning-700 dark:text-warning-500">{p.blockedReason}</p>}
            <div className="flex gap-2">
              <Button write disabled={!p.canClose} onClick={() => { setError(null); setConfirm(true) }}>
                <Lock aria-hidden /> Close {p.label}
              </Button>
              <Button variant="ghost" onClick={onDone}>Cancel</Button>
            </div>
          </div>
        )}
      </CardBody>
      {p && (
        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          title={`Close ${p.label}?`}
          description={`Posts the closing entry on ${fmtDate(p.end)} and locks the books up to ${fmtDate(p.newLockDate)}. Only a Company Admin can re-open it.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                write
                loading={close.isPending}
                onClick={() =>
                  close.mutate(
                    { fiscalYearEnd: p.end, note: note.trim() || undefined },
                    {
                      onSuccess: (r) => {
                        toast.success(`${p.label} closed`, r.lockDate ? `Books locked up to ${fmtDate(r.lockDate)}` : undefined)
                        setConfirm(false)
                        onDone()
                      },
                      onError: (e) => setError(e.message),
                    },
                  )
                }
              >
                Close the year
              </Button>
            </>
          }
        >
          <Field id="ye-note" label="Note (optional)"><TextInput id="ye-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Audited accounts signed" /></Field>
          {error && <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">{error}</p>}
        </Modal>
      )}
    </Card>
  )
}

function ReopenModal({ row, onClose }: { row: FiscalYearRow; onClose: () => void }) {
  const toast = useToast()
  const reopen = useReopenYear()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Re-open ${row.label}?`}
      description="Reverses the closing entry and moves the lock date back to where it was before the close. Audited."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            write
            variant="danger"
            loading={reopen.isPending}
            disabled={!reason.trim()}
            onClick={() =>
              reopen.mutate({ id: row.closeId!, reason: reason.trim() }, { onSuccess: () => { toast.success(`${row.label} re-opened`); onClose() }, onError: (e) => setError(e.message) })
            }
          >
            Re-open the year
          </Button>
        </>
      }
    >
      <Field id="ye-reason" label="Reason (audit log)" required><TextArea id="ye-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {error && <p role="alert" className="mt-2 text-[0.8125rem] text-danger-600">{error}</p>}
    </Modal>
  )
}
