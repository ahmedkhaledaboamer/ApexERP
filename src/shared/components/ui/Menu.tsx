import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface MenuProps {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: { onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  className?: string
}

/** Small popover menu: closes on outside click, Escape, or picking an item. */
export function Menu({ trigger, children, align = 'end', side = 'bottom', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-haspopup': 'menu', 'aria-expanded': open })}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 min-w-48 animate-pop-in rounded-lg border border-line bg-surface p-1 shadow-pop',
            align === 'end' ? 'end-0' : 'start-0',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

interface MenuItemProps {
  onSelect: () => void
  icon?: ReactNode
  children: ReactNode
  hint?: ReactNode
  danger?: boolean
  active?: boolean
}

export function MenuItem({ onSelect, icon, children, hint, danger, active }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] transition-colors [&_svg]:size-4',
        danger ? 'text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-500/10' : 'text-ink hover:bg-hover',
        active && 'bg-hover',
      )}
    >
      {icon && <span className={cn('shrink-0', danger ? '' : 'text-muted')}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-subtle">{hint}</span>}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-1.5 pb-1 text-[0.6875rem] font-medium text-subtle">{children}</p>
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />
}
