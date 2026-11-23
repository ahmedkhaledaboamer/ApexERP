import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, PiggyBank, Building2, Eye, FileUp, Landmark, ListChecks, Plus, Scale, Sparkles, Trash2, Undo2, Wallet } from 'lucide-react'
import type { BankAccount, ReconcileWorkspace } from '@/modules/finance/banking/types'
import { BANK_ACCOUNT_KINDS, BANK_ACCOUNT_KIND_LABEL } from '@/modules/finance/banking/types'
import { bankingApi, useBankAccounts, useBankingMutation, usePayrollPostings, useReconciliation, useReconciliations, useRules, useTransfers, useWorkspace } from '@/modules/finance/banking/api'
import { useAccounts, useFinanceScope } from '@/modules/finance/ledger/api'
import { Amount, EntryLink, SimpleTable, errMsg, fmtDate, monthName, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Modal } from '@/shared/components/ui/Modal'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { ImportStatementModal } from '../components/ImportStatementModal'
import { EosbProvisionTab } from '../components/EosbProvisionTab'
import { PAYMENT_FILE_COLUMNS, PAYMENT_FILE_COLUMN_LABEL, PAYMENT_FILE_TEMPLATES, PAYMENT_FILE_TEMPLATE_DEF, type PaymentFileColumn, type PaymentFileTemplate } from '@/modules/finance/purchases/bankFile'
import { useNewParam } from '@/shared/hooks/useNewParam'

/**
 * `/finance/banking`: bank and cash accounts on top of the ledger (?tab=accounts|transfers|reconcile|rules|payroll,
 * ?account=). Reconcile: import a CSV statement, auto-match, match by hand (1-to-many / many-to-1), create entries from
 * bank-only lines (bank rules suggest the account), finish at a zero difference. Sales Manager: read only.
 */
type Tab = 'accounts' | 'transfers' | 'reconcile' | 'rules' | 'payroll' | 'eosb'

export default function BankingPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'accounts'
  const account = params.get('account')
  const go = (t: Tab, acc?: string | null) => {
    const p = new URLSearchParams(params)
    p.set('tab', t)
    if (acc !== undefined) {
      if (acc) p.set('account', acc)
      else p.delete('account')
    }
    setParams(p, { replace: true })
  }
  return (
    <>
      <PageHeader icon={<IconTile><Landmark /></IconTile>} title="Banking" description="Bank and cash accounts, transfers, statement import and reconciliation, payroll postings." />
      <PageBody className="space-y-5">
        <Tabs<Tab>
          label="Banking sections"
          value={tab}
          onChange={(t) => go(t)}
          items={[
            { id: 'accounts', label: 'Accounts', icon: <Building2 /> },
            { id: 'transfers', label: 'Transfers', icon: <ArrowLeftRight /> },
            { id: 'reconcile', label: 'Reconcile', icon: <Scale /> },
            { id: 'rules', label: 'Bank rules', icon: <ListChecks /> },
            { id: 'payroll', label: 'Payroll postings', icon: <Wallet /> },
            { id: 'eosb', label: 'EOSB provision', icon: <PiggyBank /> },
          ]}
        />
        <div id={`tab-panel-${tab}`} role="tabpanel">
          {tab === 'accounts' && <AccountsTab onReconcile={(id) => go('reconcile', id)} />}
          {tab === 'transfers' && <TransfersTab />}
          {tab === 'reconcile' && <ReconcileTab accountId={account} onAccount={(id) => go('reconcile', id)} />}
          {tab === 'rules' && <RulesTab />}
          {tab === 'payroll' && <PayrollTab />}
          {tab === 'eosb' && <EosbProvisionTab />}
        </div>
      </PageBody>
    </>
  )
}

/* ---------------- accounts ---------------- */

