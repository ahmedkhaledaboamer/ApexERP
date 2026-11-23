import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Landmark, Send, CheckCircle2 } from 'lucide-react'
import type { PaymentRun, PaymentRunBankStatus } from '@/modules/finance/purchases/types'
import { PAYMENT_RUN_BANK_STATUS_LABEL } from '@/modules/finance/purchases/types'
import { PAYMENT_FILE_TEMPLATE_DEF } from '@/modules/finance/purchases/bankFile'
import { downloadTextFile, purchasesApi, usePaymentRuns, usePurchasesMutation } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, errMsg, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { fmtDay, fmtWhen } from './bits'
import { financeBillVoucherPath } from '@/app/paths'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'

const TONE: Record<PaymentRunBankStatus, Tone> = { created: 'neutral', sent: 'amber', confirmed: 'green' }

/**
 * Bills › Payment runs: each run's vouchers and its bank upload — "Bank file" downloads the bank's CSV (the bank
 * account's template for local transfers, SWIFT MT103-lite for foreign currency; full IBANs only in the file, audited,
 * accounting full), then "Mark sent to bank" and "Confirm" once the bank has executed it.
 */
export function PaymentRunsTab({ canWrite }: { canWrite: boolean }) {
  const runs = usePaymentRuns()
  const toast = useToast()
  const [skipped, setSkipped] = useState<Record<string, string[]>>({})
  const file = usePurchasesMutation((id: string) => purchasesApi.runBankFile(id))
  const status = usePurchasesMutation((a: { id: string; action: 'sent' | 'confirm' }) => purchasesApi.runStatus(a.id, a.action))
  if (runs.isLoading) return <Skeleton className="h-48" />
  if (runs.error) return <FinError error={runs.error as Error} onRetry={() => void runs.refetch()} />
  const rows = runs.data ?? []
  if (!rows.length) return <EmptyState title="No payment runs" body="Select open bills on the Bills tab and pay them in one run." icon={<Landmark />} />
  const download = (r: PaymentRun) =>
    file.mutate(r.id, {
      onSuccess: (f) => {
        for (const x of f.files) downloadTextFile(x.fileName, x.mimeType, x.content)
        setSkipped((s) => ({ ...s, [r.id]: f.skipped.map((k) => `${k.paymentNumber} (${k.vendorName}): ${k.reason}`) }))
        toast.success(`Bank file${f.files.length === 1 ? '' : 's'} for ${r.number}`, f.files.map((x) => `${x.fileName} · ${x.count} transfer${x.count === 1 ? '' : 's'} · ${fmt2(x.total)} ${x.currency}`).join('; '))
      },
      onError: (e) => toast.error('Couldn’t export the bank file', errMsg(e)),
    })
  const move = (r: PaymentRun, action: 'sent' | 'confirm') =>
    status.mutate({ id: r.id, action }, { onSuccess: (x) => toast.success(`${x.number}: ${PAYMENT_RUN_BANK_STATUS_LABEL[x.bankStatus]}`), onError: (e) => toast.error('Couldn’t update the run', errMsg(e)) })
  return (
    <SimpleTable
      label="Payment runs"
      head={
        <tr>
          <th className={th}>Run</th>
          <th className={th}>Date</th>
          <th className={th}>Vouchers</th>
          <th className={th}>Bank file</th>
          <th className={th}>Bank status</th>
          <th className={thEnd}>Total (base)</th>
          {canWrite && <th className={thEnd}><span className="sr-only">Actions</span></th>}
        </tr>
      }
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <td className={`${td} num font-medium`}>{r.number}<span className="block text-xs font-normal text-muted">{r.createdByName}</span></td>
          <td className={`${td} num`}>{fmtDay(r.date)}</td>
          <td className={`${td} text-xs`}>
            {r.payments.map((p) => (
              <Link key={p.id} to={financeBillVoucherPath(p.id)} className="num me-2 text-brand-700 hover:underline dark:text-brand-300">{p.number}</Link>
            ))}
            {skipped[r.id]?.length ? <span className="block text-amber-700 dark:text-amber-300">Not in the file: {skipped[r.id].join('; ')}</span> : null}
          </td>
          <td className={`${td} text-xs`}>
            {PAYMENT_FILE_TEMPLATE_DEF[r.paymentFileTemplate]?.label ?? r.paymentFileTemplate}
            <span className="block text-muted">{r.exportCount ? `Exported ${r.exportCount}× · last ${fmtWhen(r.lastExportAt)}` : 'Not exported yet'}</span>
          </td>
          <td className={td}>
            <Badge tone={TONE[r.bankStatus]}>{PAYMENT_RUN_BANK_STATUS_LABEL[r.bankStatus]}</Badge>
            {r.sentAt && <span className="block text-xs text-muted">Sent {fmtWhen(r.sentAt)}{r.sentByName ? ` · ${r.sentByName}` : ''}</span>}
            {r.confirmedAt && <span className="block text-xs text-muted">Confirmed {fmtWhen(r.confirmedAt)}</span>}
          </td>
          <td className={`${tdEnd} num`}>{fmt2(r.totalBase)}</td>
          {canWrite && (
            <td className={tdEnd}>
              <div className="flex flex-wrap justify-end gap-1">
                <Button size="xs" variant="secondary" write loading={file.isPending && file.variables === r.id} onClick={() => download(r)}>
                  <Download aria-hidden /> Bank file
                </Button>
                {r.bankStatus === 'created' && (
                  <Button size="xs" variant="secondary" write disabled={!r.exportCount} onClick={() => move(r, 'sent')}>
                    <Send aria-hidden /> Mark sent to bank
                  </Button>
                )}
                {r.bankStatus === 'sent' && (
                  <Button size="xs" variant="secondary" write onClick={() => move(r, 'confirm')}>
                    <CheckCircle2 aria-hidden /> Confirm
                  </Button>
                )}
              </div>
            </td>
          )}
        </tr>
      ))}
    </SimpleTable>
  )
}
