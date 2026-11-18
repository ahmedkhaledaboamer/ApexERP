import { MutationCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/lib/apiError'
import { tenantQueryKeyHash } from '@/shared/lib/tenantContext'

/** Billing queries (entitlements, overview): usage changes after almost any write. */
export const BILLING_QUERY_KEY = ['billing'] as const

export function makeQueryClient() {
  const client: QueryClient = new QueryClient({
    // Any write can change usage (users, leads & contacts, storage, emails) or hit a limit, so
    // every settled mutation refreshes the billing queries (only active ones refetch).
    mutationCache: new MutationCache({
      onSettled: () => {
        void client.invalidateQueries({ queryKey: BILLING_QUERY_KEY })
      },
    }),
    defaultOptions: {
      queries: {
        // Every cache key includes the active company id (one helper, applied to every query).
        queryKeyHashFn: tenantQueryKeyHash,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Permission and validation errors will not fix themselves; only retry server errors once.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      },
    },
  })
  return client
}
