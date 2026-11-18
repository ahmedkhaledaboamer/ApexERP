import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Building2, ExternalLink, Landmark, Lock, MapPin, Phone, ReceiptText } from 'lucide-react'
import type { CompanyProfile, CountryCode } from '@/modules/tenancy/types'
import { useTenant } from '@/modules/tenancy/hooks'
import { COUNTRY_CODES, COUNTRY_NAMES } from '@/modules/tenancy/regionDefaults'
import { issuerFor, mapLink, websiteHref } from '@/modules/quotations/lib/company'
import { IssuerFromBlock, QuotationFooter, QuotationLetterhead } from '@/modules/quotations/components/QuotationDocument'
import { mergeProfile, validateProfile, type CompanyProfilePatch, type ProfileErrors } from '@/modules/settings/companyProfile'
import { useCompanyProfileQuery, useSaveCompanyProfile } from '@/modules/settings/hooks/useCompanyProfile'
import { canEditCompanyProfile } from '@/shared/lib/permissions'
import { mobileExample } from '@/shared/lib/phone'
import { TAX_RULES, taxLabel } from '@/shared/lib/taxNumber'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'

/** Form state: everything as typed (strings), plus the bank toggle. */
interface Draft {
  legalName: string
  tradeName: string
  line1: string
  line2: string
  city: string
  region: string
  country: CountryCode
  lat: string
  lng: string
  taxNumber: string
  commercialLicenseNo: string
  phone: string
  email: string
  website: string
  bankOn: boolean
  bankName: string
  accountName: string
  iban: string
  swift: string
}

function toDraft(p: CompanyProfile): Draft {
  return {
    legalName: p.legalName,
    tradeName: p.tradeName,
    line1: p.address.line1,
    line2: p.address.line2,
    city: p.address.city,
    region: p.address.region,
    country: p.address.country,
    lat: p.location ? String(p.location.lat) : '',
    lng: p.location ? String(p.location.lng) : '',
    taxNumber: p.taxNumber,
    commercialLicenseNo: p.commercialLicenseNo,
    phone: p.phone,
    email: p.email,
    website: p.website,
    bankOn: !!p.bank,
    bankName: p.bank?.bankName ?? '',
    accountName: p.bank?.accountName ?? '',
    iban: p.bank?.iban ?? '',
    swift: p.bank?.swift ?? '',
  }
}

function toPatch(d: Draft): CompanyProfilePatch {
  return {
    legalName: d.legalName,
    tradeName: d.tradeName,
    address: { line1: d.line1, line2: d.line2, city: d.city, region: d.region, country: d.country },
    location: d.lat.trim() || d.lng.trim() ? { lat: d.lat, lng: d.lng } : null,
    taxNumber: d.taxNumber,
    commercialLicenseNo: d.commercialLicenseNo,
    phone: d.phone,
    email: d.email,
    website: d.website,
    bank: d.bankOn ? { bankName: d.bankName, accountName: d.accountName, iban: d.iban, swift: d.swift } : null,
  }
}

/** Draft field → validation key. */
const ERROR_KEY: Partial<Record<keyof Draft, string>> = {
  line1: 'address.line1',
  city: 'address.city',
  country: 'address.country',
  lat: 'location.lat',
  lng: 'location.lng',
  bankName: 'bank.bankName',
  accountName: 'bank.accountName',
  iban: 'bank.iban',
  swift: 'bank.swift',
}

/**
 * Settings > Company profile: identity, address, registration, contact and bank details printed
 * on quotations (and future invoices) and offered to templates as {{company.*}}. Company Admin
 * edits; Management sees it read-only. A live quotation header shows the unsaved values.
 */
