/**
 * Connectivity as the app sees it: the browser's `navigator.onLine` (online / offline events) plus
 * what requests tell us. A request that got no response at all marks the app offline; any response
 * (even an error status) or the browser's `online` event marks it back online. OfflineBanner reads
 * this through useSyncExternalStore.
 *
 * Also carries the "a write failed because we're offline" notice: mutations never queue silently
 * (queryClient: networkMode 'always', no retry), so a failed save is announced once as a toast.
 */

type Listener = () => void

let browserOnline = typeof navigator === 'undefined' ? true : navigator.onLine !== false
let requestsFailing = false
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((l) => l())
}

export function isOnline(): boolean {
  return browserOnline && !requestsFailing
}

export function subscribeNetwork(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A request got a response (any status): the server is reachable. */
export function reportRequestSucceeded(): void {
  if (!requestsFailing) return
  requestsFailing = false
  notify()
}

/** A request got no response (network error, connection refused). */
export function reportRequestFailed(): void {
  if (requestsFailing) return
  requestsFailing = true
  notify()
}

/** Browser online / offline events (installed once by the app). */
export function watchBrowserConnectivity(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const on = () => {
    browserOnline = true
    // Back online: give requests a fresh chance (the next one reports again).
    requestsFailing = false
    notify()
  }
  const off = () => {
    browserOnline = false
    notify()
  }
  target.addEventListener('online', on)
  target.addEventListener('offline', off)
  return () => {
    target.removeEventListener('online', on)
    target.removeEventListener('offline', off)
  }
}

/* ---------------- Failed-write notices (queryClient → toast) ---------------- */

export interface NetworkNotice {
  title: string
  body: string
}

type NoticeListener = (notice: NetworkNotice) => void
const noticeListeners = new Set<NoticeListener>()

export function onNetworkNotice(listener: NoticeListener): () => void {
  noticeListeners.add(listener)
  return () => noticeListeners.delete(listener)
}

let lastNoticeAt = 0

/** Coalesced: several writes failing together show one toast. */
export function emitNetworkNotice(notice: NetworkNotice, now = Date.now()): void {
  if (now - lastNoticeAt < 3000) return
  lastNoticeAt = now
  noticeListeners.forEach((l) => l(notice))
}

/** Test helper. */
export function resetNetworkStatus(online = true): void {
  browserOnline = online
  requestsFailing = false
  lastNoticeAt = 0
}
