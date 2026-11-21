import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, Info, Printer } from 'lucide-react'
import type { TaxSettings, VatBox, VatReturnDetail, VatReturnStatus } from '@/modules/finance/tax/types'
import { VAT_DOC_KIND_LABEL, VAT_STATUS_LABEL } from '@/modules/finance/tax/types'
import { taxApi, useTaxMutation, useVatBoxItems } from '@/modules/finance/tax/api'
import { Amount, EntryLink, SimpleTable, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { downloadText, toCsv } from '@/modules/finance/collections/components/bits'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Modal } from '@/shared/components/ui/Modal'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

/** Pieces of the VAT return screen: status, the box table (FTA VAT 201 / ZATCA), drill-down, file / pay dialogs, CSV. */

const STATUS_TONE: Record<VatReturnStatus, Tone> = { draft: 'amber', filed: 'blue', paid: 'green' }
export function VatStatusBadge({ status, overdue, inProgress }: { status: VatReturnStatus; overdue?: boolean; inProgress?: boolean }) {
  if (status === 'draft' && inProgress) return <Badge tone="neutral">In progress</Badge>
  if (overdue) return <Badge tone="red">{status === 'draft' ? 'Overdue' : 'Payment overdue'}</Badge>
  return <Badge tone={STATUS_TONE[status]}>{VAT_STATUS_LABEL[status]}</Badge>
}

export const layoutTitle = (d: Pick<VatReturnDetail, 'layout'>) => (d.layout === 'uae_vat201' ? 'VAT 201 return (FTA)' : 'VAT return (ZATCA)')

/** Column order: UAE Amount · VAT · Adjustment; KSA Amount · Adjustment · VAT. */
export function BoxesTable({ d, onDrill, compact }: { d: VatReturnDetail; onDrill?: (box: string) => void; compact?: boolean }) {
  const uae = d.layout === 'uae_vat201'
  const groupOf = (b: VatBox) => {
    const k = Number.parseInt(b.key, 10)
    if (uae) return k <= 8 ? 'VAT on sales and all other outputs' : k <= 11 ? 'VAT on expenses and all other inputs' : 'Net VAT due'
    return k <= 6 ? 'Sales' : k <= 12 ? 'Purchases' : 'Net VAT'
  }
  let last = ''
  return (
    <SimpleTable
      label={layoutTitle(d)}
      head={
        <tr>
          <th className={cn(th, 'w-14')}>Box</th>
          <th className={th}>Description</th>
          <th className={thEnd}>Amount ({d.currency})</th>
          {uae ? <th className={thEnd}>VAT amount</th> : <th className={thEnd}>{d.adjustmentLabel}</th>}
          {uae ? <th className={thEnd}>{d.adjustmentLabel}</th> : <th className={thEnd}>VAT amount</th>}
        </tr>
      }
    >
      {d.boxes.map((b) => {
        const g = groupOf(b)
        const header = g !== last
        last = g
        const drill = b.drill && !!onDrill
        const strong = b.kind !== 'line'
        const cellAmount = b.kind === 'result' ? null : <Amount value={b.amount} strong={strong} blankZero={!strong} />
        return [
          header ? (
            <tr key={`g-${g}`} className="bg-sunken/40">
              <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{g}</td>
            </tr>
          ) : null,
          <tr key={b.key} className={cn(drill && 'cursor-pointer hover:bg-hover', strong && 'font-medium')} onClick={drill ? () => onDrill!(b.key) : undefined} data-box={b.key}>
            <td className={cn(td, 'num font-semibold')}>{b.key}</td>
            <td className={td}>
              {drill ? (
                <button type="button" className="text-start text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => { e.stopPropagation(); onDrill!(b.key) }}>
                  {b.label}
                </button>
              ) : (
                <span className="text-ink">{b.label}</span>
              )}
              {b.note && !compact && <span className="mt-0.5 block text-xs text-muted">{b.note}</span>}
            </td>
            <td className={tdEnd}>{cellAmount}</td>
            {uae ? <td className={tdEnd}><Amount value={b.vat} strong={strong} blankZero={!strong} /></td> : <td className={tdEnd}>{b.kind === 'result' ? null : <Amount value={b.adjustment} blankZero />}</td>}
            {uae ? <td className={tdEnd}>{b.kind === 'result' ? null : <Amount value={b.adjustment} blankZero />}</td> : <td className={tdEnd}><Amount value={b.vat} strong={strong} blankZero={!strong} /></td>}
          </tr>,
        ]
      })}
    </SimpleTable>
  )
}

