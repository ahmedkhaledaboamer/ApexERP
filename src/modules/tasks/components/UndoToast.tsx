import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Undo2, X } from 'lucide-react'

export interface UndoState {
  id: number
  title: string
  body?: string
  undo: () => void
}

/** A success toast with an Undo action (the shared toaster has no actions). Auto-hides after 6 s. */
export function UndoToast({ state, onDismiss }: { state: UndoState | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!state) return
    const t = window.setTimeout(onDismiss, 6000)
    return () => window.clearTimeout(t)
  }, [state, onDismiss])

  if (!state) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:inset-x-auto sm:end-4 sm:bottom-24">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-center gap-2.5 rounded-lg border border-line bg-surface px-3.5 py-2.5 shadow-pop"
      >
        <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-medium">{state.title}</p>
          {state.body && <p className="truncate text-xs text-muted">{state.body}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            state.undo()
            onDismiss()
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[0.8125rem] font-medium text-brand-700 hover:bg-hover dark:text-brand-300"
        >
          <Undo2 className="size-3.5" aria-hidden />
          Undo
        </button>
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="rounded p-0.5 text-subtle hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
