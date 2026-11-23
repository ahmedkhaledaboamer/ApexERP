/**
 * The one place errors are reported (error boundaries, the startup screen). Console for now; a
 * monitoring service (Sentry, …) plugs in with `setErrorReporter` without touching the callers.
 */
export interface ErrorReportContext {
  /** Where it was caught: 'startup' | 'app' | 'route' | 'shell' | … */
  source: string
  /** React component stack, when caught by an error boundary. */
  componentStack?: string | null
  /** Current path, request id, … */
  extra?: Record<string, unknown>
}

export type ErrorReporter = (error: unknown, context: ErrorReportContext) => void

const consoleReporter: ErrorReporter = (error, context) => {
  console.error(`[${context.source}]`, error, context.extra ?? '', context.componentStack ?? '')
}

let reporter: ErrorReporter = consoleReporter

/** Replace the reporter (e.g. Sentry.captureException). Returns the previous one. */
export function setErrorReporter(next: ErrorReporter): ErrorReporter {
  const prev = reporter
  reporter = next
  return prev
}

export function reportError(error: unknown, context: ErrorReportContext): void {
  try {
    const requestId = (error as { requestId?: unknown } | null)?.requestId
    const extra = {
      ...(typeof window !== 'undefined' ? { path: window.location.pathname } : {}),
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...context.extra,
    }
    reporter(error, { ...context, extra })
  } catch {
    // Reporting must never throw.
  }
}
