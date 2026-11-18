# Database alignment (Apex Aora ERP Database Design)

This document records how the app (frontend + the MSW mock API, which is the API contract) was aligned with the *Apex Aora ERP Database Design* v1.0, and every remaining mismatch. It merges four parts written during the pass: A (enums, dates, API layer, lead statuses), B (tasks, projects, Won flow, bundle hygiene), D (API mappers for the remaining modules) and C (the design-gap audit).

## Status of this pass

| # | Item | Status | Where |
|---|---|---|---|
| 1 | Enums as shared typed constants (customer, quotation incl. `viewed`/`expired`, contract, project, task priority/status) | Done | Enums; Tasks |
| 2 | Lead follow-up as a company-local date (`next_follow_up_date`), today/overdue/reminders on the company date, midnight and two-timezone tests | Done | Lead follow-up date |
| 3 | API boundary layer (snake_case on the wire, UI keeps its types), module by module | Done for every company module; **`/platform/*` and the session payloads still camelCase** (see "Not converted") | API boundary layer; API mappers for the remaining modules |
| 4 | Lead status model (`type`, `probability`, `requires_next_step`, `requires_loss_reason`); pipeline rules read flags, not names | Done | Lead status model |
| 5 | Tasks (statuses, Blocked as a flag, sub-tasks, one link + project, `completed_at`, stored once-only reminders, time entries, attachments) and Won-flow alignment (contacts `customer_id`, lead `customer_id`/`won_at`, `lead_status_history` on every status change, quotation `customer_id`/`accepted_at`) | Done | Tasks; Projects; Time entries & attachments; Reminders; Won flow alignment |
| 5b | Test hooks (`window.__apex*`) only in dev/test builds; `dist/` searched | Done | Bundle hygiene |
| 6 | Every other mismatch listed with a proposed table/column, nothing changed | Done | Design gaps |

The database design itself was updated to **v1.1** afterwards (memberships, lead status flags, `next_follow_up_date`,
`normalized_name`, non-unique duplicate indexes, lead service pivots, `contact_channels`, `company_profiles`,
`plan_versions`, `platform_settings`, onboarding, `tasks.blocked_at`/`blocked_reason` and more); many gaps below are
resolved there — check v1.1's changelog before acting on one.

## Part A: enums, follow-up date, API boundary layer, lead statuses

Scope: status enums (customers, quotations, contracts), the lead follow-up as a company-local date,
the API boundary layer (snake_case on the wire) and the lead status model. Reference: "Apex Aora ERP
Database Design v1.0". Visible behaviour is unchanged except where noted (new: customer status
**Churned**, quotation **Viewed** set by "Open as customer", stored **Expired** quotations).

### Enums

One module, `src/shared/domain/enums.ts`, used by the UI, the mock API and these docs. Each domain
exports the value tuple, the TS type, labels and badge tones. **Values on the wire are the lower-case
snake values; screens show the labels.** The server validates with `isOneOf(VALUES, v)` and answers
`422` for anything else (including the old label-cased values such as `Active`).

| Domain (column) | Values | Labels / notes |
|---|---|---|
| Customer (`customers.status`) | `active` · `paused` · `vip` · `churned` | Active, Paused, VIP, **Churned (new)**. Seed `Active/Paused/VIP` mapped 1:1. Picker / filter / sort order: active, vip, paused, churned (`CUSTOMER_STATUS_ORDER`). Tones green, amber, brand, neutral. |
| Quotation (`quotations.status`) | `draft` · `sent` · `viewed` · `accepted` · `rejected` · `expired` | `QUOTATION_AWAITING = [sent, viewed]` (decidable, can expire); `QUOTATION_OPEN = [draft, sent, viewed]`; decisions `accepted` / `rejected`. |
| Contract (`contracts.status`) | `draft` · `active` · `expired` · `cancelled` · `renewed` | Stored: `active` / `cancelled` (only these can be set by PATCH; `draft` / `renewed` reserved for the coming contract lifecycle). `expired` is returned for an active contract past its renewal date (lazy, on read). The old `Expiring` is **not a status**: rows carry `renewal_due` (`renewalDue`) and the UI shows `contractDisplayStatus(row)` = `expiring` (label "Expiring") for an active contract inside the renewal window. |

Lead status `type` is in "Lead status model" below. Project status and task priority are part B.

**Quotation lifecycle (mock)**

- `viewed`: `POST /quotations/:id/viewed` (the editor's **Open as customer** button, standing in for the
  client opening the shared link): `sent → viewed` once, sets `viewed_at` (UI `viewedAt`, shown in the
  history card). A draft answers `409`; decided / expired quotations are returned unchanged.
- `expired`: stored by the server when a `sent` / `viewed` quotation's `valid_until` is before the
  company's today (company timezone, mock clock). Runs lazily on every quotation read
  (`GET /quotations`, `GET /quotations/:id`, every quotation action) and on the lifecycle tick
  (`runLifecycle` hook `onLifecycleTick('quotations.expiry', …)` in services/billing.ts, i.e. every
  authenticated request and Dev › advance clock). Never for `accepted` / `rejected` / `draft`.
- Accept / reject: only from `sent` or `viewed`; an expired quotation answers `409` ("expired on …
  Duplicate it"). Body values are `accepted` / `rejected` (labels are refused, `422`).

Files: `shared/domain/enums.ts`; crm `constants.ts`, `types.ts`, `schemas.ts`, `CrmBadges.tsx`,
`CustomerEditDrawer.tsx`, `CustomersPage.tsx`, `CustomerProfilePage.tsx`, `ContractsPage.tsx`;
quotations `types.ts`, `lib/totals.ts`, `QuotationStatusBadge.tsx`, `ValidUntil.tsx`, `QuotationDocument.tsx`,
`LeadQuotations.tsx`, `QuotationsPage.tsx`, `QuotationEditorPage.tsx`, `api/quotationsApi.ts`,
`hooks/useQuotations.ts`; `ServiceDetailPage.tsx`; mocks `db.ts`, `data/contracts.ts`, `data/quotations.ts`,
`services/crm.ts`, `services/quotations.ts`, `services/billing.ts` (tick hook), `services/services.ts`,
`services/alerts.ts` (renewals: active only), `handlers/quotations.ts`. Surgical edits in part B's files:
`services/won.ts` (contract `active`, quotation `accepted`, label in the message), `won/components/WonDialog.tsx`
(quotation status label), `services/won.test.ts` fixtures. Tests: `services/statusEnums.test.ts`.

### Lead follow-up date

`next_follow_up_date` (UI `nextFollowUpDate`) is a **company-local calendar date** `yyyy-MM-dd`, never a
datetime. "Today", "overdue", "upcoming" and "+N days" are company facts: the company's timezone
(Settings › Company › Regional) at the mock clock's time on the server (`companyDayOf(companyId, clock.now())`,
selectors/company.ts) and at the tenant region's timezone on the client (`companyTodayIso()`,
modules/leads/lib/followUp.ts, built on `todayIsoIn`).

- Pure helpers: `src/shared/domain/followUp.ts` — `isIsoDate`, `followUpStateOn(date, today, closed)`
  (`overdue` / `today` / `upcoming` / `none`, plain string comparison), `daysLate`, `followUpInDays`,
  `toFollowUpDate(value, timezone)` (migrates an ISO datetime to the date it falls on in that timezone).
- Server: the API refuses a datetime (`422` "Set the follow-up as a calendar date (yyyy-MM-dd).") on
  `POST /leads`, `PATCH /leads/:id` and `PATCH /leads/:id/stage`. No response (stage move and every
  unanswered outreach) schedules `today + noResponseFollowUpDays` in the company's timezone; reopening /
  creating without a date → company tomorrow; import keeps the file's `yyyy-MM-dd` as is.
  Dashboard (`followUpsDueToday` / `followUpsOverdue`), alerts (`follow-up`), departments (`overdueFollowUps`)
  and reports (`overdueFollowUps`, `daysOverdue`) compare with the company's today.
- Client: `followUpState` / `FollowUpLabel` (list, pipeline, detail, dashboard, sidebar badge), the
  Follow-ups page (buckets, "n days late", day groups, "Tomorrow"), the reschedule menu (sends the date;
  "Next week" = next Monday of the company calendar), the stage dialog (default company today + 2, sends
  the picked date — no more `T09:00` ISO) and the lead form (date input value as is).
- Seed: every seeded follow-up is converted to the company-local date (Apex `Asia/Dubai`, Crest `Asia/Riyadh`).
- Tests: `shared/domain/followUp.test.ts` (23:30 vs 00:30 Dubai; the same instant in Asia/Dubai, Asia/Riyadh
  and Africa/Cairo giving different today / overdue answers; validation; migration) and
  `shared/mocks/services/followUpDate.test.ts` (seed shape, PATCH refuses a datetime, No response +2 at
  23:30 vs 00:30, attempts reschedule, Riyadh vs Dubai at one instant, dashboard and alerts today/overdue
  across midnight and across Dubai / Riyadh / Cairo). `pipeline.test.ts` now sends dates and asserts a
  datetime is refused.

### API boundary layer

`src/shared/api/mapping.ts` defines the layer once; `src/shared/api/mappers.ts` holds the resource mappers.

```ts
const leadMapper = defineMapper<LeadDetail>({
  fields: { company: 'company_name', status: 'status_id', nextFollowUpDate: 'next_follow_up_date', … },
  nested: { contacts: contactMapper },
  opaque: [],            // fields whose VALUE is left untouched (maps keyed by data)
})
leadMapper.toApi(row)        // UI → API (one record or an array)
leadMapper.fromApi(json)     // API → UI;  fromApiList(json) for arrays
```

- `fields`: UI key → API key where the name isn't plain snake_case (the design's column names). Every
  other key is converted mechanically (`ownerName ↔ owner_name`), so nothing is dropped. Two UI keys
  can't map to one column (throws at definition).
