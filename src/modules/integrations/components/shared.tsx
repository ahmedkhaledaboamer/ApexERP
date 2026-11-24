import { useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { IntegrationStatus, OAuthConsent } from '@/modules/integrations/types'
import { OAUTH_PROVIDER_LABEL, STATUS_LABEL } from '@/modules/integrations/types'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { fmtDate } from '@/shared/lib/utils'

export const DATE_TIME = 'd MMM yyyy, HH:mm'
export const when = (iso: string | null | undefined) => (iso ? fmtDate(iso, DATE_TIME) : '—')

const STATUS_TONE: Record<IntegrationStatus, Tone> = { connected: 'green', error: 'red', paused: 'amber', not_connected: 'neutral' }

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} variant="dot">
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/** Section inside a drawer: a heading, an optional hint and its content. */
export function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line pb-5 last:border-0 last:pb-0" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[0.875rem] font-semibold text-ink">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** "Label: value" rows. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-700 dark:bg-danger-500/10 dark:text-danger-500">{children}</p>
}

/**
 * The simulated provider consent screen (Google / Microsoft): shows the account and the permissions asked for. Allow
 * finishes the connection with the one-time `state`; Cancel sends `approve: false` (nothing is connected).
 */
export function OAuthConsentModal({ consent, onClose, onDecide, busy }: { consent: OAuthConsent | null; onClose: () => void; onDecide: (approve: boolean) => void; busy?: boolean }) {
  const label = consent ? (consent.purpose === 'calendar' ? (consent.provider === 'google' ? 'Google' : 'Microsoft') : OAUTH_PROVIDER_LABEL[consent.provider]) : ''
  return (
    <Modal
      open={consent !== null}
      onClose={onClose}
      title={`Sign in with ${label}`}
      description="Simulated consent screen: a real connection opens the provider’s own sign-in page."
      footer={
        <>
          <Button variant="secondary" onClick={() => onDecide(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onDecide(true)} loading={busy}>
            Allow
          </Button>
        </>
      }
    >
      {consent && (
        <div className="space-y-3 text-[0.8125rem]">
          <p>
            <span className="text-muted">Account</span> <strong data-testid="oauth-account">{consent.account}</strong>
          </p>
          <div>
            <p className="mb-1.5 text-muted">Apex CRM will be able to:</p>
            <ul className="space-y-1">
              {consent.scopes.map((s) => (
                <li key={s} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success-600" aria-hidden />
                  <span className="font-mono text-xs">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">Tokens are stored encrypted on the server and never shown again. You can disconnect at any time.</p>
        </div>
      )}
    </Modal>
  )
}

/** A random signing secret for webhooks (client-side; the server only stores it). */
export function randomSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Minimal local state helper for forms with many fields. */
export function useForm<T extends object>(initial: T) {
  const [v, setV] = useState<T>(initial)
  const set = <K extends keyof T>(k: K, value: T[K]) => setV((x) => ({ ...x, [k]: value }))
  return { v, set, reset: setV }
}
