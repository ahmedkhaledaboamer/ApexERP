import { useSyncExternalStore } from 'react'

/**
 * Workspace read-only flag (subscription Suspended / Cancelled, or a read-only support session). Written by the one entitlements
 * sync in the app shell (modules/billing/components/BillingSync), read by every write action
 * (Button `write`). A tiny external store instead of a query per button: hundreds of buttons, one
 * source. Reset to false on sign-out (the sync unmounts) and whenever entitlements are unknown.
 */
let readOnly = false
let hint = 'Workspace is read-only'
const listeners = new Set<() => void>()

export function setWorkspaceReadOnly(next: boolean, nextHint: string = READ_ONLY_HINT): void {
  if (next === readOnly && nextHint === hint) return
  readOnly = next
  hint = nextHint
  listeners.forEach((l) => l())
}

/** Why writes are disabled right now (tooltip on the disabled buttons). */
export function useReadOnlyHint(): string {
  return useSyncExternalStore(subscribe, () => hint, () => hint)
}

export function isWorkspaceReadOnly(): boolean {
  return readOnly
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True while the workspace is read-only: disable create / edit / delete / send / import. */
export function useReadOnly(): boolean {
  return useSyncExternalStore(subscribe, isWorkspaceReadOnly, isWorkspaceReadOnly)
}

export const READ_ONLY_HINT = 'Workspace is read-only'
export const SUPPORT_READ_ONLY_HINT = 'Read-only support session: enable write mode to make changes'
