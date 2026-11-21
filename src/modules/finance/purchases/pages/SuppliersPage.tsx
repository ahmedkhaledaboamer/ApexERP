import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Plus, Truck } from 'lucide-react'
import type { SupplierDetail, SupplierProfileInput } from '@/modules/finance/purchases/types'
import { PO_STATUS_LABEL } from '@/modules/finance/purchases/types'
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, type VendorCategory } from '@/modules/events/libraryTypes'
import { purchasesApi, usePurchasesMeta, usePurchasesMutation, usePurchasesScope, useSupplier, useSuppliers } from '@/modules/finance/purchases/api'
import { FinError, SimpleTable, errMsg, fmt2, td, tdEnd, th, thEnd } from '@/modules/finance/collections/components/bits'
import { BillStatusBadge, fmtDay } from '@/modules/finance/purchases/components/bits'
import { financeBillPath, financePurchaseOrderPath, financeSupplierStatementPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Button } from '@/shared/components/ui/Button'
import { Badge } from '@/shared/components/ui/Badge'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SearchInput, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * `/finance/suppliers`: the company's vendor directory (Events › Vendors) with each vendor's finance profile — VAT
 * number, payment terms, default account / tax, currency and bank details (IBAN masked; accounting full can reveal it,
 * audited) — and open / overdue balances. ?supplier= opens one.
 */
