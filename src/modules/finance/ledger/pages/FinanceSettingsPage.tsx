import { useEffect, useState } from 'react'
import { Coins, Lock, Settings2, Trash2 } from 'lucide-react'
import type { FinanceSettings, FinanceSettingsInput } from '@/modules/finance/ledger/types'
import { MONTHS } from '@/modules/finance/ledger/types'
import { isValidVatNumber } from '@/modules/finance/ledger/calc'
import { ledgerApi, useAccounts, useFinanceMutation, useFinanceScope, useFinanceSettings } from '@/modules/finance/ledger/api'
import { SimpleTable, errMsg, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Checkbox, Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

/**
 * `/finance/settings`: Finance settings — base currency (from the company), fiscal year, VAT registration (TRN / KSA VAT
 * number, validated), legal names (English + Arabic for KSA invoices), invoice defaults, default accounts, exchange rates
 * and the lock date (Company Admin / Accountant only, audited). Sales Manager: read only.
 */
export default function FinanceSettingsPage() {
  const q = useFinanceSettings()
  return (
    <>
      <PageHeader icon={<IconTile><Settings2 /></IconTile>} title="Finance settings" description="Fiscal year, VAT registration, invoice defaults, exchange rates and the lock date." />
      <PageBody className="space-y-6">
        {q.isError ? <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-96" /> : (
          <>
            <GeneralCard s={q.data} />
            <div className="grid gap-6 xl:grid-cols-2">
              <RatesCard s={q.data} />
              <LockDateCard s={q.data} />
            </div>
          </>
        )}
      </PageBody>
    </>
  )
}

