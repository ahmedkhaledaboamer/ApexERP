# Apex CRM: API contract

The frontend calls these endpoints. Until the backend exists, MSW answers them in the browser
(`src/shared/mocks/handlers/`). Build the backend to match this file. Then set the following
in `.env` and nothing else changes:

```
VITE_API_URL=https://your-backend/api
VITE_API_MOCK=false
```

The TypeScript types in `src/shared/types/index.ts` and `src/modules/*/types.ts` are the exact
JSON shapes and the source of truth. The mock implementations in `src/shared/mocks/services/`
show the business rules each endpoint must enforce.

## Multi-tenancy (read first)

Apex CRM is multi-tenant. Every company is a **tenant**; Apex Aora is the first one. Types:
`src/modules/tenancy/types.ts` (`Company`, `Branding`, `RegionalSettings`, `Membership`,
`PlatformRole`, `ImpersonationInfo`). Reference implementation: `src/shared/mocks/tenant.ts`,
`src/shared/mocks/handlers/utils.ts` (`userFrom`), `src/shared/mocks/services/auth.ts`.

**Resolving the tenant**

- The tenant is derived on the server from the session token: token → user → the user's
  **active membership** (`{ userId, companyId, role, status }`) → company. A user has exactly one
  active membership for now; the role comes from the membership.
- The workspace address is `<subdomain>.apexcrm.app`. The client also sends it as
  `X-Workspace: <subdomain>` (in dev it stands in for the Host header). If a signed-in token's
  company isn't the company of that address (its current subdomain, or an old one that still redirects, see
  Super-Admin Console › Subdomain aliases) → `403 { code: "tenant_mismatch" }`. Unknown
  subdomain → `404 { code: "workspace_not_found" }`. Suspended company →
  `403 { code: "workspace_suspended" }`. The UI turns these codes into full-page screens.
- `POST /auth/login` on a workspace address looks the email up **inside that company** (an account
  of another company is "wrong email or password"). On the bare domain the email must identify one account,
  otherwise `409 { code: "workspace_required" }`.

**Rules every endpoint follows**

1. **The client never sends a company id**: not in the body, query or path. If a body contains
   `companyId`, the server ignores it. New records are stamped with the caller's company.
2. **Every list, search, count, aggregate, export and alert is filtered to the caller's company.**
3. **A record of another company answers `404` with the same "not found" message as a missing
   one** (never `403`), for reads and for writes, so ids can't be probed across tenants. Ids
   referenced in a body (owner, manager, department, service, customer, lead, project, template…)
   that belong to another company are treated as non-existent.
4. **Uniqueness is per company:** duplicate-lead detection, fixed-list keys/labels,
   service codes/names, package, department and template names. The same value in another company
   is fine. Platform-wide exceptions (by design): user emails and workspace subdomains, see
   **Tenant isolation guarantees**.
5. Ids are opaque strings and globally unique.
6. Per-company configuration: fixed lists and automation rules, security policy, targets
   defaults, templates, report schedules, service catalog, departments.
7. Money is in the company currency (`regional.currency`), VAT defaults to `regional.vatPct`,
   phones are validated and formatted for `regional.country` (`src/shared/lib/phone.ts`), dates
   are shown in `regional.timezone` with `regional.dateFormat`, and outgoing email uses
   `branding.emailSenderName <emailSenderAddress>`.
8. Modules not in the company's plan are hidden in the UI and the server answers
   `403 { code: "module_not_in_plan", module, planId }` for their endpoints. Plan limits and the
   subscription status are enforced by the API too (`402 LIMIT_REACHED`, `423 workspace_read_only`,
   `410 workspace_deleted`): see **Plans, limits and subscription lifecycle**.

