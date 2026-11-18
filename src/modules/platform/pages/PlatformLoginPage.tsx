import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ShieldHalf } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { platformLogin } from '@/modules/platform/api'
import { platformHome, platformPermissions } from '@/modules/platform/permissions'
import { DEV_TENANT_TOOLS } from '@/modules/tenancy/dev'
import { PRODUCT_NAME } from '@/modules/tenancy/branding'
import { DEMO_PASSWORD } from '@/shared/lib/constants'
import { Button } from '@/shared/components/ui/Button'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { platformSignedIn } from '@/store/tenantSlice'

const DEMO_PLATFORM_ACCOUNTS = [
  { email: 'owner@apexcrm.app', role: 'Platform Owner' },
  { email: 'support@apexcrm.app', role: 'Platform Support' },
  { email: 'billing@apexcrm.app', role: 'Platform Billing' },
] as const

/** Sign-in for platform operators. Separate from workspace sign-in; never touches tenant data. */
export default function PlatformLoginPage() {
  const platform = useAppSelector((s) => s.tenant.platform)
  if (platform) return <Navigate to={platformHome(platformPermissions(platform.platformUser))} replace />
  return <PlatformLoginForm />
}

function PlatformLoginForm() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => platformLogin(email.trim(), password),
    onSuccess: (session) => {
      dispatch(platformSignedIn(session))
      // Back to the console page that asked for sign-in, else the first page the role may open.
      const target = from && from.startsWith('/platform') && from !== PATHS.platformLogin ? from : platformHome(platformPermissions(session.platformUser))
      navigate(target, { replace: true })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.')
      return
    }
    setFormError(null)
    mutation.mutate()
  }

  const error = formError ?? (mutation.isError ? mutation.error.message : null)

  return (
    <main className="grid min-h-full place-items-center bg-canvas px-4 py-16">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-soft">
        <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-line bg-sunken text-ink-2">
          <ShieldHalf className="size-5" aria-hidden />
        </span>
        <h1 className="text-[1.5rem] font-semibold tracking-[-0.02em]">Platform console</h1>
        <p className="mt-1.5 text-[0.8125rem] text-muted">{PRODUCT_NAME} operators only. Workspace users sign in on their workspace’s address.</p>

        <form id="platform-login-form" aria-label="Platform sign-in" noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field id="platform-email" label="Email">
            <TextInput id="platform-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
          </Field>
          <Field id="platform-password" label="Password">
            <TextInput
              id="platform-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
          </Field>
          {error && (
            <p role="alert" id="platform-login-error" className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
              {error}
            </p>
          )}
          <Button id="platform-login-submit" type="submit" size="lg" loading={mutation.isPending} className="w-full">
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {DEV_TENANT_TOOLS && (
          <div className="mt-8 rounded-lg border border-dashed border-line-strong p-3">
            <Field id="demo-platform" label="Demo: platform account" hint={`Password: ${DEMO_PASSWORD}`}>
              <SelectInput
                id="demo-platform"
                defaultValue=""
                onChange={(e) => {
                  setEmail(e.target.value)
                  setPassword(DEMO_PASSWORD)
                  setFormError(null)
                  mutation.reset()
                }}
              >
                <option value="" disabled>
                  Choose an account…
                </option>
                {DEMO_PLATFORM_ACCOUNTS.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.role} · {a.email}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        )}

        <p className="mt-8 text-center text-[0.8125rem]">
          <Link to={PATHS.login} className="text-muted hover:text-ink">
            Workspace sign-in
          </Link>
        </p>
      </div>
    </main>
  )
}
