# Apex CRM: frontend notes

## Error handling

One layer handles sessions, failed requests and crashes, so feature code mostly doesn't have to.

**Every API failure is an `ApiError`** (`src/shared/lib/apiError.ts`) with `status` (0 = no response),
`code` (server reason, or `network_error` / `timeout` / `canceled`), `requestId` (`X-Request-Id`) and the
response body as `details`. The axios layer (`src/shared/lib/httpSession.ts`) already rewrites the message:

| Failure | `message` the UI shows |
|---|---|
| 4xx | the server's `message` (written for users) |
| 5xx, timeout | "Something went wrong on our side. Try again." + "(Reference: <request id>)" when the server sent one |
| no response | "We couldn’t reach the server. Check your connection and try again." |

For any other thrown value use `friendlyErrorMessage(error)`; never show a raw `TypeError` text.

**Retries** (`src/app/queryClient.ts`): queries retry up to 2 times (1 s, 2 s backoff) on network / timeout / 5xx,
never on 4xx (`shouldRetryQuery`). Mutations never retry and never wait for the network (`networkMode: 'always'`):
offline, a write fails at once; with no `onError` of its own it gets one "Not saved: you’re offline" toast.

**Session** (docs/API.md › Auth › Session and Refresh): proactive refresh before `expiresAt`, one single-flight
refresh on a 401, then retry. If that fails: sign-out and `/login` with `state.from` and the notice
"Your session expired. Sign in again." (`SessionExpiryHost`). Platform console requests carry their own token and
keep their own 401 handling (`modules/platform/api.ts`).

**Error boundaries** (`src/shared/components/layout/ErrorBoundary.tsx`):

- `RouteErrorBoundary` wraps the routed page inside `AppLayout`. A render crash, or a query with **no data** that
  failed with a network / 5xx error (`shouldThrowToBoundary`), shows `PageErrorCard` ("Try again" / "Reload")
  while the sidebar and header keep working. It clears when you navigate. Pages get a query client that shares the
  app's cache but throws those errors to the boundary, so a page can't sit on a skeleton forever; the shell (header,
  sidebar, banners, dialog hosts) uses the app client and never throws.
- `QuietBoundary` around banners and dialog hosts: a crash there hides that piece only.
- `AppErrorBoundary` around everything (last resort), and the startup screen in `main.tsx` for a bad configuration
  or a mock that couldn't start.
- Page-level 4xx states (not found, no access) stay the page's own UI (`ErrorState`, `EmptyState`).

**Reporting:** everything caught goes through `reportError(error, { source })` (`src/shared/lib/reportError.ts`):
console today; `setErrorReporter()` plugs in Sentry or similar. Expected API failures are not reported as crashes.

**Offline:** `OfflineBanner` (in the layout) shows "You’re offline — changes will be retried when you’re back" while
the browser is offline or requests get no response (`src/shared/lib/networkStatus.ts`). Reads pause and resume
when the connection is back; writes are not queued.

**Dev hooks** (mock API + dev server only, never in a production bundle — `npm run check:bundle`):
`window.__apexAuth.expireAccessToken() / expireSession()` and
`window.__apexMock.fail('/customers', 500, { requestId })` / `fail(path, 'network')` / `clear()`.
Used by `e2e/session.spec.ts`.

## Backend integration

The checklist for connecting a real backend (env vars, `npm run build:prod` / `check:bundle`, auth and refresh
contract, error envelope and request ids, uploads, scheduled jobs, tenant isolation tests to mirror, open decisions)
is in [BACKEND-HANDOFF.md](BACKEND-HANDOFF.md). Every route the mock serves: [API-ROUTES.md](API-ROUTES.md).
