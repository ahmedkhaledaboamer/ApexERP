import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, BarChart3, Clock, Columns3, Eye, EyeOff, ShieldCheck, Sparkles, Users } from 'lucide-react'
import type { Session } from '@/shared/types'
import { PATHS } from '@/app/paths'
import { login, loginTwoFactor } from '@/modules/auth/api/authApi'
import { isTwoFactorChallenge } from '@/modules/auth/types'
import { ApiError, SESSION_EXPIRED_MESSAGE } from '@/shared/lib/apiError'
import { DemoOtpHint, OtpInput } from '@/modules/auth/components/OtpInput'
import { Button } from '@/shared/components/ui/Button'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'
import { publicWorkspaceLoaded } from '@/store/tenantSlice'
import { DEMO_PASSWORD as MOCK_DEMO_PASSWORD } from '@/shared/lib/constants'

/** The mock's demo password; '' in a real-backend build (inline env check, so the bundler drops the constant). */
const DEMO_PASSWORD = import.meta.env.VITE_API_MOCK !== 'false' ? MOCK_DEMO_PASSWORD : ''
import { currentWorkspace, setWorkspace } from '@/shared/lib/tenantContext'
import { getDevAccounts } from '@/modules/tenancy/api'
import { DEV_TENANT_TOOLS } from '@/modules/tenancy/dev'
import { useBranding } from '@/modules/tenancy/hooks'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'

export default function LoginPage() {
  const signedInAlready = useAppSelector((s) => s.auth.session !== null)
  const location = useLocation()
  // Signed in (also right after sign-in, which may render before `finish` navigates): go where the
  // user was heading (state.from, e.g. after "Your session expired"), else the dashboard.
  if (signedInAlready) return <Navigate to={redirectTarget(location.state)} replace />
  return <LoginScreen />
}

