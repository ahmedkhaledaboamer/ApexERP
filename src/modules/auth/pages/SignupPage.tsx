import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Copy, PartyPopper } from 'lucide-react'
import type { Plan } from '@/modules/billing/types'
import type { CheckoutResult, SignupCompleted, SignupStarted } from '@/modules/signup/types'
import { PATHS, workspaceLoginPath } from '@/app/paths'
import { useCompleteSignup, usePlans } from '@/modules/signup/api'
import { planIdLabel } from '@/modules/billing/gating'
import { ROOT_DOMAIN, setWorkspace } from '@/shared/lib/tenantContext'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'
import { Button } from '@/shared/components/ui/Button'
import { AccountStep, EMPTY_ACCOUNT, type AccountValues } from '@/modules/signup/components/AccountStep'
import { VerifyStep } from '@/modules/signup/components/VerifyStep'
import { PlanStep } from '@/modules/signup/components/PlanStep'
import { CheckoutStep } from '@/modules/signup/components/CheckoutStep'
import { ContactSalesStep } from '@/modules/signup/components/ContactSalesStep'
import { ProductShell, StepHeading, Stepper, type StepDef } from '@/modules/signup/components/SignupParts'

/**
 * Public sign-up for Apex CRM (product level, no workspace). A wizard: account → verify email →
 * plan → checkout (paid) or contact sales (Enterprise). Nothing is created until the last step,
 * which returns a Session for the new workspace. State lives in memory only.
 */
export default function SignupPage() {
  // Checked once: finishing the wizard signs in, and the wizard then shows its own welcome screen.
  const signedInAtStart = useAppSelector((s) => s.auth.session !== null)
  const [redirect] = useState(signedInAtStart)
  if (redirect) return <Navigate to={PATHS.dashboard} replace />
  return <SignupWizard />
}

type Step = 'account' | 'verify' | 'plan' | 'checkout' | 'contact' | 'done'

function SignupWizard() {
  const dispatch = useAppDispatch()
  const [step, setStep] = useState<Step>('account')
  const [account, setAccount] = useState<AccountValues>(EMPTY_ACCOUNT)
  const [subdomainEdited, setSubdomainEdited] = useState(false)
  const [started, setStarted] = useState<SignupStarted | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [completed, setCompleted] = useState<SignupCompleted | null>(null)
  const complete = useCompleteSignup()

  function finish(planId: string, checkoutId?: string, continuePlanId?: string) {
    if (!started) return
    complete.mutate(
      { signupId: started.signupId, plan: planId, checkoutId, continuePlanId },
      {
        onSuccess: (result) => {
          // The new workspace's address is where this tab lives from now on; the session
          // transition (signedIn) resets caches and tenant-scoped state.
          setWorkspace(result.tenant.subdomain)
          dispatch(signedIn(result))
          setCompleted(result)
          setStep('done')
        },
      },
    )
  }

  function choosePlan(p: Plan, continuePlanId?: string) {
    setPlan(p)
    complete.reset()
    // Trial: the plan picked for after the trial is sent with it (subscription.selectedPlanId).
    if (p.checkout === 'none') finish(p.id, undefined, continuePlanId)
    else if (p.checkout === 'contact') setStep('contact')
    else setStep('checkout')
  }

  const steps: StepDef[] = [
    { id: 'account', label: 'Account' },
    { id: 'verify', label: 'Verify email' },
    { id: 'plan', label: 'Plan' },
    { id: 'finish', label: plan?.checkout === 'contact' ? 'Contact sales' : plan?.checkout === 'payment' ? 'Payment' : 'Start' },
  ]
  const index = { account: 0, verify: 1, plan: 2, checkout: 3, contact: 3, done: 4 }[step]
  const completeError = complete.isError ? complete.error.message : null

  return (
    <ProductShell
      wide={step === 'plan'}
      aside={
        step !== 'done' && (
          <p className="text-[0.8125rem] text-muted">
            Have a workspace?{' '}
            <Link to={PATHS.login} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
              Sign in
            </Link>
          </p>
        )
      }
    >
      {step !== 'done' && (
        <div className="mb-10">
          <Stepper steps={steps} current={index} />
        </div>
      )}

      {step === 'account' && (
        <AccountStep
          values={account}
          onChange={setAccount}
          subdomainEdited={subdomainEdited}
          onSubdomainEdited={() => setSubdomainEdited(true)}
          onStarted={(s) => {
            setStarted(s)
            setStep('verify')
          }}
        />
      )}

      {step === 'verify' && started && (
        <VerifyStep
          started={started}
          onResent={setStarted}
          onVerified={() => setStep('plan')}
          onBack={() => {
            // Editing the details starts a new sign-up (and a new code) on Continue.
            setStarted(null)
            setStep('account')
          }}
        />
      )}

      {step === 'plan' && <PlanStep onChoose={choosePlan} completing={complete.isPending} completeError={completeError} />}

      {step === 'checkout' && started && plan && plan.checkout === 'payment' && (
        <CheckoutStep
          signupId={started.signupId}
          plan={plan}
          completing={complete.isPending}
          completeError={completeError}
          onBack={() => setStep('plan')}
          onPaid={(paid: CheckoutResult) => finish(plan.id, paid.checkoutId)}
        />
      )}

      {step === 'contact' && (
        <ContactSalesStep
          initial={{ companyName: account.companyName, name: account.adminName, email: account.adminEmail, country: account.country }}
          onBack={() => setStep('plan')}
        />
      )}

      {step === 'done' && completed && <WelcomeScreen completed={completed} />}
    </ProductShell>
  )
}

function WelcomeScreen({ completed }: { completed: SignupCompleted }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const sub = completed.tenant.subdomain
  const address = `${sub}.${ROOT_DOMAIN}`
  const sub_ = completed.subscription
  const plans = usePlans()
  const planName = plans.data?.find((p) => p.id === sub_.planId)?.name ?? planIdLabel(sub_.planId)
  const trialDays = sub_.trialEndsAt ? Math.max(0, Math.ceil((new Date(sub_.trialEndsAt).getTime() - Date.now()) / 86_400_000)) : null

  function copy() {
    void navigator.clipboard?.writeText(`https://${address}`).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="text-center">
      <span className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
        <PartyPopper className="size-6" aria-hidden />
      </span>
      <StepHeading
        title={`${completed.tenant.name} is ready`}
        description={
          <>
            You’re signed in as the Company Admin on the {planName} plan
            {trialDays !== null ? ` (${trialDays} days of trial left)` : ''}.
          </>
        }
      />

      <div className="mx-auto mt-8 max-w-md rounded-card border border-line bg-canvas p-4 text-start">
        <p className="text-xs font-medium text-muted">Your workspace address</p>
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-ink">{address}</p>
          <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy workspace address">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Bookmark it and share it with your team: they sign in at{' '}
          <Link to={workspaceLoginPath(sub)} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
            your workspace’s sign-in page
          </Link>
          .
        </p>
      </div>

      <Button size="lg" className="mt-8" onClick={() => navigate(PATHS.dashboard, { replace: true })}>
        Go to your dashboard
        <ArrowRight className="rtl:rotate-180" aria-hidden />
      </Button>
      <p className="mt-3 text-xs text-muted">A setup checklist on the dashboard walks you through the next steps.</p>
    </div>
  )
}
