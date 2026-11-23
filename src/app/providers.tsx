import { useEffect, useState, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { makeStore, type RootState } from '@/app/store'
import { makeQueryClient } from '@/app/queryClient'
import { useAppSelector } from '@/store/hooks'
import { watchSessionTransitions } from '@/app/sessionTransitions'
import { bindAuthSession } from '@/app/authSession'
import { SessionExpiryHost } from '@/app/SessionExpiryHost'
import { AppErrorBoundary } from '@/shared/components/layout/ErrorBoundary'
import { TenantProvider } from '@/modules/tenancy/TenantProvider'

interface AppProvidersProps {
  preloadedState?: Partial<RootState>
  /** Keep the auth session in storage so a reload stays signed in. */
  persistSession?: boolean
  children: ReactNode
}

/** Redux for client state, TanStack Query for server state, the router, the theme and the tenant. */
export function AppProviders({ preloadedState, persistSession = true, children }: AppProvidersProps) {
  const [store] = useState(() => makeStore(preloadedState, { persistSession }))
  const [queryClient] = useState(makeQueryClient)
  // Session transitions clear the query cache, tenant storage and tenant-scoped state (sync, in dispatch).
  useState(() => watchSessionTransitions(store, queryClient, { persist: persistSession }))
  // Token refresh, session expiry (→ /login), offline detection and failed-write toasts.
  useState(() => bindAuthSession(store))
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeRoot>
            <AppErrorBoundary>
              <SessionExpiryHost />
              <TenantProvider>{children}</TenantProvider>
            </AppErrorBoundary>
          </ThemeRoot>
        </BrowserRouter>
      </QueryClientProvider>
    </Provider>
  )
}

const DIR_STORAGE_KEY = 'apexcrm.dir'

/**
 * Text direction for RTL QA (the UI language stays English): `?dir=rtl` / `?dir=ltr` sets it and
 * it is remembered for the browser session. Global, not tenant data.
 */
function resolveDir(): 'ltr' | 'rtl' {
  try {
    const param = new URLSearchParams(window.location.search).get('dir')
    if (param === 'rtl' || param === 'ltr') {
      window.sessionStorage.setItem(DIR_STORAGE_KEY, param)
      return param
    }
    return window.sessionStorage.getItem(DIR_STORAGE_KEY) === 'rtl' ? 'rtl' : 'ltr'
  } catch {
    return 'ltr'
  }
}

function ThemeRoot({ children }: { children: ReactNode }) {
  const theme = useAppSelector((s) => s.ui.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  useEffect(() => {
    document.documentElement.dir = resolveDir()
  }, [])
  return (
    <div className={theme === 'dark' ? 'dark h-full' : 'h-full'}>
      <div className="h-full bg-canvas font-sans text-ink">{children}</div>
    </div>
  )
}
