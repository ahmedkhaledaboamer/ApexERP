import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { SponsorDealInput, SponsorEventOption, SponsorPackage, SponsorStage } from '@/modules/events/sponsorTypes'
import { OPEN_SPONSOR_STAGES, SPONSOR_STAGE_LABEL } from '@/modules/events/sponsorTypes'
import { useCreateSponsor, useSavePackage, useSponsorOrganizations } from '@/modules/events/hooks/useSponsorsLogistics'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useCurrentUser } from '@/store/hooks'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

/* ---------------- Package ---------------- */

type Row = { key: string; title: string; offsetDays: string }
let rowSeq = 0
const newRow = (title = '', offsetDays = -7): Row => ({ key: `d${++rowSeq}`, title, offsetDays: String(offsetDays) })
const DEFAULT_DELIVERABLES: [string, number][] = [['Logo received', -14], ['Stand allocated', -7], ['Social media mentions', -5], ['Banner printed', -3]]

/** Create / edit a sponsorship package (benefits one per line, deliverables template with days from the event's start). */
export function PackageModal({ eventId, currency, pkg, onClose }: { eventId: string; currency: string; pkg: SponsorPackage | null; onClose: () => void }) {
  const save = useSavePackage()
  const toast = useToast()
  const [name, setName] = useState(pkg?.name ?? '')
  const [price, setPrice] = useState(pkg ? String(pkg.price) : '')
  const [quantity, setQuantity] = useState(pkg ? String(pkg.quantity) : '1')
  const [benefits, setBenefits] = useState((pkg?.benefits ?? []).join('\n'))
  const [rows, setRows] = useState<Row[]>(() => (pkg ? pkg.deliverables.map((d) => newRow(d.title, d.offsetDays)) : DEFAULT_DELIVERABLES.map(([t, o]) => newRow(t, o))))
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  function submit() {
    save.mutate(
      {
        eventId,
        packageId: pkg?.id,
        input: {
          name,
          price: Number(price || 0),
          quantity: Number(quantity || 0),
          benefits: benefits.split('\n').map((b) => b.trim()).filter(Boolean),
          deliverables: rows.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), offsetDays: Number(r.offsetDays || 0) })),
        },
      },
      { onSuccess: () => { toast.success(pkg ? 'Package saved' : 'Package added', name); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={pkg ? `Edit ${pkg.name}` : 'New sponsorship package'}
      description={`Priced in ${currency}. Signed sponsors get the deliverables, due the given number of days before (−) or after (+) the event’s start.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={save.isPending} onClick={submit}>{pkg ? 'Save package' : 'Add package'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_6rem]">
          <Field id="pkg-name" label="Name" required>
            <TextInput id="pkg-name" value={name} placeholder="Gold, Exhibitor booth…" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="pkg-price" label={`Price (${currency})`}>
            <TextInput id="pkg-price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field id="pkg-qty" label="Quantity">
            <TextInput id="pkg-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        <Field id="pkg-benefits" label="Benefits" hint="One per line.">
          <TextArea id="pkg-benefits" rows={3} value={benefits} onChange={(e) => setBenefits(e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-[0.8125rem] font-medium">Deliverables template</legend>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2">
              <TextInput aria-label={`Deliverable ${i + 1}`} placeholder="Logo received" value={r.title} onChange={(e) => setRow(r.key, { title: e.target.value })} />
              <TextInput aria-label={`Deliverable ${i + 1} days from the event`} type="number" value={r.offsetDays} onChange={(e) => setRow(r.key, { offsetDays: e.target.value })} />
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove deliverable ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow()])}>
            <Plus />
            Add deliverable
          </Button>
        </fieldset>
      </div>
    </Modal>
  )
}

/* ---------------- New sponsor ---------------- */

type OrgMode = 'existing' | 'new'

/** Add a sponsor: an existing lead / customer, or a new organization (a lead with source Event, duplicate-checked). */
export function NewSponsorModal({
  events,
  packages,
  eventId: fixedEventId,
  onClose,
  onCreated,
}: {
  events: SponsorEventOption[]
  packages: SponsorPackage[]
  eventId?: string
  onClose: () => void
  onCreated?: (id: string, eventId: string) => void
}) {
  const me = useCurrentUser()
  const create = useCreateSponsor()
  const toast = useToast()
  const users = useUsersQuery()
  const manageable = events.filter((e) => e.canManage)
  const [eventId, setEventId] = useState(fixedEventId ?? manageable[0]?.id ?? '')
  const eventPackages = packages.filter((p) => p.eventId === eventId)
  const [packageId, setPackageId] = useState(eventPackages[0]?.id ?? '')
  const pkg = eventPackages.find((p) => p.id === packageId) ?? null
  const [mode, setMode] = useState<OrgMode>('existing')
  const [query, setQuery] = useState('')
  const [org, setOrg] = useState<{ kind: 'lead' | 'customer'; id: string; name: string } | null>(null)
  const orgs = useSponsorOrganizations(query, mode === 'existing')
  const [company, setCompany] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [amount, setAmount] = useState('')
  const [ownerId, setOwnerId] = useState(me?.id ?? '')
  const [stage, setStage] = useState<SponsorStage>('prospect')
  const [duplicate, setDuplicate] = useState<string | null>(null)

  function submit(force = false) {
    if (!eventId || !pkg) return toast.error('Not added', 'Pick the event and a package.')
    const input: SponsorDealInput = {
      packageId: pkg.id,
      ownerId: ownerId || null,
      stage,
      amount: amount === '' ? undefined : Number(amount),
      ...(mode === 'existing'
        ? org?.kind === 'customer'
          ? { customerId: org.id }
          : { leadId: org?.id ?? '' }
        : { newLead: { company, contactName, email }, contactName, contactEmail: email, force }),
    }
    create.mutate(
      { eventId, input },
      {
        onSuccess: (d) => {
          toast.success('Sponsor added', `${d.organizationName} · ${d.packageName}`)
          onCreated?.(d.id, d.eventId)
          onClose()
        },
        onError: (err) => {
          const code = (err as { code?: string }).code
          if (code === 'duplicate_lead' && !force) setDuplicate(err.message)
          else toast.error('Not added', err.message)
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a sponsor"
      description="Link an existing lead or customer, or add the organization as a new lead (source Event)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {duplicate && (
            <Button write variant="secondary" loading={create.isPending} onClick={() => submit(true)}>
              Add anyway
            </Button>
          )}
          <Button write loading={create.isPending} onClick={() => submit(false)}>Add sponsor</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!fixedEventId && (
            <Field id="sp-event" label="Event">
              <SelectInput
                id="sp-event"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value)
                  setPackageId(packages.find((p) => p.eventId === e.target.value)?.id ?? '')
                }}
              >
                {manageable.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </SelectInput>
            </Field>
          )}
          <Field id="sp-package" label="Package">
            <SelectInput id="sp-package" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              {eventPackages.length === 0 && <option value="">No packages yet</option>}
              {eventPackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {moneyIn(p.price, p.currency)} · {p.remaining} of {p.quantity} left
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Segmented<OrgMode> label="Organization" value={mode} onChange={(v) => { setMode(v); setDuplicate(null) }} options={[{ value: 'existing', label: 'Existing lead or customer' }, { value: 'new', label: 'New organization' }]} />
        {mode === 'existing' ? (
          <div className="space-y-2">
            <TextInput aria-label="Search leads and customers" placeholder="Search leads and customers…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="max-h-44 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Organizations">
              {(orgs.data ?? []).length === 0 && <li className="px-3 py-2 text-[0.8125rem] text-muted">{orgs.isPending ? 'Loading…' : 'No match.'}</li>}
              {(orgs.data ?? []).map((o) => (
                <li key={`${o.kind}-${o.id}`}>
                  <button
                    type="button"
                    onClick={() => setOrg(o)}
                    aria-pressed={org?.id === o.id}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-[0.8125rem] hover:bg-sunken ${org?.id === o.id ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{o.name}</span>
                    <span className="text-xs text-muted">{o.kind === 'customer' ? 'Customer' : 'Lead'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="sp-company" label="Organization" required>
              <TextInput id="sp-company" value={company} onChange={(e) => { setCompany(e.target.value); setDuplicate(null) }} />
            </Field>
            <Field id="sp-contact" label="Contact">
              <TextInput id="sp-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field id="sp-email" label="Email">
              <TextInput id="sp-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setDuplicate(null) }} />
            </Field>
          </div>
        )}
        {duplicate && <p role="alert" className="rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/15 dark:text-warning-500">{duplicate}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field id="sp-amount" label="Amount" hint={pkg ? `Package price ${moneyIn(pkg.price, pkg.currency)}` : undefined}>
            <TextInput id="sp-amount" type="number" min={0} placeholder={pkg ? String(pkg.price) : ''} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field id="sp-owner" label="Owner">
            <SelectInput id="sp-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {(users.data ?? []).filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </SelectInput>
          </Field>
          <Field id="sp-stage" label="Stage">
            <SelectInput id="sp-stage" value={stage} onChange={(e) => setStage(e.target.value as SponsorStage)}>
              {[...OPEN_SPONSOR_STAGES, 'signed' as const].map((s) => <option key={s} value={s}>{SPONSOR_STAGE_LABEL[s]}</option>)}
            </SelectInput>
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------- Lost reason ---------------- */

export function LostReasonModal({ name, busy, onConfirm, onClose }: { name: string; busy: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Mark ${name} as lost`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>Mark lost</Button>
        </>
      }
    >
      <Field id="lost-reason" label="Reason" required>
        <TextInput id="lost-reason" autoFocus value={reason} placeholder="Budget moved, chose another event…" onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  )
}
