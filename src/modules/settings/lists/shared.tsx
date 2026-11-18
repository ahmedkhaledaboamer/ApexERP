import type { ReactNode } from 'react'
import { AlertCircle, Lock } from 'lucide-react'
import { ApiError } from '@/shared/lib/apiError'
import { can } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'

/** Settings: Company Admin edits, Management views (the route already hides it from everyone else). */
export function useSettingsAccess(): { canEdit: boolean } {
  const user = useCurrentUser()
  return { canEdit: !!user && can(user.role, 'settings', 'edit') }
}

/** Validation errors from the server come back as 422; those belong inline, not in a toast. */
export function isValidationError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 422
}

interface SaveBarProps {
  visible: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  /** Defaults to "You have unsaved changes". */
  message?: ReactNode
  saveLabel?: string
}

/** Floating bar shown while a settings section has unsaved edits: "You have unsaved changes · Discard · Save". */
export function SaveBar({ visible, saving, onSave, onDiscard, message, saveLabel = 'Save changes' }: SaveBarProps) {
  if (!visible) return null
  return (
    <div className="pointer-events-none sticky bottom-4 z-30 mt-5 flex justify-center">
      <div
        role="region"
        aria-label="Unsaved changes"
        className="pointer-events-auto flex w-full max-w-xl animate-pop-in flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-pop"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning-500" />
        <p className="min-w-0 flex-1 text-[0.8125rem] font-medium text-ink">{message ?? 'You have unsaved changes'}</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button write size="sm" onClick={onSave} loading={saving}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Inline error block for a section (server 422 messages, list-level rules). */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:bg-danger-500/10 dark:text-danger-500',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/** One-line note for Management, who can see settings but not change them. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-line bg-sunken/60 px-3 py-2 text-[0.8125rem] text-muted">
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  )
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