**Tenant endpoints**

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/tenant` | | `Company` of the caller (branding, regional settings, plan, status, enabled modules, `profile`: see Settings: company profile). |
| POST | `/public/signup` (+ `/verify`, `/complete`…) | `SignupStartInput` | No auth: self-service sign-up in steps; see Self-service sign-up. |
| GET | `/public/workspaces/:subdomain` | | `PublicCompany` (no auth): name, status, branding for the login page (display name, monogram, palette, `logoUrl` / `logoDarkUrl` / `faviconUrl`; see Settings: branding). For an old subdomain that still redirects, the company with `redirectTo: "<current subdomain>"` (the client redirects there). `404 workspace_not_found`. |

`Session` (login, 2FA, switch-role, impersonation) is
`{ token, user, tenant: Company, impersonation: ImpersonationInfo | null }`; `user.companyId` is
informational and always equals `tenant.id`.

**Platform (the operators of Apex CRM itself)**

Platform roles (**Platform Owner**, **Platform Support**, **Platform Billing**) are a separate
permission set (`PLATFORM_PERMISSIONS`), never mixed with company roles: a platform user has no
company role, a platform token can't call tenant endpoints (`401`) and a tenant token (impersonation
tokens included) can't call `/platform/*` (`401`). Every platform endpoint, the permission matrix and
the impersonation rules are in **Super-Admin Console (platform)**.

**Client storage rules** (`src/shared/lib/tenantContext.ts`, `src/shared/lib/storage.ts`,
`src/app/store.ts`, `src/app/sessionTransitions.ts`; tests in `src/app/storageScope.test.ts`):

| What | Key | Sign-in | Sign-out | Tenant switch | User switch / impersonation |
|---|---|---|---|---|---|
| TanStack Query cache (every key hashed with the company id) | memory | cleared | cleared | cleared | cleared |
| UI preferences: saved table views (visible columns, column order, sorting, filters, page size), sidebar, theme, form defaults, dismissed hints (`userStorage.pref`) | `<companyId>:<userId>:apexcrm.pref.<key>` | kept, the user's own set is loaded | kept | kept | kept, the incoming user's own set is loaded |
| User data: unsaved form drafts, cached lead/customer records, per-session flags (`userStorage.data`) | `<companyId>:<userId>:apexcrm.data.<key>` | kept | **wiped** | **wiped** | kept (unreadable by the other user) |
| Tenant-scoped Redux state | memory | reset | reset | reset | reset |
| Global: `apexcrm.session`, `apexcrm.platform`, `apexcrm.workspace`, `apexcrm.device` (last theme for the login screen only) | `apexcrm.<key>` | | | | |

Reads and writes always use the **active** company and user, so another company's or another
user's scoped keys are never read. Feature code never touches `localStorage`/`sessionStorage`
directly. The dev-only mock database lives in IndexedDB and is not part of these rules.

**Dev only (mock):** `GET /auth/dev/accounts` (seeded accounts grouped by company) and
`POST /auth/dev/sign-in { userId }` back the dev tenant switcher. A real backend must not expose them.

### Tenant isolation guarantees

What the backend guarantees, and what the isolation suite (`npm run test:isolation`, see
`docs/TESTING.md` › Isolation suite) proves against this contract for every endpoint, in both
directions between two companies:

- **Foreign ids are 404, byte-identical to a missing id.** A path id (`:id`, `:userId`, `:goalId`,
  `:attachmentId`…) of another company answers exactly `404` (never `403`, `409` or `422`) with the
  same body as an id that doesn't exist, and the foreign record is unchanged. Ids of another company
  inside a body or a query (owner, manager, follower, department, customer, lead, service, quotation,
  template, report filters…) behave exactly like non-existent ids: same status, same message.
- **Spoofed company fields are ignored.** `companyId`, `company_id`, `tenantId`, `tenant_id` or
  `tenant` in a body or query, and `X-Company-Id` / `X-Tenant-Id` headers, are ignored (or the
  request is rejected as invalid input); the tenant always comes from the session. Records are
  created in the caller's company, and unknown body fields are never stored (updates whitelist their
  fields: no mass assignment). `X-Workspace` naming another company → `403 tenant_mismatch`.
- **Lists, searches, counts, exports, reports, dashboards and alerts** contain only the caller's
  company's rows, and their totals equal an own-company recomputation.
- **Uniqueness is scoped to the company** (duplicate leads, import duplicate detection, list values,
  service / package / department / template names): a value that exists only in another company is
  not a duplicate. **Documented platform-wide exceptions:** a user email belongs to one account on
  the whole platform (one email = one login), so `POST /settings/users` and sign-up answer
  `409 { code: "email_taken" }` for an email used in another company, with a message that never
  names that company; a workspace subdomain is unique platform-wide (`/public/signup/availability`
  answers available / taken only, never who holds it).
- **Automations never cross tenants.** The subscription lifecycle, trial and renewal reminders,
  usage warnings, task due / overdue reminders, mentions and assignment notifications of one
  company read and write that company only; notifications go to that company's users only.
- **Enforcement is per company.** `402 LIMIT_REACHED`, `403 module_not_in_plan`,
  `423 workspace_read_only`, the operator lock (`403 workspace_suspended`, sign-in refused) and
  `410 workspace_deleted` apply to the one company; every other company keeps working.
- **Platform boundary.** Company tokens (every role) → `401` on every `/platform/*` endpoint;
  platform tokens → `401` on every company endpoint. An impersonation token is bound to one user
  of one company: other workspaces → `tenant_mismatch`, their ids → `404`, `/platform` → `401`,
  read-only until write mode, password / 2FA / sessions / billing writes / exports always blocked,
  and it expires on time.
- **No secrets in responses.** No password, hash, secret, API key or token (except the session
  token of sign-in responses), no card number (cards are brand + last 4), never the demo password.
  Accepted exceptions: the TOTP secret of `POST /security/2fa/setup` and the one-time recovery
  codes of `POST /security/2fa/verify`, shown once to the user enrolling their own account.

## Conventions

- **Auth:** `Authorization: Bearer <token>` on every request except login. The server decides
  the tenant (company) and the record scope (own / team / full) from the token's user, membership
  and role. The client never sends either.
- **Errors:** non-2xx with body `{ "message": "Human readable reason" }`. The UI shows `message`
  as is; tenant errors add a `code` (see Multi-tenancy). Status codes in use: `400` bad query,
  `401` signed out, `402` plan limit reached (`LIMIT_REACHED`) or card declined, `403` no permission (or `module_not_in_plan`),
  `404` not found (also for another company's record), `409` conflict (duplicate or wrong state), `410` workspace deleted,
  `422` validation or rule failure, `423` workspace read-only (suspended / cancelled subscription),
  `5xx` server error (retried once). Some errors carry extra fields next to `message` and `code` (e.g. `limit`, `current`,
  `max`, `planId`); the client keeps the whole body on the error as `details`.
- **Dates:** ISO-8601 strings (`2026-11-17T09:00:00.000Z`); date-only fields are `yyyy-MM-dd`,
  months are `yyyy-MM`. Money is in the company currency (`tenant.regional.currency`; AED for Apex Aora).
- **IDs:** strings.
- **Scope:** unless noted, Sales/CRM endpoints are scoped by the caller's `sales` permission
  (own / team / full); a hidden scope gets `403`. Writes need `edit` (or `create`) on `sales`.
- **Lookup keys:** lead `status`, `sourceType`, `industry`, `subIndustry` and `lossReason` (and the
  customer copies of industry/source) are **keys of the fixed lists** (`GET /lookups`), never free
  text. The server validates them on create / update / import and answers `422` when a value isn't
  an **active** list item; an unchanged value on an existing record is accepted even if it has
  since been deactivated. Labels are display-only; clients look them up by key. Built-in status
  keys are stable (`New`, `Contacted`, `No response`, `Call later`, `Interested`, `Meeting`,
  `Proposal`, `Cold`, `Won`, `Lost`, `Not interested`); open/closed logic uses the status `kind`
  (`open`, `parked`, `won`, `lost`), forecasts use its `probability`, and stage moves enforce its
  `requires`. `sourceType` (list key) and `sourceDetail` (free text: link or name) are separate fields.

## Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` (the workspace comes from the address / `X-Workspace`, never the body) | `Session`, or `{ twoFactorRequired: true, challengeId }` when the account has 2FA on. `401` wrong credentials; `403` "This account is deactivated." Challenge valid 5 minutes. |
| POST | `/auth/login/2fa` | `{ challengeId, code }` | `Session`. `code` = 6-digit OTP or an unused recovery code (single use, audited). `401` wrong code; `429` after 5 wrong codes; `410` expired/used challenge. |
| GET | `/auth/me` | | `User` |
| POST | `/auth/switch-role` | `{ role }` | `Session` for the seeded user with that role **in the caller's company** (dev or demo only, may be omitted in production; skips 2FA; `404` if the company has no active user with that role) |
| GET | `/users` | | `User[]` of the caller's company only (includes `active`; pickers should hide deactivated users) |

Every authenticated request from a deactivated user gets `401`, even with a token issued earlier.

## Leads

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/leads` | | `LeadRow[]` | Scoped. `403` if hidden. Each row has `reopenEligible: boolean`: true for a lead whose status kind is `lost` and whose `stageChangedAt` is at least `lostReopenDays` ago (Settings > Automation). |
| POST | `/leads` | `QuickAddInput` or `LeadCreateInput` (contacts[], website, sourceDetail, subIndustry, ownerId, value, nextFollowUpDate, nextStep, companyServices, serviceIds, recommendedServiceId, doNotContact, note, force) | `LeadRow` | Status always the first open status (`New`). Owner auto-assigned to the least-loaded Sales Agent unless a manager (sales scope full/team) picks one. Lists validated against the **active** lookups (source, industry, sub-industry belongs to industry; `422`), mobile valid for the company country, email format, ≥1 named contact. `serviceIds` / `recommendedServiceId` must be **active** catalog service ids (`422`); never free text. `409` on duplicate (within the company only); `force` only for managers (else `403`). `note` becomes a Note. |
| GET | `/leads/duplicates` | `?company=&email=&emails=a,b&website=&excludeId=` | `DuplicateMatch[]` (reason `company`/`domain`/`email`) | Checks **all** leads, not just the caller's scope. Company names normalized (drop LLC, FZE…). Domain from website/email; free-mail domains (gmail, outlook, hotmail, yahoo, icloud, live…) ignored. |
| GET | `/leads/owners` | | `LeadOwnerOption[]` `{id,name,title,role,openLeads}` | Needs sales create. Full: everyone who sells; team: the team; own: only the caller. Deactivated users are never listed, auto-assigned or accepted as owner (`422`). |
| GET | `/leads/:id` | | `LeadDetail` (+ `website`) | `404` / `403` outside scope. |
| PATCH | `/leads/:id` | `LeadUpdateInput` + `contacts[]` (replaces all), `website`, `doNotContact`, `force` | `LeadRow` | Changed source/industry/sub-industry must be active lookup items (`422`). `serviceIds` (replaces the list) and `recommendedServiceId`: ids not already on the lead must be **active** catalog services (`422`); unchanged, since-deactivated ids are accepted. Setting a non-null `recommendedServiceId` clears `recommendedServiceText` (the legacy unmatched text); omitting it or sending `null` leaves the text alone. Owner change: own scope `403`, team only within team. Duplicate rule re-runs when name/website/emails change (`409` / `force`). First contact becomes primary. |
| PATCH | `/leads/:id/stage` | `{ status, lossReason?, nextStep?, nextFollowUpDate? }` | `LeadRow` | `status` must be an active status (`422`). What the move needs comes from the status's `requires`: `loss-reason` → `lossReason` = an active loss-reason key, optionally followed by ` — details`; `next-step` → `nextStep` + `nextFollowUpDate`; a Won-flow status (kind `won` **or** `requires: 'convert'`) is refused with `409 { code: 'use_won_flow', message: "Use the Won flow…" }`: only `POST /leads/:id/won` wins a lead (see **The Won flow**). Sets `stageChangedAt`. Non-open kinds (won/lost/parked) clear `nextFollowUpDate`. **Automation:** moving to `No response` sets `nextFollowUpDate` = now + `noResponseFollowUpDays`; moving a closed lead back to an open status (Reopen → `New`) clears `lossReason` and sets a follow-up for tomorrow when none is given. |
| PATCH | `/leads/:id/do-not-contact` | `{ value }` | `LeadRow` | |
| GET | `/leads/:id/activities` | | `ActivityView[]` | Newest first. |
| POST | `/leads/:id/activities` | `{ type, summary }` | `ActivityView` (+ optional `autoStatus {from, to, label, attempts}`) | `422` for call/email/WhatsApp when Do Not Contact. First outreach moves `New` → `Contacted`. **Automation** (outreach = call/email/WhatsApp): on a lead in `No response`, attempts are counted since it entered that status (activities after `stageChangedAt`); when attempts ≥ `attemptsBeforeCold` the lead moves to `Cold` (parked; `stageChangedAt` = now, `nextFollowUpDate` = null) and the response carries `autoStatus`; otherwise the next follow-up is pushed to now + `noResponseFollowUpDays`. |
| GET | `/leads/:id/notes` | | `NoteView[]` | Newest first. |
| POST | `/leads/:id/notes` | `{ body }` | `NoteView` | |
| POST | `/leads/:id/messages` | `{ channel: 'email'\|'whatsapp', to, subject?, body, templateId? }` (final text, variables already filled) | `{ activity: ActivityView, autoStatus?, email? }`; `email: { from, subject, html }` for the email channel: `html` is the branded layout (company logo header, `renderEmailHtml`) | Needs sales edit (`403`); lead in scope (`404`/`403`). `422` for Do Not Contact (same wording as activities); `to` must be an email (email) or a mobile valid for the company country (WhatsApp); email needs a subject (≤150); body required (WhatsApp ≤1024, email ≤5000); any leftover `{{…}}` / `[unknown: …]` is rejected; `templateId` must exist and match the channel. Delivery is done by the backend (mocked here). Logs an `email`/`whatsapp` activity through the same path as `POST /activities`, so New→Contacted and No response→Cold still run. |
| GET | `/leads/:id/tasks` | | `TaskView[]` | Soonest due first. |
| POST | `/leads/import/check` | `{ rows: ImportLeadRow[] }` (max 5000) | `ImportCheckRow[]` `{row, errors[], warnings[], matches, fileDuplicateOf}` | Rows carry lookup keys (the wizard maps the file's free text onto the active items). Errors: missing company, source/industry/status not an active list item. Warnings: value cleared or defaulted. Rows also carry `recommendedServiceId` (catalog match of the file's "Recommended service"/"Service" column, `''` = none) and `recommendedServiceText` (the file's value when unmatched); the server re-matches the text with `matchServiceText`, accepts only **active** ids, and warns "kept as unmatched" otherwise. |
| POST | `/leads/import` | `{ rows, decisions: Record<row,'import'\|'skip'>, ownerRule: 'file'\|'auto' }` | `ImportResult` `{created, skipped, failed:[{row,company,reason}], skippedRows, createdIds, skippedForLimit, limitReached}` | Plan limit (leads + contacts): valid rows are created while they fit, the rest are counted in `skippedForLimit` with `limitReached` (`LimitReachedDetails`). Re-checks rows in order (catches repeats inside the file). Duplicates skipped unless a manager chooses import. Agents own their imports. Missing follow-up → tomorrow; blank status → New; Lost/Not interested get "Imported from Excel (no reason recorded)". |

Register `/leads/duplicates`, `/leads/owners` and `/leads/import*` before `/leads/:id`.

## Follow-ups

No endpoints of its own: the page reads `GET /leads`, logs with `POST /leads/:id/activities`
and reschedules with `PATCH /leads/:id` (`nextFollowUpDate`). Leads whose status kind isn't
`open` (won, lost, parked/Cold) have no follow-ups. No-contact / stalled badges come from `GET /alerts`.

## Sales targets

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/targets?month=yyyy-MM` (default: current month) | | `TargetsMonth` `{month, elapsed (0..1), canEdit, rows: AgentTargetRow[]}`; row = `{userId, name, title, values, actuals, isDefault}` | own: only the caller; team: agents in the team; full/view: all sales agents; hidden `403`. Bad month `422`. `canEdit` for scope full/team. Actuals from activities in the month: call→calls; email+WhatsApp→emails; visit→visits; meeting→meetings; leads created & owned→leads; leads in Proposal (past months: reached Proposal/Won that month)→proposals; partnerships not modelled (0). **The mock adds a synthetic baseline; the real backend returns real counts only.** |
| PUT | `/targets/:userId?month=yyyy-MM` | `{ values: Record<TargetKey, number> }` (all 8 keys) | `AgentTargetRow` | Only scope full/team (`403`); team managers only their team; unknown user `404`; each value integer 0–10,000 (`422`). Creates or replaces that month. Audited. |
| DELETE | `/targets/:userId?month=yyyy-MM` | | `AgentTargetRow` | Same rights; the agent goes back to the defaults for that month. Audited. |
| GET | `/targets/defaults` | | `{ values, canEdit }` | Settings view (Admin, Management) or sales access. |
| PUT | `/targets/defaults` | `{ values }` (all 8 keys) | `{ values, canEdit }` | Company Admin only. Whole numbers 0–10,000. Months without a per-agent row use the current defaults. Audited. |

Target keys: `leads, calls, emails, visits, meetings, proposals, partnerships, events` (events attended).
Recommended defaults: 1000 / 1000 / 1000 / 5 / 5 / 5 / 5, events none. **A target of 0 means "no target"**:
that kind is left out of every completion %. Register `/targets/defaults` before `/targets/:userId`.

## Dashboard

| Method | Path | Returns |
|---|---|---|
| GET | `/dashboard/summary?period=30d\|quarter\|ytd\|12m` (default `12m`) | `DashboardSummary` (scoped like `/leads`). `series` buckets: daily for 30d, weekly for quarter, monthly for ytd/12m. `*Prev` = the equal-length window just before (YTD: same dates last year). Pipeline, follow-ups and targets are "as of now". Targets use the same numbers as `/targets`. Bad period → `422`. |

## Services

The catalog quotations, leads and contracts are built from (`src/modules/services/types.ts`). Services and packages are
**deactivated, never deleted**, so old leads, quotations and contracts keep resolving their ids. `category` is a key of the
`serviceCategories` lookup (Settings > Fixed lists); `industries` are `industries` lookup keys. Currency is an ISO code (default: the company currency).

Permissions: every GET needs `services` **view** (`403` "Your role has no access to the service catalog."); every write needs
`services` **edit** (`403` "Your role can view the catalog but not change it."). Unknown ids → `404`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/services` | | `ServiceRow[]` | **All** services, active and inactive (pickers filter `active`). Each row adds `usage {leadsRecommending, leadsInterested, quotations, customers}` (customers = non-cancelled contracts), `templateTasks`, `templateHours`, `packageCount`. |
| POST | `/services` | `ServiceInput {name, category, description, industries[], pricingType, price, currency?, deliveryDays, active?}` | `ServiceRow` | Name required (≤120), unique case-insensitively (`409`); `category` an **active** serviceCategories key; `industries` known industry keys; `pricingType` `Fixed`\|`Monthly`\|`Hourly`; `price` ≥ 0; `currency` 3 capital letters; `deliveryDays` integer 0–730; description ≤2000. All `422`. Audit `create` / `service`. |
| GET | `/services/:id` | | `ServiceDetail` | Row + `template`, `packages[{id,name,active}]`, `recommendingLeads` (latest 10), `recentQuotations` (latest 10, with total incl. VAT), `customers[{id,name}]`. |
| PATCH | `/services/:id` | `ServiceUpdateInput` (partial) | `ServiceRow` | Same checks on the fields sent. Audit `update` / `service` with field `changes`; when `price`, `pricingType` or `currency` changed the summary reads **"Price change on “<name>”: AED 28000 fixed → AED 30000 fixed"**, otherwise "Edited service …". Price changes never touch existing quotations (lines keep their own prices). |
| POST | `/services/:id/deactivate` | | `ServiceRow` | Idempotent. Hidden from every picker (lead form, quotation lines, contracts, new packages); records that already reference it keep it and show "(inactive)". Audit `deactivate` / `service`. |
| POST | `/services/:id/reactivate` | | `ServiceRow` | Idempotent. Audit `reactivate` / `service`. |
| GET | `/services/:id/project-template` | | `ProjectTemplate {serviceId, tasks[{id,title,role,dayOffset,hours}], updatedAt, updatedBy}` | Empty `tasks` when none. **The Won → project flow reads this** to create the delivery project's tasks. |
| PUT | `/services/:id/project-template` | `ProjectTemplateInput {tasks[]}` (full ordered list; new tasks have no id) | `ProjectTemplate` | ≤60 tasks; title required (≤120); `role` one of the delivery roles; `dayOffset` integer 0–365; `hours` 0–1000 (1 decimal). Replaces the template. Audit `update` / `service-template` ("Project template for “…”: 4 → 6 tasks, 80 → 96 h", changes tasks/hours/durationDays). |
| GET | `/services/packages` | | `PackageRow[]` | All packages. Row adds `listPrice` (Σ current service price × quantity), `saving` (= list − package price), `savingPct`, `lines[{serviceId,name,category,pricingType,price,quantity,active}]`. |
| POST | `/services/packages` | `PackageInput {name, description, items[{serviceId,quantity}], packagePrice, currency?, active?}` | `PackageRow` | Name required, unique (`409`); ≥2 items, each an existing **active** service, no repeats, quantity integer 1–999; `packagePrice` ≥ 0; currency 3 capital letters. Audit `create` / `service-package`. |
| GET | `/services/packages/:id` | | `PackageRow` | |
| PATCH | `/services/packages/:id` | `PackageUpdateInput` (partial) | `PackageRow` | Same checks on the fields sent. Audit `update` / `service-package`; a `packagePrice`/`currency` change reads **"Price change on package “<name>”: AED 52000 → AED 49000"**. |
| POST | `/services/packages/:id/deactivate` | | `PackageRow` | Idempotent. Audit `deactivate` / `service-package`. |
| POST | `/services/packages/:id/reactivate` | | `PackageRow` | `422` while any of its services is inactive ("Reactivate or remove … first."). Audit `reactivate` / `service-package`. |

Register `/services/packages*` before `/services/:id`.

**Where the catalog is used**

- **Leads**: `serviceIds: string[]` (services of interest) and `recommendedServiceId: string | null` replace the old free-text
  `services` / `recommendedService`. `recommendedServiceText: string | null` holds a legacy free-text value that couldn't be matched
  to the catalog during migration (`matchServiceText`, `src/modules/services/match.ts`); the UI shows it as "Unmatched: …" until
  someone picks a catalog service. See Leads.
- **Customers**: `serviceIds: string[]` (carried from the won lead) replaces `services`; `CustomerDetail.lead.serviceIds` likewise.
- **Contracts**: `serviceIds` must exist; new ids must be active (ids already on the contract stay valid).
- **Quotations**: line items carry `serviceId`, plus optional `currency`, `groupId`, `groupLabel` (see Quotations).

## CRM

Contract status is derived: `Expiring` = renews within `renewalAlertDays` (Settings > Automation, default 30), `Expired` = renewal date passed;
only `Active` and `Cancelled` are stored. `annualValue`: Monthly ×12, Annual/One-off as is.
`mrr`: Monthly value, Annual / 12, One-off 0, live contracts only.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/customers` | | `CustomerRow[]` (+ ownerName, contactsCount, activeContractValue, activeContracts, nextRenewal, daysToRenewal, lastActivityAt) | Newest first. |
| GET | `/customers/:id` | | `CustomerDetail` (+ lead summary, contacts, contracts, last 10 activities, notes, lifetimeValue) | lifetimeValue = billed to date, or won value without contracts. |
| PATCH | `/customers/:id` | `{status?, website?, address?, emirate?, ownerId?}` | `CustomerRow` | Status Active/Paused/VIP; website valid URL (https:// added); emirate valid; address ≤200; reassign rules as leads. |
| GET | `/contacts` | | `ContactRow[]` (+ company, recordType Lead/Customer, recordId, ownerName) | Contacts on leads and customers in scope. |
| POST | `/contacts` | `{recordType, recordId, name, title, mobile, email, isDecisionMaker}` | `ContactRow` | Name required; mobile valid for the company country; email format; mobile or email required; `409` if the email exists at that company. |
| PATCH | `/contacts/:id` | partial of the above | `ContactRow` | Same checks; editing a lead's first contact updates the lead's contact fields. |
| GET | `/contracts` | | `ContractRow[]` (+ customerName, ownerName, serviceNames, daysToRenewal, annualValue, mrr) | Soonest renewal first. |
| POST | `/contracts` | `{customerId, title, serviceIds, value, billing, startDate, renewalDate, ownerId?}` | `ContractRow` | Title required; ≥1 catalog service (new picks must be **active**; services already on the contract stay valid); value >0; renewal after start; owner defaults to the customer's. |
| PATCH | `/contracts/:id` | partial + `status: Active\|Cancelled` | `ContractRow` | Same checks; Expiring/Expired can't be set by hand. |

## Quotations

Totals are always computed by the server: `subtotal = Σ qty × price`, `discount = Σ line discounts`,
`vat = (subtotal − discount) × vatPct`, `total = subtotal − discount + vat`. VAT defaults to 5%.
Sent/Viewed quotations past `validUntil` come back as `Expired`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/quotations` | `?leadId=` optional | `Quotation[]` | Scoped by the lead's owner. Newest first. |
| GET | `/quotations/:id` | | `Quotation` | `404` / `403`. |
| POST | `/quotations` | `QuotationInput {leadId, title, validUntil, items[], notes, terms, vatPct?}` | `Quotation` | Needs create + lead in scope. Company/contact copied from the lead. Number `QT-<year>-NNNN`. Starts Draft. |
| PATCH | `/quotations/:id` | `QuotationUpdateInput` (partial, no leadId) | `Quotation` | Only Draft (`409`). |
| POST | `/quotations/:id/send` | | `Quotation` | Draft→Sent, sets `sentAt`. `422` if lead is Do Not Contact, has no email, or draft invalid. Moves a lead before Proposal to `Proposal`. Logs an `email` activity on the lead. |
| POST | `/quotations/:id/status` | `{ status: 'Accepted' \| 'Rejected' }` | `Quotation` | Only from Sent/Viewed; sets `decidedAt`; `409` otherwise or if expired. |
| POST | `/quotations/:id/duplicate` | | `Quotation` | New Draft, new number, valid 30 days, author = caller. |

Validation: title required; `validUntil` today or later; ≥1 item; each item has a description,
quantity > 0, price ≥ 0, discount 0–100, unit `project`/`month`/`hour`; VAT 0–100.

Currency and catalog lines:

- `Quotation.currency` / `QuotationInput.currency?`: one ISO code per quotation (3 capital letters, default the company currency). Totals always
  use it.
- `QuotationItem.serviceId`: must exist in the catalog; a service **not already on the quotation** must be active (`422`
  "… is no longer offered"). Old quotations keep lines for since-deactivated services (the UI shows "(inactive)").
- `QuotationItem.currency?` (optional, 3 capital letters): the currency the line was priced in, prefilled from the service.
  Informational only: when it differs from the quotation's currency the editor warns and totals still use the quotation currency.
- `QuotationItem.groupId?` / `groupLabel?` (optional; id ≤64, label ≤120, label defaults to "Package"): lines added together from a
  service package. The editor adds one line per package item (quantity from the package, price from the catalog) and the same
  `discountPct` on each line so the group totals the package price; the group is shown as one block with "Remove package" and
  printed under a "Package: <name>" heading.
- The client prefills a catalog line with description = service name, unit (Fixed → `project`, Monthly → `month`,
  Hourly → `hour`), unit price and currency; all are editable per quotation.

## Reports

Scoped to the narrower of the caller's `reports` and `sales` scopes.

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/reports/sales` | `?from=yyyy-MM-dd&to=yyyy-MM-dd[&ownerId=]` | `SalesReport` (query, scope, owners, generatedAt, kpis, byStatus, funnel, byIndustry, bySource, funnelMonthly, agents, targets, overdueFollowUps, overdueTasks) | `403` without sales/reports access or `ownerId` out of scope; `400` bad range (from > to, or > 3 years). Status/industry/source/funnel use leads created in the period; won/closed/conversion use the close date. Rows are keyed by lookup key and carry the current `label`; they follow the lists' configured order (active items, plus inactive ones that still have records). "Closed" = status kind `won`/`lost` (parked Cold leads are neither). The funnel walks the built-in path New → Contacted → Interested → Meeting → Proposal → Won (inactive steps skipped). Target `overall` averages only kinds with a target > 0. |
| POST | `/reports/custom` | `{dimension: status\|industry\|source\|owner\|month, measure: count\|value\|wonValue\|conversion, from, to, ownerId?}` | `CustomReport {input, rows:[{key,label,value,leads}], total}` | `422` on bad dimension/measure. |
| GET | `/reports/schedules` | | `ReportSchedule[]` (with computed `nextRunAt`) | Full scope sees all; others their own. |
| POST | `/reports/schedules` | `{report: ReportId\|'all', frequency: weekly\|monthly, day, time 'HH:mm', recipients: string[1..10], format: excel\|pdf}` | `ReportSchedule` | `422` on validation; recipients lowercased and de-duplicated. The backend sends the e-mails. |
| DELETE | `/reports/schedules/:id` | | `{ id }` | `404`; `403` unless creator or full scope. |

## Lookups & automation

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/lookups` | | `Lookups {statuses, sources, industries (with subIndustries), lossReasons, tags}` | Any signed-in user. Every item has `key` (stable, stored on records), `label`, `active`, `order`. Statuses add `probability` (0–100), `kind` (`open`/`parked`/`won`/`lost`), `requires` (`none`/`next-step`/`loss-reason`/`convert`), `tone`, `color`, `system`. Pickers show active items only; display looks labels up by key. |
| PUT | `/lookups/:list` | `{ items }` (the whole list; new items without `key`) | `Lookups` | Company Admin only (`403`). Unknown list `404`. Items can be renamed, reordered and deactivated but not removed (`422`); built-in statuses keep their kind; at least one active status of each kind. **Protected items** (`system: true` on a plain list item, e.g. loss reason `imported-no-reason` "Imported - no reason recorded"): can't be removed, renamed or deactivated (`422`); always re-pinned last on reorder; `system`/`hiddenFromPickers` can't be changed by clients. Each list needs ≥1 active item that isn't `hiddenFromPickers`. Audited. |
| GET | `/settings/automation` | | `AutomationRules` | Any signed-in user. `{noContactReminderDays: 1, noResponseFollowUpDays: 2, attemptsBeforeCold: 3, stalledInterestedDays: 3, lostReopenDays: 90, renewalAlertDays: 30, taskReminderDaysBefore: 1}` by default. Read live by the lead journey (stage moves, activities, `reopenEligible`), CRM renewals and `/alerts`. |
| PUT | `/settings/automation` | `Partial<AutomationRules>` | `AutomationRules` | Company Admin only. Whole numbers within each rule's limits (`422`). Audited. |
| POST | `/settings/automation/reset` | | `AutomationRules` | Back to the defaults. Audited. |
| GET | `/audit-log` | `?entity=&userId=&action=&from=&to=` | `AuditEntry[]` `{id, at, userId, userName, action, entity, entityId, summary, changes[{field,from,to}]}` | Admins only (`403`). Newest first. |
| GET | `/alerts` | | `Alert[]` `{id, type, severity: info\|warning\|danger, title, body, leadId?, customerId?, link, at}` | Scoped like `/leads` (hidden scope → `[]`). Newest first. Types, using the automation rules: `no-contact` — New lead with no activity for ≥ `noContactReminderDays` (to the owner); `stalled` — Interested lead with no activity for ≥ `stalledInterestedDays` (to managers: sales scope team/full); `follow-up` — follow-up due today or overdue (owner), others' overdue ones (managers); `renewal` — contracts (not cancelled) renewing within `renewalAlertDays`; `task` — open tasks of any kind (lead, customer, project, personal) that I own, due within `taskReminderDaysBefore` days (owner reminder); `task-overdue` — open overdue tasks: my own, my direct reports', and with a team/full tasks scope every overdue task in scope. Task alerts follow the **tasks** scope (not sales) and the company's calendar (regional timezone, mock clock); see **Tasks › Reminders**. |

List items may carry `system?: boolean` (protected) and `hiddenFromPickers?: boolean` (never offered for
new values, but labels still resolve). `imported-no-reason` is accepted only by the Excel import
(`POST /leads/import`); stage moves and lead create/edit reject it ("Pick a loss reason from the list.").
Events-attended target cells in reports return actual 0 / pct 0 and are left out of `overall`
until the Events module exists.

## My account

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/account` | | `{ user, departmentName, managerName, lastLoginAt, passwordChangedAt }` | Any signed-in user, own account. |
| POST | `/account/password` | `{ currentPassword, newPassword }` | `{ changedAt, signedOutSessions }` | `422` if current is missing/wrong (not `401`: 401 means "session expired"), new is shorter than `policy.passwordMinLength` or >128, lacks a letter or a digit, or equals the current one. Signs out the user's other sessions. Audited (action `security`, id `password`; the password is never logged). |

The client signs the user out after `policy.sessionTimeoutMinutes` of inactivity (warning 60 s before);
the backend should also expire idle tokens on its side.

## Settings: users

All writes are Company Admin only (`403`) and audited with a field-by-field diff. Users are never deleted.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/settings/users` | | `SettingsUserRow[]` (User + departmentName, managerName, directReports, openLeads) | Settings view (Admin, Management). |
| GET | `/settings/departments` | | `{ id, name }[]` | Any signed-in user. |
| POST | `/settings/users` | `{ name, email, mobile, role, title?, departmentId, managerId? }` | `SettingsUserRow` | Email valid and unique within the company (case-insensitive); mobile for the company country (stored formatted, e.g. `+971 5X XXX XXXX` in the UAE, `+966 5X XXX XXXX` in Saudi); role one of the 9; department exists; manager exists and is active. |
| PATCH | `/settings/users/:id` | any subset of the above | `SettingsUserRow` | Same checks; manager not self, no reporting loops; you can't change your own role; the last active Company Admin can't lose the role. |
| POST | `/settings/users/:id/deactivate` | `{ confirm?: boolean }` | `SettingsUserRow`, or `409 { message, openLeads }` | Not yourself; not the last active Company Admin; if they own open/parked leads and `confirm` isn't true → `409`. Leads stay assigned. |
| POST | `/settings/users/:id/reactivate` | | `SettingsUserRow` | |

## Settings: security

Security events are audited with action `security`, entity `security`, id `2fa`/`session`/`backup`/`policy`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/security/2fa` | | `{ enabled, enabledAt, recoveryCodesLeft }` | Own account. |
| POST | `/security/2fa/setup` | | `{ secret (base32), otpauthUrl }` | `409` if already on. |
| POST | `/security/2fa/verify` | `{ code }` | `{ enabled: true, enabledAt, recoveryCodes[8] }` | Setup started first; 6-digit TOTP. (Mock accepts the demo code `123456`.) |
| POST | `/security/2fa/disable` | `{ code }` | `{ enabled: false, … }` | Current code or a recovery code; refused for admins while the policy requires 2FA. |
| GET | `/security/sessions` | | `SecuritySession[]` (device, browser, ip, location, lastActiveAt, createdAt, current) | Own account. |
| DELETE | `/security/sessions/:id` | | `{ ok: true }` | Can't end the current session (`422`). |
| POST | `/security/sessions/revoke-others` | | `{ revoked }` | |
| GET | `/security/backups` | | `{ schedule, lastSuccessAt, nextAt, retentionDays, history[] }` | Settings view. |
| POST | `/security/backups/run` | | `BackupRun` | Company Admin; `409` if one is running. |
| GET | `/security/policy` | | `{ requireTwoFactorForAdmins, sessionTimeoutMinutes, passwordMinLength }` | Any signed-in user (the app enforces the idle timeout and the password rules from it). |
| PUT | `/security/policy` | partial policy | policy | Company Admin; timeout 5–1440, password length 8–64; requiring 2FA needs your own 2FA on. |

## Settings: templates

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/templates` | `?channel=email\|quotation\|whatsapp&purpose=&active=` | `MessageTemplate[]` | Any signed-in user; only settings viewers see inactive ones. |
| GET | `/templates/:id` | | `MessageTemplate` | `404` if inactive and the caller can't see inactive ones. |
| POST | `/templates` | `{ channel, name, purpose, subject?, body }` | `MessageTemplate` | Company Admin. Becomes the default if its channel+purpose has none. |
| PATCH | `/templates/:id` | `{ name?, purpose?, subject?, body? }` | `MessageTemplate` | Company Admin; channel can't change. |
| POST | `/templates/:id/duplicate` | | `MessageTemplate` | "Name (copy)", active, not default. |
| POST | `/templates/:id/default` | | `MessageTemplate` | Only default for its channel+purpose; `422` if inactive. |
| POST | `/templates/:id/deactivate` / `reactivate` | | `MessageTemplate` | No delete. |

Validation (`422`): name required, ≤80, unique per channel; purpose valid for the channel; email needs a
subject; body required (≤5000; WhatsApp ≤1024); unknown `{{variables}}` are listed in the message.
Variables use `{{group.field}}` (lead, agent, company, quotation, date); the catalog is in
`src/modules/settings/templates/variables.ts` and the renderer in `render.ts`. All template writes are audited.
`{{company.*}}` (`name` = trade name, `legal_name`, `phone`, `email`, `website`, `address`, `tax_label`,
`tax_number`) is filled from the company profile through `issuerFor(tenant)` (server: the caller's company);
use them in email signatures. The old spellings `legalName`, `taxLabel`, `taxNumber` still render (hidden
from the picker). `POST /leads/:id/messages` fills any `{{company.*}}` left in the text the same way.
New companies get the 12 default templates (`defaultTemplatesFor` in `src/shared/mocks/data/templates.ts`).

## Settings: company profile

The issuer printed on quotations (header, "From" block, footer) and future invoices, and the
source of `{{company.*}}`. Stored inside the `Company` record (`Company.profile`, type
`CompanyProfile` in `src/modules/tenancy/types.ts`), so `GET /tenant` and every `Session.tenant`
carry it. Clients read it only through `issuerFor(tenant)` (`src/modules/quotations/lib/company.ts`),
the single source for quotations and invoices. Rules: `src/modules/settings/companyProfile.ts`;
mock: `src/shared/mocks/services/companyProfile.ts`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/settings/company-profile` | | `CompanyProfile` | Company Admin and Management (Settings view); others `403`. |
| PATCH | `/settings/company-profile` | `CompanyProfilePatch` | `CompanyProfile` | Company Admin only (`403` otherwise). Always the caller's company: a body `companyId` is ignored. |

`CompanyProfile`: `{ legalName, tradeName, address: { line1, line2, city, region, country }, location: { lat, lng } | null,
taxNumber, commercialLicenseNo, phone, email, website, bank: { bankName, accountName, iban, swift } | null }`.
PATCH semantics: top-level fields replace; `address` merges field by field; `location: null` / `bank: null` clear.
Saving also sets `Company.name = legalName`.

Validation (`422`, first problem in `message`):

- required: `legalName` (≤120), `tradeName` (≤80), `address.line1`, `address.city`, `address.country` (one of the supported country codes);
- `email` a valid address, `website` a host like `example.com` (optional `https://`), `phone` a landline or
  mobile of the company country (`regional.country`, `isPhone` in `src/shared/lib/phone.ts`; stored formatted);
- `taxNumber` optional; when set it must match the company country (table below; spaces, dots and dashes are stripped);
- `location.lat` in [-90, 90], `location.lng` in [-180, 180];
- `bank` (when not null): `bankName`, `accountName` and `iban` required; IBAN shape `CC##` + 11–30 letters/digits with a
  valid mod-97 checksum (stored without spaces); `swift` optional, 8 or 11 characters.

Tax numbers by company country (`src/shared/lib/taxNumber.ts`, label printed before the number):

| Country | Label | Format |
|---|---|---|
| AE | TRN | 15 digits starting with `100` |
| SA | VAT number | 15 digits, starting and ending with `3` |
| EG | Tax ID | 9 digits |
| QA | Tax card number | 8–15 letters or digits |
| KW | Tax ID | 8–15 letters or digits |
| BH | VAT account number | 8–15 letters or digits |
| OM | VATIN | 8–15 letters or digits |

Every change is audited (`entity: "company-profile"`, `entityId` = company id) with one change per field
(`address.city`, `bank.iban`…; the IBAN is masked to its last 4 characters). No entry when nothing changed.

## Settings: branding

The workspace's look: display name, light and dark logos, favicon and primary colour. Stored on the
`Company` record (`Company.branding`, type `Branding` in `src/modules/tenancy/types.ts`), so `GET /tenant`,
every `Session.tenant`, `GET /public/workspaces/:subdomain` (sign-in page) and the dev switcher carry it.
Shared rules (client and server): `src/modules/settings/branding.ts`; palette: `src/modules/tenancy/palette.ts`;
mock: `src/shared/mocks/services/branding.ts`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/settings/branding` | | `BrandingSettings { branding, primaryColor, limits }` | Company Admin and Management (Settings view); others `403`. |
| PATCH | `/settings/branding` | `BrandingPatch` | `Company` (updated) | Company Admin only (`403`). Always the caller's company (a body/query/header `companyId` is ignored; unknown fields are ignored). |
| POST | `/settings/branding/reset` | | `Company` (updated) | Company Admin only. Removes both logos and the favicon, primary colour → default palette, monogram from the display name. The display name and email sender stay. |

`BrandingPatch`: `{ displayName?, primaryColor?, logoLight?: dataUrl | null, logoDark?: dataUrl | null, favicon?: dataUrl | null }`.
Absent = keep, `null` = remove, a `data:<mime>;base64,…` URL = set. The client refreshes the session tenant with
the returned `Company` (`tenantRefreshed`), so the header, switcher, palette, favicon, quotations and email
previews change without a reload.

`Branding` additions (all optional, additive): `logoDarkUrl` (dark theme; falls back to `logoUrl`), `faviconUrl`
(browser tab while signed in or on the workspace sign-in page; the product icon otherwise), `primaryColor` (`#rrggbb`).
`logoUrl` stays the light logo (documents and emails always use it). In the mock images are stored as data URLs;
a real backend stores the file and returns a hosted URL in the same fields.

Validation (`422`, first problem in `message`; nothing is written when any field fails):

| Rule | Limit / check |
|---|---|
| Types | PNG, JPG, SVG, WebP (`image/png`, `image/jpeg`, `image/svg+xml`, `image/webp`) |
| Size (decoded bytes) | logo (light or dark) ≤ **1 MB** (`LOGO_MAX_BYTES` = 1,048,576); favicon ≤ **256 KB** (`FAVICON_MAX_BYTES` = 262,144) |
| Content | the data URL is decoded and the magic bytes must match the declared type (PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`, SVG `<svg` root). A text file sent as PNG → "The light logo isn’t a real PNG image (its content doesn’t match the file type)." |
| Raster size | the width/height must be readable from the header, 1–10,000 px |
| SVG | refused (not sanitised) when it has `<script>`, an `on*=` event attribute, a `javascript:` URL (entity-encoded too), `<foreignObject>`, `<iframe>/<embed>/<object>`, a DOCTYPE/ENTITY, or any external reference (`href`/`xlink:href` not starting with `#`, `url(…)` not starting with `#`, `@import`) |
| `displayName` | 1–60 characters (trimmed); a new name recomputes the monogram |
| `primaryColor` | hex `#rgb` / `#rrggbb`; stored lower-case `#rrggbb` |

The page checks the same rules before uploading (same functions, same messages). Raster images go through a
crop dialog (logo frame 1:2 to 4:1, favicon square) and are re-encoded as PNG (WebP if the PNG would exceed the
limit), scaled down to at most 800×400 (logo) or 128×128 (favicon); SVGs are previewed and sent as uploaded.

Primary colour → palette: `deriveBrandScale(hex)` returns the 50–900 `BrandScale`; the picked colour is the 600
step, lighter steps keep the hue and move toward near-white, darker steps lose lightness. The client applies it
with `applyBranding` (`--color-brand-50…900` and `--brand-rgb` on `<html>`), which every `brand-*` class, focus
ring and chart colour (`var(--color-brand-600)`) reads. The page shows the WCAG contrast of white text on it
(≥ 4.5 good, ≥ 3 large text only, below poor).

Audit: every change is one entry `entity: "branding"`, `entityId` = company id, with a change per field
(`displayName`, `monogram`, `primaryColor`, `logoLight`, `logoDark`, `favicon`). Images are summarised as
`"PNG 34 KB, 320×80"` (a hosted URL as `Hosted image (<host>)`, none as `—`); the data URL is never stored in the
log. Reset is audited as "Reset the branding to the default (…)". No entry when nothing changed.

Writes are refused by the central request policy before the service runs: billing read-only (Suspended /
Cancelled) → `423 workspace_read_only`; a read-only support session → `403 impersonation_read_only`.

Where it shows: sidebar header (`TenantLogo`, light/dark by theme), the workspace switcher (`CompanyMark`), the
workspace sign-in page (`/w/<subdomain>`, `/login?workspace=<subdomain>`), the browser favicon, quotation
documents and their print view (light logo), the email template preview, the lead composer's email preview and
sent emails (`renderEmailHtml`: logo header, else monogram + name). There is no contract document / print view
yet; when one is added it should use `TenantLogo variant="light"` like the quotation letterhead. No
`{{company.logo_url}}` variable: the branded header is added to every email automatically, and inlining a
data URL into the text would break the 5,000-character body limit.

## Self-service sign-up (public)

Types: `src/modules/signup/types.ts`; plans are data served by the API (`src/shared/mocks/data/plans.ts`, see Plans, limits and subscription lifecycle); server mock:
`src/shared/mocks/services/signup.ts`. All endpoints here are **public** (no `Authorization`), product level (not on a
workspace address). Send `X-Client-Id: <random per-browser id>` with every call (rate-limit key; `anonymous` without it).
Errors are `{ message, code }`; the `code` tells the client which field to highlight.

Flow: availability (live) → **start** (validate, nothing created, code emailed) → **verify** code → choose plan →
[**checkout** for paid plans] → **complete** (one atomic action, returns a `Session`). Enterprise → **contact sales**.

| Method | Path | Body | Returns | Errors |
|---|---|---|---|---|
| GET | `/public/plans` | | `Plan[]` (billing model, active plans by rank) | |
| GET | `/public/signup/availability?subdomain=` | | `SubdomainAvailability { subdomain, available, reason }` | never fails; `reason` explains format / reserved / taken |
| POST | `/public/signup` | `SignupStartInput` | `SignupStarted { signupId, email, resendInSeconds, codeExpiresAt, devCode? }` | 422 validation, 409 `subdomain_taken` / `email_taken` / `email_pending`, 429 `rate_limited` |
| GET | `/public/signup/:id` | | `SignupStatus { signupId, email, companyName, subdomain, country, verified, paidCheckouts[], resendInSeconds, codeExpiresAt }` (resume after a reload) | 404 `signup_not_found`, 429 `too_many_attempts` |
| POST | `/public/signup/:id/resend` | `{}` | `SignupStarted` (new code; the old one stops working) | 429 `resend_cooldown`, 409 `already_verified`, 404, 429 `too_many_attempts` |
| POST | `/public/signup/:id/verify` | `{ code }` | `SignupVerified { signupId, verified: true }` (idempotent) | 422 `invalid_code` ("N attempts left"), 422 `code_expired`, 429 `too_many_attempts`, 404 |
| POST | `/public/checkout` | `CheckoutInput { signupId, plan (a plan with checkout 'payment': starter, business), cardholder, cardNumber, expiry: 'MM/YY', cvc }` | `CheckoutResult { checkoutId, status: 'paid', amount, currency }` | 409 `not_verified`, 422 `invalid_plan` / `invalid_card` / `invalid_expiry` / `invalid_cvc` / `invalid_cardholder`, 402 `card_declined`, 404 |
| POST | `/public/signup/:id/complete` | `SignupCompleteInput { plan, checkoutId?, continuePlanId? }` (`continuePlanId`: trial only, the paid plan to continue on; stored as `subscription.selectedPlanId`) | `SignupCompleted` = `Session & { subscription: BillingSubscription }` | 409 `not_verified`, 422 `contact_sales` (enterprise) / `invalid_plan`, 402 `checkout_required`, 409 `subdomain_taken` / `email_taken`, 404, 500 `signup_failed` (nothing saved) |
| POST | `/public/contact-sales` | `ContactSalesInput { companyName, name, email, country, message? }` | `ContactSalesResult { requestId, message }` | 422 |

**Start validation** (`POST /public/signup`, in this order; the first problem wins):

- Honeypot: a non-empty `website` → `200` with a fake `signupId` and no `devCode`; nothing is stored, no code is sent,
  no rate-limit hit (bots learn nothing).
- Rate limit (mocked): at most **5 starts per 10 minutes** per `X-Client-Id` and per email (every attempt counts,
  including invalid ones) → `429 rate_limited` "Too many sign-up attempts. Try again in N seconds."
- `companyName` 2–80 (`invalid_company_name`).
- `subdomain` (rules shared with the form, `src/modules/tenancy/subdomain.ts`: `SUBDOMAIN_PATTERN`, `subdomainProblem`):
  **3–30** lowercase letters, digits or single hyphens, starting and ending with a letter or digit (`422 invalid_subdomain`);
  reserved platform names (`www`, `app`, `api`, `admin`, `platform`, `support`, `billing`, `login`, `signup`…) `422`;
  unique across companies **and** pending sign-ups (`409 subdomain_taken`). **A subdomain is immutable**: a company
  cannot change it; renaming a workspace address is a platform-only operation (Platform Owner).
- `country` one of AE, SA, EG, QA, KW, BH, OM (`invalid_country`); `language` `'en'` only (`invalid_language`).
- `adminName` 2–80 (`invalid_admin_name`); `adminEmail` valid format (`invalid_email`).
- **One email, one company**: an email already used by any user of any company → `409 email_taken`
  "This email already has an Apex CRM account. Sign in to your workspace instead."; held by another pending sign-up →
  `409 email_pending`. Compared case-insensitively.
- `mobile` must be a mobile number of the chosen country (`src/shared/lib/phone.ts`, `invalid_mobile`); stored normalized.
- `password`: ≥ 10 characters and `passwordStrength(pw).score ≥ 2` (`src/shared/lib/passwordStrength.ts`, shared with
  the form meter: score 0–4, label, hints; common words, repeats and sequences are penalised) → `weak_password`.
- `acceptTerms` must be `true` (`terms_required`).

**Pending sign-up and verification code.** Start stores a pending sign-up (no company, no user) and "emails" a
6-digit code valid **15 minutes**. `devCode` is returned **only by the mock** so the demo can be completed; a real
backend never returns it. Resend: **30 s** cooldown (`429 resend_cooldown` "Wait N seconds…"); the new code replaces
the old one. **5 wrong codes** (across resends) lock the sign-up (`429 too_many_attempts`): it must be started again.
A pending sign-up holds its subdomain and email until its code expires (unverified) or for 24 h after verification;
a locked or completed sign-up releases them.

**Plans** (`GET /public/plans`): the active plans (data, not constants); see the plan table in **Plans, limits and
subscription lifecycle**. `checkout: 'none'` (Trial) needs no payment, `'payment'` (Starter, Business) needs a checkout,
`'contact'` (Enterprise) → `POST /public/contact-sales`.

**Checkout (mocked).** Requires a verified sign-up. `4242 4242 4242 4242` (or any other Luhn-valid number) succeeds;
`4000 0000 0000 0002` is declined (`402 card_declined`). Expiry `MM/YY` not in the past, CVC 3–4 digits. A checkout
is bound to its sign-up and plan, and pays for one workspace.

**Complete** (`POST /public/signup/:id/complete`): **one atomic action**.

1. Requires a verified sign-up. `enterprise` → `422 contact_sales`. `trial` needs no payment; `starter`/`business`
   need an unused paid `checkoutId` of **this** sign-up for **this** plan (`402 checkout_required`).
2. Re-checks subdomain and email uniqueness (`409`).
3. Creates everything in one transaction. The mock snapshots the whole DB first and restores it on any error, so a
   failure leaves **nothing** behind (`500 signup_failed` "Nothing was saved; please try again"; the same sign-up can
   be completed again). It creates:
   - the `Company`: `status: 'trial'` for Trial else `'active'`, `plan`, `enabledModules` = the plan's role modules,
     `regional` from `COUNTRY_DEFAULTS[country]`, default violet branding with a monogram, display name / email
     sender = company name / admin email, profile prefilled (`legalName` = `tradeName` = company name,
     `address.country`, `email` = admin email, `phone` = admin mobile);
   - a root department headed by the admin; the **Company Admin** user (global id sequence, with mobile), an active
     membership and the password;
   - the `BillingSubscription`: Trial → `trialing`, `trialEndsAt` = now + `trialDays` (platform billing settings), no
     payment method; paid plan → `active`, payment method = the checkout card (brand, last 4, expiry, holder) and the
     first invoice, paid;
   - the product defaults, identical for every new company: the **9 default roles** with the permission matrix
     (`GET /settings/roles`), fixed lists (statuses incl. **Cold**, sources, industries, loss reasons, tags, service
     categories), automation rules, monthly target defaults, security policy defaults, the 12 default templates;
   - an audit entry in the new company (`entity: "company"`).
4. Marks the pending sign-up consumed and returns `SignupCompleted` (`Session` + `subscription`): the admin is signed
   in. The client then switches to the new workspace address.

Contact sales stores the request in a platform list (not visible to any company); no workspace is created.

## Subscription, roles, email connection

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/settings/roles` | Company Admin, Management | | `CompanyRoleDefinition[]` (`{ id, name, system, permissions: Record<ModuleKey, Scope> }`; 9 roles, read-only) |
| GET | `/settings/email-connection` | Company Admin (plan module `integrations`, else `403 module_not_in_plan`) | | `EmailConnection \| null` |
| POST | `/settings/email-connection` | Company Admin | `{ provider: 'google' \| 'microsoft' \| 'smtp', address }` | `EmailConnection { provider, address, connectedAt, connectedBy }` (mocked; `422` bad provider/address; audited) |
| DELETE | `/settings/email-connection` | Company Admin | | `null` |

Seeds: Apex Aora `enterprise` (active); Crest Logistics `business` (active). Plans, usage, invoices and the lifecycle:
see the next section.

## Plans, limits and subscription lifecycle

Types: `src/modules/billing/types.ts` (the contract). Server mock: `src/shared/mocks/services/billing.ts`,
`src/shared/mocks/handlers/billing.ts`, data in `src/shared/mocks/data/plans.ts` (plans, platform settings) and
`src/shared/mocks/data/subscriptions.ts` (subscriptions, invoices, period counters), clock in `src/shared/mocks/clock.ts`.
Tests: `src/shared/mocks/services/billing.test.ts`. Everything below is enforced by the API, not only by the UI.

### Models

- **Plan** (data, never hardcoded in components): `{ id, name, price (null = free / contact us), currency, billingPeriod,
  limits: Record<LimitKey, number | null> (null = unlimited), modules: PlanModule[], highlights, checkout: 'none' | 'payment' | 'contact',
  active, rank }`. Upgrade / downgrade is decided by `rank`. Inactive plans aren't offered (existing subscribers keep them).
  `PlanModule` = role modules (`ModuleKey`) + `events`, `integrations`, `ai`.
- **BillingSubscription** (one per company): `{ id, planId, status, startedAt, trialEndsAt, currentPeriodStart,
  currentPeriodEnd (renewal date), paymentMethod { brand, last4, expMonth, expYear, holder } | null, scheduledChange
  { toPlan, effectiveAt, requestedAt, requestedBy } | null, cancelAtPeriodEnd, statusChangedAt, graceEndsAt, deleteAt,
  customPrice, planVersion, pendingPlanVersion, selectedPlanId }`. `customPrice` is a negotiated price per period (Enterprise); null = the plan's price.
  `planVersion` = the plan version the subscription is on (its price, limits and modules come from that version);
  `pendingPlanVersion` = a newer version applied at the next renewal; `selectedPlanId` = trial only, the paid plan the trial
  converts to (see Super-Admin Console › Versioned plans and Trial conversion).
- **Usage** `{ periodStart, periodEnd, items: UsageItem[] }`, `UsageItem { key, label, used, limit, percent, resets, unit }`.
- **BillingInvoice** (platform invoices, mocked) `{ id, number, issuedAt, periodStart, periodEnd, planId, description,
  amount, currency, status: 'paid' | 'open' | 'failed' | 'void' }`. A failed automatic charge leaves an `open` invoice;
  paying fixes it (`paid`); cancellation voids it (`void`).
- `Company.plan` (string plan id) and `Company.enabledModules` (= the plan's modules that are `ModuleKey`s) mirror the
  subscription and are updated whenever the plan changes. `Company.status` stays the platform console status: `trial`
  while trialing, else `active`; its `suspended` is the **operator lock** (full block, `403 workspace_suspended`) and is
  never set by billing.

**Seeded plans** (`GET /public/plans`, USD):

| id | rank | Price | users | leads + contacts | storage | emails / period | AI credits | Modules | checkout |
|---|---|---|---|---|---|---|---|---|---|
| `trial` | 0 | free, `trialDays` from settings | 5 | 2,000 | 5,120 MB | 2,000 | 100 | sales, services, tasks, departments, reports, settings | `none` |
| `starter` | 1 | 29 / month | 5 | 2,000 | 5,120 MB | 2,000 | 100 | same as Trial | `payment` |
| `business` | 2 | 79 / month | 25 | 25,000 | 51,200 MB | 20,000 | 1,000 | Starter + marketing, accounting, events, integrations, ai | `payment` |
| `enterprise` | 3 | contact us | unlimited | unlimited | unlimited | unlimited | unlimited | all, incl. hr | `contact` |

Seeded subscriptions: Apex Aora `enterprise` (active, `customPrice` 499, visa 4242), Crest Logistics `business`
(active, mastercard 4444). Both renew about 2–3 weeks after the seed date and have a few paid invoices.

**Platform settings** (data, not constants; `PlatformBillingSettings`):

| Setting | Default | Used for |
|---|---|---|
| `trialDays` | 14 | Trial length at sign-up |
| `trialReminderDays` | [7, 3, 1] | Reminders before the trial ends |
| `graceDays` | 7 | Past due → Suspended after this many days |
| `pastDueReminderDays` | [1, 3, 6] | Payment reminders after a failed renewal (before the grace end) |
| `suspendedDaysBeforeCancel` | 30 | Suspended → Cancelled |
| `retentionDays` | 30 | Cancelled → Deleted (export available meanwhile) |
| `usageWarningThresholds` | [80, 100] | Usage warnings, percent of a limit |

### Endpoints

All company endpoints derive the company from the token (never from the request). "Company Admin" = settings edit
(`403` otherwise). Errors are `{ message, code, ...details }`.

| Method | Path | Who | Body | Returns | Errors |
|---|---|---|---|---|---|
| GET | `/public/plans` | public | | `Plan[]` (active, by rank) | |
| GET | `/billing/entitlements` | any signed-in user | | `Entitlements { planId, planName, status, modules, limits, reached: LimitKey[] (≥ 100%), readOnly, trialDaysLeft, graceEndsAt (past due), deleteAt (cancelled), serverNow (the server clock; count days from it, the dev simulator moves it) }` | |
| GET | `/billing/overview` | Company Admin, Management | | `BillingOverview { subscription, plan, usage, invoices (newest first), plans (active + current), settings, serverNow }` | `403` |
| POST | `/billing/change-plan` | Company Admin | `{ planId }` | `ChangePlanResult { kind: 'upgraded' \| 'scheduled', overview, invoice }` | `422 invalid_plan` (unknown, inactive or trial), `422 contact_sales` (Enterprise), `409 same_plan`, `409 invalid_state` (`{ status }`; past due: pay first; suspended / cancelled: reactivate), `422 payment_method_required` (upgrade without a card), `409 downgrade_blocked` (`{ blocks: DowngradeBlock[] }`) |
| DELETE | `/billing/scheduled-change` | Company Admin | | `BillingOverview` | `409 no_scheduled_change` |
| POST | `/billing/payment-method` | Company Admin | `PaymentMethodInput { holder, cardNumber, expiry: 'MM/YY', cvc }` | `BillingOverview` | `422 invalid_cardholder / invalid_card / invalid_expiry / invalid_cvc`, `402 card_declined` (4000 0000 0000 0002), `409 invalid_state` (cancelled: reactivate instead) |
| POST | `/billing/cancel` | Company Admin | | `BillingOverview` (`cancelAtPeriodEnd: true`) | `409 invalid_state` (only trialing / active), `409 already_cancelling` |
| POST | `/billing/resume` | Company Admin | | `BillingOverview` (`cancelAtPeriodEnd: false`) | `409 not_cancelling` |
| POST | `/billing/reactivate` | Company Admin | `{ planId }` | `BillingOverview` (active, new period from now, paid invoice) | `409 invalid_state` (only suspended / cancelled), `422 invalid_plan` / `contact_sales`, `422 payment_method_required`, `409 downgrade_blocked` |
| GET | `/billing/export` | Company Admin | | `DataExport { generatedAt, company { name, subdomain }, counts, data: { leads, contacts, customers, tasks, projects, quotations, users } }` (the caller's company only, no `companyId`). Allowed while read-only. Audited. | `403` |
| POST | `/ai/credits/consume` | any signed-in user | `{ credits }` (1–1000) | `AiCreditsResult { used, limit, remaining }` | `403 module_not_in_plan` (no `ai`), `402 LIMIT_REACHED`, `422 invalid_credits` |
| GET | `/hr/employees`, `/events`, `/marketing/campaigns`, `/finance/invoices`, `/integrations` | signed in | | `[]` (stubs so module gating is real) | `403 module_not_in_plan` |
| POST | `/billing/trial-plan` | Company Admin, trialing only | `TrialPlanInput { planId }` | `BillingOverview` (`subscription.selectedPlanId` set). Audited. | `409 invalid_state` (not trialing), `422 invalid_plan` / `contact_sales` |

Platform billing settings moved to `GET/PATCH /platform/settings` (Super-Admin Console); `/platform/billing-settings` is removed.

**Change plan rules.** Allowed while trialing or active. Higher `rank` = **upgrade**: immediate; needs a payment
method; from the trial the full price is charged and a new period starts now (`trialEndsAt` cleared, status active);
mid-period the **prorated** difference `(new price − current price) × remaining fraction of the period` is charged
now (period dates unchanged). Lower `rank` = **downgrade**: scheduled for the period end (`scheduledChange`), applied
by the renewal, cancellable with `DELETE /billing/scheduled-change`. A downgrade is **blocked** (`409 downgrade_blocked`)
if current usage of any stock limit (users, leads + contacts, storage) exceeds the new plan's limit:
`{ message, code, blocks: [{ key, label, used, limit }] }`. Losing modules is allowed: data is kept and the module is
locked (`403 module_not_in_plan`). Upgrades, scheduled changes and cancellations are audited and notify Company Admins.

**Payment method.** Mock cards as in sign-up checkout (`src/shared/mocks/cards.ts`): any Luhn-valid number works,
`4000 0000 0000 0002` is declined (`402 card_declined`). Only brand, last 4, expiry and holder are stored. While past due
or suspended, saving a card pays: the open invoice is paid (or, with no open invoice or a lapsed period, a new period
starts now on the plan, an ended trial converting to its selected plan, see Trial conversion) and the status becomes active.

### Limits (enforced by the API)

| Limit | Counted as | Checked by (402 `LIMIT_REACHED`) |
|---|---|---|
| `users` | active users of the company (live) | `POST /settings/users`, `POST /settings/users/:id/reactivate` |
| `leadsContacts` | leads + contacts of the company (live; customers are converted leads, not counted again) | `POST /leads` (quick add and full form: 1 + its contacts), `PATCH /leads/:id` (only contacts added), `POST /contacts`, `POST /leads/import` (partial, see below) |
| `storageMb` | sum of task attachment sizes, MB (live) | `POST /tasks/:id/attachments` |
| `emailsPerMonth` | emails sent in the current billing period (counter) | `POST /leads/:id/messages` with `channel: 'email'` (WhatsApp is not counted), `POST /quotations/:id/send` |
| `aiCredits` | credits used in the current billing period (counter) | `POST /ai/credits/consume` |

- A create is rejected when `current + needed > max`. Body: `402 { message, code: 'LIMIT_REACHED', limit, current, max, planId }`
  (`LimitReachedDetails`; the client keeps the body as `error.details`). `null` limits are unlimited.
- **Nothing is ever deleted because of a limit** (or a downgrade). Existing data stays readable and editable.
- **Import** creates valid rows in file order while they fit (a row = 1 lead + 1 contact when it has one) and reports
  the rest: `ImportResult.skippedForLimit` (count of valid rows not created) and `ImportResult.limitReached`
  (`LimitReachedDetails`, or `null`). They are not in `failed` or `skippedRows`.
- **Won flow**: creates a customer (customers are not counted), a contract, projects and tasks, and adds no leads,
  contacts, users, storage, emails or AI credits, so no limit is reachable from it today. If a plan error is ever
  raised inside it (402 / 403 / 423), the whole flow rolls back and the error keeps its `code` + details plus `step`
  (see **The Won flow**), so the upgrade prompt still opens.
- Per-period counters (`emailsPerMonth`, `aiCredits`) are stored per company **and** period start, incremented after a
  successful action; a renewal starts a new period, so they reset. Stock counters never reset.
- **Usage warnings**: when a limit reaches each `usageWarningThresholds` value (80 %, 100 %), every active Company Admin
  gets a stored notification (`type: 'usage'`, link `/settings/billing`). Each threshold is sent **once per limit per
  billing period** (sent keys are stored).

### Request policy (every authenticated request, in `userFrom`)

After the token, membership, operator-suspension and workspace checks, the server:

1. runs the subscription lifecycle for the caller's company (lazily, up to "now" of the mock clock);
2. `deleted` → **`410 workspace_deleted`** on everything, sign-in included (except `/dev/billing/*` in dev);
3. a path of a module the plan lacks → **`403 { code: 'module_not_in_plan', module, planId }`** (`ModuleLockedDetails`).
   Map: `/hr/*` → hr, `/events/*` → events, `/marketing/*` → marketing, `/finance/*` → accounting, `/integrations/*` and
   `/settings/email-connection` → integrations, `/ai/*` → ai;
4. status `suspended` or `cancelled` = **read-only**: every non-GET request → **`423 { code: 'workspace_read_only', status }`**
   (`ReadOnlyDetails`), except: `/auth/*` (role switch, impersonation stop), `/security/sessions*` and `/security/2fa*`,
   `POST /account/password`, `POST /billing/payment-method`, `POST /billing/reactivate`, `POST /billing/resume`,
   `/billing/export`, `POST /alerts/read-all`, `PATCH /alerts/:id/read`, `POST /announcements/:id/dismiss`, `/dev/billing/*`. GETs keep working.
5. module gating uses the company's **effective modules** = its plan version's modules ± platform module overrides.

Impersonation tokens are checked before the billing policy (see Super-Admin Console › Impersonation).

Past due keeps full access until the grace period ends.

### Lifecycle

Driven by the mock clock (`now()` = real time + simulated offset). It runs lazily for the caller's company on each
authenticated request and sign-in, and for every company on `POST /dev/billing/advance`. Each due event is applied at
**its own time, in time order**, so advancing many days walks through every intermediate transition.

```
            card on file: charge ──ok──▶ active ◀──────────── payment / reactivate ──────────────┐
 trialing ──┤                     └fail─▶ past_due ──grace──▶ suspended ──30 d──▶ cancelled ──30 d──▶ deleted
            └ no card ────────────────────────────────────────▶ suspended          ▲
 active ── period end: cancelAtPeriodEnd ─────────────────────────────────────────┘
          └ else: apply scheduledChange, charge ──ok──▶ active (new period, counters reset)
                                               └fail─▶ past_due
```

| From | When | To | What happens |
|---|---|---|---|
| trialing | `trialEndsAt − d` for d in `trialReminderDays` | (same) | reminder "Your trial ends in d days" (once each) |
| trialing | `trialEndsAt`, `cancelAtPeriodEnd` | cancelled | `deleteAt = + retentionDays` |
| trialing | `trialEndsAt`, card on file | active | plan → `selectedPlanId` (chosen at sign-up or with `POST /billing/trial-plan`) when it is still an active paid plan, otherwise the lowest-ranked active paid plan (the audit entry says why); a trial the platform already moved to a paid plan keeps it. New period, invoice paid |
| trialing | `trialEndsAt`, card on file, charge fails | past_due | open invoice, `graceEndsAt = + graceDays` |
| trialing | `trialEndsAt`, no card | suspended | read-only |
| active | `currentPeriodEnd`, `cancelAtPeriodEnd` | cancelled | `deleteAt = + retentionDays`, open invoices void |
| active | `currentPeriodEnd` | active | `scheduledChange` applied first, then `pendingPlanVersion` (if current usage fits it, else kept and audited); new period; invoice paid (none when the price is 0); period counters reset |
| active | `currentPeriodEnd`, charge fails | past_due | new period, open invoice, `graceEndsAt = + graceDays` |
| past_due | `statusChangedAt + d` for d in `pastDueReminderDays` (before the grace end) | (same) | "Payment overdue" reminder (once each) |
| past_due | `graceEndsAt` | suspended | read-only |
| suspended | `statusChangedAt + suspendedDaysBeforeCancel` | cancelled | `deleteAt = + retentionDays`, open invoices void |
| cancelled | `deleteAt` | deleted | `410` everywhere |
| past_due / suspended | `POST /billing/payment-method` | active | open invoice paid (or a new period) |
| suspended / cancelled | `POST /billing/reactivate` | active | new period from now, invoice paid |

Every transition writes an audit entry in that company (`entity: 'subscription'`, `changes: [{ field: 'status', from, to }]`;
actor **System** when automatic, the admin otherwise) and a stored notification (`type: 'billing'`, link `/settings/billing`)
to every active Company Admin. Reminders are sent once each. A charge fails when there's no payment method or the
dev "fail next payment" flag is set.

**Sign-up** (`POST /public/signup/:id/complete`, inside the atomic transaction): Trial → `trialing`, `trialEndsAt =
now + trialDays` (platform settings), no payment method, no invoice. Paid plan → `active`, one-month period, payment
method from the checkout card (brand, last 4, expiry, holder), first invoice paid.

### Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)

Any signed-in user; acts on the caller's company unless noted. Each returns `DevBillingStateDetails { offsetDays, now,
failNextPayment, subscription, simulated }`. A real backend has none of these.

| Method | Path | Body | Effect |
|---|---|---|---|
| GET | `/dev/billing/state` | | Current clock and simulation |
| POST | `/dev/billing/advance` | `{ days }` (0 < days ≤ 400) | Moves the mock clock and runs the lifecycle for **all** companies |
| POST | `/dev/billing/status` | `{ status }` | Forces a status (audited, admins notified): trialing / active start a new period now; past_due creates an open invoice and a grace period; cancelled sets `deleteAt` |
| POST | `/dev/billing/fail-next-payment` | `{ fail }` | The next automatic charge (renewal, trial conversion) fails, then the flag resets |
| POST | `/dev/billing/usage` | `DevUsageInput { key, percent }` (0–120) | Stores a per-company offset so `used ≈ percent` of the limit (real + offset; the offset stays fixed as real usage changes). Unlimited limits are ignored. Warnings fire as usual |
| POST | `/dev/billing/reset` | | Clears the company's usage offsets and fail flag (the clock is global and is not reset) |

## Super-Admin Console (platform)

Types: `src/modules/platform/types.ts` (the contract), `src/modules/tenancy/types.ts` (`PlatformRole`, `PLATFORM_PERMISSIONS`,
`canPlatform`, `ImpersonationInfo`). Server mock: `src/shared/mocks/services/platform.ts`, `services/impersonation.ts`,
`services/platformAudit.ts`, `handlers/platform.ts`, the gate `requirePlatform` in `handlers/utils.ts`, state in
`src/shared/mocks/data/platform.ts`. Tests: `src/shared/mocks/services/platform.test.ts`. Everything is enforced by the API.

**Platform staff never see passwords or card numbers.** No platform response carries a password, password hash, 2FA
secret, recovery code or token of a company user; cards are stored and shown as `{ brand, last4, expMonth, expYear, holder }` only.

### Auth

- `POST /platform/auth/login { email, password }` → `PlatformSession { kind: 'platform', token, platformUser }` (`401` wrong credentials).
  Seeded: `owner@apexcrm.app` (Platform Owner), `support@apexcrm.app` (Platform Support), `billing@apexcrm.app` (Platform Billing), demo password.
- Every other `/platform/*` endpoint runs `requirePlatform(request, permission)`: a **platform token only** — no token, a
  company token or an impersonation token → `401 { code: 'platform_auth_required' }`; then the permission →
  `403 { code: 'platform_forbidden', permission }`. Unknown `/platform/*` paths answer `404` behind the same gate.
- A platform token on any company endpoint → `401`.
- Errors are `{ message, code, ...details }`. Every write takes a `reason` (≥ 5 characters, `422 reason_required { min }`),
  except notes and announcements (optional reason). Impersonation needs ≥ 10 characters.

### Permission matrix

| Permission | What it allows | Owner | Support | Billing |
|---|---|:-:|:-:|:-:|
| `tenants:view` | company list, company page, users, timeline, notes (read), overview (without revenue), settings (read), announcements (read) | ✓ | ✓ | ✓ |
| `tenants:manage` | suspend / reactivate / cancel, module overrides | ✓ | | |
| `tenants:subdomain` | check and change a subdomain | ✓ | | |
| `billing:view` | revenue (MRR, amounts due), invoices, plans (read) | ✓ | | ✓ |
| `billing:manage` | change plan, extend trial | ✓ | | ✓ |
| `plans:manage` | create / edit plans, edit platform settings, plans (read) | ✓ | | ✓ |
| `support:impersonate` | start an impersonation | ✓ | ✓ | |
| `support:notes` | write internal support notes | ✓ | ✓ | |
| `announcements:manage` | create / edit / end announcements | ✓ | | |
| `audit:view` | the platform audit log | ✓ | ✓ | |

### Endpoints

| Method | Path | Permission | Body / query | Returns | Errors |
|---|---|---|---|---|---|
| GET | `/platform/me` | any platform user | | `PlatformMe { platformUser, permissions }` | |
| GET | `/platform/companies` | `tenants:view` | `?status=` (subscription status or `locked`) `&plan=&country=&q=` (name, subdomain, id) `&sort=name\|createdAt\|lastActivityAt\|users\|mrr&dir=asc\|desc` | `PlatformCompanyRow[]` (`users` = active users; `lastActivityAt` = latest sign-in or company-user audit entry; `mrr` normalized monthly, `null` without `billing:view`, and `sort=mrr` falls back to name). Export is client-side. | |
| GET | `/platform/companies/:id` | `tenants:view` | | `PlatformCompanyDetail` (subscription with masked card, the subscription's plan **version**, usage, `invoices` (`null` without `billing:view`), users count, `modules: CompanyModuleState[]` for the gateable modules, live `subdomainAliases`). Audited `company.viewed`. | `404 company_not_found` |
| GET | `/platform/companies/:id/users` | `tenants:view` | | `PlatformCompanyUser[] { id, name, role, email, active, lastLoginAt }`. Audited `company.viewed`. | `404` |
| GET | `/platform/companies/:id/timeline` | `tenants:view` | | `TimelineEvent[]`, newest first: the company audit log (`source: 'company'`; subscription entries `source: 'billing'`) + platform audit entries about the company (`source: 'platform'`, reason appended; `company.viewed` entries left out). Audited `company.viewed`. | `404` |
| GET | `/platform/companies/:id/notes` | `tenants:view` | | `SupportNote[]` of that company, newest first | `404` |
| POST | `/platform/companies/:id/notes` | `support:notes` | `{ body }` (1–2,000) | `SupportNote` (author from the token). Platform audit `note.added`. | `422 invalid_note`, `404` |
| POST | `/platform/companies/:id/actions` | per action (below) | `CompanyAction` | `PlatformCompanyDetail` (refreshed). Platform audit `company.<action>` with before/after/reason; company audit entry (actor "*name* (Apex CRM support)", reason); Company Admins notified. | `422 invalid_action`, `422 reason_required`, `404`, per action below |
| POST | `/platform/companies/:id/modules` | `tenants:manage` | `ModuleOverrideInput { module, enabled: true \| false \| null, reason }` | `PlatformCompanyDetail` | `422 invalid_module` (`{ allowed }`: hr, events, marketing, accounting, integrations, ai), `422 invalid_override`, `409 no_override` (remove without one), `422 reason_required`, `404` |
| GET | `/platform/subdomains/check` | `tenants:subdomain` | `?subdomain=&companyId=` | `SubdomainCheck { subdomain, available, reason }` (the company's own current address / own aliases aren't "taken" for it) | |
| POST | `/platform/companies/:id/subdomain` | `tenants:subdomain` | `SubdomainChangeInput { subdomain, reason }` | `PlatformCompanyDetail` | `422 invalid_subdomain` (format, reserved), `409 subdomain_taken` (another company, a live alias of another company, a pending sign-up), `409 same_subdomain`, `422 reason_required`, `404` |
| GET | `/platform/overview` | `tenants:view` | | `PlatformOverview` (mock clock). `mrr` / `mrrByPlan` / `pastDue[].amountDue` are `null` without `billing:view`. | |
| GET | `/platform/plans` | `billing:view` or `plans:manage` | | `PlatformPlan[]` — every plan (inactive too) by rank, with `version`, `versions: PlanVersionSummary[]` (subscribers per version) and `subscribers` | |
| POST | `/platform/plans` | `plans:manage` | `PlanCreateInput` (`id` 2–31 of `a-z0-9-`, `rank` defaults to last + 1) | `PlatformPlan` (version 1). Audited `plan.created`. | `409 plan_exists`, `422 invalid_plan_input { field }`, `422 reason_required` |
| PATCH | `/platform/plans/:id` | `plans:manage` | `PlanEditInput { …fields, migration, reason }` | `PlanEditResult { plan, newVersion, migrated, scheduled, skipped }`. Audited `plan.updated` (before/after). | `404 plan_not_found`, `422 invalid_migration`, `422 invalid_plan_input { field }`, `422 reason_required` |
| DELETE | `/platform/plans/:id` | `plans:manage` | | — | always `405 method_not_allowed` (plans are never deleted; deactivate them) |
| GET | `/platform/settings` | `tenants:view` | | `PlatformSettings` = `PlatformBillingSettings` + `subdomainRedirectDays` (30) + `impersonationMinutes` (30) | |
| PATCH | `/platform/settings` | `plans:manage` | `Partial<PlatformSettings> & { reason }` | `PlatformSettings`. Audited `settings.updated` (before/after). | `422 reason_required`, `422 invalid_settings { field }`: `trialDays` 1–90, `graceDays` 0–60, `suspendedDaysBeforeCancel` / `retentionDays` 0–365, day lists ≤ 10 items of 1–90 / 1–60, thresholds 1–100, `subdomainRedirectDays` 0–365, `impersonationMinutes` 5–240 |
| GET | `/platform/announcements` | `tenants:view` | | `Announcement[]`, newest first, each with `reach` (companies in the segment now, deleted excluded) | |
| POST | `/platform/announcements` | `announcements:manage` | `AnnouncementInput` | `Announcement`. Audited. | `422 invalid_announcement { field }` (title 3–120, body 1–2,000, tone, known plans / countries, valid times, end after start) |
| PATCH | `/platform/announcements/:id` | `announcements:manage` | `Partial<AnnouncementInput>` | `Announcement`. Audited. | `404 announcement_not_found`, `422 invalid_announcement` |
| DELETE | `/platform/announcements/:id` | `announcements:manage` | | `Announcement` ended now (`endsAt = now`; the row is kept). Audited `announcement.ended`. | `404` |
| GET | `/platform/audit` | `audit:view` | `PlatformAuditQuery` `?actor=` (id, or part of the name) `&action=` (exact, or a prefix like `company` / `impersonation.`) `&companyId=&from=&to=` (ISO) `&q=` (summary, reason, company, actor) | `PlatformAuditEntry[]`, newest first | |
| POST | `/platform/impersonations` | `support:impersonate` | `ImpersonationStartInput { userId, reason }` | `Session` with `impersonation: ImpersonationInfo` (read mode) | `422 reason_required` (< 10 characters), `404` user, `409 user_deactivated`, `409 company_locked`, `409 company_deleted` |

**Company side** (company token):

| Method | Path | Who | Body | Returns | Errors |
|---|---|---|---|---|---|
| GET | `/announcements` | any signed-in user | | `CompanyAnnouncement[] { id, title, body, tone, endsAt }`: active now by the mock clock (`startsAt ≤ now < endsAt`), in the company's segment (plan of its subscription, `regional.country`; empty list = all), not dismissed by this user | |
| POST | `/announcements/:id/dismiss` | any signed-in user | | `{ ok: true }`; stored per user on the server. Allowed while the workspace is read-only (suspended / cancelled); a write, so refused in impersonation read mode. | `404` (unknown or not in the segment) |
| POST | `/billing/trial-plan` | Company Admin, trialing | `{ planId }` | `BillingOverview` | see Plans, limits and subscription lifecycle |
| POST | `/auth/impersonation/write-mode` | impersonation token | `{ confirm: true }` | refreshed `Session` (`impersonation.mode: 'write'`, new token) | `422 confirmation_required`, `403 not_impersonating` (normal token) |
| POST | `/auth/impersonation/stop` | impersonation token | | `{ ok: true }` | `401 impersonation_ended / impersonation_expired` |

### Company actions

| `action` | Permission | Body | Rule | Errors |
|---|---|---|---|---|
| `change_plan` | `billing:manage` | `{ planId, reason }` | Immediate, **no charge**, same subscription (status kept; a trial stays a trial, and converts to that plan at its end). Moves to the plan's current version; clears a scheduled downgrade and a custom price when the plan changes. Overrides are kept. | `422 invalid_plan` (unknown, inactive or the trial), `409 same_plan`, `409 invalid_state` (deleted) |
| `extend_trial` | `billing:manage` | `{ days, reason }` | Trialing only; `trialEndsAt` (and the trial period end) + 1–90 days. Reminders are re-planned from the new end; ones already due under the new date are skipped, not sent late. | `409 invalid_state`, `422 invalid_days` |
| `suspend` | `tenants:manage` | `{ reason }` | `Company.status = 'suspended'` = operator lock: every request and sign-in of the company → `403 workspace_suspended`. | `409 invalid_state` (already locked) |
| `reactivate` | `tenants:manage` | `{ reason }` | Lifts the lock; a billing-suspended or cancelled subscription returns to **active with a new period from now, no charge** (open invoices void; an ended trial converts as at trial end). | `409 invalid_state` (nothing to reactivate, or deleted) |
| `cancel` | `tenants:manage` | `{ reason }` | Subscription → cancelled now (read-only, `deleteAt = now + retentionDays`). | `409 invalid_state` (already cancelled / deleted) |

### Module overrides

A module turned on or off for one company, overriding its plan (only the gateable modules: hr, events, marketing,
accounting, integrations, ai). Effective modules = plan version modules ± overrides; they drive `GET /billing/entitlements`
`modules`, `Company.enabledModules`, and the API gating (`403 module_not_in_plan`). Overrides are stored per company,
**survive plan changes** and are removed with `enabled: null`. Audited in both logs; admins are notified when the
effective state changes.

### Subdomain aliases

Only the platform changes a subdomain (no company endpoint can). On a change the old subdomain becomes an **alias**
that redirects for `subdomainRedirectDays` (default 30, `SubdomainAlias.redirectUntil`):

- `GET /public/workspaces/<old>` answers the company with **`redirectTo: "<new subdomain>"`** (`PublicCompany.redirectTo`,
  additive; absent for the current address). After `redirectUntil` the old address is `404 workspace_not_found`.
- Requests whose `X-Workspace` is a live alias of the caller's own company are accepted (not `tenant_mismatch`); sign-in on
  the old address works too.
- While it redirects, the alias can't be taken by another company or a sign-up (`GET /public/signup/availability` says taken).
  The same company can take it back (the alias ends).
- Uniqueness is checked against companies, live aliases of other companies and pending sign-ups.
- Audited in both logs (`subdomain.changed`); Company Admins are notified.

### Versioned plans

- Every plan has `version` (`Plan.version`); every version is stored (price, billing period, limits, modules). A subscription
  points at one (`BillingSubscription.planVersion`), and **all** of its limit, module and price checks (limits, usage, gating,
  renewal charges, entitlements, MRR) use that version. Name, highlights, rank, checkout and `active` come from the plan itself.
- `PATCH /platform/plans/:id`: changing name / highlights / active creates no version. Changing price, billing period,
  limits or modules creates version N+1, and `migration` decides what happens to subscribers on older versions:
  - `keep` — they stay on their version (new sign-ups and changes get the new one);
  - `at_renewal` — `pendingPlanVersion` is set; their next renewal moves them (if current stock usage fits the new limits,
    otherwise they stay and it's audited);
  - `now` — moved immediately unless current stock usage (users, leads + contacts, storage) exceeds the new limits; those are
    left on their version and listed in `skipped: [{ companyId, name, reasons }]`. Nothing is ever deleted or blocked.
- Deactivating (`active: false`): existing subscribers keep the plan; it disappears from `GET /public/plans`, the company
  change-plan / reactivate choices and the platform `change_plan` action. Plans are never deleted (`DELETE` → `405`).

### Trial conversion

`BillingSubscription.selectedPlanId` (trial only) is the paid plan to continue on: set at sign-up
(`SignupCompleteInput.continuePlanId`: an active plan with `checkout: 'payment'`, else `422 invalid_plan`) or with
`POST /billing/trial-plan`. Saving a card during the trial keeps it. When the trial ends with a card, the subscription
converts to it; if none is selected or it is no longer active, to the lowest-ranked active paid plan, and the audit entry
says so. The same applies when a card is saved after a trial ended without one.

### Impersonation

- `POST /platform/impersonations { userId, reason }` (Owner, Support; reason ≥ 10 characters) creates a server-side session
  `{ sessionId, platform user, company, user, reason, startedAt, expiresAt = now + impersonationMinutes (mock clock),
  mode: 'read', endedAt, endReason }` and returns a company `Session` whose `impersonation` is
  `ImpersonationInfo { platformUserId, platformUserName, platformRole, startedAt, sessionId, reason, expiresAt, mode }`.
  Refused for a deactivated user (`409 user_deactivated`) or a locked / deleted company (`409 company_locked` / `company_deleted`).
- On every request with an impersonation token (`userFrom`), the **session record** decides (the token is never trusted for
  mode or expiry): ended → `401 impersonation_ended`; past `expiresAt` → the session is ended (`endReason: 'expired'`,
  audited in both logs) and `401 impersonation_expired`.
- **Read mode** (default): every non-GET → `403 impersonation_read_only`, except `/auth/impersonation/*` and `/auth/logout`.
- **Write mode**: `POST /auth/impersonation/write-mode { confirm: true }` (second confirmation), audited in both logs; returns
  the refreshed `Session`. Existing tokens of the session are upgraded too (mode is read from the record).
  Every audited write made during the session is marked in the company audit log: its summary ends with
  "(during a support session by <operator>, Apex CRM support — reason: <reason>)", so the company admin sees which
  changes support made and why.
- **Always blocked** while impersonating, in both modes → `403 impersonation_blocked`:
  `/account/password`, `/security/2fa*` (all methods), writes to `/security/sessions*`, `/auth/switch-role`, every write under
  `/billing/*`, any `…/export` path (incl. `GET /billing/export`), and company deletion paths (`DELETE /tenant|/company|/workspace`,
  `…/delete`; no such endpoint exists yet, the rule is in place).
- `POST /auth/impersonation/stop` ends the session (`endReason: 'ended'`), audited in both logs.
- **Both logs** on start, write-mode, stop and expiry: the platform audit (`impersonation.started|write_mode|ended|expired`,
  actor, company, reason, IP) and the company's own audit log (`entity: 'security'`, actor "*name* (Apex CRM support)", summary
  with the operator's name, platform role and the reason), so the company admin sees who accessed the workspace and why.
- Impersonation tokens are company tokens: they get `401` on every `/platform/*` endpoint.

### Platform audit

`PlatformAuditEntry { id, at, actorId, actorName, actorRole, action, companyId, companyName, summary, before, after, reason, ip }`,
newest first. Written for **every platform write** (`company.change_plan|extend_trial|suspend|reactivate|cancel`,
`company.module_override`, `company.status_set`, `subdomain.changed`, `plan.created|updated`, `settings.updated`,
`announcement.created|updated|ended`, `note.added`, `impersonation.*`) and for reads of one company's data
(`company.viewed`: company page, users, timeline). `ip` is a mocked, stable IP per platform user and sign-in session.
Writes that affect a company are also recorded in that company's audit log.

## Onboarding

`GET /onboarding` → `OnboardingState { items: OnboardingItem[], done, total, complete, dismissed }`, computed for the
caller's company. Company Admin and Management read (`403` others); only Company Admin writes. Progress and dismissal
are stored **per company** on the server, so every admin sees the same state.
Item: `{ id, title, description, href, done, manual }`.

| id | Title | Done when | href |
|---|---|---|---|
| `profile` | Complete your company profile | legal name, address line 1, city, phone, email and tax number set | `/settings/company-profile` |
| `team` | Invite your team | ≥ 2 active users, or a pending invitation | `/settings/users` |
| `lists` | Review lists and workflow rules | marked done (manual) | `/settings/lists` |
| `services` | Add your services | ≥ 1 active service | `/services` |
| `leads` | Add your first lead | ≥ 1 lead | `/leads/new` |
| `email` | Connect email | an email connection exists (manual: `POST /settings/email-connection`) | `/settings/email` |

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/onboarding/items/:id/complete` | | `OnboardingState` (manual items only, i.e. `lists`; `422` for data items and `email`; `404` unknown id) |
| PATCH | `/onboarding/items/:id` | `{ done: boolean }` | `OnboardingState` (same rules; `done: false` un-marks) |
| POST | `/onboarding/dismiss`, `/onboarding/restore` | | `OnboardingState` |
| PATCH | `/onboarding` | `{ dismissed: boolean }` | `OnboardingState` |

## Departments

Membership has one source of truth: `User.departmentId`. Moving a member here and changing a user's
department in Settings › Users & roles (`PATCH /settings/users/:id`) are the same change; that endpoint
refuses to move someone who heads a department (`422 "… heads X. Pick a new head for X first"`) and
refuses inactive target departments.

Access (`departments` column of the permission matrix): **full** (Company Admin, Management, HR Manager)
sees and changes everything; **team** (Sales Manager, Marketing Manager, Department Head) sees the
departments they head plus their sub-departments (and their own), can change members' direct managers
and goals there; **view** (everyone else) sees their own department read-only. Structure changes
(create, rename, parent, head, cost center, member moves, deactivate) are full scope only (`403`).

**Team scope everywhere follows departments:** a user's team = themselves + direct reports + every member
of the departments they head and their sub-departments (`teamIdsFor` in `src/shared/lib/permissions.ts`).
Leads, CRM, quotations, messages, reports, targets and alerts use it.

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/departments` | `?includeInactive=true` | `DepartmentRow[]` (+ headName, parentName, memberCount, childCount, depth, openTasks, overdueTasks, openGoals) | Scoped as above; hidden → `403`. Sorted by depth, then name. |
| GET | `/departments/org-chart` | | `OrgNode[]` `{id, name, parentId, active, head{id,name,title}\|null, memberCount}` | Scoped; ancestors of visible departments are included for context. |
| GET | `/departments/:id` | | `DepartmentDetail` (+ goals, members (incl. inactive), children, path, tasks (open member lead tasks; project tasks come with the Tasks module), figures, `can {edit, manageMembers, editGoals}`) | `404`; `403` outside the caller's departments. Figures are sales-only for now: headcount (+ with sub-departments), leads owned, open leads, open pipeline value, won this month, overdue follow-ups, activity-target completion % (members with targets; events excluded). |
| POST | `/departments` | `{ name, parentId, headId, costCenter?, active? }` | `DepartmentRow` | Full scope. Name required, ≤80, unique (case-insensitive); parent must exist and be active; cost center ≤40. A head who isn't a member is moved in (audited). |
| PATCH | `/departments/:id` | `{ name?, parentId?, headId?, costCenter?, moveHeadIn? }` | `DepartmentRow` | Full scope. **No cycles** (`422` if the parent is the department itself or one of its sub-departments). **Head must be a member**: `409` unless `moveHeadIn: true`, which moves them in; someone who heads another department can't be moved (`422`). `headId: null` removes the head. |
| POST | `/departments/:id/deactivate` | | `DepartmentRow` | Full scope. Never deleted. `409` while it has active members or active sub-departments ("Move N members and M sub-departments out of X before deactivating it."). Clears the head. |
| POST | `/departments/:id/reactivate` | | `DepartmentRow` | Full scope; the parent must be active (`422`). |
| POST | `/departments/move-members` | `{ userIds[], toDepartmentId, managerId? }` | `{ moved }` | Full scope (bulk move; also how members are added/removed). Target must be active; a person who heads another department can't be moved (`422`); optional new direct manager must be active and not one of the moved people. Each move is audited. |
| PATCH | `/departments/:id/members/:userId` | `{ managerId }` | `DepartmentMember` | Full scope or the head (managed departments). Manager must be active; no self-management or reporting loops (`422`). |
| POST | `/departments/:id/goals` | `{ title, ownerId, dueDate (yyyy-MM-dd\|null), status? }` | `DepartmentGoal` | Full scope or the head. Title required ≤160; owner active. |
| PATCH | `/departments/:id/goals/:goalId` | partial of the above | `DepartmentGoal` | Same. |
| DELETE | `/departments/:id/goals/:goalId` | | `{ id }` | Same (goals are plain records, not structure). |

Audited (entities `department`, `department-member`, `department-goal`): create, edit (field diff), head
changes ("Head of X: A → B"), every member move ("Moved P from X to Y"), manager changes, deactivate /
reactivate, goal create / edit / delete.

## The Won flow

One atomic server action converts a won deal. Every trigger in the UI goes through one rule,
`moveActionFor(status) === 'won'` (kind `won` **or** `requires: 'convert'`, `modules/leads/lib/transitions.ts`),
and opens the same confirm dialog (`useOpenWonDialog` → `WonDialog`), which reads the preview and then calls
`POST /leads/:id/won`: dragging a lead to a Won column (pipeline), the lead page's stage select and its
"Win deal" button, the lead form's status select (saves the other fields, then opens the dialog), the stage
dialog, and accepting a quotation (QuotationEditorPage "Accepted" → "Review and win", "Win deal" on an accepted
quotation in QuotationEditorPage / QuotationsPage / LeadQuotations).

**No other write can set a Won-flow status** (the server enforces it, so a client bug can't skip the flow):

| Write | Answer |
|---|---|
| `PATCH /leads/:id/stage` to a kind `won` or `requires: 'convert'` status | `409 { code: 'use_won_flow', message: "Use the Won flow to win a lead…" }` |
| `POST /leads` / `PATCH /leads/:id` with such a `status` in the body | `422 { code: 'use_won_flow', … }` (any other `status` there is ignored, as before) |
| `POST /leads/import/check`, `POST /leads/import`: a row with such a status | row error "Status “Won” can’t be imported… use the Won flow", the row is not created (`failed`) |
| `PUT /lookups/statuses` making a status that leads are in a Won-flow status | `422` "move them out first" |

Interested still needs next step + date; Lost / Not interested still need a loss reason from the list.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| POST | `/leads/:id/won/preview` | `{ quotationId?, serviceIds?, projectManagerId?, startDate? }` (all optional) | `WonPreview` | Nothing is saved. Defaults: quotation = first Accepted one; services = the quotation's catalog lines, else the lead's recommended + interest services; project manager = the lead owner's manager (else the owner); start = next working day. Needs sales edit on the lead, like the submit (`403`; another company's lead `404`). A quotation that is missing / another company's, of another lead, or not Accepted is a blocking problem and feeds neither services nor the contract. Names come from the lead's company only. Returns `problems` (blocking), `warnings`, customer create/link, carried-over counts (contacts, notes, activities), contract preview, one project per service with the planned tasks (owner, fallback flag, due date, hours) and who'll be notified. `alreadyWon` when the lead is Won with a customer. |
| POST | `/leads/:id/won` | `WonInput { quotationId?, serviceIds[], projectManagerId, startDate (yyyy-MM-dd), idempotencyKey }` | `WonResult { leadId, customerId, customerCreated, contractId, projectIds[], taskIds[], redirectTo }` | Needs sales edit on the lead and the lead in the caller's sales scope (own / team / full; `403`); another company's lead `404`. A `companyId` / tenant in body, query or headers is ignored. Errors are `{ message, code?, ...details, step }` with `step` ∈ `validate, lead, customer, contract, projects, notify, audit`. A coded error keeps its `code` and details, e.g. `402 { code: 'LIMIT_REACHED', limit, current, max, planId, message, step }`, `403 { code: 'module_not_in_plan', module, planId, … }`, `423 { code: 'workspace_read_only', status, … }`, `422 { code: 'quotation_not_accepted', … }`, so the axios interceptor still opens the upgrade prompt and the dialog shows which limit (current of max) with Upgrade for Company Admins. |

**Steps (all-or-nothing):** every store it touches is snapshotted first and restored if any step fails
(the response then says which step failed and that nothing was saved).
1. **validate**: `409` if the idempotency key was already used (double submit), if the same lead is
   being won concurrently (in flight), or if the lead is already Won with a customer. `404` if `quotationId`
   or `projectManagerId` doesn't exist in the lead's company (another company's id answers exactly like a
   missing one). `422` if the quotation belongs to another lead, if it isn't **Accepted**
   (`code: 'quotation_not_accepted'`: accept it first, or win without one; accepting and then winning in one
   go works), or if the lead has no contact, no purchased service, an unknown/inactive service, an inactive
   project manager or a bad start date.
   **"At least one contact"** = a contact record of the lead (with a name), **or** the lead's primary contact
   with a name **and** a mobile or an email. The `contactName` text alone does not count ("Add at least one
   contact (a name with a mobile or an email) before winning this lead."). At least one purchased service.
2. **lead**: status → the Won status (lookup key `Won`), `stageChangedAt` = now, follow-up cleared.
3. **customer**: links the customer with this `leadId` (or the same company name), else creates one from the
   lead (company, industry, website, emirate, value, services). Contacts, notes and the activity history stay
   on the lead id that the customer references, so nothing is retyped. Purchased services are added.
4. **contract**: only from an Accepted quotation of this lead, when it has recurring lines (unit `month`): billing Monthly, value = monthly net,
   renewal = start + the longest monthly term on the quote.
5. **projects**: one per purchased service, status Planned. Tasks come from the service's project template:
   due date = start + template day offset + task length (hours ÷ 8, at least 1 day) − 1, in the company's **working
   days** (from its region's weekend: Mon–Fri for the UAE, Sun–Thu for Saudi Arabia); owner = an active person whose job title matches the template role in the project manager's
   department, then in the Delivery department (fewest assigned first), otherwise the project manager.
   A service without a template gets a project with no tasks (preview warns).
6. **notify**: lead owner (`won`), project manager (`assignment`), each task owner (`assignment`).
7. **audit**: audit entries for the customer (`create`, or `update` "linked" with the services change), the
   contract (`create`), **each project** (`create`, so the project's Activity tab has history from day one) and
   last the lead (`update`, status change). A `system` activity on the lead, and also on the customer's own lead
   when an existing customer of another lead was linked (a customer's timeline reads its lead's activities).

**Carry-over.** Contacts, notes and activities are referenced by `leadId`, not copied: `GET /customers/:id`
returns the lead's contacts, notes and last 10 activities, and the customer page's Activity tab reads the
whole history from `GET /leads/:leadId/activities`.

**Plan limits and modules.** The flow counts toward no limit (customers, contracts, projects and tasks
aren't limited; it adds no leads, contacts, users or files), so none is reachable today. It touches only
Sales, CRM and Projects/Tasks, none of which is a gateable module (`GATEABLE_MODULES`: hr, events,
marketing, accounting, integrations, ai), so no module check applies; a read-only (Suspended / Cancelled)
workspace is refused before the flow by the request policy (`423`). Any plan error raised inside a step is
rolled back with its code + details preserved (above).

**Test-only failpoints (mock only).** Unit tests pass `{ failAt: step, failWith?: 'error' | 'limit' | 'module' | 'read_only' }`
to `winLead`; browser tests set `window.__apexWonFailAt = '<step>'` (and optionally `window.__apexWonFailWith`)
before the app loads, like `__apexMoveFailureRate`. The real backend has no failpoints.

**After success** the client invalidates leads (+ alerts), CRM (customers, contacts, contracts), quotations,
projects, tasks, alerts / notifications, dashboard, reports, audit, services, departments and targets
(`WON_INVALIDATES`), shows a toast and navigates to `redirectTo` (the first project, else the customer).

## Tasks

Tasks scope (`tasks` column of the permission matrix): **Own** for Sales Agent, Employee, Accountant and HR
Manager; **Team** (real department membership, `teamIdsFor`) for Sales Manager, Department Head and
Marketing Manager; **Full** for Company Admin and Management. Everyone also sees tasks they follow or created
and the tasks of projects they manage. A task links to a lead, customer, project or event (polymorphic
`link {type, id}`); event links are stored but inactive until the Events module exists.

**Dates are the company's.** "Today", `overdue`, "due this week" and the reminders use the company's
regional settings: the calendar date in its `timezone` and weeks starting on its `weekStartsOn` (0 Sun, 1 Mon,
6 Sat), never the server's or the browser's clock zone. Example: at 22:30 UTC on 18 Nov a task due 18 Nov is
already overdue for a Riyadh or Dubai company (it is the 19th there) but due today for a UTC company. The mock
reads time from `clock.ts` (`now()`, moved by the dev clock), so simulated days apply to tasks too. The task
screens use the same helper (`shared/lib/companyDay.ts`) with the tenant's regional settings: My tasks groups
(Overdue / Today / This week / Later / No date), the calendar's today and week start, due labels.

**`TaskView`** = `Task` + `ownerName`, `followerNames`, `projectName`, `overdue` (company calendar),
`linkView {type, id, label, available}` and **`canEdit`**:
- `canEdit`: may the caller change this task (the same rule PATCH enforces): the tasks `edit` right (a `view`
  scope is read-only) and owner, creator, follower, the project's manager, team scope over the owner, or full
  scope. The board, calendar, status menus, list and drawer use it per task; the UI also blocks every move while
  the workspace is read-only (suspended / cancelled / read-only support session) with that reason.
- `linkView.available`: false when the target doesn't exist in the company, is an event (until Events is
  enabled), **or the caller couldn't open it**: a lead or customer outside their Sales & CRM scope, a project
  outside their projects scope. The chip still shows the label (non-clickable, with the reason as a tooltip).

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/tasks/assignable` | | `{ id, name, title, role, departmentId }[]` (caller first, then by name) | The active users of the caller's company that POST / PATCH accept as `ownerId`: own scope → only the caller; team scope → `teamIdsFor` (direct reports, members of the departments they head and of those departments' sub-departments); full → everyone active. A role without create/edit gets only themselves; hidden → `403`. Owner pickers (quick add, drawer) use it. Never another company's users. |
| GET | `/tasks` | `?mine, ownerId, projectId, linkType, linkId, status, priority, dueFrom, dueTo, includeDone` | `TaskView[]` | Scoped as above (`403` if hidden). Done only with `includeDone` or `status=Done`; `dueFrom/dueTo` drop undated tasks. Sorted by due date (undated last), then priority (Urgent first), then newest. |
| GET | `/tasks/:id` | | `TaskView` | `404` if missing or not visible. |
| POST | `/tasks` | `TaskInput` | `TaskView` | Title 1–160; owner defaults to the caller and must be active; own scope may assign only to themselves, team scope only within the team (`403`); followers active; link target must exist; priority `Low/Medium/High/Urgent`; status `To do/In progress/Blocked/Done` (Blocked needs `blockedReason`, see PATCH); due yyyy-MM-dd or null. A project link sets `projectId`. History "created"; `assignment` notification when someone else is the owner. |
| PATCH | `/tasks/:id` | `TaskUpdateInput` (incl. `loggedHours`, `blockedReason`) | `TaskView` | Editors = `canEdit` (`403`, the message says whether the role can't edit tasks or the task isn't theirs). **Moving to Blocked needs `blockedReason`** (3–280 characters) → `422` without it; it is posted as a comment "Blocked: …" and quoted in the status history (already Blocked: not asked again). One history event per changed field ("Status: To do → In progress"); `completedAt` set/cleared with Done; new owner notified. Board and calendar moves are this PATCH (`status` / `dueDate`); the UI updates every cached list at once and restores it when the server refuses. Test hook (mock only): `window.__apexMoveFailureRate = 1` makes status / due-date changes fail with `503` (default: never). |
| POST | `/tasks/:id/comments` | `{ body, mentions? }` | `TaskView` | Anyone who can see the task. Body 1–2000. `@Full Name` (or a unique `@First`) and explicit `mentions` ids → `mention` notifications (not the author). |
| POST | `/tasks/:id/attachments` | `{ name, size, type }` | `TaskView` | Editors. Mocked upload: metadata only, ≤ 25 MB (`422`). Counts toward the plan's `storageMb` limit: over it → `402` (see **Limits**). The backend stores the file. |
| DELETE | `/tasks/:id/attachments/:attachmentId` | | `TaskView` | Editors; `404` if gone. |

**Reminders (Settings › Automation):** the owner gets a `task` alert from `taskReminderDaysBefore` days before
the due date until the due day; once overdue, the owner and the owner's manager (and team/full-scope viewers)
get `task-overdue` (`danger`). Days are the company's (timezone, mock clock). See `GET /alerts`.
**Decision:** task reminders are **computed** alerts in the bell (recomputed on every `GET /alerts` from the
tasks and the automation numbers; they clear when the task is done or rescheduled, and can't be marked read).
The stored notification types `task-due` / `task-overdue` exist in `StoredNotification` but nothing writes
them; a real backend that wants e-mail or push delivery would add them then, keeping the same rules.

## Projects

Projects follow the **tasks** column of the permission matrix (role tests: `permissions.isolation.test.ts`
checks list, detail, create, patch, manager change and status for all nine roles in both companies).
A role whose tasks scope is hidden gets `403` for every project request (any id, also another company's, so a
foreign id still answers like a missing one); otherwise another company's project is `404` and a project of
the company outside the caller's scope is `403`.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/projects` | | `ProjectRow[]` (customer/service/manager names, task counts, overdue, `progress` %, `loggedHours`) | Same tasks scope: full / view = all; team = projects managed by the team or with team-owned tasks or tasks I follow; own = projects you manage or have (or follow) tasks in. Newest first. |
| GET | `/projects/:id` | | `ProjectDetail` = row + `tasks: TaskView[]` (every task of the project, each with the caller's `canEdit`) + `audit: AuditEntry[]` + `canManage` | `404` / `403` as above. |
| POST | `/projects` | `ProjectInput & { generateTasks?: boolean }` (default true) | `ProjectRow` | Full or team scope (`403` otherwise). Name 1–160; customer exists; service exists and is active; manager active; start ≤ end; status `Planned/Active/On hold/Completed/Cancelled`; hours ≥ 0. `generateTasks` builds tasks from the service template exactly like the Won flow. Audited; manager and task owners notified. |
| PATCH | `/projects/:id` | `ProjectUpdateInput & { force?: boolean }` | `ProjectRow` | `canManage`: the tasks `edit` right (a view scope is read-only, even for the manager), then full scope, the project manager, or a team-scope user over the manager (`403`). A manager of another company → `422`. Completed while tasks are open → `409` unless `force: true`. Audited with field changes; a new manager is notified. |

Progress = done share of the project's tasks, weighted by estimated hours when present. The project timeline
plots working days from the company's weekend (e.g. "Working days (Sun–Thu)" for a Friday–Saturday weekend)
with week ticks on its `weekStartsOn`.

## Changes to earlier endpoints (tasks & Won)

- **`GET /alerts`** adds types `task` (owner reminder), `task-overdue`, and the stored notifications `won`,
  `assignment`, `mention` (with `stored: true` and `read`). New: **`PATCH /alerts/:id/read`** (stored
  notifications only; computed ids → `422`, others' → `404`) and **`POST /alerts/read-all`** → `{ updated }`.
  Task alerts need a tasks scope (not a sales scope).
- **`GET /dashboard/summary`** adds `tasks { myOpenTasks, myOverdueTasks, dueThisWeek, teamOverdueTasks, scope,
  next[] }` from the same task selectors as the tasks API.
- **`GET /reports/sales`** `overdueTasks[]` now covers every task kind: `{ taskId, title, linkType, linkId,
  linkLabel, linkAvailable, projectId, projectName, ownerId, ownerName, dueDate, daysOverdue, priority, status }`,
  narrowed by the report scope, department and owner filters.
- **Departments** `tasks` in `GET /departments/:id` now come from the unified task store (lead, project and
  personal tasks) with `projectId` and `linkLabel`.
- **Activities** gain type `system` (written by the app, e.g. the Won flow; never offered in pickers).

---

Next modules (HR, Events, Marketing, Accounting…) add their sections here as they're built.
