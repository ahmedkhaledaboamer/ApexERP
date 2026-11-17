import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { toastAdded, toastDismissed, type Toast } from '@/store/uiSlice'

/** Toasts live in Redux (ui.toasts). `const toast = useToast(); toast.success('Lead created')`. */
export function useToast() {
  const dispatch = useAppDispatch()
  return useMemo(
    () => ({
      success: (title: string, body?: string) => dispatch(toastAdded({ kind: 'success', title, body })),
      error: (title: string, body?: string) => dispatch(toastAdded({ kind: 'error', title, body })),
      info: (title: string, body?: string) => dispatch(toastAdded({ kind: 'info', title, body })),
    }),
    [dispatch],
  )
}

const ICONS = {
  success: <CheckCircle2 className="size-4 text-success-600" aria-hidden />,
  error: <AlertCircle className="size-4 text-danger-600" aria-hidden />,
  info: <Info className="size-4 text-accent-600" aria-hidden />,
}

/** Renders ui.toasts. Mounted once in the app layout. */
export function Toaster() {
  const toasts = useAppSelector((s) => s.ui.toasts)
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:end-4 sm:items-end"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}

function ToastRow({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch()
  useEffect(() => {
    const timer = window.setTimeout(() => dispatch(toastDismissed(toast.id)), toast.kind === 'error' ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [dispatch, toast.id, toast.kind])

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-3 shadow-pop"
    >
      <span className="mt-px">{ICONS[toast.kind]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.8125rem] font-medium">{toast.title}</p>
        {toast.body && <p className="mt-0.5 text-xs text-muted">{toast.body}</p>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dispatch(toastDismissed(toast.id))}
        className="rounded p-0.5 text-subtle hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
