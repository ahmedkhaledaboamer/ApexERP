import { Plus, Trash2 } from 'lucide-react'
import type { BillLineInput, PurchasesMeta } from '@/modules/finance/purchases/types'
import { purchaseLine, purchaseTotals } from '@/modules/finance/purchases/calc'
import { fmt2 } from '@/modules/finance/collections/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { SelectInput, TextInput } from '@/shared/components/form/Field'

/** One editable line of a PO / bill (strings while typing). */
export interface LineDraft {
  key: string
  id?: string
  poLineId?: string | null
  description: string
  quantity: string
  unitPrice: string
  taxCodeId: string
  accountId: string
  departmentId: string
  projectId: string
  eventId: string
  budgetLineId: string
}

let seq = 0
export const newLine = (defaults: Partial<LineDraft> = {}): LineDraft => ({
  key: `ln-${++seq}`,
  description: '',
  quantity: '1',
  unitPrice: '',
  taxCodeId: '',
  accountId: '',
  departmentId: '',
  projectId: '',
  eventId: '',
  budgetLineId: '',
  ...defaults,
})

/** Draft from a saved line (PO / bill / PO line prefill). */
export function draftFrom(l: Partial<BillLineInput> & { description: string; quantity: number; unitPrice: number }): LineDraft {
  return newLine({
    id: l.id,
    poLineId: l.poLineId ?? null,
    description: l.description,
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
    taxCodeId: l.taxCodeId ?? '',
    accountId: l.accountId ?? '',
    departmentId: l.departmentId ?? '',
    projectId: l.projectId ?? '',
    eventId: l.eventId ?? '',
    budgetLineId: l.budgetLineId ?? '',
  })
}

/** Wire input: empty selects are left out so the server picks the defaults (supplier profile / company). */
export function toInputs(lines: LineDraft[]): BillLineInput[] {
  return lines.map((l) => ({
    ...(l.id ? { id: l.id } : {}),
    ...(l.poLineId ? { poLineId: l.poLineId } : {}),
    description: l.description.trim(),
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    taxCodeId: l.taxCodeId || null,
    accountId: l.accountId || null,
    departmentId: l.departmentId || null,
    projectId: l.projectId || null,
    eventId: l.eventId || null,
    budgetLineId: l.budgetLineId || null,
  }))
}

/** Live totals (tax per line; an empty tax code previews with the standard rate when the supplier is VAT registered). */
export function draftTotals(lines: LineDraft[], meta: PurchasesMeta | undefined, defaultTaxId: string) {
  const rateOf = (id: string) => meta?.taxCodes.find((t) => t.id === (id || defaultTaxId))?.rate ?? 0
  const computed = lines.map((l) => purchaseLine(Number(l.quantity) || 0, Number(l.unitPrice) || 0, rateOf(l.taxCodeId)))
  return { lines: computed, ...purchaseTotals(computed) }
}

export function LineEditor({ lines, onChange, meta, currency, defaultTaxId, disabled }: { lines: LineDraft[]; onChange: (lines: LineDraft[]) => void; meta: PurchasesMeta | undefined; currency: string; defaultTaxId: string; disabled?: boolean }) {
  const set = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const t = draftTotals(lines, meta, defaultTaxId)
  const sel = 'h-8 text-xs'
  return (
    <div className="space-y-3">
      {lines.map((l, i) => {
        const n = i + 1
        const ev = meta?.events.find((e) => e.id === l.eventId)
        return (
          <div key={l.key} className="rounded-xl border border-line bg-surface p-3">
            <div className="grid gap-2 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_auto]">
              <TextInput aria-label={`Line ${n} description`} placeholder="Description" value={l.description} disabled={disabled} onChange={(e) => set(l.key, { description: e.target.value })} />
              <TextInput aria-label={`Line ${n} quantity`} type="number" min="0" step="any" className="num" value={l.quantity} disabled={disabled} onChange={(e) => set(l.key, { quantity: e.target.value })} />
              <TextInput aria-label={`Line ${n} unit price`} type="number" min="0" step="0.01" placeholder="Unit price" className="num" value={l.unitPrice} disabled={disabled} onChange={(e) => set(l.key, { unitPrice: e.target.value })} />
              <div className="flex h-9 items-center justify-end text-[0.8125rem]">
                <span className="num font-medium text-ink">{fmt2(t.lines[i]?.total ?? 0)}</span>
                <span className="ms-1 text-xs text-muted">{currency}</span>
              </div>
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove line ${n}`} disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
              <SelectInput aria-label={`Line ${n} tax code`} className={sel} value={l.taxCodeId} disabled={disabled} onChange={(e) => set(l.key, { taxCodeId: e.target.value })}>
                <option value="">Tax: supplier default</option>
                {meta?.taxCodes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Line ${n} account`} className={sel} value={l.accountId} disabled={disabled} onChange={(e) => set(l.key, { accountId: e.target.value })}>
                <option value="">Account: default</option>
                {meta?.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Line ${n} department`} className={sel} value={l.departmentId} disabled={disabled} onChange={(e) => set(l.key, { departmentId: e.target.value })}>
                <option value="">No department</option>
                {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Line ${n} project`} className={sel} value={l.projectId} disabled={disabled} onChange={(e) => set(l.key, { projectId: e.target.value })}>
                <option value="">No project</option>
                {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Line ${n} event`} className={sel} value={l.eventId} disabled={disabled} onChange={(e) => set(l.key, { eventId: e.target.value, budgetLineId: '' })}>
                <option value="">No event</option>
                {meta?.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </SelectInput>
              <SelectInput aria-label={`Line ${n} budget line`} className={sel} value={l.budgetLineId} disabled={disabled || !ev} onChange={(e) => set(l.key, { budgetLineId: e.target.value })}>
                <option value="">{ev ? 'No budget line' : 'Budget line (pick an event)'}</option>
                {ev?.budgetLines.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </SelectInput>
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onChange([...lines, newLine()])}>
          <Plus className="size-4" aria-hidden /> Add line
        </Button>
        <dl className="min-w-56 space-y-1 text-[0.8125rem]">
          <div className="flex justify-between gap-6"><dt className="text-muted">Subtotal</dt><dd className="num">{fmt2(t.subtotal)}</dd></div>
          <div className="flex justify-between gap-6"><dt className="text-muted">VAT</dt><dd className="num">{fmt2(t.taxTotal)}</dd></div>
          <div className="flex justify-between gap-6 border-t border-line pt-1 font-semibold"><dt>Total</dt><dd className="num">{fmt2(t.total)} {currency}</dd></div>
        </dl>
      </div>
    </div>
  )
}
