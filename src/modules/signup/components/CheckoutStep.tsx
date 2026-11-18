import { useState, type ComponentProps, type FormEvent } from 'react'
import { ArrowLeft, CreditCard, FlaskConical, Lock } from 'lucide-react'
import type { Plan } from '@/modules/billing/types'
import type { CheckoutResult } from '@/modules/signup/types'
import { useCheckout } from '@/modules/signup/api'
import { Button } from '@/shared/components/ui/Button'
import { Field, TextInput } from '@/shared/components/form/Field'
import { PlanLimitsList, formatPlanPrice } from '@/modules/signup/components/PlanCard'
import { ErrorAlert, StepHeading } from '@/modules/signup/components/SignupParts'

interface Card {
  cardholder: string
  cardNumber: string
  expiry: string
  cvc: string
}
type Errors = Partial<Record<keyof Card, string>>

const digits = (v: string) => v.replace(/\D/g, '')

function formatCardNumber(v: string): string {
  return digits(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
}

function formatExpiry(v: string): string {
  const d = digits(v).slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

function validate(c: Card): Errors {
  const e: Errors = {}
  if (c.cardholder.trim().length < 2) e.cardholder = 'Enter the name on the card.'
  const n = digits(c.cardNumber)
  if (n.length < 13 || n.length > 19) e.cardNumber = 'Enter a valid card number.'
  const m = /^(\d{2})\/(\d{2})$/.exec(c.expiry)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) e.expiry = 'Use MM/YY.'
  else {
    const end = new Date(2000 + Number(m[2]), Number(m[1]), 1)
    if (end.getTime() <= Date.now()) e.expiry = 'This card has expired.'
  }
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = '3 or 4 digits.'
  return e
}

interface CheckoutStepProps {
  signupId: string
  plan: Plan
  onPaid: (result: CheckoutResult) => void
  onBack: () => void
  /** Completing the sign-up after payment. */
  completing: boolean
  completeError: string | null
}

/** Step 4 (Starter, Business): mocked card payment. */
export function CheckoutStep({ signupId, plan, onPaid, onBack, completing, completeError }: CheckoutStepProps) {
  const [card, setCard] = useState<Card>({ cardholder: '', cardNumber: '', expiry: '', cvc: '' })
  const [errors, setErrors] = useState<Errors>({})
  const pay = useCheckout()
  const price = formatPlanPrice(plan)

  function change<K extends keyof Card>(key: K, value: string) {
    setCard((c) => ({ ...c, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    if (pay.isError) pay.reset()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(card)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      document.getElementById(`co-${first}`)?.focus()
      return
    }
    if (plan.checkout !== 'payment') return
    pay.mutate(
      { signupId, plan: plan.id, cardholder: card.cardholder.trim(), cardNumber: digits(card.cardNumber), expiry: card.expiry, cvc: card.cvc },
      { onSuccess: onPaid },
    )
  }

  const field = (key: keyof Card, label: string, props: Partial<ComponentProps<typeof TextInput>>, format?: (v: string) => string) => (
    <Field id={`co-${key}`} label={label} error={errors[key]} required>
      <TextInput
        id={`co-${key}`}
        value={card[key]}
        invalid={!!errors[key]}
        aria-describedby={errors[key] ? `co-${key}-error` : undefined}
        onChange={(e) => change(key, format ? format(e.target.value) : e.target.value)}
        className="h-10"
        {...props}
      />
    </Field>
  )

  const busy = pay.isPending || completing

  return (
    <div>
      <StepHeading title="Payment details" description={`Subscribe to ${plan.name}. You’re charged today and then every ${plan.billingPeriod}.`} />

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          {field('cardholder', 'Cardholder name', { autoComplete: 'cc-name' })}
          {field(
            'cardNumber',
            'Card number',
            { inputMode: 'numeric', autoComplete: 'cc-number', placeholder: '4242 4242 4242 4242', className: 'h-10 num' },
            formatCardNumber,
          )}
          <div className="grid grid-cols-2 gap-4">
            {field('expiry', 'Expiry', { inputMode: 'numeric', autoComplete: 'cc-exp', placeholder: 'MM/YY', className: 'h-10 num' }, formatExpiry)}
            {field('cvc', 'CVC', { inputMode: 'numeric', autoComplete: 'cc-csc', placeholder: '123', className: 'h-10 num' }, (v) =>
              digits(v).slice(0, 4),
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-warning-500/50 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Test mode, no real charge.</span> Use <span className="num font-medium">4242 4242 4242 4242</span> to
              succeed or <span className="num font-medium">4000 0000 0000 0002</span> to see a decline. Any future expiry and any CVC.
            </span>
          </div>

          {pay.isError && <ErrorAlert>{pay.error.message || 'Your card was declined. Try another card.'}</ErrorAlert>}
          {completeError && <ErrorAlert>{completeError}</ErrorAlert>}

          <Button type="submit" size="lg" loading={busy} className="w-full">
            <Lock aria-hidden />
            {completing ? 'Creating your workspace…' : pay.isPending ? 'Processing payment…' : `Pay ${price.amount} and create workspace`}
          </Button>

          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-ink disabled:opacity-50"
          >
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
            Choose another plan
          </button>
        </form>

        <aside className="h-fit rounded-card border border-line bg-canvas p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-muted">
            <CreditCard className="size-3.5" aria-hidden /> Order summary
          </p>
          <p className="mt-3 text-sm font-semibold text-ink">{plan.name}</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold text-ink">{price.amount}</span>
            <span className="text-xs text-muted">{price.suffix}</span>
          </p>
          <PlanLimitsList limits={plan.limits} className="mt-4 border-t border-line pt-4" />
          <p className="mt-4 text-xs text-subtle">Prices exclude VAT.</p>
        </aside>
      </div>
    </div>
  )
}