- `nested`: values that are resources themselves (objects or arrays) use their own mapper.
- `opaque`: values left as they are (import `decisions` keyed by row number; `limit_reached` keeps the
  402 envelope's shape).
- Mock handlers: `respondAs(mapper, run)` serializes the service result; `bodyAs(request, mapper)`
  parses the body (handlers/utils.ts). Error envelopes `{ message, code, …details }` are never mapped.
- Client api functions map back (`leadsApi.ts`, `crmApi.ts` contacts, `settingsApi.ts` lookups); hooks,
  screens and the mock services keep the camelCase types.
- Unknown snake_case keys in a body become camelCase mechanically (`fromApi`), so an old camelCase key
  passes through unchanged; clients must send snake_case (all converted callers and tests do).

**Converted:** leads (rows, detail with contacts, create, update, stage move, do-not-contact, activities,
notes, legacy tasks, duplicates incl. query names, owners, import check / run), contacts, settings
lookups (GET and PUT, list names in the path). **Converted later (phase 2):** customers, contracts, quotations, the Won flow, messages and every other company module — see "API mappers for the remaining modules" below for the per-module tables and the endpoints still in camelCase.

#### Leads (`leads`)

| UI field | API / DB column | Note |
|---|---|---|
| id | id | |
| company | company_name | |
| contactName | contact_name | gap: primary contact lives in `contacts` (`is_primary`) |
| contactEmail | email | duplicate-check column |
| mobile | phone | duplicate-check column |
| industry | industry_id | value = list key |
| subIndustry | sub_industry_id | gap: design has one `industry_id` that may point to the sub-industry |
| sourceType | source_id | value = list key |
| sourceDetail | source_detail | |
| status | status_id | value = status `code` |
| stageChangedAt | stage_changed_at | gap (design derives it from `lead_status_history`) |
| ownerId | owner_id | |
| value | estimated_value | gap: no value column on `leads` |
| nextFollowUpDate | next_follow_up_date | gap: design `next_follow_up_at datetime` |
| createdAt | created_at | |
| doNotContact | do_not_contact | |
| nextStep | next_step | gap |
| lossReason | loss_reason_id | value = list key, optionally `" — details"` (gap: `loss_reason_note`) |
| customerId | customer_id | |
| companyServices | company_services | gap: design uses `tags` / `taggables` |
| serviceIds | service_ids | gap: no services-of-interest pivot |
| recommendedServiceId | recommended_service_id | |
| recommendedServiceText | recommended_service_text | gap (legacy unmatched text) |
| score | score | |
| website | website | detail and bodies |
| contacts | contacts[] | contact mapper |
| ownerName, reopenEligible | owner_name, reopen_eligible | derived (read-only) |
| — (create body) note, force | note, force | request-only |

Stage move body: `status_id`, `loss_reason_id`, `next_step`, `next_follow_up_date`. Quick add body:
`company_name, contact_name, phone, email, source_id, industry_id` (+ `force`); the quick add's `email` is the
first contact's (no `contactEmail` there, separate `leadInputMapper`). Duplicates query:
`?company_name=&email=&emails=a,b&website=&exclude_id=`; result rows `lead_id, company_name, owner_name, status_id, reason`.
Owners: `id, name, title, role, open_leads`.

#### Contacts (`contacts`) — on a lead and `GET/POST/PATCH /contacts`

| UI field | API / DB column | Note |
|---|---|---|
| id, name, title, mobile, email | same | |
| leadId | lead_id | |
| isDecisionMaker | is_decision_maker | |
| company | company_name | derived (row) |
| recordType, recordId | record_type, record_id | gap: design has `lead_id` + `customer_id` |
| ownerName | owner_name | derived |

#### Activities (`activities`) and notes (`notes`) on a lead

| UI field | API / DB column | Note |
|---|---|---|
| activity.leadId | lead_id | design: polymorphic `subject_type` + `subject_id` |
| activity.userId | user_id | |
| activity.at | occurred_at | |
| activity.type, summary | type, summary | |
| activity.userName | user_name | derived |
| activity.autoStatus {from, to, label, attempts} | auto_status {from_status_id, to_status_id, label, attempts} | response-only |
| note.leadId | lead_id | design: polymorphic `note_type` + `note_id` |
| note.authorId | user_id | |
| note.body, createdAt | body, created_at | |
| note.authorName | author_name | derived |

Legacy `GET /leads/:id/tasks`: `lead_id, title, owner_id, due_date, status, priority, owner_name`.

#### Lead import (`lead_imports` + `leads`)

Rows use the lead columns plus `row, contact_title, is_decision_maker, notes` (`contact_title` /
`is_decision_maker` go to `contacts`). Request: `{ rows, decisions, owner_rule }` (`decisions` opaque).
Check rows: `row, errors, warnings, matches[] (duplicate shape), file_duplicate_of`. Result:

| UI field | API / DB column |
|---|---|
| created | imported_rows |
| skipped | duplicate_rows |
| failed[] {row, company, reason} | failures[] {row, company_name, reason} (design stores `failed_rows` count + `error_report_path`) |
| skippedRows | skipped_rows |
| createdIds | created_ids |
| skippedForLimit | skipped_for_limit |
| limitReached | limit_reached (opaque, 402 envelope shape) |

#### Settings lookups

`GET /lookups` keys and `PUT /lookups/:list` path names are the table names: `lead_statuses`,
`lead_sources`, `industries`, `loss_reasons`, `tags`, `service_categories` (old camelCase names answer `404`).

| UI field | lead_statuses | other lists | Note |
|---|---|---|---|
| key | code | id | the stable key stored on records |
| label | name | name | |
| active | is_active | is_active | |
| order | sort_order | sort_order | |
| type | type | — | `open · won · lost · cold · parked` |
| requiresNextStep / requiresLossReason | requires_next_step / requires_loss_reason | — | |
| probability | probability | — | gap |
| tone, color | tone, color | — | tone: gap |
| system | is_system | is_system | gap |
| hiddenFromPickers | — | hidden_from_pickers | gap |
| industries.subIndustries | — | sub_industries[] | design: `industries.parent_id` tree |

Tests: `shared/api/mapping.test.ts` (both directions, nested, opaque, arrays, duplicate columns refused,
every key of a lead detail / lookups payload is snake_case, round trip equals the original). Updated to the
snake_case contract without weakening: isolation table samples (`endpoints.ts`), `scoped`, `automations`,
`enforcement` and `permissions` isolation tests (the permissions test now also asserts `company_name` and
the PATCH answer's `next_step`), `e2e/pipeline-drag.spec.ts` (also asserts the `yyyy-MM-dd` follow-up).

**Needs part B (owner of e2e/won.spec.ts):** that spec reads `GET /api/leads/:id` and posts `/api/leads`
in camelCase. Required edits: `status` → `status_id`, `customerId` → `customer_id` (4 places), and the POST
body `{ company_name, contact_name, phone, email, source_id, industry_id }`.

### Lead status model

Statuses carry `type` (`open | won | lost | cold | parked`), `probability`, `requiresNextStep` and
`requiresLossReason` (API: `type`, `probability`, `requires_next_step`, `requires_loss_reason`). This replaces
`kind` + the single `requires` enum:

| Old | New |
|---|---|
| kind `open` | type `open` |
| kind `parked` (Cold) | type `cold` |
| kind `parked` (any other) | type `parked` |
| kind `won` / requires `convert` | type `won` (only the Won flow sets it) |
| kind `lost` | type `lost` |
| requires `next-step` | `requiresNextStep: true` |
| requires `loss-reason` | `requiresLossReason: true` |

Rules read the flags, never names: `moveActionFor` (modules/leads/lib/transitions.ts: won → Won dialog,
loss reason, next step, direct), the server stage rules (`moveLeadStage`: `type === 'won'` → 409
`use_won_flow`; flags → required fields; non-open types clear the follow-up), `isWonFlowStatus`
(data/lookups.ts: `type === 'won'`), `StageChangeModal` (`requirementOf`), the lead form and schema, the
Settings list editor (Type select with all five types, Requires select None / Next step & date / Loss reason,
"Won flow" for won statuses), the pipeline preview, `useLookups` (`isClosed` = type ≠ open, `isParked` =
cold or parked), `coldStatusKey` (first active `cold`, else `parked`), reports, dashboard, quotation
"moves to Proposal", reopen eligibility. `PUT /lookups/lead_statuses` validates `type`, boolean flags, not
both flags, no flags on a won status, built-ins keep their type, and refuses turning a status leads sit in
into a won status. Shared helpers: `src/shared/domain/leadStatus.ts`. Part B's `won.test.ts` fixtures moved
from `requires: 'convert'` to `type: 'won'`.

## Part B: tasks, projects, time entries, Won flow, bundle hygiene

Reference: *Apex Aora ERP Database Design v1.0* (tables `tasks`, `task_followers`, `comments`, `attachments`,
`time_entries`, `projects`, `project_templates`, `project_template_tasks`, `contracts`, `contacts`, `leads`,
`lead_status_history`, `quotations`, `notifications`). The MSW mock (`src/shared/mocks/**`) is the API
contract; field names are the design's columns in camelCase so the mapper layer (`src/shared/api/mapping.ts`,
part A) can map them to snake_case later. Endpoint details: `docs/API.md` › Tasks, Projects, The Won flow.

Persisted demo data: `VERSION` in `src/shared/mocks/persist/registry.ts` is bumped (5), so data saved in the old
shape is discarded and the browser reseeds; the seed itself goes through the migration below.

### Tasks

**Enums** — one typed source, `src/modules/tasks/enums.ts` (value tuple + type + labels + badge tones), used by
the screens, the mock API, the tests and these docs:

| Column | Values (wire) | Labels |
|---|---|---|
| `tasks.status` | `todo` · `in_progress` · `review` · `done` · `cancelled` | To do · In progress · Review · Done · Cancelled |
| `tasks.priority` | `low` · `medium` · `high` · `urgent` | Low · Medium · High · Urgent |
| `projects.status` | `planned` · `active` · `on_hold` · `completed` · `cancelled` | Planned · Active · On hold · Completed · Cancelled |

`done` and `cancelled` are closed (`isClosedTaskStatus`): not open, never overdue, no reminders, left out of
project progress. Old values answer `422`.

**Task ↔ design columns**

| `Task` field | Design column | Notes |
|---|---|---|
| `id`, `title`, `description`, `ownerId`, `createdBy`, `dueDate`, `estimatedHours`, `createdAt`, `updatedAt` | same | |
| `status`, `priority` | `status`, `priority` | enums above |
| `projectId` | `project_id` | real FK; shown as its own chip |
| `link { type, id }` | `related_type` + `related_id` | **one** optional link: `lead` · `customer` · `event` (no `project`) |
| `parentTaskId` | `parent_task_id` | sub-tasks, one level |
| `sortOrder` | `sort_order` | template order for generated tasks, sub-task order, else 0 |
| `completedAt` | `completed_at` | set when the status becomes `done`, cleared on reopen |
| `reminderSentAt`, `overdueNotifiedAt` | `reminder_sent_at`, `overdue_notified_at` | once-only reminders (below) |
| `blockedAt`, `blockedReason` | — | **Design gap** (below) |
| `followerIds` | `task_followers` (task_id, user_id) | |
| `comments[]` | `comments` (commentable = Task) | |
| `attachments[]` | `attachments` (attachable = Task) | below |
| `history[]` | — | activity log (the backend's audit / activity table) |
| `templateTaskId`, `dayOffset` | — | where a generated task came from (timeline) |

**Board / screens.** The board's columns are **To do, In progress, Review, Done**; **Cancelled** is a filter
("Show cancelled" adds the column, recent ones only), so the board stays usable. Lists, the drawer, My tasks,
the calendar, project tabs, the dashboard, department and overdue reports show labels.

**Blocked is a flag, not a status.** `blockedAt` + `blockedReason` (nullable):
- `POST /tasks/:id/block { reason }` — reason required, 3–280 characters, **enforced on the server** (`422`); the
  reason is posted as a comment "Blocked: …" and a history line; the **status stays** what it was. Closed task →
  `422`, already blocked → `409`.
- `POST /tasks/:id/unblock` — clears both fields, posts an "Unblocked" comment and history line (`409` if not blocked).
- Moving a task to `done` / `cancelled` clears the flag ("Unblocked (done)").
- `GET /tasks?blocked=true|false` filters on it.
- UI: the board's old Blocked column is gone and dragging never asks for a reason. **Block… / Unblock** is on each
  card's menu (⋯) and in the drawer header; a "Blocked" badge (reason as tooltip) shows on the board card, list
  row, drawer, My tasks rows, sub-task rows and the calendar's labels.

**Migration** (`src/shared/mocks/data/taskMigration.ts`, `migrateLegacyTask`, unit-tested; the seed goes through it):

| Old | New |
|---|---|
| `To do` · `In progress` · `Done` | `todo` · `in_progress` · `done` |
| `Blocked` | `in_progress` + `blockedAt` = the last status change to Blocked (history), else `updatedAt`; `blockedReason` = the last recorded "Blocked: …" comment, else **"Blocked (migrated)"** |
| `Low` … `Urgent` | `low` … `urgent` |
| `link { type: 'project', id }` | `link: null`, `projectId = id` |
| `attachments[].size / type` | `sizeBytes / mimeType` |
| `loggedHours` (number on the task) | one time entry (`entryDate` = completion or last update day, `isBillable` = has a project) |
| `completedAt` missing on a done task | `updatedAt` |
| new columns | `parentTaskId` null, `sortOrder` 0, `reminderSentAt` / `overdueNotifiedAt` null |

Seed result: the two Blocked tasks ("Quarterly VAT reconciliation draft", "Renew customs broker licence paperwork")
are `in_progress` with their recorded reasons; project tasks lost their project link; their hours are time entries.

**Sub-tasks** (`parentTaskId`):
- One level only: a sub-task can't have sub-tasks (`422`).
- Created with `POST /tasks { parentTaskId }` by someone who may change the parent; the parent must be open.
- Inherits the parent's **project and company** (a different `projectId` → `422`; a sub-task's own project can't be
  changed; changing the parent's project moves its sub-tasks).
- **Scope = the parent's**: whoever sees (may change) the parent sees (may change) its sub-tasks, besides the
  sub-task's own owner / follower / creator rules.
- Progress: `subtaskProgress { done, total }` on the parent (cancelled sub-tasks don't count); the drawer shows the
  list (toggle done, open, add) with a progress bar; board cards and rows show `done/total`.
- **Done**: a parent with open sub-tasks → `409` unless `force: true`. **Cancel**: cancelling a parent cancels its
  open sub-tasks (done ones stay); a sub-task of a closed parent can't be reopened (`422`). **Delete**: there is no
  task delete endpoint yet; with soft deletes (`tasks.deleted_at`) deleting a parent deletes its sub-tasks.

Files: `src/modules/tasks/{enums,types,schemas}.ts`, `components/{TaskBadges,TaskDrawer,TaskSubtasks,TaskTimeEntries,
TaskRow,TaskAttachments,TaskHistory,LinkChip,LinkPicker,QuickAddTask,useTaskActions,taskMeta}.tsx|ts`,
`pages/{TaskBoardPage,TaskListPage,MyTasksPage,TaskCalendarPage,ProjectsPage}.tsx`, `api/tasksApi.ts`,
`hooks/useTasks.ts`; mock: `data/tasks.ts`, `data/taskMigration.ts`, `selectors/tasks.ts`, `services/tasks.ts`,
`handlers/tasks.ts`.

### Projects

- `status` uses the enum above (`planned` default for the Won flow).
- New design columns on `Project`: **`contractId`** (projects.contract_id: the contract the Won flow created with
  it) and **`projectTemplateId`** (projects.project_template_id). The mock keys templates by service
  (`projectTemplateFor(serviceId)`), so `projectTemplateId` holds the service id when the template has tasks, else
  null; the backend stores the `project_templates.id`.
- `ProjectRow.loggedHours` = **projects.actual_hours**, the cached sum of the project's time entries.
- Completing a project with open tasks (not done or cancelled) → `409` unless `force`; progress leaves cancelled
  tasks out. Audit entries show status labels ("Planned → Completed").
- Template tasks are created with `status: todo`, `link: null`, `projectId`, `sortOrder` = template order.

Files: `src/modules/tasks/projects/*`, `pages/ProjectsPage.tsx`, `projectSchemas.ts`; mock `services/projects.ts`.

### Time entries & attachments

**Time entries** (`time_entries`) replace the number `loggedHours` on the task:

| `TimeEntry` field | Column |
|---|---|
| `id` | `id` |
| `projectId` | `project_id` (the task's project; null for a task outside projects — Design gap) |
| `taskId` | `task_id` |
| `userId` | `user_id` (who logged it) |
| `entryDate` | `entry_date` (yyyy-MM-dd) |
| `hours` | `hours` (decimal(5,2): > 0, ≤ 24, two decimals) |
| `description` | `description` (≤ 255, nullable) |
| `isBillable` | `is_billable` (default: true on a project task, else false) |
| `createdAt` | `created_at` |

- `POST /tasks/:id/time-entries`, `DELETE /tasks/:id/time-entries/:entryId` (the person who logged it or full
  scope). Store: `timeEntries` in `src/shared/mocks/data/tasks.ts`.
- `TaskView.loggedHours` = sum of the task's entries; `TaskView.timeEntries[]` (with `userName`).
- UI: the drawer's **Time** tab (entries + "Log hours": date, hours, description, billable) — the editable
  "Logged hours" field is now read-only (the sum); the project **Hours** tab shows a "Time entries" table (date,
  person, task, description, hours, billable), billable totals, and a person's logged hours are the entries they logged.

**Attachments** (`attachments`): `{ id, name, sizeBytes, mimeType, uploadedBy, uploadedAt }` —
`size` → **`sizeBytes`** (size_bytes), `type` → **`mimeType`** (mime_type); `name` is original_name. Upload body
`{ name, sizeBytes, mimeType? }` (old `{ size, type }` → `422`). Still counted against the plan's `storageMb`
(`usedOf(companyId, 'storageMb')` sums `sizeBytes`). `disk` / `path` belong to the real upload.

### Reminders (stored, once-only)

Owner reminder and manager overdue notice are **stored notifications** (`notifications` in
`src/shared/mocks/data/tasks.ts`, surfaced by `GET /alerts`), written by the company's reminder tick
`runTaskReminders(companyId, at = mock clock)` in `src/shared/mocks/services/taskReminders.ts`:

| Notice | To | When (company calendar: regional timezone, `companyDayOf`) | Marks |
|---|---|---|---|
| `task-due` | the owner (active) | due − N ≤ today ≤ due, N = Settings › Automation `taskReminderDaysBefore` | `reminderSentAt` |
| `task-overdue` | the owner's manager (`users.managerId`, active, same company) | from the first day after the due date | `overdueNotifiedAt` (also set when there is no manager) |

- **Once**: a set mark means never again; **re-armed** when the due date changes (both marks cleared by `PATCH`).
- Done / cancelled tasks get neither. Each notification carries `taskId` and lands in the task's company only.
- **Lifecycle tick, lazily per company** (like billing's `runLifecycle`): `GET /alerts`, `GET /tasks`,
  `GET /tasks/:id` run it for the caller's company before answering. The backend runs it from the scheduler.
- The bell: stored reminders show as `task` / `task-overdue` with `stored: true` (can be marked read). The owner's
  own overdue tasks and, for team/full scopes, every overdue task in scope stay a computed alert (clears when
  done or rescheduled); a task the viewer already got a stored notice for is not listed twice.
- Tests (`taskAlignment.test.ts`): sent once across many ticks and requests, re-armed after a due-date change,
  per-company isolation, midnight in Dubai vs UTC; `alerts.test.ts`, `taskRules.test.ts`.

### Won flow alignment

What `POST /leads/:id/won` now writes (all inside the same snapshot / rollback):

| Record | Columns written |
|---|---|
| lead | `status` (won), **`customerId`**, **`wonAt`** (leads.won_at), follow-up cleared |
| **lead_status_history** | `{ leadId, fromStatusId, toStatusId, changedBy, reason: 'Won (Won flow)', changedAt }` |
| contacts of the lead | **`customerId`** (contacts.customer_id); `leadId` kept — nothing copied |
| accepted quotation | **`customerId`**, **`acceptedAt`** (its decision time, else now) |
| contract | `customerId`, **`quotationId`**, **`createdBy`**, title, value, billing, dates, status |
| projects | `customerId`, `serviceId`, `leadId`, `quotationId`, **`contractId`**, **`projectTemplateId`**, `managerId`, dates, `status: planned`, `estimatedHours` |
| tasks | design shape (see Tasks): `status: todo`, `priority`, `projectId`, `link: null`, `sortOrder`, `estimatedHours`, reminder marks null |

The rollback snapshot now also covers `contacts`, `quotations` and `leadStatusHistory`.

**`lead_status_history` store** (new): `src/shared/mocks/data/leadStatusHistory.ts`

```ts
recordLeadStatusChange(lead: { id, companyId }, fromStatusId: string | null, toStatusId: string,
  opts?: { changedBy?: string | null; reason?: string | null; at?: string }): row | null   // no row when from === to
statusHistoryOf(leadId): rows (oldest first)
```

Rows: `{ companyId, id: 'LSH-n', leadId, fromStatusId, toStatusId, changedBy, reason, changedAt }` (status keys;
the backend stores lead_statuses ids). The Won flow calls it. **To wire (part A / lead):** the pipeline stage
move (`moveLeadStage` in `services/leads.ts`), lead create (`fromStatusId: null`) and any other status write should
call `recordLeadStatusChange(lead, prevStatus, nextStatus, { changedBy: user.id, reason: lossReason || nextStep, at })`
so every change gets a row.

**Template tasks without a role.** `project_template_tasks` has no role column. A template task without a role
now plans as `role: null` (preview "No role") and goes to the project manager (`fallbackOwner: true`) instead of
failing — see Design gaps.

Files: `src/shared/mocks/services/won.ts`, `src/modules/won/{plan,types}.ts`, `components/WonDialog.tsx`; types
`Lead.wonAt`, `Contact.customerId`, `QuotationRecord.acceptedAt`, `Contract.quotationId / createdBy` (optional
fields). Tests: `wonAlignment.test.ts`, `won.test.ts`, `e2e/won.spec.ts`.

### Bundle hygiene

Test hooks are read only when `import.meta.env.DEV || import.meta.env.MODE === 'test'`, so Vite replaces the
condition with `false` in a production build and the minifier drops the branch with the hook names:

| Hook | Where |
|---|---|
| `window.__apexMoveFailureRate` | `services/tasks.ts` (`taskMoveFailureRate`), `services/leads.ts` (`moveFailureRate`) |
| `window.__apexWonFailAt`, `window.__apexWonFailWith` | `services/won.ts` (`failpoints`) |
| `window.__apexDevReset` | `persist/browser.ts` (dev reset helper) |

Dev and tests keep them (Playwright runs against the dev server). Check: `npm run build`, then search `dist/`
for `__apex` → no match.

## API mappers for the remaining modules (phase 2)

Phase 2 of the API boundary layer (part A, "API boundary layer"): every converted module speaks the
"Apex Aora ERP Database Design" column names on the wire. Mappers live in `src/shared/api/mappers.ts`;
mock handlers serialize with `respondAs` and parse bodies with `bodyAs`; the client api functions map
back, so hooks, screens and mock services keep their camelCase types. Error envelopes
`{ message, code, …details }` (including the Won flow's `step` and the 402 limit details) are never mapped.

Each table lists only renames that are **not** the mechanical camelCase → snake_case conversion; every
other field is converted mechanically (`startDate ↔ start_date`). "gap" = the design has no column for
the field (the name used is its snake_case form); these feed the gaps section (part C).

Note on nested values: the mapper converts the keys of a record and of every field declared `nested`;
nested objects are always declared (an empty `defineMapper()` = mechanical), so no camelCase key leaks.
Enum **values** are unchanged (e.g. contract billing `Monthly`, not the design's `monthly`).

### 1. Customers (`customers`)

`GET /customers`, `GET /customers/:id`, `PATCH /customers/:id`.

| UI field | API / DB column | Note |
|---|---|---|
| industry | industry_id | value = list key |
| subIndustry | sub_industry_id | gap (design: one `industry_id` tree node) |
| ownerId | account_manager_id | |
| ownerName | account_manager_name | derived |
| address | address_line | |
| emirate | city | the UAE emirate is the city-level region; `country_code` comes from the workspace |
| wonAt | customer_since | design is a `date`; the app sends the won datetime |
| leadId | lead_id | gap (design links leads → customers by `leads.customer_id`) |
| wonValue | won_value | gap |
| sourceType | source_id | gap (carried from the lead) |
| serviceIds | service_ids | gap |
| companyServices | company_services | gap (tags) |

All other fields: mechanical snake_case (`contacts_count`, `active_contract_value`, `next_renewal`,
`days_to_renewal`, `last_activity_at`, `lifetime_value` — derived). Detail nests: `lead` (leads mapper:
`status_id`, `source_id`, `estimated_value`, …), `contacts` (contacts mapper), `contracts` (contract row
mapper), `recent_activities` (activities mapper), `notes` (notes mapper).
PATCH body: `status, website, address_line, city, account_manager_id`.

### 2. Contracts (`contracts`)

`GET /contracts`, `POST /contracts`, `PATCH /contracts/:id`.

| UI field | API / DB column | Note |
|---|---|---|
| value | cycle_value | gap (part A proposal; design has `total_value`) |
| billing | billing_period | gap on contracts (`contract_items.billing_period`); values stay `One-off / Monthly / Annual` |
| serviceIds | service_ids | gap (design: `contract_items.service_id` rows) |
| ownerId | owner_id | gap (design has `created_by` only) |

All other fields: mechanical (`customer_id`, `quotation_id`, `created_by`, `start_date`, `renewal_date`,
`status`; derived `renewal_due`, `customer_name`, `owner_name`, `service_names`, `days_to_renewal`,
`annual_value`, `mrr`).

### 3. Quotations (`quotations`, `quotation_items`)

All quotation endpoints incl. `/send`, `/status` (body `{ status }`), `/viewed`, `/duplicate`.
Query: `GET /quotations?lead_id=`.

| UI field | API / DB column | Note |
|---|---|---|
| currency | currency_code | |
| vatPct | tax_percent | gap on quotations (design: `quotation_items.tax_percent`, `quotations.tax_total`) |
| company | company_name | gap (client details copied from the lead) |
| contactName | contact_name | gap |
| contactEmail | contact_email | gap |
| viewedAt | viewed_at | gap (part A) |
| decidedAt | decided_at | gap (part A) |
| totals.discount | totals.discount_total | |
| totals.vat | totals.tax_total | |
| item.discountPct | discount_percent | |
| item.currency | currency_code | gap (line currency) |
| item.unit | unit | gap |
| item.groupId / groupLabel | group_id / group_label | gap (package grouping; design `service_package_id`) |

All other fields: mechanical (`number`, `lead_id`, `customer_id`, `valid_until`, `created_by`,
`sent_at`, `accepted_at`, `notes`, `terms`; items `service_id`, `unit_price`, `quantity`; derived
`owner_id`, `owner_name`, `created_by_name`, `totals.subtotal`, `totals.total`).

### 4. Won flow (`POST /leads/:id/won`, `/won/preview`)

Body: `quotation_id, service_ids, project_manager_id, start_date, idempotency_key` (all mechanical;
`project_manager_id` → `projects.manager_id`). Result: `lead_id, customer_id, customer_created,
contract_id, project_ids, task_ids, redirect_to`.

| UI field (preview) | API | Note |
|---|---|---|
| company | company_name | leads column |
| status | status_id | leads column |
| contract.value / billing | contract.cycle_value / billing_period | contract mapper |
| projects[].tasks[].hours | estimated_hours | tasks column |

All other preview fields: mechanical (`already_won`, `quotation_options`, `defaults.project_manager_id`,
`projects[].has_template`, …). Error bodies (`step`, `code`, limit details) unchanged.

### 5. Messages (`POST /leads/:id/messages`, table `messages`)

| UI field | API / DB column | Note |
|---|---|---|
| to | to_address | |
| templateId | message_template_id | gap on `messages` (the design has it on quotations) |
| email.from | email.from_address | |

All other fields: mechanical. Answer nests `activity` (activities mapper: `occurred_at`, `user_id`…) and
`auto_status` (`from_status_id`, `to_status_id`).

### 6. Services, packages, project templates (`services`, `service_packages`, `service_package_items`, `project_template_tasks`)

| UI field | API / DB column | Note |
|---|---|---|
| service.category | category_id | value = list key |
| service.industries | industry_ids | gap on services (design: `service_industry` pivot) |
| service.currency | currency_code | |
| service.active | is_active | also on detail `packages[]` and package `lines[]` |
| package.packagePrice | price | |
| package.currency | currency_code | |
| package.active | is_active | |
| templateTask.hours | estimated_hours | |
| templateTask.role | role | gap (delivery role) |
| template.updatedBy | updated_by | gap |
| detail.recommendingLeads[].company / status | company_name / status_id | leads columns |
| detail.recentQuotations[].company | company_name | |

All other fields: mechanical (`pricing_type`, `delivery_days`, `created_at`, `usage.leads_recommending`,
`template_tasks`, `template_hours`, `package_count`, `items[].service_id`, `list_price`, `saving_pct`,
`template.service_id`, `day_offset`).

### 7. Tasks (`tasks`, `task_followers`, `comments`, `attachments`, `time_entries`)

All `/tasks*` endpoints (list, assignable, detail, create, update, block / unblock, comments,
attachments, time entries). Query: `owner_id, project_id, related_type, related_id, status, priority,
due_from, due_to, include_done, blocked, mine` (the old camelCase names are ignored).

| UI field | API / DB column | Note |
|---|---|---|
| link {type, id} | link {type, id} | the design's `related_type` / `related_id` morph (query uses those names) |
| followerIds | follower_ids | `task_followers` rows |
| attachment.name | original_name | |
| attachment.uploadedAt | created_at | |
| comment.authorId | user_id | |
| comment.at | created_at | |
| comment.mentions | mentions | gap |
| history[].at | created_at | gap: task history (design: `audit_logs`) |
| blockedAt / blockedReason | blocked_at / blocked_reason | gap |
| templateTaskId / dayOffset | template_task_id / day_offset | gap on tasks |

All other fields: mechanical (`owner_id`, `due_date`, `parent_task_id`, `estimated_hours`, `sort_order`,
`completed_at`, `size_bytes`, `mime_type`, `uploaded_by`, `entry_date`, `is_billable`; derived
`owner_name`, `follower_names`, `link_view`, `can_edit`, `logged_hours`, `time_entries`, `subtask_progress`).
Block body `{ reason }`; assignable rows `id, name, title, role, department_id`.

### 8. Projects (`projects`)

`GET/POST /projects`, `GET/PATCH /projects/:id`. Every field is a design column or mechanical:
`customer_id, service_id, quotation_id, contract_id, project_template_id, manager_id, name, status,
start_date, end_date, estimated_hours, created_at`. Gaps: `lead_id`, `created_by`, `created_from`
(`won | manual`); body-only `generate_tasks`, `force`. Derived: `customer_name, service_name,
manager_name, task_count, done_count, overdue_count, progress, logged_hours, can_manage`. The detail
nests `tasks` (task mapper, §7) and `audit` (audit_logs mapper, §10).

Audit entries (`audit_logs`, used by the project detail and `GET /audit-log`):

| UI field | API / DB column | Note |
|---|---|---|
| at | created_at | |
| action | event | |
| entity | auditable_type | |
| entityId | auditable_id | |
| changes [{field, from, to}] | changes | gap (design `old_values` / `new_values` json); `from` / `to` opaque (values as stored) |
| summary | summary | gap |

### 9. Departments (`departments`; goals = the `departments.goals` json)

All `/departments*` endpoints (list, org chart, detail, create, update, (de)activate, members, goals,
move members). Query: `?include_inactive=true`.

| UI field | API / DB column | Note |
|---|---|---|
| headId | head_user_id | |
| costCenter | cost_center_code | |
| active | is_active | also on members, children and org chart nodes |
| goals[] {title, ownerId, dueDate, status, createdAt} | goals[] {title, owner_id, due_date, status, created_at} | keys of the design's `goals` json |

All other fields: mechanical (`parent_id`, `created_at`; derived `head_name`, `parent_name`,
`member_count`, `child_count`, `open_tasks`, `figures.*`, `can.manage_members`, members' `manager_id`,
`is_head`). Move members body: `user_ids, to_department_id, manager_id`; member PATCH body: `manager_id`.

### 10. Settings users, roles, security, audit log

**Users** (`users`; `GET/POST /settings/users`, `PATCH /settings/users/:id`, deactivate / reactivate):

| UI field | API / DB column | Note |
|---|---|---|
| active | is_active | |
| role | role | the role name; design `role_id` → `roles` (gap: the app has no role ids) |
| title | title | gap |
| twoFactorEnabled | two_factor_enabled | derived from `users.two_factor_secret` |

All other fields: mechanical (`company_id`, `department_id`, `manager_id`, `last_login_at`, `created_at`;
derived `department_name`, `manager_name`, `direct_reports`, `open_leads`). The deactivate 409
`{ message, openLeads }` is an error envelope and stays unchanged. `GET /settings/departments`: `id, name`.

**Roles** (`GET /settings/roles`, `roles` + `role_module_access`): `system` → `is_system`;
`permissions` is **opaque** (a map keyed by module key → access level; the design stores one
`role_module_access` row per module).

**Security** (`/security/*`): every field is mechanical snake_case (`enabled_at`, `recovery_codes_left`,
`otpauth_url`, `recovery_codes`, `last_active_at`, `last_success_at`, `next_at`, `retention_days`,
`history[].started_at`, `size_mb`, `triggered_by`, `require_two_factor_for_admins`,
`session_timeout_minutes`, `password_min_length`). No design tables (sessions, backups, policy: gaps).
The secrets guard of the isolation harness now checks keys without underscores too
(`recovery_codes`, `password_hash`…), so the guard is not weakened by snake_case.

**Audit log** (`GET /audit-log`): entries as in §8. Query: `auditable_type, user_id, event, from, to`.

**Deep mappers.** `MapperSpec.deep` (mapping.ts) converts every nested object at any depth; `opaque`
then applies to that key name at every level. Used for aggregates (reports, dashboard, consoles) whose
map-valued series are keyed by data. Tested in `mapping.test.ts` ("deep mappers").

### 11. Message templates, targets, automation rules, report schedules, reports, dashboard

**Message templates** (`message_templates`; `/templates*`; query `type, purpose, is_active`):

| UI field | API / DB column | Note |
|---|---|---|
| channel | type | `email` / `whatsapp` |
| active | is_active | |
| purpose | purpose | gap |
| isDefault | is_default | gap |
| updatedBy | updated_by | gap (design `created_by`) |

**Sales targets** (`/targets*`; design `activity_targets`: `user_id, month, metric, target_value`): the
app sends one row per agent; `values` and `actuals` are **opaque** maps keyed by metric (`leads`,
`calls`, … — data, not fields). All other fields mechanical (`user_id`, `is_default`, `can_edit`, `rows`).
Design gap: one row per metric vs. one map per agent.

**Automation rules** (`/settings/automation*`, `workflow_settings`):

| UI field | API / DB column |
|---|---|
| noContactReminderDays | first_contact_reminder_days |
| noResponseFollowUpDays | no_response_followup_days |
| attemptsBeforeCold | max_attempts_before_cold |
| stalledInterestedDays | interested_stalled_days |
| lostReopenDays | reopen_lost_after_days |

`renewal_alert_days`, `task_reminder_days_before`: mechanical (= design columns).

**Report schedules** (`/reports/schedules*`, `report_schedules`):

| UI field | API / DB column | Note |
|---|---|---|
| report | report_type | design: `saved_report_id` → `saved_reports.report_type` (gap: schedules point at a built-in report) |
| time | run_at | |
| day | day | gap (design `day_of_week` / `day_of_month`) |

All other fields mechanical (`frequency`, `recipients`, `format`, `created_by`, `created_by_name`, `next_run_at`).

**Reports and dashboard** (`GET /reports/sales`, `POST /reports/custom`, `GET /dashboard/summary`):
aggregates with no table, converted mechanically **at every depth** (deep mappers): `kpis.leads_created`,
`by_status`, `funnel_monthly`, `overdue_follow_ups[].lead_id`, `total_leads`, `series[].won_value`,
`tasks.my_open_tasks`… **Opaque:** `agents[].activities` (a map keyed by activity type). Enum values
(e.g. custom measure `wonValue`) are values, unchanged. Sales report query: `from, to, owner_id, department_id`.

### 12. Company profile, branding, onboarding, email connection, announcements

**Branding** (`GET/PATCH /settings/branding`, `POST /settings/branding/reset`; `companies`):

| UI field | API / DB column | Note |
|---|---|---|
| primaryColor (settings, branding, PATCH body) | brand_color | |
| branding.logoUrl | logo_url | the served URL of `companies.logo_path` |
| branding.logoDarkUrl / faviconUrl | logo_dark_url / favicon_url | gap |
| branding.monogram, emailSenderName, emailSenderAddress | monogram, email_sender_name, email_sender_address | gap |
| branding.palette | palette | **opaque** (keyed by shade `50`…`900`; derived) |
| PATCH logoLight / logoDark / favicon / displayName | logo_light / logo_dark / favicon / display_name | request-only (data URLs) |
| regional.country / currency | country_code / currency_code | companies columns |

PATCH / reset answer the company: `id, name, subdomain` (company_domains.domain), `status, plan,
enabled_modules, regional, branding, profile, created_at`. `limits`: `logo_max_bytes`, `favicon_max_bytes`,
`types`, `display_name_max`. `GET /public/workspaces/:subdomain` and `GET /tenant` (auth) are **not**
converted (module 13 / auth).

**Company profile** (`GET/PATCH /settings/company-profile`): no design columns beyond `companies.name`;
every field is a gap, converted mechanically at every depth (`legal_name`, `trade_name`,
`address.line1`, `tax_number`, `commercial_license_no`, `bank.bank_name`, `location.lat`…). Field-level
422 details keep their dotted UI paths (error envelopes are not mapped).

**Onboarding** (`/onboarding*`): mechanical (`items[]`, `done`, `total`, `complete`, `dismissed`); bodies
`{ dismissed }`, `{ done }`. No design table (gap).

**Email connection** (`/settings/email-connection`): `provider, address, connected_at, connected_by` (gap;
design `integrations`).

**Announcements** (company side, `GET /announcements`): `id, title, body, tone, ends_at` (`tone`: gap).
`POST /announcements/:id/dismiss` has no body.

### 13a. Billing (`subscriptions`, `plans`, `plan_limits`, `platform_invoices`, `usage_records`)

`GET /billing/entitlements`, `GET /billing/overview`, `POST /billing/change-plan`, `/trial-plan`,
`DELETE /billing/scheduled-change`, `POST /billing/payment-method`, `/cancel`, `/resume`, `/reactivate`,
`GET /billing/export`, `POST /ai/credits/consume`, module stubs. Deep mapper: every field mechanical at
every depth — `plan_id`, `plan_name`, `read_only`, `trial_days_left`, `grace_ends_at`, `server_now`,
`subscription.current_period_start / current_period_end / payment_method.exp_month / scheduled_change.to_plan /
cancel_at_period_end / selected_plan_id`, `usage.period_start / items[].percent`, `invoices[].issued_at`,
`plans[].billing_period`, `settings.trial_reminder_days`. Bodies: `plan_id`, `holder, card_number, expiry, cvc`,
`credits`. Design names that differ only in meaning (not renamed, noted): `currency` (design `currency_code`),
`plan.active` (design `is_active`), `invoice.amount` (design `total`).

**Opaque:** `limits` (map keyed by limit key: `users`, `leadsContacts`, `storageMb`… = `plan_limits.metric`
values), the export's `counts` and `data` (keyed by store; rows are exported as stored), the dev `simulated`
usage. Error envelopes (402 `LIMIT_REACHED` with `limit, current, max, planId`; 403 `module_not_in_plan`; 423)
are unchanged. Not converted: the dev-only `/dev/billing/*` simulator (no backend counterpart).

### 13b. Public sign-up (`/public/*` except the workspace lookup)

`GET /public/plans`, `GET /public/signup/availability`, `POST /public/signup`, `GET /public/signup/:id`,
`POST /public/signup/:id/resend | verify | complete`, `POST /public/checkout`, `POST /public/contact-sales`.
No design table until the company exists (sign-ups, checkouts and sales requests are gaps). Deep mapper,
all mechanical: `company_name, admin_name, admin_email, accept_terms, signup_id, resend_in_seconds,
code_expires_at, dev_code, paid_checkouts[].checkout_id, checkout_id, card_number, continue_plan_id,
request_id`. Plans keep `limits` opaque (as in billing). **Not mapped:** the session answered by
`/complete` (same shape as `POST /auth/login`; the auth module is not part of this pass) and
`GET /public/workspaces/:subdomain` (auth handler).

### Not converted (still camelCase)

| Endpoints | Why |
|---|---|
| `/platform/*` (Super-Admin console, 26 handlers) | Not reached in this pass: a trial conversion (one deep mapper, opaque `limits`, `before`, `after`) broke 25 assertions in `platform.test.ts` / `platform.isolation.test.ts` (impersonation sessions, subdomain aliases, plan versions); it was reverted to stop at a green module boundary. Next in line. |
| `/auth/*`, `/tenant`, `/users`, `/public/workspaces/:subdomain`, the sign-up completion session, `/platform/auth/login` | Session payloads: outside this pass's module list; converting them changes the auth store and every session-shaped answer at once. |
| `/account*`, `/alerts*` | Outside this pass's module list. |
| `/dev/billing/*` | Dev-only simulator, no backend counterpart. |

### Tests changed (request / response bodies in the new names, no assertion removed)

Isolation table samples (`isolation/endpoints.ts`), `scoped`, `automations`, `enforcement`, `secrets`,
`platform` isolation tests, `app/isolation/permissions` and `won` isolation tests, `services/branding.test.ts`,
`services/platform.test.ts` (billing trial-plan / change-plan bodies, company announcement keys),
`e2e/won.spec.ts` (snake_case only, the camel/snake `field()` fallback removed), `e2e/tasks-board.spec.ts`,
`e2e/branding.spec.ts`. The isolation harness's secrets guard now also matches snake_case secret keys
(`bare(k)`), so the guard is not weakened. New: `mapping.test.ts` "deep mappers" (2 tests). The
permissions test maps the sales report back with the client mapper before building the Excel sheets and
asserts the wire uses `kpis.leads_created`.

## Design gaps

Mismatches not covered by the changes above, each with a proposed table/column. Nothing was changed for them.

### Gaps found while aligning (parts A, B and D)

#### Part A

| Mismatch | Proposal |
|---|---|
| `leads.next_follow_up_at datetime`; the product needs a calendar date (company-local "today / overdue") | `leads.next_follow_up_date date NULL` (+ `INDEX (company_id, owner_id, next_follow_up_date)`); drop or keep `next_follow_up_at` only for a time-of-day reminder |
| `lead_statuses.requires_next_followup` | `requires_next_step bool NOT NULL default 0` (entering needs `next_step` **and** `next_follow_up_date`) + `requires_loss_reason bool NOT NULL default 0` |
| `lead_statuses` has no probability | `probability tinyint unsigned NOT NULL default 0` (0–100, weighted forecast) |
| `lead_statuses` has no built-in flag / badge tone | `is_system bool NOT NULL default 0` (built-ins: renamable, type fixed, never deleted); `tone string(20) NULL` (or derive from `color`) |
| `leads` has no next step | `leads.next_step string(255) NULL` |
| `leads` has no deal value | `leads.estimated_value decimal(14,2) NULL` (+ `currency_code`) |
| `leads` has no stage-entered time | `leads.stage_changed_at datetime NULL` (cache of the latest `lead_status_history.changed_at`; drives "days in stage", reopen eligibility, stalled alerts) |
| Loss reason details | `leads.loss_reason_note string(500) NULL` (today: `"<key> — details"` in one value) |
| Primary contact copied on the lead (`contact_name`) | keep on `contacts.is_primary`; the API derives `contact_name` / `email` / `phone` from the primary contact, or add `leads.contact_name string(255) NULL` as a denormalized cache |
| Sub-industry: two fields in the app, one `industry_id` in the design | keep `industry_id` → the most specific node and derive the parent, or add `leads.sub_industry_id` FK → `industries.id` |
| Services of interest (`serviceIds`) | `lead_service (company_id, lead_id, service_id)` pivot, PK `(lead_id, service_id)` |
| Company services as tags (`companyServices`) | use `tags` + `taggables` (`taggable_type = Lead`), tag group "company services" (`tags.group string(30)`) |
| Legacy unmatched recommendation text | `leads.recommended_service_text string(255) NULL` (migration leftover; cleared when an id is picked) |
| Lists: protected / hidden items (`system`, `hiddenFromPickers` on loss reasons…) | `is_system bool` and `hidden_from_pickers bool` on `lead_sources`, `industries`, `loss_reasons`, `tags`; `loss_reasons.sort_order int` (missing) |
| Quotation viewed time | `quotations.viewed_at datetime NULL` (+ a signed share link: `quotation_links (id, company_id, quotation_id, token char(64) UNIQUE, expires_at, first_viewed_at)` for the public view that sets it) |
| Quotation decided time | `quotations.decided_at datetime NULL` (design has only `accepted_at`; rejections need it too), or `rejected_at` |
| Contract "expiring" | not a status: derived from `renewal_date` and `workflow_settings.renewal_alert_days` (API field `renewal_due`) — no column needed |
| Contract billing / value per cycle (`billing`, `value`) | `contracts.billing_period string(20)` (`one_time / monthly / yearly`, like `contract_items`) + `contracts.cycle_value decimal(14,2)`, or move them to `contract_items` |
| Contacts endpoint's `record_type` / `record_id` | API convenience over `contacts.lead_id` / `contacts.customer_id`; no column needed |
| Activities / notes on a lead (`lead_id`) | the design's morphs (`subject_type/subject_id`, `note_type/note_id`); the lead endpoints imply `subject_type = Lead` |
| Import result: failures listed per row | `lead_imports.error_report_path` covers the file; per-row JSON would need `lead_imports.failures json NULL` |
| Customer status `churned` has no date | `customers.churned_at date NULL` (churn reports) |

#### Part B

| Gap | Proposed table / column | Why |
|---|---|---|
| Blocked flag | `tasks.blocked_at datetime NULL`, `tasks.blocked_reason string(280) NULL` (+ `INDEX (company_id, blocked_at)` for the "blocked only" filter) | Blocked is a flag across statuses (a task can be blocked while in progress or in review); the reason is required (3–280) and also posted as a comment. |
| Template task role | `project_template_tasks.default_role_id bigint NULL -> roles.id` (or a delivery-role lookup) | The Won flow assigns template tasks by role (Developer, QA…); without the column every task falls to the project manager ("unassigned role"). |
| Time on tasks outside projects | `time_entries.project_id` NULL (today NOT NULL), `CHECK (project_id IS NOT NULL OR task_id IS NOT NULL)` | Hours can be logged on personal / lead tasks; the mock stores `projectId: null` there. |
| Task activity history | `task_activities` (or the shared `activity_log` with subject = Task): `task_id, user_id, kind, summary, created_at` | The drawer's Activity tab (status / owner / due / hours changes) has no table. |
| Comment mentions | `comment_mentions (comment_id, user_id)` | `@mentions` notify users and are stored per comment. |
| Template origin on tasks | `tasks.project_template_task_id NULL -> project_template_tasks.id` (and `day_offset` copied) | The timeline places generated tasks by their template offset (`templateTaskId`, `dayOffset`). |
| Who created a project and how | `projects.created_by`, `projects.created_from` (`won` / `manual`), `projects.lead_id` | The UI shows where a project came from and links back to the won lead. |

#### Fields with no design column (part D)

- customers: `sub_industry_id`, `lead_id`, `won_value`, `source_id`, `service_ids`, `company_services`
- contracts: `cycle_value`, `billing_period` (on contracts), `service_ids`, `owner_id`
- quotations: `company_name`, `contact_name`, `contact_email`, `tax_percent` (on quotations), `viewed_at`, `decided_at`;
  quotation items: `unit`, `currency_code`, `group_id`, `group_label`
- messages: `message_template_id`
- services: `industry_ids` (pivot `service_industry`); project template tasks: `role`; templates: `updated_by`
- tasks: `follower_ids` (pivot), `mentions`, task history `created_at` entries, `blocked_at`, `blocked_reason`,
  `template_task_id`, `day_offset`
- projects: `lead_id`, `created_by`, `created_from`
- audit entries: `summary`, `changes` (design `old_values` / `new_values`)
- departments: goal keys inside `goals` json (`owner_id`, `due_date`, `status`)
- users: `title`, `two_factor_enabled`, `role` by name (design `role_id`)
- security: sessions, backups and the security policy (no tables)
- message templates: `purpose`, `is_default`, `updated_by`
- targets: one row per agent with metric maps (design: one `activity_targets` row per metric)
- report schedules: `report_type` without a saved report, `day` (design `day_of_week` / `day_of_month`)
- company profile: every field except the name (`legal_name`, `trade_name`, `address.*`, `location`,
  `tax_number`, `commercial_license_no`, `phone`, `email`, `website`, `bank.*`)
- branding: `logo_dark_url`, `favicon_url`, `monogram`, `email_sender_name`, `email_sender_address`
- onboarding, email connection, sign-up, checkout, contact-sales: no tables
- announcements: `tone`

### Design-gap audit (part C)

Audit of the Apex CRM frontend and MSW mock API against **Apex Aora ERP Database Design v1.0** (88 tables, 12 domains).
This is a read-only audit. No source file was changed.

**Not covered here** (other workstreams handle them): the customer, quotation, contract, project and task status/priority enums; `leads.next_follow_up_date` as a date; the snake_case mapper; lead-status flags (type/probability/requires_next_step/requires_loss_reason); task blocked, `parent_task_id`, single related link + `project_id`, `completed_at`, `reminder_sent_at`/`overdue_notified_at`; time entries; attachment `mime_type`/`size_bytes`; Won-flow `customer_id`/`won_at`/`lead_status_history`/`accepted_at`; project template `default_role_id`. Pure camelCase/snake_case renames are skipped.

**Legend.** *Change in:* **D** = change the design, **A** = change the app (types, mock and API.md), **D+A** = both. Severity: **H** = blocks a feature or loses data, **M** = needs a column, table or mapper rule, **L** = cosmetic or later phase.

---

#### Design gaps

##### 1. Platform & billing

**PB-1 Plan versioning has no table (H)**
- Design: `plans` holds one price/period. `plan_limits` and `plan_module` are keyed only by `plan_id`. `subscriptions` has no version column.
- App: `src/modules/billing/types.ts:59` `Plan.version`, `:124` `planVersion`, `:126` `pendingPlanVersion`; `src/shared/mocks/data/plans.ts:82-106` `PlanVersionRecord` (price, billingPeriod, limits, modules per version); `src/modules/platform/types.ts:208-246` (`PlanMigration` keep/at_renewal/now).
- Impact: platform plan edits would change existing subscribers' price and limits. The app's grandfathering cannot be stored.
- Proposed (**D**):
  ```sql
  CREATE TABLE plan_versions (id bigint PK, plan_id bigint FK->plans NOT NULL, version int NOT NULL,
    price decimal(14,2) NULL, currency_code string(3), billing_period string(20), limits json NOT NULL,
    modules json NOT NULL, created_by bigint FK->platform_admins NULL, created_at timestamp,
    UNIQUE (plan_id, version));
  ALTER TABLE subscriptions ADD plan_version int NOT NULL DEFAULT 1, ADD pending_plan_version int NULL;
  ```
  Alternative: key `plan_limits` and `plan_module` by `plan_version_id`.

**PB-2 Plan columns the app relies on are missing (M)**
- Design: `plans`: code, name, price NOT NULL, billing_period `monthly|yearly`, trial_days, is_public, is_active, sort_order.
- App: `billing/types.ts:42` `price: number|null` (null = free or contact us), `:36` `'month'|'year'`, `:47` `highlights[]`, `:49` `checkout: none|payment|contact`, `:53` `rank`.
- Impact: Trial and Enterprise plans can't be stored (price is NOT NULL). There is no home for the plan-card bullets or the checkout mode. Period values differ.
- Proposed (**D+A**): `ALTER TABLE plans MODIFY price decimal(14,2) NULL, ADD highlights json NULL, ADD checkout_mode string(20) NOT NULL DEFAULT 'payment' /* none|payment|contact */;` In the app, map `month|year` to `monthly|yearly` and `rank` to `sort_order`.

**PB-3 Limit metrics differ in meaning (M)**
- Design: `plan_limits.metric` = `users | leads | storage_mb | emails_month | ai_credits_month | api_calls`; `usage_records.period` string(7) `YYYY-MM`.
- App: `billing/types.ts:27` `LimitKey = users | leadsContacts | storageMb | emailsPerMonth | aiCredits`. One combined leads + contacts limit (`leads/types.ts:221-226`). Per-period counters reset on the **subscription billing period** (`data/subscriptions.ts:142-147` `PeriodCounter.periodStart`), not the calendar month.
- Impact: `leads` alone undercounts the app's limit. A `YYYY-MM` period breaks counters for subscriptions that renew mid-month.
- Proposed (**D**): add the metric `leads_contacts` (or document that `leads` counts leads + contacts). Change `usage_records.period string(7)` to `period_start datetime NOT NULL, period_end datetime NOT NULL` with `UNIQUE (company_id, metric, period_start)`.

**PB-4 Subscription lifecycle columns missing (H)**
- Design: `subscriptions`: status, gateway ids, trial_ends_at, current_period_*, grace_ends_at, cancel_at, cancelled_at. Status `trialing|active|past_due|suspended|cancelled`.
- App: `billing/types.ts:82` adds the status `deleted`; `:92-98` `scheduledChange {toPlan, effectiveAt, requestedAt, requestedBy}`; `:114` `cancelAtPeriodEnd`; `:116` `statusChangedAt`; `:120` `deleteAt`; `:122` `customPrice`; `:131` `selectedPlanId`; `:84-90` `paymentMethod {brand,last4,expMonth,expYear,holder}`.
- Impact: the downgrade scheduler, retention countdown, Enterprise negotiated price, trial conversion target and card display have nowhere to live.
- Proposed (**D**):
  ```sql
  ALTER TABLE subscriptions ADD scheduled_plan_id bigint NULL FK->plans, ADD scheduled_at datetime NULL,
    ADD scheduled_by bigint NULL FK->users, ADD status_changed_at datetime NOT NULL,
    ADD delete_at datetime NULL, ADD custom_price decimal(14,2) NULL,
    ADD selected_plan_id bigint NULL FK->plans, ADD card_brand string(20) NULL, ADD card_last4 string(4) NULL,
    ADD card_exp_month tinyint NULL, ADD card_exp_year smallint NULL;
  -- status += 'deleted' (after the retention purge)
  ```

**PB-5 Platform settings have no table (M)**
- Design: none. Retention and grace periods are described as "business decisions".
- App: `billing/types.ts:64-78` `PlatformBillingSettings` (trialDays, trialReminderDays[], graceDays, pastDueReminderDays[], suspendedDaysBeforeCancel, retentionDays, usageWarningThresholds[]); `platform/types.ts:252-256` (`subdomainRedirectDays`, `impersonationMinutes`); `data/plans.ts:117`, `data/platform.ts:34`.
- Proposed (**D**): `CREATE TABLE platform_settings (key string(100) PK, value json NOT NULL, updated_by bigint NULL FK->platform_admins, updated_at timestamp);`

**PB-6 Old subdomains with redirect windows (M)**
- Design: `company_domains (domain unique, is_primary, verified_at)`; `companies.slug` unique.
- App: `platform/types.ts:101-106` `SubdomainAlias {subdomain, redirectUntil, changedAt, changedBy}`; `data/platform.ts:39,62-80`; `tenancy/types.ts:140` `PublicCompany.redirectTo`.
- Impact: the design can't tell a live alias from an expired redirect, or say who changed it.
- Proposed (**D**): `ALTER TABLE company_domains ADD kind string(20) NOT NULL DEFAULT 'primary' /* primary|custom|redirect */, ADD redirect_until datetime NULL, ADD changed_by bigint NULL FK->platform_admins;`

**PB-7 Company status mixes billing and operator lock (M)**
- Design: `companies.status` = `trial|active|past_due|suspended|cancelled`, plus `subscriptions.status`.
- App: `tenancy/types.ts:11-16`: `CompanyStatus = active|trial|suspended`, where `suspended` means **operator lock only** and is separate from billing.
- Impact: in the design, a billing suspension and an operator lock look the same. Unlocking one can undo the other.
- Proposed (**D**): keep billing state in `subscriptions.status` only. Make `companies.status` = `active|locked` (or add `locked_at datetime NULL, locked_reason text NULL, locked_by bigint NULL FK->platform_admins`), and derive trial and past_due from the subscription.

**PB-8 Module override audit fields (L)**
- Design: `company_modules (company_id, module_id, is_enabled, source plan|addon|override, expires_at)`.
- App: `platform/types.ts:75-81` `ModuleOverride {module, enabled, reason, by, at}`; `data/platform.ts:38`.
- Proposed (**D**): `ALTER TABLE company_modules ADD reason text NULL, ADD set_by bigint NULL FK->platform_admins;`

**PB-9 Module codes differ (M)**
- Design: `modules.code` (HR, Events, Marketing, Accounting...); `role_module_access.module_key` = `sales_crm|services|marketing|accounting|hr|reports|settings`.
- App: `billing/types.ts:22` `PlanModule = ModuleKey | events | integrations | ai`; `shared/types/index.ts:14` `ModuleKey` includes `sales`, `departments`, `tasks`.
- Impact: there are no codes for the `departments` and `tasks` role modules, and the plan-only modules `integrations` and `ai` are missing. `sales` and `sales_crm` mean the same thing but are spelled differently.
- Proposed (**D+A**): seed `modules.code` with `sales_crm, services, marketing, accounting, hr, reports, settings, departments, tasks, events, integrations, ai`, and add `departments` and `tasks` to the `role_module_access.module_key` list. The app maps `sales` to `sales_crm`.

**PB-10 Platform invoices lack period and plan (M)**
- Design: `platform_invoices`: number (unique), status `draft|open|paid|void|uncollectible`, subtotal/tax/total, issued/due/paid.
- App: `billing/types.ts:162` status `paid|open|failed|void`; `:164-175` `periodStart, periodEnd, planId, description, amount`.
- Proposed (**D+A**): `ALTER TABLE platform_invoices ADD period_start datetime NULL, ADD period_end datetime NULL, ADD plan_id bigint NULL FK->plans, ADD description string(255) NULL;` The app's `failed` maps to `open` plus the latest `platform_payments.status='failed'`, or to `uncollectible`.

**PB-11 Announcements: tone and targeted audience (M)**
- Design: `announcements (audience all|plan|company, starts_at, ends_at)`. There are no target ids.
- App: `platform/types.ts:261-281` `tone info|warning|success`, `audience {plans[], countries[]}`; dismissals in `data/platform.ts:43-49`.
- Impact: plan or country targeting can't be stored, and per-user dismissals have no table.
- Proposed (**D**):
  ```sql
  ALTER TABLE announcements ADD tone string(20) NOT NULL DEFAULT 'info', ADD audience_plans json NULL, ADD audience_countries json NULL;
  CREATE TABLE announcement_dismissals (announcement_id bigint FK, user_id bigint FK->users, company_id bigint FK, dismissed_at datetime, PRIMARY KEY (announcement_id, user_id));
  ```

**PB-12 Support notes have no table (M)**
- App: `platform/types.ts:92-99` `SupportNote {companyId, body, authorId, at}`; `data/platform.ts:37`.
- Proposed (**D**): `CREATE TABLE company_support_notes (id, company_id FK, platform_admin_id FK, body text NOT NULL, created_at, updated_at);`

**PB-13 Impersonation mode and end reason (L)**
- Design: `impersonation_logs (reason, started_at, expires_at, ended_at, ip)`.
- App: `platform/types.ts:367-382` `mode read|write`, `endReason ended|expired`; `tenancy/types.ts:221`.
- Proposed (**D**): `ALTER TABLE impersonation_logs ADD mode string(10) NOT NULL DEFAULT 'read', ADD write_enabled_at datetime NULL, ADD end_reason string(20) NULL;`

**PB-14 Sign-up, checkout and contact-sales records (M)**
- Design: no table. A company is created directly.
- App: `data/signups.ts:11-37` `PendingSignup` (code, attempts, locked, verified, consumed, companyId), `:39-56` `CheckoutRecord`, `:58-62` `ContactSalesRequest`.
- Impact: the verify-before-create flow and checkout reuse checks need state on the server.
- Proposed (**D**): `CREATE TABLE signup_requests (id, company_name, slug, country_code, locale, admin_name, admin_email, mobile, password_hash, code_hash string(64), code_expires_at, attempts smallint, locked_at, verified_at, consumed_at, company_id NULL FK, created_at, updated_at);` and `CREATE TABLE sales_inquiries (id, company_name, name, email, country_code, message text NULL, status string(20), created_at, updated_at);`. Checkouts become `platform_payments` with `platform_invoice_id` nullable plus `signup_request_id`.

**PB-15 Onboarding checklist state (L)**
- App: `data/onboarding.ts:5-10` per company `manualDone[]`, `dismissed`.
- Proposed (**D**): store it in `companies.settings` json (`onboarding.manual_done`, `onboarding.dismissed_at`) and document the key.

**PB-16 Billing reminder and warning dedupe keys (L)**
- App: `data/subscriptions.ts:159` `billingSentKeys` ("each goes out once").
- Proposed (**D**): `CREATE TABLE billing_notices_sent (company_id FK, key string(100), sent_at datetime, PRIMARY KEY (company_id, key));`, or reuse `notifications` with a unique `(company_id, type, data->key)`.

##### 2. Identity & org

**ID-1 Membership entity vs users.company_id (M)**
- Design: users.company_id and role_id. The "Open decisions" section says to add `company_user` only for multi-company use.
- App: `tenancy/types.ts:143-157` `Membership {userId, companyId, role, status active|invited|suspended}`; `data/tenancy.ts:109`.
- Impact: two sources of truth for role and status. The `invited` status lives on the membership, while the design uses `user_invitations`.
- Proposed (**A**): drop `Membership` from the contract. Map `invited` to `user_invitations`, `suspended` to `users.is_active=false`, and the role to `users.role_id`. (Or **D**: adopt `company_user` now, per section 23.)

**ID-2 Roles referenced by name, no slug/id (M)**
- Design: `roles (id, company_id, name, slug UNIQUE(company_id, slug), is_system)`; `users.role_id`.
- App: `shared/types/index.ts:3-12,26` `User.role` = role name; `signup/types.ts:152-158` `CompanyRoleDefinition.id = name`.
- Impact: renaming a role would break every user. The app can't support custom roles.
- Proposed (**A**): add `roleId` (`roles.slug` on the wire, e.g. `company_admin`) and keep the name for display only.

**ID-3 Permission scope values differ (M)**
- Design: `role_module_access.access_level` = `full|team|own|view|none`.
- App: `shared/types/index.ts:16` `Scope = full|team|own|view|hidden|marketing|finance|hr`; `shared/lib/permissions.ts:16-18` (reports: `marketing`, `finance`, `hr`).
- Impact: `hidden` and `none` are the same thing spelled differently. The three report-family scopes have no design value.
- Proposed (**D**): extend the notes to `full|team|own|view|none|marketing|finance|hr` (string(10) is wide enough). Map `hidden` to `none`.

**ID-4 Job title on users (M)**
- Design: `users` has no title. `employees.job_title` exists (HR).
- App: `shared/types/index.ts:27` `User.title` is required and shown on owners, targets and the org chart (`leads/types.ts:143`, `targets/types.ts:59`).
- Proposed (**D**): `ALTER TABLE users ADD job_title string(255) NULL;` (copied to `employees.job_title` when HR exists).

**ID-5 2FA and password metadata (M)**
- Design: `users.two_factor_secret` only.
- App: `settings/security/types.ts:3-8` `enabledAt`, `recoveryCodesLeft`; `data/security.ts:30,42`; `account/types.ts:10` `passwordChangedAt`; `data/passwords.ts:26`. Same for `platform_admins`.
- Proposed (**D**): `ALTER TABLE users ADD two_factor_recovery_codes text NULL /*encrypted*/, ADD two_factor_confirmed_at datetime NULL, ADD password_changed_at datetime NULL;` (do the same on `platform_admins`).

**ID-6 Session list with device and location (L)**
- Design: Laravel `sessions` and `personal_access_tokens` are framework tables and not shown.
- App: `settings/security/types.ts:24-34` `device, browser, location, lastActiveAt`; `data/security.ts:89`.
- Proposed (**D**): note that tokens are `personal_access_tokens` plus `ADD ip string(45), user_agent string(255), location string(100) NULL, last_used_at`. Or list `user_sessions` explicitly.

**ID-7 Company security policy and backups (L)**
- App: `settings/security/types.ts:59-65` `requireTwoFactorForAdmins, sessionTimeoutMinutes, passwordMinLength`; `:38-48` `BackupRun` history (`data/security.ts:185,212`).
- Proposed (**D**): store the policy in `companies.settings.security` (document the keys). `CREATE TABLE backup_runs (id, company_id NULL FK, trigger string(20), status string(20), size_mb int NULL, triggered_by bigint NULL FK->users, started_at, finished_at NULL, note string(255) NULL);`

**ID-8 Department goals are records, not text (M)**
- Design: `departments.goals text NULL`.
- App: `departments/types.ts:11-19,28` `DepartmentGoal {title, ownerId, dueDate, status Open|Done, createdAt}`; `docs/API.md:1024` CRUD per goal.
- Proposed (**D**): `CREATE TABLE department_goals (id, company_id FK, department_id FK CASCADE, owner_id bigint NULL FK->users SET NULL, title string(255), due_date date NULL, status string(20) /* open|done */, created_at, updated_at);` Drop `departments.goals`.

##### 3. Company settings & lists

**SL-1 Lists have no stable code (except statuses) (H)**
- Design: `lead_sources`, `industries`, `loss_reasons`, `tags` and `service_categories` have `name` only. `lead_statuses` has a `code`.
- App: `settings/types.ts:14-29` `ListOption.key` is the stable id stored on records. The API contract (`docs/API.md:160-167`) says records hold **keys** (`sourceType`, `industry`, `lossReason`, `category`), and there is a protected key `imported-no-reason`.
- Impact: the mapper can't move keys to FKs without a stable code, and renaming a label must not change the stored value.
- Proposed (**D+A**): `ALTER TABLE lead_sources|industries|loss_reasons|tags|service_categories ADD code string(50) NOT NULL, UNIQUE (company_id, code)`. Or the app switches to ids (FK) on the wire. Pick one. Using the id is simpler.

**SL-2 Protected and hidden list items (M)**
- Design: no flags. `lead_statuses` has is_default/is_active only.
- App: `settings/types.ts:26,28` `system`, `hiddenFromPickers`; `:40` `StatusOption.system` (built-in, can't be removed); `data/lookups.ts:46-55`.
- Proposed (**D**): `ADD is_system bool NOT NULL DEFAULT false, ADD is_hidden bool NOT NULL DEFAULT false` on `lead_statuses, lead_sources, industries, loss_reasons`.

**SL-3 Missing order and active columns on lists (L)**
- Design: `loss_reasons` has no sort_order. `tags` has no is_active or sort_order. `service_categories` has no is_active.
- App: every list has `order` and `active` (`settings/types.ts:18-20`).
- Proposed (**D**): add `sort_order int NOT NULL DEFAULT 0` and `is_active bool NOT NULL DEFAULT true` where missing.

**SL-4 Tags mean two different things (M)**
- Design: `tags` "Free tags (for example the services a lead company offers)" with `taggables` (Lead, Customer, Task, Contact).
- App: `companyServices: string[]` free strings on leads and customers (`shared/types/index.ts:78,159`) hold that meaning. The **Settings tags list** (`data/lookups.ts:83,96` Hot, Government...) is a managed lookup that no record uses (`useLookups.ts:85` `tagLabel` has no caller).
- Impact: free strings can't go through a FK to `tags` unless they are created on the fly. The Settings tags list has no records to attach to.
- Proposed (**D+A**): either add `tags.kind string(20)` (`label|company_service`) and create tags on write for `companyServices`, or add `lead_company_services (lead_id, name)`. The app should decide whether the Settings tags list attaches to leads.

**SL-5 Message template purpose, default and language (M)**
- Design: `message_templates.type` = `followup_email|quotation|whatsapp|campaign_email|other`; language NOT NULL; no default flag.
- App: `settings/templates/types.ts:3` `channel email|quotation|whatsapp`; `:14-22` `purpose` (8 values: First follow-up ... Quotation terms); `:49` `isDefault` (one per channel + purpose); `:52` `updatedBy`. No language.
- Impact: the default-per-purpose picker and the AI lookup "by channel + purpose" can't be stored.
- Proposed (**D+A**): `ALTER TABLE message_templates ADD purpose string(30) NOT NULL, ADD is_default bool NOT NULL DEFAULT false, ADD updated_by bigint NULL FK->users;` Rename `type` to `channel` (`email|quotation|whatsapp|campaign_email|other`). The app sends `language` (default `companies.locale`). Add a partial-unique rule: one default per `(company_id, channel, purpose)` (enforce in the app layer).

**SL-6 Company default activity targets (M)**
- Design: `activity_targets (user_id NOT NULL, month, metric, target_value)`, per agent only.
- App: `targets/types.ts:83-88` `TargetDefaults`; `data/targets.ts:25` company defaults used when an agent has no row for the month.
- Proposed (**D**): `ALTER TABLE activity_targets MODIFY user_id bigint NULL` (NULL = company default), with `UNIQUE (company_id, user_id, month, metric)`. Or store the defaults in `workflow_settings.default_targets json`. Note: MySQL treats NULLs as distinct in UNIQUE, so the json option is safer.

**SL-7 Target metric names and sources (L)**
- Design: metric `... | events_attended`; activity types include `proposal_sent`, `partnership`.
- App: `targets/types.ts:4` `events`; `shared/types/index.ts:103` `ActivityType` has no `proposal_sent` or `partnership`. Proposals are counted from leads in the Proposal stage, and partnerships are not tracked (`services/targets.ts:100-107`).
- Proposed (**A**): rename `events` to `events_attended` on the wire. Add `proposal_sent` and `partnership` to `ActivityType` so the targets can be counted from `activities` as the design intends.

**SL-8 Regional settings without columns (M)**
- Design: `companies.country_code, currency_code, timezone, locale`, plus `settings json`.
- App: `tenancy/types.ts:46-62` also `dateFormat`, `weekStartsOn`, `weekend[]`, `vatPct`.
- Proposed (**D**): document `companies.settings.regional = {date_format, week_starts_on, weekend[]}`. `vatPct` belongs to `tax_rates` (`is_default`), see AC-1.

##### 4. Leads & sales pipeline

**SA-1 No deal value on leads (H)**
- Design: `leads` has no amount or value column.
- App: `shared/types/index.ts:66-67` `Lead.value` ("Estimated deal value"). It drives the pipeline value, weighted forecast, won value, reports and dashboard (`shared/types/index.ts:206-211`, `reports/types.ts:43-49,64`), and `Customer.wonValue` (`:152`).
- Impact: the main sales KPIs can't be computed from the design.
- Proposed (**D**): `ALTER TABLE leads ADD expected_value decimal(14,2) NULL, ADD currency_code string(3) NOT NULL;`

**SA-2 Services of interest (N:M) have no table (H)**
- Design: only `leads.recommended_service_id`.
- App: `shared/types/index.ts:80` `Lead.serviceIds[]` (catalog services of interest). Used by the Won-flow defaults (`won/types.ts:11`), service usage (`services/types.ts:36-37`) and reports.
- Proposed (**D**): `CREATE TABLE lead_service (company_id FK, lead_id FK CASCADE, service_id FK RESTRICT, PRIMARY KEY (lead_id, service_id));`

**SA-3 Next step text has no column (H)**
- Design: no `next_step` column on leads (only the status flag, which is excluded here).
- App: `shared/types/index.ts:71-72` `nextStep` is required on Interested and Meeting; shown in overdue reports (`reports/types.ts:193`).
- Proposed (**D**): `ALTER TABLE leads ADD next_step string(500) NULL;` Skip this if the status-flag workstream already adds it.

**SA-4 Loss reason is "key + free details" (M)**
- Design: `leads.loss_reason_id` FK only.
- App: `shared/types/index.ts:73-74` `lossReason` string. `docs/API.md:191` says the value is a loss-reason key "optionally followed by ` — details`".
- Impact: the details are lost when mapped to a FK.
- Proposed (**D+A**): `ALTER TABLE leads ADD loss_details string(500) NULL;` The app splits the value into `lossReasonId` and `lossDetails`.

**SA-5 Industry stored as two keys vs one FK to the leaf (M)**
- Design: `leads.industry_id` (can point to a sub-industry); `industries.parent_id` tree.
- App: `shared/types/index.ts:57-58` `industry` and `subIndustry` keys. Same on `Customer` (`:139-140`). Reports group by both (`reports/types.ts:90-101`).
- Proposed (**A**): send `industryId` (the leaf). The server derives the parent. Keep `industry` and `subIndustry` as read-only expansions.

**SA-6 Primary contact denormalized on the lead (M)**
- Design: `contacts.is_primary`; `leads.email/phone` are company-level duplicate-check fields.
- App: `shared/types/index.ts:53-56` `contactName, contactEmail, mobile` on `Lead`, kept in sync with the "first contact" (`leads/types.ts:91,131`); `Contact` has no `isPrimary` (`:92-100`).
- Impact: the meaning drifts. `leads.email` is a company inbox in the design but the contact's email in the app.
- Proposed (**A**): add `Contact.isPrimary`. Derive `contactName/contactEmail/mobile` from the primary contact. Write `leads.email/phone` only from explicit company fields.

**SA-7 Duplicate rule vs unique indexes (H)**
- Design: `leads UNIQUE (company_id, domain)`, `UNIQUE (company_id, email)` (soft-deleted rows still count, section 22).
- App: duplicates by name, domain or email answer 409, but **managers can force-create** (`services/leads.ts:653,689,776`; `leads/types.ts:69-70,106-107,135-136`). The import also has decisions (`leads/types.ts:195-205`).
- Impact: a forced duplicate would fail on insert with an SQL constraint error.
- Proposed (**D**): drop the two UNIQUE indexes and use non-unique `INDEX (company_id, domain)` and `INDEX (company_id, email)`. Duplicates become a business rule with a manager override. (Or **A**: remove `force`.)

**SA-8 Stage-entered time (M)**
- Design: derivable from `lead_status_history`. No column.
- App: `shared/types/index.ts:63-64` `stageChangedAt` drives days-in-stage, the No-response attempt window and `reopenEligible` (`docs/API.md:194`).
- Proposed (**D**): `ALTER TABLE leads ADD status_changed_at datetime NOT NULL;` (cached, like `last_activity_at`).

**SA-9 Legacy recommended-service text (L)**
- Design: `recommended_service_id` only.
- App: `shared/types/index.ts:83-87` `recommendedServiceText`; `leads/types.ts:178`.
- Proposed (**D**): `ALTER TABLE leads ADD recommended_service_text string(255) NULL;` (migration only; can be dropped later.)

**SA-10 Lead source as key vs FK; source on customer (L)**
- Design: `leads.source_id` FK SET NULL; customers have no source.
- App: `shared/types/index.ts:59` `sourceType` key; `:155` `Customer.sourceType`.
- Proposed (**A**): send `sourceId`. On customers, read the source through `leads.customer_id` instead of a copy.

**SA-11 Activities lack the direction, outcome and duration the design captures (L)**
- Design: `activities.direction, outcome, duration_minutes, counts_for_target, meta`.
- App: `shared/types/index.ts:105-112` `{type, summary, userId, at}` only.
- Proposed (**A**, later): optional fields in `POST /leads/:id/activities`. Default `counts_for_target = type != 'system'`.

**SA-12 Excel imports aren't recorded (L)**
- Design: `lead_imports` and `leads.lead_import_id` (allows undo).
- App: `leads/types.ts:200-227`. The import returns `ImportResult` only. No run is stored and there is no `leadImportId` on leads.
- Proposed (**A**): persist the run (`lead_imports`) and stamp `leadImportId`.

**SA-13 Lead website stored outside the lead (L)**
- Design: `leads.website`, `leads.domain`.
- App: `leads/types.ts:13-14` `website?` only on the detail view; `services/leads.ts:347` `leadWebsites` side map. There is no `domain` field.
- Proposed (**A**): add `website` and `domain` to `Lead`. The server normalizes `domain` (used by SA-7).

**SA-14 Leftover LeadTask type (L)**
- Design: one `tasks` table.
- App: `shared/types/index.ts:122-133` `LeadTask` with its own `TaskStatus` and `Priority`; `db.ts:685-726` seed converted into unified tasks.
- Proposed (**A**): delete `LeadTask` and its enums once the conversion is done, so the contract has a single task shape.

##### 5. CRM: customers & contacts

**CRM-1 Customer contacts, notes and activities hang off the lead (H)**
- Design: `contacts.customer_id`; `notes` and `activities` are polymorphic (`Lead|Customer`).
- App: `Contact.leadId` only (`shared/types/index.ts:94`); `Activity.leadId` (`:107`); `Note.leadId` (`:116`). Customer contacts are written to `customer.leadId` (`services/crm.ts:279-286`), customer history reads `customer.leadId` (`crm.ts:156-186`), and the Won flow logs on `customer.leadId` (`services/won.ts:507-508`).
- Impact: a customer linked to several won leads (`won.ts:251`, link mode) shows only one lead's history. Contacts never get `customer_id`.
- Proposed (**A**): `Contact {leadId|null, customerId|null}`, `Activity/Note {subjectType: 'lead'|'customer', subjectId}`. The Won flow sets `contacts.customer_id`.

**CRM-2 customer.leadId is one-to-one (M)**
- Design: the relation is `leads.customer_id` (N leads to 1 customer). Customers have no lead_id.
- App: `shared/types/index.ts:141-142` `Customer.leadId`; `crm/types.ts:69-70` `CustomerDetail.lead` (single).
- Proposed (**A**): replace it with `leads: CustomerLeadSummary[]`. Or **D**: `ALTER TABLE customers ADD origin_lead_id bigint NULL FK->leads` if "the lead it came from" must be kept.

**CRM-3 Address model: emirate vs city/country (M)**
- Design: `customers.address_line, city, country_code`.
- App: `shared/types/index.ts:146-149` `address`, `emirate` (a fixed UAE enum, '' for KSA tenants: `db.ts:481`).
- Impact: a hard-coded UAE enum in a multi-country product.
- Proposed (**D+A**): `ALTER TABLE customers ADD region string(100) NULL;` (emirate/province). The app drops the enum and sends `city`, `region` and `countryCode`.

**CRM-4 Values copied onto the customer (M)**
- Design: customers have no won value, source or services.
- App: `shared/types/index.ts:150-159` `wonValue`, `sourceType`, `serviceIds[]`, `companyServices[]`.
- Impact: copies drift from the lead and contracts.
- Proposed (**A**): derive `wonValue` from the lead's value (SA-1), `serviceIds` from `contract_items` and projects, `companyServices` from `taggables` (Customer). Or **D**: add `customers.won_value decimal(14,2) NULL` if a snapshot is wanted.

**CRM-5 Customer fields the app lacks (L)**
- Design: `customers.email, phone, customer_since`.
- App: `shared/types/index.ts:136-160` has none. `createdAt` doubles as "since".
- Proposed (**A**): add `email`, `phone` and `customerSince` (default the won date).

**CRM-6 Owner vs account manager (L, semantic)**
- Design: `customers.account_manager_id`.
- App: `Customer.ownerId` (`shared/types/index.ts:143`) copied from the lead owner (the sales agent).
- Proposed (**A**): rename to `accountManagerId` and decide whether it defaults to the sales owner or the project manager.

**CRM-7 Contacts are hard-replaced, not soft-deleted (M)**
- Design: `contacts.deleted_at` (history matters).
- App: `PATCH /leads/:id` "Replaces the lead's contacts" (`leads/types.ts:131-132`, `docs/API.md:190`). Rows without an id are recreated.
- Impact: replacing all contacts loses their ids, and future references (support_tickets.contact_id, messages) break.
- Proposed (**A**): diff by id. Missing ids are soft-deleted, not recreated.

##### 6. Quotations & contracts

**QC-1 Contract value per billing cycle vs total + items (H)**
- Design: `contracts.total_value`, `currency_code`; lines in `contract_items (service_id, quantity, unit_price, billing_period one_time|monthly|yearly, line_total)`.
- App: `crm/types.ts:9,16-28` `value` = amount **per cycle**, one `billing One-off|Monthly|Annual` per contract, `serviceIds[]`, no currency (Crest is SAR: `data/contracts.ts:38`); MRR/annual derived (`crm/types.ts:36-39`).
- Impact: storing the per-cycle amount in `total_value` is wrong. Services have no lines. Non-AED contracts show the wrong currency.
- Proposed (**D+A**): `ALTER TABLE contracts ADD billing_period string(20) NOT NULL /* one_time|monthly|yearly */, ADD recurring_amount decimal(14,2) NULL;` The app writes `contract_items` per service and sends `currencyCode`.

**QC-2 Contract identity fields missing in the app (M)**
- Design: `contract_number` (UNIQUE per company), `quotation_id`, `end_date`, `signed_at`, `renewal_alerted_at`, `file_path`, `created_by`.
- App: `crm/types.ts:16-28` has none of these. `ownerId` stands where the design has `created_by` (no owner column).
- Proposed (**D+A**): `ALTER TABLE contracts ADD owner_id bigint NULL FK->users SET NULL;` The app adds `contractNumber`, `quotationId` and `endDate`. `renewalDate` becomes nullable (the design has `renewal_date` NULL).

**QC-3 VAT per quotation vs tax per line (M)**
- Design: `quotation_items.tax_rate_id`, `tax_percent decimal(5,2)` snapshot; `quotations.tax_total`.
- App: `quotations/types.ts:54` `vatPct` on the quotation; lines have no tax.
- Proposed (**A**): write `tax_percent = vatPct` on every line (and `tax_rate_id` = the company default). Or **D**: `ALTER TABLE quotations ADD tax_percent decimal(5,2) NOT NULL` as the header default.

**QC-4 Client snapshot on quotations (M)**
- Design: no client columns; client comes from `lead_id` or `customer_id`.
- App: `quotations/types.ts:45-48` `company, contactName, contactEmail` copied at create time. Sending uses `contactEmail` (`services/quotations.ts:300`).
- Impact: later lead edits would change sent quotations. The PDF needs the snapshot.
- Proposed (**D**): `ALTER TABLE quotations ADD contact_id bigint NULL FK->contacts, ADD client_name string(255) NOT NULL, ADD client_email string(190) NULL;`

**QC-5 Quotation numbers come from one global sequence (M)**
- Design: `UNIQUE (company_id, number)`. Numbers are per company.
- App: `services/quotations.ts:105-117` "One global sequence for every company".
- Impact: one tenant can infer how many quotations other tenants issue.
- Proposed (**A**): sequence per company and year (`QT-2026-0001` in each company).

**QC-6 Line unit, line currency and package grouping (L)**
- Design: `quotation_items (service_id, service_package_id, quantity, unit_price, discount_percent, sort_order)`. No unit or currency.
- App: `quotations/types.ts:13` `unit project|month|hour`; `:22` line `currency`; `:24-26` `groupId`, `groupLabel` (one package instance).
- Proposed (**D**): `ALTER TABLE quotation_items ADD unit string(20) NOT NULL DEFAULT 'project', ADD package_group string(36) NULL, ADD package_label string(255) NULL;` Drop the line currency (informational only).

**QC-7 Rejected/decided timestamp (L)**
- Design: `sent_at`, `accepted_at`. No rejected time.
- App: `quotations/types.ts:66-67` `decidedAt` (Accepted **or** Rejected).
- Proposed (**D**): `ALTER TABLE quotations ADD rejected_at datetime NULL;` The app splits `decidedAt`.

**QC-8 Design precision slip on the discount percent (L, design)**
- Design: `quotation_items.discount_percent decimal(14,2)`. The conventions say rates are `decimal(5,2)`.
- App: `quotations/types.ts:16-17` `discountPct` 0-100.
- Proposed (**D**): `MODIFY discount_percent decimal(5,2) NOT NULL DEFAULT 0`.

**QC-9 Quotation template and PDF (L)**
- Design: `quotations.message_template_id`, `pdf_path`.
- App: neither field is in `QuotationRecord` (`quotations/types.ts:39-68`). The cover and terms text are copied in.
- Proposed (**A**): send `messageTemplateId` when a template was used. `pdfPath` comes later.

##### 7. Services & catalog

**SV-1 Project template header and task fields (M)**
- Design: `project_templates (service_id UNIQUE, name NOT NULL, default_duration_days)`; `project_template_tasks (title, description, day_offset, default_priority NOT NULL, estimated_hours, sort_order)`.
- App: `services/types.ts:86-92` no `name` or duration (computed by `templateTotals`, `:142-146`), plus `updatedBy`; `TemplateTask` (`:75-83`) has no `description` or `priority`.
- Proposed (**D+A**): `ALTER TABLE project_templates MODIFY name string(255) NULL, ADD updated_by bigint NULL FK->users;` The app sends `defaultPriority` (default `medium`) and an optional `description` per task.

**SV-2 Working-day offset vs calendar-day offset (M, semantic)**
- Design: `project_template_tasks.day_offset` "days after project start"; `tasks` has no offset.
- App: `services/types.ts:79-80` **working-day** offset; `tasks/types.ts:88-89` `Task.dayOffset`, `:86-87` `templateTaskId`.
- Impact: due dates move when the weekend differs (UAE Sat-Sun vs KSA Fri-Sat).
- Proposed (**D**): note the meaning as working days per `companies.settings.regional.weekend`. `ALTER TABLE tasks ADD project_template_task_id bigint NULL FK SET NULL, ADD day_offset smallint NULL;`

**SV-3 Category and industries as keys (L)**
- Design: `services.category_id` FK; `service_industry` pivot.
- App: `services/types.ts:14,17` `category` key, `industries[]` keys.
- Proposed (**A**): send `categoryId` and `industryIds[]` (same fix as SL-1).

**SV-4 Package naming and soft delete (L)**
- Design: `service_packages.price`; no `deleted_at` (only `is_active`).
- App: `services/types.ts:121` `packagePrice`. Packages are deactivated, never deleted.
- Proposed: none needed. Only the mapper changes `packagePrice` to `price`, since the meaning is the same.

##### 8. Projects & tasks

**PT-1 Task history has no table (M)**
- Design: no task activity table. `audit_logs` morph list = Lead, Customer, User, Invoice, Contract, Employee.
- App: `tasks/types.ts:48-68,92` `history: TaskEvent[]` (created, status, owner, due, priority, edited, comment, attachment, follower, hours, link); `services/tasks.ts:145`.
- Proposed (**D**): add `Task` and `Project` to the `audit_logs` morph map, and add `audit_logs.summary` (see NA-1). Or `CREATE TABLE task_events (id, company_id, task_id FK CASCADE, user_id FK, kind string(20), summary string(255), created_at);`

**PT-2 Comment mentions (M)**
- Design: `comments (commentable, body)`.
- App: `tasks/types.ts:43-44` `mentions: string[]` drives the `mention` notifications (`:206`).
- Proposed (**D**): `CREATE TABLE comment_mentions (company_id, comment_id FK CASCADE, user_id FK, PRIMARY KEY (comment_id, user_id));`

**PT-3 Project provenance (M)**
- Design: `projects (customer_id, service_id, quotation_id, contract_id, project_template_id, manager_id)`. No lead, creator or origin.
- App: `tasks/types.ts:156-157` `leadId`, `:167` `createdBy`, `:168` `createdFrom won|manual`.
- Proposed (**D**): `ALTER TABLE projects ADD lead_id bigint NULL FK->leads SET NULL, ADD created_by bigint NULL FK->users, ADD origin string(20) NOT NULL DEFAULT 'manual' /* won|manual */;`

**PT-4 Project fields the app lacks (L)**
- Design: `contract_id`, `project_template_id`, `actual_hours` (cached).
- App: `tasks/types.ts:151-169` has none of them (logged hours only on `ProjectRow`, `:180`). `serviceId` and `endDate` are required in the app, but nullable in the design.
- Proposed (**A**): add `contractId` and `projectTemplateId` from the Won flow. Allow `serviceId` and `endDate` to be null.

**PT-5 Cached logged hours on tasks (L)**
- Design: only `projects.actual_hours` is cached.
- App: `tasks/types.ts:85` `Task.loggedHours`; `TaskUpdateInput.loggedHours` (`:129`) is writable directly.
- Proposed (**A**): derive it from `time_entries` (read-only). Or **D**: `ALTER TABLE tasks ADD actual_hours decimal(14,2) NULL /* cached */`.

**PT-6 Won-flow idempotency (L)**
- Design: none.
- App: `won/types.ts:17-18` `idempotencyKey`; `services/won.ts:66` used-keys set.
- Proposed (**D**): `CREATE TABLE idempotency_keys (company_id FK, key string(64), user_id FK, response json NULL, created_at, PRIMARY KEY (company_id, key));` Or use cache with a TTL (and document it).

##### 9. Notifications, activities & audit

**NA-1 Audit log shape (H)**
- Design: `audit_logs (user_id FK NULL, auditable_type/id morph [Lead, Customer, User, Invoice, Contract, Employee], event created|updated|deleted|restored|login|export, old_values, new_values, ip, user_agent)`. **No `created_at` column**, but `INDEX (company_id, created_at)` exists.
- App: `settings/types.ts:91` `action create|update|delete|deactivate|reactivate|security`; `:100-111` `entity` free strings (`user`, `lookup:statuses`, `automation`, `template`, `security`, project...), `summary`, `changes[{field,from,to}]`; actors `system` and `platform:p2` (`data/audit.ts:88-136`); support-session marking (`:59-78`).
- Impact: the design's audit table can't index by time. Settings entities (lookups, automation, templates, security) and system or platform actors have no type. The summary text would be lost.
- Proposed (**D**):
  ```sql
  ALTER TABLE audit_logs ADD created_at timestamp NOT NULL, ADD summary string(500) NULL,
    ADD actor_type string(20) NOT NULL DEFAULT 'user' /* user|system|platform */,
    ADD platform_admin_id bigint NULL FK->platform_admins, ADD impersonation_log_id bigint NULL FK;
  -- event += deactivated|reactivated|security; morph map += Task, Project, Quotation, LeadStatus,
  --   LeadSource, Industry, LossReason, Tag, WorkflowSetting, MessageTemplate, Company, Department, Service
  ```
  App (**A**): map `changes[]` to `old_values` and `new_values`.

**NA-2 Notification type values (L)**
- Design: Laravel `notifications (type = class name, data json, read_at)`.
- App: `tasks/types.ts:202-212` `type won|assignment|mention|task-overdue|task-due|billing|usage`, `title/body/link`, `read` boolean.
- Proposed (**A**): put `{kind, title, body, link}` in `data`. `read` is `read_at != null`. Keep the `kind` values in the API.

**NA-3 Computed reminders are not stored (L)**
- Design: the `notifications` table description includes "follow-up due, overdue task, renewal, document expiry" as stored rows.
- App: `alerts/types.ts:1-4,21-39` computes `no-contact`, `stalled`, `follow-up`, `renewal` and `task` on each read. Only some types are stored and can be marked read.
- Proposed (**A** or **D**): either the scheduler writes them as notifications (then they can be marked read), or the design note says they are computed. Decide which.

**NA-4 Platform audit fields (L)**
- Design: `platform_audit_logs (action, subject morph, properties json, ip)`.
- App: `platform/types.ts:292-307` `actorRole`, `summary`, `before`, `after`, `reason`.
- Proposed (**D**): `ALTER TABLE platform_audit_logs ADD reason text NULL, ADD summary string(500) NULL;` Keep `before` and `after` in `properties`.

##### 10. Reports

**RP-1 Report schedules need a saved report the app doesn't have (M)**
- Design: `report_schedules.saved_report_id NOT NULL`, `frequency daily|weekly|monthly`, `run_at time`, `day_of_week`, `day_of_month`, `format xlsx|pdf`, `is_active`, `last_run_at`.
- App: `reports/types.ts:267-285` `report` = built-in id or `all` (no saved report), `day` (one field), `format excel|pdf`, no `isActive`.
- Proposed (**D+A**): `ALTER TABLE report_schedules MODIFY saved_report_id bigint NULL, ADD report_type string(50) NULL /* built-in report id or 'all' */;` The app maps `excel` to `xlsx`, splits `day` into `dayOfWeek` or `dayOfMonth`, and adds `isActive`.

##### 11. Files

**FI-1 Branding assets have no columns (M)**
- Design: `companies.logo_path`, `brand_color`.
- App: `tenancy/types.ts:21-44` `logoDarkUrl`, `faviconUrl`, `monogram`, `displayName`, `palette`, `emailSenderName`, `emailSenderAddress`. Logos are data URLs in the mock (`:25-27`).
- Proposed (**D**): `ALTER TABLE companies ADD logo_dark_path string(255) NULL, ADD favicon_path string(255) NULL, ADD display_name string(255) NULL, ADD monogram string(3) NULL, ADD email_sender_name string(255) NULL, ADD email_sender_address string(190) NULL;` The palette is derived from `brand_color` and isn't stored.

**FI-2 Task attachments carry no storage reference (L)**
- Design: `attachments.disk`, `path` NOT NULL.
- App: `tasks/types.ts:28-37` name, size, type and uploader only. The mock never stores the file.
- Proposed (**A**): add `url` (signed download) to the response. Upload uses multipart, and the server owns `disk` and `path`.

**FI-3 Contract and quotation documents (L)**
- Design: `contracts.file_path`, `quotations.pdf_path`.
- App: neither exists (`crm/types.ts:16-28`, `quotations/types.ts:39-68`).
- Proposed (**A**, later): expose a `fileUrl` or `pdfUrl` once upload or PDF rendering exists.

##### 12. Company profile, accounting, integrations & later modules

**AC-1 Default VAT on regional settings vs tax_rates (M)**
- Design: `tax_rates (name, rate decimal(5,2), is_default, is_active)`.
- App: `tenancy/types.ts:60-61` `regional.vatPct` (`data/tenancy.ts:40`), used as the quotation default (`quotations/types.ts:53-54`).
- Proposed (**A**): read and write the company default rate as `tax_rates WHERE is_default`. The settings screen edits that row.

**AC-2 Company legal profile has no columns (H)**
- Design: `companies` has name, slug and regional fields only. `bank_accounts` is in Accounting (a later phase).
- App: `tenancy/types.ts:110-131` `legalName, tradeName, address{line1,line2,city,region,country}, location{lat,lng}, taxNumber, commercialLicenseNo, phone, email, website, bank{bankName,accountName,iban,swift}`. Printed on every quotation.
- Impact: quotation letterheads can't be produced from the design.
- Proposed (**D**): `ALTER TABLE companies ADD legal_name string(255) NULL, ADD trade_name string(255) NULL, ADD address_line1 string(255) NULL, ADD address_line2 string(255) NULL, ADD city string(100) NULL, ADD region string(100) NULL, ADD latitude decimal(9,6) NULL, ADD longitude decimal(9,6) NULL, ADD tax_number string(50) NULL, ADD commercial_license_no string(50) NULL, ADD phone string(30) NULL, ADD email string(190) NULL, ADD website string(255) NULL;` The bank goes to `bank_accounts` with `is_default` (IBAN encrypted, per section 22). `bank_accounts` must then exist before Accounting ships.

**IN-1 Email connection vs integrations provider values (L)**
- Design: `integrations.provider gmail|outlook|smtp|...`, `connected_by`, `credentials` encrypted, `UNIQUE (company_id, provider, label)`.
- App: `signup/types.ts:160-168` `EmailProvider google|microsoft|smtp`, `address`; `data/onboarding.ts:13` one per company.
- Proposed (**A**): map `google` to `gmail` and `microsoft` to `outlook`. `address` goes to `label`.

**IN-2 Sent messages are stored only as activities (M)**
- Design: `messages (activity_id, channel, direction, from/to, subject, body longtext, status, external_id)`.
- App: `services/messages.ts:19-25`. Email and WhatsApp sends become an activity with a summary only. Subject, body and recipient are not kept.
- Proposed (**A**): write a `messages` row linked to the activity (status `sent` in the mock), and return it on the activity view.

**EV-1 Lead attribution to campaigns and events (L, later)**
- Design: `leads.campaign_id`, `leads.event_id`; `event_attendees.lead_id`.
- App: the source key `Event` or `Trade Show` plus a free-text `sourceDetail` (`db.ts:224-231`). No `campaignId` or `eventId`.
- Proposed (**A**, when the Events and Marketing modules exist): add the optional `campaignId` and `eventId` to the lead contract. Keep `sourceDetail` for legacy rows.

**HR-1 People data split between users and employees (L, later)**
- Design: `employees (user_id unique, job_title, department_id, manager_id -> employees)`.
- App: org data on `users` (`title`, `departmentId`, `managerId`, `shared/types/index.ts:27-31`).
- Proposed (**D**): document that `users.manager_id` and `users.department_id` stay the source for sales and org screens, and that employees mirror them (or HR owns them once enabled). Decide this before HR is built.

---

#### Summary

| Domain | # gaps | Severity (H / M / L) | Overall |
|---|---|---|---|
| Platform & billing | 16 | 2 / 10 / 4 | **High** |
| Identity & org | 8 | 0 / 6 / 2 | Med |
| Company settings & lists | 8 | 1 / 5 / 2 | **High** |
| Leads & sales pipeline | 14 | 4 / 4 / 6 | **High** |
| CRM: customers & contacts | 7 | 1 / 4 / 2 | **High** |
| Quotations & contracts | 9 | 1 / 4 / 4 | **High** |
| Services & catalog | 4 | 0 / 2 / 2 | Med |
| Projects & tasks | 6 | 0 / 3 / 3 | Med |
| Notifications, activities & audit | 4 | 1 / 0 / 3 | **High** |
| Reports | 1 | 0 / 1 / 0 | Med |
| Files | 3 | 0 / 1 / 2 | Low |
| Company profile, accounting, integrations, events, HR | 6 | 1 / 2 / 3 | Med |
| **Total** | **86** | **11 / 42 / 33** | |

**Already aligned, no action needed:** global unique `users.email` (`data/identity.ts:3-18` matches the design's v1 note); per-company uniqueness of list labels (`data/lookups.ts:105`); deactivate-never-delete for users, services, templates and departments; `company_id` on every tenant store (`Tenant<T>`). One exception: `AgentTarget` (`data/targets.ts:36-40`) has no `companyId` and relies on global user ids. Add `company_id` when it is mapped to `activity_targets`.

### Events

Found while building the Events module (`events`, `event_team`, `event_attendees`, `leads.event_id`; API in
`docs/API.md` › Events). The mock follows the design's columns where they exist; these are the differences.

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| E1 | `events.status` | `planned · ongoing · completed · cancelled` | `planned · confirmed · completed · cancelled` (the product spec's flow: confirmed = booked / registration running; "ongoing" is derived from the dates) | Replace `ongoing` with `confirmed` in the enum, or add `confirmed` |
| E2 | `events.online_url` | — | webinar / hybrid link | Add `online_url string(500) null` |
| E3 | `events.currency` | — (budget has no currency) | the company's currency (`companies` regional settings) | None if budgets are always in the company currency; otherwise add `currency char(3)` |
| E4 | `events.registration_open`, `events.registration_token` | — | public registration page `/e/:token` (open / closed flag + unguessable token, unique) | Add `registration_open bool default false`, `registration_token string(40) unique` |
| E5 | `events` all-day flag | `starts_at datetime` only | `allDay` (dates without times), stored as local midnight | Add `all_day bool` or keep dates in `date` columns for all-day events |
| E6 | `events.created_by` | — | who created it (history, "Created by") | Add `created_by → users.id` (other tables have it) |
| E7 | `events.deleted_at` | — | DELETE cancels (status `cancelled`) and keeps attendees and leads | Status is enough; add `deleted_at` (SoftDeletes) only if a hard delete is wanted |
| E8 | `event_attendees.attended` | `bool` | `checked_in_at datetime null` (when, for the check-in desk and "events attended") | Replace `attended` with `checked_in_at` (attended = not null) |
| E9 | `event_attendees.title` | — | job title (goes to the lead's contact) | Add `title string(120) null` |
| E10 | `event_attendees.source`, `source_detail` | — | `manual · import · public` + detail (who added it / file name) | Add both, or log them in `audit_logs` |
| E11 | `event_attendees.lead_outcome` | — (only `lead_id`) | `created · linked · none`: separates new leads from existing leads linked by email (stats "leads created" vs "leads linked", cost per lead) and attendees saved without a lead at the plan limit | Add `lead_outcome string(10)`; `leads.event_id` alone can't tell a linked lead (it keeps its first event) |
| E12 | `event_attendees.created_by` | — | the team member who registered the person (null for the public page) | Add `created_by → users.id null` |
| E13 | `event_attendees` uniqueness | `INDEX (company_id, event_id)` | one registration per email per event (`409 already_registered`) | Add `UNIQUE (event_id, email)` (nullable email allowed) |
| E14 | event history | — | `history[]` on the event (field changes, team, registrations, check-ins, imports) | Use `audit_logs` with `auditable_type = Event` (no new table) |
| E15 | public registration rate limit | — | per client / email per event, 10-minute window (in memory) | Laravel `RateLimiter` (cache), no table |
| E16 | `leads.event_id` for linked leads | one `event_id` per lead | a lead created at an event stores it; an existing lead linked by email keeps its own (first) `event_id` — the event's link is `event_attendees.lead_id` | Document "first-touch" attribution, or add an `event_leads` pivot for multi-touch |
| E17 | "Events attended" target | `activity_targets` has `events_attended` | counted per team member (owner + `event_team`) per month of `starts_at` (company time) when the event is `completed`, or started with ≥ 1 checked-in attendee | No column needed; document the rule next to `activity_targets` |
| E18 | `lead_sources` "Event" | the spec's source list has Event | registrations need an active source with key / name "Event"; a company without one gets `422 event_source_missing` (no silent creation) | Seed an `is_system` "Event" source for every company (like the protected loss reason) |

### Marketing

Tables `campaigns`, `campaign_costs`, `bulk_emails`, `bulk_email_recipients` and `leads.campaign_id` (design §13).
Wire mapping (`src/shared/api/marketingMappers.ts`): campaign `currency → currency_code`, `startDate → starts_on`,
`endDate → ends_on`; cost `date → incurred_on`, `note → description`; bulk email `templateId → message_template_id`,
`audience → filters`; everything else mechanical. Gaps:

- `campaigns.target_leads` (optional numeric goal) and `campaigns.source_detail` (UTM / source detail) have no design
  column (the design has `goal text` only).
- `campaigns.created_by` isn't stored; the creator becomes the default `owner_id`.
- `bulk_emails.message_template_id` is NOT NULL in the design; the app allows a custom email written in the builder
  (null template). `bulk_emails.body` has no design column (the design renders from the template only), so a custom or
  edited body needs a `body text` column.
- `bulk_emails.filters` json holds `industries, statuses, sources, owner_ids`; tags (`taggables`) aren't offered yet.
- `bulk_emails.started_at` has no design column; `recipients_count` is derived from the recipients here.
- `bulk_email_recipients.status` adds `skipped` (design: `queued | sent | failed | bounced`) and needs a `skip_reason`
  column (`dnc | not_interested | no_email | duplicate | limit | removed | cancelled`); bounces aren't simulated.
- `bulk_email_recipients.open_count` isn't kept (a single `opened_at`); `contact_id` is stored null: one recipient per
  lead, the lead's email column.
- The queue position (`queued_at`, order) is mock-only state for the fair queue; a real backend keeps it in the job queue.
- `campaign_costs.expense_id` (Accounting, Phase 3) isn't used.
