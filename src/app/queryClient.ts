import { MutationCache, QueryClient, type DefaultOptions, type Query } from '@tanstack/react-query'
import { isNetworkError, isTransientError } from '@/shared/lib/apiError'
import { emitNetworkNotice } from '@/shared/lib/networkStatus'
import { tenantQueryKeyHash } from '@/shared/lib/tenantContext'

/** Billing queries (entitlements, overview): usage changes after almost any write. */
export const BILLING_QUERY_KEY = ['billing'] as const

/** Queries retry at most this many times, and only for network / timeout / 5xx failures. */
export const MAX_QUERY_RETRIES = 2

/**
 * Retry predicate (pure): network failures, timeouts and 5xx may fix themselves → up to 2 retries.
 * 4xx (permission, validation, not found, session) never will → no retry. Anything that isn't an
 * ApiError is a bug in our code → no retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUERY_RETRIES && isTransientError(error)
}

/** Backoff between query retries: 1 s, 2 s, 4 s… capped at 8 s. */
export function queryRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000)
}

/**
 * Inside a page (RouteErrorBoundary's client, see makePageQueryClient): a query that failed with a
 * network / 5xx error and has nothing to show throws to the route error boundary, so a page can
 * never sit on a skeleton forever. Errors the page handles itself (4xx) and queries with data
 * (a failed background refetch) don't throw.
 */
export function shouldThrowToBoundary(error: unknown, query: Pick<Query, 'state'>): boolean {
  return isTransientError(error) && query.state.data === undefined
}

function baseDefaults(): DefaultOptions {
  return {
    queries: {
      // Every cache key includes the active company id (one helper, applied to every query).
      queryKeyHashFn: tenantQueryKeyHash,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
    },
    mutations: {
      // Writes are never repeated on their own, and never wait silently for the network to come
      // back ('always': they run and fail with "We couldn't reach the server" instead of pausing).
      retry: false,
      networkMode: 'always',
    },
  }
}

export function makeQueryClient() {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      // Any write can change usage (users, leads & contacts, storage, emails) or hit a limit, so
      // every settled mutation refreshes the billing queries (only active ones refetch).
      onSettled: () => {
        void client.invalidateQueries({ queryKey: BILLING_QUERY_KEY })
      },
      // A write that couldn't reach the server and has no error handler of its own: one toast.
      onError: (error, _vars, _ctx, mutation) => {
        if (isNetworkError(error) && !mutation.options.onError) {
          emitNetworkNotice({ title: 'Not saved: you’re offline', body: 'Check your connection and try again. Nothing is saved until the server answers.' })
        }
      },
    }),
    defaultOptions: baseDefaults(),
  })
  return client
}

/**
 * The client used under the page (route) error boundary: the SAME query and mutation caches as the
 * app's client (one cache, one set of data), with one difference: transient errors without data
 * throw to the nearest error boundary (shouldThrowToBoundary). The shell (sidebar, header, banners,
 * dialogs) keeps using the app client and never throws.
 */
export function makePageQueryClient(base: QueryClient): QueryClient {
  const defaults = base.getDefaultOptions()
  return new QueryClient({
    queryCache: base.getQueryCache(),
    mutationCache: base.getMutationCache(),
    defaultOptions: {
      ...defaults,
      queries: { ...defaults.queries, throwOnError: shouldThrowToBoundary },
    },
  })
}
