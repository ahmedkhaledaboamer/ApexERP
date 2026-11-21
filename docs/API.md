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
  months are `yyyy-MM`. A lead's `next_follow_up_date` is a **company-local calendar date** (`yyyy-MM-dd`,
  never a datetime): "today", "overdue" and "+N days" use the company's timezone (Settings › Company ›
  Regional) at the server's clock; a datetime there is refused (`422`). Money is in the company currency (`tenant.regional.currency`; AED for Apex Aora).
- **IDs:** strings.
- **Scope:** unless noted, Sales/CRM endpoints are scoped by the caller's `sales` permission
  (own / team / full); a hidden scope gets `403`. Writes need `edit` (or `create`) on `sales`.
- **Wire format (database column names):** every company endpoint except auth / tenant / account / alerts and the
  platform console speaks the "Apex Aora ERP Database Design" columns in snake_case: leads (contacts, activities,
  notes, stage moves, duplicates, owners, import), contacts, lookups, customers, contracts, quotations, the Won flow,
  messages, services / packages / project templates, tasks, projects, departments, settings users, roles, security,
  audit log, message templates, targets, automation rules, report schedules, reports, dashboard, company profile,
  branding, onboarding, email connection, announcements, billing and public sign-up. The client maps them to its
  camelCase types in one layer (`src/shared/api/mapping.ts`, mappers in `src/shared/api/mappers.ts`). Field tables:
  `docs/DB-ALIGNMENT.md` (leads, contacts, lookups) and `docs/DB-ALIGNMENT.md` (everything
  else, incl. opaque map-valued fields and the fields with no design column). **The camelCase names in the tables
  below are the UI names; on the wire each is the snake_case / design column given there** (e.g. `validUntil` →
  `valid_until`, a customer's `ownerId` → `account_manager_id`). Query parameters are snake_case too (`lead_id`,
  `owner_id`, `include_done`, `include_inactive`, `related_type`…). Not converted (camelCase): `/auth/*`, `/tenant`,
  `/users`, `/account*`, `/alerts*`, `/public/workspaces/:subdomain`, the sign-up completion session, `/platform/*`
  and `/dev/*`. Error bodies are never mapped.
- **Status enums:** values on the wire are lower-case snake values, labels are display-only
  (`src/shared/domain/enums.ts`): customer `active|paused|vip|churned`; quotation
  `draft|sent|viewed|accepted|rejected|expired`; contract `draft|active|expired|cancelled|renewed`;
  lead status `type` `open|won|lost|cold|parked`. Anything else → `422`.
