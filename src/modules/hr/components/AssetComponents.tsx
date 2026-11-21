import { useEffect, useState, type FormEvent } from 'react'
import { History, PackageCheck, Pencil, Undo2, UserPlus, XCircle } from 'lucide-react'
import type { AssetCategory, AssetCondition, AssetInput, AssetRow, AssetStatus } from '@/modules/hr/peopleTypes'
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_CONDITIONS, ASSET_CONDITION_LABEL } from '@/modules/hr/peopleTypes'
import { useAssetQuery, useAssignAsset, useEmployeesQuery, useMarkAssetLost, useReturnAsset, useSaveAsset } from '@/modules/hr/hooks/useHrPeople'
import { useRegion } from '@/modules/tenancy/hooks'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Property, PropertyList } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { AssetStatusBadge, FormError, Money } from './PeopleBits'

const today = () => new Date().toISOString().slice(0, 10)

/* ---------------- create / edit ---------------- */

interface Draft {
  tag: string
  name: string
  category: AssetCategory
  brand: string
  model: string
  serial: string
  purchaseDate: string
  cost: string
  currency: string
  condition: AssetCondition
  status: AssetStatus
  warrantyEnd: string
  notes: string
}

const draftOf = (a: AssetRow | null, currency: string): Draft => ({
  tag: a?.tag ?? '',
  name: a?.name ?? '',
  category: a?.category ?? 'laptop',
  brand: a?.brand ?? '',
  model: a?.model ?? '',
  serial: a?.serial ?? '',
  purchaseDate: a?.purchaseDate ?? '',
  cost: a?.cost === null || a?.cost === undefined ? '' : String(a.cost),
  currency: a?.currency ?? currency,
  condition: a?.condition ?? 'new',
  status: a?.status ?? 'in_stock',
  warrantyEnd: a?.warrantyEnd ?? '',
  notes: a?.notes ?? '',
})

