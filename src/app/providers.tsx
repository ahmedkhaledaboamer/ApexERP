import { useEffect, useState, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { makeStore, type RootState } from '@/app/store'
import { makeQueryClient } from '@/app/queryClient'
import { useAppSelector } from '@/store/hooks'

interface AppProvidersProps {
  preloadedState?: Partial<RootState>
  /** Keep the auth session in localStorage so a reload stays signed in. */
  persistSession?: boolean
  children: ReactNode
}

/** Redux for client state, TanStack Query for server state, the router, and the theme. */
export function AppProviders({ preloadedState, persistSession = true, children }: AppProvidersProps) {
  const [store] = useState(() => makeStore(preloadedState, { persistSession }))
  const [queryClient] = useState(makeQueryClient)
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeRoot>{children}</ThemeRoot>
        </BrowserRouter>
      </QueryClientProvider>
    </Provider>
  )
}

function ThemeRoot({ children }: { children: ReactNode }) {
  const theme = useAppSelector((s) => s.ui.theme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
  return (
    <div className={theme === 'dark' ? 'dark h-full' : 'h-full'}>
      <div className="h-full bg-canvas font-sans text-ink">{children}</div>
    </div>
  )
}
