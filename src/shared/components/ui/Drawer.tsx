import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { onTopEscape } from './layerStack'
import { Button } from '@/shared/components/ui/Button'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg' | 'xl'
  /**
   * `dialog`: a centred popup (forms: create / edit) — a bottom sheet on phones.
   * `sheet`: a side panel from the end edge (record previews, long read-only detail).
   * Default: `dialog` when there is a footer (a form's Save / Cancel), else `sheet`.
   */
  variant?: 'dialog' | 'sheet'
}

const SHEET_WIDTHS = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }
const DIALOG_WIDTHS = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

/** Forms open as a centred popup; record previews slide in from the end edge (see `variant`). */
export function Drawer({ open, onClose, title, description, children, footer, width = 'lg', variant }: DrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Inline onClose from callers must not re-run the focus effect on every render (it would pull
  // focus out of the field being typed in).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const mode = variant ?? (footer ? 'dialog' : 'sheet')

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    // Escape closes the drawer only when nothing opened on top of it (a modal or menu closes first).
    const offEscape = onTopEscape(() => onCloseRef.current())
    return () => {
      offEscape()
      prev?.focus()
    }
  }, [open])

  if (!open) return null

  const header = (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-[1rem] font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>}
      </div>
      <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
        <X />
      </Button>
    </header>
  )

  if (mode === 'dialog') {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
        <div aria-hidden className="absolute inset-0 animate-fade-in bg-overlay/40 backdrop-blur-[2px]" onClick={onClose} />
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-variant="dialog"
          className={cn(
            'relative flex max-h-[92dvh] w-full animate-pop-in flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-pop outline-none sm:max-h-[88dvh] sm:rounded-2xl',
            DIALOG_WIDTHS[width],
          )}
        >
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 py-3 sm:px-6">{footer}</footer>}
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-overlay/30" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-variant="sheet"
        className={cn(
          'relative flex h-full w-full animate-slide-in-end flex-col border-s border-line bg-surface shadow-pop outline-none',
          SHEET_WIDTHS[width],
        )}
      >
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