function GeneralCard({ s }: { s: FinanceSettings }) {
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const accounts = useAccounts()
  const [f, setF] = useState<Required<FinanceSettingsInput>>(() => pick(s))
  useEffect(() => setF(pick(s)), [s])
  const [error, setError] = useState<string | null>(null)
  const save = useFinanceMutation((input: FinanceSettingsInput) => ledgerApi.saveSettings(input))
  const ro = !isFull
  const vatInvalid = !!f.vatNumber && !isValidVatNumber(f.vatNumber, s.country)
  const income = (accounts.data ?? []).filter((a) => a.type === 'income' && !a.isHeader && a.active)
  const banks = (accounts.data ?? []).filter((a) => a.type === 'asset' && !a.isHeader && a.active)
  const set = <K extends keyof FinanceSettingsInput>(k: K, v: FinanceSettingsInput[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <Card>
      <CardHeader title="Company and invoicing" description={ro ? 'View only.' : undefined} />
      <CardBody>
        <form
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            save.mutate(f, { onSuccess: () => toast.success('Finance settings saved'), onError: (er) => setError(er.message) })
          }}
        >
          <Field id="fs-base" label="Base currency" hint="From the company’s regional settings">
            <TextInput id="fs-base" value={s.baseCurrency} disabled readOnly />
          </Field>
          <Field id="fs-fy" label="Fiscal year starts in">
            <SelectInput id="fs-fy" value={f.fiscalYearStartMonth} disabled={ro} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </SelectInput>
          </Field>
          <Field id="fs-prefix" label="Document prefix" hint="Printed in invoice and receipt numbers">
            <TextInput id="fs-prefix" value={s.documentPrefix} disabled readOnly />
          </Field>

          <div className="md:col-span-2 xl:col-span-3">
            <label className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink-2">
              <Checkbox checked={f.vatRegistered} disabled={ro} onChange={(e) => set('vatRegistered', e.target.checked)} /> VAT registered
            </label>
          </div>
          <Field id="fs-vat" label={s.vatLabel} required={f.vatRegistered} error={vatInvalid ? (s.country === 'SA' ? '15 digits, starting and ending with 3.' : '15 digits starting with 100.') : undefined} hint={s.country === 'SA' ? '15 digits, starting and ending with 3' : '15 digits starting with 100'}>
            <TextInput id="fs-vat" value={f.vatNumber} disabled={ro} invalid={vatInvalid} inputMode="numeric" onChange={(e) => set('vatNumber', e.target.value)} />
          </Field>
          <Field id="fs-legal-en" label="Legal name (English)" required>
            <TextInput id="fs-legal-en" value={f.legalNameEn} disabled={ro} onChange={(e) => set('legalNameEn', e.target.value)} />
          </Field>
          <Field id="fs-legal-ar" label="Legal name (Arabic)" required={s.country === 'SA' && f.vatRegistered} hint={s.country === 'SA' ? 'Printed on KSA tax invoices' : 'Optional'}>
            <TextInput id="fs-legal-ar" dir="rtl" lang="ar" value={f.legalNameAr} disabled={ro} onChange={(e) => set('legalNameAr', e.target.value)} />
          </Field>

          <Field id="fs-terms-days" label="Payment terms (days)">
            <TextInput id="fs-terms-days" type="number" min={0} max={365} value={f.paymentTermsDays} disabled={ro} onChange={(e) => set('paymentTermsDays', Number(e.target.value))} />
          </Field>
          <Field id="fs-rev" label="Default revenue account">
            <SelectInput id="fs-rev" value={f.defaultRevenueAccountId ?? ''} disabled={ro} onChange={(e) => set('defaultRevenueAccountId', e.target.value || null)}>
              <option value="">None</option>
              {income.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="fs-bank" label="Default bank account">
            <SelectInput id="fs-bank" value={f.defaultBankAccountId ?? ''} disabled={ro} onChange={(e) => set('defaultBankAccountId', e.target.value || null)}>
              <option value="">None</option>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="fs-notes" label="Invoice notes" className="xl:col-span-1">
            <TextArea id="fs-notes" rows={3} value={f.invoiceNotes} disabled={ro} onChange={(e) => set('invoiceNotes', e.target.value)} />
          </Field>
          <Field id="fs-terms" label="Invoice terms and conditions" className="md:col-span-2">
            <TextArea id="fs-terms" rows={3} value={f.invoiceTerms} disabled={ro} onChange={(e) => set('invoiceTerms', e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-[0.8125rem] text-danger-600 md:col-span-2 xl:col-span-3">{error}</p>}
          {!ro && (
            <div className="md:col-span-2 xl:col-span-3">
              <Button write type="submit" loading={save.isPending}>Save settings</Button>
            </div>
          )}
        </form>
      </CardBody>
    </Card>
  )
}

function pick(s: FinanceSettings): Required<FinanceSettingsInput> {
  return {
    fiscalYearStartMonth: s.fiscalYearStartMonth,
    vatRegistered: s.vatRegistered,
    vatNumber: s.vatNumber,
    legalNameEn: s.legalNameEn,
    legalNameAr: s.legalNameAr,
    paymentTermsDays: s.paymentTermsDays,
    invoiceNotes: s.invoiceNotes,
    invoiceTerms: s.invoiceTerms,
    defaultRevenueAccountId: s.defaultRevenueAccountId,
    defaultBankAccountId: s.defaultBankAccountId,
  }
}

function RatesCard({ s }: { s: FinanceSettings }) {
  const { isFull } = useFinanceScope()
  const toast = useToast()
  const [currency, setCurrency] = useState('')
  const [rate, setRate] = useState('')
  const [date, setDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const add = useFinanceMutation(() => ledgerApi.addRate({ currency, rate: Number(rate), effectiveDate: date }))
  const del = useFinanceMutation((id: string) => ledgerApi.deleteRate(id))
  return (
    <Card>
      <CardHeader title="Exchange rates" icon={<Coins />} description={`1 unit of the currency in ${s.baseCurrency}. A document uses the latest rate effective on or before its date.`} />
      <CardBody className="space-y-4">
        {s.exchangeRates.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">No rates yet: only {s.baseCurrency} documents can be posted.</p>
        ) : (
          <SimpleTable
            label="Exchange rates"
            head={
              <tr>
                <th className={th}>Currency</th>
                <th className={thEnd}>Rate to {s.baseCurrency}</th>
                <th className={th}>Effective from</th>
                {isFull && <th className={thEnd}><span className="sr-only">Actions</span></th>}
              </tr>
            }
          >
            {s.exchangeRates.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.currency}</td>
                <td className={tdEnd}><span className="num">{r.rate}</span></td>
                <td className={td}>{fmtDate(r.effectiveDate)}</td>
                {isFull && (
                  <td className={tdEnd}>
                    <Button write variant="ghost" size="xs" iconOnly aria-label={`Delete the ${r.currency} rate of ${r.effectiveDate}`} onClick={() => del.mutate(r.id, { onSuccess: () => toast.success('Rate deleted'), onError: (e) => toast.error('Not deleted', e.message) })}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </SimpleTable>
        )}
        {isFull && (
          <form
            className="grid gap-3 sm:grid-cols-[6rem_8rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              add.mutate(undefined, { onSuccess: () => { toast.success('Rate added'); setCurrency(''); setRate(''); setDate('') }, onError: (er) => setError(er.message) })
            }}
          >
            <Field id="fx-cur" label="Currency"><TextInput id="fx-cur" maxLength={3} placeholder="USD" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
            <Field id="fx-rate" label="Rate"><TextInput id="fx-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field id="fx-date" label="Effective date"><TextInput id="fx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Button write type="submit" variant="secondary" loading={add.isPending} disabled={!currency || !rate || !date}>Add rate</Button>
            {error && <p role="alert" className="text-[0.8125rem] text-danger-600 sm:col-span-4">{error}</p>}
          </form>
        )}
      </CardBody>
    </Card>
  )
}

function LockDateCard({ s }: { s: FinanceSettings }) {
  const toast = useToast()
  const [date, setDate] = useState(s.lockDate ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDate(s.lockDate ?? ''), [s.lockDate])
  const save = useFinanceMutation((d: string | null) => ledgerApi.setLockDate(d, reason))
  const run = (d: string | null) => {
    setError(null)
    save.mutate(d, { onSuccess: (r) => { toast.success(r.lockDate ? `Books locked up to ${fmtDate(r.lockDate)}` : 'Lock date removed'); setReason('') }, onError: (e) => setError(e.message) })
  }
  return (
    <Card>
      <CardHeader title="Lock date" icon={<Lock />} description="Nothing can be posted on or before this date: invoices, payments, journal entries, reversals." />
      <CardBody className="space-y-3">
        <p className="text-[0.8125rem]">
          {s.lockDate ? (
            <>
              Books locked up to <strong>{fmtDate(s.lockDate)}</strong>
              {s.lockDateSetByName ? <span className="text-muted"> · set by {s.lockDateSetByName}{s.lockDateSetAt ? ` on ${fmtDate(s.lockDateSetAt)}` : ''}</span> : null}
            </>
          ) : (
            <span className="text-muted">No lock date: every period is open.</span>
          )}
        </p>
        {s.canMoveLockDate ? (
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr] sm:items-end">
            <Field id="lock-date" label="Lock up to"><TextInput id="lock-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field id="lock-reason" label="Reason (audit log)"><TextInput id="lock-reason" value={reason} placeholder="e.g. October VAT return filed" onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button write loading={save.isPending} disabled={!date || date === s.lockDate} onClick={() => run(date)}>Set lock date</Button>
              {s.lockDate && <Button write variant="ghost" onClick={() => run(null)}>Remove the lock</Button>}
            </div>
            {error && <p role="alert" className="text-[0.8125rem] text-danger-600 sm:col-span-2">{error}</p>}
          </div>
        ) : (
          <p className="text-xs text-muted">Only a Company Admin or an Accountant can move the lock date.</p>
        )}
      </CardBody>
    </Card>
  )
}
