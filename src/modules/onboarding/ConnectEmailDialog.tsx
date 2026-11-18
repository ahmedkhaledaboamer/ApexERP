import { useCallback, useState, type FormEvent } from 'react'
import { Mail, Server } from 'lucide-react'
import type { EmailProvider } from '@/modules/signup/types'
import { useConnectEmail } from '@/modules/signup/api'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, TextInput } from '@/shared/components/form/Field'
import { useToast } from '@/shared/components/ui/Toast'

const PROVIDERS: { id: EmailProvider; name: string; body: string }[] = [
  { id: 'google', name: 'Google Workspace', body: 'Gmail and Google Workspace mailboxes' },
  { id: 'microsoft', name: 'Microsoft 365', body: 'Outlook and Exchange Online' },
  { id: 'smtp', name: 'Other (SMTP)', body: 'Any mailbox with SMTP access' },
]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Connect the company mailbox (mocked): emails to leads are sent from this address. */
export function ConnectEmailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [provider, setProvider] = useState<EmailProvider>('google')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const connect = useConnectEmail()
  const toast = useToast()

  // Stable: Modal re-runs its focus effect whenever onClose changes.
  const { reset } = connect
  const close = useCallback(() => {
    setError(null)
    reset()
    onClose()
  }, [reset, onClose])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!EMAIL.test(address.trim())) {
      setError('Enter the mailbox address, e.g. sales@yourcompany.com.')
      return
    }
    connect.mutate(
      { provider, address: address.trim().toLowerCase() },
      {
        onSuccess: (conn) => {
          toast.success('Email connected', `Emails will be sent from ${conn.address}.`)
          close()
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect email"
      description="Emails to leads and customers are sent from this mailbox, and replies come back to it."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button write type="submit" form="connect-email-form" loading={connect.isPending}>
            Connect
          </Button>
        </>
      }
    >
      <form id="connect-email-form" noValidate onSubmit={onSubmit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">Provider</legend>
          <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {PROVIDERS.map((p) => {
              const active = provider === p.id
              return (
                <label
                  key={p.id}
                  className={cn(
                    'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                    active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-500/10' : 'border-line-strong hover:bg-hover',
                  )}
                >
                  <input
                    type="radio"
                    name="email-provider"
                    value={p.id}
                    checked={active}
                    onChange={() => setProvider(p.id)}
                    className="sr-only"
                  />
                  <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-ink">
                    {p.id === 'smtp' ? <Server className="size-3.5 text-muted" aria-hidden /> : <Mail className="size-3.5 text-muted" aria-hidden />}
                    {p.name}
                  </span>
                  <span className="text-xs text-muted">{p.body}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <Field id="connect-email-address" label="Mailbox address" error={error ?? undefined} required>
          <TextInput
            id="connect-email-address"
            type="email"
            autoComplete="email"
            placeholder="sales@yourcompany.com"
            value={address}
            invalid={!!error}
            aria-describedby={error ? 'connect-email-address-error' : undefined}
            onChange={(e) => {
              setAddress(e.target.value)
              setError(null)
            }}
          />
        </Field>

        <p className="text-xs text-muted">
          {provider === 'smtp'
            ? 'In the demo nothing is really connected; server, port and password are skipped.'
            : 'In the demo nothing is really connected; the sign-in with your provider is skipped.'}
        </p>

        {connect.isError && (
          <p role="alert" className="text-xs text-danger-600 dark:text-danger-500">
            {connect.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}
