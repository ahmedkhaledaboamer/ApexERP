import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, CreditCard, FlaskConical, Lock } from 'lucide-react'
import { collectionsApi } from '@/modules/finance/collections/api'
import { fmt2 } from '@/modules/finance/collections/components/bits'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextInput } from '@/shared/components/form/Field'

/**
 * `/pay/:token`: the public payment page of a payment link (no sign-in, outside the app shell). It shows only the
 * invoice number, the amount due, the currency and the company's name / logo, and a mock card form (test mode:
 * nothing is charged and the card is never stored; 4000 0000 0000 0002 is always declined).
 */
export default function PublicPayPage() {
  const { token = '' } = useParams()
  const q = useQuery({ queryKey: ['public-pay', token], queryFn: () => collectionsApi.publicPayment(token), retry: false })
  const [card, setCard] = useState({ cardholderName: '', cardNumber: '', expiry: '', cvc: '' })
  const pay = useMutation({ mutationFn: () => collectionsApi.payPublic(token, card) })
  const p = q.data
  const done = pay.data?.paid

  return (
    <main className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-md space-y-4">
        <p className="flex items-center justify-center gap-2 rounded-lg border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-center text-[0.8125rem] font-medium text-ink-2" role="note">
          <FlaskConical className="size-4" aria-hidden /> Test mode: no real payment is taken.
        </p>
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-xs" aria-label="Payment">
          {q.isPending ? (
            <Skeleton className="h-64" />
          ) : q.error || !p ? (
            <div className="space-y-2 text-center">
              <h1 className="text-lg font-semibold text-ink">Payment link not found</h1>
              <p className="text-[0.8125rem] text-muted">{q.error?.message ?? 'This payment link isn’t valid.'}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <header className="flex items-center gap-3">
                {p.logoUrl ? (
                  <img src={p.logoUrl} alt="" className="h-10 w-auto max-w-32 object-contain" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-white">{p.monogram}</span>
                )}
                <div>
                  <p className="font-semibold text-ink">{p.companyName}</p>
                  <p className="text-[0.8125rem] text-muted">Invoice <span className="num">{p.invoiceNumber}</span></p>
                </div>
              </header>
              {done ? (
                <div className="space-y-2 text-center" role="status">
                  <CheckCircle2 className="mx-auto size-10 text-success-600" aria-hidden />
                  <h1 className="text-lg font-semibold text-ink">{pay.data!.message}</h1>
                  <p className="text-[0.8125rem] text-muted">
                    {pay.data!.currency} {fmt2(pay.data!.amount)} · receipt <span className="num">{pay.data!.receiptNumber}</span>
                  </p>
                </div>
              ) : p.state !== 'payable' ? (
                <div className="space-y-1 text-center" role="status">
                  <h1 className="text-lg font-semibold text-ink">{p.state === 'paid' ? 'Already paid' : p.state === 'expired' ? 'Link expired' : 'Link no longer valid'}</h1>
                  <p className="text-[0.8125rem] text-muted">{p.message}</p>
                </div>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    pay.mutate()
                  }}
                >
                  <div className="rounded-xl bg-sunken/60 px-4 py-3">
                    <p className="text-xs text-muted">Amount due</p>
                    <p className="num text-3xl font-semibold text-ink">{p.currency} {fmt2(p.amountDue)}</p>
                  </div>
                  {pay.error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-400">{pay.error.message}</p>}
                  <Field id="pay-name" label="Name on card"><TextInput id="pay-name" autoComplete="cc-name" value={card.cardholderName} onChange={(e) => setCard({ ...card, cardholderName: e.target.value })} required /></Field>
                  <Field id="pay-card" label="Card number" hint="Test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined.">
                    <TextInput id="pay-card" autoComplete="cc-number" inputMode="numeric" value={card.cardNumber} onChange={(e) => setCard({ ...card, cardNumber: e.target.value })} required />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="pay-exp" label="Expiry (MM/YY)"><TextInput id="pay-exp" autoComplete="cc-exp" placeholder="12/30" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} required /></Field>
                    <Field id="pay-cvc" label="CVC"><TextInput id="pay-cvc" autoComplete="cc-csc" inputMode="numeric" maxLength={4} value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} required /></Field>
                  </div>
                  <Button type="submit" className="w-full" size="lg" loading={pay.isPending}>
                    <CreditCard /> Pay {p.currency} {fmt2(p.amountDue)}
                  </Button>
                  <p className="flex items-center justify-center gap-1 text-xs text-muted"><Lock className="size-3" aria-hidden /> Card details are checked and discarded; never stored.</p>
                </form>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
