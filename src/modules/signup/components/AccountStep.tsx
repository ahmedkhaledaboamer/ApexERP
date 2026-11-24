import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, Info, Loader2, XCircle } from 'lucide-react'
import type { CountryCode } from '@/modules/tenancy/types'
import type { SignupStartInput, SignupStarted, SubdomainAvailability } from '@/modules/signup/types'
import { checkSubdomain, useStartSignup } from '@/modules/signup/api'
import { COUNTRY_CODES, COUNTRY_DEFAULTS, COUNTRY_NAMES } from '@/modules/tenancy/regionDefaults'
import { subdomainProblem, suggestSubdomain } from '@/modules/tenancy/subdomain'
import { isMobile, mobileError, mobileSample, normalizeMobile } from '@/shared/lib/phone'
import { signupPasswordProblem } from '@/shared/lib/passwordStrength'
import { ApiError } from '@/shared/lib/apiError'
import { ROOT_DOMAIN } from '@/shared/lib/tenantContext'
import { cn } from '@/shared/lib/utils'
import { PATHS } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Checkbox, Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { ErrorAlert, PasswordMeter, StepHeading } from '@/modules/signup/components/SignupParts'
import { ImageField } from '@/modules/settings/branding/ImageField'
import { LOGO_MAX_BYTES, formatBytes } from '@/modules/settings/branding'

export type AccountValues = Required<SignupStartInput>
type Errors = Partial<Record<keyof AccountValues, string>>

export const EMPTY_ACCOUNT: AccountValues = {
  companyName: '',
  subdomain: '',
  country: 'AE',
  language: 'en',
  adminName: '',
  adminEmail: '',
  mobile: '',
  password: '',
  acceptTerms: false,
  logo: null,
  website: '',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function validate(v: AccountValues): Errors {
  const e: Errors = {}
  if (v.companyName.trim().length < 2) e.companyName = 'Enter your company name.'
  const sub = subdomainProblem(v.subdomain)
  if (sub) e.subdomain = sub
  if (v.adminName.trim().length < 2) e.adminName = 'Enter your full name.'
  if (!EMAIL.test(v.adminEmail.trim())) e.adminEmail = 'Enter a valid work email.'
  if (!isMobile(v.mobile, v.country)) e.mobile = mobileError(v.country)
  const pw = signupPasswordProblem(v.password)
  if (pw) e.password = pw
  if (!v.acceptTerms) e.acceptTerms = 'Accept the Terms of Service and Privacy Policy to continue.'
  return e
}

/** "Fri–Sat weekend, week starts Sunday". */
function workWeekText(country: CountryCode): string {
  const d = COUNTRY_DEFAULTS[country]
  const weekend = d.weekend.map((n) => WEEKDAYS[n].slice(0, 3)).join('–')
  return `${weekend} weekend, week starts ${WEEKDAYS[d.weekStartsOn]}`
}

type Availability = { state: 'idle' } | { state: 'checking' } | { state: 'done'; result: SubdomainAvailability } | { state: 'error' }

/** Debounced live check of the workspace address against the server. */
function useAvailability(subdomain: string): Availability {
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' })
  useEffect(() => {
    const value = subdomain.trim().toLowerCase()
    if (!value || subdomainProblem(value)) {
      setAvailability({ state: 'idle' })
      return
    }
    setAvailability({ state: 'checking' })
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      checkSubdomain(value, ctrl.signal)
        .then((result) => setAvailability({ state: 'done', result }))
        .catch(() => {
          if (!ctrl.signal.aborted) setAvailability({ state: 'error' })
        })
    }, 350)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [subdomain])
  return availability
}

interface AccountStepProps {
  values: AccountValues
  onChange: (values: AccountValues) => void
  subdomainEdited: boolean
  onSubdomainEdited: () => void
  onStarted: (started: SignupStarted) => void
}

