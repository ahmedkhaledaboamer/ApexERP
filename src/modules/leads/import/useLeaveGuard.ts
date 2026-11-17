import { useEffect } from 'react'

/**
 * Warns before leaving while work is unsaved. The app uses <BrowserRouter> (no data-router
 * blocker), so this covers reload/close via `beforeunload` and in-app links via a capture-phase
 * click check. Links inside an element marked `data-leave-ok` are let through.
 */
export function useLeaveGuard(active: boolean, message = 'You have unsaved changes. Leave anyway?') {
  useEffect(() => {
    if (!active) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      const link = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download') || link.closest('[data-leave-ok]')) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message])
}
