# Apex Aora ERP: API contract

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

## Conventions

- **Auth:** `Authorization: Bearer <token>` on every request except login. The server decides
  the record scope (own / team / full) from the token's user and role. The client never sends it.
- **Errors:** non-2xx with body `{ "message": "Human readable reason" }`. The UI shows `message`
  as is. Status codes in use: `400` bad query, `401` signed out, `403` no permission,
  `404` not found, `409` conflict (duplicate or wrong state), `422` validation or rule failure,
  `5xx` server error (retried once).
- **Dates:** ISO-8601 strings (`2026-11-17T09:00:00.000Z`); date-only fields are `yyyy-MM-dd`,
  months are `yyyy-MM`. Money is in AED unless noted.
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
| POST | `/auth/login` | `{ email, password }` | `Session`, or `{ twoFactorRequired: true, challengeId }` when the account has 2FA on. `401` wrong credentials; `403` "This account is deactivated." Challenge valid 5 minutes. |
| POST | `/auth/login/2fa` | `{ challengeId, code }` | `Session`. `code` = 6-digit OTP or an unused recovery code (single use, audited). `401` wrong code; `429` after 5 wrong codes; `410` expired/used challenge. |
| GET | `/auth/me` | | `User` |
| POST | `/auth/switch-role` | `{ role }` | `Session` (dev or demo only, may be omitted in production; skips 2FA; `403` if that demo user is deactivated) |
| GET | `/users` | | `User[]` (includes `active`; pickers should hide deactivated users) |

Every authenticated request from a deactivated user gets `401`, even with a token issued earlier.