function AccountsTab({ onReconcile }: { onReconcile: (id: string) => void }) {
  const q = useBankAccounts(true)
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null)
  useNewParam(() => setEditing('new'), { when: isFull })
  const [revealed, setRevealed] = useState<Record<string, { accountNumber: string; iban: string }>>({})
  const reveal = useBankingMutation((id: string) => bankingApi.reveal(id))
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-64" />
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">Balances come from the journal lines on each account’s ledger account; numbers are masked (reveal is audited).</p>
        {isFull && (
          <Button write onClick={() => setEditing('new')}>
            <Plus />
            Add bank account
          </Button>
        )}
      </div>
      <SimpleTable
        label="Bank accounts"
        head={
          <tr>
            <th className={th}>Account</th>
            <th className={th}>Number / IBAN</th>
            <th className={th}>Ledger</th>
            <th className={thEnd}>Book balance</th>
            <th className={thEnd}>Statement balance</th>
            <th className={th}>Last reconciled</th>
            <th className={th}>Unmatched</th>
            <th className={th}><span className="sr-only">Actions</span></th>
          </tr>
        }
      >
        {q.data.map((a) => (
          <tr key={a.id} className={a.active ? '' : 'opacity-60'}>
            <td className={td}>
              <div className="font-medium text-ink">{a.name}</div>
              <div className="text-xs text-muted">{a.bankName || BANK_ACCOUNT_KIND_LABEL[a.kind]} · {a.currency}{a.isDefault ? ' · default' : ''}{a.active ? '' : ' · inactive'}</div>
            </td>
            <td className={`${td} num text-xs`}>
              {revealed[a.id] ? (
                <>
                  <div>{revealed[a.id].accountNumber || '—'}</div>
                  <div>{revealed[a.id].iban || '—'}</div>
                </>
              ) : (
                <>
                  <div>{a.accountNumberMasked || '—'}</div>
                  <div>{a.ibanMasked || '—'}</div>
                </>
              )}
            </td>
            <td className={`${td} text-xs`}>{a.ledgerAccountCode} {a.ledgerAccountName}</td>
            <td className={tdEnd}><Amount value={a.bookBalance} currency={a.currency} strong /></td>
            <td className={tdEnd}>{a.statementBalance === null ? <span className="text-subtle">—</span> : <Amount value={a.statementBalance} currency={a.currency} />}<div className="text-xs text-muted">{a.statementBalanceDate ? fmtDate(a.statementBalanceDate) : ''}</div></td>
            <td className={td}>{a.lastReconciledDate ? fmtDate(a.lastReconciledDate) : <span className="text-subtle">Never</span>}</td>
            <td className={td}>{a.unmatchedLines ? <Badge tone="amber">{a.unmatchedLines}</Badge> : <span className="text-subtle">0</span>}</td>
            <td className={`${td} whitespace-nowrap text-end`}>
              {a.kind !== 'cash' && <Button size="sm" variant="secondary" onClick={() => onReconcile(a.id)}>Reconcile</Button>}
              {isFull && (a.accountNumberMasked || a.ibanMasked) && !revealed[a.id] && (
                <Button size="sm" variant="ghost" iconOnly aria-label={`Show the full number of ${a.name}`} onClick={() => reveal.mutate(a.id, { onSuccess: (r) => setRevealed((x) => ({ ...x, [a.id]: r })), onError: (e) => toast.error('Not shown', e.message) })}>
                  <Eye />
                </Button>
              )}
              {isFull && <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>}
            </td>
          </tr>
        ))}
      </SimpleTable>
      {editing && <AccountModal account={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AccountModal({ account, onClose }: { account: BankAccount | null; onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: account?.name ?? '', bankName: account?.bankName ?? '', kind: account?.kind ?? 'current', currency: account?.currency ?? '', accountNumber: '', iban: '', openingBalance: '', openingDate: '', notes: account?.notes ?? '', active: account?.active ?? true })
  // Bank upload file of supplier payment runs: template and its columns (subset / order).
  const [template, setTemplate] = useState<PaymentFileTemplate | ''>(account?.paymentFileTemplate ?? '')
  const [columns, setColumns] = useState<PaymentFileColumn[]>(account?.paymentFileColumns ?? [])
  const save = useBankingMutation(() =>
    account
      ? bankingApi.updateAccount(account.id, { name: f.name, bankName: f.bankName, kind: f.kind, notes: f.notes, active: f.active, paymentFileTemplate: template || null, paymentFileColumns: template ? columns : null, ...(f.accountNumber ? { accountNumber: f.accountNumber } : {}), ...(f.iban ? { iban: f.iban } : {}) })
      : bankingApi.createAccount({ name: f.name, bankName: f.bankName, kind: f.kind, currency: f.currency || undefined, accountNumber: f.accountNumber, iban: f.iban, openingBalance: f.openingBalance ? Number(f.openingBalance) : undefined, openingDate: f.openingDate || undefined, notes: f.notes }),
  )
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Modal
      open
      onClose={onClose}
      title={account ? `Edit ${account.name}` : 'Add bank account'}
      description={account ? undefined : 'A ledger account is created under 1100 Cash and bank; the opening balance posts against opening balance equity.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success(account ? 'Saved' : 'Bank account added'); onClose() }, onError: (e) => toast.error('Not saved', e.message) })}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ba-name" label="Name" required><TextInput id="ba-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field id="ba-bank" label="Bank"><TextInput id="ba-bank" value={f.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
        <Field id="ba-kind" label="Kind">
          <SelectInput id="ba-kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            {BANK_ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{BANK_ACCOUNT_KIND_LABEL[k]}</option>)}
          </SelectInput>
        </Field>
        <Field id="ba-cur" label="Currency" hint={account ? 'Fixed' : 'Empty = base currency'}><TextInput id="ba-cur" disabled={!!account} value={f.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
        <Field id="ba-no" label="Account number" hint={account ? `Now ${account.accountNumberMasked || '—'}; leave empty to keep` : undefined}><TextInput id="ba-no" value={f.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} /></Field>
        <Field id="ba-iban" label="IBAN" hint={account ? `Now ${account.ibanMasked || '—'}; leave empty to keep` : undefined}><TextInput id="ba-iban" value={f.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
        {!account && (
          <>
            <Field id="ba-ob" label="Opening balance"><TextInput id="ba-ob" inputMode="decimal" value={f.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} /></Field>
            <Field id="ba-od" label="Opening date"><TextInput id="ba-od" type="date" value={f.openingDate} onChange={(e) => set('openingDate', e.target.value)} /></Field>
          </>
        )}
        {account && (
          <label className="flex items-center gap-2 text-[0.8125rem]"><Checkbox checked={f.active} onChange={(e) => set('active', e.target.checked)} />Active</label>
        )}
        {account && (
          <div className="space-y-2 sm:col-span-2">
            <Field id="ba-template" label="Payment file template" hint="Bank upload file of supplier payment runs (Bills › Payment runs)">
              <SelectInput id="ba-template" value={template} onChange={(e) => {
                const t = e.target.value as PaymentFileTemplate | ''
                setTemplate(t)
                setColumns(t ? PAYMENT_FILE_TEMPLATE_DEF[t].columns : [])
              }}>
                <option value="">Country default</option>
                {PAYMENT_FILE_TEMPLATES.map((t) => <option key={t} value={t}>{PAYMENT_FILE_TEMPLATE_DEF[t].label}</option>)}
              </SelectInput>
            </Field>
            {template && (
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem]">
                <legend className="mb-1 text-xs text-muted">Columns (beneficiary IBAN and amount are required)</legend>
                {PAYMENT_FILE_COLUMNS.map((c) => (
                  <label key={c} className="flex items-center gap-1.5">
                    <Checkbox
                      checked={columns.includes(c)}
                      disabled={c === 'iban' || c === 'amount'}
                      onChange={(e) => setColumns((x) => (e.target.checked ? [...x, c] : x.filter((y) => y !== c)))}
                    />
                    {PAYMENT_FILE_COLUMN_LABEL[c]}
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ---------------- transfers ---------------- */

function TransfersTab() {
  const q = useTransfers()
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  useNewParam(() => setOpen(true), { when: isFull })
  const voidT = useBankingMutation((id: string) => bankingApi.voidTransfer(id))
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-64" />
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {isFull && <Button write onClick={() => setOpen(true)}><Plus />New transfer</Button>}
      </div>
      {!q.data.length ? <EmptyState title="No transfers yet" body="Move money between your bank and cash accounts; cross-currency transfers post the exchange difference." /> : (
        <SimpleTable
          label="Transfers"
          head={<tr><th className={th}>Number</th><th className={th}>Date</th><th className={th}>From → to</th><th className={thEnd}>Out</th><th className={thEnd}>In</th><th className={thEnd}>Fee</th><th className={thEnd}>FX</th><th className={th}>Entry</th><th className={th} /></tr>}
        >
          {q.data.map((t) => (
            <tr key={t.id}>
              <td className={`${td} num`}>{t.number}{t.status === 'void' && <Badge tone="red" className="ms-2">Void</Badge>}</td>
              <td className={td}>{fmtDate(t.date)}</td>
              <td className={td}>{t.fromName} → {t.toName}<div className="text-xs text-muted">{t.reference}</div></td>
              <td className={tdEnd}><Amount value={t.amountFrom} currency={t.fromCurrency} /></td>
              <td className={tdEnd}><Amount value={t.amountTo} currency={t.toCurrency} /></td>
              <td className={tdEnd}><Amount value={t.fee} blankZero /></td>
              <td className={tdEnd}><Amount value={t.fxDifference} blankZero /></td>
              <td className={td}><EntryLink id={t.journalEntryId} number={t.journalNumber} /></td>
              <td className={`${td} text-end`}>{isFull && t.status === 'posted' && <Button size="sm" variant="ghost" onClick={() => voidT.mutate(t.id, { onSuccess: () => toast.success('Transfer voided'), onError: (e) => toast.error('Not voided', e.message) })}>Void</Button>}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {open && <TransferModal onClose={() => setOpen(false)} />}
    </div>
  )
}

function TransferModal({ onClose }: { onClose: () => void }) {
  const accounts = useBankAccounts()
  const toast = useToast()
  const [f, setF] = useState({ from: '', to: '', amountFrom: '', amountTo: '', fee: '', date: '', reference: '' })
  const from = accounts.data?.find((a) => a.id === f.from)
  const to = accounts.data?.find((a) => a.id === f.to)
  const cross = !!from && !!to && from.currency !== to.currency
  const save = useBankingMutation(() => bankingApi.createTransfer({ fromBankAccountId: f.from, toBankAccountId: f.to, amountFrom: Number(f.amountFrom), amountTo: cross ? Number(f.amountTo) : undefined, fee: f.fee ? Number(f.fee) : 0, date: f.date || undefined, reference: f.reference }))
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Modal
      open
      onClose={onClose}
      title="New transfer"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: (t) => { toast.success(`Transfer ${t.number} posted`); onClose() }, onError: (e) => toast.error('Not posted', e.message) })}>Post transfer</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="tr-from" label="From"><SelectInput id="tr-from" value={f.from} onChange={(e) => set('from', e.target.value)}><option value="">Choose…</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</SelectInput></Field>
        <Field id="tr-to" label="To"><SelectInput id="tr-to" value={f.to} onChange={(e) => set('to', e.target.value)}><option value="">Choose…</option>{accounts.data?.filter((a) => a.id !== f.from).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</SelectInput></Field>
        <Field id="tr-out" label={`Amount out${from ? ` (${from.currency})` : ''}`}><TextInput id="tr-out" inputMode="decimal" value={f.amountFrom} onChange={(e) => set('amountFrom', e.target.value)} /></Field>
        {cross && <Field id="tr-in" label={`Amount in (${to!.currency})`}><TextInput id="tr-in" inputMode="decimal" value={f.amountTo} onChange={(e) => set('amountTo', e.target.value)} /></Field>}
        <Field id="tr-fee" label="Bank fee"><TextInput id="tr-fee" inputMode="decimal" value={f.fee} onChange={(e) => set('fee', e.target.value)} /></Field>
        <Field id="tr-date" label="Date"><TextInput id="tr-date" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field id="tr-ref" label="Reference"><TextInput id="tr-ref" value={f.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

/* ---------------- reconcile ---------------- */

function ReconcileTab({ accountId, onAccount }: { accountId: string | null; onAccount: (id: string) => void }) {
  const accounts = useBankAccounts()
  const banks = (accounts.data ?? []).filter((a) => a.kind !== 'cash')
  const id = accountId ?? banks[0]?.id ?? null
  if (accounts.isError) return <ErrorState message={errMsg(accounts.error)} />
  if (!accounts.data) return <Skeleton className="h-64" />
  return (
    <div className="space-y-4">
      <Field id="rec-account" label="Bank account" className="max-w-sm">
        <SelectInput id="rec-account" value={id ?? ''} onChange={(e) => onAccount(e.target.value)}>
          {banks.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </SelectInput>
      </Field>
      {id && <Workspace id={id} />}
    </div>
  )
}

function Workspace({ id }: { id: string }) {
  const q = useWorkspace(id)
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [selS, setSelS] = useState<string[]>([])
  const [selB, setSelB] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [entryFor, setEntryFor] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const auto = useBankingMutation(() => bankingApi.autoMatch(id))
  const match = useBankingMutation(() => bankingApi.match(id, { statementLineIds: selS, journalLineIds: selB }))
  const unmatch = useBankingMutation((matchId: string) => bankingApi.unmatch(matchId))
  const accept = useBankingMutation((s: { statementLineId: string; journalLineIds: string[] }) => bankingApi.match(id, { statementLineIds: [s.statementLineId], journalLineIds: s.journalLineIds }))
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  const w = q.data
  if (!w) return <Skeleton className="h-96" />
  const cur = w.bankAccount.currency
  const sumS = w.statementLines.filter((l) => selS.includes(l.id)).reduce((s, l) => s + l.amount, 0)
  const sumB = w.bookLines.filter((l) => selB.includes(l.id)).reduce((s, l) => s + l.amount, 0)
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Statement date', w.statementDate ? fmtDate(w.statementDate) : '—'],
          ['Statement balance', w.statementBalance === null ? '—' : <Amount key="sb" value={w.statementBalance} currency={cur} />],
          ['Cleared book balance', <Amount key="cb" value={w.clearedBalance} currency={cur} />],
          ['Difference', <span key="d" data-testid="recon-difference" className={w.difference === 0 ? 'text-success-700' : 'text-danger-600'}><Amount value={w.difference} /></span>],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="num mt-0.5 font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {isFull && (
        <div className="flex flex-wrap gap-2">
          <Button write variant="secondary" onClick={() => setImporting(true)}><FileUp />Import statement</Button>
          <Button write variant="secondary" loading={auto.isPending} onClick={() => auto.mutate(undefined, { onSuccess: (r) => toast.success('Auto-match done', `${(r as ReconcileWorkspace & { autoMatched?: number }).autoMatched ?? 0} matched`), onError: (e) => toast.error('Not done', e.message) })}><Sparkles />Auto-match</Button>
          <Button write disabled={!selS.length || !selB.length} loading={match.isPending} onClick={() => match.mutate(undefined, { onSuccess: () => { setSelS([]); setSelB([]); toast.success('Matched') }, onError: (e) => toast.error('Not matched', e.message) })}>
            Match selected{selS.length || selB.length ? ` (${sumS.toFixed(2)} / ${sumB.toFixed(2)})` : ''}
          </Button>
          <Button write onClick={() => setFinishing(true)} disabled={w.statementBalance === null}><Scale />Finish reconciliation</Button>
        </div>
      )}

      {w.suggestions.length > 0 && isFull && (
        <section aria-label="Suggested matches" className="rounded-xl border border-line p-3">
          <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Suggestions ({w.suggestions.length})</h3>
          <ul className="space-y-1 text-[0.8125rem]">
            {w.suggestions.slice(0, 10).map((s) => {
              const sl = w.statementLines.find((l) => l.id === s.statementLineId)
              const bl = w.bookLines.find((l) => l.id === s.journalLineIds[0])
              return (
                <li key={s.statementLineId} className="flex items-center justify-between gap-2">
                  <span>{sl?.description} · {fmtDate(sl?.date)} ↔ {bl?.entryNumber} {bl?.memo} <span className="text-xs text-muted">({s.score}: {s.reasons.join(', ')})</span></span>
                  <Button size="sm" variant="secondary" onClick={() => accept.mutate(s, { onError: (e) => toast.error('Not matched', e.message) })}>Accept</Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section aria-label="Unmatched statement lines">
          <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Statement lines to match ({w.statementLines.length})</h3>
          <SimpleTable label="Statement lines" head={<tr><th className={th} /><th className={th}>Date</th><th className={th}>Description</th><th className={thEnd}>Amount</th><th className={th} /></tr>}>
            {w.statementLines.map((l) => (
              <tr key={l.id}>
                <td className={td}>{isFull && <Checkbox aria-label={`Select ${l.description}`} checked={selS.includes(l.id)} onChange={() => toggle(selS, setSelS, l.id)} />}</td>
                <td className={td}>{fmtDate(l.date)}</td>
                <td className={td}>{l.description}<div className="text-xs text-muted">{l.reference}</div></td>
                <td className={tdEnd}><Amount value={l.amount} /></td>
                <td className={`${td} text-end`}>{isFull && <Button size="sm" variant="ghost" onClick={() => setEntryFor(l.id)}>Create entry</Button>}</td>
              </tr>
            ))}
          </SimpleTable>
        </section>
        <section aria-label="Unmatched book lines">
          <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Book lines to match ({w.bookLines.length})</h3>
          <SimpleTable label="Book lines" head={<tr><th className={th} /><th className={th}>Date</th><th className={th}>Entry</th><th className={thEnd}>Amount</th></tr>}>
            {w.bookLines.map((l) => (
              <tr key={l.id}>
                <td className={td}>{isFull && <Checkbox aria-label={`Select ${l.entryNumber}`} checked={selB.includes(l.id)} onChange={() => toggle(selB, setSelB, l.id)} />}</td>
                <td className={td}>{fmtDate(l.date)}</td>
                <td className={td}><EntryLink id={l.entryId} number={l.entryNumber} /><div className="text-xs text-muted">{l.memo}{l.sourceNumber ? ` · ${l.sourceNumber}` : ''}</div></td>
                <td className={tdEnd}><Amount value={l.amount} /></td>
              </tr>
            ))}
          </SimpleTable>
        </section>
      </div>

      {w.matches.length > 0 && (
        <section aria-label="Matched, not yet reconciled">
          <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Matched in this session ({w.matches.length})</h3>
          <SimpleTable label="Matches" head={<tr><th className={th}>Statement</th><th className={th}>Book</th><th className={thEnd}>Amount</th><th className={th} /></tr>}>
            {w.matches.map((m) => (
              <tr key={m.id}>
                <td className={td}>{m.statementLines.map((l) => `${fmtDate(l.date)} ${l.description}`).join('; ')}</td>
                <td className={td}>{m.bookLines.map((l) => l.entryNumber).join(', ')} <Badge tone={m.kind === 'created' ? 'teal' : m.kind === 'auto' ? 'sky' : 'neutral'}>{m.kind}</Badge></td>
                <td className={tdEnd}><Amount value={m.amount} /></td>
                <td className={`${td} text-end`}>{isFull && <Button size="sm" variant="ghost" onClick={() => unmatch.mutate(m.id, { onError: (e) => toast.error('Not unmatched', e.message) })}>Unmatch</Button>}</td>
              </tr>
            ))}
          </SimpleTable>
        </section>
      )}

      <History bankAccountId={id} onOpen={setReport} />
      {importing && <ImportStatementModal bankAccountId={id} onClose={() => setImporting(false)} />}
      {entryFor && <EntryModal ws={w} lineId={entryFor} onClose={() => setEntryFor(null)} />}
      {finishing && <FinishModal ws={w} onClose={() => setFinishing(false)} onDone={(rid) => setReport(rid)} />}
      {report && <ReportDrawer id={report} onClose={() => setReport(null)} />}
    </div>
  )
}

function EntryModal({ ws, lineId, onClose }: { ws: ReconcileWorkspace; lineId: string; onClose: () => void }) {
  const line = ws.statementLines.find((l) => l.id === lineId)!
  const accounts = useAccounts()
  const toast = useToast()
  const [accountId, setAccountId] = useState(line.ruleAccountId ?? '')
  const [memo, setMemo] = useState('')
  const [saveRule, setSaveRule] = useState(false)
  const [contains, setContains] = useState(line.description.split(/\s+/).slice(0, 2).join(' '))
  const post = useBankingMutation(() => bankingApi.createEntry(lineId, { accountId, memo, saveRule, ruleContains: contains }))
  const options = (accounts.data ?? []).filter((a) => a.active && !a.isHeader && a.id !== ws.bankAccount.ledgerAccountId)
  return (
    <Modal
      open
      onClose={onClose}
      title="Create an entry from the statement line"
      description={`${fmtDate(line.date)} · ${line.description} · ${line.amount.toFixed(2)} ${ws.bankAccount.currency}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write disabled={!accountId} loading={post.isPending} onClick={() => post.mutate(undefined, { onSuccess: () => { toast.success('Entry posted and matched'); onClose() }, onError: (e) => toast.error('Not posted', e.message) })}>Post and match</Button></>}
    >
      <div className="space-y-3">
        <Field id="ce-account" label={line.amount < 0 ? 'Expense / account (debit)' : 'Income / account (credit)'} hint={line.ruleAccountId ? 'Suggested by a bank rule' : undefined}>
          <SelectInput id="ce-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="ce-memo" label="Memo"><TextInput id="ce-memo" value={memo} placeholder={line.description} onChange={(e) => setMemo(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[0.8125rem]"><Checkbox checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} />Remember as a bank rule: description contains</label>
        {saveRule && <TextInput aria-label="Description contains" value={contains} onChange={(e) => setContains(e.target.value)} />}
      </div>
    </Modal>
  )
}

function FinishModal({ ws, onClose, onDone }: { ws: ReconcileWorkspace; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast()
  const [date, setDate] = useState(ws.statementDate ?? '')
  const [balance, setBalance] = useState(ws.statementBalance !== null ? String(ws.statementBalance) : '')
  const finish = useBankingMutation(() => bankingApi.finish(ws.bankAccount.id, { statementDate: date, statementBalance: Number(balance) }))
  return (
    <Modal
      open
      onClose={onClose}
      title="Finish reconciliation"
      description="The statement balance must equal the cleared book balance (difference 0)."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: (r) => { toast.success('Reconciled', `to ${fmtDate(r.statementDate)}`); onClose(); onDone(r.id) }, onError: (e) => toast.error('Not reconciled', e.message) })}>Finish</Button></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="fin-date" label="Statement date"><TextInput id="fin-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="fin-bal" label="Statement balance"><TextInput id="fin-bal" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-[0.8125rem] text-muted">Cleared book balance now: {ws.clearedBalance.toFixed(2)} {ws.bankAccount.currency}</p>
    </Modal>
  )
}

function History({ bankAccountId, onOpen }: { bankAccountId: string; onOpen: (id: string) => void }) {
  const q = useReconciliations(bankAccountId)
  if (!q.data?.length) return null
  return (
    <section aria-label="Reconciliations">
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Reconciliations</h3>
      <SimpleTable label="Reconciliation history" head={<tr><th className={th}>Statement date</th><th className={thEnd}>Statement balance</th><th className={th}>Status</th><th className={th}>By</th><th className={th} /></tr>}>
        {q.data.map((r) => (
          <tr key={r.id}>
            <td className={td}>{fmtDate(r.statementDate)}</td>
            <td className={tdEnd}><Amount value={r.statementBalance} /></td>
            <td className={td}><Badge tone={r.status === 'finished' ? 'green' : 'neutral'}>{r.status === 'finished' ? 'Reconciled' : 'Undone'}</Badge></td>
            <td className={td}>{r.finishedByName ?? 'System'} · {fmtDate(r.finishedAt)}</td>
            <td className={`${td} text-end`}><Button size="sm" variant="ghost" onClick={() => onOpen(r.id)}>Report</Button></td>
          </tr>
        ))}
      </SimpleTable>
    </section>
  )
}

function ReportDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useReconciliation(id)
  const toast = useToast()
  const undo = useBankingMutation(() => bankingApi.undo(id))
  const r = q.data
  return (
    <Drawer open onClose={onClose} title="Reconciliation report" description={r ? `${r.bankAccountName} · ${fmtDate(r.statementDate)}` : undefined}>
      {!r ? <Skeleton className="h-64" /> : (
        <div className="space-y-4 text-[0.8125rem]">
          <dl className="grid grid-cols-2 gap-2">
            <dt className="text-muted">Book balance</dt><dd className="text-end"><Amount value={r.bookBalance} currency={r.currency} /></dd>
            <dt className="text-muted">Less outstanding deposits</dt><dd className="text-end"><Amount value={-r.outstandingDeposits.reduce((s, l) => s + l.amount, 0)} /></dd>
            <dt className="text-muted">Add outstanding payments</dt><dd className="text-end"><Amount value={-r.outstandingPayments.reduce((s, l) => s + l.amount, 0)} /></dd>
            <dt className="font-semibold">Adjusted book balance</dt><dd className="text-end font-semibold"><Amount value={r.adjustedBookBalance} /></dd>
            <dt className="font-semibold">Statement balance</dt><dd className="text-end font-semibold"><Amount value={r.statementBalance} /></dd>
          </dl>
          {[['Outstanding deposits', r.outstandingDeposits], ['Outstanding payments', r.outstandingPayments]].map(([title, rows]) => (
            <section key={title as string}>
              <h4 className="mb-1 font-semibold text-ink">{title as string}</h4>
              {(rows as typeof r.outstandingDeposits).length ? (
                <ul className="space-y-0.5">{(rows as typeof r.outstandingDeposits).map((l) => <li key={l.id} className="flex justify-between gap-2"><span>{fmtDate(l.date)} · {l.entryNumber} {l.memo}</span><Amount value={l.amount} /></li>)}</ul>
              ) : <p className="text-muted">None.</p>}
            </section>
          ))}
          {r.canUndo && <Button write variant="secondary" loading={undo.isPending} onClick={() => undo.mutate(undefined, { onSuccess: () => { toast.success('Reconciliation undone'); onClose() }, onError: (e) => toast.error('Not undone', e.message) })}><Undo2 />Undo this reconciliation</Button>}
        </div>
      )}
    </Drawer>
  )
}

/* ---------------- rules ---------------- */

function RulesTab() {
  const q = useRules()
  const accounts = useAccounts()
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [f, setF] = useState({ contains: '', direction: 'any' as 'any' | 'in' | 'out', accountId: '' })
  const add = useBankingMutation(() => bankingApi.createRule(f))
  const del = useBankingMutation((id: string) => bankingApi.deleteRule(id))
  const options = useMemo(() => (accounts.data ?? []).filter((a) => a.active && !a.isHeader), [accounts.data])
  if (!q.data) return <Skeleton className="h-48" />
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted">When a statement line’s description contains the text, “Create entry” suggests the account.</p>
      <SimpleTable label="Bank rules" head={<tr><th className={th}>Description contains</th><th className={th}>Direction</th><th className={th}>Account</th><th className={th} /></tr>}>
        {q.data.map((r) => (
          <tr key={r.id}>
            <td className={td}>“{r.contains}”</td>
            <td className={td}>{r.direction === 'any' ? 'In or out' : r.direction === 'in' ? 'Money in' : 'Money out'}</td>
            <td className={td}>{r.accountCode} {r.accountName}</td>
            <td className={`${td} text-end`}>{isFull && <Button size="sm" variant="ghost" iconOnly aria-label={`Delete rule ${r.contains}`} onClick={() => del.mutate(r.id)}><Trash2 /></Button>}</td>
          </tr>
        ))}
      </SimpleTable>
      {isFull && (
        <div className="flex flex-wrap items-end gap-2">
          <Field id="rule-contains" label="Description contains"><TextInput id="rule-contains" value={f.contains} onChange={(e) => setF({ ...f, contains: e.target.value })} /></Field>
          <Field id="rule-dir" label="Direction"><SelectInput id="rule-dir" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as 'any' | 'in' | 'out' })}><option value="any">In or out</option><option value="in">Money in</option><option value="out">Money out</option></SelectInput></Field>
          <Field id="rule-acc" label="Account"><SelectInput id="rule-acc" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}><option value="">Choose…</option>{options.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</SelectInput></Field>
          <Button write onClick={() => add.mutate(undefined, { onSuccess: () => { setF({ contains: '', direction: 'any', accountId: '' }); toast.success('Rule added') }, onError: (e) => toast.error('Not added', e.message) })}>Add rule</Button>
        </div>
      )}
    </div>
  )
}

/* ---------------- payroll postings ---------------- */

const POSTING_LABEL: Record<string, string> = { not_posted: 'Not posted', accrued: 'Accrued', paid: 'Paid', reversed: 'Reversed', skipped_locked: 'Locked period', error: 'Error' }

function PayrollTab() {
  const q = usePayrollPostings()
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
  if (!q.data) return <Skeleton className="h-48" />
  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted">Approved runs accrue salaries (Dr 6100 / 6110 / 6130 · Cr 2400 / 2410 / 1410); paid runs post Dr 2400 / Cr bank (the WPS / Mudad total). Reopening a run in HR reverses its accrual.</p>
      <SimpleTable label="Payroll postings" head={<tr><th className={th}>Month</th><th className={th}>Run</th><th className={th}>Posting</th><th className={thEnd}>Gross</th><th className={thEnd}>Net</th><th className={thEnd}>Social insurance</th><th className={th}>Accrual</th><th className={th}>Payment</th></tr>}>
        {q.data.map((p) => (
          <tr key={p.runId}>
            <td className={td}><a className="text-brand-700 hover:underline dark:text-brand-300" href={p.runLink}>{monthName(p.month)}</a></td>
            <td className={td}>{p.runStatus}</td>
            <td className={td}><Badge tone={p.status === 'paid' ? 'green' : p.status === 'accrued' ? 'blue' : p.status === 'error' ? 'red' : 'neutral'}>{POSTING_LABEL[p.status]}</Badge>{p.note && <div className="text-xs text-muted">{p.note}</div>}</td>
            <td className={tdEnd}><Amount value={p.totals.gross} /></td>
            <td className={tdEnd}><Amount value={p.totals.net} /></td>
            <td className={tdEnd}><Amount value={p.totals.employeeSocialInsurance + p.totals.employerSocialInsurance} /></td>
            <td className={td}>{p.accrualEntryId ? <EntryLink id={p.accrualEntryId} number={p.accrualEntryNumber ?? ''} /> : '—'}</td>
            <td className={td}>{p.paymentEntryId ? <EntryLink id={p.paymentEntryId} number={p.paymentEntryNumber ?? ''} /> : '—'}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  )
}
