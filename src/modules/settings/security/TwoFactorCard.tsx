import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react'
import type { TwoFactorEnabled } from '@/modules/settings/security/types'
import { DemoOtpHint, OtpInput } from '@/modules/auth/components/OtpInput'
import { useDisableTwoFactor, useSetupTwoFactor, useTwoFactorQuery, useVerifyTwoFactor } from '@/modules/settings/hooks/useSecurity'
import { useCurrentUser } from '@/store/hooks'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Checkbox, Field, TextInput } from '@/shared/components/form/Field'

/** Your own account's two-factor status, with the setup and turn-off flows. */
export function TwoFactorCard({ requiredByPolicy }: { requiredByPolicy: boolean }) {
  const user = useCurrentUser()
  const query = useTwoFactorQuery()
  const [setupOpen, setSetupOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const enabled = query.data?.enabled ?? false
  const locked = enabled && requiredByPolicy && user?.role === 'System Admin'

  return (
    <Card>
      <CardHeader
        icon={<Smartphone />}
        title="Two-factor authentication"
        description="Your account. A code from an authenticator app is asked for after your password."
        action={
          query.data &&
          (enabled ? (
            <Badge tone="green" icon={<ShieldCheck />}>
              On
            </Badge>
          ) : (
            <Badge tone="amber" icon={<ShieldOff />}>
              Off
            </Badge>
          ))
        }
      />
      <CardBody>
        {query.isPending ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        ) : enabled ? (
          <div className="flex flex-col gap-4 rounded-lg border border-line p-4 sm:flex-row sm:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600 dark:bg-success-500/10">
              <ShieldCheck className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium">Authenticator app is set up</p>
              <p className="mt-0.5 text-xs text-muted">
                Since {fmtDate(query.data.enabledAt)} · {query.data.recoveryCodesLeft} recovery code
                {query.data.recoveryCodesLeft === 1 ? '' : 's'} left
              </p>
              {locked && <p className="mt-1 text-xs text-muted">Required for System Admins by the security policy.</p>}
            </div>
            <Button variant="secondary" size="sm" disabled={locked} onClick={() => setDisableOpen(true)}>
              Turn off
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-lg border border-dashed border-line-strong p-4 sm:flex-row sm:items-center">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600 dark:bg-warning-500/10">
              <ShieldOff className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium">Protect your account with a second step</p>
              <p className="mt-0.5 text-xs text-muted">
                Works with Google Authenticator, Microsoft Authenticator, 1Password and similar apps.
                {requiredByPolicy && user?.role === 'System Admin' && ' Required for System Admins.'}
              </p>
            </div>
            <Button size="sm" onClick={() => setSetupOpen(true)}>
              <ShieldCheck />
              Set up 2FA
            </Button>
          </div>
        )}
      </CardBody>
      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />
      <DisableModal open={disableOpen} onClose={() => setDisableOpen(false)} />
    </Card>
  )
}

/* ---------------- Setup: scan → verify → recovery codes ---------------- */

const STEPS = ['Scan', 'Verify', 'Save codes'] as const

function SetupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setup = useSetupTwoFactor()
  const verify = useVerifyTwoFactor()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [code, setCode] = useState('')
  const [result, setResult] = useState<TwoFactorEnabled | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setCode('')
    setResult(null)
    setSaved(false)
    verify.reset()
    setup.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function submit(value: string) {
    if (value.length !== 6 || verify.isPending) return
    verify.mutate(value, {
      onSuccess: (res) => {
        setResult(res)
        setStep(2)
      },
      onError: () => setCode(''),
    })
  }

  function finish() {
    toast.success('Two-factor authentication is on', 'You’ll be asked for a code at your next sign-in.')
    onClose()
  }

  // Closing after codes were issued still counts as done: 2FA is already on.
  const close = result ? finish : onClose

  return (
    <Modal
      open={open}
      onClose={close}
      title="Set up two-factor authentication"
      description={
        step === 0
          ? 'Scan the QR code with your authenticator app.'
          : step === 1
            ? 'Enter the 6-digit code the app shows for Apex Aora.'
            : 'Save these recovery codes somewhere safe.'
      }
      footer={
        step === 0 ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!setup.data} onClick={() => setStep(1)}>
              Next
            </Button>
          </>
        ) : step === 1 ? (
          <>
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button loading={verify.isPending} disabled={code.length !== 6} onClick={() => submit(code)}>
              Verify
            </Button>
          </>
        ) : (
          <Button disabled={!saved} onClick={finish}>
            Done
          </Button>
        )
      }
    >
      <Stepper step={step} />

      {step === 0 && (
        <div className="mt-5">
          {setup.isPending ? (
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="size-44 rounded-xl" />
              <Skeleton className="h-4 w-56" />
            </div>
          ) : setup.isError ? (
            <ErrorState message={setup.error.message} onRetry={() => setup.mutate()} />
          ) : setup.data ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="shrink-0 rounded-xl border border-line bg-white p-3">
                <QRCodeSVG value={setup.data.otpauthUrl} size={160} level="M" marginSize={0} title="QR code for your authenticator app" />
              </div>
              <div className="min-w-0 flex-1 space-y-3 text-[0.8125rem]">
                <ol className="list-decimal space-y-1.5 ps-4 text-ink-2">
                  <li>Open your authenticator app and add an account.</li>
                  <li>Scan this QR code, or type the key below.</li>
                  <li>Press Next and enter the code it shows.</li>
                </ol>
                <SecretKey secret={setup.data.secret} />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {step === 1 && (
        <div className="mt-5 space-y-4">
          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v)
              if (verify.isError) verify.reset()
            }}
            onComplete={submit}
            invalid={verify.isError}
            disabled={verify.isPending}
            autoFocus
            describedBy={verify.isError ? 'setup-otp-error' : undefined}
          />
          {verify.isError && (
            <p id="setup-otp-error" role="alert" className="text-xs text-danger-600 dark:text-danger-500">
              {verify.error.message}
            </p>
          )}
          <DemoOtpHint
            onUse={(c) => {
              setCode(c)
              submit(c)
            }}
          />
        </div>
      )}

      {step === 2 && result && (
        <div className="mt-5 space-y-4">
          <RecoveryCodes codes={result.recoveryCodes} />
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 hover:bg-hover/60">
            <Checkbox className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>
              <span className="block text-[0.8125rem] font-medium">I’ve saved my recovery codes</span>
              <span className="block text-xs text-muted">They’re shown only once. Each code signs you in once if you lose your phone.</span>
            </span>
          </label>
        </div>
      )}
    </Modal>
  )
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {STEPS.map((label, i) => {
        const done = i < step
        const active = i === step
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-brand-600 text-white dark:bg-brand-500',
                active && 'bg-brand-50 text-brand-700 ring-2 ring-brand-500 dark:bg-brand-500/15 dark:text-brand-300',
                !done && !active && 'bg-sunken text-muted',
              )}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn('truncate text-xs', active ? 'font-medium text-ink' : 'text-muted')}>{label}</span>
            {i < STEPS.length - 1 && <span aria-hidden className={cn('h-px min-w-3 flex-1', done ? 'bg-brand-500' : 'bg-line')} />}
          </li>
        )
      })}
    </ol>
  )
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return { copied, copy }
}

function SecretKey({ secret }: { secret: string }) {
  const { copied, copy } = useCopy()
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? secret
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">Setup key</p>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken/50 px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-ink">{grouped}</code>
        <Button variant="ghost" size="xs" iconOnly aria-label={copied ? 'Copied' : 'Copy setup key'} onClick={() => copy(secret)}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { copied, copy } = useCopy()
  const text = codes.join('\n')

  function download() {
    const blob = new Blob([`Apex Aora recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'apex-aora-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-line">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 p-4" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-2 font-mono text-[0.8125rem] text-ink">
            <KeyRound className="size-3.5 shrink-0 text-subtle" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => copy(text)}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download />
          Download
        </Button>
      </div>
    </div>
  )
}

/* ---------------- Turn off ---------------- */

function DisableModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disable = useDisableTwoFactor()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode('')
    setUseRecovery(false)
    disable.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function submit(value: string) {
    if (!value.trim() || disable.isPending) return
    disable.mutate(value.trim(), {
      onSuccess: () => {
        toast.success('Two-factor authentication is off', 'Your recovery codes no longer work.')
        onClose()
      },
      onError: () => !useRecovery && setCode(''),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Turn off two-factor?"
      description="Your account will be protected by your password only. Confirm with a current code."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={disable.isPending} disabled={useRecovery ? !code.trim() : code.length !== 6} onClick={() => submit(code)}>
            Turn off 2FA
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {useRecovery ? (
          <Field id="disable-recovery" label="Recovery code" error={disable.isError ? disable.error.message : undefined}>
            <TextInput
              id="disable-recovery"
              placeholder="abcd-1234"
              className="font-mono"
              value={code}
              invalid={disable.isError}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <OtpInput value={code} onChange={setCode} onComplete={submit} invalid={disable.isError} disabled={disable.isPending} autoFocus />
            {disable.isError && (
              <p role="alert" className="text-xs text-danger-600 dark:text-danger-500">
                {disable.error.message}
              </p>
            )}
            <DemoOtpHint
              onUse={(c) => {
                setCode(c)
                submit(c)
              }}
            />
          </>
        )}
        <button
          type="button"
          className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300"
          onClick={() => {
            setUseRecovery((v) => !v)
            setCode('')
            disable.reset()
          }}
        >
          {useRecovery ? 'Use an authenticator code' : 'Use a recovery code instead'}
        </button>
      </div>
    </Modal>
  )
}