export function TotalsStrip({ d }: { d: VatReturnDetail }) {
  const t = d.totals
  const cells: [string, number, boolean?][] = [
    ['Output VAT', t.outputVat],
    ['Recoverable input VAT', t.inputVat],
    ['Net VAT for the period', t.netVat],
    ...(t.creditBroughtForward ? ([['Credit brought forward', -t.creditBroughtForward]] as [string, number][]) : []),
    [t.payable >= 0 ? 'Payable to the authority' : 'Credit to carry forward', t.payable, true],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {cells.map(([label, v, strong]) => (
        <div key={label} className={cn('rounded-xl border border-line bg-surface px-3 py-2', strong && 'border-brand-300 bg-brand-50/40 dark:bg-brand-500/10')}>
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="mt-0.5 text-base"><Amount value={v} currency={d.currency} strong={!!strong} /></dd>
        </div>
      ))}
    </dl>
  )
}

export function Notices({ d }: { d: VatReturnDetail }) {
  if (!d.warnings.length && !d.assumptions.length) return null
  return (
    <div className="space-y-2">
      {d.warnings.map((w) => (
        <p key={w} className="flex gap-2 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-[0.8125rem] text-ink dark:bg-warning-500/10">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-600" aria-hidden />
          {w}
        </p>
      ))}
      <details className="rounded-lg border border-line bg-surface px-3 py-2 text-[0.8125rem]">
        <summary className="flex cursor-pointer items-center gap-2 text-muted"><Info className="size-4" aria-hidden />How this return is computed ({d.assumptions.length})</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-ink-2">
          {d.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </details>
    </div>
  )
}

/** Lines feeding a box (or the corrections / the excluded lines). */
export function BoxItemsDrawer({ returnId, box, currency, onClose }: { returnId: string; box: string; currency: string; onClose: () => void }) {
  const q = useVatBoxItems(returnId, box)
  const items = q.data?.items ?? []
  return (
    <Drawer open onClose={onClose} width="xl" title={q.data ? (box === 'excluded' || box === 'corrections' ? q.data.label : `Box ${box} · ${q.data.label}`) : `Box ${box}`} description="Documents and journal entries feeding this box, in base currency.">
      {q.isError ? <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-64" /> : !items.length ? (
        <EmptyState title="Nothing in this box" body="No document or journal line of the period feeds it." />
      ) : (
        <SimpleTable
          label={`Box ${box} lines`}
          head={<tr><th className={th}>Date</th><th className={th}>Document</th><th className={th}>Counterparty</th><th className={th}>Tax</th><th className={thEnd}>Net</th><th className={thEnd}>VAT</th></tr>}
          foot={<tr><td className={td} colSpan={4}>{items.length} line{items.length === 1 ? '' : 's'}</td><td className={tdEnd}><Amount value={items.reduce((s, i) => s + i.net, 0)} currency={currency} /></td><td className={tdEnd}><Amount value={items.reduce((s, i) => s + i.vat, 0)} /></td></tr>}
        >
          {items.map((i, k) => (
            <tr key={`${i.entryId}-${k}`}>
              <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(i.date)}</td>
              <td className={td}>
                {i.link ? <Link to={i.link} className="num font-medium text-brand-700 hover:underline dark:text-brand-300">{i.docNumber}</Link> : <span className="num">{i.docNumber}</span>}
                <span className="block text-xs text-muted">{VAT_DOC_KIND_LABEL[i.kind]} · <EntryLink id={i.entryId} number={i.entryNumber} /></span>
              </td>
              <td className={td}>
                {i.counterparty}
                {i.side === 'sales' && i.category === 'standard' && <span className="block text-xs text-muted">{i.emirate}{i.emirateAssumed ? ' (company’s emirate)' : ''}</span>}
              </td>
              <td className={td}>
                <span className="num">{i.taxCode ?? '—'}</span>
                {i.correction && <Badge tone="amber" className="ms-1">Correction</Badge>}
                {!i.recoverable && <Badge tone="red" className="ms-1">Not recoverable</Badge>}
                {i.export && <Badge tone="sky" className="ms-1">Export</Badge>}
              </td>
              <td className={tdEnd}><Amount value={i.net} /></td>
              <td className={tdEnd}><Amount value={i.vat} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </Drawer>
  )
}

export function returnCsv(d: VatReturnDetail): string {
  const uae = d.layout === 'uae_vat201'
  const rows: (string | number)[][] = [
    [layoutTitle(d)],
    ['Period', d.label, d.from, d.to],
    ['VAT number', d.seller.vatNumber],
    ['Status', VAT_STATUS_LABEL[d.status], d.filingReference ?? ''],
    [],
    ['Box', 'Description', `Amount (${d.currency})`, uae ? 'VAT amount' : d.adjustmentLabel, uae ? d.adjustmentLabel : 'VAT amount'],
    ...d.boxes.map((b) => [b.key, b.label, b.amount.toFixed(2), (uae ? b.vat : b.adjustment).toFixed(2), (uae ? b.adjustment : b.vat).toFixed(2)]),
    [],
    ['Output VAT', d.totals.outputVat.toFixed(2)],
    ['Recoverable input VAT', d.totals.inputVat.toFixed(2)],
    ['Credit brought forward', d.totals.creditBroughtForward.toFixed(2)],
    ['Payable', d.totals.payable.toFixed(2)],
  ]
  return toCsv(rows)
}

export function ReturnActions({ d, settings, onPrint }: { d: VatReturnDetail; settings: TaxSettings | undefined; onPrint: () => void }) {
  const [filing, setFiling] = useState(false)
  const [paying, setPaying] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => downloadText(`vat-return-${d.periodKey}.csv`, returnCsv(d))}><Download />Export CSV</Button>
      <Button variant="secondary" onClick={onPrint}><Printer />Print</Button>
      {d.status === 'draft' && settings?.canEdit && (
        <Button write disabled={!d.can.file} title={d.fileBlockedReason ?? undefined} onClick={() => setFiling(true)}>Mark filed</Button>
      )}
      {d.can.pay && <Button write onClick={() => setPaying(true)}>Mark paid</Button>}
      {filing && <FileModal d={d} onClose={() => setFiling(false)} />}
      {paying && <PayModal d={d} settings={settings} onClose={() => setPaying(false)} />}
    </div>
  )
}

function FileModal({ d, onClose }: { d: VatReturnDetail; onClose: () => void }) {
  const toast = useToast()
  const [ref, setRef] = useState('')
  const [date, setDate] = useState('')
  const m = useTaxMutation(() => taxApi.file(d.id, { filingReference: ref, filedDate: date || undefined }))
  return (
    <Modal
      open
      onClose={onClose}
      title={`File ${d.label}`}
      description="Record the submission made on the tax authority’s portal. The return is frozen and the settlement entry is posted (Dr VAT output, Cr VAT input, the net to VAT payable to the tax authority)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write disabled={ref.trim().length < 3} loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (r) => { toast.success('Return filed', r.settlementEntry ? `Settlement ${r.settlementEntry.number}` : undefined); onClose() }, onError: (e) => toast.error('Not filed', e.message) })}>Mark filed</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="vat-ref" label="Filing reference" required hint="The acknowledgement number from the FTA / ZATCA portal.">
          <TextInput id="vat-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 230001234567" />
        </Field>
        <Field id="vat-filed" label="Filed on" hint="Default today.">
          <TextInput id="vat-filed" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-[0.8125rem] text-muted">{d.totals.payable >= 0 ? 'Payable' : 'Credit carried forward'}: <Amount value={Math.abs(d.totals.payable)} currency={d.currency} strong /></p>
      </div>
    </Modal>
  )
}

function PayModal({ d, settings, onClose }: { d: VatReturnDetail; settings: TaxSettings | undefined; onClose: () => void }) {
  const toast = useToast()
  const accounts = settings?.paymentAccounts ?? []
  const [account, setAccount] = useState(accounts.find((a) => a.code === '1120')?.id ?? accounts[0]?.id ?? '')
  const [date, setDate] = useState('')
  const [reference, setReference] = useState('')
  const m = useTaxMutation(() => taxApi.pay(d.id, { accountId: account, date: date || undefined, reference }))
  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay ${d.label}`}
      description="Posts Dr VAT payable to tax authority / Cr the bank account."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write disabled={!account} loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (r) => { toast.success('Payment recorded', r.paymentEntry?.number); onClose() }, onError: (e) => toast.error('Not recorded', e.message) })}>Mark paid</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[0.8125rem]">Amount: <Amount value={d.totals.payable} currency={d.currency} strong /></p>
        <Field id="vat-pay-acc" label="Paid from" required>
          <SelectInput id="vat-pay-acc" value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="vat-pay-date" label="Payment date" hint="Default today.">
          <TextInput id="vat-pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="vat-pay-ref" label="Bank reference">
          <TextInput id="vat-pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function FilingInfo({ d }: { d: VatReturnDetail }) {
  if (d.status === 'draft') return null
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 text-[0.8125rem] sm:grid-cols-3">
      <div><dt className="text-xs text-muted">Filed</dt><dd>{fmtDate(d.filedDate)} · ref. <span className="num">{d.filingReference}</span>{d.filedByName ? ` · ${d.filedByName}` : ''}</dd></div>
      <div><dt className="text-xs text-muted">Settlement entry</dt><dd>{d.settlementEntry ? <EntryLink id={d.settlementEntry.id} number={d.settlementEntry.number} /> : '—'}</dd></div>
      <div><dt className="text-xs text-muted">Payment</dt><dd>{d.paymentEntry ? <>{fmtDate(d.paidDate)} · <EntryLink id={d.paymentEntry.id} number={d.paymentEntry.number} />{d.paymentReference ? ` · ${d.paymentReference}` : ''}</> : d.totals.payable > 0 ? 'Not paid yet' : 'Nothing to pay'}</dd></div>
    </dl>
  )
}
