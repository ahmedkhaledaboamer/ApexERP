import { forwardRef, useRef, useState, type InputHTMLAttributes } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { formatDistanceToNowStrict } from 'date-fns'
import { Check, Circle, Eye, EyeOff, KeyRound } from 'lucide-react'
import { passwordProblem, passwordRules, passwordStrength, type StrengthLevel } from '@/modules/account/lib/passwordRules'
import { useChangePassword } from '@/modules/account/hooks/useAccount'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextInput } from '@/shared/components/form/Field'

interface Values {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY: Values = { currentPassword: '', newPassword: '', confirmPassword: '' }

function schemaFor(minLength: number) {
  return z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password.'),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((v, ctx) => {
      const problem = v.newPassword ? passwordProblem(v.newPassword, minLength) : 'Enter a new password.'
      if (problem) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: problem })
      else if (v.newPassword === v.currentPassword)
        ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'Choose a password different from your current one.' })
      if (!v.confirmPassword) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Type the new password again.' })
      else if (v.confirmPassword !== v.newPassword)
        ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'The passwords don’t match.' })
    })
}

const STRENGTH_BAR: Record<Exclude<StrengthLevel, 0>, string> = {
  1: 'bg-danger-500',
  2: 'bg-warning-500',
  3: 'bg-success-500',
  4: 'bg-success-600',
}

const STRENGTH_TEXT: Record<Exclude<StrengthLevel, 0>, string> = {
  1: 'text-danger-600 dark:text-danger-500',
  2: 'text-warning-700 dark:text-warning-500',
  3: 'text-success-700 dark:text-success-500',
  4: 'text-success-700 dark:text-success-500',
}

/** Change your own password. Rules follow the security policy's minimum length. */
export function ChangePasswordCard({ minLength, changedAt }: { minLength: number; changedAt: string | null | undefined }) {
  const toast = useToast()
  const change = useChangePassword()
  const minRef = useRef(minLength)
  minRef.current = minLength
  // The schema is rebuilt per validation so a policy change applies without remounting the form.
  const resolver: Resolver<Values> = (values, ctx, opts) => zodResolver(schemaFor(minRef.current))(values, ctx, opts)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver, defaultValues: EMPTY, mode: 'onTouched' })
  const [formError, setFormError] = useState<string | null>(null)

  const current = watch('currentPassword')
  const next = watch('newPassword')
  const rules = [
    ...passwordRules(next, minLength),
    { id: 'different', label: 'Different from your current password', ok: !!next && next !== current },
  ]
  const strength = passwordStrength(next, minLength)

  const onSubmit = handleSubmit((v) => {
    setFormError(null)
    change.mutate(
      { currentPassword: v.currentPassword, newPassword: v.newPassword },
      {
        onSuccess: (res) => {
          reset(EMPTY)
          toast.success(
            'Password changed',
            res.signedOutSessions
              ? `${res.signedOutSessions} other session${res.signedOutSessions === 1 ? ' was' : 's were'} signed out.`
              : 'Use it the next time you sign in.',
          )
        },
        onError: (e) => {
          if (/current password isn/i.test(e.message)) setError('currentPassword', { message: e.message }, { shouldFocus: true })
          else if (/current one|characters|letters/i.test(e.message)) setError('newPassword', { message: e.message }, { shouldFocus: true })
          else setFormError(e.message)
        },
      },
    )
  })

  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Password"
        description={
          changedAt ? (
            <span title={fmtDate(changedAt, 'd MMM yyyy, HH:mm')}>
              Last changed {formatDistanceToNowStrict(new Date(changedAt), { addSuffix: true })}
            </span>
          ) : (
            'Use a password you don’t use anywhere else.'
          )
        }
      />
      <CardBody>
        <form noValidate onSubmit={onSubmit} className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
          <div className="space-y-4">
            <Field id="pw-current" label="Current password" error={errors.currentPassword?.message}>
              <PasswordInput
                id="pw-current"
                autoComplete="current-password"
                invalid={!!errors.currentPassword}
                aria-describedby={errors.currentPassword ? 'pw-current-error' : undefined}
                {...register('currentPassword')}
              />
            </Field>
            <Field id="pw-new" label="New password" error={errors.newPassword?.message}>
              <PasswordInput
                id="pw-new"
                autoComplete="new-password"
                invalid={!!errors.newPassword}
                aria-describedby={cn('pw-rules', errors.newPassword && 'pw-new-error')}
                {...register('newPassword')}
              />
            </Field>
            {next && strength.level > 0 && (
              <div className="-mt-2" aria-live="polite">
                <div className="flex gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1 flex-1 rounded-full transition-colors',
                        i <= strength.level ? STRENGTH_BAR[strength.level as Exclude<StrengthLevel, 0>] : 'bg-sunken',
                      )}
                    />
                  ))}
                </div>
                <p className={cn('mt-1 text-xs font-medium', STRENGTH_TEXT[strength.level as Exclude<StrengthLevel, 0>])}>
                  Strength: {strength.label}
                </p>
              </div>
            )}
            <Field id="pw-confirm" label="Confirm new password" error={errors.confirmPassword?.message}>
              <PasswordInput
                id="pw-confirm"
                autoComplete="new-password"
                invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? 'pw-confirm-error' : undefined}
                {...register('confirmPassword')}
              />
            </Field>

            {formError && (
              <p
                role="alert"
                className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500"
              >
                {formError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={change.isPending}>
                Change password
              </Button>
              <p className="text-xs text-muted">Your other devices will be signed out.</p>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-sunken/40 p-4 md:self-start">
            <p className="text-xs font-medium text-ink-2">Your new password needs</p>
            <ul id="pw-rules" className="mt-2.5 space-y-2">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className={cn('flex items-start gap-2 text-xs', r.ok ? 'text-success-700 dark:text-success-500' : 'text-muted')}
                >
                  {r.ok ? (
                    <Check className="mt-px size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <Circle className="mt-px size-3.5 shrink-0 text-subtle" aria-hidden />
                  )}
                  <span>
                    {r.label}
                    <span className="sr-only">{r.ok ? ' (done)' : ' (not yet)'}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
              Tip: a short sentence is easier to remember and harder to guess.
            </p>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { invalid?: boolean }

/** Password field with a show/hide toggle. */
const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({ className, ...rest }, ref) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <TextInput ref={ref} type={show ? 'text' : 'password'} spellCheck={false} className={cn('pe-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute inset-y-0 end-0 flex w-9 items-center justify-center rounded-e-lg text-subtle hover:text-ink"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
})
