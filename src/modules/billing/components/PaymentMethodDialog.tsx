import { useCallback, useState, type ComponentProps, type FormEvent } from 'react'
import { CreditCard, FlaskConical } from 'lucide-react'
import { useUpdatePaymentMethod } from '@/modules/billing/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Field, TextInput } from '@/shared/components/form/Field'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

interface CardForm {
  holder: string
  cardNumber: string
  expiry: string
  cvc: string
}
type Errors = Partial<Record<keyof CardForm, string>>

const EMPTY: CardForm = { holder: '', cardNumber: '', expiry: '', cvc: '' }
const digits = (v: string) => v.replace(/\D/g, '')
const formatCardNumber = (v: string) =>
  digits(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')
const formatExpiry = (v: string) => {
  const d = digits(v).slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

function validate(c: CardForm): Errors {
  const e: Errors = {}
  if (c.holder.trim().length < 2) e.holder = 'Enter the name on the card.'
  const n = digits(c.cardNumber)
  if (n.length < 13 || n.length > 19) e.cardNumber = 'Enter a valid card number.'
  const m = /^(\d{2})\/(\d{2})$/.exec(c.expiry)
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) e.expiry = 'Use MM/YY.'
  else if (new Date(2000 + Number(m[2]), Number(m[1]), 1).getTime() <= Date.now()) e.expiry = 'This card has expired.'
  if (!/^\d{3,4}$/.test(c.cvc)) e.cvc = '3 or 4 digits.'
  return e
}

/**
 * Update the subscription's card (mock): 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is
 * declined (402 card_declined, shown inline). Stays enabled while the workspace is read-only:
 * paying is how a suspended workspace comes back.
 */
export function PaymentMethodDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [card, setCard] = useState<CardForm>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const save = useUpdatePaymentMethod()
  const toast = useToast()
  const { reset } = save

  const close = useCallback(() => {
    setCard(EMPTY)
    setErrors({})
    reset()
    onClose()
  }, [reset, onClose])

  function change<K extends keyof CardForm>(key: K, value: string) {
    setCard((c) => ({ ...c, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    if (save.isError) save.reset()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found = validate(card)
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      document.getElementById(`pm-${first}`)?.focus()
      return
    }
    save.mutate(
      { holder: card.holder.trim(), cardNumber: digits(card.cardNumber), expiry: card.expiry, cvc: card.cvc },
      {
        onSuccess: () => {
          toast.success('Payment method updated', `Card ending ${digits(card.cardNumber).slice(-4)} will be charged from now on.`)
          onSaved?.()
          close()
        },
      },
    )
  }

  const field = (key: keyof CardForm, label: string, props: Partial<ComponentProps<typeof TextInput>>, format?: (v: string) => string) => (
    <Field id={`pm-${key}`} label={label} error={errors[key]} required>
      <TextInput
        id={`pm-${key}`}
        value={card[key]}
        invalid={!!errors[key]}
        aria-describedby={errors[key] ? `pm-${key}-error` : undefined}
        onChange={(e) => change(key, format ? format(e.target.value) : e.target.value)}
        {...props}
      />
    </Field>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Update payment method"
      description="The card is charged at each renewal. Changing it doesn’t charge you now."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button id="payment-method-save" type="submit" form="payment-method-form" loading={save.isPending}>
            <CreditCard aria-hidden />
            Save card
          </Button>
        </>
      }
    >
      <form id="payment-method-form" noValidate onSubmit={onSubmit} className="space-y-4">
        {field('holder', 'Cardholder name', { autoComplete: 'cc-name' })}
        {field(
          'cardNumber',
          'Card number',
          { inputMode: 'numeric', autoComplete: 'cc-number', placeholder: '4242 4242 4242 4242', className: 'num' },
          formatCardNumber,
        )}
        <div className="grid grid-cols-2 gap-4">
          {field('expiry', 'Expiry', { inputMode: 'numeric', autoComplete: 'cc-exp', placeholder: 'MM/YY', className: 'num' }, formatExpiry)}
          {field('cvc', 'CVC', { inputMode: 'numeric', autoComplete: 'cc-csc', placeholder: '123', className: 'num' }, (v) => digits(v).slice(0, 4))}
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-warning-500/50 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Test mode.</span> <span className="num font-medium">4242 4242 4242 4242</span> works,{' '}
            <span className="num font-medium">4000 0000 0000 0002</span> is declined.
          </span>
        </div>
        {save.isError && (
          <p role="alert" id="payment-method-error" className="text-[0.8125rem] text-danger-700 dark:text-danger-500">
            {save.error.message || 'Your card was declined. Try another card.'}
          </p>
        )}
      </form>
    </Modal>
  )
}