function LoginScreen() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  /** Set when the password was right but the account has 2FA: the OTP step shows instead. */
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const idleMinutes = idleSignOutMinutes(location.state)
  const sessionExpired = idleMinutes === null && expiredSignOut(location.state)
  const branding = useBranding()

  function finish(session: Session) {
    // Signed in on the bare domain: the workspace follows the account from now on.
    if (!currentWorkspace()) setWorkspace(session.tenant.subdomain)
    dispatch(signedIn(session))
    navigate(redirectTarget(location.state), { replace: true })
  }

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (result) => {
      if (isTwoFactorChallenge(result)) setChallengeId(result.challengeId)
      else finish(result)
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const errors = validate(email, password)
    setFieldErrors(errors)
    if (!errors.email && !errors.password) mutation.mutate()
  }

  const devAccounts = useQuery({ queryKey: ['dev-accounts'], queryFn: getDevAccounts, enabled: DEV_TENANT_TOOLS, staleTime: 60_000 })

  function fillDemo(email: string) {
    const group = devAccounts.data?.find((g) => g.users.some((u) => u.email === email))
    // Opened on another workspace's address: move to the account's workspace so sign-in matches it.
    const workspace = currentWorkspace()
    if (group && workspace && workspace !== group.company.subdomain) {
      setWorkspace(group.company.subdomain)
      dispatch(publicWorkspaceLoaded(group.company))
    }
    setEmail(email)
    setPassword(DEMO_PASSWORD)
    setFieldErrors({})
    mutation.reset()
  }

  const workspaceRequired = mutation.error instanceof ApiError && mutation.error.code === 'workspace_required'

  return (
    <main className="grid min-h-full bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Form */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center gap-2">
          <TenantLogo id="signin-tenant-logo" size="sm" branding={branding} />
          <span className="text-[0.8125rem] font-semibold">{branding.displayName}</span>
        </div>

        {challengeId ? (
          <TwoFactorStep
            challengeId={challengeId}
            email={email}
            onSignedIn={finish}
            onBack={() => {
              setChallengeId(null)
              setPassword('')
              mutation.reset()
            }}
          />
        ) : (
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Welcome back</h1>
          <p className="mt-1.5 text-[0.8125rem] text-muted">Sign in to manage leads, customers and delivery.</p>

          {idleMinutes !== null && (
            <p role="status" className="mt-6 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
              You were signed out after {idleMinutes} minute{idleMinutes === 1 ? '' : 's'} of inactivity. Sign in again to continue.
            </p>
          )}

          {sessionExpired && (
            <p id="session-expired-notice" role="status" className="mt-6 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-500">
              <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {SESSION_EXPIRED_MESSAGE}
            </p>
          )}

          <form noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
            <Field id="email" label="Work email" error={fieldErrors.email}>
              <TextInput
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                placeholder="you@company.com"
                className="h-10"
              />
            </Field>

            <Field id="password" label="Password" error={fieldErrors.password}>
              <div className="relative">
                <TextInput
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? 'password-error' : undefined}
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
            </Field>

            {mutation.isError && (
              <p role="alert" className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
                {workspaceRequired
                  ? 'This email is used in more than one workspace. Open your workspace’s own address (for example yourcompany.apexcrm.app) and sign in there.'
                  : mutation.error.message}
              </p>
            )}

            <Button type="submit" size="lg" loading={mutation.isPending} className="w-full">
              {mutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[0.8125rem] text-muted">
            New to {PRODUCT_NAME}?{' '}
            <Link to={PATHS.signup} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
              Create a workspace
            </Link>
          </p>

          {DEV_TENANT_TOOLS && (
            <div className="mt-8 rounded-lg border border-dashed border-line-strong p-3">
              <Field id="demo-account" label="Demo: sign in as" hint={`Password: ${DEMO_PASSWORD}`}>
                <SelectInput id="demo-account" defaultValue="" disabled={!devAccounts.data} onChange={(e) => fillDemo(e.target.value)}>
                  <option value="" disabled>
                    {devAccounts.isPending ? 'Loading accounts…' : 'Choose an account…'}
                  </option>
                  {devAccounts.data?.map((group) => (
                    <optgroup key={group.company.id} label={`${group.company.branding.displayName} (${group.company.subdomain})`}>
                      {group.users.map((u) => (
                        <option key={u.id} value={u.email}>
                          {u.name} · {u.role}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </SelectInput>
              </Field>
              <Link to={PATHS.platformLogin} className="mt-3 inline-block text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
                Platform console
              </Link>
            </div>
          )}
        </div>
        )}

        <p className="text-xs text-subtle">
          © {new Date().getFullYear()} {branding.displayName === PRODUCT_NAME ? PRODUCT_NAME : `${branding.displayName} · ${PRODUCT_NAME}`}
        </p>
      </div>

      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#0d0b1a] p-12 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute -top-40 -end-40 size-[36rem] rounded-full opacity-60 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-brand-600) 0%, transparent 65%)' }}
        />
        <div
          aria-hidden
          className="absolute -bottom-48 -start-24 size-[32rem] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-accent-600) 0%, transparent 65%)' }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        <div className="relative max-w-md">
          <p className="text-xs font-medium tracking-wide text-brand-300 uppercase">{PRODUCT_NAME}</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.02em] text-white">
            The whole sales journey, from first call to delivered project.
          </h2>
        </div>

        <ul className="relative grid max-w-md gap-3">
          {[
            { icon: Users, title: 'Leads that never slip', body: 'Follow-ups, duplicates and Do Not Contact handled for you.' },
            { icon: Columns3, title: 'A pipeline you can drag', body: 'Every stage enforces the next step before it moves.' },
            { icon: BarChart3, title: 'Numbers without re-entry', body: 'Dashboards and reports read the same live data.' },
            { icon: Sparkles, title: 'AI that drafts, not decides', body: 'Emails and summaries, always confirmed by you.' },
          ].map((f) => (
            <li key={f.title} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-200">
                <f.icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-[0.8125rem] font-medium text-white">{f.title}</p>
                <p className="mt-0.5 text-xs text-white/55">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}

/** Second sign-in step for accounts with two-factor authentication. */
function TwoFactorStep({
  challengeId,
  email,
  onSignedIn,
  onBack,
}: {
  challengeId: string
  email: string
  onSignedIn: (session: Session) => void
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const verify = useMutation({
    mutationFn: (value: string) => loginTwoFactor(challengeId, value),
    onSuccess: onSignedIn,
    onError: (err) => {
      setCode('')
      // Expired or too many attempts: the password step has to start again.
      if (mustRestart(err)) setLocalError(err.message)
    },
  })

  function submit(value: string) {
    setLocalError(null)
    if (useRecovery) {
      if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(value.trim())) {
        setLocalError('Recovery codes look like abcd-1234.')
        return
      }
    } else if (value.length !== 6) {
      setLocalError('Enter all 6 digits.')
      return
    }
    verify.mutate(value.trim())
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit(useRecovery ? recovery : code)
  }

  const error = localError ?? (verify.isError ? verify.error.message : null)
  const restart = verify.isError && mustRestart(verify.error)

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
      <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
        <ShieldCheck className="size-5" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Two-step verification</h1>
      <p className="mt-1.5 text-[0.8125rem] text-muted">
        {useRecovery ? (
          'Enter one of the recovery codes you saved when you turned on 2FA. Each code works once.'
        ) : (
          <>
            Enter the 6-digit code from your authenticator app for <span className="font-medium text-ink">{email}</span>.
          </>
        )}
      </p>

      <form noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
        {useRecovery ? (
          <Field id="recovery-code" label="Recovery code" error={error ?? undefined}>
            <TextInput
              id="recovery-code"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="abcd-1234"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              invalid={!!error}
              className="h-10 font-mono"
            />
          </Field>
        ) : (
          <div>
            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v)
                setLocalError(null)
              }}
              onComplete={(v) => !verify.isPending && submit(v)}
              invalid={!!error}
              disabled={verify.isPending || restart}
              autoFocus
              describedBy={error ? 'otp-error' : undefined}
            />
            {error && (
              <p id="otp-error" role="alert" className="mt-2 text-xs text-danger-600 dark:text-danger-500">
                {error}
              </p>
            )}
          </div>
        )}

        {!useRecovery && <DemoOtpHint onUse={(c) => {
          setCode(c)
          submit(c)
        }} />}

        {restart ? (
          <Button size="lg" className="w-full" onClick={onBack}>
            Start again
          </Button>
        ) : (
          <Button type="submit" size="lg" loading={verify.isPending} className="w-full">
            {verify.isPending ? 'Verifying…' : 'Verify and sign in'}
          </Button>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[0.8125rem]">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
          Use a different account
        </button>
        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v)
            setLocalError(null)
            verify.reset()
          }}
          className="font-medium text-brand-600 hover:underline dark:text-brand-300"
        >
          {useRecovery ? 'Use an authenticator code' : 'Use a recovery code'}
        </button>
      </div>
    </div>
  )
}

function mustRestart(err: Error): boolean {
  return err instanceof ApiError && (err.status === 410 || err.status === 429 || err.status === 403)
}

function validate(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {}
  if (!email.trim()) errors.email = 'Enter your work email.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'That doesn’t look like an email address.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

/** Set by the idle session timeout (modules/account/components/SessionTimeout). */
function idleSignOutMinutes(state: unknown): number | null {
  if (state && typeof state === 'object' && 'idleMinutes' in state && typeof state.idleMinutes === 'number') return state.idleMinutes
  return null
}

/** Set when a request found the session expired (app/SessionExpiryHost). */
function expiredSignOut(state: unknown): boolean {
  return !!state && typeof state === 'object' && 'reason' in state && state.reason === 'expired'
}

function redirectTarget(state: unknown): string {
  // Only an in-app path (never another origin, never back to /login: no redirect loops).
  if (state && typeof state === 'object' && 'from' in state && typeof state.from === 'string') {
    const from = state.from
    if (from.startsWith('/') && !from.startsWith('//') && !/^\/login(?:[/?#]|$)/.test(from)) return from
  }
  return PATHS.dashboard
}
