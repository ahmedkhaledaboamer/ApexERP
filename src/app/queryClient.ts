import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/lib/apiError'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Permission and validation errors will not fix themselves; only retry server errors once.
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      },
    },
  })
}