export default function CompanyProfilePage() {
  const user = useCurrentUser()
  const tenant = useTenant()
  const canEdit = !!user && canEditCompanyProfile(user.role)
  const query = useCompanyProfileQuery()
  const save = useSaveCompanyProfile()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data))
  }, [query.data])

  const country = tenant?.regional.country ?? 'AE'
  const candidate = useMemo(() => (draft && query.data ? mergeProfile(query.data, toPatch(draft)) : null), [draft, query.data])
  const errors: ProfileErrors = useMemo(() => (candidate ? validateProfile(candidate, country) : {}), [candidate, country])
  const dirty = !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(toDraft(query.data))
  const valid = Object.keys(errors).length === 0

  // The preview uses the same issuer function and header/footer components as the quotation itself.
  const previewIssuer = useMemo(() => (tenant ? issuerFor(tenant, candidate ?? tenant.profile) : issuerFor(null)), [tenant, candidate])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }
  function errorFor(key: keyof Draft): string | undefined {
    const k = ERROR_KEY[key] ?? key
    return submitted || touched.has(key) ? errors[k] : undefined
  }
  const blur = (key: keyof Draft) => () => setTouched((t) => (t.has(key) ? t : new Set(t).add(key)))

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!draft || !valid || !canEdit) return
    save.mutate(toPatch(draft), {
      onSuccess: () => {
        setSubmitted(false)
        setTouched(new Set())
        toast.success('Company profile saved', 'Quotations and templates now use these details. Recorded in the audit log.')
      },
      onError: (err) => toast.error('Couldn’t save the company profile', err.message),
    })
  }

  /** Text input bound to a draft field. */
  const input = (key: Exclude<keyof Draft, 'bankOn' | 'country'>, label: string, opts: { required?: boolean; hint?: string; placeholder?: string; type?: string; inputMode?: 'decimal' | 'tel' | 'email' | 'url'; className?: string } = {}) => {
    const id = `cp-${key}`
    const err = errorFor(key)
    return (
      <Field id={id} label={label} required={opts.required} error={err} hint={opts.hint} className={opts.className}>
        <TextInput
          id={id}
          type={opts.type ?? 'text'}
          inputMode={opts.inputMode}
          placeholder={opts.placeholder}
          value={draft ? draft[key] : ''}
          invalid={!!err}
          aria-describedby={err ? `${id}-error` : opts.hint ? `${id}-hint` : undefined}
          onChange={(e) => set(key, e.target.value)}
          onBlur={blur(key)}
        />
      </Field>
    )
  }

  const tax = taxLabel(country)
  const location = candidate?.location && !errors['location.lat'] && !errors['location.lng'] ? candidate.location : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Company profile</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted">
            Printed on every quotation and offered to templates and email signatures as {'{{company.*}}'}. Every change is recorded in the audit log.
          </p>
        </div>
        {!canEdit && (
          <Badge tone="amber" icon={<Lock />}>
            View only
          </Badge>
        )}
      </div>

      {query.isPending || (!draft && !query.isError) ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      ) : query.isError || !draft ? (
        <Card>
          <ErrorState message={query.error?.message ?? 'Couldn’t load the company profile.'} onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_26rem]">
          <form noValidate onSubmit={onSubmit} className="min-w-0 space-y-5">
            {!canEdit && (
              <p role="note" className="rounded-lg border border-line bg-sunken px-4 py-3 text-[0.8125rem] text-muted">
                Only a Company Admin can change the company profile. You can see what prints on quotations.
              </p>
            )}
            <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
              <Section icon={<Building2 />} title="Identity" description="How customers and legal documents name you.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {input('tradeName', 'Trade name', { required: true, hint: 'The letterhead on quotations.' })}
                  {input('legalName', 'Legal name', { required: true, hint: 'As on your commercial registration.' })}
                </div>
              </Section>

              <Section icon={<MapPin />} title="Address & location" description="Printed in the “From” block and the footer.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {input('line1', 'Street address', { required: true, className: 'sm:col-span-2' })}
                  {input('line2', 'Building, floor, office', { className: 'sm:col-span-2' })}
                  {input('city', 'City', { required: true })}
                  {input('region', 'Region / emirate / province')}
                  <Field id="cp-country" label="Country" required error={errorFor('country')}>
                    <SelectInput id="cp-country" value={draft.country} onChange={(e) => set('country', e.target.value as CountryCode)}>
                      {COUNTRY_CODES.map((c) => (
                        <option key={c} value={c}>
                          {COUNTRY_NAMES[c].name}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                  <div className="hidden sm:block" />
                  {input('lat', 'Latitude (optional)', { inputMode: 'decimal', placeholder: 'e.g. 25.1857', hint: 'From -90 to 90.' })}
                  {input('lng', 'Longitude (optional)', { inputMode: 'decimal', placeholder: 'e.g. 55.2727', hint: 'From -180 to 180.' })}
                </div>
                {location && (
                  <a
                    href={mapLink(location)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Open in map
                  </a>
                )}
              </Section>

              <Section
                icon={<ReceiptText />}
                title="Registration"
                description={`The tax label follows your regional settings (${COUNTRY_NAMES[country].name}): ${tax}.`}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {input('taxNumber', tax, { hint: `${TAX_RULES[country].format}. Printed only when set.`, placeholder: TAX_RULES[country].example })}
                  {input('commercialLicenseNo', 'Commercial registration / licence no.')}
                </div>
              </Section>

              <Section icon={<Phone />} title="Contact" description="Shown to customers on quotations and in email signatures.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {input('phone', 'Phone', { type: 'tel', inputMode: 'tel', hint: `Landline or mobile, e.g. ${mobileExample(country)}.` })}
                  {input('email', 'Email', { type: 'email', inputMode: 'email', placeholder: 'hello@yourcompany.com' })}
                  {input('website', 'Website', { inputMode: 'url', placeholder: 'yourcompany.com' })}
                  {draft.website && !errorFor('website') && (
                    <a
                      href={websiteHref(draft.website)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 self-end pb-2 text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300"
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                      Visit website
                    </a>
                  )}
                </div>
              </Section>

              <Section
                icon={<Landmark />}
                title="Bank details"
                description="Optional. Printed in the quotation footer so customers can pay by transfer."
                action={<Switch id="cp-bank" label="Print bank details" checked={draft.bankOn} disabled={!canEdit} onChange={(v) => set('bankOn', v)} />}
              >
                {draft.bankOn ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {input('bankName', 'Bank name', { required: true })}
                    {input('accountName', 'Account name', { required: true })}
                    {input('iban', 'IBAN', { required: true, placeholder: `${country}00 0000 0000 0000 0000 0000` })}
                    {input('swift', 'SWIFT / BIC', { placeholder: '8 or 11 characters' })}
                  </div>
                ) : (
                  <p className="text-[0.8125rem] text-muted">No bank details on quotations.</p>
                )}
              </Section>
            </fieldset>

            {canEdit && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {submitted && !valid && (
                  <p role="alert" className="me-auto text-[0.8125rem] text-danger-600 dark:text-danger-500">
                    Fix the highlighted fields to save.
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!dirty || save.isPending}
                  onClick={() => {
                    if (query.data) setDraft(toDraft(query.data))
                    setTouched(new Set())
                    setSubmitted(false)
                  }}
                >
                  Discard changes
                </Button>
                <Button write type="submit" loading={save.isPending} disabled={!dirty}>
                  Save profile
                </Button>
              </div>
            )}
          </form>

          <aside aria-label="Quotation header preview" className="min-w-0 2xl:sticky 2xl:top-4">
            <Card>
              <CardHeader title="Quotation preview" description={dirty ? 'Showing your unsaved changes.' : 'How the header and footer print today.'} />
              <CardBody>
                <div className="overflow-hidden rounded-lg border border-line bg-white px-5 py-5 text-[0.75rem] leading-relaxed text-zinc-800 shadow-xs">
                  <QuotationLetterhead issuer={previewIssuer} number="QT-0000" />
                  <div className="mt-6">
                    <IssuerFromBlock issuer={previewIssuer} />
                  </div>
                  <div aria-hidden className="my-6 space-y-2">
                    {[80, 62, 70].map((w) => (
                      <span key={w} className="block h-2 rounded bg-zinc-100" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                  <QuotationFooter issuer={previewIssuer} />
                </div>
              </CardBody>
            </Card>
          </aside>
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, description, action, children }: { icon: ReactNode; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} description={description} action={action} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}