## Leads

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/leads` | | `LeadRow[]` | Scoped. `403` if hidden. Each row has `reopenEligible: boolean`: true for a lead whose status kind is `lost` and whose `stageChangedAt` is at least `lostReopenDays` ago (Settings > Automation). |
| POST | `/leads` | `QuickAddInput` or `LeadCreateInput` (contacts[], website, sourceDetail, subIndustry, ownerId, value, nextFollowUpDate, nextStep, companyServices, serviceIds, recommendedServiceId, doNotContact, note, force) | `LeadRow` | Status always the first open status (`New`). Owner auto-assigned to the least-loaded Sales Agent unless a manager (sales scope full/team) picks one. Lists validated against the **active** lookups (source, industry, sub-industry belongs to industry; `422`), UAE mobile, email format, ≥1 named contact. `serviceIds` / `recommendedServiceId` must be **active** catalog service ids (`422`); never free text. `409` on duplicate; `force` only for managers (else `403`). `note` becomes a Note. |
| GET | `/leads/duplicates` | `?company=&email=&emails=a,b&website=&excludeId=` | `DuplicateMatch[]` (reason `company`/`domain`/`email`) | Checks **all** leads, not just the caller's scope. Company names normalized (drop LLC, FZE…). Domain from website/email; free-mail domains (gmail, outlook, hotmail, yahoo, icloud, live…) ignored. |
| GET | `/leads/owners` | | `LeadOwnerOption[]` `{id,name,title,role,openLeads}` | Needs sales create. Full: everyone who sells; team: the team; own: only the caller. Deactivated users are never listed, auto-assigned or accepted as owner (`422`). |
| GET | `/leads/:id` | | `LeadDetail` (+ `website`) | `404` / `403` outside scope. |
| PATCH | `/leads/:id` | `LeadUpdateInput` + `contacts[]` (replaces all), `website`, `doNotContact`, `force` | `LeadRow` | Changed source/industry/sub-industry must be active lookup items (`422`). `serviceIds` (replaces the list) and `recommendedServiceId`: ids not already on the lead must be **active** catalog services (`422`); unchanged, since-deactivated ids are accepted. Setting a non-null `recommendedServiceId` clears `recommendedServiceText` (the legacy unmatched text); omitting it or sending `null` leaves the text alone. Owner change: own scope `403`, team only within team. Duplicate rule re-runs when name/website/emails change (`409` / `force`). First contact becomes primary. |
| PATCH | `/leads/:id/stage` | `{ status, lossReason?, nextStep?, nextFollowUpDate? }` | `LeadRow` | `status` must be an active status (`422`). What the move needs comes from the status's `requires`: `loss-reason` → `lossReason` = an active loss-reason key, optionally followed by ` — details`; `next-step` → `nextStep` + `nextFollowUpDate`; `convert` (Won) creates a Customer (data carried over, no retyping) and sets `customerId`. Sets `stageChangedAt`. Non-open kinds (won/lost/parked) clear `nextFollowUpDate`. **Automation:** moving to `No response` sets `nextFollowUpDate` = now + `noResponseFollowUpDays`; moving a closed lead back to an open status (Reopen → `New`) clears `lossReason` and sets a follow-up for tomorrow when none is given. |
| PATCH | `/leads/:id/do-not-contact` | `{ value }` | `LeadRow` | |
| GET | `/leads/:id/activities` | | `ActivityView[]` | Newest first. |
| POST | `/leads/:id/activities` | `{ type, summary }` | `ActivityView` (+ optional `autoStatus {from, to, label, attempts}`) | `422` for call/email/WhatsApp when Do Not Contact. First outreach moves `New` → `Contacted`. **Automation** (outreach = call/email/WhatsApp): on a lead in `No response`, attempts are counted since it entered that status (activities after `stageChangedAt`); when attempts ≥ `attemptsBeforeCold` the lead moves to `Cold` (parked; `stageChangedAt` = now, `nextFollowUpDate` = null) and the response carries `autoStatus`; otherwise the next follow-up is pushed to now + `noResponseFollowUpDays`. |
| GET | `/leads/:id/notes` | | `NoteView[]` | Newest first. |
| POST | `/leads/:id/notes` | `{ body }` | `NoteView` | |
| POST | `/leads/:id/messages` | `{ channel: 'email'\|'whatsapp', to, subject?, body, templateId? }` (final text, variables already filled) | `{ activity: ActivityView, autoStatus? }` | Needs sales edit (`403`); lead in scope (`404`/`403`). `422` for Do Not Contact (same wording as activities); `to` must be an email (email) or a UAE mobile (WhatsApp); email needs a subject (≤150); body required (WhatsApp ≤1024, email ≤5000); any leftover `{{…}}` / `[unknown: …]` is rejected; `templateId` must exist and match the channel. Delivery is done by the backend (mocked here). Logs an `email`/`whatsapp` activity through the same path as `POST /activities`, so New→Contacted and No response→Cold still run. |
| GET | `/leads/:id/tasks` | | `TaskView[]` | Soonest due first. |
| POST | `/leads/import/check` | `{ rows: ImportLeadRow[] }` (max 5000) | `ImportCheckRow[]` `{row, errors[], warnings[], matches, fileDuplicateOf}` | Rows carry lookup keys (the wizard maps the file's free text onto the active items). Errors: missing company, source/industry/status not an active list item. Warnings: value cleared or defaulted. Rows also carry `recommendedServiceId` (catalog match of the file's "Recommended service"/"Service" column, `''` = none) and `recommendedServiceText` (the file's value when unmatched); the server re-matches the text with `matchServiceText`, accepts only **active** ids, and warns "kept as unmatched" otherwise. |
| POST | `/leads/import` | `{ rows, decisions: Record<row,'import'\|'skip'>, ownerRule: 'file'\|'auto' }` | `ImportResult` `{created, skipped, failed:[{row,company,reason}], skippedRows, createdIds}` | Re-checks rows in order (catches repeats inside the file). Duplicates skipped unless a manager chooses import. Agents own their imports. Missing follow-up → tomorrow; blank status → New; Lost/Not interested get "Imported from Excel (no reason recorded)". |

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
| PUT | `/targets/defaults` | `{ values }` (all 8 keys) | `{ values, canEdit }` | System Admin only. Whole numbers 0–10,000. Months without a per-agent row use the current defaults. Audited. |

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
`serviceCategories` lookup (Settings > Fixed lists); `industries` are `industries` lookup keys. Currency is an ISO code (default `AED`).

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
| POST | `/contacts` | `{recordType, recordId, name, title, mobile, email, isDecisionMaker}` | `ContactRow` | Name required; UAE mobile; email format; mobile or email required; `409` if the email exists at that company. |
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

- `Quotation.currency` / `QuotationInput.currency?`: one ISO code per quotation (3 capital letters, default `AED`). Totals always
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
| PUT | `/lookups/:list` | `{ items }` (the whole list; new items without `key`) | `Lookups` | System Admin only (`403`). Unknown list `404`. Items can be renamed, reordered and deactivated but not removed (`422`); built-in statuses keep their kind; at least one active status of each kind. **Protected items** (`system: true` on a plain list item, e.g. loss reason `imported-no-reason` "Imported - no reason recorded"): can't be removed, renamed or deactivated (`422`); always re-pinned last on reorder; `system`/`hiddenFromPickers` can't be changed by clients. Each list needs ≥1 active item that isn't `hiddenFromPickers`. Audited. |
| GET | `/settings/automation` | | `AutomationRules` | Any signed-in user. `{noContactReminderDays: 1, noResponseFollowUpDays: 2, attemptsBeforeCold: 3, stalledInterestedDays: 3, lostReopenDays: 90, renewalAlertDays: 30, taskReminderDaysBefore: 1}` by default. Read live by the lead journey (stage moves, activities, `reopenEligible`), CRM renewals and `/alerts`. |
| PUT | `/settings/automation` | `Partial<AutomationRules>` | `AutomationRules` | System Admin only. Whole numbers within each rule's limits (`422`). Audited. |
| POST | `/settings/automation/reset` | | `AutomationRules` | Back to the defaults. Audited. |
| GET | `/audit-log` | `?entity=&userId=&action=&from=&to=` | `AuditEntry[]` `{id, at, userId, userName, action, entity, entityId, summary, changes[{field,from,to}]}` | Admins only (`403`). Newest first. |
| GET | `/alerts` | | `Alert[]` `{id, type, severity: info\|warning\|danger, title, body, leadId?, customerId?, link, at}` | Scoped like `/leads` (hidden scope → `[]`). Newest first. Types, using the automation rules: `no-contact` — New lead with no activity for ≥ `noContactReminderDays` (to the owner); `stalled` — Interested lead with no activity for ≥ `stalledInterestedDays` (to managers: sales scope team/full); `follow-up` — follow-up due today or overdue (owner), others' overdue ones (managers); `renewal` — contracts (not cancelled) renewing within `renewalAlertDays`; `task` — open lead tasks due within `taskReminderDaysBefore` days or overdue (owner), others' overdue tasks (managers). |

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

All writes are System Admin only (`403`) and audited with a field-by-field diff. Users are never deleted.

| Method | Path | Body | Returns | Rules |
|---|---|---|---|---|
| GET | `/settings/users` | | `SettingsUserRow[]` (User + departmentName, managerName, directReports, openLeads) | Settings view (Admin, Management). |
| GET | `/settings/departments` | | `{ id, name }[]` | Any signed-in user. |
| POST | `/settings/users` | `{ name, email, mobile, role, title?, departmentId, managerId? }` | `SettingsUserRow` | Email valid and unique (case-insensitive); UAE mobile (stored `+971 5X XXX XXXX`); role one of the 9; department exists; manager exists and is active. |
| PATCH | `/settings/users/:id` | any subset of the above | `SettingsUserRow` | Same checks; manager not self, no reporting loops; you can't change your own role; the last active System Admin can't lose the role. |
| POST | `/settings/users/:id/deactivate` | `{ confirm?: boolean }` | `SettingsUserRow`, or `409 { message, openLeads }` | Not yourself; not the last active System Admin; if they own open/parked leads and `confirm` isn't true → `409`. Leads stay assigned. |
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
| POST | `/security/backups/run` | | `BackupRun` | System Admin; `409` if one is running. |
| GET | `/security/policy` | | `{ requireTwoFactorForAdmins, sessionTimeoutMinutes, passwordMinLength }` | Any signed-in user (the app enforces the idle timeout and the password rules from it). |
| PUT | `/security/policy` | partial policy | policy | System Admin; timeout 5–1440, password length 8–64; requiring 2FA needs your own 2FA on. |

## Settings: templates

| Method | Path | Body / query | Returns | Rules |
|---|---|---|---|---|
| GET | `/templates` | `?channel=email\|quotation\|whatsapp&purpose=&active=` | `MessageTemplate[]` | Any signed-in user; only settings viewers see inactive ones. |
| GET | `/templates/:id` | | `MessageTemplate` | `404` if inactive and the caller can't see inactive ones. |
| POST | `/templates` | `{ channel, name, purpose, subject?, body }` | `MessageTemplate` | System Admin. Becomes the default if its channel+purpose has none. |
| PATCH | `/templates/:id` | `{ name?, purpose?, subject?, body? }` | `MessageTemplate` | System Admin; channel can't change. |
| POST | `/templates/:id/duplicate` | | `MessageTemplate` | "Name (copy)", active, not default. |
| POST | `/templates/:id/default` | | `MessageTemplate` | Only default for its channel+purpose; `422` if inactive. |
| POST | `/templates/:id/deactivate` / `reactivate` | | `MessageTemplate` | No delete. |

Validation (`422`): name required, ≤80, unique per channel; purpose valid for the channel; email needs a
subject; body required (≤5000; WhatsApp ≤1024); unknown `{{variables}}` are listed in the message.
Variables use `{{group.field}}` (lead, agent, company, quotation, date); the catalog is in
`src/modules/settings/templates/variables.ts` and the renderer in `render.ts`. All template writes are audited.

## Departments

Membership has one source of truth: `User.departmentId`. Moving a member here and changing a user's
department in Settings › Users & roles (`PATCH /settings/users/:id`) are the same change; that endpoint
refuses to move someone who heads a department (`422 "… heads X. Pick a new head for X first"`) and
refuses inactive target departments.

Access (`departments` column of the permission matrix): **full** (System Admin, Management, HR Manager)
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

---

Next modules (Tasks & projects, HR, Events…) add their sections here as they're built.
