# Apex CRM: backend handoff

For backend engineers new to this codebase. The frontend was built first against an in-browser mock API (MSW).
**The mock is the contract:** its handlers (`src/shared/mocks/handlers/`), services (`src/shared/mocks/services/`,
the business rules) and the isolation suite (`src/shared/mocks/isolation/`) define what the real API must do.
Everything below is derived from that code; where the code leaves a choice open it is listed under
[Open decisions](#open-decisions).

## Contents

- [Reading order](#reading-order)
- [Backend integration checklist](#backend-integration-checklist)
  - [1. Environment and switching off the mock](#1-environment-and-switching-off-the-mock)
  - [2. Auth and session contract](#2-auth-and-session-contract)
  - [3. Tenant resolution](#3-tenant-resolution)
  - [4. Requests and responses](#4-requests-and-responses)
  - [5. Error envelope](#5-error-envelope)
  - [6. File uploads](#6-file-uploads)
  - [7. Scheduled jobs](#7-scheduled-jobs)
  - [8. Mock-only routes](#8-mock-only-routes)
  - [9. Tenant isolation tests to mirror](#9-tenant-isolation-tests-to-mirror)
  - [10. Definition of done per endpoint](#10-definition-of-done-per-endpoint)
- [Open decisions](#open-decisions)

## Reading order

1. `docs/API.md` › **Multi-tenancy (read first)**, **Production boundary**, **Conventions**, **Auth**.
2. `docs/API-ROUTES.md`: all 942 routes, one line each, grouped by module with a link to the section that specifies
   them. Use it as the implementation checklist.
3. `docs/DB-ALIGNMENT.md` › **Backend quick reference** (tables per module and cross-cutting decisions), then the
   module's gap table.
4. `docs/TESTING.md` › **Isolation suite** (what must hold for every endpoint).
5. `docs/FRONTEND.md` › **Error handling** (what the client does with your statuses).

## Backend integration checklist

### 1. Environment and switching off the mock

| Variable | Values | Effect |
|---|---|---|
| `VITE_API_URL` | a path on the same origin (`/api`, default) or an absolute `http(s)` URL (`https://api.example.com/api`) | axios `baseURL`. Validated at startup (`src/shared/lib/env.ts`); a bad value shows the startup error screen. |
| `VITE_API_MOCK` | `true` (default) / `false` | `false` = talk to the real backend; no MSW, seed data or dev tools are loaded. Anything other than `true` / `false` is a startup error. |

Only these two `VITE_` variables exist (`.env.example`). `E2E_PORT` is Playwright tooling only.

- `npm run build:prod [-- <outDir>]` builds with `VITE_API_MOCK=false` and then runs `npm run check:bundle` on the
  output (`scripts/build-prod.mjs`). `VITE_API_URL` comes from the environment or `.env.production(.local)`; without
  one the app calls `/api` on its own origin (reverse proxy).
- `npm run check:bundle [-- <dir>]` fails if the build still contains mock code: MSW and its service worker,
  `window.__apex*` dev hooks, the dev failure simulator, the billing simulator (`/dev/billing/`), the demo password,
  seed data, mock DB persistence (`scripts/check-bundle.mjs`).
- A plain `npm run build` **keeps the mock** (demo deployments). Never ship that against a real backend.
- Local dev against a backend: `VITE_API_MOCK=false VITE_API_URL=http://localhost:8080/api npm run dev`.
- Hosting: the SPA needs a catch-all rewrite to `index.html` (`vercel.json`).
- **CORS** (cross-origin API): allow the `Authorization`, `Content-Type` and `X-Workspace` request headers and
  expose `X-Request-Id` (`Access-Control-Expose-Headers: X-Request-Id`). Public API callers also send `X-Api-Key`
  (`/public/v1/*`) and the form webhook `X-Client-Id`.
- Timeouts: the client aborts after 20 s (120 s for `/billing/export`, `/leads/import/check`, `/leads/import`).

### 2. Auth and session contract

Full spec: `docs/API.md` › Auth, Session and Refresh, Super-Admin Console › Auth / Impersonation. Client code:
`src/shared/lib/httpSession.ts`, `src/app/authSession.ts`, `src/shared/lib/axios.ts`.

- `POST /auth/login { email, password }` → `Session` or `{ twoFactorRequired: true, challengeId }`;
  `POST /auth/login/2fa { challengeId, code }` → `Session`. The workspace comes from the address (`X-Workspace`),
  never the body; on the bare domain an email in several workspaces → `409 workspace_required`.
- `Session = { token, refreshToken?, expiresAt?, user, tenant, impersonation }` (camelCase: auth payloads are not
  converted to snake_case).
- **Access token**: `Authorization: Bearer <token>`, short-lived, `expiresAt` ISO. Expired → `401` with
  `code: "session_expired"`.
- **Refresh**: `POST /auth/refresh { refreshToken }` (no `Authorization` needed) → a new `Session` with a new access
  token, a **rotated** refresh token and `expiresAt`. `401 session_expired` when invalid / expired / revoked, user
  deactivated or no longer a member of the token's company; `403 workspace_suspended`; `410 workspace_deleted`.
  The mock is stateless (`services/auth.ts › refreshSession`): **the backend must implement single use + reuse
  detection** (an already-rotated refresh token revokes the whole session family). Mock lifetimes: access 12 h,
  refresh 30 days (`src/shared/mocks/server.ts`); pick your own (e.g. 15 min / 30 days).
- **Client behaviour**: refreshes one minute before `expiresAt`; on a `401` of a request that carried the token
  (not `/auth/login*`, `/auth/refresh`, `/auth/dev/*`, `/platform/*`, `/public/*`, nor `impersonation_*` codes) it
  makes **one** single-flight refresh and retries once; if that fails it signs out and sends the user to `/login`.
  A network error / 5xx during refresh keeps the session.
- **Storage**: the session (access + refresh token) is kept by the client in `localStorage` under
  `apexcrm.session` (`src/shared/lib/axios.ts › readStoredSession`). See open decision D-3.
- **Sign-out**: the client clears its state only; there is **no logout call** (open decision D-4).
- Deactivated users get `401` on every request, even with an older token. Membership is re-checked on every request
  (a user moved to another company must sign in again).
- **Impersonation** (support sessions) tokens have no `refreshToken` / `expiresAt`; they end with
  `401 impersonation_expired` / `impersonation_ended`; read mode → `403 impersonation_read_only`, sensitive paths →
  `403 impersonation_blocked` (`services/impersonation.ts`).
- **Platform console** (`/platform/*`) uses its own token (`POST /platform/auth/login`). A platform token gets `401`
  on every company endpoint and a company token `401` on every `/platform/*` endpoint.
- `POST /auth/switch-role` is a demo feature: omit it (see §8).

### 3. Tenant resolution

What the mock does (`handlers/utils.ts › userFrom`, the reference for every authenticated request):

1. token → user (`401` if missing / expired / deactivated);
2. user → **active membership** → `company_id` (the token's company must equal the membership's, else `401`);
3. company missing → `404 workspace_not_found`; suspended by the operator → `403 workspace_suspended`;
4. the `X-Workspace` header (the subdomain the app was opened on; the client sends it on every request) must be that
   company's current subdomain or a still-redirecting old one, else `403 tenant_mismatch`;
5. impersonation rules, then the billing request policy: `410 workspace_deleted`, `403 module_not_in_plan`,
   `423 workspace_read_only` for writes while suspended / cancelled.

**The company id never comes from the client** (body, query or path); spoofed `company_id` / `tenant_id` fields and
`X-Company-Id` / `X-Tenant-Id` headers are ignored. The client resolves the workspace from the host
(`<subdomain>.apexcrm.app`, reserved: `www app platform admin api`), from `/w/<subdomain>` on the bare domain, or in
dev from `?workspace=` (`src/shared/lib/tenantContext.ts › resolveWorkspace`). Public endpoints resolve the company
from their token / key / subdomain. How production derives the tenant is open decision D-1.

### 4. Requests and responses

- JSON both ways. Success = the resource as bare JSON (no `{ data }` envelope, except `/public/v1/*`), status `200`
  in the mock for every success.
- **snake_case on the wire** for every company endpoint (the design's column names); the client maps them in one
  layer (`src/shared/api/mapping.ts`, `src/shared/api/*Mappers.ts`). Still camelCase: `/auth/*`, `/tenant`,
  `/users`, `/account*`, `/alerts*`, `/public/workspaces/:subdomain`, the sign-up completion session,
  `/platform/*`, `/dev/*`, and **all error bodies** (never mapped; e.g. `LIMIT_REACHED` carries `planId`,
  `missing_values` carries `missingAr`). See open decision D-9.
- Query parameters are snake_case. Dates ISO-8601; date-only `yyyy-MM-dd` (company-local calendar dates where the
  API says so); months `yyyy-MM`. Money in the company currency. IDs are opaque strings (the mock's prefixed ids
  such as `L-1001`, `JV-…` are not a requirement).
- **No pagination**: lists return every visible row; the client pages / sorts / filters in the browser. Some logs
  are capped (stated per endpoint). Open decision D-8.
- Unknown body fields are never stored (updates whitelist their fields). Enums are lower-case snake values;
  anything else → `422`.

### 5. Error envelope

```json
{ "message": "Human readable reason", "code": "machine_reason", "requestId": "req_…", "...": "extra fields" }
```

- `message` is required and is **shown to the user as-is for 4xx**: write it for end users.
- `code` is optional and stable; the UI branches on it. Extra fields are top-level siblings (e.g. `LIMIT_REACHED`
  adds `limit`, `current`, `max`, `planId`; `module_not_in_plan` adds `module`, `planId`; `workspace_read_only`
  adds `status`). The full list of codes the mock throws is in `docs/API-ROUTES.md` › Error code catalog (238 codes,
  status + service + message).
- Codes the client handles globally, whatever the endpoint: `session_expired` (refresh, then `/login`);
  `workspace_not_found`, `tenant_mismatch`, `workspace_suspended`, `workspace_deleted` (full-page screens,
  `tenantContext.ts`); `LIMIT_REACHED`, `module_not_in_plan`, `workspace_read_only` (upgrade prompt,
  `billingEvents.ts`); `impersonation_read_only`, `impersonation_blocked`, `impersonation_expired`,
  `impersonation_ended` (support banner, `impersonationEvents.ts`).
- Statuses in use: `400` bad query, `401` signed out / expired, `402` plan limit or card declined, `403` no
  permission, `404` not found **and another company's record** (same body), `405` (plans are never deleted),
  `409` conflict / wrong state, `410` deleted workspace or expired 2FA challenge, `422` validation / rule,
  `423` read-only workspace or `period_locked`, `429` rate limited (`retry_after` where stated).
- **5xx: generic message with a reference id.** The client never shows server text for 5xx (or timeouts); it
  shows "Something went wrong on our side. Try again." plus "(Reference: <id>)" when the response has an
  `X-Request-Id` header (read first) or a `requestId` field in the body. Put an `X-Request-Id` on **every** response,
  log it with the error, and expose it through CORS. Reads are retried up to 2 times on network / timeout / 5xx;
  writes are never retried, so make writes safe to repeat by the user (the Won flow takes an `idempotencyKey`).
- No response / timeout are reported by the client itself (`status 0`, `network_error` / `timeout`).

### 6. File uploads

- The client never sends `multipart/form-data`. Files are JSON: metadata (`name`, `mime_type`, `size_bytes`) plus a
  base64 `data:` URL where content is sent (branding logos / favicon, bill attachments, brand assets, design-request
  attachments, HR employee documents) or metadata only (CVs, task attachments; certificates take a `file_url`).
- Limits are per endpoint (e.g. bills: pdf / png / jpeg / webp ≤ 512 KB, ≤ 10 per bill; task attachments ≤ 25 MB);
  branding checks magic bytes against the declared type. Every upload counts toward the plan's `storageMb`
  (`402 LIMIT_REACHED` when full).
- Imports are parsed in the browser and posted as JSON rows (leads, event attendees, SEO keywords) or as CSV text
  (attendance, bank statements).
- Sensitive values (employee document numbers, IBANs, bank account numbers) are stored in full, **served masked**,
  and only revealed by audited `POST …/reveal` endpoints (`/hr/employees/:id/reveal`, `/hr/documents/:id/reveal`,
  `/hr/profile-changes/:id/reveal`, `/hr/payroll/profiles/:id/reveal`, `/finance/bank-accounts/:id/reveal`,
  `/finance/suppliers/:id/reveal-iban`) and the bank-file exports (`/hr/payroll/runs/:id/bank-file`,
  `/finance/payment-runs/:id/bank-file`).
- Storage backend (object storage, pre-signed uploads, virus scanning) is open decision D-7.

### 7. Scheduled jobs

The mock has no scheduler: time-based work runs **lazily and idempotently** for the caller's company on every
authenticated request (`services/billing.ts › runLifecycle`, hooks registered with `onLifecycleTick`), and for all
companies on `POST /dev/billing/advance`. A backend needs real scheduled jobs (per company, in the company's
timezone where the rule says "company day"), each idempotent like the mock's:

| Hook | What it does | Service |
|---|---|---|
| (billing lifecycle) | trials, renewals, past-due / grace, suspension, cancellation, deletion, reminders, usage warnings | `services/billing.ts` |
| `quotations.expiry` | sent / viewed quotations past `valid_until` → `expired` | `services/quotations.ts` |
| `marketing.queue` | bulk-email sending queue (fair round-robin across companies) | `services/marketing.ts` |
| `marketing.ads` | daily ad-account sync | `services/ads.ts` |
| `events.reminders` / `events.logistics` / `events.sponsors` | event reminders, logistics deadlines, sponsor deliverables | `services/eventComms.ts`, `eventLogistics.ts`, `eventSponsors.ts` |
| `finance.recurring-invoices` | generate / issue recurring invoices | `services/financeInvoices.ts` |
| `finance.dunning` / `finance.pdc-reminders` / `finance.bill-due-reminders` | payment reminders, PDC due, bills due | `financeReceivables.ts`, `financeCollections.ts`, `financePurchases.ts` |
| `finance.eosb-provision` | monthly end-of-service provision posting | `services/financeEosb.ts` |
| `hr-people-alerts` / `hr-journey-alerts` / `hr-performance` / `hr-engagement` / `hr-policy-reminders` | document expiry, onboarding / offboarding, review deadlines, surveys, policy acknowledgement reminders | `hrPeopleAlerts.ts`, `hrJourney.ts`, `hrPerformanceTick.ts`, `hrEngagementTick.ts`, `hrCompliance.ts` |
| `integrations` | outgoing-webhook outbox pump and retries, WhatsApp template review | `services/integrationsDeveloper.ts` |

Several reminders are "once only": the mock keeps dedupe marks (DB-ALIGNMENT › Backend quick reference, X-8). Outgoing webhooks should come
from a transactional outbox (API.md › Integrations › What the real backend must do).

### 8. Mock-only routes

Never implement `/auth/dev/accounts`, `/auth/dev/sign-in` and the six `/dev/billing/*` routes. Omit
`/auth/switch-role`; replace `/integrations/whatsapp/inbound` with the Meta webhook; keep `/ai/credits/consume`
internal. Add the backend-only routes the mock doesn't serve (payment-gateway webhooks, WhatsApp webhook, OAuth
callbacks, ad lead webhooks). Details and reasons: `docs/API.md` › Production boundary.

Frontend follow-up for a real backend: the WhatsApp "Simulate an inbound message (demo)" control
(`src/modules/integrations/components/WhatsAppPanel.tsx`) is not gated by `VITE_API_MOCK`.

### 9. Tenant isolation tests to mirror

The mock's isolation suite (`npm run test:isolation`) runs the real handlers against two seeded companies,
**Apex Aora** (`co_apex`, UAE / AED, admin `u1`) and **Crest Logistics** (`co_crest`, KSA / SAR, admin `u101`),
in both directions. Port the same properties to the backend's feature tests (e.g. two tenants seeded per test):

1. **Coverage guard**: every route is in a coverage table with a kind (`company-list`, `company-item`,
   `company-write`, `company-search`, `company-export`, or `public` / `auth` / `platform` / `dev` with a written
   reason); a new route without an entry fails the build (`completeness.isolation.test.ts`). The kinds are listed per
   route in `docs/API-ROUTES.md`.
2. **Foreign path ids → 404, byte-identical to a missing id**, and the other company's data unchanged
   (`company-item`; `endpointSuite.ts`).
3. **Spoofing ignored**: `companyId` / `company_id` / `tenantId` / `tenant_id` / `tenant` in body and query and
   `X-Company-Id` / `X-Tenant-Id` headers never change the target company and are never stored (`company-write`).
4. **Lists, counts, searches, exports, reports, dashboards** contain only own rows and their totals equal an
   own-company recomputation (`company-list`, `company-export`, `scoped.isolation.test.ts`).
5. **Foreign ids inside bodies / queries** (owner, department, customer, lead, template…) behave as non-existent
   (`REFS` in `scoped.isolation.test.ts`).
6. **Uniqueness per company** (duplicate leads, list keys, service / package / department / template names); the
   documented platform-wide exceptions are user emails and subdomains.
7. **Every company route**: no token → `401`; platform token → `401`; `X-Workspace` of the other company →
   `403 tenant_mismatch` (`endpointSuite.ts`).
8. **Automations never cross tenants**: one company's lifecycle tick, reminders and notifications touch only that
   company (`automations.isolation.test.ts`).
9. **Enforcement per company**: `402` / `403 module_not_in_plan` / `423` / `410` affect only that company
   (`enforcement.isolation.test.ts`).
10. **Platform boundary and impersonation** (`platform.isolation.test.ts`).
11. **No secrets in any response**: passwords / hashes, tokens outside sign-in, API keys after creation, integration
    credentials (write-only, answered as hints), full card numbers (Luhn-checked) (`secrets.isolation.test.ts`,
    `harness.ts › integrationSecretsIn`).
12. **Roles**: every role × both companies against `PERMISSION_MATRIX` (`src/app/isolation/*.isolation.test.ts`,
    `permissions.isolation.test.ts`); special cases such as anonymous engagement surveys
    (`hrEngagementAnonymity.isolation.test.ts`).

The samples in `src/shared/mocks/isolation/*Endpoints.ts` are ready-made valid requests per endpoint.

### 10. Definition of done per endpoint

Implements the API.md section (body, response, permission, error codes); company from the session only; in the
backend's coverage table with its kind; isolation properties above green both ways; no secret in the response;
audited where API.md says so; the frontend works against it with `VITE_API_MOCK=false` (`npm run build:prod`).

## Open decisions

Things the code does not settle. Each needs an owner before the backend implements the area.

| # | Decision | What the code does today | Where |
|---|---|---|---|
| D-1 | **How the tenant is resolved in production**: from the request host (subdomain), from the user's active membership, or both. | Both: the company comes from token → active membership, and the subdomain (`X-Workspace`, standing in for `Host`) must match it, else `403 tenant_mismatch`. One active membership per user; email is platform-unique. If the API lives on another host (`api.apexcrm.app`), `Host` can't carry the workspace, so keep `X-Workspace` or move the API under each subdomain. Multi-company users would need a company switcher and token per company. | API.md › Multi-tenancy; `handlers/utils.ts › userFrom`; `tenantContext.ts`; DB-ALIGNMENT ID-1, PB-6 |
| D-2 | **`company_id` on every tenant table** and how it is enforced (global query scope, row-level security, or repository discipline). | Every mock store row is `Tenant<T>` with `companyId`; one known exception `AgentTarget`. Seeded chart-of-accounts ids (`ACC-<code>`) are shared across companies (rows are still scoped). | DB-ALIGNMENT › Backend quick reference; Design-gap Summary; F-L1 |
| D-3 | Token transport and storage: bearer tokens in `localStorage` vs httpOnly cookies (+ CSRF). | Bearer header; session stored in `localStorage` (`apexcrm.session`). | `src/shared/lib/axios.ts` |
| D-4 | Sign-out endpoint and refresh-token revocation. | No `POST /auth/logout` in the mock or client; it is only named in the impersonation read-mode exemptions. | `services/impersonation.ts`; API.md › Production boundary |
| D-5 | OAuth redirect contract (email, calendar, ads). | Mock consent dialog posts `{ state, approve }` / `consent: true`; no provider redirect or callback route. | API.md › Integrations, Ads integrations |
| D-6 | **System accounts** in the chart of accounts. | `accounts.system_role` (one active account per role per company); some accounts (2210 VAT payable, 6960 tax expense) are created on first use instead of seeded, and unusable ones answer `409 missing_tax_account` / `vat_payable_account` / `tax_expense_account`. Seed them per country template? | DB-ALIGNMENT F-L1, F-T4 |
| D-7 | File storage. | JSON bodies with base64 data URLs or metadata only; nothing in object storage. | §6; DB-ALIGNMENT FI-1…3, F-E4, F-P9 |
| D-8 | Server-side pagination. | None; full lists, client-side paging. | API.md › Conventions |
| D-9 | Casing of error-body extra fields and session payloads. | Error bodies, auth / tenant / platform payloads stay camelCase (`planId`, `missingAr`); API.md mentions `missing_ar`. | API.md › Conventions; DB-ALIGNMENT › Not converted |
| D-10 | **Document numbering sequences.** | Per company, per series, per year (`<PREFIX>-INV-yyyy-nnnn`, `JV-yyyy-nnnn`, HR letters / discipline per year); quotations still use one global sequence; AI ids one global counter. Gapless? Reset per fiscal or calendar year? | DB-ALIGNMENT F-L3, QC-5, H-SS4, H-DC3, AI-6 |
| D-11 | **Period locks.** | One `lock_date` per company (`423 period_locked` for postings on or before it); year-end close moves it; reversal lock is checked only on some sources. Per-period (`accounting_periods`) locks and payroll locks are not modelled. | DB-ALIGNMENT F-L6, F-B16, F-S1 |
| D-12 | Scheduler design. | Lazy per-request lifecycle tick; needs real jobs, per company timezone. | §7 |
| D-13 | AI credits: per message or token-based. | 1 credit per message. | DB-ALIGNMENT AI-7 |
| D-14 | Finance settings vs company profile as the source of `vat_number` and the Arabic legal name. | Kept separately in the mock. | DB-ALIGNMENT F-L4, H-SS9 |

The per-module gaps (tables and columns the design lacks) are in `docs/DB-ALIGNMENT.md`; the quick reference at its
top maps each module to them.
