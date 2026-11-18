import React from 'react'
import ReactDOM from 'react-dom/client'
import { AppProviders } from '@/app/providers'
import { AppRouter } from '@/app/router'
import { DEV_MOCK_PERSISTENCE } from '@/modules/tenancy/dev'
import './index.css'

/**
 * Until the backend exists, MSW answers `/api/*` in the browser. Set VITE_API_MOCK=false
 * (and VITE_API_URL) to talk to the real server; the mock code is then never loaded.
 */
async function enableMocks() {
  if (import.meta.env.VITE_API_MOCK === 'false') return
  const { worker } = await import('@/shared/mocks/browser')
  // Dev only: the billing simulator's /dev/billing/* endpoints (dropped from the production build).
  if (import.meta.env.DEV) {
    const { devBillingHandlers } = await import('@/shared/mocks/handlers/devBilling')
    worker.use(...devBillingHandlers)
  }
  // Dev only: restore the mock DB saved in IndexedDB before any request is answered.
  // (`import.meta.env.DEV &&` inline so the production build drops this import statically.)
  if (import.meta.env.DEV && DEV_MOCK_PERSISTENCE) {
    const { startMockPersistence } = await import('@/shared/mocks/persist/browser')
    await startMockPersistence(worker)
  }
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true })
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </React.StrictMode>,
  )
}

/** The mock API couldn't start (e.g. the service worker failed to register): say so instead of a blank page. */
function renderStartupError(error: unknown) {
  console.error('[startup] The mock API failed to start.', error)
  const root = document.getElementById('root')!
  root.innerHTML = ''
  const box = document.createElement('div')
  box.setAttribute('role', 'alert')
  box.style.cssText = 'max-width:32rem;margin:15vh auto;padding:1.5rem;font:14px/1.5 system-ui,sans-serif;border:1px solid #e4e4e7;border-radius:0.75rem;background:#fff;color:#18181b'
  const title = document.createElement('h1')
  title.textContent = 'Apex CRM couldn’t start'
  title.style.cssText = 'margin:0 0 0.5rem;font-size:1.125rem'
  const text = document.createElement('p')
  text.textContent =
    'The demo API (a service worker) didn’t start. Reload the page. If it keeps happening, open DevTools › Application › Service workers, unregister mockServiceWorker.js and reload.'
  text.style.cssText = 'margin:0 0 1rem;color:#52525b'
  const detail = document.createElement('pre')
  detail.textContent = error instanceof Error ? error.message : String(error)
  detail.style.cssText = 'margin:0 0 1rem;padding:0.5rem;background:#f4f4f5;border-radius:0.5rem;white-space:pre-wrap;font-size:12px'
  const button = document.createElement('button')
  button.textContent = 'Reload'
  button.style.cssText = 'padding:0.5rem 1rem;border-radius:0.5rem;border:0;background:#7c3aed;color:#fff;cursor:pointer'
  button.onclick = () => location.reload()
  box.append(title, text, detail, button)
  root.append(box)
}

enableMocks().then(renderApp, renderStartupError)
