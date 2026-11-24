import { useEffect, useState } from 'react'
import type { ExpenseCategory, ExpensePolicyInput, PolicyMode } from '@/modules/finance/expenses/types'
import { POLICY_MODE_LABEL } from '@/modules/finance/expenses/types'
import { expensesApi, useCategories, useExpensesMutation, usePolicy } from '@/modules/finance/expenses/api'
import { useAccounts } from '@/modules/finance/ledger/api'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'
import { Amount, FinError, FormError, SimpleTable, td, tdEnd, th, thEnd } from './bits'

/** Categories (mapped to expense accounts, with monthly claim limits) and the expense policy. Accounting full edits. */
export function PolicyTab({ canEdit }: { canEdit: boolean }) {
  const cats = useCategories(canEdit)
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null)
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">Categories</h2>{canEdit && <Button size="sm" write onClick={() => setEditing('new')}>Add category</Button>}</div>
        {cats.error ? <FinError error={cats.error} onRetry={() => cats.refetch()} /> : !cats.data ? <Skeleton className="h-48" /> : (
          <SimpleTable label="Expense categories" head={<tr><th className={th}>Name</th><th className={th}>Account</th><th className={thEnd}>Monthly limit (claims)</th><th className={th} /></tr>}>
            {cats.data.map((c) => (
              <tr key={c.id} className={canEdit ? 'cursor-pointer hover:bg-hover' : undefined} onClick={canEdit ? () => setEditing(c) : undefined}>
                <td className={td}>{c.name}{!c.active && <Badge className="ms-2">Inactive</Badge>}{c.description ? <span className="block text-xs text-muted">{c.description}</span> : null}</td>
                <td className={td}><span className="num">{c.accountCode}</span> {c.accountName}</td>
                <td className={tdEnd}>{c.monthlyLimit === null ? <span className="text-muted">—</span> : <Amount value={c.monthlyLimit} />}</td>
                <td className={td} />
              </tr>
            ))}
          </SimpleTable>
        )}
      </section>
      <PolicyCard canEdit={canEdit} />
      {editing && <CategoryModal category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CategoryModal({ category, onClose }: { category: ExpenseCategory | null; onClose: () => void }) {
  const accounts = useAccounts()
  const create = useExpensesMutation(expensesApi.createCategory)
  const update = useExpensesMutation(expensesApi.updateCategory)
  const [name, setName] = useState(category?.name ?? '')
  const [accountId, setAccountId] = useState(category?.accountId ?? '')
  const [limit, setLimit] = useState(category?.monthlyLimit === null || !category ? '' : String(category.monthlyLimit))
  const [active, setActive] = useState(category?.active ?? true)
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.type === 'expense' && !a.isHeader && a.active)
  const input = { name, accountId, monthlyLimit: limit === '' ? null : Number(limit), active }
  const err = create.error ?? update.error
  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'New category'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button write loading={create.isPending || update.isPending} onClick={() => (category ? update.mutate({ id: category.id, input }, { onSuccess: onClose }) : create.mutate(input, { onSuccess: onClose }))}>Save</Button></>}
    >
      <div className="space-y-3">
        <Field id="cat-name" label="Name" required><TextInput id="cat-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field id="cat-account" label="Expense account" required><SelectInput id="cat-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Pick an account</option>{expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</SelectInput></Field>
        <Field id="cat-limit" label="Monthly limit per employee (claims)" hint="Empty: no limit"><TextInput id="cat-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
        {category && <Switch id="cat-active" label="In use" checked={active} onChange={setActive} />}
        <FormError error={err} />
      </div>
    </Modal>
  )
}

function PolicyCard({ canEdit }: { canEdit: boolean }) {
  const p = usePolicy()
  const save = useExpensesMutation(expensesApi.savePolicy)
  const toast = useToast()
  const [v, setV] = useState<ExpensePolicyInput | null>(null)
  useEffect(() => {
    if (p.data && !v) setV({ receiptRequiredAbove: p.data.receiptRequiredAbove, receiptMode: p.data.receiptMode, claimMaxAgeDays: p.data.claimMaxAgeDays, ageMode: p.data.ageMode, limitMode: p.data.limitMode })
  }, [p.data, v])
  if (p.error) return <FinError error={p.error} onRetry={() => p.refetch()} />
  if (!p.data || !v) return <Skeleton className="h-48" />
  const mode = (id: string, label: string, key: 'receiptMode' | 'ageMode' | 'limitMode') => (
    <Field id={id} label={label}>
      <SelectInput id={id} disabled={!canEdit} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value as PolicyMode })}>
        {(['warn', 'block'] as const).map((m) => <option key={m} value={m}>{POLICY_MODE_LABEL[m]}</option>)}
      </SelectInput>
    </Field>
  )
  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-ink">Policy</h2>
      <Field id="pol-receipt" label={`Receipt required above (${p.data.baseCurrency})`} hint="Company expenses always need it above this amount."><TextInput id="pol-receipt" disabled={!canEdit} inputMode="decimal" value={String(v.receiptRequiredAbove ?? '')} onChange={(e) => setV({ ...v, receiptRequiredAbove: Number(e.target.value) })} /></Field>
      {mode('pol-receipt-mode', 'Missing receipt on claims / petty cash', 'receiptMode')}
      <Field id="pol-age" label="Claims due within (days)"><TextInput id="pol-age" disabled={!canEdit} inputMode="numeric" value={String(v.claimMaxAgeDays ?? '')} onChange={(e) => setV({ ...v, claimMaxAgeDays: Number(e.target.value) })} /></Field>
      {mode('pol-age-mode', 'Older claim lines', 'ageMode')}
      {mode('pol-limit-mode', 'Over a category’s monthly limit', 'limitMode')}
      <FormError error={save.error} />
      {canEdit && <div className="flex justify-end"><Button write loading={save.isPending} onClick={() => save.mutate(v, { onSuccess: () => toast.success('Policy saved') })}>Save policy</Button></div>}
    </Card>
  )
}
