import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing, Download, Mail, PauseCircle, PlayCircle, Plus, Printer, Trash2 } from 'lucide-react'
import type { CollectionsSettingsInput, CustomerCredit, DunningStep } from '@/modules/finance/collections/types'
import { AGING_BUCKETS, AGING_BUCKET_LABEL } from '@/modules/finance/collections/types'
import {
  collectionsApi,
  useAging,
  useAgingDetail,
  useCollectionsMutation,
  useCollectionsSettings,
  useCustomerCredits,
  useDunningLog,
  useOpenItems,
  useStatement,
} from '@/modules/finance/collections/api'
import { financeInvoicePath, financeStatementPath } from '@/app/paths'
import { Amount, FinError, SimpleTable, companyToday, downloadText, errMsg, fmt2, td, tdEnd, th, thEnd, toCsv } from './bits'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/* ---------------- aging ---------------- */

export function AgingTab({ customer, onCustomer, canWrite }: { customer: string | null; onCustomer: (id: string | null) => void; canWrite: boolean }) {
  const [asOf, setAsOf] = useState(companyToday())
  const q = useAging(asOf)
  if (q.error) return <FinError error={q.error} onRetry={() => q.refetch()} />
  const r = q.data
  const exportCsv = () => {
    if (!r) return
    const rows: (string | number)[][] = [
      ['Customer', 'Owner', ...AGING_BUCKETS.map((b) => AGING_BUCKET_LABEL[b]), 'Total', 'Secured by cheques', 'Unapplied credit'],
      ...r.rows.map((x) => [x.customerName, x.ownerName, ...AGING_BUCKETS.map((b) => x[b].toFixed(2)), x.total.toFixed(2), x.pdcSecured.toFixed(2), x.credit.toFixed(2)]),
      ['Total', '', ...AGING_BUCKETS.map((b) => r.totals[b].toFixed(2)), r.totals.total.toFixed(2), r.totals.pdcSecured.toFixed(2), r.totals.credit.toFixed(2)],
    ]
    downloadText(`receivables-aging-${r.asOf}.csv`, toCsv(rows))
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Field id="aging-asof" label="As of">
            <TextInput id="aging-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || companyToday())} className="w-44" />
          </Field>
          {r && <p className="pb-2 text-[0.8125rem] text-muted">Amounts in {r.baseCurrency}, by days past the due date.</p>}
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!r?.rows.length}><Download /> Export CSV</Button>
      </div>
      {!r ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Aging totals">
            {[...AGING_BUCKETS.map((b) => [AGING_BUCKET_LABEL[b], r.totals[b]] as const), ['Total open', r.totals.total] as const].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface px-4 py-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="num mt-1 text-lg font-semibold text-ink">{fmt2(v)}</dd>
              </div>
            ))}
          </dl>
          {!r.rows.length ? (
            <EmptyState icon={<BellRing />} title="Nothing open" body="No customer owes anything as of this date." />
          ) : (
            <SimpleTable
              label="Receivables aging"
              head={
                <tr>
                  <th className={th}>Customer</th>
                  {AGING_BUCKETS.map((b) => <th key={b} className={thEnd}>{AGING_BUCKET_LABEL[b]}</th>)}
                  <th className={thEnd}>Total</th>
                  <th className={thEnd}>Cheques held</th>
                  <th className={thEnd}>Credit</th>
                </tr>
              }
              foot={
                <tr>
                  <td className={td}>Total</td>
                  {AGING_BUCKETS.map((b) => <td key={b} className={tdEnd}><Amount value={r.totals[b]} /></td>)}
                  <td className={tdEnd}><Amount value={r.totals.total} /></td>
                  <td className={tdEnd}><Amount value={r.totals.pdcSecured} /></td>
                  <td className={tdEnd}><Amount value={r.totals.credit} /></td>
                </tr>
              }
            >
              {r.rows.map((x) => (
                <tr key={x.customerId} className="cursor-pointer hover:bg-hover" onClick={() => onCustomer(x.customerId)}>
                  <td className={td}>
                    <button type="button" className="font-medium text-brand-600 hover:underline" onClick={(e) => { e.stopPropagation(); onCustomer(x.customerId) }}>{x.customerName}</button>
                    {x.creditHold && <Badge tone="red" className="ms-2">On hold</Badge>}
                    <span className="block text-xs text-muted">{x.ownerName} · {x.invoiceCount} invoice{x.invoiceCount === 1 ? '' : 's'}</span>
                  </td>
                  {AGING_BUCKETS.map((b) => <td key={b} className={tdEnd}>{x[b] ? <Amount value={x[b]} className={b !== 'current' ? 'text-ink' : undefined} /> : <span className="text-muted">—</span>}</td>)}
                  <td className={tdEnd}><Amount value={x.total} strong /></td>
                  <td className={tdEnd}>{x.pdcSecured ? <Amount value={x.pdcSecured} /> : <span className="text-muted">—</span>}</td>
                  <td className={tdEnd}>{x.credit ? <Amount value={x.credit} /> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </>
      )}
      <AgingDetailDrawer customerId={customer} asOf={asOf} onClose={() => onCustomer(null)} canWrite={canWrite} />
    </div>
  )
}

function AgingDetailDrawer({ customerId, asOf, onClose, canWrite }: { customerId: string | null; asOf: string; onClose: () => void; canWrite: boolean }) {
  const q = useAgingDetail(customerId, asOf)
  const pause = useCollectionsMutation((a: { id: string; paused: boolean }) => collectionsApi.pause({ targetType: 'invoice', targetId: a.id, paused: a.paused }))
  const d = q.data
  return (
    <Drawer open={!!customerId} onClose={onClose} width="xl" title={d ? d.customerName : 'Customer'} description={d ? `Open invoices as of ${fmtDate(d.asOf)} · ${d.baseCurrency} ${fmt2(d.totals.total)}` : undefined}>
      {q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 text-[0.8125rem]">
            <Link to={financeStatementPath(d.customerId)} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"><Printer className="size-3.5" aria-hidden /> Statement</Link>
          </div>
          <CustomerCredits customerId={d.customerId} canWrite={canWrite} />
          <SimpleTable
            label="Open invoices"
            head={<tr><th className={th}>Invoice</th><th className={th}>Due</th><th className={thEnd}>Days late</th><th className={th}>Bucket</th><th className={thEnd}>Open</th><th className={th}>Reminders</th></tr>}
          >
            {d.invoices.map((i) => (
              <tr key={i.invoiceId}>
                <td className={td}>
                  <Link to={financeInvoicePath(i.invoiceId)} className="num font-medium text-brand-600 hover:underline">{i.number}</Link>
                  {i.pdcSecured > 0 && <span className="block text-xs text-muted">{fmt2(i.pdcSecured)} secured by cheque</span>}
                </td>
                <td className={td}><span className="num">{fmtDate(i.dueDate)}</span></td>
                <td className={tdEnd}><span className="num">{i.daysOverdue}</span></td>
                <td className={td}><Badge tone={i.bucket === 'current' ? 'green' : i.bucket === 'd30' ? 'amber' : 'red'}>{AGING_BUCKET_LABEL[i.bucket]}</Badge></td>
                <td className={tdEnd}><Amount value={i.balance} currency={i.currency} /></td>
                <td className={td}>
                  <span className="block text-xs text-muted">{i.lastReminder ? `Last ${fmtDate(i.lastReminder)}` : 'None sent'}</span>
                  {canWrite && (
                    <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => pause.mutate({ id: i.invoiceId, paused: !i.dunningPaused })}>
                      {i.dunningPaused ? <PlayCircle className="size-3.5" aria-hidden /> : <PauseCircle className="size-3.5" aria-hidden />}
                      {i.dunningPaused ? 'Resume reminders' : 'Pause reminders'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </SimpleTable>
        </div>
      )}
    </Drawer>
  )
}

/** Customer credit (unallocated payments, credit-note excess) with "apply to oldest invoices" and refund. */
function CustomerCredits({ customerId, canWrite }: { customerId: string; canWrite: boolean }) {
  const toast = useToast()
  const items = useOpenItems(customerId)
  const apply = useCollectionsMutation((c: { kind: 'payment' | 'credit_note'; id: string }) => (c.kind === 'payment' ? collectionsApi.applyCredit(c.id, {}) : collectionsApi.applyCreditNote(c.id, {})) as Promise<unknown>)
  const refund = useCollectionsMutation((c: { kind: 'payment' | 'credit_note'; id: string; amount: number }) =>
    (c.kind === 'payment' ? collectionsApi.refund(c.id, { amount: c.amount, date: companyToday() }) : collectionsApi.refundCreditNote(c.id, { amount: c.amount, date: companyToday() })) as Promise<unknown>,
  )
  const credits = items.data?.credits ?? []
  if (!credits.length) return null
  const run = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f()
      toast.success(ok)
    } catch (e) {
      toast.error('Not done', errMsg(e))
    }
  }
  return (
    <section aria-label="Customer credit" className="space-y-2">
      <h3 className="text-[0.8125rem] font-semibold text-ink">Customer credit</h3>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {credits.map((c) => (
          <li key={c.sourceId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[0.8125rem]">
            <span className="num font-medium text-ink">{c.number}</span>
            <span className="text-xs text-muted">{c.kind === 'payment' ? 'Unallocated payment' : 'Credit note excess'} · {fmtDate(c.date)}</span>
            <Amount value={c.unallocated} currency={c.currency} className="ms-auto" />
            {canWrite && (
              <>
                <Button write size="xs" variant="secondary" onClick={() => run(() => apply.mutateAsync({ kind: c.kind, id: c.sourceId }), 'Credit applied to the oldest open invoices')}>Apply</Button>
                <Button write size="xs" variant="ghost" onClick={() => run(() => refund.mutateAsync({ kind: c.kind, id: c.sourceId, amount: c.unallocated }), 'Credit refunded')}>Refund</Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------------- statements ---------------- */

export function StatementsTab({ customer, onCustomer, canWrite }: { customer: string | null; onCustomer: (id: string | null) => void; canWrite: boolean }) {
  const toast = useToast()
  const customers = useCustomerCredits()
  const today = companyToday()
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const q = useStatement(customer, from, to)
  const [email, setEmail] = useState('')
  const send = useCollectionsMutation(() => collectionsApi.emailStatement(customer!, { from, to, email: email || undefined }))
  const s = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field id="st-customer" label="Customer">
          <SelectInput id="st-customer" value={customer ?? ''} onChange={(e) => onCustomer(e.target.value || null)} className="w-72">
            <option value="">Select a customer…</option>
            {(customers.data ?? []).map((c) => <option key={c.customerId} value={c.customerId}>{c.customerName}</option>)}
          </SelectInput>
        </Field>
        <Field id="st-from" label="From"><TextInput id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></Field>
        <Field id="st-to" label="To"><TextInput id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></Field>
        {customer && (
          <Link to={financeStatementPath(customer, from, to)} className="mb-0.5 inline-flex h-9 items-center gap-1 rounded-lg border border-line-strong px-3 text-[0.8125rem] font-medium text-ink hover:bg-hover">
            <Printer className="size-4" aria-hidden /> Print
          </Link>
        )}
      </div>
      {!customer ? (
        <EmptyState icon={<Mail />} title="Pick a customer" body="The statement lists invoices, payments, credits and refunds with a running balance." />
      ) : q.error ? (
        <FinError error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <StatementTable s={s} />
          {canWrite && (
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
              <Field id="st-email" label="Email to" hint="Empty: the customer’s billing contact. Mock email, logged on the customer timeline.">
                <TextInput id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-72" />
              </Field>
              <Button
                write
                variant="secondary"
                loading={send.isPending}
                onClick={async () => {
                  try {
                    const r = await send.mutateAsync(undefined)
                    toast.success('Statement emailed', r.sentTo)
                  } catch (e) {
                    toast.error('Not sent', errMsg(e))
                  }
                }}
              >
                <Mail /> Email statement
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function StatementTable({ s }: { s: NonNullable<ReturnType<typeof useStatement>['data']> }) {
  return (
    <SimpleTable
      label="Statement of account"
      head={<tr><th className={th}>Date</th><th className={th}>Reference</th><th className={th}>Description</th><th className={thEnd}>Debit</th><th className={thEnd}>Credit</th><th className={thEnd}>Balance</th></tr>}
      foot={<tr><td className={td} colSpan={5}>Closing balance ({s.baseCurrency})</td><td className={tdEnd}><Amount value={s.closingBalance} /></td></tr>}
    >
      <tr>
        <td className={td}><span className="num">{fmtDate(s.from)}</span></td>
        <td className={td} colSpan={4}>Opening balance</td>
        <td className={tdEnd}><Amount value={s.openingBalance} /></td>
      </tr>
      {s.lines.map((l, i) => (
        <tr key={`${l.reference}-${l.type}-${i}`}>
          <td className={td}><span className="num">{fmtDate(l.date)}</span></td>
          <td className={td}><span className="num">{l.reference}</span></td>
          <td className={td}>{l.description}</td>
          <td className={tdEnd}>{l.debit ? <Amount value={l.debit} /> : ''}</td>
          <td className={tdEnd}>{l.credit ? <Amount value={l.credit} /> : ''}</td>
          <td className={tdEnd}><Amount value={l.balance} /></td>
        </tr>
      ))}
    </SimpleTable>
  )
}

/* ---------------- credit limits ---------------- */

export function CreditTab({ canWrite }: { canWrite: boolean }) {
  const q = useCustomerCredits()
  const [editing, setEditing] = useState<CustomerCredit | null>(null)
  const [onlyOpen, setOnlyOpen] = useState(true)
  if (q.error) return <FinError error={q.error} onRetry={() => q.refetch()} />
  const rows = (q.data ?? []).filter((c) => !onlyOpen || c.openAr > 0 || c.creditLimit !== null || c.creditHold)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[0.8125rem] text-muted">Exposure = open invoices − unapplied credit (cheques held don’t count until they clear). The quotation form warns, or blocks, per the setting under Reminders & settings.</p>
        <Switch checked={onlyOpen} onChange={setOnlyOpen} label="Only customers with a balance or a limit" />
      </div>
      {q.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <SimpleTable
          label="Credit limits"
          head={<tr><th className={th}>Customer</th><th className={thEnd}>Limit</th><th className={thEnd}>Exposure</th><th className={thEnd}>Available</th><th className={thEnd}>Overdue</th><th className={th}>Flags</th>{canWrite && <th className={th}><span className="sr-only">Edit</span></th>}</tr>}
        >
          {rows.map((c) => (
            <tr key={c.customerId}>
              <td className={td}><span className="font-medium text-ink">{c.customerName}</span><span className="block text-xs text-muted">{c.ownerName}</span></td>
              <td className={tdEnd}>{c.creditLimit === null ? <span className="text-muted">No limit</span> : <Amount value={c.creditLimit} />}</td>
              <td className={tdEnd}><Amount value={c.exposure} /></td>
              <td className={tdEnd}>{c.available === null ? '—' : <Amount value={c.available} className={c.overLimit ? 'text-danger-600' : undefined} />}</td>
              <td className={tdEnd}>{c.overdue ? <Amount value={c.overdue} /> : '—'}</td>
              <td className={td}>
                <div className="flex flex-wrap gap-1">
                  {c.creditHold && <Badge tone="red">On hold</Badge>}
                  {c.overLimit && <Badge tone="amber">Over limit</Badge>}
                  {c.bouncedCheques > 0 && <Badge tone="red">{c.bouncedCheques} bounced</Badge>}
                  {c.dunningPaused && <Badge tone="neutral">Reminders paused</Badge>}
                </div>
              </td>
              {canWrite && <td className={tdEnd}><Button size="xs" variant="secondary" write onClick={() => setEditing(c)}>Edit</Button></td>}
            </tr>
          ))}
        </SimpleTable>
      )}
      <CreditEditor credit={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

export function CreditEditor({ credit, onClose }: { credit: CustomerCredit | null; onClose: () => void }) {
  const toast = useToast()
  const [limit, setLimit] = useState('')
  const [hold, setHold] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!credit) return
    setLimit(credit.creditLimit === null ? '' : String(credit.creditLimit))
    setHold(credit.creditHold)
    setPaused(credit.dunningPaused)
    setError(null)
  }, [credit])
  const save = useCollectionsMutation(() => collectionsApi.saveCredit(credit!.customerId, { creditLimit: limit.trim() === '' ? null : Number(limit), creditHold: hold, dunningPaused: paused }))
  return (
    <Drawer
      open={!!credit}
      onClose={onClose}
      width="md"
      title={credit ? `Credit · ${credit.customerName}` : 'Credit'}
      description={credit ? `Exposure ${credit.baseCurrency} ${fmt2(credit.exposure)} · open ${fmt2(credit.openAr)} · cheques held ${fmt2(credit.pdcHeld)}` : undefined}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(undefined)
                toast.success('Credit settings saved')
                onClose()
              } catch (e) {
                setError(errMsg(e))
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
        <Field id="credit-limit" label={`Credit limit (${credit?.baseCurrency ?? ''})`} hint="Empty = no limit.">
          <TextInput id="credit-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Switch checked={hold} onChange={setHold} label="Credit hold (warn or block new quotations)" />
        <Switch checked={paused} onChange={setPaused} label="Pause payment reminders" />
      </div>
    </Drawer>
  )
}

/* ---------------- reminders & settings ---------------- */

const offsetLabel = (o: number) => (o < 0 ? `${-o} day${o === -1 ? '' : 's'} before due` : o === 0 ? 'On the due date' : `${o} day${o === 1 ? '' : 's'} overdue`)

export function RemindersTab({ canWrite }: { canWrite: boolean }) {
  const toast = useToast()
  const s = useCollectionsSettings()
  const log = useDunningLog()
  const [draft, setDraft] = useState<(Omit<CollectionsSettingsInput, 'dunningSteps'> & { dunningSteps: DunningStep[] }) | null>(null)
  useEffect(() => {
    if (s.data) setDraft({ dunningEnabled: s.data.dunningEnabled, dunningSteps: s.data.dunningSteps.map((x) => ({ ...x })), creditCheckMode: s.data.creditCheckMode, gatewayFeePct: s.data.gatewayFeePct, defaultExpiryDays: s.data.defaultExpiryDays })
  }, [s.data])
  const save = useCollectionsMutation(() => collectionsApi.saveSettings(draft!))
  if (s.error) return <FinError error={s.error} onRetry={() => s.refetch()} />
  if (!draft) return <Skeleton className="h-64" />
  const setStep = (i: number, patch: Partial<DunningStep>) => setDraft((d) => d && { ...d, dunningSteps: d.dunningSteps.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const disabled = !canWrite
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="Payment reminders" description="Emailed to the customer’s billing contact once per invoice and step, on the company’s calendar. Owners are notified at steps marked so." />
        <CardBody className="space-y-4">
          <Switch checked={!!draft.dunningEnabled} onChange={(v) => setDraft({ ...draft, dunningEnabled: v })} label="Send automatic reminders" disabled={disabled} />
          <ul className="space-y-2" aria-label="Reminder steps">
            {draft.dunningSteps.map((x, i) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                <TextInput aria-label="Days from due date" type="number" min={-30} max={365} value={x.offsetDays} onChange={(e) => setStep(i, { offsetDays: Number(e.target.value) })} className="w-20" disabled={disabled} />
                <span className="min-w-36 text-[0.8125rem] text-ink-2">{offsetLabel(x.offsetDays)}</span>
                <Switch checked={x.active} onChange={(v) => setStep(i, { active: v })} label="On" disabled={disabled} />
                <Switch checked={x.notifyOwner} onChange={(v) => setStep(i, { notifyOwner: v })} label="Notify owner" disabled={disabled} />
                {canWrite && <Button iconOnly size="xs" variant="ghost" aria-label="Remove step" onClick={() => setDraft({ ...draft, dunningSteps: draft.dunningSteps.filter((_, j) => j !== i) })}><Trash2 /></Button>}
              </li>
            ))}
          </ul>
          {canWrite && draft.dunningSteps.length < 8 && (
            <Button size="sm" variant="secondary" onClick={() => setDraft({ ...draft, dunningSteps: [...draft.dunningSteps, { id: `step-new-${Date.now().toString(36)}`, offsetDays: Math.max(0, ...draft.dunningSteps.map((x) => x.offsetDays)) + 15, active: true, notifyOwner: false }] })}>
              <Plus /> Add step
            </Button>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Credit check & payment links" />
        <CardBody className="space-y-4">
          <Field id="set-credit-mode" label="On quotations for a customer over the limit or on hold" hint="Warn shows a notice on the quotation form; block refuses to create or send it.">
            <SelectInput id="set-credit-mode" value={draft.creditCheckMode} onChange={(e) => setDraft({ ...draft, creditCheckMode: e.target.value as 'warn' | 'block' })} disabled={disabled}>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </SelectInput>
          </Field>
          <Field id="set-fee" label="Gateway fee (%)" hint="Simulated; deducted as bank charges on payment-link payments.">
            <TextInput id="set-fee" inputMode="decimal" value={draft.gatewayFeePct} onChange={(e) => setDraft({ ...draft, gatewayFeePct: Number(e.target.value) })} disabled={disabled} />
          </Field>
          <Field id="set-expiry" label="Payment links expire after (days)">
            <TextInput id="set-expiry" type="number" min={1} max={90} value={draft.defaultExpiryDays} onChange={(e) => setDraft({ ...draft, defaultExpiryDays: Number(e.target.value) })} disabled={disabled} />
          </Field>
          {canWrite && (
            <Button
              write
              loading={save.isPending}
              onClick={async () => {
                try {
                  await save.mutateAsync(undefined)
                  toast.success('Collections settings saved')
                } catch (e) {
                  toast.error('Not saved', errMsg(e))
                }
              }}
            >
              Save settings
            </Button>
          )}
        </CardBody>
      </Card>
      <section className="lg:col-span-2" aria-label="Reminder log">
        <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Reminders sent</h3>
        {log.isPending ? (
          <Skeleton className="h-32" />
        ) : !(log.data ?? []).length ? (
          <EmptyState icon={<BellRing />} title="No reminders yet" body="They are sent as invoices reach each step." />
        ) : (
          <SimpleTable label="Reminder log" head={<tr><th className={th}>Date</th><th className={th}>Invoice</th><th className={th}>Customer</th><th className={th}>Step</th><th className={th}>Outcome</th></tr>}>
            {(log.data ?? []).slice(0, 100).map((d) => (
              <tr key={d.id}>
                <td className={td}><span className="num">{fmtDate(d.date)}</span></td>
                <td className={td}><span className="num">{d.invoiceNumber}</span></td>
                <td className={td}>{d.customerName}</td>
                <td className={td}>{offsetLabel(d.offsetDays)}</td>
                <td className={td}>{d.outcome === 'sent' ? <span>Emailed{d.sentTo ? ` to ${d.sentTo}` : ' (no contact email)'}</span> : <span className="text-muted">Skipped (a later step was due)</span>}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </section>
    </div>
  )
}
