import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { QueryClientProvider, QueryErrorResetBoundary, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { makePageQueryClient } from '@/app/queryClient'
import { ApiError, friendlyErrorMessage, isNetworkError } from '@/shared/lib/apiError'
import { reportError } from '@/shared/lib/reportError'
import { Button } from '@/shared/components/ui/Button'

interface BoundaryProps {
  /** Reported as `source` (reportError). */
  source: string
  fallback: (error: unknown, reset: () => void) => ReactNode
  onReset?: () => void
  /** A change (e.g. the path) clears a shown error. */
  resetKey?: string
  children: ReactNode
}

interface BoundaryState {
  error: unknown
  failed: boolean
}

/** Catches render errors below it, reports them once (reportError) and renders `fallback`. */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Server / network failures thrown by queries are expected states, not bugs: don't report them as crashes.
    if (error instanceof ApiError) return
    reportError(error, { source: this.props.source, componentStack: info.componentStack })
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = () => {
    this.props.onReset?.()
    this.setState({ error: null, failed: false })
  }

  render() {
    if (this.state.failed) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}

/** The recoverable error card a crashed or unreachable page shows (the shell around it keeps working). */
export function PageErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = isNetworkError(error)
  const apiError = error instanceof ApiError
  const title = offline ? 'Can’t reach the server' : apiError ? 'This page couldn’t load' : 'This page ran into a problem'
  const message = apiError ? friendlyErrorMessage(error) : 'Something went wrong while showing this page. Reload to try again.'
  return (
    <div className="grid min-h-full place-items-center px-4 py-16">
      <div id="page-error" role="alert" className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl bg-danger-50 text-danger-600 dark:bg-danger-500/10 [&_svg]:size-6">
          {offline ? <WifiOff aria-hidden /> : <AlertTriangle aria-hidden />}
        </div>
        <h1 className="text-[1.125rem] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[0.875rem] text-muted">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          <Button onClick={() => window.location.reload()}>
            <RefreshCw />
            Reload
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Route-level boundary inside the app layout: a page that crashes, or whose data can't load
 * (network / 5xx, see queryClient.shouldThrowToBoundary), shows PageErrorCard while the sidebar and
 * header keep working. Resets when the user navigates elsewhere. Pages get a query client that
 * shares the app's cache but throws transient failures to this boundary.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const base = useQueryClient()
  const [pageClient] = useState(() => makePageQueryClient(base))
  const { pathname } = useLocation()
  return (
    <QueryClientProvider client={pageClient}>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary resetKey={pathname} source="route" onReset={reset} fallback={(error, retry) => <PageErrorCard error={error} onRetry={retry} />}>
            {children}
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  )
}

/** Last resort around the whole app: a crash outside any page shows a full-screen card with Reload. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary source="app" fallback={(error) => <PageErrorCard error={error} />}>
      {children}
    </ErrorBoundary>
  )
}

/** Small shell parts (overlays, banners): on a crash they disappear instead of taking the app down. */
export function QuietBoundary({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary source={`shell:${name}`} fallback={() => null}>
      {children}
    </ErrorBoundary>
  )
}
