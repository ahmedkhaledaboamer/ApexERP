# Apex CRM: testing

## Definition of done

A change is done only when all of these hold. A reviewer rejects the change otherwise.

1. **Green checks:** `npm run typecheck`, `npm test` (includes the isolation suites) and `npm run build` pass.
   `npm run test:isolation` alone must pass too; it is the fast gate to run while working.
2. **Every endpoint is in the isolation table.** Adding, renaming or removing a mock endpoint means
   updating `src/shared/mocks/isolation/endpoints.ts` in the same change. The completeness guard fails
   otherwise and prints the entry to add. A company endpoint needs a `sample(co)` request; a public,
   platform, auth or dev endpoint needs a written `reason`.
3. **Tenant scoping is server-side.** The company comes from the session only. A foreign id answers
   exactly like a missing one (404, same body), spoofed company fields are ignored, and lists, counts,
   search, duplicate/unique checks, exports, reports, dashboards, automations and notifications only
   touch the caller's company. New module or endpoint: its isolation tests pass in both directions
   (Apex ⇄ Crest).
4. **Role scopes come from the matrix.** Any change to `PERMISSION_MATRIX` keeps
   `src/app/isolation/permissions.isolation.test.ts` green without editing expected values by hand;
   a new role, module key or scope value must be added to that table (its guard fails otherwise).
5. **Client state is scoped.** New client storage goes through `userStorage.pref` (kept, company +
   user scoped) or `userStorage.data` (wiped on logout, tenant switch and impersonation). New global
   keys must be added to the allowed list in `src/app/isolation/helpers.ts` with a reason.
6. **No secrets in responses.** The secrets guard (every response in the suite) stays green: no
   password fields, no full card numbers (Luhn-checked), API keys masked.
7. **Platform boundary.** New `/platform/*` endpoints go through `requirePlatform(request, permission)`
   with the narrowest permission, take a `reason` for writes and write a platform audit entry.
8. **Docs.** `docs/API.md` describes the endpoint (roles, body, error codes); a deliberate exception
   to isolation is documented there and in the table entry's `reason`.
9. **Fix, don't weaken.** A failing isolation test is a bug in the code until proven otherwise; a test
   is changed only when the behaviour change is intended and documented.

## Running the tests

- `npm test` runs every test (`vitest run`; files `src/**/*.test.ts`).
- `npm run test:isolation` runs the isolation suites only (`vitest run isolation`): the server-side
  suite in `src/shared/mocks/isolation/` and the client-side isolation / role-permission tests in
  `src/app/isolation/`. Both are also part of `npm test`.
- `npm run typecheck` (`tsc -p .`).

On Windows run vitest from PowerShell or cmd (Git Bash's `/e/...` vs `E:\...` drive spelling makes
vitest load modules twice).

## Isolation suite

The server-side isolation suite proves that a company can never see or touch another company
through any endpoint, and it fails when someone adds an endpoint without covering it. It runs the
real MSW handlers in Node (`getResponse(handlers, new Request(...))`): the mock **is** the API
contract (`docs/API.md`, section **Tenant isolation guarantees**).

Fixtures are the two seeded companies: **Apex Aora** (`co_apex`, UAE, AED, Enterprise; admin `u1`)
and **Crest Logistics** (`co_crest`, Saudi Arabia, SAR, Business; admin `u101`), plus the platform
users `p1` Owner, `p2` Support, `p3` Billing. Every test starts from the seed DB and real time
(`useSeedPerTest()` restores the mock DB snapshot and resets the mock clock after each test), so the
tests are order-independent.

### Files (`src/shared/mocks/isolation/`)

