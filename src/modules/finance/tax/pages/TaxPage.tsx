import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, ScrollText, Trash2 } from 'lucide-react'
import type { CorporateTaxEstimate, TaxAdjustmentLine, TaxSettings, VatFrequency, ZakatEstimate } from '@/modules/finance/tax/types'
import { VAT_FREQUENCY_LABEL } from '@/modules/finance/tax/types'
import { taxApi, useCorporateTax, useTaxMutation, useTaxSettings, useVatReturn, useVatReturns, useZakat } from '@/modules/finance/tax/api'
import { BoxItemsDrawer, BoxesTable, FilingInfo, Notices, ReturnActions, TotalsStrip, VatStatusBadge, layoutTitle } from '@/modules/finance/tax/components/VatReturnView'
import { Amount, SimpleTable, fmtDate, td, tdEnd, th, thEnd } from '@/modules/finance/ledger/components/bits'
import { FinError } from '@/modules/finance/collections/components/bits'
import { financeVatReturnPrintPath } from '@/app/paths'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Tabs } from '@/shared/components/ui/Tabs'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Segmented } from '@/shared/components/ui/Segmented'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'
import { cn } from '@/shared/lib/utils'

/**
 * `/finance/tax` (?tab=vat|estimate, ?return=, ?box=): VAT returns by filing period (UAE FTA VAT 201 / KSA ZATCA) with
 * drill-down per box, filing (frozen + settlement entry) and payment; the corporate tax (UAE) or zakat (KSA) estimate
 * with manual adjustments and the provision posting. Accounting full writes; Sales Manager views.
 */
type Tab = 'vat' | 'estimate'

export default function TaxPage() {
  const [params, setParams] = useSearchParams()
  const settings = useTaxSettings()
  const tab = (params.get('tab') as Tab) || 'vat'
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setParams(p, { replace: true })
  }
  const ksa = settings.data?.layout === 'ksa_zatca'
  return (
    <>
      <PageHeader
        icon={<IconTile><ScrollText /></IconTile>}
        title="Tax"
        description={ksa ? 'VAT returns in the ZATCA layout and the zakat estimate.' : 'VAT returns in the FTA VAT 201 layout and the corporate tax estimate.'}
      />
      <PageBody className="space-y-5">
        <Tabs<Tab> label="Tax sections" value={tab} onChange={(t) => set({ tab: t, return: null, box: null })} items={[{ id: 'vat', label: 'VAT returns' }, { id: 'estimate', label: ksa ? 'Zakat' : 'Corporate tax' }]} />
        <div id={`tab-panel-${tab}`} role="tabpanel">
          {settings.error ? (
            <FinError error={settings.error as Error} onRetry={() => void settings.refetch()} />
          ) : !settings.data ? (
            <Skeleton className="h-64" />
          ) : tab === 'vat' ? (
            params.get('return') ? (
              <ReturnPanel id={params.get('return')!} box={params.get('box')} settings={settings.data} onBox={(b) => set({ box: b })} onBack={() => set({ return: null, box: null })} />
            ) : (
              <ReturnsList settings={settings.data} onOpen={(id) => set({ return: id })} />
            )
          ) : ksa ? (
            <ZakatTab settings={settings.data} />
          ) : (
            <CorporateTaxTab settings={settings.data} />
          )}
        </div>
      </PageBody>
    </>
  )
}

