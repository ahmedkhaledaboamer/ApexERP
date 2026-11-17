import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
import './index.css'

/**
 * Until the backend exists, MSW answers `/api/*` in the browser. Set VITE_API_MOCK=false
 * (and VITE_API_URL) to talk to the real server; the mock code is then never loaded.
 */
async function enableMocks() {
  if (import.meta.env.VITE_API_MOCK === 'false') return
  const { worker } = await import('@/shared/mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
}

enableMocks().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </React.StrictMode>,
  )
})
