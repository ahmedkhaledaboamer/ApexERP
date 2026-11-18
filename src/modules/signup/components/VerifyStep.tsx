import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, FlaskConical, MailCheck } from 'lucide-react'
import type { SignupStarted } from '@/modules/signup/types'
import { useResendCode, useVerifySignup } from '@/modules/signup/api'
import { ApiError } from '@/shared/lib/apiError'
import { OtpInput } from '@/modules/auth/components/OtpInput'
import { Button } from '@/shared/components/ui/Button'
import { ErrorAlert, StepHeading } from '@/modules/signup/components/SignupParts'

/** Seconds left until `until` (ms), re-rendering every second while positive. */
function useSecondsLeft(until: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

interface VerifyStepProps {
  started: SignupStarted
  onResent: (started: SignupStarted) => void
  onVerified: () => void
  onBack: () => void
}

/** Step 2: the 6-digit code emailed to the admin. */
export function VerifyStep({ started, onResent, onVerified, onBack }: VerifyStepProps) {
  const [code, setCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(() => Date.now() + started.resendInSeconds * 1000)
  const [resentNotice, setResentNotice] = useState(false)
  const verify = useVerifySignup()
  const resend = useResendCode()
  const resendLeft = useSecondsLeft(resendAt)
  const expiresLeft = useSecondsLeft(new Date(started.codeExpiresAt).getTime())

  function submit(value: string) {
    setLocalError(null)
    if (value.length !== 6) {
      setLocalError('Enter all 6 digits.')
      return
    }
    verify.mutate(
      { signupId: started.signupId, code: value },
      {
        onSuccess: onVerified,
        onError: () => setCode(''),
      },
    )
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit(code)
  }

  function doResend() {
    setResentNotice(false)
    resend.mutate(started.signupId, {
      onSuccess: (next) => {
        onResent(next)
        setResendAt(Date.now() + next.resendInSeconds * 1000)
        setCode('')
        setLocalError(null)
        verify.reset()
        setResentNotice(true)
      },
      onError: (err) => {
        // The server says how long to wait: restart the countdown from its answer when it gives one.
        const wait = err instanceof ApiError && err.status === 429 ? Number(/(\d+)\s*second/.exec(err.message)?.[1]) : NaN
        if (Number.isFinite(wait) && wait > 0) {
          setResendAt(Date.now() + wait * 1000)
          resend.reset()
        }
      },
    })
  }

  const error = localError ?? (verify.isError ? verify.error.message : null)
  const expired = expiresLeft === 0
  // Too many wrong codes (or the sign-up is gone): this sign-up can't be finished, start again.
  const restart =
    verify.error instanceof ApiError && (verify.error.code === 'too_many_attempts' || verify.error.status === 404 || verify.error.status === 410)

  return (
    <div>
      <span className="mb-5 flex size-11 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
        <MailCheck className="size-5" aria-hidden />
      </span>
      <StepHeading
        title="Check your email"
        description={
          <>
            We sent a 6-digit code to <span className="font-medium text-ink">{started.email}</span>. It expires in{' '}
            <span className="num font-medium text-ink">{mmss(expiresLeft)}</span>.
          </>
        }
      />

      <form noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
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
            label="Email verification code"
            describedBy={error ? 'su-otp-error' : undefined}
          />
          {error && (
            <p id="su-otp-error" role="alert" className="mt-2 text-xs text-danger-600 dark:text-danger-500">
              {error}
            </p>
          )}
          {expired && !error && (
            <p role="status" className="mt-2 text-xs text-warning-700 dark:text-warning-500">
              This code has expired. Send a new one.
            </p>
          )}
        </div>

        {started.devCode && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warning-500/50 bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
            <FlaskConical className="size-3.5 shrink-0" aria-hidden />
            <span className="rounded bg-warning-500/15 px-1.5 py-0.5 font-semibold tracking-wide uppercase">Demo only</span>
            <span>
              No email is sent in the demo. Your code is{' '}
              <span className="num font-semibold tracking-[0.15em] text-ink">{started.devCode}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setCode(started.devCode!)
                submit(started.devCode!)
              }}
              className="ms-auto font-medium underline-offset-2 hover:underline"
            >
              Use it
            </button>
          </div>
        )}

        {resend.isError && <ErrorAlert>{resend.error.message}</ErrorAlert>}
        {resentNotice && !resend.isError && (
          <p role="status" className="text-xs text-success-700 dark:text-success-500">
            A new code is on its way to {started.email}.
          </p>
        )}

        {restart ? (
          <Button size="lg" className="w-full" onClick={onBack}>
            Start again
          </Button>
        ) : (
          <Button type="submit" size="lg" loading={verify.isPending} className="w-full">
            {verify.isPending ? 'Verifying…' : 'Verify email'}
          </Button>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-[0.8125rem]">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-muted hover:text-ink">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" aria-hidden />
          Change details
        </button>
        <span className="text-muted">
          Didn’t get it?{' '}
          {resendLeft > 0 ? (
            <span className="num" aria-live="off">
              Resend in {mmss(resendLeft)}
            </span>
          ) : (
            <button
              type="button"
              onClick={doResend}
              disabled={resend.isPending}
              className="font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-300"
            >
              {resend.isPending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