function ReturnsList({ settings, onOpen }: { settings: TaxSettings; onOpen: (id: string) => void }) {
  const q = useVatReturns()
  const toast = useToast()
  const freq = useTaxMutation((f: VatFrequency) => taxApi.updateSettings(f))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="text-[0.8125rem]">
          <p className="font-medium text-ink">{settings.layout === 'uae_vat201' ? 'UAE · Federal Tax Authority · VAT 201' : 'KSA · ZATCA · VAT return'}</p>
          <p className="text-muted">{settings.vatRegistered ? `VAT number ${settings.vatNumber}` : 'Not VAT registered (Finance settings)'}{settings.companyEmirate ? ` · ${settings.companyEmirate}` : ''}</p>
        </div>
        {settings.canEdit ? (
          <Segmented<VatFrequency>
            label="Filing frequency"
            size="sm"
            value={settings.vatFrequency}
            onChange={(f) => freq.mutate(f, { onSuccess: () => toast.success('Filing frequency changed', VAT_FREQUENCY_LABEL[f]), onError: (e) => toast.error('Not changed', e.message) })}
            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]}
          />
        ) : (
          <p className="text-[0.8125rem] text-muted">Files {VAT_FREQUENCY_LABEL[settings.vatFrequency].toLowerCase()}</p>
        )}
      </div>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !q.data ? <Skeleton className="h-48" /> : !q.data.length ? (
        <EmptyState title="No filing periods yet" body="Periods appear from the start of the fiscal year." />
      ) : (
        <SimpleTable label="VAT returns" head={<tr><th className={th}>Period</th><th className={th}>Dates</th><th className={th}>Due</th><th className={th}>Status</th><th className={thEnd}>Net VAT</th><th className={th}>Reference</th></tr>}>
          {q.data.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-hover" onClick={() => onOpen(r.id)} data-return={r.periodKey}>
              <td className={td}><button type="button" className="font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => { e.stopPropagation(); onOpen(r.id) }}>{r.label}</button></td>
              <td className={cn(td, 'whitespace-nowrap text-muted')}>{fmtDate(r.from)} – {fmtDate(r.to)}</td>
              <td className={cn(td, 'whitespace-nowrap')}>{fmtDate(r.dueDate)}</td>
              <td className={td}><VatStatusBadge status={r.status} overdue={r.overdue} inProgress={r.inProgress} /></td>
              <td className={tdEnd}><Amount value={r.payable} /></td>
              <td className={cn(td, 'num text-muted')}>{r.filingReference ?? '—'}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  )
}

function ReturnPanel({ id, box, settings, onBox, onBack }: { id: string; box: string | null; settings: TaxSettings; onBox: (b: string | null) => void; onBack: () => void }) {
  const q = useVatReturn(id)
  const navigate = useNavigate()
  const d = q.data
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> All returns
      </button>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton className="h-96" /> : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">{layoutTitle(d)} · {d.label}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted">
                {fmtDate(d.from)} – {fmtDate(d.to)} · due {fmtDate(d.dueDate)} <VatStatusBadge status={d.status} overdue={d.overdue} inProgress={d.inProgress} />
                {d.frozen && <span>· frozen at filing</span>}
              </p>
            </div>
            <ReturnActions d={d} settings={settings} onPrint={() => navigate(financeVatReturnPrintPath(d.id))} />
          </div>
          <FilingInfo d={d} />
          <TotalsStrip d={d} />
          <Notices d={d} />
          <BoxesTable d={d} onDrill={(b) => onBox(b)} />
          <div className="flex flex-wrap gap-2 text-[0.8125rem]">
            {d.correctionCount > 0 && <Button variant="secondary" size="sm" onClick={() => onBox('corrections')}>Corrections of earlier periods ({d.correctionCount})</Button>}
            <Button variant="ghost" size="sm" onClick={() => onBox('excluded')}>Not reported ({d.excludedCount})</Button>
            {d.layout === 'uae_vat201' && <Button variant="ghost" size="sm" onClick={() => onBox('1')}>All standard-rated sales (1a–1g)</Button>}
          </div>
          {box && <BoxItemsDrawer returnId={d.id} box={box} currency={d.currency} onClose={() => onBox(null)} />}
        </>
      )}
    </div>
  )
}

/* ---------------- corporate tax / zakat ---------------- */

function YearPicker({ settings, year, onYear }: { settings: TaxSettings; year: number | undefined; onYear: (y: number) => void }) {
  return (
    <Field id="tax-year" label="Fiscal year">
      <SelectInput id="tax-year" value={year ?? settings.fiscalYears[0]} onChange={(e) => onYear(Number(e.target.value))}>
        {settings.fiscalYears.map((y) => <option key={y} value={y}>{y}</option>)}
      </SelectInput>
    </Field>
  )
}

