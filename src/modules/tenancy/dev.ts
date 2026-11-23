/**
 * Dev-only tenant tools (workspace switcher, demo account picker, platform console link).
 * Shown only while the mock API is on (they call mock-only /auth/dev/* endpoints); never against a
 * real backend, not even on the dev server (`VITE_API_MOCK=false npm run dev`).
 */
export const DEV_TENANT_TOOLS = import.meta.env.VITE_API_MOCK !== 'false'

/**
 * Dev-only persistence of the mock DB in IndexedDB (shared/mocks/persist). Dev server with the
 * mock API only: never in a production build (DEV is statically false there, so the dynamic
 * imports behind this flag are dropped) and never under unit tests.
 */
export const DEV_MOCK_PERSISTENCE =
  import.meta.env.DEV && import.meta.env.VITE_API_MOCK !== 'false' && import.meta.env.MODE !== 'test'