| File | What |
|---|---|
| `harness.ts` | `api()` (real handlers; every response goes through the **secrets guard**), tokens per company / role / platform user, `useSeedPerTest()`, `ownership()` / `sliceText(co)` (everything a company owns, for before/after deep-equality), `leaksIn(body, co)` (ids and seed-unique strings of the other company anywhere in a response). |
| `endpoints.ts` | **The coverage table**: one entry per registered handler. |
| `completeness.isolation.test.ts` | §7 guard: every handler is in the table, no stale or duplicate entry, every non-company entry has a reason. |
| `endpointSuite.ts` + `endpoints.0…3.isolation.test.ts` | §1 table-driven tests for every company endpoint, both directions (sharded over 4 files so they run in parallel). |
| `scoped.isolation.test.ts` | §1 targeted: duplicate detection, search and uniqueness per company (+ the platform-wide exceptions), foreign ids inside bodies/queries, exports / reports / dashboard numbers vs an own recomputation, announcement targeting. |
| `automations.isolation.test.ts` | §2 lifecycle, trial reminders, usage warnings, task and renewal alerts, mentions, read-all, the Won flow: one company's tick never touches the other. |
| `platform.isolation.test.ts` | §5 platform boundary and impersonation. |
| `enforcement.isolation.test.ts` | §6 402 / 403 / 423 / lock / 410 per company. |
| `secrets.isolation.test.ts` | §8 GET sweep for every viewer, masked cards, integrations, guard self-tests. |

### What each kind means (and what is tested)

| Kind | Meaning | Tested automatically |
|---|---|---|
| `company-list` | GET of company rows or company state | only own rows: no foreign id or seed-unique foreign string anywhere in the JSON; with `count`, the row count equals an own-company recomputation |
| `company-item` | a company-owned id in the path | every owned `:param` swapped for the other company's id → exactly `404`, byte-identical to a non-existent id; the foreign company's data deep-equal afterwards. Params that are fixed keys (lookup list names, onboarding item ids) go in `notOwned`. |
| `company-write` | create / update / action without an owned path id | spoofing: `companyId`, `company_id`, `tenantId`, `tenant_id`, `tenant` = other company in body and query + `X-Company-Id` / `X-Tenant-Id` headers → ignored or rejected (400/422); nothing changes in the other company and the spoofed id is not stored anywhere |
| `company-search` | duplicate checks, pickers, import checks | as above; value-level scoping in `scoped.isolation.test.ts` |
| `company-export` | exports, reports, dashboard | as lists; key numbers recomputed in `scoped.isolation.test.ts` |
| `public` | no authentication by design (sign-up, plans, workspace lookup) | needs a written `reason` |
| `platform` | `/platform/*` (platform token only) | needs a `reason`; every company role, impersonation token → `401` (platform.isolation) |
| `auth` | sign-in endpoints (no session yet) | needs a `reason` |
| `dev` | dev-only simulation / tenant switcher (no real backend has it) | needs a `reason`; with a `sample` it also runs the company tests |

Every `company-*` entry (and `dev` with a `sample`) also gets, in both directions: no token → `401`;
every platform role → `401`; `X-Workspace` of the other company → `403 tenant_mismatch`; the sample
call answers its `expect` status with no trace of the other company and the other company's whole
owned data (rows, notifications, audit, subscription, invoices, usage counters, per-company
settings…) deep-equal before and after.

### Adding an endpoint

1. Register the handler as usual (`src/shared/mocks/handlers/…`). `npm run test:isolation` now fails
   in `completeness.isolation.test.ts`, listing the missing `METHOD /path` with a ready-to-paste
   entry.
2. Add one entry to `ENDPOINTS` in `src/shared/mocks/isolation/endpoints.ts`, with the path exactly
   as registered (without `/api`) and a `kind`:
   - company endpoint: give `sample: (co) => ({ params, query, body, as, expect })`, a **valid**
     request of a user of `co` naming `co`'s own records (use the helpers at the top of the file;
     `sample` may be async and prepare data through `api()`). Set `expect` when the valid call isn't
     a `200` (e.g. `[200, 409]`). Use `notOwned` for path params that aren't company ids, and
     `count` for lists whose length must match an own recomputation.
   - otherwise: `kind: 'public' | 'platform' | 'auth' | 'dev'` with a `reason` saying why it isn't
     company-scoped.
3. If the endpoint takes ids in its body or query, add a line to `REFS` in
   `scoped.isolation.test.ts`; if it checks uniqueness or computes numbers, add a targeted test there.
4. When a test finds a leak, **fix the mock** (the contract), never the test.

The secrets guard runs on every response of the suite: a new response with a password / hash /
secret / API key / token (outside sign-in), a card number (Luhn) or the demo password fails the test
that produced it. A deliberate exception goes in `ALLOWED_SECRET_KEYS` in `harness.ts` with a reason.