export default function SuppliersPage() {
  const { canWrite } = usePurchasesScope()
  const list = useSuppliers()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('supplier'))
  const [creating, setCreating] = useState(false)
  const rows = useMemo(() => (list.data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())), [list.data, q])
  const totals = useMemo(() => ({ open: (list.data ?? []).reduce((s, r) => s + r.openBalanceBase, 0), overdue: (list.data ?? []).reduce((s, r) => s + r.overdueBase, 0), count: (list.data ?? []).filter((r) => r.openBills > 0).length }), [list.data])
  const meta = usePurchasesMeta()
  const base = meta.data?.baseCurrency ?? ''

  return (
    <>
      <PageHeader
        icon={<IconTile><Truck /></IconTile>}
        title="Suppliers"
        description="The vendor directory (shared with Events › Vendors) with finance profiles and balances."
        actions={canWrite ? <Button write onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New supplier</Button> : <Badge tone="neutral">View only</Badge>}
      />
      <PageBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label={`Open payables (${base})`} value={fmt2(totals.open)} hint={`${totals.count} supplier${totals.count === 1 ? '' : 's'} with open bills`} />
          <StatCard label={`Overdue (${base})`} value={fmt2(totals.overdue)} alert={totals.overdue > 0} />
          <StatCard label="Suppliers" value={String(list.data?.length ?? 0)} />
        </div>
        <SearchInput aria-label="Search suppliers" placeholder="Supplier name" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        {list.isLoading ? (
          <Skeleton className="h-64" />
        ) : list.error ? (
          <FinError error={list.error as Error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No suppliers" body="Add vendors in Events › Vendors, or create one here." icon={<Truck />} />
        ) : (
          <SimpleTable
            label="Suppliers"
            head={
              <tr>
                <th className={th}>Supplier</th>
                <th className={th}>VAT no.</th>
                <th className={th}>Terms</th>
                <th className={th}>Bank</th>
                <th className={thEnd}>Open bills</th>
                <th className={thEnd}>Open ({base})</th>
                <th className={thEnd}>Overdue ({base})</th>
                <th className={th}>Last bill</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-hover/50">
                <td className={td}>
                  <button type="button" className="text-start font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpenId(r.id)}>{r.name}</button>
                  <span className="block text-xs text-muted">
                    {VENDOR_CATEGORY_LABEL[r.category as VendorCategory] ?? r.category}
                    {r.vendorStatus === 'blacklisted' ? ' · blacklisted' : r.vendorStatus === 'preferred' ? ' · preferred' : ''}
                    {!r.hasProfile ? ' · no finance profile yet' : ''}
                  </span>
                </td>
                <td className={`${td} num`}>{r.vatNumber || '—'}</td>
                <td className={td}>{r.paymentTermsDays} days</td>
                <td className={td}>{r.bankName || '—'}{r.ibanMasked && <span className="num block text-xs text-muted">{r.ibanMasked}</span>}</td>
                <td className={`${tdEnd} num`}>{r.openBills}</td>
                <td className={`${tdEnd} num`}>{fmt2(r.openBalanceBase)}</td>
                <td className={`${tdEnd} num ${r.overdueBase > 0 ? 'text-danger-600' : ''}`}>{fmt2(r.overdueBase)}</td>
                <td className={`${td} num`}>{fmtDay(r.lastBillDate)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </PageBody>
      <SupplierDrawer id={openId} onClose={() => setOpenId(null)} />
      <NewSupplierDrawer open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpenId(id)} />
    </>
  )
}

type ProfileForm = Required<Omit<SupplierProfileInput, 'defaultExpenseAccountId' | 'defaultTaxCodeId' | 'paymentTermsDays'>> & { paymentTermsDays: string; defaultExpenseAccountId: string; defaultTaxCodeId: string }
const formOf = (s: SupplierDetail): ProfileForm => ({
  vatNumber: s.vatNumber,
  paymentTermsDays: String(s.paymentTermsDays),
  defaultExpenseAccountId: s.defaultExpenseAccountId ?? '',
  defaultTaxCodeId: s.defaultTaxCodeId ?? '',
  currency: s.currency,
  bankName: s.bankName,
  iban: '',
  notes: s.notes,
})

function SupplierDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast()
  const q = useSupplier(id)
  const meta = usePurchasesMeta()
  const s = q.data
  const [f, setF] = useState<ProfileForm | null>(null)
  const [iban, setIban] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (s) setF(formOf(s))
    setIban(null)
    setError(null)
  }, [s])
  const save = usePurchasesMutation((input: SupplierProfileInput) => purchasesApi.updateSupplier(id!, input))
  const reveal = usePurchasesMutation(() => purchasesApi.revealIban(id!))
  const set = <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => setF((x) => (x ? { ...x, [k]: v } : x))
  const ro = !s?.canEdit
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={s?.name ?? 'Supplier'}
      description={s ? `${VENDOR_CATEGORY_LABEL[s.category as VendorCategory] ?? s.category}${s.contactName ? ` · ${s.contactName}` : ''}${s.email ? ` · ${s.email}` : ''}` : undefined}
      width="xl"
      footer={
        s && f && !ro ? (
          <>
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button write loading={save.isPending} onClick={() => {
              setError(null)
              save.mutate(
                {
                  vatNumber: f.vatNumber,
                  paymentTermsDays: Number(f.paymentTermsDays),
                  defaultExpenseAccountId: f.defaultExpenseAccountId || null,
                  defaultTaxCodeId: f.defaultTaxCodeId || null,
                  currency: f.currency,
                  bankName: f.bankName,
                  ...(f.iban.trim() ? { iban: f.iban.trim() } : {}),
                  notes: f.notes,
                },
                { onSuccess: () => toast.success('Supplier profile saved'), onError: (e) => setError(errMsg(e)) },
              )
            }}>Save profile</Button>
          </>
        ) : undefined
      }
    >
      {q.error ? (
        <FinError error={q.error as Error} onRetry={() => void q.refetch()} />
      ) : !s || !f ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3 text-[0.8125rem]">
            <div><p className="text-xs text-muted">Open</p><p className="num font-semibold">{fmt2(s.openBalanceBase)}</p></div>
            <div><p className="text-xs text-muted">Overdue</p><p className={`num font-semibold ${s.overdueBase > 0 ? 'text-danger-600' : ''}`}>{fmt2(s.overdueBase)}</p></div>
            <div><Link to={financeSupplierStatementPath(s.id)} className="text-brand-700 hover:underline dark:text-brand-300">Statement</Link></div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sp-vat" label="VAT / TRN number" hint="VAT is recoverable only from VAT-registered suppliers">
              <TextInput id="sp-vat" value={f.vatNumber} disabled={ro} onChange={(e) => set('vatNumber', e.target.value)} />
            </Field>
            <Field id="sp-terms" label="Payment terms (days)">
              <TextInput id="sp-terms" type="number" min="0" max="365" value={f.paymentTermsDays} disabled={ro} onChange={(e) => set('paymentTermsDays', e.target.value)} />
            </Field>
            <Field id="sp-account" label="Default expense account">
              <SelectInput id="sp-account" value={f.defaultExpenseAccountId} disabled={ro} onChange={(e) => set('defaultExpenseAccountId', e.target.value)}>
                <option value="">By category</option>
                {meta.data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </SelectInput>
            </Field>
            <Field id="sp-tax" label="Default tax code">
              <SelectInput id="sp-tax" value={f.defaultTaxCodeId} disabled={ro} onChange={(e) => set('defaultTaxCodeId', e.target.value)}>
                <option value="">Standard (VAT registered) / out of scope</option>
                {meta.data?.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectInput>
            </Field>
            <Field id="sp-currency" label="Currency">
              <SelectInput id="sp-currency" value={f.currency} disabled={ro} onChange={(e) => set('currency', e.target.value)}>
                {[...new Set([...(meta.data?.currencies ?? []), f.currency])].map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectInput>
            </Field>
            <Field id="sp-bank" label="Bank name">
              <TextInput id="sp-bank" value={f.bankName} disabled={ro} onChange={(e) => set('bankName', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-[0.8125rem] font-medium text-ink-2">IBAN</p>
              <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                <span className="num">{iban ?? (s.ibanMasked || 'Not set')}</span>
                {s.canReveal && iban === null && (
                  <Button size="xs" variant="ghost" loading={reveal.isPending} onClick={() => reveal.mutate(undefined, { onSuccess: (v) => setIban(v), onError: (e) => setError(errMsg(e)) })}>
                    <Eye className="size-3.5" aria-hidden /> Reveal
                  </Button>
                )}
                {s.canReveal && <span className="text-xs text-muted">Revealing is recorded in the audit log.</span>}
              </div>
              {!ro && (
                <TextInput aria-label="New IBAN" className="mt-2" placeholder="Replace the IBAN (leave empty to keep it)" value={f.iban} onChange={(e) => set('iban', e.target.value)} />
              )}
            </div>
            <Field id="sp-notes" label="Notes" className="sm:col-span-2">
              <TextArea id="sp-notes" rows={2} value={f.notes} disabled={ro} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          {error && <p role="alert" className="text-[0.8125rem] text-danger-600">{error}</p>}

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Bills</h3>
            {s.bills.length === 0 ? <p className="text-[0.8125rem] text-muted">No bills.</p> : (
              <ul className="space-y-1 text-[0.8125rem]">
                {s.bills.slice(0, 12).map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <Link to={financeBillPath(b.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{b.number}</Link>
                    <span className="text-xs text-muted">{fmtDay(b.billDate)}</span>
                    <BillStatusBadge status={b.status} overdue={b.overdue} />
                    <span className="num ms-auto">{fmt2(b.balanceDue)} / {fmt2(b.total)} {b.currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Purchase orders</h3>
            {s.purchaseOrders.length === 0 ? <p className="text-[0.8125rem] text-muted">No purchase orders.</p> : (
              <ul className="space-y-1 text-[0.8125rem]">
                {s.purchaseOrders.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <Link to={financePurchaseOrderPath(p.id)} className="num text-brand-700 hover:underline dark:text-brand-300">{p.number}</Link>
                    <span className="text-xs text-muted">{PO_STATUS_LABEL[p.status]}</span>
                    <span className="num ms-auto">{fmt2(p.total)} {p.currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

function NewSupplierDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast()
  const blank = { name: '', category: 'other' as VendorCategory, contactName: '', email: '', vatNumber: '', paymentTermsDays: '30', bankName: '', iban: '' }
  const [f, setF] = useState(blank)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setF(blank)
      setError(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = usePurchasesMutation(() => purchasesApi.createSupplier({ ...f, paymentTermsDays: Number(f.paymentTermsDays) || 0, iban: f.iban.trim() || undefined }))
  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New supplier"
      description="Added to the company’s vendor directory (Events › Vendors) with a finance profile."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button write loading={save.isPending} onClick={() => {
            setError(null)
            save.mutate(undefined, {
              onSuccess: (s) => {
                toast.success(`${s.name} added`)
                onClose()
                onCreated(s.id)
              },
              onError: (e) => setError(errMsg(e)),
            })
          }}>Create supplier</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="ns-name" label="Company name" required className="sm:col-span-2"><TextInput id="ns-name" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field id="ns-cat" label="Category">
          <SelectInput id="ns-cat" value={f.category} onChange={(e) => set('category', e.target.value as VendorCategory)}>
            {VENDOR_CATEGORIES.map((c) => <option key={c} value={c}>{VENDOR_CATEGORY_LABEL[c]}</option>)}
          </SelectInput>
        </Field>
        <Field id="ns-contact" label="Contact name"><TextInput id="ns-contact" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} /></Field>
        <Field id="ns-email" label="Email"><TextInput id="ns-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field id="ns-vat" label="VAT / TRN number"><TextInput id="ns-vat" value={f.vatNumber} onChange={(e) => set('vatNumber', e.target.value)} /></Field>
        <Field id="ns-terms" label="Payment terms (days)"><TextInput id="ns-terms" type="number" min="0" max="365" value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} /></Field>
        <Field id="ns-bank" label="Bank name"><TextInput id="ns-bank" value={f.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
        <Field id="ns-iban" label="IBAN" className="sm:col-span-2"><TextInput id="ns-iban" value={f.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
        {error && <p role="alert" className="text-[0.8125rem] text-danger-600 sm:col-span-2">{error}</p>}
      </div>
    </Drawer>
  )
}
