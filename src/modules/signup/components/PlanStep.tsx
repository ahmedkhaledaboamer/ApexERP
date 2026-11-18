import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { Plan } from '@/modules/billing/types'
import { usePlans } from '@/modules/signup/api'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, SelectInput } from '@/shared/components/form/Field'
import { PlanCard, formatPlanPrice } from '@/modules/signup/components/PlanCard'
import { ErrorAlert, StepHeading } from '@/modules/signup/components/SignupParts'

interface PlanStepProps {
  /** `continuePlanId`: Trial only, the paid plan the trial continues on. */
  onChoose: (plan: Plan, continuePlanId?: string) => void
  /** Trial completes right here; this is its pending state. */
  completing: boolean
  completeError: string | null
  onBack?: () => void
}

function ctaLabel(plan: Plan): string {
  if (plan.checkout === 'none') return 'Start free trial – no card needed'
  if (plan.checkout === 'contact') return 'Contact sales'
  return `Choose ${plan.name}`
}

/** Step 3: pick a plan. Trial finishes sign-up, paid plans go to checkout, Enterprise to sales. */
export function PlanStep({ onChoose, completing, completeError, onBack }: PlanStepProps) {
  const query = usePlans()
  // Plans are data from the API (GET /public/plans), ordered by rank.
  const plans = query.data ? [...query.data].filter((p) => p.active).sort((a, b) => a.rank - b.rank) : null
  // "Most popular": the top self-service paid plan.
  const featuredId = plans?.filter((p) => p.checkout === 'payment').at(-1)?.id
  const paid = plans?.filter((p) => p.checkout === 'payment') ?? []
  const [trial, setTrial] = useState<Plan | null>(null)
  const [continueId, setContinueId] = useState('')
  const defaultContinue = (paid.find((p) => p.id === 'business') ?? paid[0])?.id ?? ''
  const continuePlan = paid.find((p) => p.id === (continueId || defaultContinue)) ?? null

  function choose(plan: Plan) {
    // Trial asks which paid plan follows it (when there is one to choose).
    if (plan.checkout === 'none' && paid.length > 0) {
      setContinueId(defaultContinue)
      setTrial(plan)
      return
    }
    onChoose(plan)
  }

  return (
    <div>
      <StepHeading
        title="Choose your plan"
        description="Start with a free trial or pick a plan. You can change plans later in Settings › Plan & billing."
      />

      {completeError && (
        <div className="mt-6">
          <ErrorAlert>{completeError}</ErrorAlert>
        </div>
      )}

      {query.isError && (
        <div className="mt-6">
          <ErrorAlert>
            Couldn’t load the plans. {query.error.message}{' '}
            <button type="button" className="font-medium underline" onClick={() => query.refetch()}>
              Try again
            </button>
          </ErrorAlert>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans
          ? plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                featured={plan.id === featuredId}
                badge={
                  plan.id === featuredId ? (
                    <Badge tone="brand">Most popular</Badge>
                  ) : plan.checkout === 'none' ? (
                    <Badge tone="green">No card</Badge>
                  ) : undefined
                }
                action={
                  <Button
                    variant={plan.checkout === 'none' || plan.id === featuredId ? 'primary' : 'secondary'}
                    className="w-full whitespace-normal"
                    loading={completing && plan.checkout === 'none'}
                    disabled={completing}
                    onClick={() => choose(plan)}
                  >
                    {ctaLabel(plan)}
                  </Button>
                }
              />
            ))
          : query.isError
            ? null
            : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[26rem] rounded-card" />)}
      </div>

      <p className="mt-6 text-xs text-muted">Prices exclude VAT. Paid plans are billed monthly per workspace; cancel any time.</p>

      <Modal
        open={!!trial}
        onClose={() => setTrial(null)}
        size="sm"
        title="Which plan after the trial?"
        description="Your trial is free and needs no card. Pick the plan your workspace continues on when it ends; you can change it any time in Settings › Plan & billing."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrial(null)} disabled={completing}>
              Back
            </Button>
            <Button
              id="signup-trial-start"
              loading={completing}
              disabled={!continuePlan}
              onClick={() => trial && continuePlan && onChoose(trial, continuePlan.id)}
            >
              Start free trial
            </Button>
          </>
        }
      >
        <div id="signup-trial-plan-dialog" className="space-y-3">
          <Field id="signup-continue-plan" label="Continue on">
            <SelectInput id="signup-continue-plan" value={continueId || defaultContinue} onChange={(e) => setContinueId(e.target.value)}>
              {paid.map((p) => {
                const price = formatPlanPrice(p)
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} · {price.amount} {price.suffix}
                  </option>
                )
              })}
            </SelectInput>
          </Field>
          {continuePlan && (
            <p className="text-[0.8125rem] text-muted" id="signup-continue-note">
              Nothing is charged now. Add a card before the trial ends and it’s charged {formatPlanPrice(continuePlan).amount}{' '}
              {formatPlanPrice(continuePlan).suffix} for {continuePlan.name} when the trial ends.
            </p>
          )}
          {completeError && (
            <p role="alert" className="text-[0.8125rem] text-danger-600">
              {completeError}
            </p>
          )}
        </div>
      </Modal>

      {onBack && (
        <button type="button" onClick={onBack} className="mt-6 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
          Back
        </button>
      )}
    </div>
  )
}
