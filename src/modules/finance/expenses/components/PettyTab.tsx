import { useState } from 'react'
import { Coins, Plus } from 'lucide-react'
import type { PettyFundDetail, ReceiptFile } from '@/modules/finance/expenses/types'
import { PETTY_MOVEMENT_LABEL } from '@/modules/finance/expenses/types'
import { expensesApi, useFund, useFunds, useExpensesMutation, usePettyMeta } from '@/modules/finance/expenses/api'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { fmtDate } from '@/shared/lib/utils'
import { Amount, FinError, FormError, PettyStatusBadge, ReceiptInput, ReceiptLink, SimpleTable, Warnings, td, tdEnd, th, thEnd } from './bits'

const today = () => new Date().toISOString().slice(0, 10)

export function PettyTab({ onOpen, canManage }: { onOpen: (id: string) => void; canManage: boolean }) {
  const funds = useFunds()
  const [creating, setCreating] = useState(false)
  if (funds.error) return <FinError error={funds.error} onRetry={() => funds.refetch()} />
  const rows = funds.data ?? []
  return (
    <div className="space-y-4">
      {canManage && <div className="flex justify-end"><Button write onClick={() => setCreating(true)}><Plus /> New fund</Button></div>}
      {funds.isPending ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <EmptyState icon={<Coins />} title="No petty cash fund" body={canManage ? 'Open a fund for an employee who holds cash for small purchases.' : 'You don’t hold a petty cash fund.'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((f) => (
            <Card key={f.id} className="cursor-pointer p-4 hover:border-brand-300" onClick={() => onOpen(f.id)} role="button" aria-label={`Open ${f.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">{f.name}</p>
                  <p className="text-xs text-muted">{f.custodianName} · {f.accountName}</p>
                </div>
                {f.lowBalance ? <Badge tone="red">Low</Badge> : !f.active ? <Badge>Closed</Badge> : null}
              </div>
              <p className="mt-3 text-xs text-muted">Cash expected</p>
              <p className="text-lg"><Amount value={f.cashExpected} currency={f.currency} strong /> <span className="text-xs text-muted">of {f.floatLimit.toFixed(2)}</span></p>
              <p className="mt-1 text-xs text-muted">{f.pendingCount} expense(s) to replenish · <Amount value={f.pendingTotal} /></p>
            </Card>
          ))}
        </div>
      )}
      {creating && <NewFundModal onClose={() => setCreating(false)} onCreated={(f) => { setCreating(false); onOpen(f.id) }} />}
    </div>
  )
}

function NewFundModal({ onClose, onCreated }: { onClose: () => void; onCreated: (f: PettyFundDetail) => void }) {
  const meta = usePettyMeta()
  const save = useExpensesMutation(expensesApi.createFund)
  const [name, setName] = useState('')
  const [emp, setEmp] = useState('')
  const [float, setFloat] = useState('')
  const [from, setFrom] = useState('')
  const d = meta.data
  return (
    <Modal
      open
      onClose={onClose}
      title="New petty cash fund"
      description="Cash held by a custodian, posted to 1115 Petty cash unless you pick another cash account."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={save.isPending} onClick={() => save.mutate({ name, custodianEmployeeId: emp, floatLimit: Number(float), fundFromAccountId: from || null }, { onSuccess: onCreated })}>Open fund</Button></>}
    >
      {!d ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          <Field id="fund-name" label="Name" required><TextInput id="fund-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="fund-emp" label="Custodian" required><SelectInput id="fund-emp" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Pick an employee</option>{d.employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectInput></Field>
          <Field id="fund-float" label={`Float (${d.baseCurrency})`} required><TextInput id="fund-float" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} /></Field>
          <Field id="fund-from" label="Fund it now from" hint="Optional: tops the float up from the bank."><SelectInput id="fund-from" value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Later</option>{d.bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</SelectInput></Field>
          <FormError error={save.error} />
        </div>
      )}
    </Modal>
  )
}

type Panel = 'record' | 'replenish' | 'topup' | 'count' | null

export function FundDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useFund(id)
  const meta = usePettyMeta(!!id)
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>(null)
  const f = q.data
  return (
    <Drawer
      open={!!id}
      onClose={() => { setPanel(null); onClose() }}
      title={f ? f.name : 'Petty cash fund'}
      description={f ? `${f.custodianName} · float ${f.currency} ${f.floatLimit.toFixed(2)}` : undefined}
      width="xl"
      footer={
        f ? (
          <>
            {f.can.manage && <Button variant="secondary" write onClick={() => setPanel('count')}>Cash count</Button>}
            {f.can.manage && <Button variant="secondary" write onClick={() => setPanel('topup')}>Top up</Button>}
            {f.can.replenish && f.pendingCount > 0 && <Button variant="secondary" write onClick={() => setPanel('replenish')}>Replenish…</Button>}
            {f.can.record && <Button write onClick={() => setPanel('record')}>Record petty expense</Button>}
          </>
        ) : undefined
      }
    >
      {q.error ? <FinError error={q.error} onRetry={() => q.refetch()} /> : !f ? <Skeleton className="h-64" /> : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Book balance', f.bookBalance],
              ['To replenish', f.pendingTotal],
              ['Cash expected', f.cashExpected],
              ['Top-up needed', f.replenishAmount],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg bg-sunken px-3 py-2"><dt className="text-xs text-muted">{l}</dt><dd><Amount value={v as number} strong /></dd></div>
            ))}
          </dl>
          {f.lowBalance && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">Below 20% of the float: replenish the fund.</p>}
          {panel === 'record' && <RecordPanel fund={f} categories={meta.data?.categories ?? []} onDone={() => { setPanel(null); toast.success('Petty expense recorded') }} />}
          {panel === 'replenish' && <ReplenishPanel fund={f} banks={meta.data?.bankAccounts ?? []} onDone={() => { setPanel(null); toast.success('Fund replenished') }} />}
          {panel === 'topup' && <TopUpPanel fund={f} banks={meta.data?.bankAccounts ?? []} onDone={() => { setPanel(null); toast.success('Fund topped up') }} />}
          {panel === 'count' && <CountPanel fund={f} onDone={() => { setPanel(null); toast.success('Cash count recorded') }} />}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Petty expenses</h3>
            {!f.expenses.length ? <p className="text-sm text-muted">None yet.</p> : (
              <SimpleTable label="Petty expenses" head={<tr><th className={th}>Number</th><th className={th}>Date</th><th className={th}>Payee</th><th className={th}>Category</th><th className={thEnd}>Amount</th><th className={th}>Receipt</th><th className={th}>Status</th></tr>}>
                {f.expenses.map((e) => (
                  <tr key={e.id}>
                    <td className={td}><span className="num">{e.number}</span></td>
                    <td className={td}><span className="num">{fmtDate(e.date)}</span></td>
                    <td className={td}>{e.payeeName}{e.description ? <span className="block text-xs text-muted">{e.description}</span> : null}<Warnings items={e.warnings} /></td>
                    <td className={td}>{e.categoryName}</td>
                    <td className={tdEnd}><Amount value={e.amount} /></td>
                    <td className={td}>{e.receipt ? <ReceiptLink file={e.receipt} /> : '—'}</td>
                    <td className={td}><PettyStatusBadge status={e.status} /></td>
                  </tr>
                ))}
              </SimpleTable>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted">Movements</h3>
            <SimpleTable label="Fund movements" head={<tr><th className={th}>Number</th><th className={th}>Date</th><th className={th}>Kind</th><th className={th}>Details</th><th className={thEnd}>Effect</th></tr>}>
              {f.movements.map((m) => (
                <tr key={m.id}>
                  <td className={td}><span className="num">{m.number}</span></td>
                  <td className={td}><span className="num">{fmtDate(m.date)}</span></td>
                  <td className={td}>{PETTY_MOVEMENT_LABEL[m.kind]}</td>
                  <td className={td}>{m.kind === 'replenishment' ? `${m.expenseIds.length} expense(s) ${m.expensesTotal.toFixed(2)} · top-up ${m.topUp.toFixed(2)}` : m.kind === 'count' ? `Counted ${m.counted?.toFixed(2)} vs ${m.expected?.toFixed(2)}${m.reason ? ` · ${m.reason}` : ''}` : m.fromAccountName ?? ''}{m.journal ? <span className="block text-xs text-muted">{m.journal.number} · {m.byName}</span> : null}</td>
                  <td className={tdEnd}><Amount value={m.amount} /></td>
                </tr>
              ))}
            </SimpleTable>
          </section>
        </div>
      )}
    </Drawer>
  )
}

function RecordPanel({ fund, categories, onDone }: { fund: PettyFundDetail; categories: { id: string; name: string }[]; onDone: () => void }) {
  const save = useExpensesMutation(expensesApi.recordPetty)
  const [v, setV] = useState({ date: today(), categoryId: categories[0]?.id ?? '', payeeName: '', payeeVatNumber: '', description: '', amount: '' })
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null)
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  // The categories may arrive after the panel opens: an empty choice means the first category (what the select shows).
  const categoryId = v.categoryId || categories[0]?.id || ''
  return (
    <section className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-3" aria-label="Record petty expense">
      <Field id="pe-date" label="Date"><TextInput id="pe-date" type="date" max={today()} value={v.date} onChange={(e) => set({ date: e.target.value })} /></Field>
      <Field id="pe-cat" label="Category"><SelectInput id="pe-cat" value={categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectInput></Field>
      <Field id="pe-amount" label="Amount"><TextInput id="pe-amount" inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value })} /></Field>
      <Field id="pe-payee" label="Payee"><TextInput id="pe-payee" value={v.payeeName} onChange={(e) => set({ payeeName: e.target.value })} /></Field>
      <Field id="pe-trn" label="Payee TRN / VAT no."><TextInput id="pe-trn" value={v.payeeVatNumber} onChange={(e) => set({ payeeVatNumber: e.target.value })} /></Field>
      <Field id="pe-desc" label="What for"><TextInput id="pe-desc" value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field id="pe-receipt" label="Receipt" className="sm:col-span-2"><ReceiptInput id="pe-receipt" value={receipt} onChange={setReceipt} /></Field>
      <div className="flex items-end justify-end"><Button write loading={save.isPending} onClick={() => save.mutate({ id: fund.id, input: { ...v, categoryId, amount: Number(v.amount), receipt } }, { onSuccess: onDone })}>Save</Button></div>
      <div className="sm:col-span-3"><FormError error={save.error} /></div>
    </section>
  )
}

/** Main bank account (1120) if offered, else the first payment account. */
const defaultBank = (banks: { id: string; code: string }[]) => banks.find((b) => b.code === '1120')?.id ?? banks[0]?.id ?? ''

function ReplenishPanel({ fund, banks, onDone }: { fund: PettyFundDetail; banks: { id: string; code: string; name: string }[]; onDone: () => void }) {
  const save = useExpensesMutation(expensesApi.replenish)
  const pending = fund.expenses.filter((e) => e.status === 'pending')
  const [picked, setPicked] = useState<Set<string>>(new Set(pending.map((e) => e.id)))
  const [chosenFrom, setFrom] = useState('')
  // The bank list may arrive after the panel opens: empty = the default the select shows.
  const from = chosenFrom || defaultBank(banks)
  const approved = pending.filter((e) => picked.has(e.id)).reduce((s, e) => s + e.amount, 0)
  const topUp = Math.max(0, Math.round((fund.floatLimit - (fund.bookBalance - approved)) * 100) / 100)
  return (
    <section className="space-y-3 rounded-xl border border-line p-3" aria-label="Replenish fund">
      <p className="text-sm text-muted">Approved expenses post to their accounts; the bank tops the fund back to its float. Unticked ones are rejected.</p>
      <ul className="space-y-1">
        {pending.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-[0.8125rem]">
            <Checkbox id={`rp-${e.id}`} checked={picked.has(e.id)} onChange={(ev) => setPicked((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n })} />
            <label htmlFor={`rp-${e.id}`} className="flex-1">{e.number} · {e.payeeName} · {e.categoryName}</label>
            <Amount value={e.amount} />
          </li>
        ))}
      </ul>
      <Field id="rp-from" label="Top up from"><SelectInput id="rp-from" value={from} onChange={(e) => setFrom(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</SelectInput></Field>
      <p className="text-sm">Expenses <Amount value={approved} strong /> · top-up from the bank <Amount value={topUp} strong /></p>
      <div className="flex justify-end">
        <Button
          write
          loading={save.isPending}
          onClick={() => save.mutate({ id: fund.id, input: { approveIds: [...picked], reject: pending.filter((e) => !picked.has(e.id)).map((e) => ({ id: e.id, reason: 'Not approved at replenishment' })), fromAccountId: from } }, { onSuccess: onDone })}
        >
          Approve and replenish
        </Button>
      </div>
      <FormError error={save.error} />
    </section>
  )
}

function TopUpPanel({ fund, banks, onDone }: { fund: PettyFundDetail; banks: { id: string; code: string; name: string }[]; onDone: () => void }) {
  const save = useExpensesMutation(expensesApi.topUp)
  const [amount, setAmount] = useState(String(fund.replenishAmount || ''))
  const [chosenFrom, setFrom] = useState('')
  const from = chosenFrom || defaultBank(banks)
  return (
    <section className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-3" aria-label="Top up fund">
      <Field id="tu-amount" label="Amount"><TextInput id="tu-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field id="tu-from" label="From"><SelectInput id="tu-from" value={from} onChange={(e) => setFrom(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</SelectInput></Field>
      <div className="flex items-end justify-end"><Button write loading={save.isPending} onClick={() => save.mutate({ id: fund.id, input: { amount: Number(amount), fromAccountId: from } }, { onSuccess: onDone })}>Top up</Button></div>
      <div className="sm:col-span-3"><FormError error={save.error} /></div>
    </section>
  )
}

function CountPanel({ fund, onDone }: { fund: PettyFundDetail; onDone: () => void }) {
  const save = useExpensesMutation(expensesApi.count)
  const [counted, setCounted] = useState('')
  const [reason, setReason] = useState('')
  const diff = counted === '' ? 0 : Math.round((Number(counted) - fund.cashExpected) * 100) / 100
  return (
    <section className="grid grid-cols-1 gap-3 rounded-xl border border-line p-3 sm:grid-cols-3" aria-label="Cash count">
      <Field id="cc-counted" label="Cash counted" hint={`Expected ${fund.cashExpected.toFixed(2)}`}><TextInput id="cc-counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
      <Field id="cc-reason" label="Reason for a difference" hint={diff ? `${diff < 0 ? 'Short' : 'Over'} ${Math.abs(diff).toFixed(2)} → 6950 over / short` : undefined}><TextInput id="cc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex items-end justify-end"><Button write loading={save.isPending} disabled={counted === ''} onClick={() => save.mutate({ id: fund.id, input: { counted: Number(counted), reason } }, { onSuccess: onDone })}>Record count</Button></div>
      <div className="sm:col-span-3"><FormError error={save.error} /></div>
    </section>
  )
}
