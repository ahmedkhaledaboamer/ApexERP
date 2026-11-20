import { useEffect, useState, type FormEvent } from 'react'
import type { Speaker, SpeakerInput, SpeakerKind } from '@/modules/events/libraryTypes'
import { useSaveSpeaker } from '@/modules/events/hooks/useEventLibrary'
import { useUsersQuery } from '@/modules/crm/hooks/useCrm'
import { useBrandAssets } from '@/modules/marketing/creative/hooks'
import { useEntitlements } from '@/modules/billing/hooks'
import { useRegion } from '@/modules/tenancy/hooks'
import { isMobile, mobileError } from '@/shared/lib/phone'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { CurrencySelect, TagsInput } from './LibraryBits'

interface Draft {
  name: string
  title: string
  company: string
  bio: string
  photoUrl: string
  email: string
  mobile: string
  topics: string[]
  linkedinUrl: string
  kind: SpeakerKind
  userId: string
  fee: string
  feeCurrency: string
  notes: string
}

const draftOf = (s: Speaker | null, currency: string): Draft => ({
  name: s?.name ?? '',
  title: s?.title ?? '',
  company: s?.company ?? '',
  bio: s?.bio ?? '',
  photoUrl: s?.photoUrl ?? '',
  email: s?.email ?? '',
  mobile: s?.mobile ?? '',
  topics: s?.topics ?? [],
  linkedinUrl: s?.linkedinUrl ?? '',
  kind: s?.kind ?? 'external',
  userId: s?.userId ?? '',
  fee: s?.fee === null || s?.fee === undefined ? '' : String(s.fee),
  feeCurrency: s?.feeCurrency || currency,
  notes: s?.notes ?? '',
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Create / edit a directory speaker (marketing full). Email and mobile are checked by the company's country. */
export function SpeakerDrawer({ open, onClose, speaker, onSaved }: { open: boolean; onClose: () => void; speaker: Speaker | null; onSaved?: (s: Speaker) => void }) {
  const region = useRegion()
  const save = useSaveSpeaker()
  const toast = useToast()
  const users = useUsersQuery()
  const [d, setD] = useState<Draft>(() => draftOf(speaker, region.currency))
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setD(draftOf(speaker, region.currency))
    setTouched(false)
    save.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, speaker?.id])
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const errs: Partial<Record<keyof Draft, string>> = {}
  if (touched) {
    if (d.name.trim().length < 2) errs.name = 'Enter the speaker’s name.'
    if (d.email && !EMAIL_RE.test(d.email.trim())) errs.email = 'Enter a valid email address.'
    if (d.mobile && !isMobile(d.mobile, region.country)) errs.mobile = mobileError(region.country)
    if (d.fee && !(Number(d.fee) >= 0)) errs.fee = 'Enter a positive amount.'
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    if (d.name.trim().length < 2) return
    const input: Partial<SpeakerInput> = {
      ...d,
      userId: d.kind === 'internal' ? d.userId || null : null,
      fee: d.fee === '' ? null : Number(d.fee),
    }
    save.mutate(
      { id: speaker?.id, input },
      {
        onSuccess: (s) => {
          toast.success(speaker ? 'Speaker saved' : 'Speaker added', s.name)
          onSaved?.(s)
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
      title={speaker ? `Edit ${speaker.name}` : 'New speaker'}
      description="The company’s speaker directory: every event picks speakers from here."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="speaker-form" loading={save.isPending}>
            {speaker ? 'Save speaker' : 'Add speaker'}
          </Button>
        </>
      }
    >
      <form id="speaker-form" noValidate onSubmit={submit} className="space-y-4">
        <Field id="sp-name" label="Name" required error={errs.name}>
          <TextInput id="sp-name" value={d.name} invalid={!!errs.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="sp-title" label="Title">
            <TextInput id="sp-title" value={d.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field id="sp-company" label="Company">
            <TextInput id="sp-company" value={d.company} onChange={(e) => set('company', e.target.value)} />
          </Field>
          <Field id="sp-email" label="Email" error={errs.email}>
            <TextInput id="sp-email" type="email" value={d.email} invalid={!!errs.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field id="sp-mobile" label="Mobile" error={errs.mobile}>
            <TextInput id="sp-mobile" inputMode="tel" value={d.mobile} invalid={!!errs.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field id="sp-kind" label="Internal or external">
            <SelectInput id="sp-kind" value={d.kind} onChange={(e) => set('kind', e.target.value as SpeakerKind)}>
              <option value="external">External</option>
              <option value="internal">Internal (employee)</option>
            </SelectInput>
          </Field>
          {d.kind === 'internal' && (
            <Field id="sp-user" label="Employee">
              <SelectInput id="sp-user" value={d.userId} onChange={(e) => set('userId', e.target.value)}>
                <option value="">Not linked</option>
                {(users.data ?? [])
                  .filter((u) => u.active !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.title || u.role}
                    </option>
                  ))}
              </SelectInput>
            </Field>
          )}
        </div>
        <Field id="sp-topics" label="Topics" hint="Comma-separated, e.g. AI, Retail, Logistics.">
          <TagsInput key={`${speaker?.id ?? 'new'}-${open}`} id="sp-topics" value={d.topics} onChange={(v) => set('topics', v)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="sp-linkedin" label="LinkedIn">
            <TextInput id="sp-linkedin" type="url" value={d.linkedinUrl} placeholder="https://www.linkedin.com/in/…" onChange={(e) => set('linkedinUrl', e.target.value)} />
          </Field>
          <PhotoField value={d.photoUrl} onChange={(v) => set('photoUrl', v)} />
          <Field id="sp-fee" label="Fee (optional)" error={errs.fee}>
            <TextInput id="sp-fee" inputMode="decimal" value={d.fee} invalid={!!errs.fee} onChange={(e) => set('fee', e.target.value)} />
          </Field>
          <Field id="sp-fee-currency" label="Fee currency">
            <CurrencySelect id="sp-fee-currency" value={d.feeCurrency} onChange={(v) => set('feeCurrency', v)} />
          </Field>
        </div>
        <Field id="sp-bio" label="Bio">
          <TextArea id="sp-bio" rows={3} value={d.bio} onChange={(e) => set('bio', e.target.value)} />
        </Field>
        <Field id="sp-notes" label="Internal notes">
          <TextArea id="sp-notes" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
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

/** Photo: a URL, or an image from Brand Assets (Marketing) when the plan and role have it. */
function PhotoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ent = useEntitlements()
  const assets = useBrandAssets({ kind: 'image', status: 'active' }, ent.hasModule('marketing'))
  const images = (assets.data ?? []).filter((a) => a.url)
  const fromAssets = value.startsWith('data:')
  return (
    <Field id="sp-photo" label="Photo" hint={images.length ? 'A URL, or pick an image from Brand Assets.' : undefined}>
      <div className="flex gap-2">
        {fromAssets ? (
          <>
            <img src={value} alt="" className="size-9 rounded-full object-cover" />
            <Button variant="ghost" size="sm" onClick={() => onChange('')}>
              Remove photo
            </Button>
          </>
        ) : (
          <TextInput id="sp-photo" type="url" value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />
        )}
        {images.length > 0 && (
          <SelectInput aria-label="Brand asset image" className="w-36" value="" onChange={(e) => e.target.value && onChange(images.find((a) => a.id === e.target.value)?.url ?? '')}>
            <option value="">Brand Assets…</option>
            {images.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        )}
      </div>
    </Field>
  )
}