- **Lookup keys:** lead `status`, `sourceType`, `industry`, `subIndustry` and `lossReason` (and the
  customer copies of industry/source) are **keys of the fixed lists** (`GET /lookups`), never free
  text. The server validates them on create / update / import and answers `422` when a value isn't
  an **active** list item; an unchanged value on an existing record is accepted even if it has
  since been deactivated. Labels are display-only; clients look them up by key. Built-in status
  keys are stable (`New`, `Contacted`, `No response`, `Call later`, `Interested`, `Meeting`,
  `Proposal`, `Cold`, `Won`, `Lost`, `Not interested`); open/closed logic uses the status `type`
  (`open`, `won`, `lost`, `cold`, `parked`; everything but `open` is out of the pipeline), forecasts use its
  `probability`, and stage moves enforce its `requires_next_step` / `requires_loss_reason` flags. On the wire
  (leads) these fields are `status_id`, `source_id`, `industry_id`, `sub_industry_id`, `loss_reason_id`. `sourceType` (list key) and `sourceDetail` (free text: link or name) are separate fields.

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
| GET | `/leads` | | `LeadRow[]` (snake_case: `id, company_name, contact_name, email, phone, industry_id, sub_industry_id, source_id, source_detail, status_id, stage_changed_at, owner_id, owner_name, estimated_value, next_follow_up_date, created_at, do_not_contact, next_step, loss_reason_id, customer_id, company_services, service_ids, recommended_service_id, recommended_service_text, score, reopen_eligible`) | Scoped. `403` if hidden. `reopen_eligible`: true for a lead whose status type is `lost` and whose `stage_changed_at` is at least `lostReopenDays` ago (Settings > Automation). |
| POST | `/leads` | Quick add `{company_name, contact_name, phone, email, source_id, industry_id, force?}` or the full form (+ `contacts[] {name, title, mobile, email, is_decision_maker}`, `website, source_detail, sub_industry_id, owner_id, estimated_value, next_follow_up_date (yyyy-MM-dd), next_step, company_services, service_ids, recommended_service_id, do_not_contact, note`) | `LeadRow` | Status always the first open status (`New`). Owner auto-assigned to the least-loaded Sales Agent unless a manager (sales scope full/team) picks one. Lists validated against the **active** lookups (source, industry, sub-industry belongs to industry; `422`), mobile valid for the company country, email format, ≥1 named contact. `service_ids` / `recommended_service_id` must be **active** catalog service ids (`422`); never free text. `next_follow_up_date` must be `yyyy-MM-dd` (`422`); none → the company's tomorrow. `409` on duplicate (within the company only); `force` only for managers (else `403`). `note` becomes a Note. |
| GET | `/leads/duplicates` | `?company_name=&email=&emails=a,b&website=&exclude_id=` | `DuplicateMatch[]` `{lead_id, company_name, owner_name, status_id, reason}` (reason `company`/`domain`/`email`) | Checks **all** leads, not just the caller's scope. Company names normalized (drop LLC, FZE…). Domain from website/email; free-mail domains (gmail, outlook, hotmail, yahoo, icloud, live…) ignored. |
| GET | `/leads/owners` | | `LeadOwnerOption[]` `{id,name,title,role,open_leads}` | Needs sales create. Full: everyone who sells; team: the team; own: only the caller. Deactivated users are never listed, auto-assigned or accepted as owner (`422`). |
| GET | `/leads/:id` | | `LeadDetail` (row + `website`, `contacts[] {id, lead_id, name, title, mobile, email, is_decision_maker}`) | `404` / `403` outside scope. |
| PATCH | `/leads/:id` | Partial lead in snake_case (`company_name, email, phone, industry_id, sub_industry_id, source_id, source_detail, owner_id, estimated_value, next_follow_up_date, next_step, company_services, service_ids, recommended_service_id`) + `contacts[]` (replaces all), `website`, `do_not_contact`, `force` | `LeadRow` | Changed source/industry/sub-industry must be active lookup items (`422`). `serviceIds` (replaces the list) and `recommendedServiceId`: ids not already on the lead must be **active** catalog services (`422`); unchanged, since-deactivated ids are accepted. `next_follow_up_date` must be `yyyy-MM-dd` (`422`). Setting a non-null `recommended_service_id` clears `recommended_service_text` (the legacy unmatched text); omitting it or sending `null` leaves the text alone. Owner change: own scope `403`, team only within team. Duplicate rule re-runs when name/website/emails change (`409` / `force`). First contact becomes primary. |
| PATCH | `/leads/:id/stage` | `{ status_id, loss_reason_id?, next_step?, next_follow_up_date? }` | `LeadRow` | `status_id` must be an active status (`422`). What the move needs comes from the status's flags: `requires_loss_reason` → `loss_reason_id` = an active loss-reason key, optionally followed by ` — details`; `requires_next_step` → `next_step` + `next_follow_up_date` (`yyyy-MM-dd`; a datetime is `422`); a status of type `won` is refused with `409 { code: 'use_won_flow', message: "Use the Won flow…" }`: only `POST /leads/:id/won` wins a lead (see **The Won flow**). Sets `stage_changed_at`. Non-open types (won/lost/cold/parked) clear `next_follow_up_date`. **Automation:** moving to `No response` sets `next_follow_up_date` = the company's today + `noResponseFollowUpDays`; moving a closed lead back to an open status (Reopen → `New`) clears the loss reason and sets a follow-up for the company's tomorrow when none is given. |
| PATCH | `/leads/:id/do-not-contact` | `{ value }` | `LeadRow` (snake_case) | |
| GET | `/leads/:id/activities` | | `ActivityView[]` `{id, lead_id, type, summary, user_id, user_name, occurred_at}` | Newest first. |
| POST | `/leads/:id/activities` | `{ type, summary }` | `ActivityView` (+ optional `auto_status {from_status_id, to_status_id, label, attempts}`) | `422` for call/email/WhatsApp when Do Not Contact. First outreach moves `New` → `Contacted`. **Automation** (outreach = call/email/WhatsApp): on a lead in `No response`, attempts are counted since it entered that status (activities after `stageChangedAt`); when attempts ≥ `attemptsBeforeCold` the lead moves to the first active `cold` status (`Cold`; `stage_changed_at` = now, `next_follow_up_date` = null) and the response carries `auto_status`; otherwise the next follow-up is pushed to the company's today + `noResponseFollowUpDays`. |
| GET | `/leads/:id/notes` | | `NoteView[]` `{id, lead_id, body, user_id, author_name, created_at}` | Newest first. |
| POST | `/leads/:id/notes` | `{ body }` | `NoteView` | |
| POST | `/leads/:id/messages` | `{ channel: 'email'\|'whatsapp', to, subject?, body, templateId? }` (final text, variables already filled) | `{ activity: ActivityView, autoStatus?, email? }`; `email: { from, subject, html }` for the email channel: `html` is the branded layout (company logo header, `renderEmailHtml`) | Needs sales edit (`403`); lead in scope (`404`/`403`). `422` for Do Not Contact (same wording as activities); `to` must be an email (email) or a mobile valid for the company country (WhatsApp); email needs a subject (≤150); body required (WhatsApp ≤1024, email ≤5000); any leftover `{{…}}` / `[unknown: …]` is rejected; `templateId` must exist and match the channel. Delivery is done by the backend (mocked here). Logs an `email`/`whatsapp` activity through the same path as `POST /activities`, so New→Contacted and No response→Cold still run. |
| GET | `/leads/:id/tasks` | | `TaskView[]` `{id, lead_id, title, owner_id, owner_name, due_date, status, priority}` | Soonest due first. |
| POST | `/leads/import/check` | `{ rows: ImportLeadRow[] }` (max 5000; snake_case lead columns + `row, contact_title, is_decision_maker, notes`; `next_follow_up_date` `yyyy-MM-dd`) | `ImportCheckRow[]` `{row, errors[], warnings[], matches, file_duplicate_of}` | Rows carry lookup keys (the wizard maps the file's free text onto the active items). Errors: missing company, source/industry/status not an active list item. Warnings: value cleared or defaulted. Rows also carry `recommended_service_id` (catalog match of the file's "Recommended service"/"Service" column, `''` = none) and `recommended_service_text` (the file's value when unmatched); the server re-matches the text with `matchServiceText`, accepts only **active** ids, and warns "kept as unmatched" otherwise. |
| POST | `/leads/import` | `{ rows, decisions: Record<row,'import'\|'skip'>, owner_rule: 'file'\|'auto' }` | `ImportResult` `{imported_rows, duplicate_rows, failures:[{row,company_name,reason}], skipped_rows, created_ids, skipped_for_limit, limit_reached}` | Plan limit (leads + contacts): valid rows are created while they fit, the rest are counted in `skipped_for_limit` with `limit_reached` (`LimitReachedDetails`, same shape as the 402 body). Re-checks rows in order (catches repeats inside the file). Duplicates skipped unless a manager chooses import. Agents own their imports. Missing follow-up → tomorrow; blank status → New; Lost/Not interested get "Imported from Excel (no reason recorded)". |

Register `/leads/duplicates`, `/leads/owners` and `/leads/import*` before `/leads/:id`.

## Follow-ups

No endpoints of its own: the page reads `GET /leads`, logs with `POST /leads/:id/activities`
and reschedules with `PATCH /leads/:id` (`next_follow_up_date`, `yyyy-MM-dd`). Overdue / today / upcoming
compare that date with the **company's** today (its timezone), never the browser's. Leads whose status type
isn't `open` (won, lost, cold, parked) have no follow-ups. No-contact / stalled badges come from `GET /alerts`.

## Sales targets

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §11 (`values` / `actuals` are opaque maps keyed by metric).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §11 (deep, e.g. `total_leads`, `open_pipeline_value`, `series[].won_value`).

| Method | Path | Returns |
|---|---|---|
| GET | `/dashboard/summary?period=30d\|quarter\|ytd\|12m` (default `12m`) | `DashboardSummary` (scoped like `/leads`). `series` buckets: daily for 30d, weekly for quarter, monthly for ytd/12m. `*Prev` = the equal-length window just before (YTD: same dates last year). Pipeline, follow-ups and targets are "as of now". Targets use the same numbers as `/targets`. Bad period → `422`. |

## Services

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §6 (`category_id`, `industry_ids`, `currency_code`, `is_active`, package `price`, template task `estimated_hours`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §1–2 (customers: `account_manager_id`, `address_line`, `city`, `customer_since`; contracts: `cycle_value`, `billing_period`).

Contract `status`: `draft | active | expired | cancelled | renewed`. Stored: `active` / `cancelled` (draft and renewed are
reserved); an active contract past its renewal date comes back `expired`. "Expiring" is not a status: rows carry
`renewalDue: boolean` (active and renewing within `renewalAlertDays`, Settings > Automation, default 30) and the UI shows it as Expiring.
Customer `status`: `active | paused | vip | churned`. `annualValue`: Monthly ×12, Annual/One-off as is.
`mrr`: Monthly value, Annual / 12, One-off 0, live contracts only.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/customers` | | `CustomerRow[]` (+ account_manager_name, contacts_count, active_contract_value, active_contracts, next_renewal, days_to_renewal, last_activity_at) | Newest first. |
| GET | `/customers/:id` | | `CustomerDetail` (+ `lead` summary, `contacts`, `contracts`, last 10 `recent_activities`, `notes`, `lifetime_value`) | lifetimeValue = billed to date, or won value without contracts. |
| PATCH | `/customers/:id` | `{status?, website?, address_line?, city?, account_manager_id?}` | `CustomerRow` | Status `active`/`paused`/`vip`/`churned` (else `422`); website valid URL (https:// added); emirate valid; address ≤200; reassign rules as leads. |
| GET | `/contacts` | | `ContactRow[]` snake_case `{id, lead_id, name, title, mobile, email, is_decision_maker, company_name, record_type (Lead/Customer), record_id, owner_name}` | Contacts on leads and customers in scope. |
| POST | `/contacts` | `{record_type, record_id, name, title, mobile, email, is_decision_maker}` | `ContactRow` | Name required; mobile valid for the company country; email format; mobile or email required; `409` if the email exists at that company. |
| PATCH | `/contacts/:id` | partial of the above | `ContactRow` | Same checks; editing a lead's first contact updates the lead's contact fields. |
| GET | `/contracts` | | `ContractRow[]` (+ renewal_due, customer_name, owner_name, service_names, days_to_renewal, annual_value, mrr) | Soonest renewal first. |
| POST | `/contracts` | `{customer_id, title, service_ids, cycle_value, billing_period, start_date, renewal_date, owner_id?}` | `ContractRow` | Title required; ≥1 catalog service (new picks must be **active**; services already on the contract stay valid); value >0; renewal after start; owner defaults to the customer's. |
| PATCH | `/contracts/:id` | partial + `status: active\|cancelled` | `ContractRow` | Same checks; `expired` (and the derived Expiring) can't be set by hand (`422`). |

## Quotations

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §3 (`lead_id`, `valid_until`, `tax_percent`, `currency_code`, items `unit_price`, `discount_percent`; query `?lead_id=`).

Totals are always computed by the server: `subtotal = Σ qty × price`, `discount = Σ line discounts`,
`vat = (subtotal − discount) × vatPct`, `total = subtotal − discount + vat`. VAT defaults to 5%.
Status: `draft | sent | viewed | accepted | rejected | expired`. A `sent` / `viewed` quotation whose `validUntil` is before the
company's today (its timezone, server clock) is **stored** as `expired`: lazily on every quotation read and on the per-request
lifecycle tick; accepted / rejected / draft never expire. `viewedAt` is set when the client first opens it (`POST /quotations/:id/viewed`).

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/quotations` | `?leadId=` optional | `Quotation[]` | Scoped by the lead's owner. Newest first. |
| GET | `/quotations/:id` | | `Quotation` | `404` / `403`. |
| POST | `/quotations` | `QuotationInput {leadId, title, validUntil, items[], notes, terms, vatPct?}` | `Quotation` | Needs create + lead in scope. Company/contact copied from the lead. Number `QT-<year>-NNNN`. Starts Draft. |
| PATCH | `/quotations/:id` | `QuotationUpdateInput` (partial, no leadId) | `Quotation` | Only Draft (`409`). |
| POST | `/quotations/:id/send` | | `Quotation` | Draft→Sent, sets `sentAt`. `422` if lead is Do Not Contact, has no email, or draft invalid. Moves a lead before Proposal to `Proposal`. Logs an `email` activity on the lead. |
| POST | `/quotations/:id/status` | `{ status: 'accepted' \| 'rejected' }` | `Quotation` | Only from `sent` / `viewed`; sets `decidedAt`; `409` otherwise or if expired (an expired one can't be accepted); other values `422`. |
| POST | `/quotations/:id/viewed` | | `Quotation` | The client opened the shared document (the editor's **Open as customer**; a real backend would serve a signed public link). `sent` → `viewed` once, sets `viewedAt`; a draft is `409`; other statuses are returned unchanged. |
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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §11 (deep; schedules `report_type`, `run_at`; query `owner_id`, `department_id`).

Scoped to the narrower of the caller's `reports` and `sales` scopes.

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/reports/sales` | `?from=yyyy-MM-dd&to=yyyy-MM-dd[&ownerId=]` | `SalesReport` (query, scope, owners, generatedAt, kpis, byStatus, funnel, byIndustry, bySource, funnelMonthly, agents, targets, overdueFollowUps, overdueTasks) | `403` without sales/reports access or `ownerId` out of scope; `400` bad range (from > to, or > 3 years). Status/industry/source/funnel use leads created in the period; won/closed/conversion use the close date. Rows are keyed by lookup key and carry the current `label`; they follow the lists' configured order (active items, plus inactive ones that still have records). "Closed" = status kind `won`/`lost` (parked Cold leads are neither). The funnel walks the built-in path New → Contacted → Interested → Meeting → Proposal → Won (inactive steps skipped). Target `overall` averages only kinds with a target > 0. |
| POST | `/reports/custom` | `{dimension: status\|industry\|source\|owner\|month, measure: count\|value\|wonValue\|conversion, from, to, ownerId?}` | `CustomReport {input, rows:[{key,label,value,leads}], total}` | `422` on bad dimension/measure. |
| GET | `/reports/schedules` | | `ReportSchedule[]` (with computed `nextRunAt`) | Full scope sees all; others their own. |
| POST | `/reports/schedules` | `{report: ReportId\|'all', frequency: weekly\|monthly, day, time 'HH:mm', recipients: string[1..10], format: excel\|pdf}` | `ReportSchedule` | `422` on validation; recipients lowercased and de-duplicated. The backend sends the e-mails. |
| DELETE | `/reports/schedules/:id` | | `{ id }` | `404`; `403` unless creator or full scope. |

### Company performance

`GET /reports/performance?from=&to=` (company-local `yyyy-MM-dd`; default this year up to the company's today; `422` bad
range). Services `services/reportsPerformance.ts`, formulas `modules/reports/performance/calc.ts`. Reports is in every
plan; `reports` hidden (Employee) → `403`. One payload; a section the caller can't see is `null` (hidden, never zeroed):

| Section | Who | Content |
|---|---|---|
| `financial` | `accounting` full / view + plan `accounting` (Company Admin, Management, Accountant, Sales Manager) | revenue (period, vs the same dates last year), revenue MTD / YTD vs last year (as of min(to, today), fiscal year start from Finance settings), cost of sales, gross margin %, net profit (period, YTD), cash and bank (cash accounts of the Finance overview), receivables open / overdue / overdue %, DSO, payables open / overdue / due this week, payroll cost and % of revenue, events revenue / cost / ROI, 12 months of revenue, expenses and month-end cash. Revenue / costs come from the Financial statements reader `profitAndLoss` (closing entries excluded; revenue = operating + other income). |
| `sales` | `sales` not hidden | the caller's visible leads (no synthetic baseline): pipeline value, open leads, won / lost closed in the period, win rate = won ÷ (won + lost), leads created this / last month (company timezone), open leads by stage |
| `delivery` | `tasks` not hidden | active projects, open / overdue tasks, completion % of tasks due in the period, created vs completed by month (the caller's task scope) |
| `people` | `hr` full / team + plan `hr` | headcount, joiners, leavers, turnover %, open positions (HR overview; never pay) |
| `departments` | `reports` ≠ own | scorecard: full / finance / hr → every active department; team / marketing → departments they head (+ sub-departments; else their own). headcount (active users), overdue tasks (of the caller's visible tasks); revenue / cost / margin only with `financial` (`financial_columns`); budget variance (expense actual − approved budget for the period's months, + = over) when an approved budget covers the period (`budget_column`) |
| `alerts` | per section | cash below the threshold (Profitability settings; default 3 months' average expenses), overdue receivables above X % (default 30), departments over budget, projects with a negative margin (financial only); overdue tasks (delivery) |

### Reports hub

The library of every report (catalog `modules/reports/hub/catalog.ts`, shared by API and page), filtered per role and
plan exactly like the screens' guards. Favourites and recently viewed are stored per company + user
(`reports.hubPrefs`). `reports` hidden → `403`. A report id outside the catalog or not open to the caller → `404`
(same body). The phase-1 sales report items are the ready-made Sales reports (linked, not duplicated); schedulable
entries carry `schedule` (a Sales report id) for the existing `POST /reports/schedules`.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/reports/hub` | | `{reports:[{id, area, title, description, path, schedule, favourite, last_viewed_at}], favourites:[id], recent:[{report_id, at}] (≤ 8), can_schedule}` |
| PUT | `/reports/hub/favourites/:reportId` | | the hub (idempotent) |
| DELETE | `/reports/hub/favourites/:reportId` | | the hub |
| POST | `/reports/hub/recent` | `{report_id}` | the hub (moves it first) |

**Tests.** `src/shared/mocks/isolation/profitabilityEndpoints.ts` (`PERFORMANCE_ENDPOINTS`); roles × both companies,
plan gate, hidden-not-zeroed, recomputed revenue and pipeline, per-user favourites in
`src/app/isolation/performance.isolation.test.ts`; formulas and company-timezone periods in
`src/modules/reports/performance/calc.test.ts`; browser `e2e/company-performance.spec.ts`.

## Lookups & automation

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §11 for automation (`workflow_settings`: `first_contact_reminder_days`, `no_response_followup_days`, `max_attempts_before_cold`, `interested_stalled_days`, `reopen_lost_after_days`); lookups in DB-ALIGNMENT.md (Part A).

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/lookups` | | `{lead_statuses, lead_sources, industries (with sub_industries), loss_reasons, tags, service_categories}` | Any signed-in user. Every item has `id` (statuses: `code`; the stable key stored on records), `name`, `is_active`, `sort_order`. Statuses add `probability` (0–100), `type` (`open`/`won`/`lost`/`cold`/`parked`), `requires_next_step`, `requires_loss_reason`, `tone`, `color`, `is_system`. Plain items may add `is_system`, `hidden_from_pickers`. Pickers show active items only; display looks labels up by key. |
| PUT | `/lookups/:list` | `:list` = `lead_statuses` \| `lead_sources` \| `industries` \| `loss_reasons` \| `tags` \| `service_categories`; `{ items }` (the whole list in the GET shape; new items without `id` / `code`) | same as GET | Company Admin only (`403`). Unknown list (old camelCase names included) `404`. Items can be renamed, reordered and deactivated but not removed (`422`); built-in statuses keep their type; at least one active status of type `open`, `won` and `lost`; `type` must be one of the five, the flags booleans, not both flags, none on a `won` status; a status that leads sit in can't become `won` (`422`). **Protected items** (`is_system: true` on a plain list item, e.g. loss reason `imported-no-reason` "Imported - no reason recorded"): can't be removed, renamed or deactivated (`422`); always re-pinned last on reorder; `is_system`/`hidden_from_pickers` can't be changed by clients. Each list needs ≥1 active item that isn't `hiddenFromPickers`. Audited. |
| GET | `/settings/automation` | | `AutomationRules` | Any signed-in user. `{noContactReminderDays: 1, noResponseFollowUpDays: 2, attemptsBeforeCold: 3, stalledInterestedDays: 3, lostReopenDays: 90, renewalAlertDays: 30, taskReminderDaysBefore: 1}` by default. Read live by the lead journey (stage moves, activities, `reopenEligible`), CRM renewals and `/alerts`. |
| PUT | `/settings/automation` | `Partial<AutomationRules>` | `AutomationRules` | Company Admin only. Whole numbers within each rule's limits (`422`). Audited. |
| POST | `/settings/automation/reset` | | `AutomationRules` | Back to the defaults. Audited. |
| GET | `/audit-log` | `?entity=&userId=&action=&from=&to=` | `AuditEntry[]` `{id, at, userId, userName, action, entity, entityId, summary, changes[{field,from,to}]}` | Admins only (`403`). Newest first. |
| GET | `/alerts` | | `Alert[]` `{id, type, severity: info\|warning\|danger, title, body, leadId?, customerId?, link, at}` | Scoped like `/leads` (hidden scope → `[]`). Newest first. Types, using the automation rules: `no-contact` — New lead with no activity for ≥ `noContactReminderDays` (to the owner); `stalled` — Interested lead with no activity for ≥ `stalledInterestedDays` (to managers: sales scope team/full); `follow-up` — follow-up due today or overdue (owner), others' overdue ones (managers); `renewal` — contracts (not cancelled) renewing within `renewalAlertDays`; `task` — open tasks of any kind (lead, customer, project, personal) that I own, due within `taskReminderDaysBefore` days (owner reminder); `task-overdue` — open overdue tasks: my own, my direct reports', and with a team/full tasks scope every overdue task in scope. Task alerts follow the **tasks** scope (not sales) and the company's calendar (regional timezone, mock clock); see **Tasks › Reminders**. |

List items may carry `is_system?: boolean` (protected) and `hidden_from_pickers?: boolean` (never offered for
new values, but labels still resolve). `imported-no-reason` is accepted only by the Excel import
(`POST /leads/import`); stage moves and lead create/edit reject it ("Pick a loss reason from the list.").
Events-attended target cells count the agent's events attended (see **Events › Targets**) when the company's
plan includes the Events module; without it they return actual 0 / pct 0 and are left out of `overall`.

## My account

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/account` | | `{ user, departmentName, managerName, lastLoginAt, passwordChangedAt }` | Any signed-in user, own account. |
| POST | `/account/password` | `{ currentPassword, newPassword }` | `{ changedAt, signedOutSessions }` | `422` if current is missing/wrong (not `401`: 401 means "session expired"), new is shorter than `policy.passwordMinLength` or >128, lacks a letter or a digit, or equals the current one. Signs out the user's other sessions. Audited (action `security`, id `password`; the password is never logged). |

The client signs the user out after `policy.sessionTimeoutMinutes` of inactivity (warning 60 s before);
the backend should also expire idle tokens on its side.

## Settings: users

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §10 (`department_id`, `manager_id`, `is_active`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §10 (all mechanical, e.g. `enabled_at`, `last_active_at`, `session_timeout_minutes`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §11 (`type` = channel, `is_active`; query `type`, `purpose`, `is_active`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §12 (deep, e.g. `legal_name`, `address.line1`, `bank.bank_name`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §12 (`brand_color`, `logo_url`, `display_name`, PATCH `logo_light`; `palette` opaque).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §13b (deep: `signup_id`, `company_name`, `admin_email`, `checkout_id`, `card_number`); the completion session is not mapped.

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §10 / 12 (roles `is_system`, `permissions` opaque; email connection `connected_at`).

| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| GET | `/settings/roles` | Company Admin, Management | | `CompanyRoleDefinition[]` (`{ id, name, system, permissions: Record<ModuleKey, Scope> }`; 9 roles, read-only) |
| GET | `/settings/email-connection` | Company Admin (plan module `integrations`, else `403 module_not_in_plan`) | | `EmailConnection \| null` |
| POST | `/settings/email-connection` | Company Admin | `{ provider: 'google' \| 'microsoft' \| 'smtp', address }` | `EmailConnection { provider, address, connectedAt, connectedBy }` (mocked; `422` bad provider/address; audited) |
| DELETE | `/settings/email-connection` | Company Admin | | `null` |

Seeds: Apex Aora `enterprise` (active); Crest Logistics `business` (active). Plans, usage, invoices and the lifecycle:
see the next section.

## Plans, limits and subscription lifecycle

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §13a (deep: `plan_id`, `current_period_end`, `payment_method`; `limits` opaque). `/dev/billing/*` stays camelCase.

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
| GET | `/hr/employees`, `/finance/invoices`, `/integrations` | signed in | | `[]` (stubs so module gating is real) | `403 module_not_in_plan` |
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

**Wire format:** not converted yet (camelCase); see docs/DB-ALIGNMENT.md "Not converted".

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §12 (mechanical).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §9 (`head_user_id`, `cost_center_code`, `is_active`; query `include_inactive`).

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

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §4 (body `quotation_id, service_ids, project_manager_id, start_date, idempotency_key`).

One atomic server action converts a won deal. Every trigger in the UI goes through one rule,
`moveActionFor(status) === 'won'` (status `type` `won`, `modules/leads/lib/transitions.ts`),
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
2. **lead**: status → the Won status (lookup key `Won`), `stageChangedAt` = now, **`wonAt` = now** (leads.won_at),
   follow-up cleared, and a **`lead_status_history` row** `{ leadId, fromStatusId, toStatusId, changedBy, reason, changedAt }`
   (`shared/mocks/data/leadStatusHistory.ts`, `recordLeadStatusChange`).
3. **customer**: links the customer with this `leadId` (or the same company name), else creates one from the
   lead (company, industry, website, emirate, value, services); the lead gets `customerId`. **The lead's contacts
   get `customerId`** (contacts.customer_id) and keep `leadId`: nothing is copied or retyped. Notes and the
   activity history stay on the lead id that the customer references. Purchased services are added. **The
   accepted quotation gets `customerId` and `acceptedAt`** (its decision time, else now).
4. **contract**: only from an Accepted quotation of this lead, when it has recurring lines (unit `month`): billing Monthly, value = monthly net,
   renewal = start + the longest monthly term on the quote; carries `quotationId` and `createdBy` (contracts.quotation_id / created_by).
5. **projects**: one per purchased service, status `planned`, with `leadId`, `quotationId`, `contractId` and
   `projectTemplateId` (the service's template, null without one). Tasks (`status: todo`, `link: null`,
   `projectId`, `sortOrder` = template order, `priority` `high` for the first and last task, else `medium`) come from the service's project template:
   due date = start + template day offset + task length (hours ÷ 8, at least 1 day) − 1, in the company's **working
   days** (from its region's weekend: Mon–Fri for the UAE, Sun–Thu for Saudi Arabia); owner = an active person whose job title matches the template role in the project manager's
   department, then in the Delivery department (fewest assigned first), otherwise the project manager.
   A service without a template gets a project with no tasks (preview warns). A template task **without a
   role** stays unassigned-role (`role: null` in the preview) and goes to the project manager (Design gap:
   `project_template_tasks.default_role_id`, docs/DB-ALIGNMENT.md).
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
before the app loads, like `__apexMoveFailureRate`. The hooks are read only when
`import.meta.env.DEV || import.meta.env.MODE === 'test'`, so a production build contains none of them
(`npm run build` → no `__apex` in `dist/`). The real backend has no failpoints.

**Rollback** also covers contacts (`customerId`), the quotation (`customerId`, `acceptedAt`) and the
`lead_status_history` row.

**After success** the client invalidates leads (+ alerts), CRM (customers, contacts, contracts), quotations,
projects, tasks, alerts / notifications, dashboard, reports, audit, services, departments and targets
(`WON_INVALIDATES`), shows a toast and navigates to `redirectTo` (the first project, else the customer).

## Tasks

Field names follow the database design (tasks, task_followers, comments, attachments, time_entries) and are in
snake_case on the wire (DB-ALIGNMENT.md (API mappers) §7: `owner_id`, `due_date`, `follower_ids`, attachments `original_name`, comments `user_id`; query `include_done`, `related_type`…); the full mapping and the migration are in `docs/DB-ALIGNMENT.md`.

Tasks scope (`tasks` column of the permission matrix): **Own** for Sales Agent, Employee, Accountant and HR
Manager; **Team** (real department membership, `teamIdsFor`) for Sales Manager, Department Head and
Marketing Manager; **Full** for Company Admin and Management. Everyone also sees tasks they follow or created
and the tasks of projects they manage. **A sub-task has its parent's scope**: whoever sees (or may change) the
parent sees (or may change) its sub-tasks.

**Enums (values on the wire; the screens show the labels):**

| Field | Values | Labels |
|---|---|---|
| `status` (tasks.status) | `todo`, `in_progress`, `review`, `done`, `cancelled` | To do, In progress, Review, Done, Cancelled |
| `priority` (tasks.priority) | `low`, `medium`, `high`, `urgent` | Low, Medium, High, Urgent |

They live in `src/modules/tasks/enums.ts` (value tuple + type + labels + tones), shared by the screens, the mock
and these docs. Done and cancelled are **closed**: not open, never overdue, no reminders. The old values
(`To do`, `In progress`, `Blocked`, `Done`; `Low`…`Urgent`) answer `422`.

**One related link plus the project.** `link {type, id}` is the design's `related_type` + `related_id`: one
optional **lead, customer or event** (`type: 'project'` → `422`). The project is its own column, `projectId`
(tasks.project_id), shown as a separate chip (`projectName`). Event links need the Events module in the plan and an
existing event of the company (`422` otherwise, like a missing lead); the chip opens the event (`/events/:id`).

**Blocked is a flag, not a status** (`blockedAt`, `blockedReason`; Design gap, see DB-ALIGNMENT.md (Part B)). A blocked task
keeps its status (e.g. `in_progress`) and can still move between columns; the board, list, drawer, My tasks
and calendar show a "Blocked" badge. Set it with `POST /tasks/:id/block`, clear it with `POST /tasks/:id/unblock`.
Moving a task to `done` or `cancelled` clears the flag (history "Unblocked (done)").

**Sub-tasks** (`parentTaskId`, tasks.parent_task_id): one level only (a sub-task can't have sub-tasks: `422`).
Created with `POST /tasks { parentTaskId }` by someone who may change the parent; the parent must be open. A
sub-task always has its parent's project and company (a different `projectId` → `422`; `PATCH` of a sub-task's
`projectId` → `422`; changing the parent's project moves its sub-tasks). The parent's `TaskView` lists
`subtasks[]` and `subtaskProgress { done, total }` (cancelled sub-tasks don't count). Moving a parent to `done`
while sub-tasks are open → `409` unless `force: true`; cancelling a parent cancels its open sub-tasks; a
sub-task of a closed parent can't be reopened (`422`). Deleting: there is no task delete endpoint yet; when one
comes (soft delete, tasks.deleted_at) it deletes the parent's sub-tasks with it.

**`completedAt`** is set when the status becomes `done` and cleared on reopen (any other status, also `cancelled`).

**Dates are the company's.** "Today", `overdue`, "due this week" and the reminders use the company's
regional settings: the calendar date in its `timezone` and weeks starting on its `weekStartsOn` (0 Sun, 1 Mon,
6 Sat), never the server's or the browser's clock zone. Example: at 22:30 UTC on 18 Nov a task due 18 Nov is
already overdue for a Riyadh or Dubai company (it is the 19th there) but due today for a UTC company. The mock
reads time from `clock.ts` (`now()`, moved by the dev clock), so simulated days apply to tasks too. The task
screens use the same helper (`shared/lib/companyDay.ts`) with the tenant's regional settings: My tasks groups
(Overdue / Today / This week / Later / No date), the calendar's today and week start, due labels.

**`Task`** = `{ id, title, description, ownerId, followerIds, priority, dueDate, status, link, projectId,
parentTaskId, estimatedHours, templateTaskId, dayOffset, sortOrder, blockedAt, blockedReason, reminderSentAt,
overdueNotifiedAt, attachments[], comments[], history[], createdBy, createdAt, updatedAt, completedAt }`.

**`TaskView`** = `Task` + `ownerName`, `followerNames`, `projectName`, `overdue` (company calendar), `blocked`,
`linkView {type, id, label, available}`, `loggedHours` (sum of its time entries), `timeEntries: TimeEntryView[]`,
`parentTitle`, `subtasks: { id, title, status, ownerId, ownerName, dueDate, blocked }[]`, `subtaskProgress` and **`canEdit`**:
- `canEdit`: may the caller change this task (the same rule PATCH, block / unblock and time entries enforce): the
  tasks `edit` right (a `view` scope is read-only) and owner, creator, follower, the project's manager, team scope
  over the owner, full scope, or (for a sub-task) the same over its parent. The board, calendar, status menus,
  list and drawer use it per task; the UI also blocks every change while the workspace is read-only (suspended /
  cancelled / read-only support session) with that reason.
- `linkView.available`: false when the target doesn't exist in the company, is an event while the plan has no
  Events module, **or the caller couldn't open it**: a lead or customer outside their Sales & CRM scope, an event
  they can't see (Events permissions). The label of an event link is the event's name. The chip
  still shows the label (non-clickable, with the reason as a tooltip).

**`TaskAttachment`** = `{ id, name, sizeBytes, mimeType, uploadedBy, uploadedAt }` (attachments.original_name,
size_bytes, mime_type). **`TimeEntry`** = `{ id, projectId, taskId, userId, entryDate, hours, description,
isBillable, createdAt }` (time_entries); `TimeEntryView` adds `userName`.

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/tasks/assignable` | | `{ id, name, title, role, departmentId }[]` (caller first, then by name) | The active users of the caller's company that POST / PATCH accept as `ownerId`: own scope → only the caller; team scope → `teamIdsFor` (direct reports, members of the departments they head and of those departments' sub-departments); full → everyone active. A role without create/edit gets only themselves; hidden → `403`. Owner pickers (quick add, drawer) use it. Never another company's users. |
| GET | `/tasks` | `?mine, ownerId, projectId, linkType, linkId, status, priority, blocked, dueFrom, dueTo, includeDone` | `TaskView[]` | Scoped as above (`403` if hidden). Done and cancelled only with `includeDone` or `status=done` / `status=cancelled`; `blocked=true|false` filters on the flag; `dueFrom/dueTo` drop undated tasks. Sorted by due date (undated last), then priority (urgent first), then newest. Runs the company's reminder tick first. |
| GET | `/tasks/:id` | | `TaskView` | `404` if missing or not visible. Runs the reminder tick. |
| POST | `/tasks` | `TaskInput { title, description?, ownerId?, followerIds?, priority?, dueDate?, status?, link?, projectId?, parentTaskId?, estimatedHours? }` | `TaskView` | Title 1–160; owner defaults to the caller and must be active; own scope may assign only to themselves, team scope only within the team (`403`); followers active; link target must exist (lead / customer / event only); priority and status from the enums (default `medium`, `todo`); due yyyy-MM-dd or null; sub-task rules above. History "created"; `assignment` notification when someone else is the owner. |
| PATCH | `/tasks/:id` | `TaskUpdateInput` (any `TaskInput` field except `parentTaskId`, plus `force?`) | `TaskView` | Editors = `canEdit` (`403`, the message says whether the role can't edit tasks or the task isn't theirs). One history event per changed field ("Status: To do → In progress", labels); `completedAt` set/cleared with done; a new due date clears `reminderSentAt` / `overdueNotifiedAt` (re-armed); new owner notified. Board and calendar moves are this PATCH (`status` / `dueDate`); the UI updates every cached list at once and restores it when the server refuses. Test hook (mock only, dev/test builds): `window.__apexMoveFailureRate = 1` makes status / due-date changes fail with `503` (default: never). `loggedHours` is no longer writable: log time entries. |
| POST | `/tasks/:id/block` | `{ reason }` | `TaskView` | Editors. `reason` 3–280 characters (trimmed), required → `422` without it. Sets `blockedAt` = now and `blockedReason`, posts the reason as a comment "Blocked: …" and a history line; the status doesn't change. Closed task → `422`; already blocked → `409`. |
| POST | `/tasks/:id/unblock` | | `TaskView` | Editors. Clears `blockedAt` and `blockedReason`, posts an "Unblocked" comment and history line. Not blocked → `409`. |
| POST | `/tasks/:id/comments` | `{ body, mentions? }` | `TaskView` | Anyone who can see the task. Body 1–2000. `@Full Name` (or a unique `@First`) and explicit `mentions` ids → `mention` notifications (not the author). |
| POST | `/tasks/:id/attachments` | `{ name, sizeBytes, mimeType? }` | `TaskView` | Editors. Mocked upload: metadata only, ≤ 25 MB (`422`); `mimeType` defaults to `application/octet-stream`; the old `{ size, type }` body → `422`. Counts toward the plan's `storageMb` limit (sum of `sizeBytes`): over it → `402` (see **Limits**). The backend stores the file. |
| DELETE | `/tasks/:id/attachments/:attachmentId` | | `TaskView` | Editors; `404` if gone. |
| POST | `/tasks/:id/time-entries` | `{ entryDate (yyyy-MM-dd), hours, description?, isBillable? }` | `TaskView` | Editors log their own hours on the task (and its project: `projectId` = the task's). `hours` > 0, ≤ 24, two decimals; `description` ≤ 255; `isBillable` defaults to true for a project task, else false. History "Logged 2 h on 2026-11-18". |
| DELETE | `/tasks/:id/time-entries/:entryId` | | `TaskView` | Editors; only the person who logged the entry or a full-scope user (`403`); `404` if gone. |

**Reminders — stored, once only (Settings › Automation):** the company's **reminder tick**
(`services/taskReminders.ts`, run lazily per company on `GET /alerts`, `GET /tasks` and `GET /tasks/:id`, like
billing's `runLifecycle`; a real backend runs it from the scheduler) stores:
- a `task-due` notification to the **owner** when today (company calendar) is within `taskReminderDaysBefore`
  days of the due date (due − N ≤ today ≤ due), and sets `reminderSentAt`;
- a `task-overdue` notification to the **owner's manager** (users.manager_id, active, same company) from the
  first day after the due date ("Owner · N days overdue · subject"), and sets `overdueNotifiedAt` (also when the
  owner has no manager, so it isn't checked again).

Each is sent **once per task**; changing the due date re-arms both. Done and cancelled tasks get neither. The
notifications carry `taskId` and show in the bell as `task` / `task-overdue` alerts with `stored: true` (mark
read like any notification). The owner's own overdue tasks (and every overdue task in a team/full scope) still
show as a computed `task-overdue` alert that clears when the task is done or rescheduled; a task the viewer
already got a stored notice for is not listed twice.

## Projects

**Wire format:** snake_case design columns; field table in docs/DB-ALIGNMENT.md §8 (mechanical projects columns; detail `tasks`, `audit`).

Projects follow the **tasks** column of the permission matrix (role tests: `permissions.isolation.test.ts`
checks list, detail, create, patch, manager change and status for all nine roles in both companies).
A role whose tasks scope is hidden gets `403` for every project request (any id, also another company's, so a
foreign id still answers like a missing one); otherwise another company's project is `404` and a project of
the company outside the caller's scope is `403`.

**`status`** (projects.status): `planned`, `active`, `on_hold`, `completed`, `cancelled` (labels Planned, Active,
On hold, Completed, Cancelled; `PROJECT_STATUSES` in `modules/tasks/enums.ts`). **`Project`** adds the design's
`contractId` and `projectTemplateId` (set by the Won flow / template generation, else null).

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/projects` | | `ProjectRow[]` (customer/service/manager names, task counts, overdue, `progress` %, `loggedHours` = projects.actual_hours, the sum of its time entries) | Same tasks scope: full / view = all; team = projects managed by the team or with team-owned tasks or tasks I follow; own = projects you manage or have (or follow) tasks in. Newest first. |
| GET | `/projects/:id` | | `ProjectDetail` = row + `tasks: TaskView[]` (every task of the project, each with the caller's `canEdit` and its `timeEntries`) + `audit: AuditEntry[]` + `canManage` | `404` / `403` as above. The Hours tab lists the time entries of every task. |
| POST | `/projects` | `ProjectInput & { generateTasks?: boolean }` (default true) | `ProjectRow` | Full or team scope (`403` otherwise). Name 1–160; customer exists; service exists and is active; manager active; start ≤ end; status from the enum; hours ≥ 0. `generateTasks` builds tasks from the service template exactly like the Won flow (and sets `projectTemplateId`). Audited; manager and task owners notified. |
| PATCH | `/projects/:id` | `ProjectUpdateInput & { force?: boolean }` | `ProjectRow` | `canManage`: the tasks `edit` right (a view scope is read-only, even for the manager), then full scope, the project manager, or a team-scope user over the manager (`403`). A manager of another company → `422`. `completed` while tasks are open (not done or cancelled) → `409` unless `force: true`. Audited with field changes (status as labels); a new manager is notified. |

Progress = done share of the project's tasks (cancelled ones left out), weighted by estimated hours when present.
The project timeline plots working days from the company's weekend (e.g. "Working days (Sun–Thu)" for a
Friday–Saturday weekend) with week ticks on its `weekStartsOn`.

## Changes to earlier endpoints (tasks & Won)

- **`GET /alerts`** adds types `task` (owner reminder, stored once: `task-due`), `task-overdue` (stored notice to
  the manager, computed for the owner and team/full scopes), and the stored notifications `won`, `assignment`,
  `mention` (with `stored: true`, `read` and, for task notifications, `taskId`). New: **`PATCH /alerts/:id/read`** (stored
  notifications only; computed ids → `422`, others' → `404`) and **`POST /alerts/read-all`** → `{ updated }`.
  Task alerts need a tasks scope (not a sales scope).
- **`GET /dashboard/summary`** adds `tasks { myOpenTasks, myOverdueTasks, dueThisWeek, teamOverdueTasks, scope,
  next[] }` from the same task selectors as the tasks API (`next[]` items carry `priority`, `status` and `blocked`).
- **`GET /reports/sales`** `overdueTasks[]` now covers every task kind: `{ taskId, title, linkType, linkId,
  linkLabel, linkAvailable, projectId, projectName, ownerId, ownerName, dueDate, daysOverdue, priority, status }`,
  narrowed by the report scope, department and owner filters. `linkType` is the related link (lead, customer,
  event), else `project` for a project task.
- **Departments** `tasks` in `GET /departments/:id` now come from the unified task store (lead, project and
  personal tasks) with `projectId` and `linkLabel`.
- **Activities** gain type `system` (written by the app, e.g. the Won flow; never offered in pickers).

---

Next modules (HR, Events, Marketing, Accounting…) add their sections here as they're built.

## Events

Phase 2, optional: plan module `events` (Business and Enterprise; not Starter or Trial; platform module
overrides apply). Exhibitions, conferences, meetings and webinars the company attends or organizes; everyone
registered becomes a lead with the source **Event**, and leads / won deals are counted per event. Tables:
`events`, `event_team`, `event_attendees` (DB design §13; gaps in `docs/DB-ALIGNMENT.md` › Design gaps › Events).
Wire format: snake_case columns (`src/shared/api/eventMappers.ts`); handlers `src/shared/mocks/handlers/events.ts`,
service `src/shared/mocks/services/events.ts`, access rules `src/shared/mocks/selectors/events.ts`.

### Plan gating

Every `/events/*` path goes through the request policy (`userFrom` → `enforceRequestPolicy`): a company whose plan
(± platform override) lacks `events` gets `403 module_not_in_plan` (`{ module: 'events', planId }`). The client
routes (`/events`, `/events/calendar`, `/events/:id`) are wrapped in `ModuleGate module="events"` (upgrade page) and
the nav items carry `planModule: 'events'`. The old `GET /events` billing stub is replaced by the real handler.

### Permissions (decision)

`PERMISSION_MATRIX` has no Events column. **Events follow the Marketing column, plus event-team membership:**

| Marketing scope (roles today) | Sees | Edits (event, attendees, check-in, tasks) | Creates | Cancels / changes the team |
|---|---|---|---|---|
| `full` (Company Admin, Management, Marketing Manager) | every event | every event | yes | yes |
| `view` (Sales Manager) | every event | only events they're on | no | only events they own |
| `team` / `own` (not used today) | events they're on (+ `team`: owned by their team) | the same | yes | only events they own |
| `hidden` (Sales Agent, Accountant, HR Manager, Department Head, Employee) | only events they're on | events they're on | no | only events they own |

"On an event" = its owner (`owner_id`, always on the team) or an `event_team` member, **whatever their role**: a
Sales Agent staffing a stand can register and check in attendees. Another company's event answers `404` (same body
as a missing id); an event of the own company outside the caller's reach answers `403`. The public registration
token (`registration_token`) is served only to people who can edit the event. Tested table-driven from the matrix
in `src/app/isolation/events.isolation.test.ts` (every role × both companies, with and without team membership).

### Models

`EventRow` (list and detail): `id, name, type (exhibition | conference | meeting | webinar | other), status
(planned | confirmed | completed | cancelled), is_organizer, starts_at, ends_at` (UTC instants) `, start_date,
end_date, start_time, end_time` (the same in the company's timezone; times null = all day) `, location, online_url,
budget, actual_cost, currency` (the company's) `, description, owner_id, owner_name, team[] {user_id, name, title,
is_owner}, registration_open, registration_token` (editors only, else null) `, attendee_count, checked_in_count,
leads_created, created_by, created_by_name, created_at, updated_at, can_edit, can_manage`. `EventDetail` adds
`history[] {id, at, user_id, user_name, summary}` (created, field changes "Budget: 12000 → 15000", team changes,
registrations, check-ins, imports).

`Attendee`: `id, event_id, name, company_name, email, mobile` (normalized for the company's country) `, title,
lead_id, lead_outcome (created | linked | none), lead_company, lead_status, can_open_lead` (the lead fields only when
the caller's Sales scope reaches the lead) `, source (manual | import | public), source_detail, registered_at,
checked_in_at`.

`EventStats`: `attendees, checked_in, leads_created, leads_linked, leads` (distinct leads from the event) `,
deals_won, won_value` (won leads among them and the sum of their `estimated_value`) `, pipeline_value` (still open) `,
budget, actual_cost, cost_per_lead` (= budget ÷ new leads, 2 decimals; null without a budget or new leads) `, currency`.

### Endpoints

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events?from=&to=` | anyone (rows filtered by access) | | `EventRow[]`, newest first; `from` / `to` (company dates) keep events overlapping the range | `422` bad date, `403 module_not_in_plan` |
| POST | `/events` | marketing create right | `{ name, type, status?, is_organizer?, start_date, start_time?, end_date?, end_time?, location?, online_url?, budget?, description?, owner_id?, team_ids?, registration_open? }` | `EventDetail` (owner defaults to the caller; owner + `team_ids` form the team; a registration token is generated) | `403`, `422` (name 2–255, type, real dates, end ≥ start, HH:mm, end time needs a start time, https link, amounts ≥ 0, owner / team = active users of the company, can't start cancelled) |
| GET | `/events/:id` | sees it | | `EventDetail` | `404`, `403` |
| PATCH | `/events/:id` | edits it | any create field except `team_ids`, plus `actual_cost` | `EventDetail` | `403`; owner change and cancel / reopen via `status` need *manage*; `422` as create. Cancelling closes registration. |
| DELETE | `/events/:id` | manages it | | `EventDetail` with `status: cancelled` (soft delete: attendees and leads kept) | `403`, `409 event_completed` (a completed event happened: it can’t be cancelled) |
| POST | `/events/:id/team` | manages it | `{ user_id }` | `EventDetail` | `404` unknown / other company's user, `422` deactivated, `409` already on the team |
| DELETE | `/events/:id/team/:userId` | manages it | | `EventDetail` | `404` not on the team, `422` the owner (change the owner first) |
| GET | `/events/:id/attendees` | sees it | | `Attendee[]`, newest first | |
| POST | `/events/:id/attendees` | edits it | `{ name, company_name?, email?, mobile?, title? }` | `RegistrationResult { attendee, outcome, lead_id, limit_reached, message }` | `422` (name 2–255, valid email, mobile of the company's country, email or mobile required), `409 already_registered` (same email at this event), `409 event_cancelled`, `422 event_source_missing` |
| PATCH | `/events/:id/attendees/:attendeeId` | edits it | any attendee field | `Attendee` (the lead keeps its own data) | `404`, `409` email taken at this event, `422` |
| DELETE | `/events/:id/attendees/:attendeeId` | edits it | | `{ removed: true }` (a lead it created stays) | `404` |
| POST | `/events/:id/attendees/import` | edits it | `{ rows: [{ row, name, company_name?, email?, mobile?, title? }], file_name? }` (≤ 1,000 rows; the client reads CSV / .xlsx and maps the headers) | `{ added, leads_created, leads_linked, without_lead, failed[] {row, name, reason}, limit_reached }` | `422` no rows / too many, `409 event_cancelled` |
| POST | `/events/:id/attendees/:attendeeId/check-in` | edits it | `{ undo? }` | `Attendee` (`checked_in_at` set / cleared) | `404`, `409 event_cancelled` |
| GET | `/events/:id/stats` | sees it | | `EventStats` | |
| GET | `/public/events/:token` | **public** | | `{ name, type, start_date, end_date, start_time, end_time, timezone, location, online_url, description, organizer_name, registration_open, closed_reason, country }` (no ids, budget or people) | `404 event_not_found` |
| POST | `/public/events/:token/register` | **public** | `{ name, email, company_name?, mobile?, title?, website? }` + header `X-Client-Id` | `{ registered: true, message }` (never says whether a lead was created or linked) | `404 event_not_found`, `409 registration_closed`, `422 invalid_registration`, `429 rate_limited` |

### Rules

- **Registration → lead.** A new attendee becomes a lead: source = the company's active **Event** source (Settings ›
  Fixed lists; matched by key or label "Event"), `source_detail` = the event name, `event_id` (new lead column,
  `leads.event_id`, served on lead rows / detail), status New, industry empty, one contact (name, title, mobile,
  email), a first note "Registered at …", follow-up tomorrow (company time). **Owner**: the event owner and team
  members in turn (round-robin by the number of leads the event already created), keeping only people whose Sales
  scope can own leads (`full` / `team` / `own`); nobody → the company's first active Sales Agent, then the owner.
- **Duplicates.** An attendee whose email is an existing lead's email (lead email or any contact's, same company,
  case-insensitive) is **linked** to that lead (`outcome: linked`): no new lead, and a `system` activity "… registered
  at {event}" is logged on the lead. The same email twice at one event → `409 already_registered` (the public page
  answers success and stores nothing new).
- **No Event source.** When the company has no active Event source, registrations that would create a lead are
  refused with `422 event_source_missing` (a clear message pointing to Settings › Fixed lists); linking an existing
  lead still works. We refuse rather than create the source silently, so a company's list stays its own. Both
  seeded companies have one (Crest's list gained "Event").
- **Plan limit.** Creating the lead needs room for 2 leads + contacts (`assertCapacity`). At the limit the attendee
  **is still saved** without a lead: `outcome: none`, `lead_id: null`, `limit_reached: { code: 'LIMIT_REACHED',
  limit: 'leadsContacts', current, max, planId }` and a message saying so (HTTP 200). Imports continue row by row
  the same way (`without_lead`).
- **Public registration.** Each event has an unguessable 20-letter `registration_token`; the page `/e/:token` (no
  sign-in, no workspace) shows the public fields and a form. Registration must be open (`registration_open`, the
  event not completed / cancelled, the workspace not read-only) or `409 registration_closed`. Unknown token, a
  company without the module, or a deleted / suspended workspace → the same `404`. Rate limit like sign-up: 5
  attempts per client (`X-Client-Id`) and per email per event in 10 minutes (`429 rate_limited` with the wait).
  Honeypot `website`: filled → a success answer, nothing stored. Email is required on the public page.
- **Stats** count the event's attendees and their leads (created + linked); deals won = those leads in a won status.
- **Targets: Events attended** (`events` target key). An event counts for each of its team members (owner
  included) in the month of its start date (company time) once it took place: status `completed`, or not
  cancelled, started and at least one attendee checked in. Real counts only (no synthetic baseline). Without the
  module in the plan the kind is "n/a" everywhere (targets page, dashboard, reports, settings) and left out of
  completion (`eventsEnabledFor(entitlements.modules)` on the client, `eventsEnabledIn(companyId)` on the server).
- **Tasks.** A task may link to an event of the company while the plan includes the module (`422` otherwise);
  the event page has a Tasks tab (tasks with `related_type=event&related_id=:id`, quick add linked to the event).
- **Dates** are entered and shown in the company's timezone (regional settings) and stored as UTC instants; the
  calendar (`/events/calendar`, month / week, company week start) shows multi-day events on each day.

### Advanced features: permissions at a glance

Handlers `src/shared/mocks/handlers/eventsAdvanced.ts`, services `services/event{Templates,Agenda,Tickets,CheckIn,Comms,Capture,FollowUp,Survey,Budget}.ts`,
wire names `shared/api/eventMappers.ts` (snake_case at any depth; `answers` keeps its question-id keys). All company paths
are under `/events/*` or `/event-templates/*` (plan module `events` through the request policy → `403 module_not_in_plan`);
the public ones find the company from their token / code and answer the **same 404** when the module is off, the token is
unknown or the workspace is deleted / suspended.

| Right | Who | Endpoints |
|---|---|---|
| sees | as above (marketing column + team) | agenda, checklist, ticket types, attendees, captures, leaderboard, survey results, budget, email log, stats |
| edits | team members (any role) + marketing `full` | sessions / speakers, ticket types, capacity + questions (PATCH event), cancel registration, check-in (code), booth capture |
| manages | event owner + marketing `full` | apply a template, budget lines, campaign link |
| marketing `full` | Company Admin, Management, Marketing Manager | event templates (create / edit / delete; everyone with the module can read them) |
| sees + Marketing edit | marketing `full` | invite an audience, send follow-up (they create Marketing bulk emails and audiences) |

Role tests: `src/app/isolation/events.isolation.test.ts` (every role × both companies, with and without team membership).

### Templates & prep checklist

`EventTemplate { id, name, event_type, default_duration_days, tasks[] { id, title, offset_days, role ('owner' or a CRM role), priority } }`.
Seed: 2 per company (Apex: Exhibition stand, Breakfast briefing; Crest: Trade show booth, Conference panel).

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/event-templates` | module | | `EventTemplate[]` (own company) | |
| POST | `/event-templates` | marketing full | `{ name, event_type, default_duration_days, tasks[] }` | `EventTemplate` | `403`, `409` name taken, `422` (name 2–120, type, 1–60 days, ≤ 60 tasks, offset −365…365 whole, role, priority) |
| GET / PATCH / DELETE | `/event-templates/:id` | read: module; write: marketing full | PATCH: any field (existing task ids are kept) | `EventTemplate` / `{ deleted }` (tasks it made stay) | `404` |
| POST | `/events/:id/apply-template` | manages | `{ template_id }` | `{ created, skipped, checklist }` | `409` cancelled, `422` unknown / other company's template |
| GET | `/events/:id/checklist` | sees | | `{ items[] { task_id, title, due_date, owner_id, owner_name, status, priority, template_task_id, template_name, offset_days, done }, done, total, applied_template_ids }` | |
| POST | `/events` | as above | `+ template_id?` | the template is applied right after the create | `422` unknown template |

Rules: due date = the event's start date (company calendar) ± `offset_days`; a weekend date (the company's
`regional.weekend`) moves to a working day — tasks **before** the event move earlier, tasks on / after it later.
Owner: `owner` → the event owner; a role → the event-team member with that CRM role who got the fewest tasks in this
apply (ties: user id), nobody → the event owner (noted in the task description). Tasks link to the event
(`related_type event`) and carry the template task id: **re-applying never duplicates** (`skipped`). Owners other than
the caller get an assignment notification. The Checklist tab shows these tasks with progress (done / total, cancelled
left out); ticking one sets the task's status through `PATCH /tasks/:id`.

### Agenda & speakers

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/:id/agenda` | sees | | `{ sessions[] { id, title, date, start_time, end_time, starts_at, ends_at, room, description, speaker_ids, speakers[] }, speakers[] { id, name, title, company, bio, photo_url }, timezone, can_edit_speakers }` (speaker ids are **speaker-directory** ids) | |
| POST / PATCH / DELETE | `/events/:id/sessions[/:sessionId]` | edits | `{ title, date, start_time, end_time, room?, description?, speaker_ids? }` | `EventSession` / `{ removed }` | `422` (title, HH:mm, end > start, speakers must be in the company's speaker directory — another company's id = missing), `422 session_outside_event`, `409 session_overlap` (`session_id`), `404` |
| POST | `/events/:id/speakers` | edits | `{ speaker_id }` (pick from the directory) **or** `{ name, title?, company?, bio?, photo_url?, email? }` (new: creates the directory entry; the same person — email, or name + company — is reused) | `EventSpeaker` | `422` (not in the directory, name 2–120, photo URL) |
| PATCH | `/events/:id/speakers/:speakerId` | edits **and** marketing full | `{ name?, title?, company?, bio?, photo_url? }` — changes the directory profile (every event) | `EventSpeaker` | `403`, `404` (not on this event) |
| DELETE | `/events/:id/speakers/:speakerId` | edits | | `{ removed }` (off the roster and the sessions; the directory entry stays) | `404` |

Decision: **refuse, not warn**. A session must lie inside the event (its date between the start and end dates and, for
an event with times, between its start and end instants; all-day events: any time on their days); two sessions in the
same room (case-insensitive, non-empty) can't overlap (back-to-back is fine; no room = parallel allowed). Times are the
company's timezone, stored as UTC. `GET /public/events/:token` adds `agenda[]` (sessions with speakers, no ids).

### Tickets, capacity, waitlist & questions

`TicketType { id, name, capacity (null = unlimited), price (0 = free; company currency, no payment), currency, sales_open,
sales_close (company dates, inclusive), registered, waitlisted, checked_in, remaining, on_sale }`. Event fields
(PATCH `/events/:id`): `capacity` (null = unlimited), `questions[] { id, label, type text|single|multi, options[], required }`
(ids kept when sent back; answers are keyed by them), plus `waitlist_count`, `remaining_seats`.

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/:id/ticket-types` | sees | | `TicketType[]` | |
| POST / PATCH | `/events/:id/ticket-types[/:ticketTypeId]` | edits | `{ name, capacity?, price?, sales_open?, sales_close? }` | `TicketType` | `409` name taken, `422` (capacity below the seats taken, price ≥ 0, dates), ≤ 20 types |
| DELETE | `/events/:id/ticket-types/:ticketTypeId` | edits | | `{ removed }` | `409` people hold it |
| POST | `/events/:id/attendees/:attendeeId/cancel` | edits | | `{ attendee, promoted[] }` | `409` already cancelled, `404` |

Rules: a registration (public page, team add, import) takes a seat when both the event's capacity and the ticket's
have room; otherwise it joins the **waitlist** (`status: waitlisted`, `waitlist_position` = order of arrival) — it still
creates / links the lead and keeps every existing rule (duplicates, plan limit, rate limit, honeypot). The public page
must pick a ticket when the event has types, the ticket must be on sale (`409 ticket_not_on_sale`) and required questions
answered (`422 invalid_registration`); team adds default to the first ticket type and don't enforce the sales window or
required answers. Cancelling (or deleting) a seated registration, raising a capacity or removing a ticket limit
**promotes** the first waitlisted people that now fit (an email log entry `promoted` + a notification to the event owner).
Cancelled registrations stay (history) and free their email. Waitlisted people can't be checked in (`409 not_registered`).
Stats and `attendee_count` count seated attendees only. `Attendee` adds `status, waitlist_position, ticket_type_id,
ticket_type_name, answers, checked_in_by_name, ticket_code, survey_token` (the last two for editors only). Public: `GET
/public/events/:token` adds `remaining_seats, tickets[] { id, name, price, currency, remaining, on_sale }, questions[],
starts_at, ends_at`; `POST …/register` takes `ticket_type_id, answers` and answers `{ registered, message, status,
waitlist_position, ticket_code }` (an email already registered and the honeypot get the generic answer with nulls).

### Check-in, tickets & badges

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| POST | `/events/:id/check-in` | edits | `{ code, undo? }` | `{ attendee, already_checked_in, message }` | `404 ticket_not_found` (unknown, another event's or company's code), `409 not_registered`, `409 event_cancelled` |
| GET | `/events/:id/check-in` | edits | | `{ registered, checked_in, waitlisted, by_ticket_type[] { ticket_type_id, name, registered, checked_in }, recent[] }` | |
| GET | `/public/tickets/:code` | **public** | | `{ code, status, waitlist_position, attendee_name, company_name, ticket_type_name, checked_in, event { name, type, dates, times, starts_at, ends_at, timezone, location, online_url, organizer_name, status } }` | `404 ticket_not_found` (also cancelled / module off), `429 rate_limited` (30 / 10 min per client) |

Every attendee gets an unguessable **ticket code** (12 characters, `XXXX-XXXX-XXXX`, no 0/O/1/I; unique; never the
registration token; seed codes are stable). Codes match case-insensitively, ignoring spaces / dashes (scanners type them).
Check-in is idempotent: a second scan answers `already_checked_in: true` with the original time; `undo` clears it.
Pages: `/events/:id/check-in` (code field, live counters, latest check-ins with undo; a camera isn't needed),
`/events/:id/badges` (A4 portrait sheet of 8 badges: name, company, ticket type, QR), `/t/:code` (printable ticket + QR,
`qrcode.react`); the confirmation shows the QR and links.

### Invitations, reminders & calendar

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| POST | `/events/:id/invite` | sees + Marketing edit | `{ name?, audience_id?, industries?, statuses?, sources?, owner_ids?, template_id? \| subject? + body? }` | the bulk email draft (`BulkEmailDetail` + `event_id`) | `403`, `409` cancelled / completed, `422` as bulk emails |
| GET | `/events/:id/emails` | sees | | `[{ id, attendee_id, attendee_name, kind confirmation\|waitlisted\|promoted\|reminder, to, subject, status sent\|skipped, skip_reason no_email\|limit, at }]` | |
| GET | `/public/events/:token/calendar.ics` | **public** | | `text/calendar` (the event) | `404`, `409` cancelled, `429` |
| GET | `/public/tickets/:code/calendar.ics` | **public** | | `text/calendar` (the attendee's entry, with the ticket link) | `404`, `409`, `429` |

Rules: "Invite an audience" creates a Marketing bulk email **draft** linked to the event (and to its campaign) — the bulk
email builder, exclusions (DNC, not interested, no email, duplicates), the `emailsPerMonth` limit and the fair queue all
apply. Template variables gain an **Event** group: `{{event.name}}`, `{{event.date}}`, `{{event.location}}`,
`{{event.registration_url}}`, `{{event.survey_url}}` (the recipient's own survey, attendees only), filled for bulk emails
with an `event_id`. **Reminder**: each seated attendee gets one email `reminder_hours` before the start (event setting,
default Settings › Automation `eventReminderHours` = 24, 0 = off), on the lifecycle tick; once only
(`reminder_sent_at`), counted against `emailsPerMonth` (none left → logged `skipped / limit`, not retried); not after the
start. Confirmation / waitlist / promotion emails are logged and counted the same way. "Add to calendar": Google and
Outlook links (UTC times; all-day events use dates) and the .ics files (`modules/events/lib/calendar.ts`).

### Booth capture & leaderboard

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| POST | `/events/:id/captures` | edits | `{ name, company_name?, email?, mobile?, title?, rating hot\|warm\|cold, notes?, card_photo_url? }` | `{ capture, outcome, lead_id, limit_reached, message }` | `422` (rating, email or mobile, https URL), `422 event_source_missing`, `409 event_cancelled`, `403`, `404` |
| GET | `/events/:id/captures` | sees | | `EventCapture[] { id, attendee_id, name, company_name, email, mobile, title, lead_id, lead_outcome, can_open_lead, rating, notes, card_photo_url, captured_by, captured_by_name, captured_at }` | |
| GET | `/events/:id/leaderboard` | sees | | `[{ user_id, name, captures, hot_leads, warm_leads, deals_won, won_value }]` (team + anyone who captured) | |

The lead is created or linked **at once** (source Event, `event_id`; the plan limit keeps the person without a lead).
Owner of a new lead: the capturer when their Sales scope can own leads, else the event's round-robin. The visitor becomes
an attendee (`source: capture`, checked in, no seat check); an email already registered at the event is linked and
checked in instead. Decision: leads have no tags column, so the **rating is stored on the capture** and written into a
`meeting` activity on the lead (with the notes). Page: `/events/:id/capture` (phone-friendly form).

### After the event

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| POST | `/events/:id/follow-up` | sees + Marketing edit | `{ attended_template_id?, no_show_template_id? }` | `{ attended, no_show, attended_audience_id, no_show_audience_id }` (two bulk email drafts) | `409` not completed, `403` |

When an event becomes `completed`, each lead from it with a seat (registered or captured; not waitlisted / cancelled)
gets **one** follow-up task for its owner (else the event owner), due `follow_up_days` after the completion day (company
calendar; weekend → next working day; default Settings › Automation `eventFollowUpDays` = 2). Once only:
`follow_up_tasks_at` + the task's template id `event-follow-up:<event id>` per lead. Owners get one notification each.
"Send follow-up" creates (or reuses) two dynamic audiences — `<event> · attended` and `<event> · no-shows` — and a draft
on each: attendees (checked in) get a thank-you with `{{event.survey_url}}`, no-shows (seat, never checked in) a "sorry we
missed you". **Audiences rule** `event_presence: any | attended | no_show` (with `event_ids`) is available in Marketing ›
Audiences.

### Feedback survey

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/:id/survey` | sees | | `{ responses, invited, response_rate, average_rating, nps, promoters, passives, detractors, comments[] }` | |
| GET | `/public/surveys/:token` | **public** | | `{ event_name, organizer_name, attendee_first_name, open, submitted, closed_reason }` | `404 survey_not_found`, `429` |
| POST | `/public/surveys/:token` | **public** | `{ rating 1–5, nps 0–10, comment? }` | `{ submitted, message }` | `409 survey_closed` (before the end / cancelled), `409 already_submitted`, `422 invalid_survey`, `404`, `429` |

Each seated attendee has an unguessable survey token (24 letters; page `/s/:token`). The survey opens once the event is
completed or its end has passed (not cancelled); **one answer per attendee**. NPS = % promoters (9–10) − % detractors
(0–6), rounded (−100…100; null without answers).

### Budget & ROI

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/:id/budget` | sees | | `{ lines[] { id, category, note, planned, actual, posted }, planned_total, actual_total, budget, remaining, currency, campaign_id, campaign_name, posted_total, can_manage }` | |
| POST / PATCH / DELETE | `/events/:id/budget-lines[/:lineId]` | manages | `{ category venue\|travel\|logistics\|printing\|sponsorship\|catering\|marketing\|other, planned?, actual?, note? }` | the budget | `422` (category, amounts ≥ 0, note ≤ 255), `404` |
| PUT | `/events/:id/campaign` | manages | `{ campaign_id \| null }` | the budget | `422` unknown / other company's campaign, plan without Marketing |

Linked to a campaign, each line's **actual** (> 0) is posted as a campaign cost entry — one per line and campaign
(`event_cost_links`), kept in step when the line changes, removed when it goes to 0 or is deleted (idempotent, like synced
ad costs). Unlinking (or linking another campaign) keeps what was posted. Stats: when the event has lines, `actual_cost` =
their actual total (`actual_cost_source: budget_lines`), else the event's field; `roi = (won_value − actual_cost) /
actual_cost` (ratio; null without a cost), `cost_per_won_deal = actual_cost / deals_won`. Marketing Analytics' events
card shows each event's actual cost and the total. Seed: budget lines on both companies' completed exhibitions (their
actuals add up to the event's actual cost).

### Cross-event sections: Attendees, Booth leads, Event analytics

Handlers `src/shared/mocks/handlers/eventSections.ts` (registered **before** the per-event handlers so `/events/attendees`
isn't read as `/events/:id`), service `services/eventSections.ts`, wire names `shared/api/eventSectionMappers.ts`
(snake_case at any depth), types `modules/events/sectionsTypes.ts`. Pages `/events/attendees`, `/events/booth-leads`,
`/events/analytics` (nav: Events section, `planModule: 'events'`; Event analytics also `module: 'marketing'`).

**Visibility (decision).** Every row comes from an event the caller **sees** (`canSeeEvent`): marketing `full` / `view`
→ every event of the company; `team` / `own` / `hidden` → the events they're on (owner or `event_team`, + `team`: owned by
their team). Lead details (`lead_status`, `lead_owner_*`, `lead_value`) are served only when the caller's Sales scope
reaches the lead (`can_open_lead`), like the per-event tabs; `lead_id` and the derived follow-up state are always served.

| Method | Path | Who | Body / query | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/attendees` | module | | `{ people[], events[] { id, name, type, status, start_date }, can_export }` | `403 module_not_in_plan` |
| GET | `/events/attendees/export` | marketing `full` | | `AttendeeExportRow[]` (one per person; **Do Not Contact people keep their row with `email` / `mobile` blank**) | `403` |
| GET | `/events/booth-leads` | module | | `{ rows[], follow_up_days, today, can_assign, currency }` | `403 module_not_in_plan` |
| POST | `/events/booth-leads/assign` | Sales edit with scope `full` / `team` | `{ capture_ids[] (1–500), owner_id }` | `{ updated, skipped[] { capture_id, reason } }` | `403`, `422` no captures / unknown, other company's or deactivated owner (same body) |
| GET | `/events/analytics?preset=&from=&to=&compare=` | Marketing view **and** Reports `full` / `marketing` | presets as Marketing analytics (`this_month`, `last_30_days`, `this_quarter`, `ytd` default, `custom` + `from` / `to` ≤ 2 years), `compare` default true | `EventAnalytics` | `403`, `400` bad preset / dates |

**Attendees directory.** `AttendeePerson { key, name, company_name, email, mobile, title, do_not_contact, events_registered,
events_attended, checked_in_rate, last_event_id, last_event_name, last_event_date, ticket_types[], sources[], lead_id,
lead_status, lead_owner_id, lead_owner_name, can_open_lead, registrations[] { attendee_id, event_id, event_name,
event_type, event_status, event_date, status, ticket_type_name, source, registered_at, checked_in_at, survey { rating,
nps, comment } | null, captures[] { id, rating, notes, captured_by_name, captured_at } } }`. **De-duplication**: one person
per email (case-insensitive), else per lead, else the single registration; `key` is opaque (`P-<first attendee id>`, never
the email). `events_registered` = distinct events with a registration that isn't cancelled; `events_attended` = distinct
events checked in; `checked_in_rate` = checked in ÷ seats at events that started (company calendar), %, null before any.
The lead is the newest registration's lead; `do_not_contact` is the lead's flag. Filters (event, type, date range,
checked in, lead / lead status, company), search and sort run on the client; the CSV / Excel export (marketing `full`
only) follows the filters on screen.

**Booth leads.** `BoothLead { id (capture), event_id, event_name, event_type, captured_at, captured_by, captured_by_name,
rating, notes, visitor_name, visitor_company, visitor_email, lead_id, lead_status, lead_owner_id, lead_owner_name,
lead_value, can_open_lead, state, follow_up_due, overdue, days_overdue }`. **Follow-up state** (from the lead, activities
**after** the capture; the capture's own "Booth capture" meeting activity `A-ECP-*` doesn't count): `won` / `lost` (status
type) › `meeting` (a `meeting` activity, or status Meeting / Proposal) › `contacted` (a call, email, WhatsApp or visit) ›
`untouched`; `no_lead` without a lead. **Overdue**: `untouched` and today (company timezone) is after `follow_up_due` =
the capture day (company timezone) + Settings › Automation `eventFollowUpDays`. **Notice**: the first time a capture is
overdue, its lead's owner (active, same company) gets ONE stored notification (`type: event-follow-up`, shown as a
`follow-up` alert, link to the lead); `event_capture_follow_up_notices` marks the capture (also when nobody could be told),
so it's never sent twice. The tick runs lazily for the caller's company on `GET /alerts` and `GET /events/booth-leads`.
**Assign owner** (bulk): each capture's lead goes through the normal lead update (`updateLead`, the `PATCH /leads/:id`
path), so the caller's lead scope rules apply per lead (a `team` scope can only hand leads within the team; refusals come
back in `skipped` with the message). Captures the caller can't see (another company's, out of reach, unknown) are
`not_found`, captures without a lead `no_lead`. Decision: Marketing `full` alone isn't enough (lead owners follow the
Sales column): Company Admin, Management, Sales Manager (+ Department Head within their team).

**Event analytics (decision: Marketing view AND Reports full | marketing, like Marketing analytics).** Those roles see
every event, so the numbers are the company's; team members without it get `403` (they have the per-event pages).
Events **held** in the period: not cancelled, start date (company calendar) in `[from, to]` and on / before today.
`EventAnalytics { preset, from, to, timezone, currency, kpis, previous, previous_kpis, rows[], by_type[], trend[] }`.
Each row reuses the event stats (`statsOf`) and survey results: `attendees, checked_in, check_in_rate, leads,
leads_created, leads_linked, cost_per_lead, cost_per_lead_basis, deals_won, won_value, actual_cost, budget, roi (%),
nps, responses` — so a row's cost per lead is **exactly** the event page's. KPIs: `events, attendees, checked_in,
check_in_rate, leads_created, leads_linked, deals_won, won_value, actual_cost` (known actual costs), `cost_per_lead` =
Σ cost (actual when known, else budget: the event stats basis) ÷ Σ new leads over events with a cost and new leads,
`roi` = (won value − actual) ÷ actual over events with a known actual cost (%), `average_nps` = mean of the events' NPS.
`by_type[] { type, events, leads_created, cost, cost_per_lead, won_value, roi }` (insight cards: best / weakest type by
ROI, else by cost per lead), `trend[] { month, events, check_in_rate, nps }` (by the event's start month). Excel export
(summary, events, types) and print on the client.

**Seed** (synthetic, different per company): EV-1005 Hospitality Leaders Roundtable (meeting, 75 days ago) and EV-1006
Smart Property AI Webinar (yesterday, budget only) for Apex; EV-5003 Jeddah Cold Chain Summit (conference, 90 days ago,
budget lines) and EV-5004 Warehouse Automation Webinar (yesterday) for Crest — repeat attendees from the first exhibition,
no-shows, a Do Not Contact person, tickets, survey answers and captures in every follow-up state (overdue and not yet
due). Tests: `services/eventSections.test.ts`, role matrix `src/app/isolation/eventSections.isolation.test.ts`, isolation
table `isolation/eventSectionsEndpoints.ts`, e2e `e2e/events-sections-a.spec.ts`.

### Speakers, venues & vendors

Company-wide libraries (sidebar › Events › Speakers, Venues, Vendors; pages `/events/speakers[/:id]`, `/events/venues[/:id]`,
`/events/vendors[/:id]`). Handlers `src/shared/mocks/handlers/eventLibrary.ts`, services `services/eventLibrary.ts` (endpoints) and
`services/eventLibraryCore.ts` (access, validation, the pick rules used by agenda / budget / events), stores
`data/eventLibrary.ts`, seed `data/eventLibrarySeed.ts`, wire names `shared/api/eventLibraryMappers.ts` (snake_case at any
depth). Paths `/event-speakers`, `/event-venues`, `/event-vendors` → plan module `events` (request policy, `403 module_not_in_plan`).

**Permissions (decision)** — no own column; the MARKETING column plus event-team membership (`modules/events/lib/library.ts › libraryAccess`):

| Right | Who | What |
|---|---|---|
| manage | marketing `full` (Company Admin, Management, Marketing Manager) | create / edit / delete (when unused) speakers, venues (archive), vendors (blacklist) |
| read | marketing `view` (Sales Manager) **and** anyone on any event's team (owner or member, any role) | lists and detail pages; picking in their own events: agenda speakers (`edits`), the event's venue (`edits`), budget-line vendors (`manages`) |
| rate | the event's owner or marketing `full`, event status `completed` | speaker ratings (speakers on that event's agenda), vendor reviews (vendors with lines on that event) |
| none | everyone else | `403`; the sidebar hides the three sections for roles without marketing view (team members open them from their events) |

Role tests: `src/app/isolation/eventLibrary.isolation.test.ts` (every role × both companies, without and with an event of their own).

**Speakers** — `Speaker { id, name, title, company, bio, photo_url, email, mobile, topics[], linkedin_url, kind internal|external, user_id, user_name, fee, fee_currency, notes, rating (avg, 1 decimal), rating_count, event_count, created_at, updated_at }`.
`SpeakerDetail` adds `events[] { event_id, event_name, start_date, status, sessions[] { id, title, date, start_time, end_time }, rating, can_rate }`, `hidden_events` (events the caller can't see, counted only), `ratings[] { event_id, event_name, rating, note, rated_by_name, rated_at }`, `can_manage`.

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/event-speakers` | read | | `Speaker[]` (own company, by name) | `403` |
| POST | `/event-speakers` | manage | `{ name, title?, company?, bio?, photo_url?, email?, mobile?, topics?, linkedin_url?, kind?, user_id?, fee?, fee_currency?, notes? }` | `Speaker` | `409 speaker_exists` (`speaker_id`; same email, or same name + company), `422` |
| GET | `/event-speakers/:id` | read | | `SpeakerDetail` | `404` |
| PATCH | `/event-speakers/:id` | manage | any field | `Speaker` | `404`, `409 speaker_exists`, `422` |
| DELETE | `/event-speakers/:id` | manage | | `{ deleted }` | `404`, `409 speaker_in_use` (on an event's agenda) |
| POST | `/event-speakers/:id/ratings` | rate | `{ event_id, rating 1–5, note? }` (re-rating an event replaces it) | `SpeakerDetail` | `404`, `403`, `422` (event missing / another company's — same answer, not completed, speaker not on its agenda, rating) |

Validation: name 2–120; email valid; **mobile**: a venue's contact by the **venue's** country (else the company's), speakers and vendors by the company's country — and, since they are often abroad, any number in international form (`+` or `00`, country code, 8–15 digits, stored as `+<digits>`) is accepted; a number in the checked country's own dial code must still pass that country's rules (`shared/lib/phone.ts`); photo an https URL or an image
from Brand Assets (a `data:image/…` URL ≤ 400 kB); topics ≤ 20 × 40 chars (case-insensitive dedupe); internal speakers may link
an employee (`user_id` of the company); fee ≥ 0 with a currency (AED, SAR, USD, EUR, GBP, QAR, KWD, BHD, OMR, EGP; default the
company's). The public registration page's agenda shows name, title, company, bio and photo only.

**Migration (decision)**: `event_speakers` rows used to be a copy of the person per event. They are now the event's roster
(`event_id → speaker_id`) and sessions reference directory ids. `services/speakerMigration.ts › migrateLegacySpeakers` turns
old rows into directory entries — per company, dedupe by email, else name + company (case / whitespace-insensitive), an existing
entry is reused and only its empty fields are filled — and rewrites session speaker ids. The seed is written the old way and
migrated (Omar Farouk on three Apex events is one entry). Persisted dev DB: `VERSION` bumped (old snapshots reseed).

**Venues** — `Venue { id, name, type exhibition_centre|hotel|conference_hall|office|online_platform|other, address, city, country (ISO-2), map_url, lat, lng, capacity, rooms[] { id, name, capacity }, contact_name, contact_mobile, contact_email, day_rate, currency, price_notes, amenities[], notes, rating 1–5|null, status active|archived, event_count }`.
`VenueDetail` adds `past[]` / `upcoming[]` `{ event_id, event_name, start_date, end_date, status, attendee_count, checked_in_count, capacity, upcoming }`, `hidden_events`, `average_attendance` (past, not cancelled: checked-in people, else registered; rounded), `can_manage`.

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/event-venues` | read | | `Venue[]` (archived included; the UI hides them by default) | `403` |
| POST | `/event-venues` | manage | the fields above (`name` required) | `Venue` | `409 venue_exists` (name, per company), `422` (lat + lng both or neither, ranges, whole capacities, mobile by country…) |
| GET / PATCH | `/event-venues/:id` | read / manage | PATCH: any field (room ids kept) | `VenueDetail` / `Venue` | `404`, `409`, `422` |
| DELETE | `/event-venues/:id` | manage | | `{ deleted }` | `404`, `409 venue_in_use` (archive it instead) |

Events get `venue_id` (POST / PATCH `/events[/:id]`, optional; `null` clears). The venue must be the company's own and
**active** (an archived venue stays on events that already had it); another company's id answers like a missing one
(`422 That venue doesn't exist.`). An empty `location` is filled with "name, city"; the free-text `location` stays the
fallback / override. Event rows add `venue_id, venue_name, venue_capacity, venue_warning`.
**Capacity (decision): WARN, not refuse** — `venue_warning` when the event's capacity is above the venue's, or more people are
registered than the venue holds (the venue's capacity depends on the layout; the event capacity is a registration cap). The
event page shows it under Venue.

**Vendors** — `Vendor { id, category booth_builder|printing|catering|giveaways|av_tech|photo_video|logistics|staffing|venue_services|other, name, contact_name, mobile, email, website, tax_number, payment_terms, status preferred|approved|blacklisted, notes, documents[] { id, name, url }, rating (avg of reviews), review_count, total_actual, event_count, currency, created_at, updated_at }`.
`VendorDetail` adds `spend[] { event_id, event_name, start_date, status, lines, planned, actual, rating, needs_rating, can_rate }` (events the caller can see), `hidden_events`, `total_planned`, `reviews[] { id, event_id, event_name, rating, notes, rated_by_name, rated_at }`, `can_manage`.
Spend = the **actual** amounts of the budget lines linked to the vendor (`total_actual` over all its lines; per event in `spend`).

| Method | Path | Who | Body | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/event-vendors` | read | | `Vendor[]` | `403` |
| POST | `/event-vendors` | manage | `{ category, name, contact_name?, mobile?, email?, website?, tax_number?, payment_terms?, status?, notes?, documents? }` | `Vendor` | `409 vendor_exists`, `422` (https website / document links, tax number 3–50 letters / digits, mobile by country) |
| GET / PATCH | `/event-vendors/:id` | read / manage | PATCH: any field (document ids kept) | `VendorDetail` / `Vendor` | `404`, `409`, `422` |
| DELETE | `/event-vendors/:id` | manage | | `{ deleted }` | `404`, `409 vendor_in_use` (has budget lines) |
| POST | `/event-vendors/:id/reviews` | rate | `{ event_id, rating 1–5, notes? }` (one per event; re-rating replaces it) | `VendorDetail` | `404`, `403`, `422` (event missing / another company's — same answer, not completed, no lines of the vendor on it) |

Budget lines (`/events/:id/budget-lines`) take `vendor_id` (optional; absent keeps it, `null` clears it) and serve
`vendor_id, vendor_name`. **Blacklist rule**: a blacklisted vendor can't be picked for a new line nor newly picked on an
existing one → `422 vendor_blacklisted` ("… is blacklisted and can't be picked for budget lines …"); a line that already had
the vendor keeps it. Another company's vendor id answers like a missing one (`422 That vendor doesn't exist.`). The budget of a
**completed** event adds `vendors_to_rate[] { vendor_id, vendor_name }` (vendors with lines there and no review for it): the
Budget tab shows "Rate after the event".

Seed (different per company): Apex — Dubai venues (Dubai World Trade Centre on GITEX + Arab Health, Jumeirah Emirates Towers on
the breakfast, a Zoom account on the webinar, an archived hotel), vendors (Expo Craft Stands preferred + reviewed, Emirates Print
House, Saffron Events Catering linked to GITEX lines and still to rate, Gulf Giveaways blacklisted), speakers (migrated + an
internal one and a paid keynote). Crest — Riyadh venues (Riyadh Front on the expo, the Hilton on the forum: forum capacity 120 vs
venue 100 → warning), vendors (Najd Booth Builders preferred + reviewed, Al Yamamah Printing, Riyadh AV, Desert Cargo blacklisted),
speakers. Isolation: entries in `isolation/eventLibraryEndpoints.ts`; foreign ids in bodies (venue, speaker, session speakers,
vendor, rating / review events, employee) in `isolation/eventLibrary.isolation.test.ts`.

### Sponsors & exhibitors

For events the company **organizes** (`is_organizer`; writes on an attended event → `422 not_organizer`). Read = sees
the event; write = the event's edit right (marketing `full` or the event team — owner and members, any role). Screens:
`/events/sponsors` (pipeline board with `onBlockedMove` messages + list, filters event / package / stage / owner; view
kept in `userStorage.pref`), the event's **Sponsors** tab (packages, sponsors, income) and the sponsor drawer.

| Method | Path | Who | Body / query | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/sponsors` | module | `?event_id&package_id&stage&owner_id` | `{ currency, deals[], packages[], events[] { id, name, start_date, can_manage } }` — organized, not cancelled events the caller sees (empty for others) | |
| GET | `/events/sponsor-organizations` | module | `?q` | `[{ kind lead\|customer, id, name, contact_name, contact_email }]` (≤ 30; leads in the caller's Sales scope, customers unless Sales is hidden) | |
| GET | `/events/:id/sponsorship` | sees | | `{ event_id, is_organizer, currency, packages[], deals[], income { signed, paid, total }, can_manage }` | `404`, `403` |
| POST / PATCH | `/events/:id/sponsor-packages[/:packageId]` | edits | `{ name 2–80, price ≥ 0, currency? (= company currency), quantity 1–500, benefits[] ≤ 30, deliverables[] { title, offset_days −365…365 } ≤ 30 }` | package `{ …, sold, remaining, deal_count }` | `422`, `409` same name, `409 quantity_below_sold` |
| DELETE | `/events/:id/sponsor-packages/:packageId` | edits | | `{ removed }` | `409 package_in_use` |
| POST | `/events/:id/sponsors` | edits | `{ package_id, lead_id \| customer_id \| new_lead { company, contact_name?, email?, mobile? }, force?, contact_name?, contact_email?, amount? (default price, ≤ price), owner_id?, stage? (open or signed), expected_payment_date?, notes? }` | sponsor (below) | `422 invalid_package` / `invalid_organization` / owner, `409 duplicate_lead { matches[] }`, `403` force without a manager, `409 already_sponsor`, `409 sold_out`, `402 LIMIT_REACHED`, `422 event_source_missing` |
| GET / PATCH / DELETE | `/events/:id/sponsors/:sponsorId` | sees / edits | PATCH `{ package_id?, amount?, owner_id?, contact_name?, contact_email?, expected_payment_date?, actual_payment_date?, notes? }` | sponsor `{ id, event_id, event_name, event_start_date, package_id, package_name, package_price, discount, organization_name, lead_id, customer_id, can_open_organization, contact_name, contact_email, amount, currency, stage, lost_reason, owner_id, owner_name, expected_payment_date, actual_payment_date, notes, signed_at, deliverables[], can_manage }` | `404`, `409 sold_out` (moving a signed sponsor to a full package) |
| POST | `/events/:id/sponsors/:sponsorId/stage` | edits | `{ stage, lost_reason?, actual_payment_date? }` | sponsor | `409 invalid_stage`, `409 sold_out`, `422 lost_reason_required` |
| PATCH | `/events/:id/sponsors/:sponsorId/deliverables/:deliverableId` | edits | `{ status? todo\|in_progress\|done, due_date?, owner_id? }` | sponsor | `404`, `422` |
| POST | `/events/:id/sponsors/:sponsorId/deliverables/:deliverableId/task` | edits | | sponsor (the deliverable's `task_id`); idempotent | `404` |

Rules (`services/eventSponsors.ts`):
- **Stages** `prospect → contacted → proposal_sent → negotiating` move freely; `→ signed` takes one of the package's
  `quantity` slots (signed + paid sponsors) — none left → **`409 sold_out`**; `→ paid` only from `signed` (sets
  `actual_payment_date`, default company today; `paid → signed` clears it); `signed` / `paid` only go to `paid`,
  `signed` or `lost`; any stage → `lost` with a reason (≥ 3 characters), which frees the slot; `lost` reopens to an
  open stage only. The board applies the same rule client-side to explain a refused drop.
- **Organization**: a lead or customer of the company (another company's id = unknown, `422`), or a new lead through
  the normal lead rule: duplicate name / email / domain → `409 duplicate_lead` unless `force` by a manager (Sales full /
  team); source = the company's Event source, `source_detail` = event name, `leads.event_id` = the event; owner = the
  sponsor owner (else the caller, the event team, the first Sales Agent who can own leads); counts toward leads + contacts.
- **Currency**: packages are priced in the company currency (another code → `422`), so income adds up.
- **Deliverables**: created once, when the sponsor is first signed, from the package template: due = event start date
  (company calendar) + `offset_days`, owner = the sponsor owner. A linked task (`link event`, `template_task_id
  sponsor-deliverable:<id>`) is created on request, once; marking the deliverable done completes it. **Overdue**
  (due before company today, not done, sponsor not lost) → one stored notification (`marketing-overdue`) to its
  owner, once (`overdue_notified_at`, re-armed by a new due date); runs on the lifecycle tick and the sponsor reads.
- **Income & ROI** (decision): signed + paid amounts are the event's **sponsorship income**. `GET /events/:id/stats`
  (`statsOf`, the one stats function) adds `sponsorship_income` (null for attended events) and, for organized events,
  `roi = (won_value + sponsorship_income − actual_cost) / actual_cost`; attended events are unchanged. The budget answer
  carries `sponsorship_income` too (shown on the Budget tab; it is income, not a budget line).

### Travel & logistics

For events the company attends **or** organizes. Read = sees the event (marketing `view` / `full`: every event; team
members: theirs); write = the event's edit right (marketing `full` or the event team). **Everyone with the module
always sees their own trips** (read-only), even on events outside their access. Screens: `/events/logistics` (tabs
Trips grouped by event with per-person totals · Shipments · Deadlines by month; event filter) and the event's
**Logistics** tab.

| Method | Path | Who | Body / query | Answer | Errors |
|---|---|---|---|---|---|
| GET | `/events/logistics` | module | `?event_id` | `{ currency, trips[], shipments[], deadlines[], events[] { id, name, start_date, is_organizer, can_manage }, sees_all, vendors[] { id, name } }` | |
| GET | `/events/:id/logistics` | sees, or has an own trip there (own trips only) | | same shape | `404`, `403` |
| POST / PATCH / DELETE | `/events/:id/trips[/:tripId]` | edits | `{ user_id, flight_from, flight_to, depart_date, return_date, airline, booking_ref, flight_cost, hotel_name, check_in, check_out, hotel_cost, visa_required, visa_status not_needed\|applied\|approved\|rejected, visa_expiry, visa_number (write-only), per_diem, other_costs, status planned\|booked\|completed\|cancelled, notes }` | trip `{ …, user_name, visa_number_masked "•••• 4821", total, budget_line_id, can_manage }` | `422` (a person of another company = unknown, dates, amounts ≥ 0, number 5–30 letters / digits), `409 trip_exists` (one per person per event) |
| POST / PATCH / DELETE | `/events/:id/shipments[/:shipmentId]` | edits | `{ items 2–500, vendor_id? (vendor library) \| vendor_name?, tracking_number, ship_date, arrival_date, status preparing\|in_transit\|delivered\|returned\|cancelled, cost, notes }` | shipment `{ …, budget_line_id }` | `422` (unknown / other company's vendor, arrival before ship date) |
| POST / PATCH / DELETE | `/events/:id/deadlines[/:deadlineId]` | edits | `{ title 2–160, due_date, owner_id? (default event owner), done?, notes? }` | deadline `{ …, owner_name, done_at, overdue, days_left }` | `422` |

Rules (`services/eventLogistics.ts`, `data/eventLogistics.ts`):
- **Visa / document numbers are never stored or returned in full**: the server keeps the last 4 characters and serves
  `visa_number_masked`; `visa_number` is write-only (omitted keeps it, `''` clears it; visa not required → cleared). The
  secrets guard rejects `visa_number` / `passport_number` / `document_number` keys in any response.
- **Costs → budget (idempotent)**: each trip keeps one budget line, category `travel` (planned = actual = flight +
  hotel + per-diem + other), each shipment one line, category `logistics` (new category "Logistics / shipping"; the
  shipment's `vendor_id` goes on the line). Create → line, edit → the same line updated, delete or a total of 0 → line
  removed (`event_logistics_lines`). These lines answer `source { kind, id }` on the budget and refuse direct edits
  (`409 managed_by_logistics`); they count in the actual cost, ROI and cost per lead, and post to a linked campaign.
- **Deadline reminders**: an open deadline due within 3 days (company calendar) → one stored notification
  (`marketing-due`) to its owner (else the event owner), once (`reminder_sent_at`, re-armed by a new due date).
- Seed: Apex attends **CES 2027** (EV-1101, Las Vegas: 3 trips with flights / hotels / visas, a DHL shipment, 5
  deadlines); Crest's Riyadh forum (EV-5002: 2 domestic trips, an SMSA shipment, 3 deadlines). Sponsors: Apex's Dubai
  Business Breakfast (EV-1003: Platinum sold out and paid, Gold, Exhibitor table, sponsors at every stage) and Crest's
  own **Cold-Chain Partner Day 2027** (EV-5101, organized). Isolation entries: `isolation/sponsorsLogisticsEndpoints.ts`.

### Isolation

Every endpoint is in `src/shared/mocks/isolation/endpoints.ts` (company-list / -write / -item / -export with samples;
`/public/events/*` as `public` with a reason); the advanced ones in `isolation/eventsEndpoints.ts` (public tickets, .ics
files and surveys as `public` with reasons). Events, team rows, attendees, history, templates, sessions, speakers, ticket
types, emails, captures, survey answers, budget lines and cost links carry `company_id`; leads created by a registration
or capture land in the event's company only. Persisted dev DB: `VERSION` 13.

## Marketing

Phase 2, optional, plan-gated. Plan module `marketing` (Business and Enterprise; not Starter / Trial): every
`/marketing/*` path answers **403 `module_not_in_plan`** (`{ module: 'marketing', planId }`) when the company's plan
(± platform overrides) lacks it — checked centrally in `userFrom` → `enforceRequestPolicy`. Role rights come from the
**Marketing** column of `PERMISSION_MATRIX`: `hidden` → 403 on every endpoint; `view` (Sales Manager) → reads only,
writes 403; `full` (Company Admin, Management, Marketing Manager) → reads and writes. The cost-per-lead report also
needs a **Reports** scope of `full` or `marketing` (the marketing report family; `reports/lib/marketingAccess.ts`).
Everything is scoped to the caller's company; another company's id answers exactly like a missing one (404, or 422
inside a body). Wire names: `src/shared/api/marketingMappers.ts`; tables `campaigns`, `campaign_costs`, `bulk_emails`,
`bulk_email_recipients`, and `leads.campaign_id`.

### Models

- **Campaign** `id, name, channel (email|social|ads|event|referral|other), status (draft|active|paused|completed),
  budget (number|null), currency_code (the company's currency, server-set), starts_on, ends_on (company-local
  YYYY-MM-DD), goal, target_leads (int|null), owner_id, owner_name, source_detail (UTM / source detail), created_at,
  updated_at` + derived `spend` (sum of costs), `leads` (leads with `campaign_id` = it), `won`, `cost_per_lead`
  (spend ÷ leads, null without leads).
- **Campaign cost** `id, campaign_id, incurred_on, amount, description, created_at`.
- **Bulk email** `id, name, campaign_id, campaign_name, message_template_id, subject, body, filters { industries[],
  statuses[], sources[], owner_ids[] } (empty = no filter), status (draft|scheduled|sending|sent|cancelled),
  scheduled_at (UTC), scheduled_local (YYYY-MM-DDTHH:mm in the company timezone), timezone, started_at, sent_at,
  created_by, created_by_name, created_at, updated_at, counts { recipients, queued, sent, skipped, failed, opened,
  replied, open_rate, reply_rate (0–100, one decimal; null before anything was sent), skipped_by { dnc,
  not_interested, no_email, duplicate, limit, removed, cancelled } }`; the detail adds `recipients[] { id, lead_id,
  contact_id, company, name, email, status (queued|sent|skipped|failed), skip_reason, sent_at, opened_at, replied_at }`.

### Endpoints

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/options` | view | — | `currency, timezone, owners[], templates[]` (active email templates), `campaigns[]`, `excluded_statuses[]` |
| `GET /marketing/campaigns` | view | `?status=` | Campaign[] |
| `POST /marketing/campaigns` | full | `name, channel, status?, budget?, starts_on?, ends_on?, goal?, target_leads?, owner_id?, source_detail?` | Campaign · 422 (name missing / taken in the company, bad channel, dates, end before start, owner not an active user of the company) |
| `GET /marketing/campaigns/:id` | view | — | Campaign · 404 |
| `PATCH /marketing/campaigns/:id` | full | any create field | Campaign · 404, 422 |
| `POST /marketing/campaigns/:id/costs` | full | `incurred_on, amount (> 0), description?` | Cost · 404, 422 |
| `GET /marketing/campaigns/:id/results` | view | — | `{ campaign, costs[], emails[], kpis { leads, won, won_value, spend, budget, cost_per_lead, cost_per_won, sent, opened, replied, open_rate, reply_rate, target_leads }, timeline[{ week, leads, won }] }` (weeks start on the company's week start) |
| `GET /marketing/emails` | view | `?status=&campaign_id=` | BulkEmail[] |
| `POST /marketing/emails` | full | `name, campaign_id?, message_template_id?, subject?, body?, filters?` — a template fills subject / body unless given | detail · 422 (unknown campaign / template / owner) |
| `GET /marketing/emails/:id` | view | — | detail (with recipients) · 404 |
| `PATCH /marketing/emails/:id` | full | same as create | detail · 409 once sending / sent / cancelled |
| `DELETE /marketing/emails/:id` | full | — | **cancels** (draft / scheduled → cancelled; sending → remaining queued recipients skipped `cancelled`) · 409 when already sent / cancelled |
| `POST /marketing/emails/:id/preview-audience` | view | `{ filters? }` (an unsaved list; else the saved one) | `{ matched, eligible, excluded { dnc, not_interested, no_email, duplicate }, excluded_statuses, available (emails left this period minus other pending sends; null = unlimited), sample[] }` |
| `POST /marketing/emails/:id/schedule` | full | `{ scheduled_at: "YYYY-MM-DDTHH:mm" }` — wall time in the **company's timezone** (Settings › Company › Regional) | detail (`scheduled`) · 422 (malformed, in the past, > 1 year ahead, no subject / body, unknown `{{variable}}`, no sender address in Branding, nobody eligible), **402 LIMIT_REACHED**, 409 |
| `POST /marketing/emails/:id/send-now` | full | — | detail (`sending`, recipients queued) · same checks as schedule |
| `POST /marketing/emails/:id/test` | full | `{ to }` | `{ to_address, from_address, subject ("[Test] …"), html }` rendered for the first eligible lead with the branded layout (`emailLayout.ts`); counts 1 email · 422, 402 |
| `GET /marketing/reports/cost-per-lead` | view + Reports full / marketing | `?from=&to=` (YYYY-MM-DD) | `{ from, to, currency, rows[{ campaign_id, name, channel, status, leads, won, won_value, spend, cost_per_lead, cost_per_won, sent, opened, replied }], sources[{ source, leads, attributed, won }], totals { leads, attributed, spend, cost_per_lead } }` — leads created and costs incurred in the period, plus a "No campaign" row for unattributed leads · 400, 403 |

Leads: `POST /leads` (full form), `PATCH /leads/:id` and `POST /leads/import/run` (`campaign_id` applies to every
imported row) accept an optional `campaign_id`; it must be a campaign of the company (otherwise 422 "That campaign
doesn’t exist.", the same for a foreign id). Lead rows and details return `campaign_id`.

### Exclusions (enforced server-side, at send time)

A bulk email never goes to: **Do Not Contact** leads; leads in an **excluded status** — the built-in `Not interested`
(system key) and any company-added status of type `lost` (a custom refusal); leads **without a valid email**; and a
**duplicate** address within the same send (lower-cased; the first lead in id order keeps it — the design's
`UNIQUE (bulk_email_id, email)`). The built-in **Lost** status (a lost deal, not an opt-out) is **not** excluded; leave
it out of `filters.statuses` to skip it. The preview counts these; the send resolves the target list again when it
starts (scheduled sends: at their time) and **checks every queued recipient again right before delivery** (lead deleted
→ `removed`, now DNC → `dnc`, now Not interested → `not_interested`, email removed → `no_email`), so a lead changed
after the preview or after queueing is still excluded. Skipped recipients are stored with their reason and shown in the
results.

### Monthly email limit (`emailsPerMonth`)

Policy: **refuse the whole send up front**. Schedule and send-now compare the eligible audience with the emails left
this billing period minus the company's other pending sends (scheduled audiences + queued recipients); if it doesn't fit
→ **402** `{ code: 'LIMIT_REACHED', limit: 'emailsPerMonth', current, max, planId, requested, available }` (the standard
upgrade prompt shows) and nothing is queued. Nothing is ever sent partially in silence: if the allowance shrinks after
the send started (e.g. 1:1 emails), the recipients beyond it are skipped with reason **`limit`**, counted in
`skipped_by.limit` and listed in the results. Every delivered email (and every test email) counts 1.

### Queue and fairness

Sending is a queue worker on the mock clock: one **slot every 5 s** sends at most **100** emails in total, taken
**round-robin across companies, 25 per company per round**, starting from a rotating cursor; within a company FIFO
(queued time, then the send, then the order). A company with a huge queue gets the same share per round as one with a
small one, so it never delays another company. The worker is global (like the real worker), replays everything due up
to "now" lazily on every authenticated request's lifecycle tick (`onLifecycleTick('marketing.queue')`) and on
`POST /dev/billing/advance`, and is idempotent. Each email sent is logged as an activity on the lead (`type: 'email'`,
"Bulk email sent to …: subject", user = the bulk email's creator); bulk sends don't move the lead's stage.

### Simulations (mock only)

Opens and replies are simulated deterministically from a hash of the recipient: about 45 % open 1–30 min after
delivery and about 12 % reply 5–120 min after opening; counts and `opened_at` / `replied_at` appear once the mock clock
passes them. Dev / test hook (read only when `import.meta.env.DEV || MODE === 'test'`):
`window.__apexMarketingEngagement = 'all' | 'none'` forces every delivered email opened and replied (or none).

### Isolation

Every endpoint is in `src/shared/mocks/isolation/endpoints.ts` (company-list / -write / -item / -export with samples);
foreign ids in bodies (lead `campaign_id`, bulk email `campaign_id` / `message_template_id` / `filters.owner_ids`,
campaign `owner_id`) are in `REFS` of `scoped.isolation.test.ts`. Roles per the matrix:
`src/app/isolation/marketing.isolation.test.ts`; rules: `src/shared/mocks/services/marketing.test.ts`. Persisted dev
DB: `VERSION` 7 added the marketing stores.

### Lead generation

Plan module `marketing`; rights from the **Marketing** column (hidden → 403, view → reads, full → writes). Lead
capture forms (the design's `web_form_endpoints`, extended — DB-ALIGNMENT › Design gaps › Marketing (growth)), landing
pages and UTM links. Wire names: `src/shared/api/marketingGrowthMappers.ts`; screens: Marketing › Lead Generation.

- **Form** `id, name, public_key (20 letters, unique across companies), status (active|paused), field_map[{ key, type
  (company_name|contact_name|email|mobile|industry|source_detail|message|custom), label, required }]` (order = display
  order; one of each type, up to 5 `custom`; needs `contact_name` or `company_name`, and a **required** `email` or
  `mobile`), `success_message, redirect_url (http(s) or null), default_owner_ids[] (round-robin; active users with a
  Sales & CRM scope that owns records), default_source_id (an active lead source key), campaign_id, consent_text (empty
  = no checkbox), created_by(_name), created_at, updated_at, owner_names[], campaign_name, stats { views, submissions
  (spam excluded), conversion_rate (submissions ÷ views, %), leads_created, leads_linked, limit_reached, spam, won_deals
  (leads created by the form now in a Won-type status) }`.
- **Submission** `id, form_id, landing_page_id, channel (hosted|embed|landing), submitted_at, name, email, mobile,
  company_name, answers[{ label, value }], consent, outcome (created|linked|limit|spam), lead_id, do_not_contact`.
- **Landing page** `id, slug (lower-case letters, digits, hyphens; unique per company), title, headline, body,
  hero_image_url (http(s) URL, e.g. a Brand Assets file, or null), form_id, form_name, published, views, submissions`.
- **UTM link** `id, name, base_url, utm_source, utm_medium (required), utm_campaign, utm_term, utm_content, campaign_id,
  campaign_name, url (the tagged URL; existing query and #hash kept), created_by(_name), created_at`.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/forms` | view | — | Form[] |
| `POST /marketing/forms` | full | `name, default_source_id, field_map, status?, success_message?, redirect_url?, default_owner_ids?, campaign_id?, consent_text?` | Form · 422 (rules above; another company's owner / campaign = missing) |
| `GET /marketing/forms/:id` | view | — | Form · 404 |
| `PATCH /marketing/forms/:id` | full | any create field | Form · 404, 422 |
| `DELETE /marketing/forms/:id` | full | — | `{ deleted }` · 409 when it has submissions (pause it instead) |
| `GET /marketing/forms/:id/submissions` | view | — | Submission[] (newest first) · 404 |
| `GET /marketing/landing-pages` | view | — | LandingPage[] |
| `POST /marketing/landing-pages` | full | `slug, title, headline?, body?, hero_image_url?, form_id?, published?` | LandingPage · **409 `slug_taken`**, 422 |
| `PATCH /marketing/landing-pages/:id` | full | any create field | LandingPage · 404, 409, 422 |
| `DELETE /marketing/landing-pages/:id` | full | — | `{ deleted }` · 404 |
| `GET /marketing/utm-links` · `POST` · `DELETE /:id` | view · full · full | `base_url, utm_source, utm_medium, utm_campaign?, utm_term?, utm_content?, campaign_id?, name?` (values: letters, digits, `- _ . + ~`) | UtmLink · 422, 404 |
| `GET /public/forms/:key` | **public** | — | `{ public_key, name, fields[] (industry fields carry the company's active industries as options), success_message, redirect_url, consent_text, accepting, closed_reason, organizer_name, country }`; counts one **view** · 404 `form_not_found` |
| `POST /public/forms/:key/submit` | **public** | `{ values: { [field key]: string }, consent?, website? (honeypot), channel? (hosted|embed), landing_page? (slug) }` + `X-Client-Id` | `{ ok, message, redirect_url }` · 404, 409 `form_paused` / `form_closed`, 422 `invalid_submission` / `consent_required`, 429 `rate_limited` |
| `GET /public/pages/:slug` | **public** | company = the workspace the page is opened on (Host; `X-Workspace` / `?workspace=` in the mock) | `{ title, headline, body, hero_image_url, organizer_name, form (public form or null) }`; counts a page view and a form view · 404 `page_not_found` |

**Submit rules** (same lead path as event registration). Unknown key, a company without the Marketing module (plan
or platform override), a deleted workspace or a suspended company → the same **404** (keys can't be probed). Honeypot
`website` filled → a fake success, stored as `spam`, no lead. **Rate limit** like sign-up / event registration
(`services/rateLimit.ts`, shared): 5 per 10 minutes per client (`X-Client-Id`) and per email, per form → 429. Paused →
409 `form_paused`; a suspended / cancelled (read-only) workspace → 409 `form_closed`. Values are validated against the
form (required, email format, **mobile against the company's country**, industry from the company's list); consent text
set → `consent: true` required. Then: an existing lead of the company with the same email (the lead's or a contact's)
→ **linked**, an activity on it, no duplicate — a **Do Not Contact** lead stays Do Not Contact (`do_not_contact: true`
on the submission, "no outreach" in the activity); otherwise a **new lead** (`insertLead`): the form's source and
campaign, source detail = the `source_detail` answer or the form name, owner = the form's owners in turn (by the number
of leads the form created; none → the first active Sales Agent), message / custom answers in its first note; the
plan's **leads + contacts limit** (402 inside) → stored with outcome `limit`, no lead. The visitor's answer is the same
in every case. A `landing_page` slug of the company's page that embeds this form sets `channel: landing`.

Hosted page `/f/:key` (`?embed=1` = the iframe of the embed snippet; it posts `{ apexFormHeight, key }` to the parent
for auto height) and landing pages `/p/:slug` are public routes (no sign-in, exempt in `TenantProvider`).

### Audiences

Saved segments of leads (and their contacts' emails). Marketing view reads (and the live preview), full writes and
exports. **Do Not Contact leads are always excluded** — not a rule, whatever the rules or a frozen list say.

- **Audience** `id, name (unique per company), description, rules { industries[], statuses[], status_types[]
  (open|cold|won|lost), sources[], campaign_ids[], event_ids[] (registered / attended: leads.event_id or an attendee
  row), owner_ids[], created_from, created_to, last_activity_after, last_activity_before (company-local YYYY-MM-DD;
  last activity = latest activity or creation), has_email }` (lists OR within, rules AND across; `statuses` and
  `status_types` are OR-ed together), `kind (dynamic|static), frozen_at, counts { leads, emails (distinct, with
  contacts), excluded_dnc }, created_by(_name), created_at, updated_at`; the detail adds `members[]` (first 50:
  `lead_id, company, name, email, status, owner_name, contacts`).
- **dynamic** = the rules are applied every time; **static** = the lead ids matched when saved / frozen
  (`POST /:id/freeze` re-freezes from the current rules). A frozen member that became Do Not Contact is still left out.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/audiences` | view | — | Audience[] |
| `GET /marketing/audiences/options` | view | — | `{ owners[], campaigns[], events[] }` of the company |
| `POST /marketing/audiences/preview` | view | `{ rules }` | `{ counts, members[] }` (live count of unsaved rules) · 422 |
| `POST /marketing/audiences` | full | `name, description?, rules?, kind?` | detail · 422 (another company's campaign / event / owner = missing) |
| `GET /marketing/audiences/:id` | view | — | detail · 404 |
| `PATCH /marketing/audiences/:id` | full | any create field (static keeps its members when rules change; dynamic → static freezes now) | detail · 404, 422 |
| `DELETE /marketing/audiences/:id` | full | — | `{ deleted }` |
| `POST /marketing/audiences/:id/freeze` | full | — | detail (`static`, new `frozen_at`) |
| `GET /marketing/audiences/:id/export` | full | `?hashed=true&include_contacts=false` | `{ file_name, content (CSV: header email or email_sha256), rows, hashed }` — unique, lower-cased emails of the members (and their contacts unless `include_contacts=false`); hashed = **SHA-256 hex of the trimmed, lower-cased address** (custom-audience upload format) |

**Bulk email:** `filters.audience_id` (optional) on `POST/PATCH /marketing/emails` and `preview-audience` — the send
starts from the audience, the other filters narrow it, and every exclusion rule above still applies. The server
resolves the audience **again** at preview, schedule and send time (a dynamic audience picks up new leads; a deleted
audience leaves nobody → 422 at send). Another company's audience id = missing (422 "That audience doesn’t exist.").

### Website & SEO

No crawling, no Google APIs: pages, tags and positions are entered or imported by the team (the screens say so).

- **Site page** `id, url (https://… or /path; unique per company), title, meta_description, h1, target_keyword,
  page_type (home|service|product|blog|landing|about|contact|other), status (published|draft|needs_update),
  checks[{ key, label, status (pass|warn|fail), detail }], score (0–100), created_at, updated_at`. Checks
  (`modules/marketing/growth/seoChecks.ts`, recomputed for **every** page of the company on any save because duplicates
  span pages): title 30–60 chars (empty fail, outside warn); meta description 70–160 (empty fail, outside warn); H1
  present (fail) and ≠ title (warn); target keyword set (warn) and found in title / H1 / meta / URL slug (warn each);
  readable slug (lower case, hyphens, no query, no long ids, no extension, ≤ 4 folders, ≤ 75 chars; warn); duplicate
  title / meta description across the company's pages (fail). Score: pass 1, warning ½, fail 0, equal weights.
- **Keyword** `id, keyword (lower-cased; unique per company + country), target_url, search_volume, difficulty (0–100),
  country (ISO-2; default the company's), positions[{ date, position (1–1000, one decimal; null = not ranking) }],
  current_position, previous_position, change (previous − current; positive = up), best_position`.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/seo/pages` | view | — | `{ pages[] (worst score first), summary { pages, average_score, pages_with_issues, failing, warnings, by_check[{ key, label, fail, warn }] } }` |
| `POST /marketing/seo/pages` · `PATCH /:id` · `DELETE /:id` | full | page fields | SitePage (checks computed) · 404, 422 |
| `GET /marketing/seo/keywords` | view | — | Keyword[] |
| `POST /marketing/seo/keywords` · `PATCH /:id` · `DELETE /:id` | full | `keyword, target_url?, search_volume?, difficulty?, country?` | Keyword · 404, 422 |
| `POST /marketing/seo/keywords/:id/positions` | full | `{ date (≤ today, company time), position }` — the same date replaces | Keyword · 404, 422 |
| `POST /marketing/seo/keywords/import` | full | `{ rows[{ row, keyword, date, position }], file_name }` (≤ 5,000; the client parses a `keyword,date,position` CSV — header optional, Search Console names accepted) | `{ imported, keywords_created, failed[{ row, keyword, reason }] }` — unknown keywords are added |
| `GET /marketing/seo/website-leads` | view | `?from=&to=` (YYYY-MM-DD) | `{ from, to, total, months[{ month, forms, landing, website_source, total }], by_source[{ kind (form|landing|website_source), id, name, leads, won }], leads[] (latest 100) }` — leads created in the period through a form / landing page (the submission that created them) or with the company's Website source; each lead once · 400 |

### Isolation (growth)

Every endpoint is in `src/shared/mocks/isolation/growthEndpoints.ts` (spread into the coverage table; the three public
endpoints carry a `reason`). Roles per the matrix, foreign ids inside bodies (form owners / campaign, landing page form,
UTM campaign, audience rules, bulk email `filters.audience_id`) and the public endpoints:
`src/app/isolation/marketingGrowth.isolation.test.ts`; rules: `src/shared/mocks/services/{leadGen,audiences,seo}.test.ts`.
Form field keys are `key` (not `id`), so a form's field names never look like record ids. Persisted dev DB: `VERSION` 9
added the growth stores. Client state: none beyond the shared `apexcrm.client-id` (rate-limit id, already allowed).

### Content calendar

Plan module `marketing`; rights from the **Marketing** column (hidden → 403, view → reads, full → writes and
comments). Tables (not in the design yet, see `docs/DB-ALIGNMENT.md` › Design gaps › Marketing (creative)):
`content_items`, comments / history as rows of the design's polymorphic `comments` / `audit_logs`. Wire names:
`src/shared/api/creativeMappers.ts` (mechanical snake_case).

**Content item** `id, title, type (social_post|blog_post|newsletter|video|case_study|press_release|other), channels[]
(linkedin|instagram|facebook|x|tiktok|youtube|blog|email|website), status (idea|draft|in_review|approved|scheduled|
published|archived), owner_id, owner_name, reviewer_id, reviewer_name, approved_by, approved_by_name, approved_at,
publish_at (UTC), publish_local ("YYYY-MM-DDTHH:mm" in the company timezone), timezone, campaign_id, campaign_name,
body, notes, asset_ids[], assets[{ id, name, kind, url }], published_url, published_at, created_by, created_at,
updated_at, overdue (scheduled and publish_at passed), can_approve, comments[{ id, author_id, author_name, body,
mentions[], at }], history[{ id, user_id, user_name, summary, at }]`.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/content` | view | `?status=&type=&channel=&campaign_id=&owner_id=&from=&to=` (company-local publish days) | ContentItem[] (by publish time) |
| `POST /marketing/content` | full | `title, type, channels[] (≥ 1), status? (idea·draft·in_review; default idea), owner_id?, reviewer_id?, publish_at? ("YYYY-MM-DDTHH:mm" company wall time), campaign_id?, body?, notes?, asset_ids?` | ContentItem · 422 (missing title / type / channel, bad time, > 2 years ahead, unknown owner, reviewer without Marketing full, unknown campaign / asset — another company's id answers exactly like a missing one) |
| `GET /marketing/content/:id` | view | — | ContentItem · 404 |
| `PATCH /marketing/content/:id` | full | any create field except status | ContentItem · 404, 422 (a scheduled item's `publish_at` must stay in the future), 409 (published: only notes / assets / campaign; archived: only notes) |
| `POST /marketing/content/:id/status` | full | `{ status, publish_at?, published_url? }` | ContentItem · 404, 403 (approving your own item), 409 (move not allowed from the current status), 422 (no / past publish time, missing or non-http(s) URL) |
| `POST /marketing/content/:id/comments` | full | `{ body }` (`@Full Name` mentions) | ContentItem · 404, 422 |

Rules (`services/contentCalendar.ts`):
- **Approval**: only a marketing `full` role approves, and only an item `in_review`. **The owner can't approve their own
  item unless they are a Company Admin** (four-eyes rule; a Company Admin may need to unblock a one-person team). The
  reviewer is a suggestion: they get a notification when the item goes to review, but any other `full` role may
  approve. The owner is notified on approval.
- **Scheduling**: `scheduled` needs the item `approved` and a `publish_at` in the future (wall time in the company's
  timezone, Settings › Company › Regional; stored as UTC). `scheduled → approved` unschedules.
- **Publishing** is marked by hand with the live link (`published_url`, http/https); no social network API is called.
  A published item only moves to `archived`; `archived` returns as `idea` or `draft`.
- Changing title / type / channels / copy of an `approved` or `scheduled` item sends it back to `in_review` and clears
  the approval. Moving back to idea / draft / in review clears it too.
- **Reminders** (stored, once; `services/creativeReminders.ts`, the task-reminder pattern): the owner gets
  `marketing-due` **24 h before** `publish_at` of a scheduled item (`content_items.reminder_sent_at`) and
  `marketing-overdue` once it is past and still not published (`overdue_notified_at`). Changing `publish_at` re-arms
  both. The tick runs lazily per company on `GET /alerts` and the creative list / item GETs.
- Comments: `full` roles; mentions notify only people who can see Marketing.

### Design requests

Plan module `marketing` (every `/marketing/*` path answers 403 `module_not_in_plan` without it — also for people who
only request designs; the screen shows the upgrade state). **Rights are not the Marketing column alone**
(`services/designRequests.ts`):

| Who | Sees | Can |
|---|---|---|
| any active user of the company | the requests **they made** and the ones **assigned to them** | create a request; edit their brief while `requested` / `changes_requested`; comment and attach files on their requests; approve / request changes when it's `in_review`; cancel it |
| the assignee (designer, any role) | what is assigned to them | comment, attach files, move it `in_progress` → `in_review`, and `approved` → `delivered` |
| Marketing `view` (Sales Manager) | every request | read only (writes 403) |
| Marketing `full` (Company Admin, Management, Marketing Manager) | every request | everything: assign (`assignee_id`), edit, any allowed status move, save to Brand assets |

A request the caller can't see answers **404, exactly like a missing (or another company's) id**. Only `full` roles
set `assignee_id` (403 otherwise); `campaign_id`, `content_item_id` and `asset_ids` are Marketing data, unknown (422)
to roles without Marketing view.

**Design request** `id, title, type (social_post|banner|brochure|presentation|video|logo|other), brief, formats[],
due_date (company-local), priority (low|medium|high|urgent), status (requested|in_progress|in_review|
changes_requested|approved|delivered|cancelled), requester_id, requester_name, assignee_id, assignee_name,
campaign_id, campaign_name, content_item_id, content_item_title, asset_ids[], assets[], attachments[{ id, name,
mime_type, size_bytes, url (image preview or null), uploaded_by, uploaded_by_name, uploaded_at }], delivered_at,
saved_asset_ids[], created_at, updated_at, overdue, can_manage, can_edit, can_comment, next_statuses[], comments[],
history[]`.

Status flow (managers: any listed move; others: their subset above): requested → in_progress | cancelled;
in_progress → in_review | cancelled; in_review → approved | changes_requested | in_progress | cancelled;
changes_requested → in_progress | in_review | cancelled; approved → delivered | changes_requested | cancelled;
cancelled → requested; delivered is final. `in_progress` / `in_review` need an assignee; `delivered` needs a file.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/design-requests/options` | any | — | `{ can_view_all, can_manage, timezone, designers[] (managers only), campaigns[], content_items[] (Marketing view only) }` |
| `GET /marketing/design-requests` | any (scoped as above) | `?status=&assignee_id=&mine=1` | DesignRequest[] (by due date) |
| `POST /marketing/design-requests` | any | `title, type, brief, formats[]?, due_date?, priority?, assignee_id? (full), campaign_id?, content_item_id?, asset_ids? (view)` | DesignRequest · 403 (assigning without full), 422. Unassigned → the Marketing `full` users are notified; assigned → the assignee |
| `GET /marketing/design-requests/:id` | who sees it | — | DesignRequest · 404 |
| `PATCH /marketing/design-requests/:id` | requester (open) / full | any create field | DesignRequest · 404, 403. A due-date change re-arms the reminders |
| `POST /marketing/design-requests/:id/status` | per table | `{ status, note? }` | DesignRequest · 404, 403, 409 (not a valid move), 422 (no assignee / no file) |
| `POST /marketing/design-requests/:id/comments` | requester, assignee, full | `{ body }` | DesignRequest · 404, 403, 422. `@mentions` notify only people who can see the request |
| `POST /marketing/design-requests/:id/attachments` | requester, assignee, full | `{ name, mime_type, size_bytes, data_url? }` | DesignRequest · 404, 403, 409 (cancelled), 422 (type / size: `assetRules.ts`), **402 LIMIT_REACHED `storageMb`** |
| `DELETE /marketing/design-requests/:id/attachments/:attachmentId` | uploader or full | — | DesignRequest · 404, 403 |
| `POST /marketing/design-requests/:id/save-to-assets` | full | `{ attachment_id? (default newest), name?, kind?, tags? }` | BrandAsset (`source: design_request`) · 403, 409 (not delivered / already saved), 422 |

Attachments are metadata (mime type, size; a data-URL preview for images ≤ 1 MB) and count against the plan's
`storageMb` like task attachments. A file saved to Brand assets is the same stored file (counted once). Reminders
(stored, once): `marketing-due` to the assignee and the requester from 1 day before the due date (company calendar),
`marketing-overdue` from the day after, while the request is open (`reminder_sent_at`, `overdue_notified_at`).

Entry points: Marketing › Design Requests (nav, Marketing view roles); for everyone, **New › New design request** in
the top bar and **My design requests** in the user menu. The route `/marketing/design-requests` is plan-gated only
(`ModuleGate`), not role-gated.

### Brand assets

Plan module `marketing`; Marketing column (view → reads, full → writes). **Brand asset** `id, name, kind (logo|image|
video|document|template|font|other), mime_type, size_bytes, url (data-URL preview for images ≤ 1 MB, else null),
tags[], campaign_id, campaign_name, source (upload|design_request|system), design_request_id, description,
usage_rights_expires_at (company-local date), status (active|archived), system, expiring_soon (≤ 30 days), expired,
created_by, created_by_name, created_at, updated_at`.

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/assets` | view | `?kind=&tag=&campaign_id=&status=&expiring=1` | BrandAsset[] (system assets first) |
| `POST /marketing/assets` | full | `name, kind, mime_type, size_bytes, data_url?, tags[]?, campaign_id?, description?, usage_rights_expires_at?` | BrandAsset · 422 (type not allowed for the kind, over the kind's size limit, preview content ≠ declared type or size, unsafe SVG, tags, dates, unknown campaign), **402 LIMIT_REACHED `storageMb`** |
| `GET /marketing/assets/:id` | view | — | BrandAsset · 404 |
| `PATCH /marketing/assets/:id` | full | metadata fields + `status` (the file itself can't be replaced) | BrandAsset · 404, 409 (system asset), 422. A new expiry date re-arms the alert |
| `DELETE /marketing/assets/:id` | full | — | `{ id, deleted }` · 404, 409 (system asset). Frees storage; unlinks it from content items and design requests |

Upload rules are one module shared by the upload form and the API (`modules/marketing/creative/assetRules.ts`): per
kind MIME lists and limits (logo 5 MB, image 20 MB, video 200 MB, document 25 MB, template 50 MB, font 5 MB); image
previews are checked like Settings › Branding logos (`modules/settings/branding.ts`: magic bytes, safe SVG).
**System assets**: the company's branding images (Settings › Branding light / dark logo, favicon) are listed read-only
with ids `SYS-logo-light`, `SYS-logo-dark`, `SYS-favicon` (computed, not stored, never counted in storage). **Usage
rights**: `expiring_soon` within 30 days; one stored `marketing` alert to the creator (`expiry_notified_at`).

### Isolation (creative)

Every endpoint above is in the coverage table (`src/shared/mocks/isolation/creativeEndpoints.ts`, spread into
`endpoints.ts`) with samples; foreign ids in bodies (content campaign / owner / reviewer / assets, design assignee /
campaign / content item / assets, asset campaign) behave like missing ones
(`services/marketingCreative.test.ts`). Roles from the matrix, including requester / assignee rights for all nine
roles: `src/app/isolation/marketingCreative.isolation.test.ts`. Persisted dev DB: `VERSION` 11 added the creative
stores. New stored notification types `marketing-due`, `marketing-overdue`, `marketing` (bell group "Marketing").

### Ads integrations

Screen: Marketing › Ads Integrations (`/marketing/ads`). Service `src/shared/mocks/services/ads.ts`, handlers
`handlers/ads.ts`, wire names `src/shared/api/adsMappers.ts`. Providers `meta | google | linkedin | tiktok`; lead ads
(lead forms → leads) for `meta` and `linkedin`.

**Access.** Plan module `marketing` (central gate). Marketing column: `view` reads (connections list and detail);
`full` (Company Admin, Management, Marketing Manager) also lists ad accounts, connects, syncs, disconnects and maps.
Listing ad accounts, connecting, syncing and disconnecting also need the plan module **`integrations`** (403
`module_not_in_plan`, `{ module: 'integrations', planId }`); without it the list / detail still answer (synced history
stays readable), mapping still works (CRM data only) and the daily sync is paused. The screen shows an upgrade card
for connecting in that case.

**Models.**
- **Ad connection** `id, provider, account_id, account_name, currency_code, status (connected|error|disconnected),
  token_hint ("•••• 4f2a" | null after disconnect), connected_by, connected_by_name, connected_at, disconnected_at,
  last_synced_at, last_sync_status (success|error|null), last_error, synced_through (last company-local day imported),
  lead_ads, campaigns, mapped, last30 { spend, impressions, clicks, conversions, leads, ctr (%), cpc }, pending_leads`.
  The access token is stored server-side only (never in any response; the secrets guard flags `adtok_…` anywhere).
  The detail adds `ad_campaigns[] { id, connection_id, external_id, name, objective (leads|traffic|conversions|awareness),
  status, campaign_id, campaign_name, mapped_at, totals {…last 30 days}, cost_entries }`, `runs[]` (last 20, newest first:
  `id, trigger (initial|daily|manual), status, started_at, finished_at, rows, costs, leads_created, leads_duplicate,
  leads_skipped, leads_pending, error`), `submissions[]` (last 50: `id, ad_campaign_id, ad_campaign_name, submitted_at,
  name, email, company_name, outcome (created|duplicate|limit|pending_source), lead_id, campaign_id, message`) and
  `daily[] { date, spend, clicks, impressions, leads }` (last 30 synced days).

| Method & path | Roles | Body / query | Answer · errors |
|---|---|---|---|
| `GET /marketing/ads/connections` | view | — | AdConnection[] (live first, then disconnected) |
| `GET /marketing/ads/providers/:provider/accounts` | full + `integrations` | — | `[{ account_id, name, currency_code, connected }]`: the ad accounts the (simulated) authorizing login can see · 403, 404 unknown provider |
| `POST /marketing/ads/connections` | full + `integrations` | `provider, account_id, consent: true` | AdConnectionDetail after the initial sync · 422 (bad provider, no consent, account not available to this login — another company's account answers the same), 409 already connected, 403 |
| `GET /marketing/ads/connections/:id` | view | — | AdConnectionDetail · 404 |
| `DELETE /marketing/ads/connections/:id` | full + `integrations` | — | AdConnectionDetail (`disconnected`, token deleted) · 409 already disconnected, 404, 403 |
| `POST /marketing/ads/connections/:id/sync` | full + `integrations` | — | AdConnectionDetail with the new run first ("Sync now" / retry) · 409 disconnected, 404, 403 |
| `PATCH /marketing/ads/campaigns/:id` | full | `campaign_id` (string \| null) | AdCampaign · 422 unknown campaign (another company's = missing), 404, 403 |

**Mock OAuth.** "Connect" lists three ad accounts per provider (ids derived from the company: `act_…`, `123-456-7890`,
`5…`, `7…`), the user picks one and consents; the server stores a token and answers the masked hint. Reconnecting a
disconnected account reactivates the same connection (history kept, no duplicates).

**Sync.** Complete company-local days only (up to yesterday). The first sync imports `BACKFILL_DAYS` = 30 days; later
syncs import the days after `synced_through` (catch-up capped at 30 days). The daily sync rides on the company's lazy
lifecycle tick (every authenticated request, Dev › advance clock — `onLifecycleTick('marketing.ads')`), once per new day
per live connection, only for the ticked company. Simulated stats per ad campaign and day (spend, impressions, clicks,
conversions, lead-form leads) are deterministic (FNV hash of the ad campaign id and date). About one run in ten fails
(simulated provider timeout): nothing is imported, the run is logged with `error`, the connection shows `error`, the
daily tick retries after an hour of mock-clock time and "Sync now" retries at once. Dev / test hook (read only when
`import.meta.env.DEV || MODE === 'test'`): `window.__apexAdsSync = 'ok' | 'fail'`.

**Costs (idempotent).** A mapped ad campaign's synced spend becomes `campaign_costs` rows on its CRM campaign: one row
per ad campaign per day with spend, keyed `ad_campaign_id|date` in the cost-link table, so syncing again, re-mapping
or remapping never creates a second row for a day. Mapping backfills every synced day not costed yet. Unmapping stops
new rows; rows already created stay on the campaign they were created for (history). Disconnecting keeps stats, costs
and mappings. So campaign `spend`, `cost_per_lead` and analytics use the real ad spend.

**Lead ads → leads.** Meta / LinkedIn lead-form submissions made after the connection (`leads_from` = connect time;
seeded connections: seed time) arrive with the sync (or the provider webhook, simulated by `receiveLeadWebhook`) and go
through the normal lead creation path (`insertLead`): source = the company's active source matching the provider
(Meta: "Paid ads", "Meta Ads", "Meta", "Facebook", "Instagram", "Social media"…; LinkedIn: "LinkedIn Ads", "LinkedIn",
"Paid ads"), source detail = `<Provider>: <ad campaign>`, `campaign_id` = the ad campaign's mapping, owner =
auto-assignment (least-loaded Sales Agent), `created_at` = the submission time. Duplicates (same email / company /
domain in the company) link to the existing lead with an activity (`duplicate`). The plan's leads + contacts limit
(`LIMIT_REACHED`) → `limit`, no lead. No matching source → `pending_source` with a clear message (no silent creation);
waiting submissions are retried on every sync. The webhook routes by connection (provider + ad account of a live
connection), never by a company field of the payload: a lead for company A's account can't land in company B.

**Seed.** Apex: Meta and Google connected (lead-form / search campaigns mapped to "Q4 LinkedIn outreach"); Apex has no
"Paid ads" source, so Meta lead forms wait for one. Crest: LinkedIn connected (mapped to "LinkedIn sponsored content Q4").

### Marketing analytics

Screen: Marketing › Marketing Analytics (`/marketing/analytics`); the old `/marketing/reports` URL redirects there
(the old cost-per-lead page is absorbed; `GET /marketing/reports/cost-per-lead` stays for compatibility). Service
`src/shared/mocks/services/marketingAnalytics.ts`.

| Method & path | Roles | Query | Answer · errors |
|---|---|---|---|
| `GET /marketing/analytics` | Marketing view + Reports `full` / `marketing` | `preset` (this_month \| last_30_days \| this_quarter \| ytd \| custom; default this_month), `from`, `to` (custom, YYYY-MM-DD, ≤ 2 years), `compare` (default true) | MarketingAnalytics · 400 bad preset / range, 403 |

Everything is the caller's company; dates are company-local (timezone), presets are resolved on the server from the
mock clock and end today. The previous period is the same number of days right before `from`. Answer: `preset, from,
to, days, previous { from, to } | null, currency, timezone, kpis, previous_kpis, bucket (day ≤ 45 days | week ≤ 200 |
month), timeline[{ start, leads, spend }], by_source[{ source, label, leads, attributed, won }], by_channel[{ channel |
'none', leads, spend, won }], funnel[{ key, label, count, rate }], campaigns[{ campaign_id, name, channel, status,
spend, leads, cost_per_lead, won, won_value, cost_per_won, roi, sent, opened, replied }], email { sent, opened,
replied, open_rate, reply_rate, sends[] }, events { included, attendees, leads, won, rows[] }, ads { providers[{
provider, spend, impressions, clicks, conversions, leads, ctr, cpc }], totals }, content { published, scheduled,
by_type[] }, forms { submissions, leads_created, linked, rows[] }`.

Definitions: **spend** = `campaign_costs` incurred in the period (manual + synced ad spend); **leads** = leads created
in the period (the cohort), `attributed_leads` = with a campaign; **won / won value** = cohort leads whose status type is
`won` now; **cost per lead** = spend ÷ attributed leads; **ROI** = (won value of attributed won leads − spend) ÷ spend,
in % (null without spend); **conversion rate** = won ÷ leads, in %. **Funnel**: the furthest stage each cohort lead
reached, from `lead_status_history` and its current status (type `won` → Won; Proposal, Meeting, Interested by key;
Contacted / No response / Call later → Contacted; anything else → New). **Email**: bulk email recipients sent in the
period (opens / replies visible by now). **Events** (plan module `events`): events starting in the period, not cancelled
— attendees, distinct linked leads, of which won. **Ads**: synced daily stats in the period per provider (disconnected
accounts keep their history). **Content**: Content Calendar items published (`published_at`) / scheduled (`publish_at`)
in the period. **Forms**: Lead Generation form submissions in the period, spam excluded. Excel export (one sheet per
table) and Print / PDF are client-side.

**Isolation (ads and analytics).** Every endpoint is in `endpoints.ts` (module `marketing/ads`, `marketing/analytics`);
foreign ids in bodies (`campaign_id` of a mapping, `account_id` of a connect) are in `REFS`. Roles per the matrix (and
the `integrations` gate): `src/app/isolation/marketingAds.isolation.test.ts`; rules:
`src/shared/mocks/services/ads.test.ts`, `marketingAnalytics.test.ts` (numbers recomputed from the raw tables in both
companies); masked tokens: `secrets.isolation.test.ts`. Persisted dev DB: `VERSION` 10 added the ads stores.

## HR

Plan module `hr` (Enterprise; another plan through a platform module override): every `/hr/*` path answers
`403 module_not_in_plan` without it (central request policy). Roles follow the `hr` column of `PERMISSION_MATRIX`:
**full** (Company Admin, Management, HR Manager), **team** (Department Head: the departments they head and their
sub-departments, plus direct reports), **own** (Employee), **hidden** (everyone else: `403` on every HR endpoint).
Employees are `EMP-<userId>` / `EMP-X<n>` (`src/modules/hr/types.ts`). Snake_case on the wire
(`src/shared/api/hrTalentMappers.ts`); error envelopes are not mapped (`{ message, code, …details }`).

### Employees

The HR record of a person (with or without a login). Services: `src/shared/mocks/services/hrEmployees.ts` (scope in
`hrAccess.ts`), stores `src/shared/mocks/data/hrEmployees.ts` (core) + `hrPeople.ts` (profiles, documents, contracts,
assets, activity); wire `src/shared/api/hrMappers.ts` (plain snake_case at any depth). Only **full** writes; **team** and
**own** read. A record outside the caller's scope (or of another company) answers `404 Not found.`

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/employees` | full / team / own | — | rows: `id, user_id, employee_no, full_name, job_title, department_id, department_name, manager_id, manager_name, email, mobile, nationality, gender, date_of_birth, hire_date, employment_type, status, exit_date, has_login, doc_alert (expiring\|expired\|null), doc_alert_count`. Runs the HR reminder tick first. |
| GET | `/hr/employees/export` | full | — | rows for CSV / Excel: `employee_no, full_name, job_title, department, manager, nationality, hire_date, status, employment_type, email, mobile, documents` (document **state** only: never numbers, bank or pay) |
| POST | `/hr/employees` | full | `full_name*, job_title*, hire_date*, department_id, manager_id (employee id), email, mobile, nationality (ISO-2), gender, date_of_birth, employment_type, status, exit_date, user_id, emergency_contact {name, relation, phone}, address {line1, city, country}, bank {bank_name, account_name, iban}` | the detail. **No login is created.** `422` invalid / duplicate email in the company / `status` notice or terminated without `exit_date`; foreign `department_id` / `manager_id` → `422` like a missing one; foreign `user_id` → `404` |
| GET | `/hr/employees/:id` | in scope | — | row + `emergency_contact, address, bank {bank_name, account_name, iban_masked}` (null for team viewers), `documents[]`, `contracts[]`, `assets[]` (held now), `activity[]`, `offboarding {started_at, completed_at, steps[{key: assets\|login\|settlement, label, done, detail, blocking}], can_complete}`, `linked_user {id, name, email, role, active}`, `access`, `can_manage` |
| PATCH | `/hr/employees/:id` | full | any field of the create (except `user_id`); `bank.iban` omitted = keep, `''` = remove | the detail. Status `notice` / `terminated` (with `exit_date`) starts the offboarding; back to active clears an unfinished one |
| POST | `/hr/employees/:id/reveal` | full | `{ field: 'iban' }` | `{ field, value }` — the full IBAN, audited (activity + audit log) |
| GET | `/hr/users/unlinked` | full | — | active users of the company no employee links (`id, name, email, role`) |
| POST | `/hr/employees/:id/link-user` | full | `{ user_id }` or `{ user_id: null }` | the detail. `422` when the user is linked to another employee; foreign / missing user → `404` |
| POST | `/hr/employees/:id/offboarding/complete` | full | — | the detail (status `terminated`). `422` while assets are still assigned (message lists the tags) or no offboarding is running |
| POST | `/hr/employees/:id/documents` | full | `type* (passport · residence_visa · emirates_id · iqama · labour_card · work_permit · medical_insurance · driving_license · other), number*, issue_date, expiry_date, issuing_country, notes, file {name, size_bytes, mime_type, url}` | the document: `id, employee_id, type, number_masked ("•••• 1234"), issue_date, expiry_date, issuing_country, file, notes, status (valid\|expiring\|expired), days_to_expiry` |
| PATCH | `/hr/documents/:id` | full | same fields; `number` omitted / blank = keep | the document. A new `expiry_date` re-arms its reminders |
| DELETE | `/hr/documents/:id` | full | — | `{ id }` |
| POST | `/hr/documents/:id/reveal` | full | — | `{ id, number }` — the full number, audited |

**Sensitive values.** Document numbers and the IBAN are stored in full and **served masked to everyone** (last 4,
`number_masked`, `bank.iban_masked`); only HR full can reveal one (the POST endpoints above, audited). No list,
detail or export carries them in full (`hrPeople.test.ts` sweeps every HR GET for every role). Files are mocked
uploads (metadata + a small data URL) counted against the plan's `storageMb` (`402 LIMIT_REACHED` when full).

**Document status and alerts.** Status uses the company's calendar day (regional timezone, mock clock): `expired`
past the expiry date, `expiring` within 60 days, else `valid`. Stored notifications (type `hr-people`, bell group
**HR**) go to every active HR-full user and the employee's manager: once 60 days before the expiry date and once on
/ after it, keyed by threshold **and date** (`alert_marks`), so a changed expiry date re-arms them. Runs lazily on the
company's lifecycle tick (every authenticated request) and before the HR reads; only with the `hr` module.

### Employee contracts

Services: `src/shared/mocks/services/hrContracts.ts`. History is kept; one `active` contract per employee.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/contracts` | full / team / own | `type, status, ending_within (days), employee_id` | contracts of the employees in scope: `id, employee_id, employee_name, employee_no, type (unlimited · limited · part_time · internship · consultancy), start_date, end_date, probation_months, probation_end_date, notice_days, hours_per_week, salary_visible, basic_salary, housing_allowance, transport_allowance, other_allowance, total_salary, currency, status (draft · active · ended · terminated · renewed), signed_date, file, notes, renewed_from_id, renewed_to_id, in_probation, days_to_end` |
| GET | `/hr/contracts/:id` | in scope | — | the contract |
| POST | `/hr/contracts` | full | `employee_id*, type*, start_date*, end_date (required for limited), probation_months (0–6), notice_days, hours_per_week, basic_salary, housing_allowance, transport_allowance, other_allowance, currency, status (draft\|active), signed_date, file, notes` | the contract. `422` second active contract / limited without end / end before start; foreign `employee_id` → `404` |
| PATCH | `/hr/contracts/:id` | full | same fields; `status`: draft → active, active → ended \| terminated | the contract |
| POST | `/hr/contracts/:id/renew` | full | optional overrides of the terms (`start_date` default = old end + 1 day; `end_date` default = same length) | the new **active** contract (`renewed_from_id`); the old one (active or ended) becomes `renewed`. `422` otherwise |

**Pay** (basic + allowances, total) is visible to HR full and to the employee themself; team viewers get
`salary_visible: false` and `null` amounts (the screens show "•••"). **Reminders** (`hr-people`, HR full + the
manager, once per contract and date): probation ending within 14 days; contract end within 60 and within 30 days.
Active contracts past their end date become `ended` on the tick.

### Company assets

Services: `src/shared/mocks/services/hrAssets.ts`. HR full manages the register; team / own see the assets their
people hold now (and only those hand-overs in the history).

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/assets` | full / team / own | `status, category, employee_id` | rows: `id, tag, name, category (laptop · phone · tablet · vehicle · sim · access_card · furniture · other), brand, model, serial, purchase_date, cost, currency, condition (new · good · fair · poor · damaged), status (in_stock · assigned · in_repair · retired · lost), warranty_end, assigned_to_id, assigned_to_name, assigned_date, notes` |
| GET | `/hr/assets/:id` | in scope | — | row + `history[] {id, employee_id, employee_name, assigned_date, assigned_condition, handover_note, returned_date, returned_condition, return_note, lost}`, `can_manage` |
| POST | `/hr/assets` | full | `tag*, name*, category*, brand, model, serial, purchase_date, cost, currency, condition, status (in_stock\|in_repair\|retired), warranty_end, notes` | the row. `422` tag already used **in the company** (another company may use it) |
| PATCH | `/hr/assets/:id` | full | same fields (status not while assigned) | the detail |
| POST | `/hr/assets/:id/assign` | full | `employee_id*, date, condition, note` | the detail (`assigned`). `422` not in stock / employee has left; foreign employee → `404` |
| POST | `/hr/assets/:id/return` | full | `date, condition, note` | the detail (`in_stock`, or `in_repair` when returned damaged) |
| POST | `/hr/assets/:id/lost` | full | `note*` | the detail (`lost`; closes the open assignment) |

**Offboarding** completes only when the employee holds no asset (returned, or marked lost with a note). **Warranty**
reminder (`hr-people`, HR full): once, 30 days before `warranty_end` (re-armed when it changes).

**Isolation (employees, contracts, assets).** Every endpoint is in the coverage table
(`src/shared/mocks/isolation/hrPeopleEndpoints.ts`, spread into `endpoints.ts`; the samples turn `hr` on for Crest
with a platform module override so both directions run on real answers). Foreign ids in bodies / queries
(`employee_id`, `manager_id`, `department_id`, `user_id`) behave like missing ones and spoofed company fields are
ignored: `src/app/isolation/hrPeople.isolation.test.ts`, which also checks every role of the matrix (full / team /
own / hidden) and the plan gate. Rules, masking, alerts: `src/shared/mocks/services/hrPeople.test.ts`. Persisted dev
DB: `VERSION` 17 added the stores. Shared entry point for other sections: `createEmployee(companyId, input, actor)`
(`services/hrEmployees.ts`), used by Recruitment's hire.

### Recruitment

Openings (job requisitions), candidates, applications (one candidate may apply to several openings), interviews with
per-interviewer scorecards, offers. Services: `src/shared/mocks/services/hrRecruitment.ts`.

**Who sees what.** HR full: everything. Department Head: openings of their departments, or where they are the hiring
manager / requester (`404` otherwise), the candidates applying to those, interviews of those openings; may **request**
openings for their own departments (`draft` → `pending_approval`; HR approves). Employee: no openings / candidates
(`403` on the lists, `404` on items) — only `GET /my-interviews`. **Salary range and offers**: HR full + the opening's
hiring manager (`salary_min`/`salary_max`/`salary_currency` null and `salary_visible: false` for anyone else; offers
omitted). **Scorecards**: HR full and the hiring manager see all; anyone else sees their own only. Stage moves,
candidates, interviews and offers are HR full writes (`403` for others); a scorecard is written by its interviewer only.

| Endpoint | Roles | Body / query | Notes |
|---|---|---|---|
| `GET /hr/recruitment/options` | any HR | — | departments (team: headed ones), `people` (active users whose role sees HR: hiring managers / interviewers), `currency`, `manage`, `default_criteria` |
| `GET /hr/recruitment/openings` | full, team | — | `stage_counts`, `hired_count`, `remaining` (= headcount − hired), `salary_visible` |
| `POST /hr/recruitment/openings` | full, team | `title, department_id, hiring_manager_id?` (default caller), `headcount, employment_type, location, salary_min?, salary_max?, salary_currency?, description, requirements, criteria[]?, status?` | full: `draft` / `pending_approval` / `open`; team: `draft` / `pending_approval`, own departments only (422) |
| `GET /hr/recruitment/openings/:id` | full, team | — | + `applications`, `interviews`, `offers` (salary-visible only), `can { edit, approve, manage_candidates, move_stages, make_offers }` |
| `PATCH /hr/recruitment/openings/:id` | full (not closed), team (draft / pending) | as POST | headcount can't go below hired (422) |
| `POST /hr/recruitment/openings/:id/status` | full; team: draft → pending_approval, own pending → draft | `{ status }` | flow: draft → pending_approval / open / closed; pending_approval → open (approve: `approved_by/at`) / draft / closed; open ⇄ on_hold; → closed; filled → open (needs a free position, else `409 opening_filled`) / closed. Other moves `409 invalid_transition` |
| `GET /hr/recruitment/candidates` | full (all), team (of visible openings) | — | `applications[]` limited to what the caller sees |
| `POST /hr/recruitment/candidates` | full | `full_name, email?, mobile?` (one of them), `current_company, current_title, source` (`referral, linkedin, job_board, website, agency, other`), `notes, tags[], opening_id?` | mobile: the company country's rules or the international form (+ country code) → stored `+<digits>`. **Duplicate** email (case-insensitive) or mobile (digits) **in the caller's company** → `409 duplicate_candidate` `{ candidateId, matchedOn }`. With `opening_id` (must be `open`, `409 opening_not_open`) the application is created |
| `GET /hr/recruitment/candidates/check?email&mobile&exclude` | full | — | `{ matches: [{ id, full_name, email, mobile, matched_on }] }`, caller's company only |
| `GET /hr/recruitment/candidates/:id` | full, team | — | + `interviews`, `offers` (visibility as above) |
| `PATCH /hr/recruitment/candidates/:id` | full | as POST | duplicate rule applies |
| `POST /hr/recruitment/candidates/:id/cv` | full | `{ name, size_bytes, mime_type }` (PDF / Word, ≤ 10 MB) | metadata only; the size counts against `storageMb` (`402 LIMIT_REACHED`); replaces the previous CV |
| `POST /hr/recruitment/applications` | full | `{ candidate_id, opening_id }` | opening `open`; same pair twice `409 duplicate_application` |
| `POST /hr/recruitment/applications/:id/stage` | full | `{ stage, reason? }` | `applied → screening → interview → assessment → offer`, `rejected` (reason required), `withdrawn`. Hired only by accepting an offer; hired is final; `offer` only from interview / assessment; leaving `offer` with a sent offer refused; on a filled / closed opening only reject / withdraw. Refusals `409 invalid_stage_move` (`src/modules/hr/lib/talent.ts › moveError`) |
| `POST /hr/recruitment/applications/:id/interviews` | full | `{ date, time, duration_minutes, type (phone, video, onsite), location, interviewer_ids[] }` | `date`/`time` are **company-local** (regional timezone) → `scheduled_at` UTC. Interviewers: active users whose role sees HR (else 422). From applied / screening the candidate moves to interview |
| `PATCH /hr/recruitment/interviews/:id` | full | as POST + `status` (scheduled, completed, cancelled) | |
| `PUT /hr/recruitment/interviews/:id/scorecard` | the interviewer | `{ scores: [{ criterion, score 1–5 }] (every criterion of the opening), recommendation (strong_yes, yes, no, strong_no), notes }` | replaces the caller's card; `average` per card, interview `overall_score` = mean of the cards; all panelists scored → completed. Not on the panel `403` (or `404` when the interview isn't visible) |
| `GET /hr/recruitment/my-interviews` | any HR | — | interview **cards** of the caller (candidate name / current title, opening, time, type, `my_scorecard`): no contact data, no other scorecards |
| `POST /hr/recruitment/applications/:id/offers` | full | `{ salary, currency?, start_date, expiry_date }` (expiry ≤ start) | stage interview / assessment / offer (moves to offer); one open (draft / sent) offer per application `409 offer_exists` |
| `PATCH /hr/recruitment/offers/:id` | full | as POST | draft only (`409 offer_locked`) |
| `POST /hr/recruitment/offers/:id/status` | full | `{ status: sent \| accepted \| declined }` | draft → sent / declined; sent → accepted / declined. **Accepted = hire**: past expiry `409 offer_expired`; no free position `409 opening_filled`; creates the employee through the Employees section's `createEmployee` (candidate name / email / mobile, opening title + department, manager = the hiring manager's employee, hire date = start date, status onboarding, **no login**), marks the application `hired` with `employee_id`, fills the opening when `hired_count` reaches `headcount`. **Idempotent**: accepting again answers the same offer, no second employee |

### Training

Courses (company catalogue), sessions, enrollments, certificates, the mandatory training matrix and the budget.
Services: `src/shared/mocks/services/hrTraining.ts`, alerts `trainingReminders.ts`. Dates are company calendar days.
Every HR role reads the catalogue; enrollments, certificates and the matrix are limited to the employees the caller may
see (full: all; team: their team; own: themselves). Writes are HR full, except an employee rating their own attended
enrollment.

| Endpoint | Roles | Body / query | Notes |
|---|---|---|---|
| `GET /hr/training/options` | any HR | — | visible employees, departments, currency, `manage` |
| `GET /hr/training/courses` | any HR | — | `session_count`, `completed_count` |
| `POST /hr/training/courses` | full | `{ title, category (safety, compliance, technical, soft_skills, leadership, onboarding, other), provider (internal, external), provider_name, duration_hours, cost, currency, mandatory, validity_months (null = never expires, 0 = no certificate), description, active }` | |
| `GET /hr/training/courses/:id` | any HR | — | + `sessions`, `enrollments` (visible employees) |
| `PATCH /hr/training/courses/:id` | full | as POST | |
| `POST /hr/training/courses/:id/sessions` | full | `{ start_date, end_date, location, online_link, trainer, capacity, extra_cost, status? }` | location or link required |
| `PATCH /hr/training/sessions/:id` | full | as POST | capacity ≥ seated |
| `POST /hr/training/sessions/:id/enrollments` | full | `{ employee_ids[], status: invited \| enrolled }` | own-company employees (foreign / missing `404`), not left; already all on it `409 already_enrolled`; seats `409 session_full`; cancelled `409 session_cancelled` |
| `PATCH /hr/training/enrollments/:id` | full; the employee (own, attended: `feedback_rating`, `feedback` only) | `{ status (invited, enrolled, attended, no_show, completed, failed), score 0–100, feedback_rating 1–5, feedback }` | attended / completed / failed / no-show only once the session started (`409 session_not_started`). **Completed issues one certificate** (issue date = company today, expiry = issue + `validity_months`, number `<prefix>-<year>-<seq>`); leaving completed withdraws it |
| `GET /hr/training/certificates` | any HR (scoped) | — | `state` valid / expiring (≤ 30 days) / expired, `days_left` |
| `PATCH /hr/training/certificates/:id` | full | `{ issue_date?, expiry_date?, file_url? }` | a new issue date without an expiry recomputes it; any date change **re-arms** the expiry alert |
| `GET /hr/training/matrix` | any HR (scoped) | — | active mandatory courses × visible employees: `compliant`, `expiring`, `expired`, `missing`, `overdue` (no completion 30 days after the hire date). `compliance_pct` = compliant + expiring over all cells; `overdue_count` = overdue + expired. `cells` are keyed by course id |
| `GET /hr/training/budget?year` | full | — | per department: participants (seated, not just invited), course fees (cost × participant), session costs (extra cost split over participants); sessions starting in the year, not cancelled |
| `GET /hr/training/my` | any HR | — | the caller's enrollments, certificates and mandatory course states |

**Expiry alerts.** Stored notifications (type `hr`), sent **once** per expiry date from 30 days before it (company
calendar day): to the employee (when they have a login), their manager and every HR full user. Run lazily for the
caller's company by `GET /alerts` and the training lists; only for companies with the HR module.

**Isolation (recruitment, training).** Every endpoint is in `endpoints.ts` (`isolation/hrTalentEndpoints.ts`, module
`hr`; Crest's samples turn HR on with a platform module override); ids in bodies (`department_id`,
`hiring_manager_id`, `opening_id`, `candidate_id`, `interviewer_ids`, `employee_ids`) are in `REFS`. Roles per the
matrix (+ the interviewer case): `src/app/isolation/hrTalent.isolation.test.ts`; rules:
`src/shared/mocks/services/hrTalent.test.ts`. Not built: a public careers page (suggested next step).

### Attendance

Mappers `src/shared/api/hrTimeMappers.ts` (deep, mechanical: `work_date`, `check_in_at`, `check_out_at`,
`minutes_worked` …); services `src/shared/mocks/services/attendance.ts`, pure rules `src/modules/hr/time/calc.ts`.
All dates are **company-local** (regional timezone; `shared/lib/zonedTime.ts`): an entry's `work_date` is the
company date of its clock-in, so the same instant can be 20 Nov in Dubai and 19 Nov in Riyadh.

**Self-service (deliberate exception to the hidden scope).** Every user with an active employee record
(`EMP-<userId>`, not terminated) may clock in / out, read their own attendance, ask for corrections and request /
cancel their own leave, whatever their `hr` scope (a Sales Agent too). No employee record → `403 no_employee_record`.
Other employees' data stays per the matrix; an employee outside the caller's scope answers `404` like a foreign one.
The `/hr/attendance` and `/hr/leave` screens are therefore plan-gated only (the sidebar items follow the matrix; the
user menu has "Clock in / out" and "Request leave" for everyone while the plan has `hr`).

Shifts (work schedules): `{ id, name, start_time, end_time (HH:mm, same day), break_minutes, grace_minutes,
working_days (0 = Sun … 6 = Sat; default = the company's working week from the regional weekend), is_default,
is_active }`; one default per company; employees without an assignment follow the default.

Daily record (computed, never stored): `status` present | late | absent | on_leave | holiday | weekend | half_day,
`check_in_local`, `check_out_local`, `minutes_worked` (closed entries; the break is deducted once the day reaches 5 h),
`late_minutes` (first clock-in after start + grace, counted from the start), `early_leave_minutes`,
`overtime_minutes` (beyond the scheduled minutes; everything on a weekend / holiday), `missing_check_out` (an entry of
a past day without a clock-out; not counted), `open` (clocked in now), `in_progress` (today before the shift end, or
a future date: "not in yet", not counted as absent). Approved full-day leave → `on_leave`; half day → `half_day`.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/hr/attendance/me?month=yyyy-MM` | self | `{ employee, timezone, today, open_entry, shift, month, days[], entries[], summary }` |
| POST | `/hr/attendance/clock-in` | self | `{ note?, location? }`, source `web`; `409 already_clocked_in` (one open entry per employee) |
| POST | `/hr/attendance/clock-out` | self | closes today's open entry; `409 not_clocked_in` |
| GET | `/hr/attendance/today` | full / team | `{ date, rows[{ employee, record }], counts { in, late, absent, on_leave, not_expected, total } }`; others `403` |
| GET | `/hr/attendance/sheet?month&department_id&employee_id&status` | full / team | monthly grid `{ dates[], rows[{ employee, days[], summary }] }`; Excel export is built client-side from it |
| GET | `/hr/attendance/employees/:employeeId?month` | in scope | one employee's month; out of scope / foreign → `404` |
| POST | `/hr/attendance/entries` | full | manual entry `{ employee_id, work_date, check_in, check_out?, note }` (company-local HH:mm), audited |
| POST | `/hr/attendance/import` | full | `{ csv, dry_run }`, lines `employee_no,timestamp` (`yyyy-MM-dd HH:mm` company time, or ISO 8601 with an offset); report `{ rows[{ line, ok, error, … }], valid, invalid, entries_created }`; row errors: unknown employee, employee has left, invalid / future timestamp, duplicate punch; punches pair in / out per employee and day (source `import`); max 5000 rows |
| GET | `/hr/attendance/shifts` | full / team | `{ shifts[] (+ employee_count), assignments[], weekend, timezone }` |
| POST / PATCH / DELETE | `/hr/attendance/shifts`, `/hr/attendance/shifts/:id` | full | validation `422`; the default can't be deleted (`409 default_shift`) or un-defaulted |
| PUT | `/hr/attendance/assignments` | full | `{ employee_id, shift_id \| null }` (null = default) |
| GET | `/hr/attendance/corrections?status` | any | own requests + the ones the caller may decide |
| POST | `/hr/attendance/corrections` | self | `{ work_date, entry_id?, check_in, check_out?, reason }`; at most 60 days back; `409 duplicate_correction` |
| POST | `/hr/attendance/corrections/:id/decide` | the employee's manager / head, a team head of their team, or HR full | `{ decision: approve \| reject, comment }`; approve rewrites (or adds) the entry as `manual`; audited, employee notified; never one's own (`403`) |

### Leave

Services `src/shared/mocks/services/leave.ts`. Leave types per company, seeded from **synthetic country defaults**
(`src/modules/hr/time/defaults.ts`: UAE-like for AE, KSA-like for SA; labelled "defaults, review with HR"):
`{ code (annual, sick, unpaid, maternity, paternity, hajj, compassionate, emergency, other), name, is_paid,
days_per_year, accrual (monthly | yearly), carry_over_max, document_after_days, min_notice_days, gender,
allow_negative, is_active, color }`. Types are deactivated, never deleted.

Balances (computed per employee, type, year): `entitled_days` (prorated by month in the hire year), `accrued_days`
(yearly: upfront; monthly: days / 12 at the start of each month of service, the hire month counting up to the 15th),
`carried_days` (last year's full accrual minus what was taken, capped by `carry_over_max`), `used_days` (approved),
`pending_days` (in approval), `remaining_days = accrued + carried − used − pending`. All in company-local dates.

Request rules (create and `/preview`; the preview returns the first problem instead of failing): working days = the
range minus the company weekend and public holidays (0.5 for a half day; 0 → `422 no_working_days`); `409 overlap`
with the employee's own pending / approved leave (two different halves of one day don't overlap);
`422 insufficient_balance` for a paid type without `allow_negative`; `422 notice_too_short` (`min_notice_days`, own
requests); `422 past_date` (more than 30 days back); `422 gender_restricted`; `422 document_required` (longer than
`document_after_days`). HR full may file for another employee (`employee_id`; notice not applied).

Approval (spec, two steps; `leave_request_approvals`): **step 1 `department_head`** = the employee's manager and the
head of their department (the parent's head when they head it themselves), fixed at submission; with none, the
request starts at HR. **Step 2 `hr`** = every active HR-full user except the employee. Status `pending_head →
pending_hr → approved`, or `rejected` at either step (a comment is required). The balance is re-checked at the final
approval. Step-1 approvers see the requests they must decide even with a hidden `hr` scope (approver inbox, e.g. a
Sales Manager for their agents). Cancel: the employee before the start date; after the start, HR only. Stored
notifications (`type: hr`): approvers on submit; the employee + HR after step 1; the employee (+ the step-1
approver) after HR; the pending approvers on cancel. Approved leave makes those working days `on_leave` in attendance.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/hr/leave/me?year` | self | `{ employee, year, timezone, today, balances[], requests[], types[] }` |
| GET | `/hr/leave/types` | any | `{ types[], settings { conflict_threshold_pct }, country }` |
| POST / PATCH | `/hr/leave/types`, `/hr/leave/types/:id` | full | validation `422`, `409 duplicate_name` |
| PUT | `/hr/leave/settings` | full | `{ conflict_threshold_pct }` (1–100) |
| GET | `/hr/leave/balances?year&employee_id` | full / team | `[{ employee, balances[] }]` |
| GET | `/hr/leave/calendar?month` | any | approved + pending leave in the month (full: all; team: team; others: own), holidays, `conflicts[{ date, department_id, off, size, pct }]` when more than the threshold of a department (2+ people) is off |
| GET | `/hr/leave/requests?status&employee_id&view=mine\|approvals\|all` | any | own ∪ scope ∪ approver inbox; each with `can_decide`, `can_cancel` |
| POST | `/hr/leave/requests/preview` | self (HR: any) | `{ days, dates[], excluded_holidays[], balance, problem, document_required }` |
| POST | `/hr/leave/requests` | self (HR: any) | `{ leave_type_id, start_date, end_date, half_day?: am \| pm, reason?, document_name? }` |
| GET | `/hr/leave/requests/:id` | visible | otherwise `404` |
| POST | `/hr/leave/requests/:id/decide` | the current step's approvers | `{ decision, comment }`; another user `403`; not pending `409 not_pending` |
| POST | `/hr/leave/requests/:id/cancel` | employee before start / HR | `409 not_cancellable` when closed |

### Public holidays

Per company, seeded for the current and next year from the country (UAE / KSA, approximate Islamic dates; synthetic,
"review with HR"). `GET /hr/holidays?year` (any company user: working-day counts depend on them); `POST /hr/holidays`
`{ date, name }`, `PATCH /hr/holidays/:id`, `DELETE /hr/holidays/:id` (HR full; one holiday per date →
`409 duplicate_date`). A company created later gets the defaults (types, holidays, one shift) on first use.

**Isolation (attendance, leave, holidays).** Every endpoint is in `endpoints.ts` (`isolation/hrTimeEndpoints.ts`,
module `hr`; Crest's samples turn HR on with a platform module override). Ids are globally unique (`SHF-`, `ATT-`,
`ATC-`, `LVT-`, `LVR-`, `HOL-`) and every lookup is company-first, so a foreign id answers like a missing one (`404`).
All nine matrix roles in both companies, self-service and the plan gate: `src/app/isolation/hrTime.isolation.test.ts`;
rules: `src/shared/mocks/services/hrTime.test.ts`, `src/modules/hr/time/calc.test.ts`; browser: `e2e/hr-time.spec.ts`.
No client storage (server state through TanStack Query under `['hr', 'time']`).

### Salary management

Monthly payroll, payslips, adjustments, loans and end-of-service settlements. Services
`src/shared/mocks/services/hrPayroll.ts` (seed included), stores `src/shared/mocks/data/hrPayroll.ts`
(`hr.paySettings`, `hr.payrollProfiles`, `hr.payAdjustments`, `hr.payLoans`, `hr.payrollRuns`, `hr.finalSettlements`),
pure rules `src/modules/hr/payroll/calc.ts` (line arithmetic, gratuity, WPS SIF / Mudad builders), wire
`src/shared/api/hrPayrollMappers.ts` (plain snake_case at any depth; the `by_month` keys of the summary pass through).
Screens: `/hr/salary` (`?tab=`, `?run=`, `?payslip=`) and the printable `/hr/salary/payslips/:id`.

**Who.** Everything is **HR full** (Company Admin, Management, HR Manager) except the payslips: **team** (Department
Head) and **own** (Employee) see only **their own** payslips (a Department Head never sees the team's pay, as in the
contracts); **hidden** roles `403` everywhere. Writes of the wrong scope answer `403`; an id of another company, or
outside the caller's scope, answers `404 Not found.` like a missing one. Ids: `PR-` runs, `PSL-` lines / payslips,
`PADJ-` adjustments, `PLN-` loans, `PFS-` settlements (globally unique). Error codes below are in `{ message, code }`.

**Pay components are not stored here**: they come from the employee's **active contract** (`/hr/contracts`), bank
details from the employee profile (`/hr/employees`). Money: 2 decimals per item (company currency AED / SAR); totals
are sums of the rounded items.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/payroll/settings` | full | — | `country, currency, pay_day, cutoff_day, wps_employer_id, wps_routing_code, mudad_establishment_no, social_insurance {national_employee_rate, national_employer_rate, expat_employee_rate, expat_employer_rate, base (basic_housing · basic · gross), cap}, deduct_absences, overtime_enabled, overtime_multiplier, gratuity_basis, defaults_confirmed, defaults_confirmed_at, defaults_confirmed_by_name, country_defaults, updated_at`. Created on first use with the country defaults |
| PATCH | `/hr/payroll/settings` | full | any field above (`social_insurance` partial); `defaults_confirmed: true` stamps who confirmed | the settings. `422`: pay day 1–28, cut-off 1–31, WPS employer id 13 digits, routing code 9 digits, rates 0–50 %, multiplier 1–3 |
| GET | `/hr/payroll/profiles` | full | — | per employee: `employee_id, employee_name, employee_no, department_name, nationality, status, pay_method (bank · cash · cheque), person_id_masked, bank_routing_code, bank_name, iban_masked, contract_id, basic_salary, housing_allowance, transport_allowance, other_allowance, total_salary, currency, issues[] (no_contract · no_iban · no_person_id)` |
| PATCH | `/hr/payroll/profiles/:employeeId` | full | `pay_method, person_id` (write only; `''` removes; UAE WPS person id 14 digits, KSA national id / iqama 10 digits starting 1 or 2), `bank_routing_code` (9 digits) | the profile row (masked) |
| POST | `/hr/payroll/profiles/:employeeId/reveal` | full | — | `{ employee_id, person_id }`: the full id; activity + audit log |
| GET | `/hr/payroll/adjustments` | full | `month` (yyyy-MM: those that apply), `employee_id` | `id, employee_id, employee_name, kind (allowance · bonus · deduction), label, amount, recurrence (once · monthly), month, end_month, notes, paid_run_ids[], locked` |
| POST | `/hr/payroll/adjustments` | full | `employee_id*, kind*, label*, amount* (> 0), recurrence, month*, end_month, notes` | the adjustment. `422 month_paid` for a one-off in a paid month (corrections go to a later month); foreign `employee_id` → `404` |
| PATCH | `/hr/payroll/adjustments/:id` | full | same fields | `409 run_locked`: a paid one-off; a paid monthly one only accepts `end_month` / `notes` |
| DELETE | `/hr/payroll/adjustments/:id` | full | — | `{ id }`; `409 run_locked` once in a paid run |
| GET | `/hr/payroll/loans` | full | `employee_id, status` | `id, employee_id, employee_name, kind (advance · loan), principal, installment_amount, start_month, reason, status (active · repaid · cancelled · settled), repaid, remaining, repayments[{run_id, month, amount, source (run · settlement)}], schedule[{month, amount, status (paid · planned)}]` |
| POST | `/hr/payroll/loans` | full | `employee_id*, kind, principal*, installment_amount* (≤ principal), start_month*` (after the last paid month), `reason` | the loan |
| PATCH | `/hr/payroll/loans/:id` | full | `installment_amount, reason, status: cancelled` | `409 loan_repaying` (cancel after a repayment), `409 loan_closed` |
| GET | `/hr/payroll/runs` | full | — | rows: `id, month, status (draft · calculated · approved · paid), currency, period_start, period_end, pay_date, totals {headcount, gross, deductions, net, employer_social_insurance, employer_cost}, open_warnings, calculated_at, calculated_by_name, approved_at, approved_by_name, paid_at, paid_by_name` |
| POST | `/hr/payroll/runs` | full | `{ month }` (up to next month) | the run (draft, no lines). `409 run_exists`; `422 month_paid` before the latest paid month |
| GET | `/hr/payroll/runs/:id` | full | — | row + `lines[]` (below), `calculated_by, can_calculate, can_approve, approve_blocked_reason, can_pay, can_reopen, can_export, exports[{at, by_name, format, count}], notes` |
| DELETE | `/hr/payroll/runs/:id` | full | — | draft / calculated only (`409 run_locked`) |
| POST | `/hr/payroll/runs/:id/calculate` | full | — | the run, `calculated`: every line rebuilt from live data (line ids and acknowledged warnings kept). `409 run_locked` when approved / paid. Notifies the approvers |
| POST | `/hr/payroll/runs/:id/acknowledge` | full | `{ all: true }` or `{ warnings: [{employee_id, code}] }` | the run. `409 run_not_calculated` |
| POST | `/hr/payroll/runs/:id/approve` | full, **not the user who calculated** | — | the run, `approved`. `403 maker_checker`, `409 unresolved_warnings`, `409 run_not_calculated` |
| POST | `/hr/payroll/runs/:id/reopen` | full | — | back to `draft` (from calculated / approved); `409 run_locked` when paid |
| POST | `/hr/payroll/runs/:id/pay` | full | — | `paid` (immutable): loan installments recorded, one-off adjustments locked, "payslip available" to each employee. `409 run_not_approved`, `409 earlier_run_unpaid` |
| POST | `/hr/payroll/runs/:id/bank-file` | full | `{ format: wps \| mudad }` | **the file**: `{ format, file_name, mime_type, content, count, total, skipped[{employee_id, employee_name, reason}] }`. Approved or paid runs only (`409 run_not_approved`); `wps` for AE companies, `mudad` for SA (`422`); `422 settings_incomplete` without the WPS ids / Mudad number. Audit-logged |
| GET | `/hr/payroll/payslips` | full / team / own | `employee_id, month` | paid lines in scope: `id, run_id, month, employee_id, employee_name, employee_no, department_name, gross, total_deductions, net, currency, pay_date, paid_at` |
| GET | `/hr/payroll/payslips/:id` | in scope | — | row + `company {name, country}, job_title, nationality, pay_method, bank_name, iban_masked, period_start, period_end, pay_start, pay_end, days_in_month, paid_days, unpaid_leave_days, absence_days, overtime_hours, items[]` (earnings, deductions), `employer_social_insurance` |
| GET | `/hr/payroll/summary` | full | `months` (1–24, default 12) | approved / paid runs: `currency, months[{month, run_id, status, headcount, gross, deductions, net, employer_cost}], departments[{department_id, department_name, by_month {yyyy-MM: employer cost}, total, headcount}], totals` |
| GET | `/hr/payroll/settlements` | full | — | settlements (below) |
| POST | `/hr/payroll/settlements/preview` | full | `employee_id*, reason (resignation · termination · contract_end), exit_date` (default: the employee's), `adjustments[{label, amount (±)}]` | a settlement computed, not saved. `422 no_contract` |
| POST | `/hr/payroll/settlements` | full | same + `notes` | the draft: `id, employee_id, employee_name, employee_no, hire_date, exit_date, reason, currency, basic_salary, housing_allowance, gratuity {country, service_days, excluded_days, years, monthly_wage, daily_wage, first_period_units, later_period_units, full_amount, factor, capped, amount, eligible, explanation[]}, unpaid_salary_from, unpaid_salary_days, unpaid_salary, leave_days, leave_encashment, loan_balance, adjustments[], total, status, notes, created_at, created_by_name, paid_at, paid_by_name`. `422 not_leaving` (status must be notice / terminated), `409 settlement_exists` |
| GET | `/hr/payroll/settlements/:id` | full | — | the settlement |
| PATCH | `/hr/payroll/settlements/:id` | full | `reason, exit_date, adjustments, notes` | recomputed; `409 settlement_paid` |
| DELETE | `/hr/payroll/settlements/:id` | full | — | draft only |
| POST | `/hr/payroll/settlements/:id/pay` | full | — | recomputed and locked; open loans become `settled`; the employee's offboarding step **Final settlement** is done |

**Run line.** `id, run_id, employee_id, employee_name, employee_no, job_title, department_id, department_name,
nationality, contract_id, pay_method, bank_name, iban_masked, pay_start, pay_end, days_in_month, paid_days,
unpaid_leave_days, absence_days, leave_days, overtime_hours, items[{code, label, type (earning · deduction · employer),
amount, note}], basic, housing, gross, total_deductions, net, employee_social_insurance, employer_social_insurance,
employer_cost, fixed_pay, variable_pay, warnings[{code (no_contract · no_iban · no_person_id · negative_net), message,
acknowledged}]`. Eligible: hired by the month end, not left before the month start, no final settlement covering the month.

**Rules.**
- *Earnings*: the active contract's basic / housing / transport / other × paid calendar days ÷ days in the month, over
  [max(month start, hire date, contract start), min(month end, exit date, contract end)] (joiners and leavers).
- *Unpaid leave*: approved requests of a leave type with `is_paid = false`, working days inside the window (half day
  0.5) × daily rate (monthly fixed pay ÷ calendar days of the month).
- *Unexcused absence* (`deduct_absences`, on by default): a working day of the employee's shift inside the window, from
  the employee's **first recorded attendance** on, up to min(cut-off day, yesterday), with no clock-in, no approved
  leave of any type and no public holiday (the attendance day status `absent`), × the same daily rate. An employee who
  never clocks in is not tracked (no deduction).
- *Overtime* (`overtime_enabled`, off by default): overtime minutes of the attendance days × basic ÷ days in month ÷ 8
  × `overtime_multiplier`.
- *Social insurance*: nationals vs others, on the contributory base (`base`), capped at `cap`. Defaults (to confirm by
  HR; **not legal advice**): UAE GPSSA nationals 11 % employee / 12.5 % employer of basic + housing; KSA GOSI Saudis
  9.75 % / 11.75 %, non-Saudis 0 % / 2 % (occupational hazards), base capped at 45,000 SAR.
- *Loans*: each active loan's installment from its start month until repaid (the last one is what is left).
- *Fixed / variable* (WPS): variable = overtime + allowances / bonuses (capped at the net), fixed = net − variable.
- *Maker–checker*: the approver must be another HR-full user than the one who calculated; every warning must be
  resolved (fix + recalculate) or acknowledged. Reopen returns to draft; a paid run is never changed again.

**Bank files.** UAE **WPS SIF** (`<employerId><yyMMdd><HHmmss>.SIF`): one
`EDR,<person id>,<routing code>,<IBAN>,<pay start>,<pay end>,<days>,<fixed>,<variable>,<days on leave>` per
bank-paid employee with an id, an IBAN and a positive net, then
`SCR,<employer id>,<routing code>,<file date>,<HHMM>,<MMYYYY>,<EDR count>,<total>,AED,<run id>`. KSA **Mudad** CSV
(`mudad-<establishment>-<yyyy-MM>.csv`): `Employee ID / Iqama, Name, Bank, IBAN, Basic salary, Housing allowance,
Other allowances, Deductions, Net salary`. **The exact column specifications must be confirmed with the company's bank /
Mudad before go-live.** The files carry full IBANs and ids, so the export is a **POST** that answers the file (never a
GET, never in a list), HR full only, audit-logged; with the reveal endpoints it is the only exception of the HR secrets
sweep (`REVEAL_PATHS` in `src/shared/mocks/isolation/harness.ts`).

**End-of-service gratuity** (`calc.ts gratuity`; defaults, not legal advice). **UAE** (Federal Decree-Law 33/2021):
nothing under 1 year of continuous service; 21 days' basic wage per year for the first 5 years, 30 days per year after;
partial years prorated; daily wage = basic × 12 ÷ 365; capped at 2 years' basic (24 × basic); unpaid leave days are not
service; a resignation does not reduce it. **KSA** (Labor Law art. 84–85): half a month's wage per year for the first 5
years, a full month per year after; wage = basic + housing (`gratuity_basis`); partial years prorated; resignation:
< 2 years nothing, 2–5 one third, 5–10 two thirds, ≥ 10 the full award; termination / end of contract the full award.
**Final settlement** = gratuity + unpaid salary (from the day after the employee's last paid run to the exit date,
calendar-day proration) + remaining **annual leave** balance at the exit date × daily wage (basic × 12 ÷ 365; KSA with
the basic + housing basis) − open loan balance ± adjustments.

**Notifications** (stored, type `hr-payroll`, bell group **HR**): "Payroll <month> awaits your approval" to every other
active HR-full user, once per run (re-armed by reopen); "Your payslip for <month> is available" to the employee's user,
once per line, when the run is paid.

**Seed** (both companies, different data): three paid months and a draft for the current month. Apex: a loan in
repayment (EMP-u14), a monthly allowance, a paid bonus, a one-off fine this month, an approved unpaid leave this month
(EMP-u6), a joiner on the 10th (EMP-X4, no IBAN yet), a cash-paid driver, an employee without a WPS id, WPS ids set,
rates not yet confirmed. Crest: a salary advance (EMP-X101) with its last installment due, an unpaid leave last month
(EMP-X102), a joiner on the 5th (EMP-X104), a cheque-paid contractor, Mudad number set, rates confirmed.

**Tests.** Endpoints in `src/shared/mocks/isolation/hrPayrollEndpoints.ts` (both directions, spoofing; the HR secrets
sweep in `secrets.isolation.test.ts`); roles from the matrix in `src/app/isolation/hrPayroll.isolation.test.ts`; rules
in `src/shared/mocks/services/hrPayroll.test.ts` and `src/modules/hr/payroll/gratuity.test.ts`; browser
`e2e/hr-payroll.spec.ts`.

### HR reports

One page (`/hr/reports`, sidebar: last HR item, **HR full and Department Head only**) with a tab per report, a period
and a department filter. Services `src/shared/mocks/services/hrReports.ts` (one aggregate per report, computed
server-side over the caller's scope), pure rules `src/modules/hr/reports/calc.ts` (unit-tested: ranges and the
company timezone, turnover, nationalisation %, funnel conversion, expiry buckets, committed pay, CSV), wire
`src/shared/api/hrReportsMappers.ts` (mechanical snake_case, arrays only), setting store `data/hrReports.ts`.

**Scope.** full (Company Admin, Management, HR Manager): the whole company, incl. pay. team (Department Head): the
employees of the departments they head **and their sub-departments** (department membership only: unlike the
Employees list, direct reports outside those departments and the head's own record outside them are not counted);
every report filtered, **never pay** (Payroll cost `403`, `monthly_payroll_cost`, training `spend` / `year_spend` /
`budget` null). own (Employee) and hidden: `403` on every endpoint (no sidebar item; the route redirects).

**Query (every report and export).** `from`, `to` (company-local `yyyy-MM-dd`; default = 1 Jan – 31 Dec of the
company's current year in its timezone; at most 36 months; invalid / reversed → `422 validation_failed`) and
`department_id` (the department and its sub-departments; a department of another company, a missing one, or — for a
Department Head — one they don't head answers `404 Not found.` like a missing one). `as_of` = min(`to`, today):
point-in-time figures (headcount, nationalisation, tenure) use it; monthly trends stop there. Every answer starts with
`from, to, as_of, today, timezone, currency, scope, department_id, department_name`.

| Method | Path | Who | Answer |
|---|---|---|---|
| GET | `/hr/reports/options` | full / team | `scope, departments[] (team: headed + sub-departments), reports[] (team: no payroll-cost), default_from, default_to, today, timezone, currency, country, nationalisation_label, can_edit_settings` |
| GET | `/hr/reports/overview` | full / team | KPIs: `headcount, joiners, leavers, turnover_pct, absence_rate_pct, open_positions, expiring_documents (≤ 60 days), expired_documents, nationalisation_label, nationalisation_pct, nationalisation_target_pct, training_compliance_pct, monthly_payroll_cost (full; null for team), trend[]` |
| GET | `/hr/reports/headcount` | full / team | `total` (on `as_of`), `by_department[], by_nationality[], by_gender[], by_employment_type[]` (`{key, label, count}`), `trend[{month, headcount}]` (month ends) |
| GET | `/hr/reports/turnover` | full / team | `months[{month, joiners, leavers, opening, closing, average_headcount, turnover_pct}]`, `joiners, leavers, average_headcount, turnover_pct` (all leavers ÷ mean of the monthly averages), `average_tenure_years`, `leaver_list[]`, `joiner_list[]`, `probation {passed, left_in_probation, in_probation_now}` |
| GET | `/hr/reports/nationalisation` | full / team | `country, label (Emiratisation · Saudization · Nationalisation), target_pct, can_edit_target, nationals, total, pct, gap_to_target, trend[{month, nationals, total, pct}], by_department[], disclaimer` — an **internal tracker**, not an official MOHRE / Nitaqat calculation |
| GET | `/hr/reports/attendance` | full / team | `tracked_from` (first recorded attendance day of the company: earlier days never count as absences), `totals`, `by_month[]`, `by_department[]` (`expected_days, present_days, late_arrivals, late_minutes, absences, overtime_minutes, absence_rate_pct`), `top_late[]` (10). Daily records from the Attendance rules (`calc.ts`); today's unfinished shift is skipped |
| GET | `/hr/reports/leave` | full / team | approved working days in the period `by_type[]`, `by_month[{month, days, by_type[]}]`, `total_days`; `balances[]` (paid types, employees on the payroll, year of `as_of`), `upcoming[]` (approved, next 30 days), `pending_requests` |
| GET | `/hr/reports/compliance` | full / team | **as of today** (period ignored): `summary[{kind: document · contract · probation, expired, d30, d60, d90}]`, `rows[]` (`id, kind, label` = document / contract type, never a number, `date, days_left, bucket`, employee) — documents with an expiry, active contracts' end dates, probation ends ahead |
| GET | `/hr/reports/assets` | full / team | `count, value (cost), assigned, available (in stock), by_status[], by_category[] ({key, label, count, value}), warranties[]` (ending within 90 days). full without a department: the whole register; otherwise the assets their people hold |
| GET | `/hr/reports/recruitment` | full / team | openings of the departments in scope; applications created in the period: `funnel[{stage, label, reached, conversion_pct}]` (an application counts in every stage it reached; interviews / offers prove a rejected one got that far), `rejected, withdrawn, hires, average_time_to_hire_days` (application → offer accepted), `open_positions`, `openings[]`, `offers {sent, accepted, declined, pending, acceptance_rate_pct}`, `by_source[]`. No salaries |
| GET | `/hr/reports/training` | full / team | `compliance_pct` (mandatory matrix, as Training), `overdue, by_department[], by_course[], certificates_expiring[]` (≤ 30 days), `certificates_expired, completions`; full only: `spend` (sessions starting in the period), `budget_year` (year of `to`), `year_spend, budget, budget_used_pct` |
| GET | `/hr/reports/payroll-cost` | **full** (team `403 forbidden`) | `source: contracts \| payroll_runs`, `months[{month, amount, employees}]`, `by_department[{key, label, employees, monthly, total}]`, `current_monthly` (month of `as_of`), `total`, `note`. **Committed** cost: basic + housing + transport + other allowances of the contract in force each month (latest start wins in a renewal month), company currency |
| GET | `/hr/reports/:report/export` | as the report | `{ report, file_name, headers[], rows[][] }`; the screen writes the CSV (formula-safe cells, UTF-8 BOM). Same scope and filters; never document numbers or IBANs, pay only in `payroll-cost` (full). Unknown report `404` |
| PUT | `/hr/reports/settings` | full | `{ nationalisation_target_pct (0–100 \| null), training_budget: { year, amount (≥ 0 \| null = remove) } }` → `{ nationalisation_target_pct, training_budgets[{year, amount}], currency, updated_at }`. `422` out of range / nothing to change; team `403` |

**Payroll source.** A month with an **approved or paid payroll run** (Salary management) uses the run lines' gross pay
per employee (prorated pay, overtime, allowances, bonuses; before deductions, without employer social insurance);
months without one fall back to the committed contract pay. The answer says `source: 'payroll_runs'` as soon as one
month of the range comes from a run, else `contracts` (same shape, so the screen and the export don't change).

**Rules.** Headcount on a day = hired on or before it and not left before it (`exit_date` is the last working day; a
terminated record without one counts as leaving on its last update). Turnover per month = leavers ÷ ((opening +
closing) ÷ 2). Dates of stored instants (applications, offers) are taken in the company timezone.

**Isolation.** Every endpoint is in `endpoints.ts` (`isolation/hrReportsEndpoints.ts`, module `hr`; Crest's samples
turn HR on with a platform module override; the headcount export's row count is checked against an own
recomputation); `department_id` is in `REFS` (`scoped.isolation.test.ts`). Every matrix role in both companies, "the
Department Head never sees pay and only their departments", exports without document numbers / IBANs, per-company
settings and the plan gate: `src/app/isolation/hrReports.isolation.test.ts`; browser: `e2e/hr-reports.spec.ts`.
Persisted dev DB: `VERSION` 21 added `hr.reportSettings`. No client storage (TanStack Query under `['hr', uid, 'reports']`).

### Self-service

"My HR" (`/hr/me`): the portal of **every user with an active employee record** (`EMP-<userId>`, not terminated),
whatever their `hr` scope — like clock-in and leave (a Sales Agent too; a deliberate exception to the hidden scope).
Without a record → `403 no_employee_record`. Strictly own data: nothing takes an employee id from the request.
Services `src/shared/mocks/services/hrSelfService.ts` (+ `hrLetters.ts`), stores `src/shared/mocks/data/hrSelfService.ts`
(`hr.profileChanges`, `hr.letterTypes`, `hr.letterRequests`, `hr.letterSeq`), wire `src/shared/api/hrSelfServiceMappers.ts`
(plain snake_case at any depth). Screens: `/hr/me` (user menu "My HR" for everyone while the plan has `hr`; first HR
sidebar item for roles that see HR), `/hr/me/payslips/:id` (printable own payslip), `/hr/letters/:id` (printable
letter), `/hr/requests` (HR full, sidebar "Employee Requests": Profile changes · Letter requests · Letter templates ·
Verify a letter).

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/me` | self | — | `employee {id, employee_no, full_name, job_title, department_name, manager_name, email, mobile, nationality, hire_date, status, employment_type, exit_date}`, `profile {emergency_contact, address, mobile, bank {bank_name, account_name, iban_masked}}`, `documents[]` (masked numbers, status, days to expiry), `contract` (the active one, own pay visible) or null, `assets[]` (held now), `payslips[]` (paid runs only), `training {enrollments, certificates, mandatory}`, `interviews[]` (panel cards; empty for roles that don't see HR), `profile_changes[]`, `letters[]`, `letter_types[]` (active, `available`, `unavailable_reason`, no template text), `hr_scope`, `today`, `timezone`, `currency` |
| GET | `/hr/me/payslips/:id` | self | — | the payslip (same shape as `/hr/payroll/payslips/:id`); another employee's / company's → `404` |
| GET | `/hr/profile-changes` | full: company; others: own | `status` | `id, employee_id, employee_name, employee_no, department_name, fields[] (mobile · emergency_contact · address · bank), current {…}, proposed {…}` (bank as `{bank_name, account_name, iban_masked}`), `iban_change, note, status (pending · approved · rejected · cancelled), requested_by_name, created_at, decided_by_name, decided_at, decision_comment, can_decide, can_cancel, can_reveal` |
| POST | `/hr/profile-changes` | self | `mobile, emergency_contact {name, relation, phone}, address {line1, city, country}, bank {bank_name, account_name, iban}, note` (only what changes) | the request. Validated like the HR form (`422`, codes `mobile`, `emergency_contact`, `address`, `iban`, `bank_name`), `422 no_changes`, one pending request per employee `409 pending_exists`. Notifies HR full |
| POST | `/hr/profile-changes/:id/approve` | full, **not their own** | `{ comment? }` | applied to the profile / employee record (mobile on the HR record). Activity + audit log; an IBAN change is audited as `security` with masked before / after. Notifies the employee. `403 own_request`, `409 not_pending` |
| POST | `/hr/profile-changes/:id/reject` | full, not their own | `{ reason* }` | `422 reason_required`; notifies the employee |
| POST | `/hr/profile-changes/:id/cancel` | the employee (own) or full | — | `409 not_pending` |
| POST | `/hr/profile-changes/:id/reveal` | full, not their own | — | `{ id, iban }`: the full proposed IBAN of a **pending** request (else `422 nothing_to_reveal`); activity + audit |
| GET | `/hr/self-service/inbox` | full | — | `counts {profile_changes, letters, total}`, pending `profile_changes[]`, pending `letters[]` |

**Masking.** The proposed IBAN is stored in full while pending (a real backend encrypts it), served masked like the
profile's, revealable by HR full only (POST, audited; in `REVEAL_PATHS`), and **wiped** once the request is approved,
rejected or cancelled (the masked form stays). The HR secrets guard also checks pending IBANs (`hrSensitiveValues`).
Deciding is HR full only (`403` for everyone else, whatever the id); reading another employee's request → `404` like a
missing one (a Department Head included).

### HR letters

Five letter types per company: `salary_certificate`, `salary_transfer` (addressed to a bank), `employment_certificate`,
`experience_letter`, `noc` (travel · visa · other), seeded with synthetic English templates (review with HR / legal).
Pure rules `src/modules/hr/selfservice/letters.ts`. Placeholders: `employee.fullName`, `employee.salutation`,
`employee.pronoun / possessive / object`, `employee.employeeNo / jobTitle / department / nationality / hireDate /
exitDate / employmentType`, `salary.basic / housing / transport / other / allowances / total / currency`, `bank.name`,
`bank.ibanLast4`, `company.name / legalName / address / country`, `letter.date / referenceNo`, `addressee`, `purpose`,
`noc.purpose`, `signatory.name / title` (written `{{employee.fullName}}`). Rendering is one pass (a value containing
`{{…}}` stays literal) and plain text (screens never render HTML); a missing value prints `________` and blocks the
issue (`422 missing_values`); `employee.salutation` may be empty. Salary / bank placeholders are only allowed in the
two salary types (`422 invalid_template` on save), so **pay only ever appears in salary letters, seen by HR full and
the employee**. Never a full IBAN or a document number.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/letters/types` | full: all with `body`; self: active ones, `body: ''` | — | `id, code, name, description, body, includes_salary, active, is_default, updated_at, updated_by_name, available, unavailable_reason` |
| PATCH | `/hr/letters/types/:id` | full | `name, description, body, active` | the type; `422 invalid_template` (`problems[]`), `422 no_changes`; audited |
| POST | `/hr/letters/types/:id/reset` | full | — | back to the seeded default |
| GET | `/hr/letters/requests` | full: company; others: own | `status, employee_id` | `id, employee_id, employee_name, employee_no, department_name, letter_type_id, code, type_name, includes_salary, addressee, purpose, noc_purpose, language_note, on_behalf, requested_by_name, status (pending · issued · rejected · cancelled), created_at, decided_by_name, decided_at, rejection_reason, override_reason, reference_no, issue_date, can_decide, can_cancel` |
| POST | `/hr/letters/requests` | self; full for anyone (`employee_id`) | `letter_type_id*, addressee` (required for salary_transfer; default "To whom it may concern"), `purpose` (required for noc), `noc_purpose` (noc), `language_note`, `override_reason` (full; experience letter) | the request. `422 not_leaving` (experience letter: notice / terminated, or HR's `override_reason`), `422 no_contract` (salary letters), `422 type_inactive`, `409 duplicate_request` (same type pending); another employee as non-full `403`; foreign / missing employee or type `404`. Notifies HR full except the requester |
| GET | `/hr/letters/requests/:id` | full, or the employee | — | row + `letter {title, reference_no, issue_date, verification_code, body, signatory_name, signatory_title, letterhead {name, legal_name, address_lines[], phone, email, website, license_no, logo_url, primary_color}}` once issued. Anyone else (a Department Head for a report) `404` |
| POST | `/hr/letters/requests/:id/approve` | full, not their own | `{ override_reason?, signatory_title? }` | **issued**: reference `<prefix>-HRL-<year>-<0001>` (per company and company-calendar year; prefix of the employee numbers APX / CRS; every check runs before the number is taken, so a refused approval never uses one), issue date = company today, verification code `XXXX-XXXX-XXXX`, rendered text frozen, letterhead from Settings › Company profile + Branding (logo, colour), signatory = the approver. Activity + audit; notifies the employee. `403 own_request`, `409 not_pending`, `422 not_leaving · no_contract · missing_values · invalid_template` |
| POST | `/hr/letters/requests/:id/reject` | full, not their own | `{ reason* }` | `422 reason_required`; notifies the employee |
| POST | `/hr/letters/requests/:id/cancel` | the employee (own) or full | — | `409 not_pending` |
| GET | `/hr/letters/verify?code=` | full | — | `{ valid, code, reference_no, employee_name, employee_no, type_name, issue_date, issued_by_name }` (no pay). Caller's company only: another company's code answers `valid: false` like an unknown one; malformed `422 code` |

**Notifications** (stored, type `hr-requests`, bell group **HR**, once per request and event through `notified` keys):
submitted → every active HR-full user except the requester; letter issued / rejected and profile change approved /
rejected → the employee. **Not built (next steps):** a public verification page (`GET /public/letters/verify`,
rate-limited, answering only validity / reference / issue date); Arabic or bilingual letters (`language_note` is free
text for HR); server-side PDF (browser print, A4).

**Isolation and tests.** Endpoints in `src/shared/mocks/isolation/hrSelfServiceEndpoints.ts` (spread into
`endpoints.ts`; Crest's samples turn HR on); `employee_id` / `letter_type_id` in `REFS`; every role × both companies
`src/app/isolation/hrSelfService.isolation.test.ts`; rules `src/shared/mocks/services/hrSelfService.test.ts`,
`src/modules/hr/selfservice/letters.test.ts`; browser `e2e/hr-self-service.spec.ts`. Portal cards of other HR sections:
`src/modules/hr/selfservice/portalSlots.tsx` (onboarding tasks, reviews). Persisted dev DB: `VERSION` 23 added the stores.

### Onboarding & offboarding

Checklist **templates** and **journeys** (one checklist run per employee and kind). Services:
`src/shared/mocks/services/hrJourney.ts` (+ `hrJourneySystem.ts`, the offboarding's system steps shared with the employee
profile), stores `src/shared/mocks/data/hrJourney.ts`, rules `src/modules/hr/journey/calc.ts`, wire
`src/shared/api/hrJourneyMappers.ts` (plain snake_case at any depth). Screens `/hr/journeys` (tabs Journeys · My tasks ·
Templates) and `/hr/journeys/:id`.

**Who.** **full**: templates, every journey, start / cancel / mark active, add / remove / reassign / tick any non-system
item. **team** (Department Head): journeys of the employees in their HR scope; ticks the **Manager** items of those (not
of their own journey). **own**: their own journeys; ticks their **Employee** items. **hidden**: `403` on journeys and
templates. **Assignee inbox (any role, like the leave approver inbox):** `GET /hr/journeys/my-tasks` and ticking an item
**assigned to you** work whatever your `hr` scope (a Sales Manager onboarding a new agent, the Accountant's payroll item).
Outside the scope: `404` like a missing id; inside the scope but not yours: `403`. Plan gate as every `/hr` path.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/journeys` | full / team / own | `kind (onboarding\|offboarding), status (active\|completed\|cancelled), employee_id` | rows: `id, kind, employee_id, employee_name, employee_no, job_title, department_id, department_name, manager_name, employee_status, template_id, template_name, anchor_date (hire / exit date), status, started_at, started_by_name, completed_at, progress {done, total, required_done, required_total, pct}, overdue, next_due_date`. Runs the journey reminder tick first |
| POST | `/hr/journeys` | full | `employee_id*, kind*, template_id` (default: best match) | the detail. `409 journey_exists` when one is running; offboarding only for a leaving employee (`422`); foreign / missing employee or template → `404` |
| GET | `/hr/journeys/my-tasks` | any role | — | `[{ journey_id, journey_kind, employee_id, employee_name, self, item }]`: non-system items assigned to the caller in running journeys, open first |
| GET | `/hr/journeys/options` | full | — | `templates[] {id, name, kind}`, `assignees[] {id, name, role}` (active users), `departments[]`, `courses[]` |
| GET | `/hr/journeys/:id` | in scope | — | row + `items[]`, `can_manage`, `can_finish`, `finish_blockers[]` |
| POST | `/hr/journeys/:id/items` | full | `title*, owner_role*, assignee_user_id, due_date \| due_offset_days, required, description, action` | the detail |
| PATCH | `/hr/journeys/:id/items/:itemId` | full | `title, description, owner_role, assignee_user_id (reassign; null = HR team), due_date (null = follow the anchor again), required, action` | the detail. System items take only `due_date` / `assignee_user_id`; foreign / inactive user → `422` like a missing one |
| DELETE | `/hr/journeys/:id/items/:itemId` | full | — | the detail; `422` for a system item |
| POST | `/hr/journeys/:id/items/:itemId/complete` | see Who | `note` | the detail (in scope) or the caller's task (assignee outside the scope). `422` system item, `403` not yours, `409 journey_closed` |
| POST | `/hr/journeys/:id/items/:itemId/reopen` | see Who | — | same |
| POST | `/hr/journeys/:id/activate` | full | — | onboarding only: every **required** item done (`422 items_open` with `items[]` otherwise) → journey `completed`; an `onboarding` employee becomes `active` |
| POST | `/hr/journeys/:id/cancel` | full | — | `cancelled`; a running offboarding can't be cancelled while the employee is leaving (`422`) |
| GET / POST | `/hr/journeys/templates` | full | `kind*, name* (unique per company), description, department_id, employment_type, active, items*[] {title*, description, owner_role* (hr · it · manager · employee · finance · user), owner_user_id (required for user; optional default person for hr / it / finance), due_offset_days* (−365…365), due_anchor (start · probation_end, onboarding only), required (default true), action}` | templates + `department_name, items[].owner_user_name, active_journeys` |
| GET / PATCH / DELETE | `/hr/journeys/templates/:id` | full | as POST (kind can't change; items with a known `id` keep it) | the template / `{ id }`. Running journeys keep their copied items |

**Item** fields: `id, title, description, owner_role, assignee_user_id, assignee_name, due_anchor, due_offset_days, due_date,
due_overridden, required, blocking, action {kind: assign_asset · enrol_course · upload_document · sign_contract ·
probation_review, asset_category, course_id (null = every mandatory course), document_type}, system (assets · login ·
settlement · null), status (open · done · skipped), done_at, done_by_name, detail, note, overdue, days_left, can_complete`.

**Lifecycle.** `createEmployee` with status `onboarding` (the Employees form or Recruitment's hire) starts an onboarding
from the **best template**: active, same kind, targeting fields empty or equal to the employee's; department match beats
employment-type match beats general; ties → most recently updated. Assignees: Employee → the employee's login, Manager →
the manager's login, hr / it / finance → the template's default person or the HR team (`null`), user → that person.
Status → `notice` / `terminated` starts an **offboarding** with the template items plus three **system items** (`assets`
blocking, `login`, `settlement`) that follow their real source live (assets returned / lost, login deactivated, final
settlement paid) and can't be ticked by hand; back to `active` cancels it. `POST /hr/employees/:id/offboarding/complete`
(unchanged: blocked only by unreturned assets) completes the journey and marks the open items `skipped`. Linked items
tick themselves once their record exists (asset of the category held, document type on file, a signed contract, enrolled
in the course / every mandatory course).

**Due dates** are company-local days: anchor + offset; anchor = hire date (onboarding) / exit date (offboarding) /
contract probation end (`probation_end`, fallback hire date + 90, so the seeded probation review at −10 lands on day 80).
They follow the anchor until HR sets one. **Overdue** = open and due before the company's today (regional timezone, mock
clock). **Probation seam:** HR › Performance can call `completeProbationReviewItem(companyId, employeeId, { reviewId })`
and `probationReviewItemOf(…)` (services/hrJourney.ts); no import the other way.

**Notifications** (stored, type `hr-journey`, bell group **HR**, once per item and threshold): item assigned → the
assignee (batched per journey start; not to the actor; re-armed on reassignment); due tomorrow (or "due today" when first
seen then) and overdue → the assignee, or every HR-full user for HR-team items (marks keyed by due date, so a moved date
re-arms them); journey completed → HR full + the employee's manager. Runs on the company's lifecycle tick and before the
journey reads; only with the `hr` module.

**Tasks module.** Journey items are **not** copied into Tasks: tasks need a user owner and lead / customer / event links,
while journey items belong to employees without logins, to the "HR team" pool and to system checks. They show in My tasks
on this page, in the My HR portal card (`src/modules/hr/journey/components/MyOnboardingTasksCard.tsx`) and in the bell.

**Isolation.** Every endpoint is in the coverage table (`src/shared/mocks/isolation/hrJourneyEndpoints.ts`); foreign ids
in bodies / queries (`employee_id`, `template_id`, `department_id`, `owner_user_id`, `assignee_user_id`) behave like
missing ones (`scoped.isolation.test.ts`); roles: `src/app/isolation/hrJourney.isolation.test.ts`; rules:
`src/shared/mocks/services/hrJourney.test.ts`; browser: `e2e/hr-journey.spec.ts`. Persisted dev DB: `VERSION` 22.

### Performance

Review templates, cycles, goals, self / manager reviews, HR calibration and probation reviews. Types
`src/modules/hr/performance/types.ts`, pure rules `src/modules/hr/performance/calc.ts`, services
`src/shared/mocks/services/hrPerformance.ts` (+ `hrPerformanceCore.ts` access / notifications / seams,
`hrPerformanceTick.ts`), stores `src/shared/mocks/data/hrPerformance.ts`, wire `src/shared/api/hrPerformanceMappers.ts`
(mechanical snake_case at any depth). Ids `PRT-` templates, `PCY-` cycles, `PRV-` reviews, `PGL-` goals; every lookup is
company-first, so a foreign id answers exactly like a missing one (`404 Not found.`). Dates are company calendar days.

**Who sees a review** (deliberate exception to the hidden scope, like self-service leave): the **employee** themself,
whatever their `hr` scope (a Sales Agent too): goals and their self-assessment; the manager's assessment, scores and
final rating **only once shared**; **never** the calibration. The **direct manager** (`employees.manager_id` at launch),
whatever their `hr` scope (a Sales Manager reviews their agents): writes the manager assessment, approves goals.
**Department Head** (`team`): their team's reviews, read-only. **HR full**: every review incl. calibration; acts as
the reviewer when the employee has no manager with an active login; never calibrates their own review. Nobody sees a
peer's review (`404`). Templates and cycles: HR full only (`403` otherwise). The screen `/hr/performance` is therefore
plan-gated only; the sidebar item follows the matrix.

**Flow.** Cycle phases `draft → goal_setting → self_review → manager_review → calibration → shared → closed` (goal
setting / self-review skipped when the template has none). HR launches (a review per participant: explicit
`employee_ids`, else `department_ids` (empty = all), status active / on leave, hired on or before `hired_before`),
advances one phase at a time and closes (from any launched phase; unfinished reviews become `incomplete`). Moving to
`shared` shares every review whose manager assessment is submitted. Review stage (computed): `goal_setting ·
self_review · manager_review · calibration · shared · acknowledged · incomplete`. Goals: weights are whole numbers
1–100 and may not exceed 100 in total (`422 goal_weights`); the employee sets terms during goal setting and progress /
status until the manager submits; a terms change un-approves the goal; the manager approves (total must be 100).
Self-assessment: during self-review (late: during manager review until the manager submits). Manager assessment:
drafts from the self-review phase, submit in the manager-review phase (submitting approves the goals). Submits need
every question (and goal) rated (`422 incomplete`). **Score**: competency = mean of the question ratings; goals =
Σ(weight × rating) / Σ weights; overall = goals weight % × goals + competency weight % × competencies (goals off:
competencies); final rating = the latest HR calibration, else the overall rounded half up to a scale level.
**Calibration** (HR full, calibration phase): `rating` on the scale + mandatory `note` (`422 note_required`), written to
the audit log (`performance_review`) and the review's calibration history. An acknowledged review is **locked**
(`409 review_locked`); writes on a closed cycle `409 cycle_closed`; wrong phase `409 phase_closed`; bad cycle moves
`409 invalid_transition`.

**Probation reviews** are created by the tick (company lifecycle tick + every performance call, only with `hr`) for
each active contract whose `probation_end_date` is within **30** company-calendar days: a one-person cycle `type
probation` (template = the active one flagged `for_probation`), starting at its self-review (if the template has one)
or the manager review, deadline = the probation end; once per contract and probation end date. The manager must
recommend `confirm · extend (1–6 months) · terminate`; submitting moves the cycle to calibration; HR may override the
outcome in the calibrate call; **sharing applies it**: confirm → employee activity; extend → the active contract's
probation end moves (its reminder re-arms); terminate → HR is told (status / exit date stay an HR action in Employees).

**Notifications** (stored, type `hr`, bell group HR, once-only through marks on the cycle / review): phase opened →
participants (goal setting, self-review: employees; manager review: reviewers; calibration: HR full); due within 3
days / overdue → whoever must act (once per review, phase and deadline; calibration: HR full once per cycle); shared →
the employee; acknowledged → the reviewer + HR full; goals approved → the employee; probation review created → the
manager. `POST /cycles/:id/remind` is a manual nudge (not once-only).

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/hr/performance/options` | any employee | — | `{ manage, reviews, templates[] (full), departments[] (full), courses[] (reviewers), probation_lookahead_days }` |
| GET | `/hr/performance/my` | any employee | — | `{ employee_id, pending[{ review_id, action (set_goals · approve_goals · self_review · manager_review · acknowledge), employee_name, cycle_name, due_date, overdue }], reviews[] (own rows), goals[] (own, open cycles), team_to_complete, latest_shared }` (the portal card) |
| GET | `/hr/performance/templates` | full | — | `id, name, description, scale[{value, label}], sections[{id, title, questions[{id, text}]}], goals_enabled, goals_weight, competency_weight, self_review, for_probation, active, cycle_count` |
| POST / PATCH | `/hr/performance/templates`, `/:id` | full | `name*, description, scale (2–10 labels, default 1–5), sections* (1–12, 1–20 questions each), goals_enabled, goals_weight (0–100), self_review, for_probation (one per company), active` | the template; draft cycles follow it, launched cycles keep their snapshot |
| GET | `/hr/performance/cycles` | full | — | `id, name, type (annual · mid_year · probation · ad_hoc), phase, template_id, template_name, period_start, period_end, department_ids, employee_ids, hired_before, deadlines {goal_setting, self_review, manager_review, calibration}, current_deadline, launched_at, closed_at, progress {total, goals_ready, self_done, manager_done, shared, acknowledged, completion_pct}` |
| POST | `/hr/performance/cycles` | full | `name*, type* (not probation), template_id* (active, own company; foreign = missing → 422), period_start*, period_end*, department_ids[], employee_ids[], hired_before, deadlines` (required per template, in order: `422 deadline_order`) | the cycle detail (draft) |
| GET | `/hr/performance/cycles/:id` | full | — | row + `template` (snapshot), `by_stage[]`, `distribution[{value, label, count}]` (final ratings), `departments[{department_id, name, total, manager_done, completion_pct, average_rating}]`, `reviews[]` |
| PATCH | `/hr/performance/cycles/:id` | full | draft: as POST; launched: `name`, `deadlines` | the detail |
| POST | `/hr/performance/cycles/:id/launch` · `/advance` · `/close` | full | — | the detail (`422 no_participants`, `409 invalid_transition`) |
| POST | `/hr/performance/cycles/:id/remind` | full | — | `{ sent }` |
| GET | `/hr/performance/reviews` | any (scoped) | `cycle_id`, `stage` | the reviews the caller sees **except their own**: `id, cycle_id, cycle_name, cycle_type, cycle_phase, employee_id, employee_name, employee_no, job_title, department_id, department_name, manager_id, manager_name, stage, due_date, overdue, self_submitted_at, manager_submitted_at, overall_score, final_rating, final_label, shared_at, acknowledged_at` |
| GET | `/hr/performance/reviews/:id` | visible | — | row + `viewer (employee · manager · team · hr), template, period, deadlines, goals[], goal_weight_total, self, self_scores, manager {answers, goal_ratings, summary, submitted_at, recommended_course_ids, recommendation, extend_months}, scores {competency, goals, overall}, calibration {rating, previous_rating, note, by_name, at, history[]} (HR only), acknowledgement, probation {contract_id, end_date, outcome, outcome_applied_at}, recommended_courses[], sales_kpis[] (manager / HR; Sales Agents: Sales › Targets values vs actuals over the period), locked, can {…}` |
| PUT | `/hr/performance/reviews/:id/self` | the employee | `answers[{question_id, rating, comment}], goal_ratings[{goal_id, rating, comment}], summary, submit` | the review |
| PUT | `/hr/performance/reviews/:id/manager` | the reviewer | as self + `recommended_course_ids[]` (own courses; foreign = missing → 422), `recommendation`, `extend_months` (probation) | the review |
| POST | `/hr/performance/reviews/:id/calibrate` | full (not own) | `rating*, note*, recommendation?` | the review |
| POST | `/hr/performance/reviews/:id/share` | full | — | the review |
| POST | `/hr/performance/reviews/:id/acknowledge` | the employee | `comment?` | the review (locked) |
| POST | `/hr/performance/reviews/:id/goals` | employee / reviewer | `title*, weight*, target, description, progress, status (not_started · on_track · at_risk · completed · missed)` | the review |
| POST | `/hr/performance/reviews/:id/goals/approve` | the reviewer | — | the review |
| PATCH / DELETE | `/hr/performance/goals/:id` | employee / reviewer | as POST | the review |

**Seams.** `onProbationOutcome(name, listener)` (`services/hrPerformanceCore.ts`) runs when a probation outcome is
applied; `probationReviewFor(companyId, employeeId)` returns the latest probation review's stage / recommendation /
outcome (for the onboarding checklist). Portal card: `src/modules/hr/performance/components/MyPerformanceCard.tsx`.

**Isolation.** Every endpoint is in `src/shared/mocks/isolation/hrPerformanceEndpoints.ts` (spread into
`endpoints.ts`; Crest's samples turn `hr` on with a platform module override; the calibrate / share / acknowledge
samples build a one-person cycle through the API). Ids in bodies / queries (`template_id`, `department_ids`,
`employee_ids`, `cycle_id`, `recommended_course_ids`) are in `REFS`. Roles × both companies:
`src/app/isolation/hrPerformance.isolation.test.ts`; rules: `src/modules/hr/performance/calc.test.ts`,
`src/shared/mocks/services/hrPerformance.test.ts`; browser: `e2e/hr-performance.spec.ts`. Persisted dev DB: `VERSION`
24. Not built: a "Performance" tab in HR Reports (the distribution lives on the cycle view), 360° / peer feedback,
reassigning a running review to another manager.

## Finance

Accounts & finance (plan module **`accounting`**: every `/finance/*` path answers `403 module_not_in_plan` without it;
role access from the `accounting` column of `PERMISSION_MATRIX`: **full** Company Admin, Management, Accountant;
**view** Sales Manager; everyone else **hidden** → `403`). Core contract: `src/modules/finance/types.ts` (accounts,
journal entries, tax codes, invoices; ids `ACC-<code>` for template accounts, `JE-<n>` / `JV-<yyyy>-<nnnn>` for
entries), stores `src/shared/mocks/data/finance.ts`, posting API `src/shared/mocks/services/ledger.ts` (`postJournal`,
`reverseJournal`, `systemAccount`). Money: 2 decimals; journal lines are in the company's **base currency** (AED /
SAR). Error bodies are `{ message, code, …details }`.

### Ledger & settings

Finance settings, exchange rates, the lock date, the chart of accounts, the journal (manual entries, reversals, opening
balances), the trial balance, account ledgers and the finance overview. Services
`src/shared/mocks/services/financeLedger.ts` (+ `financeRates.ts`), stores `fin.accounts`, `fin.journal`,
`perTenant:fin.settings` (`src/shared/mocks/data/financeLedger.ts`; seed entries `data/financeLedgerSeed.ts`), pure
rules `src/modules/finance/ledger/calc.ts`, wire `src/shared/api/financeLedgerMappers.ts` (plain snake_case at any
depth). Screens: `/finance` (overview), `/finance/accounts` (`?account=` opens a ledger), `/finance/journal`
(`?entry=`, `?new=1`, `?tab=trial-balance`), `/finance/settings`.

**Who.** Reads (settings, accounts, ledgers, journal, entries, trial balance, overview, rate lookup): full and view.
Writes and the dimension pickers: full only (`403 forbidden` otherwise). **Lock date**: Company Admin and Accountant only
(Management → `403 lock_date_forbidden`), audit-logged. A foreign id in the path answers `404 Not found.` like a missing
one; a foreign account / dimension id in a body answers the same `422` as a missing one.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/finance/settings` | view | — | `base_currency, country, fiscal_year_start_month (1–12), vat_registered, vat_number, vat_label (TRN · VAT number), legal_name_en, legal_name_ar, document_prefix (APX · CRS), payment_terms_days, invoice_notes, invoice_terms, default_revenue_account_id, default_bank_account_id, exchange_rates[{id, currency, rate, effective_date, created_at, created_by_name}], lock_date, lock_date_set_at, lock_date_set_by_name, can_move_lock_date, can_edit, updated_at` |
| PATCH | `/finance/settings` | full | any editable field above | the settings. `422`: month 1–12, terms 0–365 days, `invalid_vat_number` (UAE TRN 15 digits starting 100; KSA 15 digits starting and ending with 3), VAT number required when registered, KSA + registered needs `legal_name_ar` (Arabic script), `invalid_account` (default revenue = active postable income account; bank = active postable asset account). Audited |
| PUT | `/finance/settings/lock-date` | Company Admin, Accountant | `{ lock_date: yyyy-MM-dd or null, reason }` | the settings; not in the future (`422`); audit entity `finance_lock_date` |
| GET | `/finance/exchange-rates/lookup` | view | `currency*, date` (default today) | `{ currency, date, base_currency, rate }` (`rate` null when none) |
| POST | `/finance/exchange-rates` | full | `currency* (ISO 3 letters, not the base), rate* (> 0: 1 unit in base currency), effective_date*` | the settings. `409 duplicate_rate` (same currency and date) |
| DELETE | `/finance/exchange-rates/:id` | full | — | the settings (posted documents keep their own rate) |
| GET | `/finance/accounts` | view | `as_of`, `include_inactive` (default true) | tree order (parents first, children by code): every `Account` field + `debit, credit, balance` (natural side, base currency; headers roll up their descendants), `has_postings, depth` |
| POST | `/finance/accounts` | full | `code* (3–10 digits, unique per company), name*, type*, subtype, parent_id (a header of the same type), is_header, description` | the row; id `ACC-N<n>` (unique across companies). `409 duplicate_code`, `422 invalid_parent` |
| PATCH | `/finance/accounts/:id` | full | same + `active`, `system_role` (moves the role from its current holder; the account must be active, postable and of the role's type) | the row. `409 has_postings` (type change, becoming a header), `409 has_children`, `409 system_role` (deactivating a system account or clearing its role: give the role to another account first), `409 has_balance` (deactivating with a non-zero balance), `409 has_active_children`, `409 default_account` |
| DELETE | `/finance/accounts/:id` | full | — | `{ id }`; never-posted accounts only: `409 has_postings` (deactivate instead), `system_role`, `has_children`, `default_account` |
| POST | `/finance/accounts/import-template` | full | — | the chart: the country template (UAE / KSA, `chartTemplateFor`) and VAT codes, for an **empty** chart only (`409 chart_not_empty`) |
| GET | `/finance/accounts/:id/ledger` | view | `from, to` | `account {id, code, name, type}, currency, from, to, opening_balance` (before `from`), `rows[{entry_id, number, date, memo, description, source_type, debit, credit, balance}]` (running natural-side balance), `totals, closing_balance`. A header lists its descendants' lines |
| GET | `/finance/journal` | view | `from, to, source_type, account_id, q` (number, memo, line text, account code / name, source number) | rows, newest first: `id, number, date, memo, source_type, source_id, source_number, source_link, status (posted · reversed), reversal_of, reversed_by, total, line_count, account_names[], created_by, created_by_name, created_at` |
| GET | `/finance/journal/dimensions` | full | — | `{ departments, projects, events, customers }`, each `[{id, name}]` of the company |
| POST | `/finance/journal` | full | `date*, memo*, lines*[{account_id*, debit, credit, description, department_id, project_id, event_id, customer_id}]` (≥ 2 lines, one side per line, balanced) | the entry detail (`source_type: manual`). `422 unbalanced`, `invalid_line`, `invalid_account` (unknown / inactive / header / another company's), `invalid_dimension`; `423 period_locked`. Audited |
| GET | `/finance/journal/:id` | view | — | row + `lines[]` (+ `account_code, account_name, department_name, project_name, event_name, customer_name`), `reversal_of_number, reversed_by_number, can_reverse, reverse_blocked_reason` |
| POST | `/finance/journal/:id/reverse` | full | `{ date (default today, not before the entry), memo }` | the **reversing** entry. Manual and opening-balance entries only (`409 source_document`: correct invoices / payments from their document), `409 already_reversed`, `409 is_reversal`, `423 period_locked` |
| POST | `/finance/opening-balances` | full | `date*, memo, lines*[{account_id, debit, credit}]` | one entry with `source_type: opening_balance`; the difference goes to the `opening_balance_equity` account (which can't be entered itself) |
| GET | `/finance/reports/trial-balance` | view | `as_of` (default today), `include_zero` | `as_of, currency, rows[{account_id, code, name, type, debit, credit}]` (postable accounts, the net on its side), `totals {debit, credit}, balanced` |
| GET | `/finance/overview` | view | — | `currency, today, cash[{account_id, code, name, balance}]` (accounts under the cash / bank header + the cash roles), `cash_total, receivables {total, overdue, open_count, overdue_count}` (open invoices' `balance_due × exchange_rate`; overdue by `isOverdue` at the company's today), `revenue {this_month, last_month, month, previous_month}` (income accounts, credit − debit), `vat {output, input, payable}` (ledger balances of the VAT roles; payable = output − input, an estimate), `latest[]` (8 rows), `lock_date` |

**Lock date.** `postJournal` refuses any entry dated **on or before** the company's lock date with
`423 { code: 'period_locked', lock_date }` — for every finance section (invoices, payments, PDC, manual entries,
reversals, opening balances), wired with `setPeriodGuard` when the ledger services load. Crest's seed has the 2025 books
locked (`2025-12-31`).

**Exchange rates** (for every section): `rateFor(companyId, currency, date)` in
`src/shared/mocks/services/financeRates.ts` → 1 for the base currency, else the latest rate effective on or before
`date`, else `null`; `requireRate(…)` throws `422 missing_exchange_rate`; `baseCurrencyOf(companyId)`.

**Helpers for the other finance sections.** `financeSettingsOf(companyId)` (payment terms, notes, terms, prefix, default
accounts) and `balancesByAccount(companyId, asOf, from)` (natural balances with roll-up, for statements) in
`services/financeLedger.ts`; `companyDocPrefix(companyId)` in `data/financeLedger.ts`;
`registerJournalSource(type, (companyId, id) => ({ number, link }))` (how a section's documents show in the journal;
invoices resolve from `fin.invoices` by default; default links `/finance/invoices/:id`, `/finance/payments/:id`,
`/hr/salary?run=`); the pure `sumByAccount`, `rollUp`, `trialBalance`, `accountLedger`, `naturalBalance` in
`src/modules/finance/ledger/calc.ts` (reusable for P&L and the balance sheet in phase 3).

**Seed** (both companies, through `postJournal`): opening balances on 1 January of the current year (the difference to
opening balance equity) and manual entries in the last months. Apex (AED, accountant u8): rent, an audit-fee accrual
reversed this month, depreciation, software with 5 % input VAT, a petty-cash top-up; exchange rates USD / EUR (two
dates) / SAR; TRN set. Crest (SAR, admin u101): Zakat paid, fleet depreciation, warehouse rent with 15 % input VAT,
bank charges; rates USD / AED / EUR; Arabic legal name; 2025 locked.

**Tests.** Endpoints in `src/shared/mocks/isolation/financeLedgerEndpoints.ts` (both directions, spoofing; foreign
account / dimension ids in bodies and the account filter in `REFS` of `scoped.isolation.test.ts`; seeded chart ids are
shared by design, so item samples use a company-unique `ACC-N…` account); roles × both companies, plan gate and
recomputed numbers in `src/app/isolation/financeLedger.isolation.test.ts`; rules in
`src/modules/finance/ledger/calc.test.ts` and `src/shared/mocks/services/financeLedger.test.ts`; browser
`e2e/finance-ledger.spec.ts`. Persisted dev DB: `VERSION` 27. Statements and the year-end close: see Financial statements and Year-end close below. Not built: foreign-currency
manual entries (lines are base currency), bank accounts as records (IBAN), a
tax-code screen, attachments on entries.

### Invoices

Sales invoices (UAE tax invoices, KSA standard / simplified tax invoices). Services
`src/shared/mocks/services/financeInvoices.ts` (endpoints, access), `financeInvoiceCore.ts` (lines, postings, issue /
void / credit, ZATCA stamp, recurring tick), `financeInvoiceSources.ts` (quotation / contract / won-deal lines),
`financeInvoiceSettings.ts` (reads Finance settings: VAT number, legal names EN / AR, prefix, terms, notes, default
revenue account, exchange rates — with company-profile fallbacks); stores `fin.invoices` (contract store; rows carry the
section fields below), `fin.creditNotes`, `fin.recurring`, `fin.zatcaChain` (`src/shared/mocks/data/financeInvoices.ts`,
seed `data/financeInvoicesSeed.ts`); pure rules `src/modules/finance/invoices/calc.ts`, `zatca.ts`; wire
`src/shared/api/financeInvoicesMappers.ts` (plain snake_case at any depth; `creditable` and `rates` are data-keyed maps).
Screens: `/finance/invoices` (`?tab=invoices|credit-notes|recurring`, `?status=`, `?customer=`, `?overdue=1`,
`?from=quotation|contract|won&id=` opens the source dialog prefilled, `?credit_note=`), `/finance/invoices/new`,
`/finance/invoices/:id`, `/finance/invoices/:id/edit` (drafts). "Create invoice" on an accepted quotation, a contract (row
menu; an accountant gets an invoice-only column) and a customer profile (won deal). Replaces the old billing stub of
`GET /finance/invoices`.

**Access.** `accounting` full (Company Admin, Management, Accountant): everything. view (Sales Manager): every GET of
the company's invoices, credit notes, schedules, meta and sources; every write `403` (the detail's `can.*` flags are all
false: no Issue / Edit / Void / Credit / Send / XML buttons). hidden: `403`. The ZATCA XML download is a POST (audited)
and full only.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/finance/invoices` | `status` (`draft · issued · partially_paid · paid · void · open · overdue`), `customer_id`, `from`, `to` (issue date; drafts by creation date), `overdue=true`, `q` (number / customer / milestone) | `InvoiceRow[]` (`overdue`, `days_overdue`, `base_total`, `base_balance_due` in base currency) |
| POST | `/finance/invoices` | `customer_id`, `customer_vat_number?`, `currency?`, `exchange_rate?`, `issue_date?`, `due_date?`, `payment_terms_days?` (0–365), `lines[] {description, service_id?, quantity, unit_price, discount? (amount), tax_code_id?, revenue_account_id?}`, `notes?`, `terms?`, `project_id?`, `event_id?` | draft `InvoiceDetail` |
| GET | `/finance/invoices/meta` | — | country, base currency, `zatca_enabled`, VAT number, terms, tax codes, income accounts, customers (+ last VAT no.), services, projects, events, default `rates`, `can_write` |
| GET | `/finance/invoices/sources` | — | accepted quotations (`net_total`, `invoiced_pct`) and non-cancelled contracts (`invoiced_pct` for one-off) |
| POST | `/finance/invoices/from-source` | one of `quotation_id`, `contract_id`, `lead_id` (won deal → its accepted quotation with something left, else its Won-flow contract); `percent?` (1–100, default: what is left), `milestone?` | draft `InvoiceDetail` (link kept: `quotation_id`, `contract_id`, `lead_id`, `billing_pct`, `milestone`) |
| GET | `/finance/invoices/:id` | — | `InvoiceDetail`: lines, totals, base totals, tax summary, seller (settings), customer (VAT no., email), journal entry (+ void reversal), credit notes, `creditable` per line, send log, history, `zatca`, `title` / `title_ar`, `can` |
| PATCH | `/finance/invoices/:id` | any POST field (drafts only) | `InvoiceDetail`; `409 not_draft` once issued |
| DELETE | `/finance/invoices/:id` | — | `{ ok }` (drafts only; `409 not_draft`) |
| POST | `/finance/invoices/:id/issue` | — | `InvoiceDetail`: number `<PREFIX>-INV-<yyyy>-<nnnn>` (frozen), issue date (default company today; no future date), due date (default issue + terms), kind, journal entry; KSA: the ZATCA stamp |
| POST | `/finance/invoices/:id/void` | `reason` (≥ 3 chars) | `InvoiceDetail` (status `void`, journal reversed on the company's today); `409 has_settlements` with payments / credit notes, `409 is_draft`, `409 already_void` |
| POST | `/finance/invoices/:id/send` | `to?` (default: the customer's decision-maker email), `message?` | `InvoiceDetail` with the send logged (`send_log[] {at, by_name, to, subject}`); simulated email; `409 not_issued` for drafts / void |
| POST | `/finance/invoices/:id/zatca-xml` | — | `{ filename, mime_type, content }` UBL 2.1 XML (audited `security`); `409 zatca_not_applicable` outside KSA |

**Rules.**
- Math (`calc.ts`): gross = qty × unit price; discount is an amount (≤ gross); net = gross − discount; VAT = net × rate,
  **rounded per line**; totals are sums; base = amount × `exchange_rate` rounded to 2 decimals.
- Customer, project, event, service, tax code and revenue account must belong to the caller's company (`422
  customer_not_found` / `project_not_found` / `event_not_found` / `service_not_found` / `invalid_tax_code` /
  `invalid_account`, identical for a foreign and a missing id). Revenue account default: service revenue for catalog
  lines, the Finance settings default revenue account for free text.
- Currency: the base currency has rate 1; another currency takes `exchange_rate`, else Finance settings › Exchange rates
  (latest on or before the issue date), else the published USD pegs; none → `422 rate_required`.
- KSA kind: buyer VAT number set → `tax_invoice` (standard, B2B), empty → `simplified` (B2C); a KSA VAT number has 15
  digits starting and ending with 3 (`422 invalid_vat_number`). UAE: always a tax invoice ("Tax Invoice", TRN of seller
  and buyer; VAT also shown in AED for foreign-currency invoices).
- Issue posts (base currency) **Dr Accounts receivable (total), Dr Sales discounts (line discounts), Cr revenue per line
  account (qty × price), Cr VAT output (VAT)**; a currency rounding difference goes to the `rounding` account. The entry
  is posted before the number is taken, so a refused post (`423 period_locked` from the lock date) leaves the draft
  untouched with no number used. Drafts never post. Issued invoices are immutable: credit note or void.
- From a quotation (must be `accepted`: `409 quotation_not_accepted`; the deal must be won: `409 no_customer`) or a
  one-off contract: at most 100% in total over non-void invoices (drafts count) — `409 already_invoiced`, `422
  exceeds_remaining`, `422 invalid_percent`. 100% at once copies the quotation lines; a partial share is one line of that
  share of the quotation's net, and the invoice that reaches 100% takes the exact remainder. Monthly / annual contracts
  bill one period per invoice (no cap).
- Notifications (stored, once, bell group **Finance**, type `finance`): invoice voided → its creator (unless they voided
  it themselves). Audit: create, update, delete, issue, void, send, XML download.
- `paid` / `partially_paid`, `amount_paid` / `amount_credited` / `balance_due` change only through `applyToInvoice`
  (`services/financeInvoiceBalance.ts`); overdue is derived (open, balance > 0, due before the company's today).

### Credit notes

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/finance/credit-notes` | `invoice_id?` | `CreditNote[]` |
| POST | `/finance/credit-notes` | `invoice_id`, `reason` (≥ 3), `date?` (default company today; not future, not before the invoice), `full: true` or `lines[] {invoice_line_id, amount}` (net, excl. VAT) | `CreditNote` (number `<PREFIX>-CN-<yyyy>-<nnnn>`) |
| GET | `/finance/credit-notes/:id` | — | `CreditNote` |
| POST | `/finance/credit-notes/:id/zatca-xml` | — | UBL XML (381, `BillingReference` to the invoice, reason in `InstructionNote`); KSA only |

Only issued / partially paid / paid invoices (`409 not_issued`). Each line can be credited up to its net still
creditable (`422 exceeds_line`, `422 nothing_to_credit`); VAT at the line's rate (a full remaining line credits its exact
VAT). Posts **Dr revenue (credited net) per account, Dr VAT output, Cr Accounts receivable (applied), Cr Customer
advances (excess)**. Applied = min(total, open balance) → `applyToInvoice(inv, { credited })`; the **excess** above the
open balance is customer credit (`excess_amount`, account `customer_advances` 2300) for the Collections section to
refund or apply. Journal entries of credit notes link to the invoice (`registerJournalSource('credit_note')`).

### Recurring invoices

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/finance/recurring-invoices` | — | `RecurringSchedule[]` |
| POST | `/finance/recurring-invoices` | `source_invoice_id` or `contract_id`; `frequency` (`monthly · quarterly · yearly`; contract default from its billing), `start_date` (default today), `end_date?`, `mode` (`draft` · `auto_issue`) | `RecurringSchedule` (`409 schedule_exists` for a source with a live schedule; the source invoice counts as period 1 when its issue date is the start) |
| GET | `/finance/recurring-invoices/:id` | — | `RecurringSchedule` |
| PATCH | `/finance/recurring-invoices/:id` | `frequency?`, `end_date?`, `next_date?`, `mode?`, `status?` (`active · paused · ended`) | `RecurringSchedule` (`409 schedule_ended`) |

Generation rides on the lifecycle tick (`onLifecycleTick('finance.recurring-invoices')`: lazy on every request and
`POST /dev/billing/advance`), only with the `accounting` module: every period whose date is on or before the **company's
today (its timezone)** is generated once (`generated[]` and the next date moving on, so re-running is a no-op; missed
periods are caught up). The invoice's issue date is the period date; `auto_issue` issues it (a refused post leaves a
draft and `last_error`). Every accounting-full user gets one stored `finance` notification per generated invoice; a
system audit entry is written.

### ZATCA

KSA companies (country `SA`: Crest) get the FATOORA phase-2 **data** on every issued invoice and credit note
(`zatca`): `uuid`, `icv` (Invoice Counter Value: per company, +1 per document, never reused; a voided invoice keeps its
ICV), `pih` (Previous Invoice Hash: the previous document's `invoice_hash`; the first is the spec's seed
`NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==`), `invoice_hash` (base64
SHA-256 over the UBL XML without the QR reference), `qr` (base64 of TLV: 1 seller name, 2 VAT number, 3 timestamp, 4
total incl. VAT, 5 VAT total), `type_code` 388 / 381, `subtype` 0100000 standard / 0200000 simplified,
`status: not_submitted`. The print shows the QR (`qrcode.react`, already a dependency) and bilingual Arabic + English
labels ("فاتورة ضريبية" / "فاتورة ضريبية مبسطة", Arabic legal name from Finance settings). The XML carries ProfileID, ID,
UUID, IssueDate / IssueTime, InvoiceTypeCode@name, document and tax currencies, the ICV / PIH / QR references, supplier
(CRN, address, VAT) and customer, delivery date, payment means (+ the reason for credit notes), both TaxTotals with
subtotals and exemption reasons, LegalMonetaryTotal and the lines.

**Not done here (backend):** CSID onboarding, the XAdES signature and UBL extensions, C14N 1.1 canonicalisation, and
clearance (B2B) / reporting (B2C) through the ZATCA API; the national address (building number, district, postal code)
is a placeholder until Finance settings hold it. The invoice screen says so. **UAE:** e-invoicing (Peppol PINT AE via an
accredited service provider) is a seam: the invoice data is kept; nothing is sent.

**Isolation and tests.** Every endpoint is in `src/shared/mocks/isolation/financeInvoicesEndpoints.ts` (spread into
`endpoints.ts`); ids in bodies / filters (customer, project, event, service, quotation, contract, lead, invoice, source
invoice) are in `REFS` (`scoped.isolation.test.ts`); roles × both companies, plan gate, foreign ids and a spoofed company
in `src/app/isolation/financeInvoices.isolation.test.ts`; rules in `src/shared/mocks/services/financeInvoices.test.ts`;
browser `e2e/finance-invoices.spec.ts`. Persisted dev DB: `VERSION` 28.

### Payments

Accounts & finance › Collections (`src/modules/finance/collections/types.ts`; services
`src/shared/mocks/services/financeCollections.ts`, `financeReceivables.ts`, `financeCollectionsCore.ts`; stores
`data/financeCollections.ts`; wire names snake_case via `src/shared/api/financeCollectionsMappers.ts`). Reads: accounting
**full** and **view** (Sales Manager); writes: **full** only (`403 forbidden` otherwise). Ids in bodies (customer,
invoices, accounts) must be the caller's company's (`422`, same answer as a missing id). Every write posts through
`postJournal` / `reverseJournal` (a date on or before the lock date → `423 period_locked`, nothing changes) and moves
invoice balances only through `applyToInvoice`. Collections data is seeded lazily per company on its first collections
call (`ensureCollectionsSeed`, from that company's issued invoices, dated after the lock date). Payment id `PAY-<n>`,
receipt number `<PREFIX>-RCT-<yyyy>-<nnnn>`. Journal sources `payment`, `payment_refund`, `pdc` are registered with the
ledger (number + link).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/payments?customer_id&invoice_id&method&status&from&to&q` | newest first |
| POST | `/finance/payments` | `{customer_id, date (≤ today), method (bank_transfer · cash · cheque · card), amount, currency?, exchange_rate?, bank_charges?, deposit_account_id?, reference?, notes?, allocation_mode (auto · manual · none), allocations?: [{invoice_id, amount}]}` → the payment |
| GET | `/finance/payments/:id` · `/finance/payments/:id/receipt` | receipt = payment + company branding (name, logo, address, tax no.) + customer |
| POST | `/finance/payments/:id/apply-credit` | `{date?, allocations?}` (empty = oldest due first); `409 no_credit` / `nothing_to_apply` |
| POST | `/finance/payments/:id/refund` | `{amount, date?, account_id?, reference?}`: from the credit first, then back off the newest allocations (those invoices re-open); `422 over_refund` |
| POST | `/finance/payments/:id/void` | `{reason}` required: reverses every entry of the payment and undoes its allocations; `409 payment_void`, `409 pdc_receipt` (a cleared cheque's receipt: refund instead) |
| POST | `/finance/credit-note-credits/:id/apply` · `/refund` | a credit note's `excess_amount` (customer credit kept in 2300 by the invoices section): same bodies as for a payment |
| GET | `/finance/deposit-accounts` | cash / bank accounts (children of 1100 + cash-type system roles) |
| GET | `/finance/customers/:id/open-items` | open invoices (`balance_due`, `pdc_held`, `available`) and credits (`kind` payment · credit_note) |

**Allocation rules.** A payment settles invoices of the same customer **in the same currency** (`422
currency_mismatch`); each allocation ≤ the invoice's `available` = balance − cheques held (`422 over_allocated`); the
sum ≤ the amount; the rest is **customer credit** (customer_advances 2300). `auto` = oldest due date first.
**Postings** (base currency; r = the payment's rate, rᵢ = each invoice's own rate): Dr deposit (amount − bank
charges)·r · Dr Bank charges (6800) charges·r · Cr AR Σ allocᵢ·rᵢ · Cr customer advances credit·r · the difference to
**fx_gain_loss** (credit = gain, debit = loss). Rates: the ledger's `rateFor` (Finance settings), a small fallback
table when none is effective, or the rate typed on the payment. Default deposit account: bank (transfer, card), cash
(cash), undeposited funds (cheque), payment gateway clearing (payment link). Each write is audited and logged on the
customer timeline (activities of the customer's Won lead) and on the invoice's `history`.

### PDC

Post-dated cheques. **Rule: a PDC secures invoices but does not pay them**: the invoice stays open (shown as secured,
`pdc_held`) until the cheque clears; then a receipt is recorded and the invoice is paid. A bounced cheque leaves it open.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/pdcs?status&customer_id` | by cheque date; `maturing_soon` (due within 7 days, held), `deposit_due` (held, due ≤ today) |
| POST | `/finance/pdcs` | `{customer_id, cheque_no, bank_name, received_date (≤ today), due_date (≥ received), amount, currency?, exchange_rate?, allocations?, notes?}`: Dr PDC receivable (1210) · Cr AR (linked invoices, own rates) · Cr customer advances (rest) ± FX; `409 duplicate_cheque` |
| GET | `/finance/pdcs/:id` | |
| POST | `/finance/pdcs/:id/deposit` | `{date?, deposit_account_id?}`: received → deposited; `409 not_due` before the cheque date; no posting |
| POST | `/finance/pdcs/:id/clear` | deposited → cleared: Dr bank · Cr PDC receivable; a receipt (`source: pdc`) pays the invoices (what an invoice can no longer take moves to customer credit) |
| POST | `/finance/pdcs/:id/bounce` | received / deposited → bounced: the received entry is reversed; optional `bounce_fee` (Dr Bank charges · Cr bank); the customer is flagged (`bounced_cheques`); the accountants and the customer's owner get a `finance` notification |

The lifecycle tick sends "Deposit cheque … today" to the accountants once per held cheque on its date (company
timezone). GL note: while a cheque is held, AR in the ledger is net of it; aging and statements show the invoice open,
"secured by cheque".

### Receivables

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/receivables/aging?as_of` | by customer, base currency: `current` (not yet due), `d30` (1–30), `d60` (31–60), `d90` (61–90), `over90`, `total`, `pdc_secured`, `credit`, totals. The CSV export is built client-side from this |
| GET | `/finance/receivables/aging/:customerId?as_of` | drill-down: invoices with `days_overdue`, `bucket`, `dunning_paused`, `last_reminder` |
| GET | `/finance/customers/:id/statement?from&to` | opening balance, lines (invoice · payment · credit_note · refund; debit / credit / running balance, base currency), closing balance, cheques held |
| POST | `/finance/customers/:id/statement/email` | `{from?, to?, email?}` (default: the billing contact) → `{sent_to}`; mock email, logged on the customer timeline |
| GET | `/finance/customers` | every customer with its credit position (credit-limits tab, pickers) |
| GET / PATCH | `/finance/customers/:id/credit` | `{credit_limit (null = none), credit_hold, dunning_paused}` (PATCH: full only) |
| GET | `/finance/credit-check?lead_id or customer_id&amount&currency` | any role with **sales or accounting**: `{level: ok · warning · blocked, mode, message, detail}`; `detail` (amounts) only for accounting view / full |
| GET / PATCH | `/finance/collections/settings` | `{dunning_enabled, dunning_steps: [{id, offset_days (−30…365), active, notify_owner}], credit_check_mode: warn · block, gateway_fee_pct (0–10), default_expiry_days (1–90)}` |
| GET | `/finance/dunning/log?invoice_id&customer_id` | `{outcome: sent · skipped, sent_to, offset_days, date}` |
| POST | `/finance/dunning/pause` | `{target_type: invoice · customer, target_id, paused}` |

**As-of balances:** today = the live balance; an earlier date = total − allocations dated ≤ it (a refunded allocation
counts until the refund date) − credit notes dated ≤ it. **Credit exposure** = open invoice balances − unapplied
customer credit (payments + credit-note excess), never below 0; **cheques held don't reduce it**. Quotation create /
send answer `409 credit_blocked` only when `credit_check_mode = block` and the customer is on hold or would exceed the
limit (default `warn`: the form shows a notice). **Dunning** runs on the lifecycle tick (company timezone) once the
company uses collections (its lazy seed has run): per open invoice not covered by cheques and not paused, the latest
due step is emailed once (mock email to the billing contact; logged on the invoice history, the customer timeline and
the dunning log); earlier unsent steps are logged `skipped` (no burst on a late start); steps with `notify_owner`
(default +30) notify the customer's owner.

### Payment links

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/payment-links?invoice_id&status` | `{url: /pay/<token>, amount, expires_at, status: active · paid · expired · void}` |
| POST | `/finance/payment-links` | `{invoice_id, expires_in_days?}`: the invoice's available balance; an earlier active link of the invoice is voided; `409 nothing_due` |
| POST | `/finance/payment-links/:id/void` | |
| GET | `/public/pay/:token` | **no auth**: only `{state: payable · paid · expired · unavailable, message, invoice_number, amount_due, currency, company_name, logo_url, monogram, test_mode}`. Unknown token, a company without accounting, a deleted / suspended workspace → `404 payment_link_not_found` |
| POST | `/public/pay/:token` | **no auth**, test mode: `{cardholder_name, card_number, expiry (MM/YY), cvc}` validated (Luhn, expiry, CVC) and dropped; only "Brand •••• last4" is kept. `4000 0000 0000 0002` → `402 card_declined`. Success records a `payment_link` payment to payment gateway clearing (1140; the gateway fee setting as bank charges), marks the link paid and notifies the accountants and the owner → `{paid, receipt_number, amount, currency}`. `409 link_paid / link_expired / link_unavailable`; rate-limited per client (`X-Client-Id`) and link (`429`) |

**Real gateways (seam).** `payPublic` stands in for a hosted checkout. A real integration (Telr, Tap, PayTabs, Stripe)
creates the gateway session when the link is created (`gateway`, `gateway_ref` on the link), redirects the customer to
the hosted page (card data never touches our servers: PCI SAQ-A) and records the payment from the signed **webhook**
(idempotent on `gateway_ref`), settling 1140 against the bank on the payout with the real fee.

**Isolation and tests.** Every endpoint is in `src/shared/mocks/isolation/financeCollectionsEndpoints.ts` (spread into
`endpoints.ts`); the public pay endpoints are `public` with reasons; customer / invoice ids in bodies and filters are in
`REFS` (`scoped.isolation.test.ts`); roles × both companies, the plan gate and "a token never shows or pays another
company's invoice" in `src/app/isolation/financeCollections.isolation.test.ts`; rules in
`src/shared/mocks/services/financeCollections.test.ts`; browser `e2e/finance-collections.spec.ts`. Persisted dev DB:
`VERSION` 29.

### Expenses

Accounts & finance › Expenses (`src/modules/finance/expenses/types.ts`, rules in `calc.ts`; services
`src/shared/mocks/services/financeExpenses.ts`, `financeExpensesClaims.ts`, `financeExpensesPetty.ts`,
`financeExpensesCore.ts`; stores `data/financeExpenses.ts`, seed `data/financeExpensesSeed.ts`; wire names snake_case via
`src/shared/api/financeExpensesMappers.ts`). Plan module `accounting` for every path. Company expenses: accounting
**full** writes, **view** (Sales Manager) reads, hidden → `403 forbidden`. Categories and the policy are readable by
every role (the claim form needs them); only full edits. Ids in bodies / filters (category, vendor, account, department,
project, event, campaign, petty fund) must be the caller's company's (`422 <thing>_not_found`, the same answer as a
missing id). Expense id `EXP-<n>`, number `<PREFIX>-EXP-<yyyy>-<nnnn>`; category id `ECAT-<n>`.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/expense-categories?include_inactive` | `{id, name, account_id, account_code, account_name, description, monthly_limit (base currency, claims; null = none), active}` |
| POST · PATCH | `/finance/expense-categories` · `/:id` | `{name, account_id (active, postable expense account), description?, monthly_limit?, active?}`; `409 duplicate_name` |
| GET · PATCH | `/finance/expense-policy` | `{receipt_required_above, receipt_mode (warn · block), claim_max_age_days, age_mode, limit_mode, base_currency, can_edit}` |
| GET | `/finance/expenses?status&category_id&vendor_id&payment_method&from&to&q` | newest first |
| GET | `/finance/expenses/meta` | categories, payment accounts (cash / bank under 1100, minus accounts holding petty funds), petty funds, tax codes, vendors (`eventVendors`, read only), departments, projects, events, campaigns, currencies with a rate |
| POST | `/finance/expenses/check-duplicate` | `{vendor_id? \| payee_name, amount, date, exclude_id?}` → `{duplicates: [...]}` (live expenses, same payee + amount + date) |
| POST | `/finance/expenses` | `{date (≤ today), vendor_id? \| payee_name, payee_vat_number?, category_id, description?, amount (VAT included), currency?, exchange_rate?, tax_code_id?, payment_method (card · bank_transfer · cash · petty_cash), paid_from_account_id \| petty_fund_id (petty_cash), reference?, department_id?, project_id?, event_id?, campaign_id?, receipt?, notes?}` → the expense (pending, or approved + posted when the chain is empty); `422 receipt_required` above the policy amount; `422 use_petty_fund` for a fund's account |
| GET · PATCH | `/finance/expenses/:id` | PATCH while pending and nobody approved (`409 expense_locked`); the chain is re-frozen |
| POST | `/finance/expenses/:id/approve` | the current step (`services/financeApprovals.ts`, chain `expense` by base amount); maker–checker `403 own_request` / `already_approved_step` / `not_your_step`; the last step posts |
| POST | `/finance/expenses/:id/reject` · `/void` | `{reason}` required; void of an approved expense reverses its entry on the company's today |

**VAT.** Recovered only when the tax code is standard-rated, the company is VAT registered and a **valid tax invoice**
exists: the payee's TRN (UAE: 15 digits starting `100`) / VAT number (KSA: 15 digits starting and ending with `3`).
Otherwise VAT = 0 and the whole amount is the expense (`vat_note` says why). **Posting** (base currency, `sourceType
expense`): Dr category account (net, with department / project / event) · Dr VAT input 1300 (VAT) · Cr paid-from (gross);
gross and VAT are converted, net is the remainder, so it always balances. Paid by petty cash → Cr the fund's account
and the fund's book balance drops. **Receipts** are `{name, size_bytes, mime_type (image/* · application/pdf), url (data
URL ≤ 256 KB, else null)}`, ≤ 10 MB, counted in the plan's `storageMb` (`expenseStorageBytes`, `assertCapacity`).

### Expense claims

Self-service for **every role** with an employee record (like leave): `422 no_employee_record` otherwise. Claim id
`ECL-<n>` (lines `ECLL-<n>`), number `<PREFIX>-ECL-<yyyy>-<nnnn>`. Status `draft → pending → approved → in_payroll →
reimbursed`, or `rejected`. **Visibility:** own claims; claims whose current step the user can act on; claims of the
department the user heads (or steps they approved); accounting full: all. Not visible → `404` (like a foreign id).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/expense-claims?view=mine\|approvals\|all&status&employee_id` | `mine` (default) own; `approvals` waiting on me; `all` everything I can see |
| GET | `/finance/expense-claims/meta` | categories, policy, currencies, projects, events, customers (the caller's sales scope), own employee, payment accounts (full), `next_payroll_month` |
| POST | `/finance/expense-claims` | own draft `{title?, notes?, lines: [{date ≤ today, category_id, description, merchant?, merchant_vat_number?, amount, currency?, exchange_rate?, receipt?, project_id?, customer_id?, event_id?}]}` |
| GET · PATCH · DELETE | `/finance/expense-claims/:id` | PATCH / DELETE: the owner's draft (`403 not_owner`, `409 claim_locked`) |
| POST | `/finance/expense-claims/:id/submit` | policy check: blocking warnings → `422 policy_blocked {warnings}`; freezes chain `expense_claim` by total (dept head → Accountant → Management ≥ 5,000) |
| POST | `/finance/expense-claims/:id/approve` · `/reject` | whoever can act on the current step (any role: a department head with accounting hidden approves their team's); maker–checker; reject needs `{reason}` |
| POST | `/finance/expense-claims/:id/reimburse` | accounting full: `{method: payment, account_id, date?}` → Dr 2450 / Cr bank, `reimbursed`; `{method: payroll}` → a one-off payroll adjustment of kind `reimbursement` in `next_payroll_month`, `in_payroll`; `409 not_approved` |

**Policy** (`warnings[]` on drafts and pending claims, `blocking` per mode): receipt above `receipt_required_above`, line
older than `claim_max_age_days`, the employee's per-category monthly total (other live claims included) over
`monthly_limit`. **Posting on final approval** (company today): Dr category accounts per line (net; department, project,
event, customer dimensions) · Dr VAT input (lines with a valid merchant TRN / VAT number) · **Cr 2450 Employee
reimbursements payable** (total).
**Payroll seam.** The adjustment comes from `upsertSystemAdjustment(co, {kind: 'reimbursement', sourceRef: 'claim:<id>'})`
(services/hrPayroll.ts). Kind `reimbursement` is not typed in HR (not in `ADJUSTMENT_KINDS`; HR edit / delete →
`409 managed_by_finance`); the payroll engine pays it as a pay item of type `reimbursement` — added to **net**, outside
gross and the social-insurance base (not taxable), with the variable part of the WPS split. The claim becomes
`reimbursed` when the run is paid (payroll event `run_paid`, plus a lazy re-sync on every finance access). The payroll
→ ledger posting (services/financePayrollGl.ts) clears 2450 for those items: `claimForPayrollAdjustment(co,
adjustmentId) → {claim_id, number, employee_id, amount, liability_account_id: ACC-2450} | null`.

### Petty cash

Imprest funds per custodian (an employee). Fund `PCF-<n>`; petty expense `PCE-<n>` number `<PREFIX>-PCE-…`;
movements `PCM-<n>` numbered `<PREFIX>-PCT-…` (top-up), `-PCR-…` (replenishment), `-PCC-…` (count). Accounting **full**:
every fund and action; the **custodian** (any role): their own fund — read and record expenses; anyone else: an empty
list and `404` on a fund.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/petty-cash/meta` | categories, employees / fund accounts / bank accounts (full only), receipt threshold |
| GET | `/finance/petty-cash/funds` | `{float_limit, book_balance, pending_total, pending_count, cash_expected, replenish_amount, low_balance, account_id, custodian_*, is_mine, can}` |
| POST | `/finance/petty-cash/funds` | full: `{name, custodian_employee_id, float_limit, account_id? (default ACC-1115), fund_from_account_id?, date?}` (funding = a top-up of the float) |
| GET · PATCH | `/finance/petty-cash/funds/:id` | detail with `expenses[]` and `movements[]`; PATCH name / custodian / float / active (`409 fund_has_pending` on close; `409 fund_account_locked`) |
| POST | `/finance/petty-cash/funds/:id/top-up` | full: `{amount, from_account_id, date?}` → Dr fund account / Cr bank |
| POST | `/finance/petty-cash/funds/:id/expenses` | custodian or full: `{date, category_id, payee_name, payee_vat_number?, description?, amount, receipt?}` (not posted; `422 insufficient_cash` above the cash expected; receipt per policy) |
| POST | `/finance/petty-cash/funds/:id/replenish` | full, **not the custodian** (`403 own_fund`): `{approve_ids? (default all pending), reject?: [{id, reason}], from_account_id, date?}` |
| POST | `/finance/petty-cash/funds/:id/count` | full: `{counted, reason (required when different), date?}` |

**Math and postings.** Book balance = Σ movements − approved company expenses paid from the fund; cash expected = book −
pending petty expenses; low balance = cash expected < 20% of the float (notification once to the custodian and the
accountants until it is back above). Replenishment (one entry): Dr expense accounts (+ VAT input) / Cr fund account
(the approved expenses) · Dr fund account / Cr bank (top-up = max(0, float − (book − approved))) → back to the float.
Count: difference = counted − expected; short → Dr 6950 rounding (over / short) / Cr fund; over → the reverse.
**Ledger account:** every fund defaults to 1115 Petty cash (funds then share it; 1115 = Σ funds). A company wanting one GL
account per fund adds a cash sub-account under 1100 and picks it on the fund (1115 itself stays postable, so no header
change breaks other sections).

**Notifications** (stored, type `finance`, once per record and event): expense / claim needs approval → the current
step's approvers; approved · rejected · in payroll · reimbursed → the requester; fund low → custodian + accountants;
fund replenished → custodian.

**Isolation and tests.** Every endpoint is in `src/shared/mocks/isolation/financeExpensesEndpoints.ts` (spread into
`endpoints.ts`); category / vendor / account / dimension / employee / fund / petty-expense ids are in `REFS`
(`scoped.isolation.test.ts`); roles × both companies, employee own claims, department head team, custodian own fund
and the plan gate in `src/app/isolation/financeExpenses.isolation.test.ts`; rules in
`src/shared/mocks/services/financeExpenses.test.ts`; browser `e2e/finance-expenses.spec.ts`. Persisted dev DB: `VERSION` 32.

### Suppliers

Accounts & finance › Purchases & payables (`src/modules/finance/purchases/types.ts`; services
`src/shared/mocks/services/financePurchases.ts` (endpoints, access), `financePurchasesCore.ts` (rules, postings),
`financeBillBalance.ts` (the ONE place a bill's paid / credited / balance / status change: `applyToBill`); stores
`data/financePurchases.ts`, seed `data/financePurchasesSeed.ts`; wire names snake_case via
`src/shared/api/financePurchasesMappers.ts`). **Suppliers are the event vendor directory** (`eventVendors`, Events ›
Vendors) — there is no second vendor table; finance keeps a **profile per vendor id** (VAT number, payment terms days,
default expense account, default tax code, currency, bank name, IBAN, notes). The IBAN is stored in full and served
masked `"•••• 1234"` everywhere; only the audited reveal returns it. Reads: accounting **full** and **view**; writes
and the reveal: **full** only (`403 forbidden`).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/suppliers` | every vendor of the company + profile fields (`has_profile`, `vat_number`, `payment_terms_days`, `currency`, `bank_name`, `iban_masked`) + `open_bills`, `open_balance_base`, `overdue_base`, `last_bill_date` |
| POST | `/finance/suppliers` | `{name, category? (VendorCategory, default other), contact_name?, email?, mobile?, vat_number?, payment_terms_days?, default_expense_account_id?, default_tax_code_id?, currency?, bank_name?, iban?, notes?}` → creates the vendor record (validated by the events library's `cleanVendor`) + the profile; `409 vendor_exists`; audited |
| GET | `/finance/suppliers/:id` | profile + recent bills and POs; `can_edit`, `can_reveal` |
| PATCH | `/finance/suppliers/:id` | profile fields (omitted = unchanged; `iban: ""` clears); `422 invalid_iban` (mod-97), `invalid_vat_number`, `invalid_terms` (0–365), `invalid_account`, `invalid_tax_code`; audited (the IBAN change shows masked) |
| POST | `/finance/suppliers/:id/reveal-iban` | `{iban}` — accounting full only, audited (`security`); `409 no_iban` |
| GET | `/finance/suppliers/:id/statement?from&to` | base currency: opening, lines (bill = credit, payment / debit note = debit, running balance), closing, company block; void documents are left out |
| GET | `/finance/purchases/meta` | **every employee** (pickers for purchase requests): suppliers (not blacklisted), purchase accounts (expense + non-cash assets), payment accounts (finance only), tax codes, departments, projects, events + budget lines, currencies + today's rates, `scope`, `my_department_id`, `match_tolerance_pct` |

### Purchase orders

PO id `PO-<n>`, number `<PREFIX>-PO-<yyyy>-<nnnn>` (taken on create). Statuses `draft → pending_approval → approved →
partially_received → received → closed`, plus `rejected` (edit and resubmit) and `cancelled`. **No ledger posting.**
Lines: `description, quantity, unit_price, tax_code_id, account_id, department_id, project_id, event_id,
budget_line_id` (+ computed `net, tax_amount, total, received_qty, billed_qty`). Defaults: account from the supplier
profile (else by vendor category; Events 6450 for an event line), tax from the profile (else standard VAT when the
supplier has a VAT number, else OOS).

**Access — self-service.** Any employee of the company (accounting hidden too) may create a PO **request for their own
department** (`403 own_department_only` otherwise; finance may choose any department) and sees, edits (draft /
rejected), submits, cancels and receives **their own** requests. A **department head** also sees their department's POs.
Whoever can act on the step waiting (`canApproveStep`, services/financeApprovals.ts) sees that PO and approves /
rejects it — department heads without accounting access included. Accounting **full / view** see every PO; full may
close and bill. A PO the caller can't see answers `404` (like a missing id).

**Approvals.** The chain is `approvalChain(co, 'purchase_order', total incl. VAT in base currency)` (default bands:
department head from 0, + Accountant from 10,000, + Management from 50,000), frozen on submit; an empty chain approves
at once. Steps are decided in order; maker–checker (`403 own_request`), one step per user (`403 already_approved_step`),
`403 not_your_step`. Notifications (type `finance`, stored, once per step): "Approval needed" to the step's approvers;
"approved" / "rejected" to the requester.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/purchase-orders?status (… · open)&vendor_id&view (mine · awaiting)` | rows with `pending_step`, `awaiting_me`, `mine` |
| POST | `/finance/purchase-orders` | `{vendor_id, department_id?, order_date?, expected_date?, currency?, exchange_rate?, notes?, delivery_address?, lines}`; `422 vendor_blacklisted` |
| GET · PATCH · DELETE | `/finance/purchase-orders/:id` | detail: lines, approvals timeline, receipts, bills, history, company + supplier blocks (printable PO), `can.*`; PATCH draft / rejected only (`409 not_editable`); DELETE draft only |
| POST | `/finance/purchase-orders/:id/submit` · `/approve` · `/reject` | reject `{reason}` (`422 reason_required`); `409 not_draft` / `not_pending` |
| POST | `/finance/purchase-orders/:id/cancel` | `{reason}`; not after receipts or bills (`409 has_activity`) |
| POST | `/finance/purchase-orders/:id/receive` | goods / service receipt `{date?, note?, lines: [{line_id, quantity}]}`; ≤ ordered − received (`422 over_received`); status → partially_received / received; closed when fully received and billed |
| POST | `/finance/purchase-orders/:id/close` | finance: no further receipts or bills |

### Bills

Bill id `BILL-<n>`, number `<PREFIX>-BILL-<yyyy>-<nnnn>`; `supplier_invoice_number` is required and **unique per
supplier** among non-void bills (`409 duplicate_supplier_invoice`). Due date = bill date + the supplier's terms unless
given. Statuses `draft · pending_approval · rejected · open · partially_paid · paid · void`; "overdue" is derived (open
with a balance, due before the company's today). Writes: accounting **full**; reads: full / view; approvers without
accounting access see only the bills waiting for (or decided by) them (list filtered, other ids 404).

**From a PO** (`po_id`; the PO must be approved / partially received / received): lines prefilled with what is received
(3-way, once the PO has receipts) or ordered (2-way) minus already billed (`409 nothing_to_bill`). **Matching**: unit
price within `match_tolerance_pct` (default 2 %, Approval rules screen) of the PO; billed quantity ≤ received (3-way) or
ordered (2-way); the bill's `match` = `{kind none · two_way · three_way, ok, tolerance_pct, issues[]}`.

**Posting** (base currency = amount × rate; a rounding difference → `rounding`): Dr each line's account (net, **plus
VAT when not recoverable**) with department / project / event dimensions · Dr VAT input (1300) the recoverable VAT —
only when the supplier has a VAT number **and** the line's tax code is standard · Cr AP (2100) the total. Journal source
type `bill` (bills, debit notes and payments; registered with the ledger for number + link). Lock date → `423
period_locked`, nothing changes (an approval that would post is undone).

**Approval / post.** `submit` runs `approvalChain(co, 'bill', total base)` (default: Accountant from 0, + Management
from 50,000); the final approval posts. `post` (accounting full) skips the chain only when the bill is **matched to an
approved PO without exceptions** or the chain is empty (`409 approval_required` otherwise).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/bills?status (… · open · awaiting)&vendor_id&po_id&overdue=true&q` | rows with `base_total`, `base_balance_due`, `overdue`, `match_ok`, `awaiting_me` |
| POST | `/finance/bills` | `{vendor_id or po_id, supplier_invoice_number, bill_date? (≤ today), due_date?, currency?, exchange_rate?, notes?, lines? (with po_line_id)}` |
| GET · PATCH · DELETE | `/finance/bills/:id` | detail: lines (`vat_recoverable`), totals, `recoverable_tax`, match, approvals, journal / void journal, payments, debit notes, attachments, history, `can.*`; PATCH / DELETE draft or rejected, never posted |
| POST | `/finance/bills/:id/submit` · `/post` · `/approve` · `/reject` | see above; reject `{reason}` |
| POST | `/finance/bills/:id/void` | `{reason}`; reverses the entry on today; `409 has_settlements` with payments or debit notes |
| POST | `/finance/bills/:id/attachments` | `{name, mime_type (pdf · png · jpeg · webp), data_url}` ≤ 512 KB, ≤ 10 per bill; counts toward the plan's `storageMb` (`402` when full) |
| DELETE | `/finance/bills/:id/attachments/:attachmentId` | |
| GET | `/finance/debit-notes?bill_id&vendor_id` | |
| POST | `/finance/debit-notes` | `{bill_id, date?, reason, amount (gross, ≤ balance), account_id?}` → id `DN-<n>`, number `<PREFIX>-DN-<yyyy>-<nnnn>`; Dr AP · Cr the bill's (or given) account (net share) · Cr VAT input (the bill's recoverable VAT share); reduces the bill (`amount_credited`) |
| GET | `/finance/bill-payments?vendor_id&bill_id&run_id` · `/finance/bill-payments/:id` | voucher data: supplier bank name + masked IBAN, allocations, journal, company block |
| POST | `/finance/bill-payments` | `{vendor_id, date?, payment_account_id (paymentAccountsOf), method (bank_transfer · cheque · cash), reference?, exchange_rate?, bank_charges? (base), allocations: [{bill_id, amount}], notes?}`; same supplier and currency; each ≤ balance; partial payments allowed. Dr AP Σ allocᵢ × billRateᵢ · Cr payment account amount × payRate · the difference → `fx_gain_loss` · Dr Bank charges (6800) / Cr payment account. Id `BPAY-<n>`, number `<PREFIX>-PV-<yyyy>-<nnnn>` |
| POST | `/finance/bill-payments/run` | payment run `{date?, payment_account_id, method?, reference?, items: [{bill_id, amount}]}` → one payment (voucher) per supplier and currency, all validated before anything posts; id `PRUN-<n>` |
| GET | `/finance/payment-runs` | |
| POST | `/finance/bill-payments/:id/void` | `{reason}`; reverses the entry; the bills re-open (`applyToBill`) |
| GET | `/finance/payables/aging?as_of` | by supplier: current, 1–30, 31–60, 61–90, 90+ (days past due at the date, company timezone), base currency at each bill's rate; an earlier date rebuilds balances from payments / debit notes dated on or before it |
| GET | `/finance/payables/due?days=7` | open bills due within `days` (and overdue) |
| GET | `/finance/payables/overview` | tile data (also exported as `payablesOverview(co)`): open, overdue, due this week, approvals waiting, open POs |
| GET | `/finance/event-costs?event_id` | SEAM with Events › budget: what posted bills charged to the event per budget line (`billed`, base cost incl. non-recoverable VAT) next to the line's `planned` / `actual` |

Notifications (type `finance`, stored, once only): approvals as for POs; **"Bill due soon"** to the accounting-full
users once per bill when it is due within 3 days (lifecycle tick `finance.bill-due-reminders`).

### Approval rules

One settings screen (Finance settings › Approval rules card) for the shared contract in
`src/shared/mocks/services/financeApprovals.ts` (bands per document type: `purchase_order`, `bill`, `expense`,
`expense_claim`). Read: accounting full / view; edit: **Company Admin and Accountant** (`403` otherwise); audited.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/approval-rules` | `{base_currency, rules: [{doc_type, min_amount, approver}], doc_types, match_tolerance_pct, can_edit, updated_at, updated_by_name}` |
| PUT | `/finance/approval-rules` | `{doc_type, rules: [{min_amount ≥ 0, approver (department_head · Accountant · Management · Company Admin)}], match_tolerance_pct? (0–25)}` replaces that document type's bands (≤ 8; each approver once: `422 duplicate_approver`; `[]` = no approval needed). Documents already submitted keep their frozen chain |

### Bank accounts

`/finance/banking`. A bank account is a record on top of the ledger: it points at one postable account under
`1100 Cash and bank` (`ledger_account_id`; when none is chosen a new one `ACC-NB-<n>` is created with the next free
code from 1121). Balances come from the journal lines on that account (account currency: for a foreign-currency account
the amount banking posted, else base ÷ the day's rate). Account number / IBAN are stored full and served masked
(`account_number_masked`, `iban_masked`: `•••• 1234`). Read: accounting full / view (Sales Manager); write: accounting
full. Ids `BNK-` (Apex from 1001, Crest from 5001). Seeds: Apex "Main bank account" (1120, Emirates NBD), Cash on hand
(1110), ADCB savings (1121), Mashreq **USD** (1122); Crest Main (1120, Al Rajhi), Cash on hand, Riyad Bank (1121).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/bank-accounts?include_inactive=` | `[{id, name, bank_name, kind (current · savings · deposit · cash · card), account_number_masked, iban_masked, currency, ledger_account_id/code/name, active, is_default, book_balance, book_balance_base, statement_balance, statement_balance_date, last_reconciled_date, last_reconciled_balance, unmatched_lines, reconcile_from, opening_balance, opening_date, notes}]` |
| GET | `/finance/bank-accounts/ledger-options` | postable cash / bank accounts not linked yet `[{id, code, name, currency}]` |
| POST | `/finance/bank-accounts` | `{name, bank_name?, kind?, currency? (base), account_number?, iban? (validated), ledger_account_id? (an unlinked account under 1100 in the same currency: else 422 invalid_account / 409 ledger_account_in_use), opening_balance?, opening_date?, reconcile_from?}`; a non-zero opening balance posts the account vs `opening_balance_equity` (source `opening_balance`, `source_id` = the bank account). Audited |
| GET | `/finance/bank-accounts/:id` | one row |
| PATCH | `/finance/bank-accounts/:id` | name, bank_name, kind, account_number, iban, active, notes, reconcile_from (`409 has_reconciliations` once reconciled); currency and ledger account are fixed |
| POST | `/finance/bank-accounts/:id/reveal` | accounting full: `{id, account_number, iban}` in full — audited (`security`), the only response carrying them |
| GET | `/finance/bank-transfers?bank_account_id=` | `[{id, number <PREFIX>-TRF-yyyy-nnnn, date, from_bank_account_id, from_name, to_bank_account_id, to_name, amount_from, from_currency, amount_to, to_currency, fee, fx_difference, reference, memo, status (posted · void), journal_entry_id, journal_number, void_journal_entry_id}]` |
| POST | `/finance/bank-transfers` | `{from_bank_account_id, to_bank_account_id, amount_from, amount_to? (required when the currencies differ; equal to amount_from otherwise), fee?, date?, reference?, memo?}` → source `bank`: Dr to (amount_to at its rate) / Cr from (amount_from + fee at its rate) / Dr 6800 bank charges (fee) / the base difference to `fx_gain_loss` (Dr loss, Cr gain) |
| POST | `/finance/bank-transfers/:id/void` | reverses the entry (`409 reconciled` when a line is in a finished reconciliation) |

### Reconciliation

Statements are imported per bank account and matched to the **journal lines posted to the account's ledger account**
(every money movement — customer payments, PDC clearing, bill payments, expenses, payroll — lands there). A journal line
is named `<entry id>:L<index>`. Amounts are signed in the account currency (+ money in, − money out).

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/bank-accounts/:id/statements` | `[{id STM-, bank_account_id, file_name, start_date, end_date, line_count, matched_count, skipped_duplicates, closing_balance, imported_by_name, imported_at}]` |
| POST | `/finance/bank-accounts/:id/statements/preview` | `{csv, mapping?}` → `{columns, sample, suggested_mapping, lines [{row, date, description, reference, amount, balance, duplicate, error}], errors, duplicates, total_in, total_out, start_date, end_date, closing_balance}`; nothing stored. Mapping (0-based column indexes, guessed from the header): `{date, description, reference?, amount? or debit + credit, balance?, date_format (yyyy-MM-dd · dd/MM/yyyy · MM/dd/yyyy · dd-MM-yyyy · dd.MM.yyyy · d MMM yyyy), has_header, invert_sign?, delimiter?}`. ≤ 1 MB, ≤ 5000 rows |
| POST | `/finance/bank-accounts/:id/statements` | `{csv, file_name?, mapping?, include_duplicates? (false)}` → the statement with its lines. Duplicate = same date, amount, description and reference as a line already imported for the account (or earlier in the file): skipped unless included. `422 invalid_lines`, `422 empty_statement` |
| GET | `/finance/bank-statements/:id` | with `lines [{id SL-, date, description, reference, amount, balance, match_id, reconciled, rule_id, rule_account_id}]`, `can_delete` |
| DELETE | `/finance/bank-statements/:id` | only without matched lines (`409 has_matches`) |
| GET | `/finance/bank-accounts/:id/reconcile?to=` | `{bank_account, statement_lines (unmatched), book_lines (unmatched, from reconcile_from: [{id, entry_id, entry_number, date, memo, description, source_type, source_number, amount, match_id, reconciled}]), matches (open session), suggestions [{statement_line_id, journal_line_ids, score, reasons}], statement_date, statement_balance, cleared_balance, difference, last_reconciliation}` |
| POST | `/finance/bank-accounts/:id/matches` | `{statement_line_ids, journal_line_ids}` — 1-to-1, 1-to-many, many-to-1; sums must be equal (`422 amounts_differ`); `409 already_matched`; lines before `reconcile_from` are the opening position (`422 before_reconcile_from`) |
| POST | `/finance/bank-accounts/:id/auto-match` | accepts every suggestion — same amount (required, 50) · date within ±3 days (required, 30 − 5 a day) · the statement description / reference contains a document number of the entry (journal number, payment / transfer number, a `XXX-YYY-2026-0001` number in the memo: 20); best first, each line once; `auto_matched` |
| DELETE | `/finance/bank-matches/:id` | unmatch (`409 reconciled` inside a finished reconciliation) |
| POST | `/finance/bank-statement-lines/:id/create-entry` | `{account_id? (default: the bank rule's), memo?, description?, save_rule?, rule_contains?}` → posts bank vs account (source `bank`, `source_id` = the line) and matches it (kind `created`) |
| POST | `/finance/bank-accounts/:id/reconciliations` | finish `{statement_date? (last line), statement_balance? (running balance)}`; needs **statement balance − cleared book balance = 0** (`422 difference_not_zero`); cleared = book lines before `reconcile_from` + book lines matched to statement lines dated ≤ the statement date; those matches become reconciled. `409 already_reconciled` for a date not after the last one |
| GET | `/finance/bank-reconciliations?bank_account_id=` | `[{id REC-, bank_account_id, bank_account_name, statement_date, statement_balance, cleared_balance, difference, status (finished · undone), match_count, journal_line_count, finished_by_name, finished_at, undone_at}]` |
| GET | `/finance/bank-reconciliations/:id` | the report: `+ currency, book_balance, outstanding_deposits, outstanding_payments, unmatched_statement_lines, adjusted_book_balance (= book − outstanding), can_undo` |
| POST | `/finance/bank-reconciliations/:id/undo` | the latest finished one of the account only (`409 not_latest`) |
| GET · POST | `/finance/bank-rules` | `[{id BR-, name, contains, direction (any · in · out), account_id, account_code, account_name, bank_account_id, active}]`; POST `{contains, account_id, direction?, bank_account_id?, name?}` |
| PATCH · DELETE | `/finance/bank-rules/:id` | edit / delete |

**Reconciled lines are locked:** reversing an entry with a line in a finished reconciliation answers `409 reconciled`
(`POST /finance/journal/:id/reverse` via the ledger's reverse guard, transfer voids, payroll reopen) until it is undone.
**Alert** (`finance`, once per account and statement): a statement line still unmatched 30 days after its date → accountants.

### Payroll posting

HR payroll posts itself (services/financePayrollGl.ts: `onPayrollEvent` in services/hrPayroll.ts + an idempotent sync on
every finance access). Source `payroll`, `source_id` = the run / loan / settlement; the journal links to `/hr/salary?run=…`.

| Event | Entry |
|---|---|
| run **approved** (dated the period end) | Dr 6100 basic, overtime, bonuses · Dr 6110 allowances · Dr 6130 employer social insurance · Dr 2400 commission earnings (already accrued on the statement) · Dr 2450 reimbursement items (owed through the claim) / Cr 2400 net pay · Cr 2410 employee + employer social insurance · Cr 1410 loan installments · Cr 6100 unpaid leave / absence · Cr 4900 other deductions. Department dimension per employee |
| run **paid** (dated the paid day) | Dr 2400 / Cr the paid-from account (default bank): one line = the WPS / Mudad total (bank and cheque lines with a positive net), one line = cash withdrawn for cash-paid employees |
| run **reopened** | the accrual is reversed (posted again on the next approval) |
| loan / advance created · cancelled | Dr 1410 / Cr default bank · reversed |
| final settlement **paid** | Dr 6120 gratuity (EOSB expensed at settlement — no monthly provision, 2500 untouched) · Dr 6100 unpaid salary and leave encashment · Dr 6110 / Cr 4900 adjustments · Cr 1410 open loans · Cr bank (total) |

Dated on or before the lock date → skipped (`skipped_locked`), never shifted; a failure stays on the posting (`error`)
and is retried on the next finance access — payroll is never blocked.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/payroll-postings` | per run `{run_id, month, run_status, currency, status (not_posted · accrued · paid · reversed · skipped_locked · error), accrual_entry_id/number, payment_entry_id/number, reversal_entry_ids, paid_from_account_id/name, totals {gross, net, employee_social_insurance, employer_social_insurance, loan_repayments, other_deductions, bank_paid, cash_paid}, note, run_link}` (accounting full / view) |
| GET | `/finance/payroll-postings/:runId` | one run (HR's run drawer shows the entry links to users who can see accounting) |
| PUT | `/finance/payroll-postings/:runId/paid-from` | `{account_id}` a cash / bank account (accounting full; `409 run_paid` once paid) |

### Commissions

`/finance/commissions` and `/sales/my-commissions`. Plans: read accounting full + Sales Manager; write Company Admin,
Management, Accountant. Statements: accounting full all; Sales Manager every sales agent + their team; Department Head
their team; everyone else **their own** only (another rep's statement answers 404). Ids `CPL-`, `CST-`.

| Method | Path | Notes |
|---|---|---|
| GET | `/finance/commission-plans` | `[{id, name, basis (collected_revenue · won_deals), rate, tiers [{min_achievement, rate}], cap_per_month, clawback, roles, user_ids, user_names, effective_from (yyyy-MM), active}]` |
| POST · PATCH | `/finance/commission-plans` · `/:id` | those fields (rates 0–100; at least one role or user; company users only: `422 invalid_user`). Audited |
| GET | `/finance/commissions/mine` | `{plan, statements}` of the caller (any role; Sales Agents included) |
| GET | `/finance/commission-statements?month=&user_id=&status=` | `[{id, number <PREFIX>-COM-yyyy-nnnn, user_id, user_name, month, plan_id, plan_name, basis, currency, achievement (sales-target completion %), rate, base_total, gross, capped, clawback, total, status (pending_manager · pending_accountant · approved · rejected), lines [{kind invoice · deal · clawback, ref_id, ref_number, customer_name, date, base_amount, rate, commission, note}], approvals, rejected_reason, journal_entry_id (null without accounting access), journal_number, payroll_adjustment_id, payroll_month, payroll_note, can_approve, approve_blocked_reason}]` |
| POST | `/finance/commission-statements/generate` | `{month}` (accounting full): one statement per rep with a plan (pending ones without approvals are recalculated; nothing to pay → none). **Collected revenue** = net before VAT (base currency, less credit notes) of invoices fully paid in the month (latest allocation date) whose customer the rep owns (`customers.owner_id`); **won deals** = `leads.value` of the rep's leads won in the month. Rate = the highest tier reached by the month's target completion (services/targets.ts `rowFor`), else the base rate; monthly cap; each invoice / deal once. **Clawback**: a commissioned invoice later credited / refunded / voided adds a `clawback` line (commission paid − rate × still earned) |
| GET | `/finance/commission-statements/:id` | one statement |
| POST | `/finance/commission-statements/:id/approve` | step 1 Sales Manager, step 2 Accountant (Company Admin / Management stand in for either); never the rep (`403 own_request`), never one user for both (`403 not_your_step`). Final approval: **Dr 6150 / Cr 2400** (source `payroll`, `source_id` the statement) and an HR adjustment of kind `commission` in the next open run (`upsertSystemAdjustment`, `source_ref commission:<id>`, once per statement); not an employee → `payroll_note` |
| POST | `/finance/commission-statements/:id/reject` | `{reason}` by whoever may approve the current step |

Notifications (`finance`, once): statement awaiting approval → Sales Managers (step 1) / accountants (step 2); approved → the rep.

### Financial statements

`/finance/statements?tab=pnl|balance-sheet|cash-flow|general-ledger|trial-balance|year-end`. Every number comes **only
from the journal** (every finance section posts there), in the company's base currency. Services
`src/shared/mocks/services/financeStatements.ts`, pure math `src/modules/finance/statements/calc.ts`, types
`src/modules/finance/statements/types.ts`, wire `src/shared/api/financeStatementsMappers.ts` (plain snake_case at any
depth), exports `src/modules/finance/statements/exports.ts` (one table per statement → CSV and Excel through
`reports/lib/exportExcel`; print / PDF through the browser with the company letterhead: legal name, address, tax number).

**Who.** Every read: accounting **full** and **view** (Sales Manager); hidden → `403 forbidden`. Plan gate `/finance/*`
→ `accounting`. Query ids that aren't the company's (department / project / event / customer / account) match nothing:
the answer equals the one for a missing id (never echoed back).

**Periods** (P&L, cash flow): `period=month|quarter|ytd|fiscal_year|custom` around `date` (default the company's today;
quarters are fiscal quarters from `fiscal_year_start_month`), or `period=custom&from=&to=` (`422` without `from`, `from`
after `to`, more than ten years). Default `ytd` (fiscal year start → today). Dates `yyyy-MM-dd` (`422` otherwise).

| Method | Path | Query | Answer |
|---|---|---|---|
| GET | `/finance/statements/meta` | — | `currency, today, fiscal_year_start_month, fiscal_year_start, lock_date, letterhead {legal_name, name, logo_url, monogram, address_lines, tax_label, tax_number}, accounts[{id, code, name, type, is_header}], departments, projects, events, customers` (`[{id, name}]` of the company, for the filters; view roles included), `can_close, can_reopen` |
| GET | `/finance/statements/profit-and-loss` | period (above), `compare=previous_period,last_year`, `view=period\|monthly`, `department_id, project_id, event_id, customer_id` | `currency, view, period, columns[{key (current · previous_period · last_year · yyyy-MM · total), label, from, to}], sections[{id (revenue · cost_of_sales · operating_expenses · other_income · other_expenses), label, lines[{account_id, code, name, amounts[]}], totals[]}], totals {revenue, cost_of_sales, gross_profit, operating_expenses, operating_profit, other_income, other_expenses, net_profit}` (one number per column), `dims {department_id, project_id, event_id, customer_id}, dim_names {department, project, event, customer}`. Sections by account subtype: `operating_income` → revenue (other income subtypes too, except `other_income`), `cost_of_sales`, `operating_expense` (and unknown expense subtypes), `other_income`, `other_expense`; amounts on the natural side (a debit balance on revenue, e.g. sales discounts, is negative). Gross = revenue − cost of sales; operating = gross − operating expenses; net = operating + other income − other expenses. **Closing entries (`year_end_close`) are excluded**, so a closed year still shows its activity. Dimension filter: only the lines carrying every given value. `previous_period` = the range right before (as many whole months for a month-aligned range, else days); `last_year` = the same dates a year earlier. `view=monthly`: the 12 months ending with the period's last month + a `total` column (comparisons ignored) |
| GET | `/finance/statements/balance-sheet` | `as_of` (default today), `compare_to` | `currency, columns[{key current · compare, label, to}], sections[{id (current_assets · fixed_assets · other_assets · current_liabilities · non_current_liabilities · equity), group (assets · liabilities · equity), label, lines[{key, kind (account · current_year_earnings · prior_years_earnings), account_id, code, name, amounts[]}], totals[]}], totals {assets, liabilities, equity, liabilities_and_equity, difference}, balanced`. Equity = equity accounts + **current-year earnings** (income − expenses from the fiscal-year start to `as_of`, closing entries included, so after a close it is 0 and the result sits in retained earnings) + **prior years' earnings (not closed)** when non-zero. Assets = Liabilities + Equity whenever the journal balances (`difference` 0). Accumulated depreciation shows as a negative fixed asset |
| GET | `/finance/statements/cash-flow` | period (above) | `currency, from, to, operating {net_profit, adjustments[], working_capital[], total}, investing {lines[], total}, financing {lines[], total}, net_change, opening_cash, closing_cash, check, reconciles, cash_accounts[{account_id, code, name, opening, closing}]`; lines `{kind, account_id, code, name, amount}` (cash effect, + = in). **Indirect method** from the period's entries except closing and opening-balance entries (an opening balance is brought forward: it counts in `opening_cash`). Adjustments: accumulated depreciation (fixed-asset account named …depreciation / amortisation) and end-of-service / gratuity / provision non-current liabilities; working capital: other current assets (AR, PDC, VAT input, prepaid, advances) and current liabilities (AP, VAT output, payroll, accruals, customer advances); investing: other fixed and other assets; financing: equity and other non-current liabilities (loans). Cash = the accounts under the cash / bank header + the cash roles (as the overview). `check = net_change − (closing_cash − opening_cash)` is 0 when it reconciles |
| GET | `/finance/statements/general-ledger` | `from, to` (default fiscal year to date), `account_id` (a header: its descendants), `account_from, account_to` (codes, inclusive), `exclude_closing=true`, the four dimension ids | `currency, from, to, accounts[]` (the `/accounts/:id/ledger` shape per postable account with an opening balance or lines: `opening_balance, rows[], totals, closing_balance`), `totals {debit, credit}, exclude_closing`. Used for the P&L drill-down (`exclude_closing=true` + the P&L's filters) |
| GET | `/finance/statements/trial-balance` | `as_of` (default today), `compare_to` | `currency, columns[], rows[{account_id, code, name, type, debit[], credit[]}], totals {debit[], credit[]}, balanced[]` (one value per column). The Journal page keeps its own single-date trial balance (`/finance/reports/trial-balance`) |

**Reusable readers** (server side, for profitability / company performance; they run the finance hooks first):
`profitAndLoss(companyId: string, from: string, to: string, dims?: StatementDims): PnlPeriod`,
`balanceSheet(companyId: string, asOf: string): BalanceSheetPeriod`,
`cashFlow(companyId: string, from: string, to: string): CashFlowStatement` in `services/financeStatements.ts`; the pure
`profitAndLossOf(accounts, entries, from, to, dims?)`, `balanceSheetOf(accounts, entries, asOf, fiscalYearStartMonth)`,
`cashFlowOf(accounts, entries, from, to, currency)`, `combinePnl`, `sumPnl`, `generalLedgerOf`, `trialBalanceCompare`,
`closingLinesOf`, `fiscalYearOf`, `periodRange`, `comparisonRange`, `monthsEnding`, `pctChange` in `statements/calc.ts`.

### Year-end close

Closing a fiscal year posts **one closing entry** dated its last day (source type **`year_end_close`**, added to
`JournalSourceType`; `source_id` the close record `YEC-<n>`): every income and expense account's net for the year
(closing entries excluded) to zero, the difference to the `retained_earnings` account (3200). Then the lock date moves
to that day through the audited lock-date service (`setLockDate`, audit entity `finance_lock_date`), unless the books
are already locked later. The close itself is audited (entity `year_end_close`). Store `fin.yearEndCloses`
(`data/financeStatements.ts`); a re-open keeps the row (`reopened`) and a new close adds a new one. Closing entries
can't be reversed from the Journal (`409 source_document`): re-open the year.

**Who.** Lists and previews: full and view. **Close**: Company Admin and Accountant (it moves the lock date):
Management → `403 year_end_forbidden`, Sales Manager → `403 forbidden`. **Re-open**: Company Admin only
(`403 reopen_forbidden`), with a reason.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/finance/year-end` | — | `currency, today, fiscal_year_start_month, lock_date, retained_earnings {account_id, code, name}, years[{start, end, label (FY 2026 · FY 2025/26), status (open · closed · in_progress), net_profit, close_id, closed_at, closed_by_name, entry_id, entry_number, can_close, close_blocked_reason, can_reopen, reopen_blocked_reason}]` (newest first, from the year of the first journal entry to the current one), `history[]` (closes incl. re-opened: `id, fiscal_year_start, fiscal_year_end, status, net_profit, entry_id, entry_number, reversal_entry_id, reversal_entry_number, previous_lock_date, note, closed_at, closed_by_name, reopened_at, reopened_by_name, reopen_reason`), `can_close, can_reopen` |
| GET | `/finance/year-end/preview` | `fiscal_year_end` (default: the oldest ended open year with activity, else the latest ended year, else the current one) | `currency, start, end, label, retained_earnings, lines[{account_id, code, name, type, debit, credit}], totals, net_profit, lock_date, new_lock_date, can_close, blocked_reason`. `422 invalid_fiscal_year` when the date isn't a fiscal-year end |
| POST | `/finance/year-end/close` | `{ fiscal_year_end*, note }` | `{ close, lock_date }`. `409 year_not_ended`, `409 already_closed`, `409 earlier_year_open` (an earlier year with income / expense is still open), `409 missing_system_account`, `423 period_locked` (books locked on or after the year end: move the lock date first), `422 invalid_fiscal_year` |
| POST | `/finance/year-end/closes/:id/reopen` | `{ reason* }` | `{ close, lock_date }`: the lock date goes back to the one before the close (audited, only when it covers the year end), then the closing entry is reversed (dated the year end, same source type). `409 already_reopened`, `409 later_year_closed` (re-open the later year first), `422` without a reason. A foreign / missing id → `404` |

A closed year's P&L still shows its activity (closing entries are excluded); the balance sheet after the close shows
the result in retained earnings and 0 current-year earnings at the year end. Changing the fiscal year start month after
a close isn't blocked (gap F-S5).

**Tests.** Endpoints in `src/shared/mocks/isolation/financeStatementsEndpoints.ts` (both directions, spoofing; the
dimension / account filters in `REFS` of `scoped.isolation.test.ts`); roles × both companies, plan gate, foreign close
id, spoofed company and recomputed numbers in `src/app/isolation/financeStatements.isolation.test.ts`; math in
`src/modules/finance/statements/calc.test.ts` (sections, comparisons, dimension filters, A = L + E, cash flow
reconciliation, closing lines, April fiscal year) and `src/shared/mocks/services/financeStatements.test.ts` (full seeded
books of both companies, close / re-open with a non-January fiscal year, refusals); browser
`e2e/finance-statements.spec.ts`. Persisted dev DB: `VERSION` 34.

### Profitability

Read-only analysis over the journal (`services/financeProfitability.ts`, rules in `modules/finance/profitability/calc.ts`).
Plan gate `/finance/*` → `accounting`. **Who:** `accounting` full and view read every report; hidden → `403`. Labour cost
only for **full** — view (Sales Manager) gets `labour_cost: null` and margins before labour (`meta.labour_visible`).
No response carries a rate, a salary or a cost per employee: labour is aggregated per project / customer / month.
Query of every report: `from`, `to` (company-local, default this year, ≤ 36 months, `422`), `department_id`
(subtree), and per report `project_id`, `event_id`, `customer_id`; a foreign or missing id → `404` (same body).

| Method | Path | Returns / rules |
|---|---|---|
| GET | `/finance/profitability/options` | `{meta, settings, can_edit_settings, departments, reports}` |
| PUT | `/finance/profitability/settings` | `{standard_hours_per_month (40–320, default 176), cash_alert_threshold (≥ 0 or null), overdue_receivables_alert_pct (0–100, default 30)}`; accounting full only (`403`), `422` out of range |
| GET | `/finance/profitability/projects` | rows: revenue (income lines tagged `project_id`), direct costs (expense lines tagged `project_id`: bills, expenses, claims), labour hours / cost, unrated hours, margin, margin %, budget (contract value → quotation net → won deal value) and billed-of-budget %; totals; negative-margin count. Department = the project manager's department. |
| GET | `/finance/profitability/projects/:id` | the row + monthly trend (revenue, direct costs, labour, margin) + the ledger lines behind it |
| GET | `/finance/profitability/events` | events starting in the period (owner's department): revenue, costs, profit, ROI, attendees, leads, cost per attendee / lead |
| GET | `/finance/profitability/customers` | revenue net of credit notes, credit notes, direct costs (customer- or customer-project-tagged, each line once), labour on their projects, gross margin, invoiced / collected (invoices issued in the period), outstanding / overdue (today), DSO, lifetime revenue |
| GET | `/finance/profitability/departments` | department P&L: `profitAndLoss(co, from, to, {department_id})` of Financial statements per department + project-tagged lines without a department (project manager's department); Unassigned = company P&L − departments; payroll part from the lines; `source: statements` (ledger fallback) |
| GET | `/finance/profitability/:report/export` | `{file_name, headers, rows}` (CSV / Excel built by the client); labour column only for full; unknown report `404` |

**Labour allocation (not a ledger posting):** hours of time entries on the project's tasks (the entry's project, else its
task's) × monthly pay of the employee's contract in force that month (basic + allowances) ÷ standard hours per month.
Hours of users without an employee record / contract are `unrated_hours` (no cost).

**Events — no double counting:** revenue = event-tagged income in the ledger + max(0, signed / paid sponsor deals −
that income) (sponsor invoices carry the event). Costs = event-tagged expenses in the ledger + Σ max(0, budget-line
actual − bills linked to that line via `budget_line_id`); bills linked to a line replace its typed actual; unlinked
ledger costs count fully. ROI = (revenue − cost) ÷ cost.

**DSO** = open receivables ÷ invoices issued in the period (incl. VAT) × days of the period (up to today).

**Tests.** `src/shared/mocks/isolation/profitabilityEndpoints.ts` (both directions, spoofing; filters in `REFS` of
`scoped.isolation.test.ts`); roles × both companies, labour hidden for view, no per-employee data, recomputed revenue
and labour, plan gate in `src/app/isolation/profitability.isolation.test.ts`; `modules/finance/profitability/calc.test.ts`
and `services/financeProfitability.test.ts` (department split, labour, event rule). Persisted dev DB: `VERSION` 36.

### VAT returns

VAT returns per filing period, in the authority's layout: **UAE (Apex) — FTA VAT 201**, **KSA (Crest) — ZATCA VAT
return**. Services `src/shared/mocks/services/financeTax.ts`, stores `fin.vatReturns`, `perTenant:fin.taxSettings`
(`data/financeTax.ts`), pure rules `src/modules/finance/tax/calc.ts`, wire `src/shared/api/financeTaxMappers.ts` (plain
snake_case at any depth). Screens: `/finance/tax` (`?tab=vat|estimate`, `?return=`, `?box=`), printable
`/finance/tax/vat-returns/:id/print`. Plan gate `/finance/*` → `accounting`. **Who:** full (Company Admin, Management,
Accountant) reads and writes; view (Sales Manager) reads (`can.file` / `can.pay` false, writes `403`); hidden `403`. A
foreign return id answers `404` like a missing one; a foreign payment account the same `422 invalid_account` as a
missing one.

**How a return is computed (from the journal).** Every posted entry dated in the period is classified, so every finance
section counts (invoices, credit notes, bills, debit notes, expenses, claims, petty cash, manual entries). For entries
of invoices, credit notes, bills, debit notes and company expenses the **document lines** give the category (tax code
→ standard / zero-rated / exempt / out of scope) and the net amount; the entry's own **VAT-account lines** (2200 output,
1300 input) give the VAT (a rounding difference goes on the document's first standard line), so the return always
agrees with the ledger. Any other entry touching 2200 / 1300 gives one standard-rated item per VAT line (net = VAT ÷ the
line's tax-code rate). Reversals (voids) are entries of the period they are posted in, with the opposite sign; credit
notes reduce sales, debit notes reduce purchases. **Non-recoverable VAT** (bill lines / expenses without a valid tax
invoice: not on 1300) is listed as `excluded`. Entries of source `vat_return`, `tax_provision`, `year_end_close` are
never classified. The documents only give the drill-down detail (which invoice / bill feeds which box).

**Boxes.** UAE: standard-rated sales by the customer's emirate (`customers.emirate`; empty → the company's emirate from
Settings › Company profile, flagged `emirate_assumed` and listed in `assumptions`) 1a–1g; 2 tourist refunds, 3 reverse
charge, 6 imports, 7 import adjustments, 10 reverse-charge expenses: 0 (not tracked); 4 zero-rated; 5 exempt; 8 totals;
9 recoverable standard-rated expenses; 11 totals; 12 = 8 VAT + adjustment; 13 = 11 VAT + adjustment; 14 = 12 − 13.
Late corrections go to the VAT **Adjustment** column of their box. KSA: 1 standard sales 15 %; 2 sales to citizens 0;
3 zero-rated domestic; 4 exports (zero-rated sales invoiced in a foreign currency — an assumption); 5 exempt; 6 total;
7 standard purchases; 8–9 imports 0; 10 zero-rated purchases; 11 exempt purchases; 12 total; 13 = 6 − 12 VAT; 14
corrections from previous periods (warning above SAR 5,000: voluntary disclosure); 15 credit carried forward; 16 net
VAT due. Credit / debit notes go to the KSA **Adjustment** (amount) column.

**Workflow.** Periods (calendar months or quarters, `vat_frequency` per company; seed Apex quarterly, Crest monthly)
from the start of the fiscal year the module was first opened; a row (`VATR-<n>`) per period is created when the list
is read. **draft** (computed live) → **filed** (`POST …/file`: the snapshot — boxes, totals, items, warnings — is
frozen with the ids of the entries it counted; the settlement entry **Dr 2200 output VAT / Cr 1300 input VAT / Cr (or
Dr for a credit) 2210 VAT payable to tax authority** is posted on the filing date, source `vat_return`) → **paid**
(`POST …/pay`: Dr 2210 / Cr the bank or cash account). Account **2210 "VAT payable to tax authority"** is not in the
seeded chart: it is created (additively, `ACC-2210` under Liabilities) on the first filing. A filed return is never
recomputed: an entry later dated inside a filed period is reported as a **correction** in the next unfiled return. A
negative payable (credit) is **carried forward** into the next return (`credit_brought_forward`; KSA box 15). Due date:
UAE period end + 28 days; KSA end of the following month. The CSV export and the printable page are client-side.

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/finance/tax/settings` | view | — | `country, layout (uae_vat201 · ksa_zatca), currency, vat_frequency, tracking_from, company_emirate, vat_number, vat_registered, can_edit, payment_accounts[{id, code, name}], fiscal_year_start_month, fiscal_years[]` |
| PATCH | `/finance/tax/settings` | full | `{ vat_frequency: monthly · quarterly }` | the settings; drafts of the old frequency are regenerated, filed returns stay. `409 frequency_misaligned` (quarterly after a filed month that doesn't end a quarter). Audited |
| GET | `/finance/vat-returns` | view | — | rows newest first: `id, period_key, label, frequency, from, to, due_date, status (draft · filed · paid), in_progress, overdue, payable, filing_reference, filed_date, paid_date` |
| GET | `/finance/vat-returns/:id` | view | — | row + `layout, currency, adjustment_label, boxes[{key, label, amount, adjustment, vat, kind (line · total · result), drill, note}], totals {output_vat, input_vat, corrections, net_vat, credit_brought_forward, payable}, item_count, excluded_count, correction_count, warnings[], assumptions[], seller, settlement_entry, payment_entry, filed_at, filed_by_name, paid_by_name, payment_reference, frozen, can {file, pay}, file_blocked_reason` |
| GET | `/finance/vat-returns/:id/boxes/:box` | view | `box`: a drillable box (UAE `1` = 1a–1g, `1a`…`1g`, `4`, `5`, `9`; KSA `1, 3, 4, 5, 7, 10, 11, 14`), `corrections`, `excluded` | `{ return_id, box, label, items[{entry_id, entry_number, date, side, kind, doc_id, doc_number, link, counterparty, category, tax_code, net, vat, recoverable, emirate, emirate_assumed, export, correction, box}] }`; another key `404` |
| POST | `/finance/vat-returns/:id/file` | full | `filing_reference*` (3–40), `filed_date` (after the period, not future; default today) | the detail (frozen). `409 already_filed`, `409 period_open` (period not ended), `422`, `423 period_locked`. Audited |
| POST | `/finance/vat-returns/:id/pay` | full | `date` (filing date … today), `account_id` (cash / bank; default bank), `reference` | the detail. `409 not_filed`, `already_paid`, `nothing_to_pay` (credit), `422 invalid_account`, `423`. Audited |

### Corporate tax & zakat

Estimates only, clearly labelled ("consult your advisor"). Same service / screen (`/finance/tax?tab=estimate`).
**UAE corporate tax** (`GET /finance/tax/corporate-tax?year=`; KSA → `409 not_applicable`): accounting profit of the
fiscal year to date from the ledger (income credit − debit, expense debit − credit; `tax_provision` and
`year_end_close` entries left out, so the figure is **before tax**) + automatic adjustments (50 % of entertainment 6560
added back; expense accounts named "fine" / "penalty" added back; income accounts named "dividend" / "capital gain"
deducted) ± manual adjustments → taxable income; **0 % up to AED 375,000, 9 % above**; a straight-line 12-month
projection. SEAM: the statements section's `profitAndLoss` includes the provision (after tax), so the estimate keeps
its own pre-tax ledger sum. **KSA zakat** (`GET /finance/tax/zakat?year=`; UAE → `409`): simplified base = equity +
profit not yet closed + long-term liabilities (`non_current_liability`) − net fixed assets (`fixed_asset`) ± manual
adjustments, or the adjusted net profit of the year when higher, never below 0; zakat 2.5 %. **Provision** (`POST
/finance/tax/provisions {kind: corporate_tax · zakat, year, date?}`, full): posts the difference between the estimate
and what is already provided for that year — Dr **6960** (Corporate tax / Zakat expense; created additively on first
use) / Cr **2700** payable (or the reverse to release an over-provision), source `tax_provision`, source id
`<kind>:<year>`; `409 nothing_to_post` when equal. `PUT /finance/tax/adjustments {kind, year, lines[{label, amount}]}`
(full) replaces the year's manual adjustments (≤ 30) and returns the estimate.

### Budgets

One budget per company and fiscal year (`BUD-<n>`), lines per **department × income / expense account** with 12
monthly amounts (fiscal months). Services `src/shared/mocks/services/financeBudgets.ts`, store `fin.budgets`
(`data/financeBudgets.ts`; seed: an approved budget of the current year for Apex and Crest), pure rules
`src/modules/finance/planning/calc.ts`, wire `src/shared/api/financeBudgetsMappers.ts`. Screen `/finance/planning`
(`?tab=budgets|vs-actual|forecast`, `?budget=`, `?department=`, `?month=`; plan gate only) and the My HR card "My
department budget". **Who:** full edits (create, lines, copy actuals, delete drafts); **approve / reopen: Management and
Company Admin** (`403 approve_forbidden` for an Accountant); view (Sales Manager) reads everything; **department heads**
(`departments.head_id`, any role, no accounting access needed) read budgets and budget vs actual of **their own
department(s) only** — other lines are never served, history is hidden, another department in the filter answers `404`
like a missing one; everyone else `403`. Approval locks the budget (`409 budget_locked` on edits until reopened).
Actuals: journal lines carrying `department_id` on income / expense accounts by entry month (`year_end_close` entries
left out). Variance is favourable when positive (expense budget − actual; income actual − budget). **Alerts** (stored,
once only, type `finance`): when a department's expense actuals reach **90 % / 100 %** of the current month's or the
year-to-date budget of the current year's approved budget, its head and the Accountants (Company Admins when there are
none) get a notification; marks `<department>:month:<level>:<yyyy-MM>` / `<department>:ytd:<level>:<year>` on the
budget. The check runs on budget reads and on the bell's tick (`GET /alerts`).

| Method | Path | Who | Body / query | Answer |
|---|---|---|---|---|
| GET | `/finance/budgets` | view · head | — | `[{id, fiscal_year, name, status (draft · approved), from, to, currency, expense_total, revenue_total, line_count, department_count, approved_by_name, approved_at, department_scoped, updated_at}]` (heads: totals of their lines) |
| POST | `/finance/budgets` | full | `fiscal_year*` (current − 5 … + 2), `name`, `copy_from_year`, `adjust_pct` (−100…500) | the detail (draft). `409 duplicate_budget` |
| GET | `/finance/budgets/:id` | view · head | — | row + `months[]` (yyyy-MM), `lines[{id, department_id, department_name, account_id, account_code, account_name, account_type, months[12], annual}]`, `departments[]`, `accounts[]` (full only), `history[]`, `can {edit, approve, reopen, delete}` |
| PUT | `/finance/budgets/:id/lines` | full | `lines*[{department_id*, account_id*, months[12]` or `annual + pattern (even · front_loaded · back_loaded · last_year)}]` (upsert by department × account; all-zero removes) | the detail. `409 budget_locked`, `422 invalid_department`, `invalid_account` (foreign = missing) |
| POST | `/finance/budgets/:id/copy-actuals` | full | `from_year*`, `adjust_pct`, `department_id` | replaces the lines (of the department) with that year's actuals × (1 + %) |
| POST | `/finance/budgets/:id/approve` | Company Admin, Management | — | approved + locked. `422 empty_budget`, `409 budget_locked`. Audited |
| POST | `/finance/budgets/:id/reopen` | Company Admin, Management | — | back to draft. `409 not_approved`. Audited |
| DELETE | `/finance/budgets/:id` | full | — | `{ id }`; drafts only (`409 not_draft`) |
| GET | `/finance/budgets/:id/vs-actual` | view · head | `department_id`, `month` (yyyy-MM of the year; default the current month) | `{budget_id, fiscal_year, status, currency, months, month, month_index, department_id, department_scoped, departments[{department_id, department_name, month_budget, month_actual, month_pct, ytd_budget, ytd_actual, ytd_pct, status (ok · warning · over)}], rows[{department, account, budget[12], actual[12], month_budget, month_actual, month_variance, month_used_pct, ytd_budget, ytd_actual, annual_budget, variance, variance_pct, used_pct}], totals, unassigned_expense_ytd}` (unbudgeted actuals show with budget 0) |

### Cash-flow forecast

`GET /finance/forecast` (view): 13 weeks and 6 months from the company's today (its timezone). Opening cash = ledger
balances of the cash and bank accounts. **Inflows:** open invoices (balance due in base currency, minus amounts held as
undeposited PDCs) × the collection probability of their aging bucket (default not due 95 %, 1–30 days 85 %, 31–60 70 %,
61–90 50 %, 90+ 20 %; overdue ones expected 1–4 weeks from today by bucket); PDCs held (received / deposited) at
maturity, 100 % (70 % when the customer has bounced a cheque); active recurring invoices (each occurrence + its payment
terms, "not due" probability). **Outflows:** open bills by due date; payroll (the last run's net + employee and
employer social insurance) on each month's pay day (HR pay settings) not yet paid; recurring expenses (3 full months'
average of approved company expenses by category, spread weekly); VAT (filed unpaid returns and the estimate of unfiled
periods) on their due dates. Then manual lines (once / weekly / monthly, as entered) and the scenario % on inflows /
outflows. Answer: `currency, today, opening_cash, cash_accounts[], weeks[] / months[] {key, label, from, to, opening,
inflows, outflows, net, closing, by_category[{category, amount}]}, lowest_week {key, label, closing, below_minimum,
negative}, items[{id, date, category, label, ref, link, amount, gross, probability}], settings, assumptions[], can_edit`.
Writes (full): `PUT /finance/forecast/settings {probabilities[{bucket, pct}], bounced_pdc_pct, inflow_adjust_pct,
outflow_adjust_pct, minimum_cash}`, `POST /finance/forecast/lines {label*, date* (today … +400 days), amount* (≠ 0),
recurrence}` (`FCL-<n>`, ≤ 100), `DELETE /finance/forecast/lines/:id` (foreign = missing → `404`); each returns the
forecast. Store `perTenant:fin.forecastSettings`. Chart (recharts) + table + CSV export on the screen.

**Tests (tax & planning).** Endpoints in `src/shared/mocks/isolation/financeTaxEndpoints.ts` (both tables spread into
`endpoints.ts`; foreign departments / accounts in bodies and filters in `REFS` of `scoped.isolation.test.ts`); roles ×
both companies, department heads, plan gate and VAT recomputed from the ledger in
`src/app/isolation/financeTax.isolation.test.ts` and `financeBudgets.isolation.test.ts`; rules in
`src/shared/mocks/services/financeTax.test.ts` and `financeBudgets.test.ts`; browser `e2e/finance-tax.spec.ts`.
Persisted dev DB: `VERSION` 35. Not built: VAT refund requests, reverse charge / imports / tourist refunds, a VAT
return amendment flow (corrections go to the next return), corporate-tax return filing, zakat return, budget versions,
forecast by bank account.
