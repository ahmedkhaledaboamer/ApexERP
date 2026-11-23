import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, ListTree, Pencil, Plus, Upload } from 'lucide-react'
import type { AccountType, SystemAccountRole } from '@/modules/finance/types'
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL } from '@/modules/finance/types'
import type { AccountInput, AccountRow } from '@/modules/finance/ledger/types'
import { ACCOUNT_SUBTYPES, SYSTEM_ROLE_LABEL, SYSTEM_ROLE_TYPE } from '@/modules/finance/ledger/types'
import { ledgerApi, useAccountLedger, useAccounts, useFinanceMutation, useFinanceScope, useFinanceSettings } from '@/modules/finance/ledger/api'
import { AccountTypeBadge, Amount, EntryLink, SimpleTable, SourceBadge, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { Modal } from '@/shared/components/ui/Modal'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SearchInput, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'
import { useNewParam } from '@/shared/hooks/useNewParam'

/**
 * `/finance/accounts`: Chart of accounts — the tree by type with base-currency balances (headers roll up), add / edit /
 * deactivate / delete (only never-posted accounts), system roles, the account ledger with a running balance
 * (?account=), and the country template for an empty chart. Sales Manager: read only.
 */
export default function ChartOfAccountsPage() {
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const accounts = useAccounts()
  const settings = useFinanceSettings()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<AccountRow | 'new' | null>(null)
  useNewParam(() => setEditing('new'), { when: isFull })
  const importTpl = useFinanceMutation(() => ledgerApi.importTemplate())
  const ledgerId = params.get('account')
  const setLedger = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (id) n.set('account', id)
      else n.delete('account')
      return n
    })
  const cur = settings.data?.baseCurrency ?? ''

  const rows = useMemo(() => {
    const all = accounts.data ?? []
    const q = search.trim().toLowerCase()
    return all.filter((a) => (showInactive || a.active) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q)))
  }, [accounts.data, search, showInactive])

  return (
    <>
      <PageHeader
        icon={<IconTile><ListTree /></IconTile>}
        title="Chart of accounts"
        description={cur ? `Balances in ${cur}, today. Headers include their sub-accounts.` : 'Your accounts, grouped by type.'}
        actions={
          isFull ? (
            <Button write onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add account
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-4">
        {accounts.isError ? (
          <ErrorState message={errMsg(accounts.error)} onRetry={() => void accounts.refetch()} />
        ) : !accounts.data ? (
          <Skeleton className="h-96" />
        ) : accounts.data.length === 0 ? (
          <EmptyState
            icon={<ListTree />}
            title="Your chart of accounts is empty"
            body={`Start from the ${settings.data?.country === 'SA' ? 'KSA' : 'UAE'} template (accounts, system roles and VAT codes), then adapt it.`}
            action={
              isFull ? (
                <Button write loading={importTpl.isPending} onClick={() => importTpl.mutate(undefined, { onSuccess: () => toast.success('Template imported'), onError: (e) => toast.error('Not imported', e.message) })}>
                  <Upload className="size-4" aria-hidden /> Import the template
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SearchInput aria-label="Search accounts" placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
              <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                <Checkbox checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
              </label>
            </div>
            {ACCOUNT_TYPES.map((type) => {
              const ofType = rows.filter((r) => r.type === type)
              if (!ofType.length) return null
              const top = ofType.filter((r) => r.depth === 0)
              const total = top.reduce((s, r) => s + r.balance, 0)
              return (
                <section key={type} aria-label={ACCOUNT_TYPE_LABEL[type]}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold text-ink">{ACCOUNT_TYPE_LABEL[type]}</h2>
                    <span className="text-xs text-muted">
                      Total <Amount value={total} currency={cur} strong />
                    </span>
                  </div>
                  <SimpleTable
                    label={`${ACCOUNT_TYPE_LABEL[type]} accounts`}
                    head={
                      <tr>
                        <th className={cn(th, 'w-24')}>Code</th>
                        <th className={th}>Account</th>
                        <th className={th}>System role</th>
                        <th className={thEnd}>Balance</th>
                        <th className={cn(thEnd, 'w-28')}><span className="sr-only">Actions</span></th>
                      </tr>
                    }
                  >
                    {ofType.map((a) => (
                      <tr key={a.id} className={cn(!a.active && 'opacity-60', a.isHeader && 'bg-sunken/30')}>
                        <td className={cn(td, 'num')}>{a.code}</td>
                        <td className={td}>
                          <span style={{ paddingInlineStart: `${a.depth * 1.25}rem` }} className={cn('inline-block', a.isHeader && 'font-semibold')}>
                            <button type="button" className="text-start hover:underline" onClick={() => setLedger(a.id)}>
                              {a.name}
                            </button>
                          </span>
                          {!a.active && <Badge className="ms-2">Inactive</Badge>}
                        </td>
                        <td className={td}>{a.systemRole ? <Badge tone="brand">{SYSTEM_ROLE_LABEL[a.systemRole]}</Badge> : null}</td>
                        <td className={tdEnd}><Amount value={a.balance} strong={a.isHeader} blankZero={!a.hasPostings && !a.isHeader} /></td>
                        <td className={tdEnd}>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="xs" iconOnly aria-label={`Ledger of ${a.code} ${a.name}`} onClick={() => setLedger(a.id)}>
                              <BookOpen className="size-3.5" aria-hidden />
                            </Button>
                            {isFull && (
                              <Button write variant="ghost" size="xs" iconOnly aria-label={`Edit ${a.code} ${a.name}`} onClick={() => setEditing(a)}>
                                <Pencil className="size-3.5" aria-hidden />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </SimpleTable>
                </section>
              )
            })}
          </>
        )}
      </PageBody>
      {editing && <AccountModal account={editing === 'new' ? null : editing} accounts={accounts.data ?? []} onClose={() => setEditing(null)} />}
      <LedgerDrawer accountId={ledgerId} account={accounts.data?.find((a) => a.id === ledgerId) ?? null} currency={cur} onClose={() => setLedger(null)} />
    </>
  )
}

function AccountModal({ account, accounts, onClose }: { account: AccountRow | null; accounts: AccountRow[]; onClose: () => void }) {
  const toast = useToast()
  const [code, setCode] = useState(account?.code ?? '')
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'expense')
  const [subtype, setSubtype] = useState(account?.subtype ?? ACCOUNT_SUBTYPES.expense[0].id)
  const [parentId, setParentId] = useState(account?.parentId ?? '')
  const [isHeader, setIsHeader] = useState(account?.isHeader ?? false)
  const [description, setDescription] = useState(account?.description ?? '')
  const [role, setRole] = useState<SystemAccountRole | ''>(account?.systemRole ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useFinanceMutation((input: AccountInput) => (account ? ledgerApi.updateAccount(account.id, input) : ledgerApi.createAccount(input)))
  const toggle = useFinanceMutation((active: boolean) => ledgerApi.updateAccount(account!.id, { active }))
  const del = useFinanceMutation(() => ledgerApi.deleteAccount(account!.id))
  const parents = accounts.filter((a) => a.isHeader && a.type === type && a.id !== account?.id && a.active)
  const roles = (Object.keys(SYSTEM_ROLE_TYPE) as SystemAccountRole[]).filter((r) => SYSTEM_ROLE_TYPE[r] === type)

  const submit = () => {
    setError(null)
    const input: AccountInput = { code: code.trim(), name: name.trim(), type, subtype: isHeader ? 'header' : subtype, parentId: parentId || null, isHeader, description }
    if (account && role && role !== account.systemRole) input.systemRole = role
    save.mutate(input, {
      onSuccess: () => {
        toast.success(account ? 'Account saved' : 'Account added', `${input.code} ${input.name}`)
        onClose()
      },
      onError: (e) => setError(e.message),
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? `Edit ${account.code} ${account.name}` : 'Add account'}
      description={account?.hasPostings ? 'This account has postings: its type is fixed and it can’t be deleted (deactivate it instead).' : undefined}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {account && (
            <>
              <Button write variant="secondary" size="sm" loading={toggle.isPending} onClick={() => toggle.mutate(!account.active, { onSuccess: () => { toast.success(account.active ? 'Account deactivated' : 'Account reactivated'); onClose() }, onError: (e) => setError(e.message) })}>
                {account.active ? 'Deactivate' : 'Reactivate'}
              </Button>
              {!account.hasPostings && (
                <Button write variant="ghost" size="sm" loading={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => { toast.success('Account deleted'); onClose() }, onError: (e) => setError(e.message) })}>
                  Delete
                </Button>
              )}
            </>
          )}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{account ? 'Save' : 'Add account'}</Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="acc-code" label="Code" required hint="3–10 digits, unique in your chart">
          <TextInput id="acc-code" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field id="acc-name" label="Name" required>
          <TextInput id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="acc-type" label="Type">
          <SelectInput
            id="acc-type"
            value={type}
            disabled={!!account?.hasPostings || !!account?.systemRole}
            onChange={(e) => {
              const t = e.target.value as AccountType
              setType(t)
              setSubtype(ACCOUNT_SUBTYPES[t][0].id)
              setParentId('')
              setRole('')
            }}
          >
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
          </SelectInput>
        </Field>
        <Field id="acc-subtype" label="Subtype">
          <SelectInput id="acc-subtype" value={isHeader ? 'header' : subtype} disabled={isHeader} onChange={(e) => setSubtype(e.target.value)}>
            {isHeader ? <option value="header">Header</option> : ACCOUNT_SUBTYPES[type].map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </SelectInput>
        </Field>
        <Field id="acc-parent" label="Parent (header)" className="sm:col-span-2">
          <SelectInput id="acc-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {parents.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
          </SelectInput>
        </Field>
        <label className="flex items-center gap-2 text-[0.8125rem] text-ink-2 sm:col-span-2">
          <Checkbox checked={isHeader} disabled={!!account?.hasPostings || !!account?.systemRole} onChange={(e) => setIsHeader(e.target.checked)} />
          Header account (groups sub-accounts; can’t be posted to)
        </label>
        {account && !isHeader && (
          <Field id="acc-role" label="System role" className="sm:col-span-2" hint={account.systemRole ? 'To free this account, give its role to another account (edit that one).' : 'Assigning a role moves it from the account that holds it now.'}>
            <SelectInput id="acc-role" value={role} disabled={!!account.systemRole} onChange={(e) => setRole(e.target.value as SystemAccountRole | '')}>
              <option value="">None</option>
              {roles.map((r) => <option key={r} value={r}>{SYSTEM_ROLE_LABEL[r]}</option>)}
            </SelectInput>
          </Field>
        )}
        <Field id="acc-desc" label="Description" className="sm:col-span-2">
          <TextArea id="acc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600 sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  )
}

function LedgerDrawer({ accountId, account, currency, onClose }: { accountId: string | null; account: AccountRow | null; currency: string; onClose: () => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = useAccountLedger(accountId, { from: from || undefined, to: to || undefined })
  const l = q.data
  return (
    <Drawer open={!!accountId} onClose={onClose} width="xl" title={account ? `${account.code} ${account.name}` : 'Account ledger'} description={account ? <AccountTypeBadge type={account.type} /> : undefined}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="ledger-from" label="From"><TextInput id="ledger-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field id="ledger-to" label="To"><TextInput id="ledger-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {q.isError ? (
          <ErrorState message={errMsg(q.error)} />
        ) : !l ? (
          <Skeleton className="h-48" />
        ) : (
          <SimpleTable
            label="Account ledger"
            head={
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Entry</th>
                <th className={th}>Description</th>
                <th className={thEnd}>Debit</th>
                <th className={thEnd}>Credit</th>
                <th className={thEnd}>Balance</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td} colSpan={3}>Closing balance</td>
                <td className={tdEnd}><Amount value={l.totals.debit} /></td>
                <td className={tdEnd}><Amount value={l.totals.credit} /></td>
                <td className={tdEnd}><Amount value={l.closingBalance} currency={currency} strong /></td>
              </tr>
            }
          >
            <tr>
              <td className={td} colSpan={5}><span className="text-muted">Opening balance{l.from ? ` before ${fmtDate(l.from)}` : ''}</span></td>
              <td className={tdEnd}><Amount value={l.openingBalance} /></td>
            </tr>
            {l.rows.map((r, i) => (
              <tr key={`${r.entryId}-${i}`}>
                <td className={td}>{fmtDate(r.date)}</td>
                <td className={td}><EntryLink id={r.entryId} number={r.number} /> <SourceBadge type={r.sourceType} /></td>
                <td className={td}>{r.description || r.memo}</td>
                <td className={tdEnd}><Amount value={r.debit} blankZero /></td>
                <td className={tdEnd}><Amount value={r.credit} blankZero /></td>
                <td className={tdEnd}><Amount value={r.balance} /></td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </div>
    </Drawer>
  )
}
