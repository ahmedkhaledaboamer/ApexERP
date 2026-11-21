import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, CheckCircle2, Plus, Scale, Trash2, Undo2, Wand2 } from 'lucide-react'
import type { JournalSourceType } from '@/modules/finance/types'
import { ACCOUNT_TYPE_LABEL } from '@/modules/finance/types'
import type { AccountRow, JournalFilters, ManualLineInput } from '@/modules/finance/ledger/types'
import { SOURCE_TYPE_LABEL } from '@/modules/finance/ledger/types'
import { r2 } from '@/modules/finance/ledger/calc'
import {
  ledgerApi,
  useAccounts,
  useDimensions,
  useFinanceMutation,
  useFinanceOverview,
  useFinanceScope,
  useFinanceSettings,
  useJournal,
  useJournalEntry,
  useTrialBalance,
} from '@/modules/finance/ledger/api'
import { Amount, SimpleTable, SourceBadge, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Modal } from '@/shared/components/ui/Modal'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

type Tab = 'entries' | 'trial-balance'
const TABS: { id: Tab; label: string }[] = [
  { id: 'entries', label: 'Entries' },
  { id: 'trial-balance', label: 'Trial balance' },
]

/**
 * `/finance/journal`: the general journal (filters: dates, source, account, text), entry detail with its source document
 * and reversal (?entry=), manual journal entries (?new=1), the opening balances wizard and the trial balance
 * (?tab=trial-balance). Sales Manager: read only.
 */
export default function JournalPage() {
  const { isFull } = useFinanceScope()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'trial-balance' ? 'trial-balance' : 'entries'
  const set = (k: string, v: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (v) n.set(k, v)
      else n.delete(k)
      return n
    })
  const [opening, setOpening] = useState(false)
  const overview = useFinanceOverview()
  const lock = overview.data?.lockDate ?? null
  return (
    <>
      <PageHeader
        icon={<IconTile><BookOpen /></IconTile>}
        title="Journal"
        description={lock ? `Every posting in the general ledger. Books locked up to ${fmtDate(lock)}.` : 'Every posting in the general ledger.'}
        actions={
          isFull ? (
            <>
              <Button write variant="secondary" onClick={() => setOpening(true)}>
                <Wand2 className="size-4" aria-hidden /> Opening balances
              </Button>
              <Button write onClick={() => set('new', '1')}>
                <Plus className="size-4" aria-hidden /> New journal entry
              </Button>
            </>
          ) : undefined
        }
      >
        <Tabs label="Journal" items={TABS} value={tab} onChange={(t) => set('tab', t === 'entries' ? null : t)} />
      </PageHeader>
      <PageBody>
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'entries' ? <EntriesTab onOpen={(id) => set('entry', id)} /> : <TrialBalanceTab />}
        </div>
      </PageBody>
      <EntryDrawer id={params.get('entry')} onClose={() => set('entry', null)} onOpen={(id) => set('entry', id)} />
      {isFull && params.get('new') === '1' && <ManualEntryModal onClose={() => set('new', null)} onPosted={(id) => setParams(new URLSearchParams({ entry: id }))} />}
      {isFull && opening && <OpeningBalancesModal onClose={() => setOpening(false)} onPosted={(id) => { setOpening(false); set('entry', id) }} />}
    </>
  )
}

const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABEL) as JournalSourceType[]

function EntriesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [f, setF] = useState<JournalFilters>({})
  const [text, setText] = useState('')
  const filters = useMemo(() => ({ ...f, q: text.trim() || undefined }), [f, text])
  const q = useJournal(filters)
  const accounts = useAccounts()
  const settings = useFinanceSettings()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="j-from" label="From"><TextInput id="j-from" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} /></Field>
        <Field id="j-to" label="To"><TextInput id="j-to" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} /></Field>
        <Field id="j-source" label="Source">
          <SelectInput id="j-source" value={f.sourceType ?? ''} onChange={(e) => setF({ ...f, sourceType: e.target.value || undefined })}>
            <option value="">All sources</option>
            {SOURCE_TYPES.map((s) => <option key={s} value={s}>{SOURCE_TYPE_LABEL[s]}</option>)}
          </SelectInput>
        </Field>
        <Field id="j-account" label="Account">
          <SelectInput id="j-account" value={f.accountId ?? ''} onChange={(e) => setF({ ...f, accountId: e.target.value || undefined })}>
            <option value="">All accounts</option>
            {(accounts.data ?? []).filter((a) => !a.isHeader).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </SelectInput>
        </Field>
        <div className="min-w-60 flex-1">
          <SearchInput aria-label="Search the journal" placeholder="Number, memo, account…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-72" />
      ) : q.data.length === 0 ? (
        <EmptyState title="No entries" body="Nothing matches these filters." icon={<BookOpen />} />
      ) : (
        <SimpleTable
          label="Journal entries"
          head={
            <tr>
              <th className={th}>Entry</th>
              <th className={th}>Date</th>
              <th className={th}>Memo</th>
              <th className={th}>Accounts</th>
              <th className={th}>Source</th>
              <th className={thEnd}>Amount ({settings.data?.baseCurrency ?? ''})</th>
            </tr>
          }
        >
          {q.data.map((e) => (
            <tr key={e.id}>
              <td className={td}>
                <button type="button" className="num font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => onOpen(e.id)}>
                  {e.number}
                </button>
                {e.status === 'reversed' && <Badge tone="amber" className="ms-2">Reversed</Badge>}
                {e.reversalOf && <Badge className="ms-2">Reversal</Badge>}
              </td>
              <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(e.date)}</td>
              <td className={td}>{e.memo}</td>
              <td className={cn(td, 'text-muted')}>{e.accountNames.slice(0, 3).join(', ')}{e.accountNames.length > 3 ? ` +${e.accountNames.length - 3}` : ''}</td>
              <td className={td}><SourceBadge type={e.sourceType} />{e.sourceNumber && <span className="num ms-1 text-xs text-muted">{e.sourceNumber}</span>}</td>
              <td className={tdEnd}><Amount value={e.total} /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

function TrialBalanceTab() {
  const [asOf, setAsOf] = useState('')
  const q = useTrialBalance(asOf || undefined)
  const tb = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="tb-asof" label="As of"><TextInput id="tb-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        {tb && (
          <p className="pb-2 text-[0.8125rem]">
            {tb.balanced ? (
              <span className="inline-flex items-center gap-1 text-success-700 dark:text-success-500"><CheckCircle2 className="size-4" aria-hidden /> Balanced at {fmtDate(tb.asOf)}</span>
            ) : (
              <span className="text-danger-600">Out of balance</span>
            )}
          </p>
        )}
      </div>
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} />
      ) : !tb ? (
        <Skeleton className="h-72" />
      ) : (
        <SimpleTable
          label="Trial balance"
          head={
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Account</th>
              <th className={th}>Type</th>
              <th className={thEnd}>Debit</th>
              <th className={thEnd}>Credit</th>
            </tr>
          }
          foot={
            <tr>
              <td className={td} colSpan={3}>Total ({tb.currency})</td>
              <td className={tdEnd}><Amount value={tb.totals.debit} strong /></td>
              <td className={tdEnd}><Amount value={tb.totals.credit} strong /></td>
            </tr>
          }
        >
          {tb.rows.map((r) => (
            <tr key={r.accountId}>
              <td className={cn(td, 'num')}>{r.code}</td>
              <td className={td}><Link className="hover:underline" to={`/finance/accounts?account=${encodeURIComponent(r.accountId)}`}>{r.name}</Link></td>
              <td className={cn(td, 'text-muted')}>{ACCOUNT_TYPE_LABEL[r.type]}</td>
              <td className={tdEnd}><Amount value={r.debit} blankZero /></td>
              <td className={tdEnd}><Amount value={r.credit} blankZero /></td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

function EntryDrawer({ id, onClose, onOpen }: { id: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const q = useJournalEntry(id)
  const e = q.data
  const toast = useToast()
  const [reversing, setReversing] = useState(false)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reverse = useFinanceMutation(() => ledgerApi.reverse(id!, { date, memo }))
  const hasDims = !!e?.lines.some((l) => l.departmentName || l.projectName || l.eventName || l.customerName)
  return (
    <Drawer
      open={!!id}
      onClose={() => { setReversing(false); setError(null); onClose() }}
      width="xl"
      title={e ? `Journal entry ${e.number}` : 'Journal entry'}
      description={e ? `${fmtDate(e.date)} · by ${e.createdByName}` : undefined}
      footer={
        e?.canReverse && !reversing ? (
          <Button write variant="secondary" onClick={() => { setReversing(true); setDate(''); setMemo('') }}>
            <Undo2 className="size-4" aria-hidden /> Reverse
          </Button>
        ) : undefined
      }
    >
      {q.isError ? (
        <ErrorState message={errMsg(q.error)} />
      ) : !e ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <SourceBadge type={e.sourceType} />
            {e.sourceLink ? (
              <Link to={e.sourceLink} className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                {e.sourceNumber ?? `Open the ${SOURCE_TYPE_LABEL[e.sourceType].toLowerCase()}`}
              </Link>
            ) : null}
            {e.status === 'reversed' && e.reversedBy && (
              <span>Reversed by <button type="button" className="num font-medium text-brand-700 hover:underline" onClick={() => onOpen(e.reversedBy!)}>{e.reversedByNumber}</button></span>
            )}
            {e.reversalOf && (
              <span>Reverses <button type="button" className="num font-medium text-brand-700 hover:underline" onClick={() => onOpen(e.reversalOf!)}>{e.reversalOfNumber}</button></span>
            )}
          </div>
          <p className="text-sm text-ink">{e.memo}</p>
          <SimpleTable
            label="Entry lines"
            head={
              <tr>
                <th className={th}>Account</th>
                <th className={th}>Description</th>
                {hasDims && <th className={th}>Dimensions</th>}
                <th className={thEnd}>Debit</th>
                <th className={thEnd}>Credit</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td} colSpan={hasDims ? 3 : 2}>Total</td>
                <td className={tdEnd}><Amount value={e.total} /></td>
                <td className={tdEnd}><Amount value={e.total} /></td>
              </tr>
            }
          >
            {e.lines.map((l, i) => (
              <tr key={i}>
                <td className={td}><span className="num me-2 text-muted">{l.accountCode}</span>{l.accountName}</td>
                <td className={td}>{l.description}</td>
                {hasDims && <td className={cn(td, 'text-xs text-muted')}>{[l.departmentName, l.projectName, l.eventName, l.customerName].filter(Boolean).join(' · ')}</td>}
                <td className={tdEnd}><Amount value={l.debit} blankZero /></td>
                <td className={tdEnd}><Amount value={l.credit} blankZero /></td>
              </tr>
            ))}
          </SimpleTable>
          {!e.canReverse && e.reverseBlockedReason && e.reverseBlockedReason !== 'View only.' && <p className="text-xs text-muted">{e.reverseBlockedReason}</p>}
          {reversing && (
            <div className="space-y-3 rounded-lg border border-line p-4">
              <p className="text-[0.8125rem] font-medium">Post the mirror entry</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="rev-date" label="Reversal date" hint="Today when empty"><TextInput id="rev-date" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></Field>
                <Field id="rev-memo" label="Memo"><TextInput id="rev-memo" value={memo} placeholder={`Reversal of ${e.number}`} onChange={(ev) => setMemo(ev.target.value)} /></Field>
              </div>
              {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
              <div className="flex gap-2">
                <Button write loading={reverse.isPending} onClick={() => reverse.mutate(undefined, { onSuccess: (rev) => { toast.success('Entry reversed', rev.number); setReversing(false); onOpen(rev.id) }, onError: (er) => setError(er.message) })}>
                  Post reversal
                </Button>
                <Button variant="ghost" onClick={() => setReversing(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

interface LineDraft extends ManualLineInput {
  key: number
  debitText: string
  creditText: string
}
let lineKey = 0
const emptyLine = (): LineDraft => ({ key: ++lineKey, accountId: '', debit: 0, credit: 0, description: '', departmentId: null, projectId: null, eventId: null, customerId: null, debitText: '', creditText: '' })
const amountOf = (s: string) => {
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? r2(n) : 0
}

function ManualEntryModal({ onClose, onPosted }: { onClose: () => void; onPosted: (id: string) => void }) {
  const toast = useToast()
  const accounts = useAccounts()
  const dims = useDimensions(true)
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()])
  const [error, setError] = useState<string | null>(null)
  const post = useFinanceMutation(() =>
    ledgerApi.postManual({
      date,
      memo,
      lines: lines
        .filter((l) => l.accountId)
        .map((l) => ({ accountId: l.accountId, debit: amountOf(l.debitText), credit: amountOf(l.creditText), description: l.description, departmentId: l.departmentId || null, projectId: l.projectId || null, eventId: l.eventId || null, customerId: l.customerId || null })),
    }),
  )
  const postable = (accounts.data ?? []).filter((a) => a.active && !a.isHeader)
  const dr = r2(lines.reduce((s, l) => s + amountOf(l.debitText), 0))
  const cr = r2(lines.reduce((s, l) => s + amountOf(l.creditText), 0))
  const diff = r2(dr - cr)
  const upd = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const dimSelect = (l: LineDraft, n: number, field: 'departmentId' | 'projectId' | 'eventId' | 'customerId', label: string, options: { id: string; name: string }[] | undefined) =>
    options && options.length > 0 ? (
      <SelectInput aria-label={`Line ${n} ${label.toLowerCase()}`} value={l[field] ?? ''} onChange={(e) => upd(l.key, { [field]: e.target.value || null })} className="h-8 text-xs">
        <option value="">{label}: none</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </SelectInput>
    ) : null

  return (
    <Drawer
      open
      width="xl"
      onClose={onClose}
      title="New journal entry"
      description="A balanced manual entry in the base currency. Dimensions are optional, per line."
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <span className={cn('text-[0.8125rem]', diff === 0 && dr > 0 ? 'text-success-700 dark:text-success-500' : 'text-muted')} aria-live="polite">
            Debits <Amount value={dr} /> · Credits <Amount value={cr} />{diff !== 0 ? <> · Difference <Amount value={diff} /></> : dr > 0 ? ' · Balanced' : ''}
          </span>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={post.isPending}
            disabled={diff !== 0 || dr === 0}
            onClick={() => {
              setError(null)
              post.mutate(undefined, {
                onSuccess: (e) => {
                  toast.success('Journal entry posted', e.number)
                  onPosted(e.id)
                },
                onError: (e) => setError(e.message),
              })
            }}
          >
            Post entry
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field id="je-date" label="Date" required><TextInput id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field id="je-memo" label="Memo" required><TextInput id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
        </div>
        <ol className="space-y-3" aria-label="Lines">
          {lines.map((l, i) => (
            <li key={l.key} className="space-y-2 rounded-lg border border-line p-3">
              <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_7rem_7rem_auto]">
                <SelectInput aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => upd(l.key, { accountId: e.target.value })}>
                  <option value="">Account…</option>
                  {postable.map((a: AccountRow) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </SelectInput>
                <TextInput aria-label={`Line ${i + 1} description`} placeholder="Description" value={l.description ?? ''} onChange={(e) => upd(l.key, { description: e.target.value })} />
                <TextInput aria-label={`Line ${i + 1} debit`} placeholder="Debit" inputMode="decimal" className="text-end" value={l.debitText} onChange={(e) => upd(l.key, { debitText: e.target.value, creditText: e.target.value ? '' : l.creditText })} />
                <TextInput aria-label={`Line ${i + 1} credit`} placeholder="Credit" inputMode="decimal" className="text-end" value={l.creditText} onChange={(e) => upd(l.key, { creditText: e.target.value, debitText: e.target.value ? '' : l.debitText })} />
                <Button variant="ghost" size="sm" iconOnly aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {dimSelect(l, i + 1, 'departmentId', 'Department', dims.data?.departments)}
                {dimSelect(l, i + 1, 'projectId', 'Project', dims.data?.projects)}
                {dimSelect(l, i + 1, 'eventId', 'Event', dims.data?.events)}
                {dimSelect(l, i + 1, 'customerId', 'Customer', dims.data?.customers)}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="size-4" aria-hidden /> Add line
          </Button>
          {diff !== 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const last = lines[lines.length - 1]
                upd(last.key, diff > 0 ? { creditText: String(r2(amountOf(last.creditText) + diff)), debitText: '' } : { debitText: String(r2(amountOf(last.debitText) - diff)), creditText: '' })
              }}
            >
              <Scale className="size-4" aria-hidden /> Balance on the last line
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}
      </div>
    </Drawer>
  )
}

function OpeningBalancesModal({ onClose, onPosted }: { onClose: () => void; onPosted: (id: string) => void }) {
  const toast = useToast()
  const accounts = useAccounts()
  const settings = useFinanceSettings()
  const [step, setStep] = useState<1 | 2>(1)
  const [date, setDate] = useState('')
  const [values, setValues] = useState<Record<string, { debit: string; credit: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const sheet = (accounts.data ?? []).filter((a) => a.active && !a.isHeader && ['asset', 'liability', 'equity'].includes(a.type) && a.systemRole !== 'opening_balance_equity')
  const lines = Object.entries(values)
    .map(([accountId, v]) => ({ accountId, debit: amountOf(v.debit), credit: amountOf(v.credit) }))
    .filter((l) => l.debit > 0 || l.credit > 0)
  const diff = r2(lines.reduce((s, l) => s + l.debit - l.credit, 0))
  const post = useFinanceMutation(() => ledgerApi.postOpening({ date, lines }))
  const cur = settings.data?.baseCurrency ?? ''
  return (
    <Modal
      open
      onClose={onClose}
      title="Opening balances"
      description={step === 1 ? 'Step 1 of 2 · the date your books start in the system (usually the first day of the fiscal year).' : 'Step 2 of 2 · each balance sheet account’s balance on that date. The difference goes to opening balance equity.'}
      footer={
        <div className="flex w-full items-center gap-3">
          {step === 2 && (
            <span className="text-[0.8125rem] text-muted">
              Opening balance equity: <Amount value={-diff} currency={cur} />
            </span>
          )}
          <span className="flex-1" />
          {step === 2 && <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>}
          {step === 1 ? (
            <Button disabled={!date} onClick={() => setStep(2)}>Next</Button>
          ) : (
            <Button
              write
              loading={post.isPending}
              disabled={lines.length === 0}
              onClick={() => {
                setError(null)
                post.mutate(undefined, { onSuccess: (e) => { toast.success('Opening balances posted', e.number); onPosted(e.id) }, onError: (e) => setError(e.message) })
              }}
            >
              Post opening balances
            </Button>
          )}
        </div>
      }
    >
      {step === 1 ? (
        <Field id="ob-date" label="Opening date" required hint={settings.data?.lockDate ? `Must be after the lock date (${fmtDate(settings.data.lockDate)}).` : undefined}>
          <TextInput id="ob-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      ) : (
        <div className="max-h-[55vh] space-y-1 overflow-y-auto">
          {sheet.map((a) => (
            <div key={a.id} className="grid grid-cols-[1fr_7rem_7rem] items-center gap-2 py-1 text-[0.8125rem]">
              <span className="truncate"><span className="num me-2 text-muted">{a.code}</span>{a.name} <span className="text-xs text-subtle">{ACCOUNT_TYPE_LABEL[a.type]}</span></span>
              <TextInput aria-label={`${a.code} debit`} placeholder="Debit" inputMode="decimal" className="h-8 text-end" value={values[a.id]?.debit ?? ''} onChange={(e) => setValues((v) => ({ ...v, [a.id]: { debit: e.target.value, credit: '' } }))} />
              <TextInput aria-label={`${a.code} credit`} placeholder="Credit" inputMode="decimal" className="h-8 text-end" value={values[a.id]?.credit ?? ''} onChange={(e) => setValues((v) => ({ ...v, [a.id]: { debit: '', credit: e.target.value } }))} />
            </div>
          ))}
          {error && <p role="alert" className="pt-2 text-[0.8125rem] text-danger-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
