/**
 * Support-session errors raised by the API (axios interceptor → ImpersonationBanner), the same
 * pattern as billing events: one listener, one message for every screen.
 *  - impersonation_read_only (403): a write in a read-only support session;
 *  - impersonation_blocked (403): an action never allowed while impersonating (password, 2FA,
 *    billing, delete company, full export);
 *  - impersonation_expired / impersonation_ended (401): the session is over → back to the console.
 */
export type ImpersonationEventKind = 'read_only' | 'blocked' | 'expired' | 'ended'

export interface ImpersonationEvent {
  kind: ImpersonationEventKind
  message: string
}

const CODES: Record<string, ImpersonationEventKind> = {
  impersonation_read_only: 'read_only',
  impersonation_blocked: 'blocked',
  impersonation_expired: 'expired',
  impersonation_ended: 'ended',
}

type Listener = (event: ImpersonationEvent) => void
const listeners = new Set<Listener>()

export function onImpersonationEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Pure: error code → event (null for anything else). */
export function toImpersonationEvent(code: string | undefined, message: string): ImpersonationEvent | null {
  const kind = code ? CODES[code] : undefined
  return kind ? { kind, message } : null
}

export function emitImpersonationError(code: string | undefined, message: string): void {
  const event = toImpersonationEvent(code, message)
  if (event) listeners.forEach((l) => l(event))
}

/** Toast copy per kind. */
export const IMPERSONATION_TOAST: Record<'read_only' | 'blocked', { title: string; body: string }> = {
  read_only: { title: 'Read-only support session', body: 'Enable write mode in the banner to make changes.' },
  blocked: { title: 'Not allowed during a support session', body: 'Passwords, two-factor, billing and data export stay with the company.' },
}
