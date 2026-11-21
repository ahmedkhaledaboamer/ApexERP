import { useEffect, useState, type ReactNode } from 'react'
import type { BillStatus, PoStatus, PurchaseOrder } from '@/modules/finance/purchases/types'
import { BILL_STATUS_LABEL, PO_STATUS_LABEL } from '@/modules/finance/purchases/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, TextArea } from '@/shared/components/form/Field'

/** Shared pieces of the Purchases & payables screens. */

const PO_TONE: Record<PoStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'amber',
  rejected: 'red',
  approved: 'blue',
  partially_received: 'amber',
  received: 'sky',
  closed: 'green',
  cancelled: 'neutral',
}
export function PoStatusBadge({ status }: { status: PoStatus }) {
  return <Badge tone={PO_TONE[status]}>{PO_STATUS_LABEL[status]}</Badge>
}

const BILL_TONE: Record<BillStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'amber',
  rejected: 'red',
  open: 'blue',
  partially_paid: 'amber',
  paid: 'green',
  void: 'neutral',
}
export function BillStatusBadge({ status, overdue }: { status: BillStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>
  return <Badge tone={BILL_TONE[status]}>{BILL_STATUS_LABEL[status]}</Badge>
}

/** 12 Mar 2026 for a yyyy-MM-dd (or ISO) value. */
export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** Company block of printable documents. */
export function CompanyBlock({ company }: { company: PurchaseOrder['company'] }) {
  return (
    <div>
      <p className="font-semibold text-ink">{company.legalName || company.name}</p>
      {company.address && <p className="text-xs text-muted">{company.address}</p>}
      {company.vatNumber && <p className="text-xs text-muted">VAT no. {company.vatNumber}</p>}
    </div>
  )
}

/** A card-like section with a title. */
export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className ?? ''}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Asks for a reason (reject / cancel / void). */
export function ReasonModal({ open, title, label = 'Reason', confirm, onClose, onConfirm, busy, error }: { open: boolean; title: string; label?: string; confirm: string; onClose: () => void; onConfirm: (reason: string) => void; busy?: boolean; error?: string | null }) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="danger" write loading={busy} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirm}</Button>
        </>
      }
    >
      <Field id="reason-input" label={label} hint="At least 3 characters" error={error ?? undefined}>
        <TextArea id="reason-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}

/** Key/value pairs. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[0.8125rem] sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function HistoryList({ items }: { items: { at: string; byName: string; summary: string }[] }) {
  if (!items.length) return <p className="text-[0.8125rem] text-muted">No history yet.</p>
  return (
    <ol className="space-y-2 text-[0.8125rem]">
      {[...items].reverse().map((h, i) => (
        <li key={`${h.at}-${i}`} className="flex flex-wrap gap-x-2">
          <span className="num text-xs text-muted">{fmtWhen(h.at)}</span>
          <span className="font-medium text-ink">{h.byName}</span>
          <span className="text-ink-2">{h.summary}</span>
        </li>
      ))}
    </ol>
  )
}