function Row({ label, value, currency, strong, note }: { label: string; value: number; currency?: string; strong?: boolean; note?: string | null }) {
  return (
    <tr className={cn(strong && 'font-semibold')}>
      <td className={td}>{label}{note && <span className="block text-xs font-normal text-muted">{note}</span>}</td>
      <td className={tdEnd}><Amount value={value} currency={currency} strong={strong} /></td>
    </tr>
  )
}

function Kpi({ label, value, currency, tone }: { label: string; value: number; currency: string; tone?: 'brand' | 'warn' }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface px-4 py-3', tone === 'brand' && 'border-brand-300 bg-brand-50/40 dark:bg-brand-500/10', tone === 'warn' && 'border-warning-500/40')}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg"><Amount value={value} currency={currency} strong /></p>
    </div>
  )
}

function CorporateTaxTab({ settings }: { settings: TaxSettings }) {
  const [year, setYear] = useState<number | undefined>(undefined)
  const q = useCorporateTax(year, true)
  const e = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <YearPicker settings={settings} year={year} onYear={setYear} />
        {e && <ProvisionButton e={e} />}
      </div>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !e ? <Skeleton className="h-96" /> : (
        <>
          <p className="rounded-lg border border-warning-500/40 bg-warning-50 px-3 py-2 text-[0.8125rem] dark:bg-warning-500/10">Estimate only — {fmtDate(e.from)} to {fmtDate(e.asOf)}. Consult your tax advisor before filing.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Kpi label="Accounting profit (to date)" value={e.accountingProfit} currency={e.currency} />
            <Kpi label="Taxable income" value={e.taxableIncome} currency={e.currency} />
            <Kpi label="Estimated corporate tax" value={e.tax} currency={e.currency} tone="brand" />
            <Kpi label={e.toProvide >= 0 ? 'Still to provide' : 'Over-provided'} value={e.toProvide} currency={e.currency} tone={e.toProvide !== 0 ? 'warn' : undefined} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SimpleTable label="Corporate tax computation" head={<tr><th className={th}>Computation</th><th className={thEnd}>{e.currency}</th></tr>}>
              <Row label="Revenue" value={e.revenue} />
              <Row label="Expenses" value={-e.expenses} />
              <Row label="Accounting profit" value={e.accountingProfit} strong />
              {e.adjustments.map((a) => <Row key={a.key} label={a.label} value={a.amount} note={a.note} />)}
              {e.manualAdjustments.map((a, i) => <Row key={`m${i}`} label={`${a.label} (manual)`} value={a.amount} />)}
              <Row label="Taxable income" value={e.taxableIncome} strong />
              {e.bands.map((b) => <Row key={b.label} label={`${b.label} at ${b.rate} %`} value={b.tax} note={`on ${b.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />)}
              <Row label="Corporate tax (estimate)" value={e.tax} strong />
              <Row label="Already provided" value={e.provided} />
              <Row label="Projected full-year tax" value={e.projectedTax} note={`Profit projected to 12 months: ${e.projectedProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} />
            </SimpleTable>
            <div className="space-y-4">
              <AdjustmentsEditor kind="corporate_tax" year={e.fiscalYear} lines={e.manualAdjustments} canEdit={e.canPost} hint="+ adds to taxable income (non-deductible); − deducts (exempt income, reliefs)." />
              <ul className="list-disc space-y-1 ps-5 text-[0.8125rem] text-muted">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ZakatTab({ settings }: { settings: TaxSettings }) {
  const [year, setYear] = useState<number | undefined>(undefined)
  const q = useZakat(year, true)
  const e = q.data
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <YearPicker settings={settings} year={year} onYear={setYear} />
        {e && <ProvisionButton e={e} />}
      </div>
      {q.error ? <FinError error={q.error as Error} onRetry={() => void q.refetch()} /> : !e ? <Skeleton className="h-96" /> : (
        <>
          <p className="rounded-lg border border-warning-500/40 bg-warning-50 px-3 py-2 text-[0.8125rem] dark:bg-warning-500/10">Estimate, consult your advisor — balances as of {fmtDate(e.asOf)}.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Kpi label="Zakat base" value={e.base} currency={e.currency} />
            <Kpi label={`Zakat at ${e.rate} %`} value={e.zakat} currency={e.currency} tone="brand" />
            <Kpi label="Already provided" value={e.provided} currency={e.currency} />
            <Kpi label={e.toProvide >= 0 ? 'Still to provide' : 'Over-provided'} value={e.toProvide} currency={e.currency} tone={e.toProvide !== 0 ? 'warn' : undefined} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SimpleTable label="Zakat base" head={<tr><th className={th}>Simplified zakat base</th><th className={thEnd}>{e.currency}</th></tr>}>
              {e.lines.map((l) => <Row key={l.key} label={l.label} value={l.amount} note={l.note} />)}
              <Row label="Base (balance-sheet method)" value={e.baseByBalanceSheet} strong />
              <Row label="Adjusted net profit of the year" value={e.adjustedNetProfit} />
              <Row label={`Zakat base used (${e.method === 'net_profit' ? 'adjusted net profit — higher' : 'balance-sheet method'})`} value={e.base} strong />
              <Row label={`Zakat ${e.rate} %`} value={e.zakat} strong />
            </SimpleTable>
            <div className="space-y-4">
              <AdjustmentsEditor kind="zakat" year={e.fiscalYear} lines={e.manualAdjustments} canEdit={e.canPost} hint="+ adds to the zakat base; − deducts (e.g. long-term investments)." />
              <ul className="list-disc space-y-1 ps-5 text-[0.8125rem] text-muted">{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ProvisionButton({ e }: { e: CorporateTaxEstimate | ZakatEstimate }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const m = useTaxMutation(() => taxApi.provision({ kind: e.kind, year: e.fiscalYear }))
  if (!e.canPost) return null
  const what = e.kind === 'zakat' ? 'zakat' : 'corporate tax'
  return (
    <>
      <Button write disabled={e.toProvide === 0} title={e.toProvide === 0 ? 'The provision already matches the estimate.' : undefined} onClick={() => setOpen(true)}>Post provision</Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Post the ${what} provision`}
          description={e.toProvide > 0 ? `Dr ${e.kind === 'zakat' ? 'Zakat' : 'Corporate tax'} expense (6960) / Cr 2700 payable for the difference to the estimate.` : 'Releases the over-provision: Dr 2700 / Cr 6960.'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button write loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: (r) => { toast.success('Provision posted', r.entry.number); setOpen(false) }, onError: (x) => toast.error('Not posted', x.message) })}>Post</Button>
            </>
          }
        >
          <p className="text-[0.8125rem]">Amount: <Amount value={e.toProvide} currency={e.currency} strong /></p>
        </Modal>
      )}
    </>
  )
}

function AdjustmentsEditor({ kind, year, lines, canEdit, hint }: { kind: 'corporate_tax' | 'zakat'; year: number; lines: TaxAdjustmentLine[]; canEdit: boolean; hint: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<{ label: string; amount: string }[]>([])
  useEffect(() => setRows(lines.map((l) => ({ label: l.label, amount: String(l.amount) }))), [lines])
  const m = useTaxMutation(() => taxApi.adjustments({ kind, year, lines: rows.filter((r) => r.label.trim()).map((r) => ({ label: r.label.trim(), amount: Number(r.amount) || 0 })) }))
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Manual adjustments">
      <h3 className="text-sm font-semibold text-ink">Manual adjustments</h3>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      <div className="mt-3 space-y-2">
        {!rows.length && <p className="text-[0.8125rem] text-muted">None.</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <TextInput aria-label="Adjustment" value={r.label} disabled={!canEdit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <TextInput aria-label="Amount" type="number" className="w-36" value={r.amount} disabled={!canEdit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            {canEdit && <Button variant="ghost" size="sm" iconOnly aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 /></Button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRows([...rows, { label: '', amount: '0' }])}><Plus />Add</Button>
          <Button write size="sm" loading={m.isPending} onClick={() => m.mutate(undefined, { onSuccess: () => toast.success('Adjustments saved'), onError: (e) => toast.error('Not saved', e.message) })}>Save adjustments</Button>
        </div>
      )}
    </section>
  )
}