export function AssetDrawer({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: AssetRow | null }) {
  const region = useRegion()
  const save = useSaveAsset()
  const toast = useToast()
  const [d, setD] = useState<Draft>(() => draftOf(asset, region.currency))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setD(draftOf(asset, region.currency))
    setTouched(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, asset?.id])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const errs: Partial<Record<keyof Draft, string>> = {}
  if (touched) {
    if (!d.tag.trim()) errs.tag = 'Enter the asset tag.'
    if (d.name.trim().length < 2) errs.name = 'Enter the asset name.'
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    if (!d.tag.trim() || d.name.trim().length < 2) return
    const input: Partial<AssetInput> = {
      tag: d.tag,
      name: d.name,
      category: d.category,
      brand: d.brand,
      model: d.model,
      serial: d.serial,
      purchaseDate: d.purchaseDate || null,
      cost: d.cost === '' ? null : Number(d.cost),
      currency: d.currency,
      condition: d.condition,
      warrantyEnd: d.warrantyEnd || null,
      notes: d.notes,
      ...(asset?.status === 'assigned' || asset?.status === 'lost' ? {} : { status: d.status }),
    }
    save.mutate({ id: asset?.id, input }, { onSuccess: (a) => { toast.success(asset ? 'Asset saved' : 'Asset added', `${a.tag} · ${a.name}`); onClose() } })
  }

  const editableStatus = !asset || (asset.status !== 'assigned' && asset.status !== 'lost')
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="md"
      title={asset ? `Edit ${asset.tag}` : 'New asset'}
      description="Tags are unique in the company."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write type="submit" form="asset-form" loading={save.isPending}>{asset ? 'Save asset' : 'Add asset'}</Button>
        </>
      }
    >
      <form id="asset-form" noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="as-tag" label="Asset tag" required error={errs.tag}>
            <TextInput id="as-tag" value={d.tag} invalid={!!errs.tag} onChange={(e) => set('tag', e.target.value.toUpperCase())} />
          </Field>
          <Field id="as-category" label="Category">
            <SelectInput id="as-category" value={d.category} onChange={(e) => set('category', e.target.value as AssetCategory)}>
              {ASSET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field id="as-name" label="Name" required error={errs.name}>
          <TextInput id="as-name" value={d.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="as-brand" label="Brand">
            <TextInput id="as-brand" value={d.brand} onChange={(e) => set('brand', e.target.value)} />
          </Field>
          <Field id="as-model" label="Model">
            <TextInput id="as-model" value={d.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          <Field id="as-serial" label="Serial number">
            <TextInput id="as-serial" value={d.serial} onChange={(e) => set('serial', e.target.value)} />
          </Field>
          <Field id="as-purchase" label="Purchase date">
            <TextInput id="as-purchase" type="date" value={d.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
          </Field>
          <Field id="as-cost" label={`Cost (${d.currency})`}>
            <TextInput id="as-cost" inputMode="decimal" value={d.cost} onChange={(e) => set('cost', e.target.value)} />
          </Field>
          <Field id="as-warranty" label="Warranty end">
            <TextInput id="as-warranty" type="date" value={d.warrantyEnd} onChange={(e) => set('warrantyEnd', e.target.value)} />
          </Field>
          <Field id="as-condition" label="Condition">
            <ConditionSelect id="as-condition" value={d.condition} onChange={(v) => set('condition', v)} />
          </Field>
          {editableStatus && (
            <Field id="as-status" label="Status">
              <SelectInput id="as-status" value={d.status} onChange={(e) => set('status', e.target.value as AssetStatus)}>
                <option value="in_stock">In stock</option>
                <option value="in_repair">In repair</option>
                <option value="retired">Retired</option>
              </SelectInput>
            </Field>
          )}
        </div>
        <Field id="as-notes" label="Notes">
          <TextArea id="as-notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <FormError error={save.error} />
      </form>
    </Drawer>
  )
}

function ConditionSelect({ id, value, onChange }: { id: string; value: AssetCondition; onChange: (v: AssetCondition) => void }) {
  return (
    <SelectInput id={id} value={value} onChange={(e) => onChange(e.target.value as AssetCondition)}>
      {ASSET_CONDITIONS.map((c) => (
        <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>
      ))}
    </SelectInput>
  )
}

/* ---------------- assign / return / lost ---------------- */

export function AssignModal({ asset, employeeId, onClose }: { asset: AssetRow; employeeId?: string; onClose: () => void }) {
  const assign = useAssignAsset()
  const toast = useToast()
  const people = useEmployeesQuery(!employeeId)
  const [emp, setEmp] = useState(employeeId ?? '')
  const [date, setDate] = useState(today())
  const [condition, setCondition] = useState<AssetCondition>(asset.condition)
  const [note, setNote] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign ${asset.tag}`}
      description={asset.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            disabled={!emp}
            loading={assign.isPending}
            onClick={() => assign.mutate({ id: asset.id, input: { employeeId: emp, date, condition, note } }, { onSuccess: (a) => { toast.success('Asset assigned', `${a.tag} → ${a.assignedToName ?? ''}`); onClose() } })}
          >
            Assign
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!employeeId && (
          <Field id="asg-emp" label="Employee" required>
            <SelectInput id="asg-emp" value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">Pick an employee</option>
              {(people.data ?? []).filter((p) => p.status !== 'terminated').map((p) => (
                <option key={p.id} value={p.id}>{p.fullName} · {p.employeeNo}</option>
              ))}
            </SelectInput>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="asg-date" label="Hand-over date">
            <TextInput id="asg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="asg-condition" label="Condition">
            <ConditionSelect id="asg-condition" value={condition} onChange={setCondition} />
          </Field>
        </div>
        <Field id="asg-note" label="Hand-over note">
          <TextArea id="asg-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError error={assign.error} />
      </div>
    </Modal>
  )
}

export function ReturnModal({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const ret = useReturnAsset()
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [condition, setCondition] = useState<AssetCondition>(asset.condition)
  const [note, setNote] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title={`Return ${asset.tag}`}
      description={`${asset.name} · held by ${asset.assignedToName ?? '—'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={ret.isPending} onClick={() => ret.mutate({ id: asset.id, input: { date, condition, note } }, { onSuccess: (a) => { toast.success('Asset returned', `${a.tag} is ${a.status === 'in_repair' ? 'in repair' : 'back in stock'}`); onClose() } })}>
            Confirm return
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="ret-date" label="Return date">
            <TextInput id="ret-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="ret-condition" label="Condition" hint="Damaged goes to repair.">
            <ConditionSelect id="ret-condition" value={condition} onChange={setCondition} />
          </Field>
        </div>
        <Field id="ret-note" label="Note">
          <TextArea id="ret-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError error={ret.error} />
      </div>
    </Modal>
  )
}

export function LostModal({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const lost = useMarkAssetLost()
  const toast = useToast()
  const [note, setNote] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Mark ${asset.tag} lost`}
      description="Closes the assignment; the offboarding no longer waits for it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write variant="danger" disabled={note.trim().length < 3} loading={lost.isPending} onClick={() => lost.mutate({ id: asset.id, note }, { onSuccess: (a) => { toast.success('Marked lost', a.tag); onClose() } })}>
            Mark lost
          </Button>
        </>
      }
    >
      <Field id="lost-note" label="What happened?" required>
        <TextArea id="lost-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError error={lost.error} />
    </Modal>
  )
}

/** Row actions shared by the register and the employee's Assets tab. */
export function AssetActions({ asset, onAssign, onReturn, onLost, onEdit }: { asset: AssetRow; onAssign?: () => void; onReturn: () => void; onLost: () => void; onEdit?: () => void }) {
  return (
    <span className="flex justify-end gap-1">
      {asset.status === 'in_stock' && onAssign && (
        <Button write variant="secondary" size="sm" onClick={onAssign}><UserPlus />Assign</Button>
      )}
      {asset.status === 'assigned' && (
        <Button write variant="secondary" size="sm" onClick={onReturn}><Undo2 />Return</Button>
      )}
      {(asset.status === 'assigned' || asset.status === 'in_stock' || asset.status === 'in_repair') && (
        <Button write variant="ghost" size="sm" aria-label={`Mark ${asset.tag} lost`} onClick={onLost}><XCircle /></Button>
      )}
      {onEdit && (
        <Button write variant="ghost" size="sm" aria-label={`Edit ${asset.tag}`} onClick={onEdit}><Pencil /></Button>
      )}
    </span>
  )
}

/* ---------------- detail (history) ---------------- */

export function AssetDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useAssetQuery(id)
  const a = q.data
  return (
    <Drawer open={!!id} onClose={onClose} width="md" title={a ? `${a.tag} · ${a.name}` : 'Asset'} description={a ? [a.brand, a.model].filter(Boolean).join(' ') : undefined}>
      {!a ? (
        q.error ? <FormError error={q.error} /> : <Skeleton className="h-48 rounded-card" />
      ) : (
        <div className="space-y-6">
          <PropertyList>
            <Property label="Status"><AssetStatusBadge status={a.status} /></Property>
            <Property label="Category">{ASSET_CATEGORY_LABEL[a.category]}</Property>
            <Property label="Held by">{a.assignedToName ?? '—'}</Property>
            <Property label="Serial">{a.serial || '—'}</Property>
            <Property label="Condition">{ASSET_CONDITION_LABEL[a.condition]}</Property>
            <Property label="Purchased">{fmtDate(a.purchaseDate)}</Property>
            <Property label="Cost"><Money value={a.cost} currency={a.currency} /></Property>
            <Property label="Warranty end">{fmtDate(a.warrantyEnd) || '—'}</Property>
          </PropertyList>
          {a.notes && <p className="whitespace-pre-line rounded-lg bg-sunken px-3 py-2 text-xs text-muted">{a.notes}</p>}
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink"><History className="size-4" aria-hidden />Assignment history</h3>
            {a.history.length === 0 ? (
              <p className="text-[0.8125rem] text-muted">Never assigned.</p>
            ) : (
              <ol className="space-y-3" aria-label="Assignment history">
                {a.history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-line px-3 py-2 text-[0.8125rem]">
                    <div className="flex items-center gap-2">
                      <PackageCheck className="size-4 text-muted" aria-hidden />
                      <span className="font-medium">{h.employeeName}</span>
                      <span className="ms-auto text-xs text-muted">{fmtDate(h.assignedDate)} → {h.lost ? 'lost' : h.returnedDate ? fmtDate(h.returnedDate) : 'now'}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Out: {ASSET_CONDITION_LABEL[h.assignedCondition]}{h.handoverNote ? ` · ${h.handoverNote}` : ''}
                      {h.returnedCondition ? ` · Back: ${ASSET_CONDITION_LABEL[h.returnedCondition]}` : ''}
                      {h.returnNote ? ` · ${h.returnNote}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}