/** Step 1: company, workspace address, region, the admin's account and terms. */
export function AccountStep({ values, onChange, subdomainEdited, onSubdomainEdited, onStarted }: AccountStepProps) {
  const [errors, setErrors] = useState<Errors>({})
  const [showPassword, setShowPassword] = useState(false)
  const start = useStartSignup()
  const availability = useAvailability(values.subdomain)

  function change<K extends keyof AccountValues>(key: K, value: AccountValues[K]) {
    const next = { ...values, [key]: value }
    if (key === 'companyName' && !subdomainEdited) next.subdomain = suggestSubdomain(String(value))
    onChange(next)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    if (start.isError) start.reset()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(values)
    if (availability.state === 'done' && !availability.result.available && !found.subdomain) {
      found.subdomain = availability.result.reason ?? 'That address is taken. Choose another.'
    }
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      document.getElementById(`su-${first}`)?.focus()
      return
    }
    start.mutate(
      {
        ...values,
        companyName: values.companyName.trim(),
        subdomain: values.subdomain.trim().toLowerCase(),
        adminName: values.adminName.trim(),
        adminEmail: values.adminEmail.trim().toLowerCase(),
        mobile: normalizeMobile(values.mobile, values.country) ?? values.mobile,
      },
      {
        onSuccess: onStarted,
        onError: (error) => {
          // Address problems found by the server belong on the address field.
          if (error instanceof ApiError && (error.code === 'subdomain_taken' || error.code === 'invalid_subdomain')) {
            setErrors((e) => ({ ...e, subdomain: error.message }))
            document.getElementById('su-subdomain')?.focus()
          }
        },
      },
    )
  }

  const region = COUNTRY_DEFAULTS[values.country]
  const err = start.error
  const emailTaken = err instanceof ApiError && err.status === 409 && err.code === 'email_taken'
  const rateLimited = err instanceof ApiError && err.status === 429
  const onField = err instanceof ApiError && (err.code === 'subdomain_taken' || err.code === 'invalid_subdomain')

  const text = (
    key: 'companyName' | 'adminName' | 'adminEmail',
    label: string,
    props: { type?: string; autoComplete?: string; placeholder?: string } = {},
  ) => (
    <Field id={`su-${key}`} label={label} error={errors[key]} required>
      <TextInput
        id={`su-${key}`}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        placeholder={props.placeholder}
        value={values[key]}
        invalid={!!errors[key]}
        aria-describedby={errors[key] ? `su-${key}-error` : undefined}
        onChange={(e) => change(key, e.target.value)}
        className="h-10"
      />
    </Field>
  )

  return (
    <div>
      <StepHeading
        title="Create your workspace"
        description="You’ll be the Company Admin of the new workspace and can invite your team once it’s ready."
      />

      <form noValidate onSubmit={onSubmit} className="mt-8 space-y-5">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Company</legend>
          {text('companyName', 'Company name', { autoComplete: 'organization', placeholder: 'e.g. Gulf Star Trading' })}

          <Field id="su-subdomain" label="Workspace address" error={errors.subdomain} required>
            <div className="flex items-stretch">
              <TextInput
                id="su-subdomain"
                value={values.subdomain}
                invalid={!!errors.subdomain || (availability.state === 'done' && !availability.result.available)}
                aria-describedby="su-subdomain-status"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="yourcompany"
                onChange={(e) => {
                  onSubdomainEdited()
                  change('subdomain', e.target.value.toLowerCase().replace(/\s+/g, '-'))
                }}
                className="h-10 rounded-e-none"
              />
              <span className="flex items-center rounded-e-lg border border-s-0 border-line-strong bg-sunken px-3 text-[0.8125rem] text-muted">
                .{ROOT_DOMAIN}
              </span>
            </div>
            {!errors.subdomain && <SubdomainStatus id="su-subdomain-status" value={values.subdomain} availability={availability} />}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
              <Info className="size-3.5 shrink-0" aria-hidden />
              Your address can’t be changed later.
            </p>
          </Field>

          <div className="rounded-lg border border-line p-3.5">
            <ImageField
              kind="logoLight"
              title="Company logo (optional)"
              hint={`PNG, JPG, SVG or WebP up to ${formatBytes(LOGO_MAX_BYTES)}. Shown in the header, on the sign-in page and on your documents. You can change it later in Settings › Branding.`}
              value={values.logo}
              surface="light"
              disabled={start.isPending}
              onChange={(url) => change('logo', url)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="su-country" label="Country" required>
              <SelectInput
                id="su-country"
                value={values.country}
                onChange={(e) => change('country', e.target.value as CountryCode)}
                className="h-10"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_NAMES[c].name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field id="su-language" label="Language" hint="More languages are coming.">
              <SelectInput id="su-language" value={values.language} onChange={() => change('language', 'en')} className="h-10">
                <option value="en">English</option>
              </SelectInput>
            </Field>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-canvas px-3.5 py-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted">Currency</dt>
              <dd className="mt-0.5 font-medium text-ink">{region.currency}</dd>
            </div>
            <div>
              <dt className="text-muted">Time zone</dt>
              <dd className="mt-0.5 font-medium break-words text-ink">{region.timezone}</dd>
            </div>
            <div>
              <dt className="text-muted">VAT</dt>
              <dd className="mt-0.5 font-medium text-ink">{region.vatPct}%</dd>
            </div>
            <div>
              <dt className="text-muted">Work week</dt>
              <dd className="mt-0.5 font-medium text-ink">{workWeekText(values.country)}</dd>
            </div>
            <p className="col-span-full text-subtle">Prefilled from the country. You can change them later in Settings.</p>
          </dl>
        </fieldset>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="sr-only">Your account</legend>
          <p aria-hidden className="text-xs font-medium tracking-wide text-muted uppercase">
            Your account
          </p>
          {text('adminName', 'Full name', { autoComplete: 'name' })}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {text('adminEmail', 'Work email', { type: 'email', autoComplete: 'email', placeholder: 'you@company.com' })}
            <Field id="su-mobile" label="Mobile" error={errors.mobile} required>
              <TextInput
                id="su-mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={mobileSample(values.country)}
                value={values.mobile}
                invalid={!!errors.mobile}
                aria-describedby={errors.mobile ? 'su-mobile-error' : undefined}
                onChange={(e) => change('mobile', e.target.value)}
                className="h-10"
              />
            </Field>
          </div>

          <Field id="su-password" label="Password" error={errors.password} required>
            <div className="relative">
              <TextInput
                id="su-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={values.password}
                invalid={!!errors.password}
                aria-describedby={errors.password ? 'su-password-error' : 'su-password-meter'}
                onChange={(e) => change('password', e.target.value)}
                className="h-10 pe-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-subtle hover:text-ink"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <PasswordMeter id="su-password-meter" password={values.password} />
          </Field>

          {/* Honeypot: invisible to people and assistive tech; bots that fill every field give themselves away. */}
          <div aria-hidden="true" className="pointer-events-none absolute -start-[625rem] size-px overflow-hidden opacity-0">
            <label htmlFor="su-website">Website</label>
            <input
              id="su-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={values.website}
              onChange={(e) => change('website', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="su-acceptTerms" className="flex items-start gap-2.5 text-[0.8125rem] text-ink-2">
              <Checkbox
                id="su-acceptTerms"
                checked={values.acceptTerms}
                onChange={(e) => change('acceptTerms', e.target.checked)}
                aria-invalid={!!errors.acceptTerms || undefined}
                aria-describedby={errors.acceptTerms ? 'su-acceptTerms-error' : undefined}
                className="mt-0.5"
              />
              <span>
                I accept the{' '}
                <Link to="/legal/terms" target="_blank" className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to="/legal/privacy" target="_blank" className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            {errors.acceptTerms && (
              <p id="su-acceptTerms-error" className="mt-1.5 text-xs text-danger-600 dark:text-danger-500">
                {errors.acceptTerms}
              </p>
            )}
          </div>
        </fieldset>

        {start.isError && !onField && (
          <ErrorAlert>
            {emailTaken ? (
              <>
                {err.message || 'An account with this email already exists.'}{' '}
                <Link to={PATHS.login} className="font-medium underline">
                  Sign in instead
                </Link>
              </>
            ) : rateLimited ? (
              <>{err.message || 'Too many sign-up attempts. Wait a few minutes and try again.'}</>
            ) : (
              err?.message
            )}
          </ErrorAlert>
        )}

        <Button type="submit" size="lg" loading={start.isPending} className="w-full">
          {start.isPending ? 'Sending your code…' : 'Continue'}
        </Button>
      </form>

      <p className="mt-6 text-center text-[0.8125rem] text-muted">
        Already have a workspace?{' '}
        <Link to={PATHS.login} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
          Sign in
        </Link>
      </p>
    </div>
  )
}

function SubdomainStatus({ id, value, availability }: { id: string; value: string; availability: Availability }) {
  const local = value ? subdomainProblem(value) : null
  let content: ReactNode = <span className="text-muted">Lowercase letters, numbers and hyphens.</span>
  let tone = ''
  if (local) {
    content = local
    tone = 'text-muted'
  } else if (availability.state === 'checking') {
    content = (
      <>
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking availability…
      </>
    )
    tone = 'text-muted'
  } else if (availability.state === 'error') {
    content = 'Couldn’t check availability right now. We’ll check again when you continue.'
    tone = 'text-muted'
  } else if (availability.state === 'done') {
    if (availability.result.available) {
      content = (
        <>
          <CheckCircle2 className="size-3.5" aria-hidden /> {availability.result.subdomain}.{ROOT_DOMAIN} is available
        </>
      )
      tone = 'text-success-700 dark:text-success-500'
    } else {
      content = (
        <>
          <XCircle className="size-3.5" aria-hidden /> {availability.result.reason ?? 'That address is taken.'}
        </>
      )
      tone = 'text-danger-600 dark:text-danger-500'
    }
  }
  return (
    <p id={id} aria-live="polite" className={cn('mt-1.5 flex items-center gap-1.5 text-xs', tone)}>
      {content}
    </p>
  )
}
