import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Vendor, VendorCategory, VendorInput, VendorStatus } from '@/modules/events/libraryTypes'
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, VENDOR_STATUSES, VENDOR_STATUS_LABEL } from '@/modules/events/libraryTypes'
import { useSaveVendor } from '@/modules/events/hooks/useEventLibrary'
import { useRegion } from '@/modules/tenancy/hooks'
import { isMobile, mobileError } from '@/shared/lib/phone'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

type Doc = { key: string; id?: string; name: string; url: string }
let docSeq = 0

interface Draft {
  category: VendorCategory
  name: string
  contactName: string
  mobile: string
  email: string
  website: string
  taxNumber: string
  paymentTerms: string
  status: VendorStatus
  notes: string
  documents: Doc[]
}

const draftOf = (v: Vendor | null): Draft => ({
  category: v?.category ?? 'booth_builder',
  name: v?.name ?? '',
  contactName: v?.contactName ?? '',
  mobile: v?.mobile ?? '',
  email: v?.email ?? '',
  website: v?.website ?? '',
  taxNumber: v?.taxNumber ?? '',
  paymentTerms: v?.paymentTerms ?? '',
  status: v?.status ?? 'approved',
  notes: v?.notes ?? '',
  documents: (v?.documents ?? []).map((d) => ({ key: `d${++docSeq}`, ...d })),
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Create / edit a vendor (marketing full). Blacklisting stops new budget lines from picking it. */
export function VendorDrawer({ open, onClose, vendor, onSaved }: { open: boolean; onClose: () => void; vendor: Vendor | null; onSaved?: (v: Vendor) => void }) {
  const region = useRegion()
  const save = useSaveVendor()
  const toast = useToast()
  const [d, setD] = useState<Draft>(() => draftOf(vendor))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setD(draftOf(vendor))
    setTouched(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor?.id])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setDoc = (key: string, patch: Partial<Doc>) => setD((x) => ({ ...x, documents: x.documents.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const errs: Partial<Record<keyof Draft, string>> = {}
  if (touched) {
    if (d.name.trim().length < 2) errs.name = 'Enter the company name.'
    if (d.mobile && !isMobile(d.mobile, region.country)) errs.mobile = mobileError(region.country)
    if (d.email && !EMAIL_RE.test(d.email.trim())) errs.email = 'Enter a valid email address.'
    if (d.website && !/^https?:\/\//i.test(d.website)) errs.website = 'Use a full link (https://…).'
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    if (d.name.trim().length < 2) return
    const input: Partial<VendorInput> = { ...d, documents: d.documents.filter((x) => x.name.trim() || x.url.trim()).map(({ id, name, url }) => ({ id, name, url })) }
    save.mutate(
      { id: vendor?.id, input },
      {
        onSuccess: (v) => {
          toast.success(vendor ? 'Vendor saved' : 'Vendor added', v.name)
          onSaved?.(v)
          onClose()
        },
      },
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title={vendor ? `Edit ${vendor.name}` : 'New vendor'}
      description="Budget lines on events link to vendors; their spend and ratings add up here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="vendor-form" loading={save.isPending}>
            {vendor ? 'Save vendor' : 'Add vendor'}
          </Button>
        </>
      }
    >
      <form id="vendor-form" noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Field id="vd-name" label="Company name" required error={errs.name}>
            <TextInput id="vd-name" value={d.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field id="vd-category" label="Category">
            <SelectInput id="vd-category" value={d.category} onChange={(e) => set('category', e.target.value as VendorCategory)}>
              {VENDOR_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {VENDOR_CATEGORY_LABEL[c]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field id="vd-contact" label="Contact person">
            <TextInput id="vd-contact" value={d.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </Field>
          <Field id="vd-mobile" label="Mobile" error={errs.mobile}>
            <TextInput id="vd-mobile" inputMode="tel" value={d.mobile} invalid={!!errs.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field id="vd-email" label="Email" error={errs.email}>
            <TextInput id="vd-email" type="email" value={d.email} invalid={!!errs.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="vd-website" label="Website" error={errs.website}>
            <TextInput id="vd-website" type="url" value={d.website} invalid={!!errs.website} placeholder="https://…" onChange={(e) => set('website', e.target.value)} />
          </Field>
          <Field id="vd-tax" label="VAT / tax number (optional)">
            <TextInput id="vd-tax" value={d.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
          </Field>
          <Field id="vd-terms" label="Payment terms">
            <TextInput id="vd-terms" value={d.paymentTerms} placeholder="e.g. 50% on order, 50% on delivery" onChange={(e) => set('paymentTerms', e.target.value)} />
          </Field>
          <Field id="vd-status" label="Status" hint={d.status === 'blacklisted' ? 'Blacklisted vendors can’t be picked for new budget lines.' : undefined}>
            <SelectInput id="vd-status" value={d.status} onChange={(e) => set('status', e.target.value as VendorStatus)}>
              {VENDOR_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {VENDOR_STATUS_LABEL[s]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium">Documents (links)</legend>
          {d.documents.map((x, i) => (
            <div key={x.key} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] gap-2">
              <TextInput aria-label={`Document ${i + 1} name`} placeholder="Name" value={x.name} onChange={(e) => setDoc(x.key, { name: e.target.value })} />
              <TextInput aria-label={`Document ${i + 1} link`} type="url" placeholder="https://…" value={x.url} onChange={(e) => setDoc(x.key, { url: e.target.value })} />
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove document ${i + 1}`} onClick={() => set('documents', d.documents.filter((y) => y.key !== x.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => set('documents', [...d.documents, { key: `d${++docSeq}`, name: '', url: '' }])}>
            <Plus />
            Add document
          </Button>
        </fieldset>
        <Field id="vd-notes" label="Notes">
          <TextArea id="vd-notes" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        {save.error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {save.error.message}
          </p>
        )}
      </form>
    </Drawer>
  )
}
