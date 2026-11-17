import { type ReactNode } from 'react'
import { AlertTriangle, Inbox } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-sunken', className)} aria-hidden />
}

interface EmptyStateProps {
  title: string
  body: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export function EmptyState({ title, body, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-line bg-sunken text-muted [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-[0.8125rem] text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-danger-50 text-danger-600 dark:bg-danger-500/10">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold">Couldn’t load this</p>
      <p className="mt-1 max-w-sm text-[0.8125rem] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
