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

#### Advanced events features (new tables)

Templates, agenda, tickets / waitlist, check-in, booth capture, survey and budget (`docs/API.md` › Events ›
Templates … Budget & ROI). None of these tables is in the design; every row carries `company_id` (tenant key)
and, except templates, `event_id → events.id` (cascade).

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| E19 | `event_templates` + `event_template_tasks` | — | `event_templates (id, company_id, name, event_type, default_duration_days, created_by, timestamps)`; tasks inline: `(id, title, offset_days ±, role 'owner' or a roles.name, priority)` | Two tables; `event_template_tasks.offset_days int` (negative = before the start), `role string(40)` |
| E20 | `tasks.template_task_id` for events | `project_template_task_id` only | checklist tasks carry the event template task id (idempotent re-apply: one task per template task per event); follow-up tasks use `event-follow-up:<event id>` | Add a polymorphic `source_type / source_id` on tasks (or `event_template_task_id`) |
| E21 | `event_sessions` | — | `(id, event_id, title, starts_at, ends_at UTC, room string(120), description, speaker_ids)`; same-room overlap refused (409) | Table + `event_session_speakers` pivot; index `(event_id, room, starts_at)` |
| E22 | `event_speakers` | — | now the event's roster `(id, event_id, speaker_id)` → the speaker directory (see L1; before: a copy of the person per event, migrated) | Pivot `event_speakers (event_id, speaker_id) UNIQUE`; was: Table (per event; a company-wide speaker directory is a later step) |
| E23 | `event_ticket_types` | — | `(id, event_id, name, capacity null = unlimited, price decimal(12,2), sales_open date, sales_close date, sort_order)`; price in the company currency, no payment | Table; payments / orders are a separate (later) design |
| E24 | `events.capacity`, `events.questions`, `events.reminder_hours`, `events.follow_up_days`, `events.campaign_id`, `events.follow_up_tasks_at` | — | overall seats (null = unlimited); custom registration questions (JSON: id, label, type text/single/multi, options, required); reminder N h before (default from Settings › Automation `eventReminderHours`); follow-up tasks N days after completion (`eventFollowUpDays`); linked campaign; once-only marker | Columns on `events`; `questions` as JSON or an `event_questions` table |
| E25 | `event_attendees.status`, `ticket_type_id`, `answers`, `waitlisted_at`, `cancelled_at`, `ticket_code`, `survey_token`, `checked_in_by`, `reminder_sent_at` | — | `registered · waitlisted · cancelled` (waitlist position = order of `waitlisted_at`); answers JSON keyed by question id; unguessable `ticket_code` (12 chars, unique, ≠ registration token) and `survey_token` (24 letters, unique); reminder once-only marker | Columns on `event_attendees`; `UNIQUE (ticket_code)`, `UNIQUE (survey_token)` |
| E26 | `event_emails` | — | transactional email log (confirmation, waitlisted, promoted, reminder; sent / skipped with reason `no_email` · `limit`), counted against `emailsPerMonth` | Table, or reuse a generic `email_logs` |
| E27 | `event_captures` | — | `(id, event_id, attendee_id, lead_id, rating hot/warm/cold, notes, card_photo_url, captured_by, captured_at)`; leads have no tags column, so the rating lives here (plus a `meeting` activity on the lead) | Table; or add `lead_tags` if tags become a feature |
| E28 | `event_survey_responses` | — | `(id, event_id, attendee_id UNIQUE, rating 1–5, nps 0–10, comment, submitted_at)` | Table with `UNIQUE (attendee_id)` |
| E29 | `event_budget_lines` | — | `(id, event_id, category venue/travel/printing/sponsorship/catering/marketing/other, note, planned, actual)`; the lines' actual total replaces `events.actual_cost` in stats when lines exist | Table; `events.actual_cost` becomes derived (or kept as a manual fallback) |
| E30 | `event_cost_links` | — | `(event_id, line_id, campaign_id, cost_id → campaign_costs.id)`: one posted cost per line and campaign (idempotent, like ad cost links); unlinking keeps posted costs | Table, or `campaign_costs.source_type / source_id` |
| E31 | `bulk_emails.event_id` | — | a bulk email linked to an event fills the `{{event.*}}` variables (registration_url, survey_url…) | Add `event_id → events.id null` |
| E32 | `audiences.rules.event_presence` | — | `any · attended · no_show` with `event_ids` (attended = checked in; no-show = seat, never checked in) | Part of the rules JSON; no column |
| E33 | `automation_rules.event_reminder_hours`, `event_follow_up_days` | — | company defaults for new events (0–336 h; 0–60 days) | Two columns / keys in the automation settings |

#### Cross-event sections (Attendees, Booth leads, Event analytics)

`docs/API.md` › Events › Cross-event sections. Read models over the event tables; one new table. Item ids `EA*` so they
don't collide with other Events subsections.

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| EA1 | person (attendee directory) | — (attendees are per event; no people / contact link) | de-duplicated on read: email (case-insensitive), else `lead_id`, else the registration; opaque key = first registration id | Keep it a query (index `event_attendees (company_id, email)` and `(company_id, lead_id)`); a `contact_id` on `event_attendees` would make the link exact |
| EA2 | `event_capture_follow_up_notices` | — | `(company_id, capture_id UNIQUE, notified_at, user_id null)`: the overdue booth follow-up notice, once per capture | Table, or a nullable `event_captures.follow_up_notified_at` (like `tasks.overdue_notified_at`) |
| EA3 | `notifications.type` `event-follow-up` | not in the type list | stored notification to the lead owner when a capture is untouched past `automation_rules.event_follow_up_days` | Add the value to the notifications type enum |
| EA4 | follow-up state of a capture | — | derived on read from the lead after `captured_at`: status type won / lost, `meeting` activity or Meeting / Proposal status, outreach activity (call / email / WhatsApp / visit), else untouched | Keep derived (index `activities (company_id, lead_id, at)`); the capture's own activity is recognisable by its id prefix here — a real backend should link it (`activities.event_capture_id`) |
| EA5 | event analytics | — | computed per request from `events`, `event_attendees`, `leads`, `event_budget_lines`, `event_survey_responses` with the event stats rules | No table; cache per company + range if it gets slow |

#### Sponsors & exhibitors, travel & logistics (new tables)

`docs/API.md` › Events › Sponsors & exhibitors / Travel & logistics. None of these tables is in the design; every row
carries `company_id` (tenant key) and `event_id → events.id` (cascade).

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| S1 | `event_sponsor_packages` | — | `(id, event_id, name, price decimal(12,2), currency char(3) = company currency, quantity, benefits JSON, deliverables JSON [{ title, offset_days }], sort_order)` | Table; `UNIQUE (event_id, name)`; deliverables as JSON or `event_sponsor_package_deliverables` |
| S2 | `event_sponsors` | — (sponsorship is not a lead / deal type) | `(id, event_id, package_id, lead_id null, customer_id null, organization_name snapshot, contact_name, contact_email, amount, stage prospect/contacted/proposal_sent/negotiating/signed/paid/lost, lost_reason, owner_id, expected_payment_date, actual_payment_date, notes, signed_at, created_by)`; signed + paid ≤ package quantity (409 sold_out) | Table; check the slot count in a transaction (`SELECT … FOR UPDATE` on the package); exactly one of `lead_id` / `customer_id` |
| S3 | `event_sponsor_deliverables` | — | `(id, sponsor_id, event_id, title, offset_days, due_date, status todo/in_progress/done, owner_id, task_id null, overdue_notified_at)`; created once on signing | Table; `tasks.source_type / source_id` would replace `template_task_id = sponsor-deliverable:<id>` |
| S4 | event stats `sponsorship_income` | — | derived: signed + paid sponsor amounts of an organized event; ROI = (won + sponsorship − actual cost) / actual cost | No column; document next to the ROI |
| S5 | `event_trips` | — | `(id, event_id, user_id, flight_from, flight_to, depart_date, return_date, airline, booking_ref, flight_cost, hotel_name, check_in, check_out, hotel_cost, visa_required, visa_status not_needed/applied/approved/rejected, visa_expiry, visa_number_last4 char(4), per_diem, other_costs, status planned/booked/completed/cancelled, notes)`; one per person per event | Table, `UNIQUE (event_id, user_id)`; **never store the full document number** (or keep it encrypted in an HR document store) — only the last 4 |
| S6 | `event_shipments` | — | `(id, event_id, vendor_id null → vendors.id, vendor_name, tracking_number, items, ship_date, arrival_date, status preparing/in_transit/delivered/returned/cancelled, cost, notes)` | Table |
| S7 | `event_deadlines` | — | `(id, event_id, title, due_date, owner_id, done, done_at, notes, reminder_sent_at)`; reminder 3 days before, once | Table (or tasks with a `deadline` kind) |
| S8 | `event_logistics_lines` + `event_budget_lines.category logistics` | — | `(event_id, line_id, kind trip/shipment, source_id)`: the one budget line each trip / shipment keeps in step (idempotent); new budget category `logistics` | `event_budget_lines.source_type / source_id` instead of a link table; add `logistics` to the category enum |

#### Libraries: speakers directory, venues, vendors

`docs/API.md` › Events › Speakers, venues & vendors. Company tables (`company_id` tenant key), not per event. The design has
`vendors` (finance: "Suppliers the company pays": `name, email, phone string(30), tax_number string(50), address, is_active`;
`expenses.vendor_id`) and nothing for speakers or venues.

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| L1 | `speakers` | — | `(id, company_id, name, title, company, bio, photo_url, email, mobile, topics JSON, linkedin_url, kind internal/external, user_id null → users.id, fee decimal(12,2) null, fee_currency char(3), notes, created_by, timestamps)`; dedupe on create: same email, or same name + company → `409 speaker_exists` | Table; index `(company_id, email)`; `topics` JSON or a `speaker_topics` pivot |
| L2 | `event_sessions.speaker_ids` + `event_speakers` | — | sessions reference `speakers.id`; `event_speakers` is the roster `(event_id, speaker_id)`; the old per-event rows were migrated (dedupe per company: email, else name + company; gaps filled, never overwritten) | `event_session_speakers (session_id, speaker_id)` pivot; data migration as in `services/speakerMigration.ts` |
| L3 | `speaker_ratings` | — | inline on the speaker: `(event_id, rating 1–5, note, rated_by, rated_at)`, one per event (re-rating replaces), completed events where the speaker is on the roster | Table `UNIQUE (speaker_id, event_id)` |
| L4 | `venues` + `venue_rooms` | — | `(id, company_id, name UNIQUE per company, type exhibition_centre/hotel/conference_hall/office/online_platform/other, address, city, country char(2), map_url, lat decimal(9,6), lng decimal(9,6), capacity, contact_name, contact_mobile, contact_email, day_rate decimal(12,2), currency char(3), price_notes, amenities JSON, notes, rating tinyint null, status active/archived)`; rooms inline `(id, name, capacity)` | Two tables; `UNIQUE (company_id, name)` |
| L5 | `events.venue_id` | `events.location string(255)` only | `venue_id → venues.id null`; `location` stays the free-text fallback / override (filled "name, city" when empty); archived venues can't be newly picked; capacity above the venue's → warning, not refused | Add `venue_id` FK (`ON DELETE SET NULL`; the mock refuses deleting a used venue) |
| L6 | `vendors` (event use) | `name, email, phone, tax_number, address, is_active` | + `category` (booth_builder/printing/catering/giveaways/av_tech/photo_video/logistics/staffing/venue_services/other), `contact_name`, `mobile` (by company country; design `phone string(30)`), `website`, `payment_terms`, `status preferred/approved/blacklisted` (instead of `is_active`), `notes`, `documents` JSON (name + link); no `address` in the mock | Extend the design's `vendors` (one supplier table for finance and events): add the columns; `status` replaces or complements `is_active` (blacklisted ⇒ inactive) |
| L7 | `vendor_reviews` | — | inline on the vendor: `(id, event_id, rating 1–5, notes, rated_by, rated_at)`, one per event, only for completed events with the vendor's lines | Table `UNIQUE (vendor_id, event_id)` |
| L8 | `event_budget_lines.vendor_id` | — (design: `expenses.vendor_id`) | `vendor_id → vendors.id null`; blacklisted vendors can't be newly picked (`422 vendor_blacklisted`); vendor spend = sum of its lines' `actual` (per event and total) | Add the FK; when expenses are built, link the expense to the same vendor |

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

### Design gaps › Marketing (growth)

Lead generation, audiences and website & SEO (`src/shared/mocks/data/marketingGrowth.ts`, services `leadGen.ts`,
`audiences.ts`, `seo.ts`, wire `src/shared/api/marketingGrowthMappers.ts`; API in `docs/API.md` › Marketing › Lead
generation, Audiences, Website & SEO). The design has `web_form_endpoints` (§ Integrations: `default_source_id,
default_owner_id, name, public_key, secret_hash, allowed_origins, is_active, last_used_at`) and nothing for landing
pages, UTM links, audiences or SEO. Differences and proposals:

| # | Table / column | Design | Mock / API | Suggestion |
|---|---|---|---|---|
| G1 | `web_form_endpoints.field_map` | — (the endpoint receives whatever the website posts) | `field_map` json: ordered `[{ key, type, label, required }]`, types = lead fields (company name, contact name, email, mobile, industry, source detail, message, custom question); drives the hosted page, the embed and validation | Add `field_map json not null` |
| G2 | `web_form_endpoints.default_owner_id` | one owner | `default_owner_ids` (round-robin among chosen agents, by the number of leads the form created) | Add `default_owner_ids json` (or a `web_form_owners` pivot) and keep `default_owner_id` as the single-owner case |
| G3 | `web_form_endpoints.is_active` | bool | `status active · paused` (paused = the page shows "not accepting responses", submit 409) | Keep `is_active` (paused = false) or add `status string(10)` |
| G4 | `web_form_endpoints` success / redirect / consent | — | `success_message`, `redirect_url`, `consent_text` (checkbox required when set) | Add `success_message string(500)`, `redirect_url string(500) null`, `consent_text string(500) null` |
| G5 | `web_form_endpoints.campaign_id` | — | leads from the form get `leads.campaign_id` (cost per lead) | Add `campaign_id → campaigns.id null` |
| G6 | `web_form_endpoints.views_count` | — (`last_used_at` only) | `views`: loads of the hosted page / embed / landing pages (public GET), for conversion rate | Add `views_count unsigned int default 0` (or a daily `web_form_views` table for trends) |
| G7 | `secret_hash`, `allowed_origins` | server-to-server post with a secret | not used: the browser posts to the public key (honeypot + rate limit instead of a secret); origins aren't checked by the mock | Keep for server-side integrations; the browser embed uses the public key only |
| G8 | form submissions | — | `web_form_submissions(id, company_id, web_form_endpoint_id, landing_page_id, channel hosted·embed·landing, submitted_at, name, email, mobile, company_name, answers json, consent bool, outcome created·linked·limit·spam, lead_id null, do_not_contact bool)` — spam and plan-limit submissions are kept | New table; index `(company_id, web_form_endpoint_id, submitted_at)` |
| G9 | landing pages | — | `landing_pages(id, company_id, slug, title, headline, body text, hero_image_url, web_form_endpoint_id null, is_published, views_count, timestamps)`; public at `/p/:slug` on the company's own host | New table, `UNIQUE (company_id, slug)`; `hero_image_url` could become `brand_asset_id` once Brand Assets has stable public URLs |
| G10 | UTM links | — | `utm_links(id, company_id, name, base_url, utm_source, utm_medium, utm_campaign, utm_term, utm_content, campaign_id null, url, created_by, created_at)` | New table (or derive `url` on read) |
| G11 | audiences | — (`bulk_emails.filters` json only) | `audiences(id, company_id, name, description, rules json, kind dynamic·static, frozen_at, created_by, timestamps)` + frozen members | New table + `audience_members(audience_id, lead_id)` for static audiences, `UNIQUE (company_id, name)` |
| G12 | `bulk_emails.audience_id` | — | `filters.audience_id` (resolved again at send time; other filters narrow it) | Add `audience_id → audiences.id null` on `bulk_emails` (instead of inside `filters`) |
| G13 | `leads` country | — | "countries" isn't an audience rule: leads have no country column (contacts only have a mobile) | Add `leads.country_code char(2) null` if segmenting by country is needed |
| G14 | SEO pages | — | `seo_pages(id, company_id, url, title, meta_description, h1, target_keyword, page_type, status, checks json, score tinyint, timestamps)`; checks recomputed for the whole company on every save | New table, `UNIQUE (company_id, url)`; `checks`/`score` can be computed on read instead of stored |
| G15 | keywords | — | `seo_keywords(id, company_id, keyword, target_url, search_volume, difficulty, country_code, timestamps)` + `seo_keyword_positions(keyword_id, date, position decimal(5,1) null)` | New tables, `UNIQUE (company_id, keyword, country_code)`, `UNIQUE (keyword_id, date)` |
| G16 | rate limit of the public submit | — | per client / email per form, 10-minute window (shared helper with event registration) | Laravel `RateLimiter` (cache), no table |
| G17 | lead origin | `leads.source_id` only | "Website leads" = leads created by a form / landing page submission (`web_form_submissions.lead_id`, outcome created) or with the Website source | No column needed if G8 exists; otherwise add `leads.web_form_endpoint_id null` |

### Marketing (ads & analytics)

Ads integrations (`src/shared/mocks/data/ads.ts`, `services/ads.ts`, wire `src/shared/api/adsMappers.ts`) and Marketing
analytics (`services/marketingAnalytics.ts`). The design has `integrations` and `integration_sync_logs` only; gaps:

| # | Need | Design | Mock | Proposal |
|---|---|---|---|---|
| M1 | One row per connected ad account | `integrations` (provider `meta_ads \| google_ads \| …`, `label`, `status connected \| expired \| error \| disconnected`, `credentials` encrypted, `last_synced_at`); UNIQUE `(company_id, provider, label)` | `ads.connections`: provider `meta \| google \| linkedin \| tiktok`, `account_id`, `account_name`, `currency`, `status`, `token_hint`, `connected_by/at`, `disconnected_by/at`, `last_sync_status`, `last_error`, `synced_through`, `leads_from`, `retry_after` | Add providers `linkedin_ads`, `tiktok_ads`; store `external_account_id`, `account_name`, `currency_code`, `synced_through` (date), `leads_from`, `disconnected_by/at`, `last_error` (or `settings` json); UNIQUE `(company_id, provider, external_account_id)` instead of `label` |
| M2 | Token never served | `credentials` encrypted JSON | separate `ads.tokens` map, only a masked hint (`•••• 4f2a`) is ever answered | Keep `credentials` encrypted; add `credentials_hint string(12)` (or compute it at write time) |
| M3 | Sync log | `integration_sync_logs` (`direction`, `status success \| failed \| partial`, `records_count`, `error_message`, `started_at`, `finished_at`) | `ads.syncRuns` adds `trigger (initial \| daily \| manual)` and split counts (`rows`, `costs`, `leads_created`, `leads_duplicate`, `leads_skipped`, `leads_pending`) | Add `trigger` and a `summary` json for the split counts; status `error` = design `failed` |
| M4 | Ad campaigns and their mapping to CRM campaigns | none | `ads.campaigns` (`connection_id`, `external_id`, `name`, `objective`, `status`, `campaign_id`, `mapped_at`, `mapped_by`) | New table `ad_campaigns` (company_id, integration_id, external_id, name, objective, status, campaign_id FK nullable, mapped_at, mapped_by); UNIQUE `(integration_id, external_id)` |
| M5 | Daily ad stats | none | `ads.dailyStats` (`ad_campaign_id`, `date`, `spend`, `impressions`, `clicks`, `conversions`, `leads`) | New table `ad_campaign_daily_stats`; UNIQUE `(ad_campaign_id, stat_date)`. This is the `integration_sync_items` the design doesn't have |
| M6 | Idempotent cost entries from ad spend | `campaign_costs` (no source columns) | `ads.costLinks` (`ad_campaign_id\|date` → `cost_id`, `campaign_id`) | Add `campaign_costs.ad_campaign_id` (nullable FK) + `source (manual \| ads)` with UNIQUE `(ad_campaign_id, incurred_on)`; then no link table is needed |
| M7 | Lead-form submissions | none (`web_form_endpoints` is for website forms) | `ads.leadSubmissions` (`connection_id`, `ad_campaign_id`, `external_id`, `submitted_at`, person fields, `outcome created \| duplicate \| limit \| pending_source`, `lead_id`, `campaign_id`, `message`) | New table `ad_lead_submissions`; UNIQUE `(integration_id, external_id)`; `pending_source` rows are retried by the sync job |
| M8 | Lead source per provider | `lead_sources` | matched by key / name ("Paid ads", "Meta", "LinkedIn"…); none → `pending_source` | Seed an `is_system` "Paid ads" source per company, or store `settings.lead_source_id` on the integration |
| M9 | Lead attribution to the ad | `leads.campaign_id` | campaign from the mapping; source detail = "Provider: ad campaign" | Optional `leads.ad_campaign_id` for ad-level attribution |
| M10 | Analytics funnel | `lead_status_history` (rows from now on) | seed leads have no history rows: their current status counts | Backfill one history row per existing lead at migration |
| M11 | Analytics ROI / won value | `leads.value` + status type `won` | cohort = leads created in the period; won = status type `won` now (not `won_at` in the period) | Fine for a cohort view; a "won in the period" view would read `lead_status_history` / `contracts` |
| M12 | Presets in the company timezone | `companies.timezone` | resolved server-side from the mock clock | Same in the backend (Carbon with the company timezone) |

### Design gaps › Marketing (creative)

Content calendar, design requests and brand assets (`src/shared/mocks/data/marketingCreative.ts`, services
`contentCalendar.ts`, `designRequests.ts`, `brandAssets.ts`, `creativeReminders.ts`; wire
`src/shared/api/creativeMappers.ts`, mechanical snake_case). **The design has none of these tables** (§13 covers
campaigns, bulk email and events only); the mock's columns are the proposal. Comments, files and history reuse the
design's polymorphic tables.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| C1 | `content_items` | — | `id, company_id, title, type, channels, status, owner_id, reviewer_id, approved_by, approved_at, publish_at, campaign_id, body, notes, published_url, published_at, created_by, reminder_sent_at, overdue_notified_at, timestamps` | New table: `title string(200)`, `type string(20)` (`social_post · blog_post · newsletter · video · case_study · press_release · other`), `status string(12)` (`idea · draft · in_review · approved · scheduled · published · archived`), `owner_id / reviewer_id / approved_by / created_by → users.id`, `publish_at datetime null` (UTC; entered in `companies.timezone`), `campaign_id → campaigns.id null`, `body longText`, `notes text`, `published_url string(500) null`, `published_at datetime null`, `reminder_sent_at`, `overdue_notified_at` (stored-once reminders, like `tasks`); INDEX `(company_id, status, publish_at)`, INDEX `(company_id, campaign_id)` |
| C2 | `content_items.channels` | — | array of `linkedin · instagram · facebook · x · tiktok · youtube · blog · email · website` | `channels json` (small fixed set), or a `content_item_channels (content_item_id, channel)` pivot if channel reports need SQL grouping |
| C3 | content ↔ assets | — | `asset_ids[]` on the item | Pivot `content_item_assets (content_item_id, brand_asset_id)`, UNIQUE pair |
| C4 | `design_requests` | — | `id, company_id, title, type, brief, formats, due_date, priority, status, requester_id, assignee_id, campaign_id, content_item_id, delivered_at, reminder_sent_at, overdue_notified_at, timestamps` | New table: `type string(20)` (`social_post · banner · brochure · presentation · video · logo · other`), `brief text`, `formats json` (free-text sizes), `due_date date null`, `priority string(10)` (`low · medium · high · urgent`, like `tasks.priority`), `status string(20)` (`requested · in_progress · in_review · changes_requested · approved · delivered · cancelled`), `requester_id → users.id`, `assignee_id → users.id null`, `campaign_id null`, `content_item_id null`; INDEX `(company_id, status)`, `(company_id, requester_id)`, `(company_id, assignee_id)` |
| C5 | design request ↔ reference assets | — | `asset_ids[]` | Pivot `design_request_assets` |
| C6 | Attachments of design requests | `attachments` morph types: Task, Project, Lead, Customer, Contract, Expense, EmployeeDocument | `attachments[]` (name, mime_type, size_bytes, uploaded_by, preview) on the request; counted in `storageMb` | Add `DesignRequest` (and `BrandAsset`, see C8) to `attachments.attachable_type`; the image preview is a thumbnail derived from `path` (no column) |
| C7 | Comments with mentions on content / design requests | `comments` morph | `comments[]` with `mentions[]` | Add `ContentItem`, `DesignRequest` to `comments.commentable_type`; mentions like task comments |
| C8 | `brand_assets` | — | `id, company_id, name, kind, mime_type, size_bytes, tags, campaign_id, source, design_request_id, source_attachment_id, description, usage_rights_expires_at, status, created_by, expiry_notified_at, timestamps` | New table: `kind string(12)` (`logo · image · video · document · template · font · other`), `source string(16)` (`upload · design_request`), `design_request_id null`, `attachment_id → attachments.id` (the stored file: a design-request file saved to assets points at the same attachment, so storage is counted once — the mock's `source_attachment_id`), `usage_rights_expires_at date null`, `status string(10)` (`active · archived`), `expiry_notified_at`; tags through the design's `taggables` (`taggable_type = BrandAsset`) instead of the mock's `tags[]` |
| C9 | System assets | `companies` branding columns (logo, dark logo, favicon) | listed as read-only assets `SYS-logo-light / SYS-logo-dark / SYS-favicon`, computed | No table: the API composes them from `companies`; never stored or counted |
| C10 | Status history | — | `history[]` per item / request | `audit_logs` with `auditable_type = ContentItem / DesignRequest` (like the events gap E14) |
| C11 | Stored notifications | `notifications.type` | new types `marketing-due`, `marketing-overdue`, `marketing` | Add the three values to the notification type list |
| C12 | Storage usage | plan limit `storage_mb` over `attachments.size_bytes` | the mock adds design-request attachments and uploaded (non-design) brand assets | With C6 / C8 every file is an `attachments` row, so the existing `SUM(size_bytes)` stays correct |

### Design gaps › HR (recruitment, training)

Recruitment and training (`src/shared/mocks/data/hrTalent.ts`, services `hrRecruitment.ts`, `hrTraining.ts`,
`trainingReminders.ts`; wire `src/shared/api/hrTalentMappers.ts`, mechanical snake_case). **Design §14 (HR) covers
employees, documents, attendance, leave balances / requests / approvals only: it has no recruitment or training
table.** The mock's columns are the proposal; every table is company-scoped (`company_id`, Tenant).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-R1 | `job_openings` | — | `id, company_id, title, department_id, hiring_manager_id, headcount, employment_type, location, salary_min, salary_max, salary_currency, description, requirements, status, requested_by, approved_by, approved_at, criteria, timestamps` | New table: `department_id → departments.id`, `hiring_manager_id / requested_by / approved_by → users.id`, `headcount unsignedSmallInteger`, `employment_type` (same values as `employees.employment_type`), `salary_min / salary_max decimal(12,2) null` + `salary_currency char(3)` (served to HR + hiring manager only — field-level rule in the API resource), `status string(20)` (`draft · pending_approval · open · on_hold · filled · closed`), `criteria json` (scorecard criteria). INDEX `(company_id, status)`, `(company_id, department_id)` |
| H-R2 | `candidates` | — | `id, company_id, full_name, email, mobile, current_company, current_title, source, cv, notes, tags, timestamps` | New table; `source string(12)` (`referral · linkedin · job_board · website · agency · other`); duplicate rule per company: INDEX `(company_id, email)`, `(company_id, mobile_digits)` (a normalized column; checked in the service, not UNIQUE, so HR can merge later); tags through `taggables` (`Candidate`) instead of `tags[]`. Candidate personal data: same encryption / retention policy as `employees` |
| H-R3 | CV file | `attachments` morph | `cv { name, size_bytes, mime_type, uploaded_at }` on the candidate, counted in `storageMb` | `attachments` row with `attachable_type = Candidate` (one current CV); storage stays `SUM(attachments.size_bytes)` |
| H-R4 | `job_applications` | — | `id, company_id, candidate_id, opening_id, stage, rejection_reason, employee_id, stage_changed_at, created_at` | New table: UNIQUE `(candidate_id, opening_id)`; `stage string(12)` (`applied · screening · interview · assessment · offer · hired · rejected · withdrawn`); `employee_id → employees.id null` (set by the hire; the idempotency key of the hire). Stage history → `audit_logs` (`auditable_type = JobApplication`) |
| H-R5 | `interviews` + `interview_interviewers` | — | `id, company_id, application_id, scheduled_at, duration_minutes, type, location, interviewer_ids[], status` | New table (`scheduled_at datetime` UTC, entered in `companies.timezone`; `type` `phone · video · onsite`; `status` `scheduled · completed · cancelled`) + pivot `interview_interviewers (interview_id, user_id)` |
| H-R6 | `interview_scorecards` | — | `scorecards[] { interviewer_id, scores[{criterion, score}], recommendation, notes, submitted_at }` on the interview | New table UNIQUE `(interview_id, interviewer_id)`, `scores json` (criterion → 1–5), `recommendation string(10)` (`strong_yes · yes · no · strong_no`), `notes text`. Averages are computed, not stored |
| H-R7 | `job_offers` | — | `id, company_id, application_id, salary, currency, start_date, expiry_date, status, employee_id, timestamps` | New table: `salary decimal(12,2)`, `status string(10)` (`draft · sent · accepted · declined`; "expired" is computed from `expiry_date`), `employee_id null`. Partial unique "one open offer per application" enforced in the service |
| H-R8 | Hire → employee | `employees.user_id` unique, optional | accepting creates an `employees` row (status onboarding, no `user_id`) via the Employees service | No new column; the employee may get a login later through the Employees section (link user) |
| H-T1 | `training_courses` | — | `id, company_id, title, category, provider, provider_name, duration_hours, cost, currency, mandatory, validity_months, description, active, timestamps` | New table: `category string(16)` (`safety · compliance · technical · soft_skills · leadership · onboarding · other`), `provider string(10)` (`internal · external`), `duration_hours decimal(6,1)`, `cost decimal(12,2)` per participant, `mandatory boolean`, `validity_months unsignedSmallInteger null` (null never expires, 0 no certificate) |
| H-T2 | `training_sessions` | — | `id, company_id, course_id, start_date, end_date, location, online_link, trainer, capacity, extra_cost, status, created_at` | New table (`date` columns = company calendar days), `status` `scheduled · completed · cancelled`, INDEX `(company_id, start_date)` |
| H-T3 | `training_enrollments` | — | `id, company_id, session_id, employee_id, status, score, feedback_rating, feedback, updated_at` | New table UNIQUE `(session_id, employee_id)`; `status string(10)` (`invited · enrolled · attended · no_show · completed · failed`), `score unsignedTinyInteger null` (0–100), `feedback_rating unsignedTinyInteger null` (1–5) |
| H-T4 | `training_certificates` | — | `id, company_id, number, course_id, employee_id, enrollment_id, issue_date, expiry_date, file_url, expiry_notified_at, created_at` | New table: `number string(30)` UNIQUE per company, `expiry_date date null` (= issue + validity months, editable), `file` → `attachments` (`TrainingCertificate`) instead of `file_url`, `expiry_notified_at` (stored-once alert; cleared when the dates change). INDEX `(company_id, expiry_date)` |
| H-T5 | Training matrix / budget | — | computed (`/hr/training/matrix`, `/hr/training/budget`) | No table: views over H-T1…H-T4 + `employees` |
| H-N1 | Stored notifications | `notifications.type` | type `hr` (certificate expiring: employee, manager, HR full) | Add `hr` to the notification types (shared with the other HR sections) |
| H-S1 | Storage usage | `storage_mb` over `attachments.size_bytes` | the mock adds candidate CVs | With H-R3 the CV is an `attachments` row; the existing sum stays correct |

### Design gaps › HR (attendance, leave, public holidays)

Attendance, leave and holidays (`src/shared/mocks/data/hrTime.ts`; services `attendance.ts`, `leave.ts`,
`hrTimeAccess.ts`; rules `src/modules/hr/time/calc.ts`; wire `src/shared/api/hrTimeMappers.ts`, mechanical
snake_case). Design §14 has `attendance_records`, `leave_types`, `leave_balances`, `leave_requests`,
`leave_request_approvals`; the screens need more. Every table is company-scoped (`company_id`, Tenant).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-A1 | `work_shifts` + `employee_shift` | — | `id, company_id, name, start_time, end_time, break_minutes, grace_minutes, working_days[], is_default, is_active`; assignments `(employee_id, shift_id)` | New tables: `start_time / end_time time` (company-local wall clock, same day), `working_days json` (0–6; default = the working week from `companies.weekend`), one `is_default` per company (partial unique / service). Pivot `employee_shift (employee_id UNIQUE, shift_id)`; no row = default shift |
| H-A2 | `attendance_records` UNIQUE `(employee_id, work_date)` | one row per day with `check_in_at / check_out_at` | several entries per day (`ATT-…`: clock in → out pairs; re-clocking after a break, imports) | Drop the UNIQUE; keep `work_date` (company-local date of the check-in) + INDEX `(company_id, employee_id, work_date)`. The day view (status, worked / late / early / overtime minutes, missing clock-out) is computed from entries + shift + holidays + approved leave, never stored |
| H-A3 | `attendance_records.status` | `present · absent · late · leave · holiday` | computed `present · late · absent · on_leave · holiday · weekend · half_day` | Remove the stored status (or keep it as a nightly materialised cache with the full value set); `leave` → `on_leave`, add `weekend`, `half_day` |
| H-A4 | `attendance_records.minutes_worked` | stored | computed (break deducted from 5 h; open entries not counted) | Computed; drop or cache |
| H-A5 | `attendance_records.source` | `manual · web · device` | `web · manual · import` | Add `import` (CSV punches); `device` stays for a future terminal integration |
| H-A6 | `attendance_records` note / location / created_by | — | `note string(300)`, `location string(120)`, `created_by → users.id` | New columns |
| H-A7 | `attendance_corrections` | — | `id, company_id, employee_id, work_date, entry_id null, check_in, check_out null, reason, status, requested_by, requested_at, decided_by, decided_at, comment` | New table: `status string(10)` (`pending · approved · rejected`); approval rewrites / adds the record (`source = manual`) and writes `audit_logs` |
| H-L1 | `leave_types` rules | `name, days_per_year, is_paid, requires_approval, is_active` | + `code, accrual, carry_over_max, document_after_days, min_notice_days, gender, allow_negative, color, is_default` | New columns: `code string(16)` (`annual · sick · unpaid · maternity · paternity · hajj · compassionate · emergency · other`), `accrual string(8)` (`monthly · yearly`), `carry_over_max decimal(5,1)`, `document_after_days smallint null`, `min_notice_days smallint`, `gender string(6) null`, `allow_negative bool`, `color char(7)`, `is_default bool` (seeded country default, "review with HR"). `requires_approval` stays (always true here) |
| H-L2 | `leave_balances` | `entitled_days, used_days` stored | computed: `entitled, accrued, carried, used, pending, remaining` | Keep the table as a yearly snapshot (`entitled_days`, `carried_days`, `adjustment_days` for HR corrections) and compute `accrued / used / pending / remaining` from requests + hire date (company-local dates); or drop it and compute everything |
| H-L3 | `leave_requests.status` | `pending_head · pending_hr · approved · rejected · cancelled` | same | Aligned |
| H-L4 | `leave_requests` extra columns | — | `half_day (am · pm) null`, `document_name`, `submitted_by → users.id`, `cancelled_at`, `cancelled_by` | New columns; the document becomes an `attachments` row (`LeaveRequest`) instead of `document_name` |
| H-L5 | `leave_request_approvals` | `approver_id` (one user), `step department_head · hr`, `decision`, `comment`, `decided_at` | step 1 lists the eligible approvers (manager + department head, fixed at submission); step 2 = any HR-full user; `decided_by` | `approver_id` = who decided (null while pending) + a pivot `leave_approval_candidates (approval_id, user_id)` for step 1, or resolve step-1 approvers live from `employees.manager_id` / `departments.head_id` |
| H-L6 | `leave_settings` | — | `conflict_threshold_pct` per company | Column on `companies` (or a `settings` key) |
| H-H1 | `public_holidays` | — (no table) | `id, company_id, date, name, is_default` | New table UNIQUE `(company_id, date)`; seeded per country for the current and next year (approximate Islamic dates) |
| H-N2 | Stored notifications | `notifications.type` | type `hr` (leave approvals / decisions, corrections) | Same `hr` type as H-N1 |

### Design gaps › HR (employees, contracts, assets)

Employees, documents, contracts and the asset register (`src/shared/mocks/data/hrEmployees.ts` core +
`hrPeople.ts`; services `hrEmployees.ts`, `hrContracts.ts`, `hrAssets.ts`, `hrPeopleAlerts.ts`, scope `hrAccess.ts`;
wire `src/shared/api/hrMappers.ts`, mechanical snake_case). Compared with the design's section 14 (`employees`,
`employee_documents`). **The design has no contract or asset tables**; the mock's columns are the proposal.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H1 | `employees` name | `first_name`, `last_name` | `full_name` (one field; seeded from `users.name`) | Keep `first_name` / `last_name` in the table; the API composes `full_name` and splits on write (last word = last name) |
| H2 | `employees.employee_number` | `employee_number string(30)`, UNIQUE (company_id, employee_number) | `employee_no` (`APX-0001`, next per company) | Rename the wire key to `employee_number`, or keep `employee_no` as the API alias |
| H3 | `employees.contract_type` / `contract_end_date` | on `employees` (`permanent · fixed_term · part_time · intern`) | `employment_type` on the employee (`full_time · part_time · contractor · intern`); the contract's type and end live on `employee_contracts` (H8) | Drop `contract_type` / `contract_end_date` from `employees` (derive from the active contract), keep an `employment_type string(20)` |
| H4 | `employees.status` | `active · on_leave · terminated` | `onboarding · active · on_leave · notice · terminated` | Add `onboarding` and `notice` (notice starts the offboarding) |
| H5 | `employees.termination_date` | `termination_date` | `exit_date` (last working day; set for notice and terminated) | Rename to `exit_date` or map; one column either way |
| H6 | Employee extras | — | `gender`, `employment_type`, emergency contact (name, relation, phone), address (line1, city, country), bank (bank name, account name, IBAN — stored in full, served masked, reveal audited), offboarding (`started_at`, `completed_at`, `completed_by`) | New columns on `employees` (`gender string(10) null`, `emergency_contact json`, `address json`, `bank_name`, `bank_account_name`, `iban text` **encrypted**, `offboarding_started_at`, `offboarding_completed_at`, `offboarding_completed_by → users.id`), or a 1:1 `employee_profiles` table to keep `employees` lean |
| H7 | `employee_documents` | `type: residency · passport · national_id · visa · contract · other`; `document_number text` encrypted; `issue_date`, `expiry_date`, `file_path`, `expiry_alerted_at` | `type: passport · residence_visa · emirates_id · iqama · labour_card · work_permit · medical_insurance · driving_license · other`; `number` stored in full and served as `number_masked`; `issuing_country`; `notes`; `file {name, size_bytes, mime_type}`; `alert_marks[]` (`d60:<date>`, `d0:<date>`) | Widen the type list (GCC documents); add `issuing_country string(2)`, `notes text`; the file through `attachments` (`attachable_type = EmployeeDocument` is already in the morph list), counted in `storage_mb`; replace `expiry_alerted_at` by two stamps (`expiry_alert_60_sent_at`, `expiry_alert_0_sent_at`) cleared when `expiry_date` changes (the mock keys the marks by date instead) |
| H8 | `employee_contracts` | — | `id, company_id, employee_id, type (unlimited · limited · part_time · internship · consultancy), start_date, end_date, probation_months, probation_end_date, notice_days, hours_per_week, basic_salary, housing_allowance, transport_allowance, other_allowance, currency, status (draft · active · ended · terminated · renewed), signed_date, notes, renewed_from_id, alert_marks, timestamps` + file | New table; amounts `decimal(12,2)` (sensitive: HR full + the employee); UNIQUE partial index "one `active` per employee" (or enforced in the service); `renewed_from_id → employee_contracts.id null`; file through `attachments` (`attachable_type = EmployeeContract`); reminder stamps `probation_alert_sent_at`, `end_alert_60_sent_at`, `end_alert_30_sent_at` |
| H9 | `company_assets` | — | `id, company_id, tag, name, category (laptop · phone · tablet · vehicle · sim · access_card · furniture · other), brand, model, serial, purchase_date, cost, currency, condition (new · good · fair · poor · damaged), status (in_stock · assigned · in_repair · retired · lost), warranty_end, notes, alert_marks, timestamps` | New table; UNIQUE (company_id, tag); `warranty_alert_sent_at` instead of the marks |
| H10 | `asset_assignments` | — | `assignments[]` on the asset: `employee_id, assigned_date, assigned_condition, handover_note, returned_date, returned_condition, return_note, lost` | New table (`company_id, asset_id, employee_id, …`); the open assignment = `returned_date IS NULL AND lost = false`; INDEX (company_id, employee_id) for the offboarding check |
| H11 | Employee history | — | `hr_activity` rows (`employee_id, at, actor_id, action, summary`) for the Activity tab; reveals also in the audit log | `audit_logs` with `auditable_type = Employee` (and the document / contract / asset types) instead of a separate table |
| H12 | Stored notifications | `notifications.type` | new type `hr-people` (document expiry, probation / contract end, warranty), bell group HR | Add the value to the notification type list |
| H13 | Staff without a login | `employees.user_id` nullable | `EMP-X<n>` ids for staff without a user; linking later through `link-user` (UNIQUE user) | Same (`user_id` UNIQUE nullable); ids are bigint in the backend |
| H14 | Storage usage | `storage_mb` over `attachments.size_bytes` | the mock adds document and contract files | With H7 / H8 every file is an `attachments` row, so `SUM(size_bytes)` stays correct |

### Design gaps › HR (reports)

HR reports (`src/shared/mocks/services/hrReports.ts`, rules `src/modules/hr/reports/calc.ts`) are computed from the
existing HR tables; nothing is stored except one settings row per company (`src/shared/mocks/data/hrReports.ts`).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-RP1 | `hr_report_settings` | — | `company_id, nationalisation_target_pct decimal(4,1) null, training_budgets [{year, amount}], updated_at, updated_by` (store `hr.reportSettings`, created on the first PUT) | New table `hr_report_settings (company_id UNIQUE, nationalisation_target_pct decimal(4,1) null, updated_by → users.id, timestamps)` + `training_budgets (company_id, year smallint, amount decimal(12,2), UNIQUE (company_id, year))`; or `settings` keys `hr.nationalisation_target_pct` / `hr.training_budget.<year>` |
| H-RP2 | Payroll cost report | — | committed cost from `employee_contracts` (basic + allowances of the contract in force each month) | **Done**: months with an approved / paid payroll run use the run lines (`source: payroll_runs`); contracts for the other months (H-P10) |
| H-RP3 | `employees.exit_date` | `termination_date` | terminated rows without an exit date count as leaving on `updated_at` | Make `exit_date` required for `terminated` in the backend (already enforced on write by the API) and backfill old rows |

### Design gaps › HR (salary management)

Payroll (`src/shared/mocks/data/hrPayroll.ts`, services `hrPayroll.ts`, rules `src/modules/hr/payroll/calc.ts`; wire
`src/shared/api/hrPayrollMappers.ts`, mechanical snake_case). **Design §14 has no payroll tables**; the mock's columns
are the proposal. Every table is company-scoped (`company_id`); amounts `decimal(12,2)`.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-P1 | `pay_settings` | — | `company_id, country, currency, pay_day, cutoff_day, wps_employer_id, wps_routing_code, mudad_establishment_no, social_insurance {national / expat employee / employer rates, base, cap}, deduct_absences, overtime_enabled, overtime_multiplier, gratuity_basis, defaults_confirmed(_at / _by)` | New 1:1 table (or a `companies.settings` json); rates `decimal(5,2)`, `cap decimal(12,2) null`; country / currency from the company's regional settings |
| H-P2 | `employee_payroll_profiles` | — | `employee_id, pay_method (bank · cash · cheque), person_id, bank_routing_code` | New 1:1 table; `person_id text` **encrypted** (WPS person id / national id / iqama), served masked, reveal audited. Pay components stay on `employee_contracts` (H8), bank / IBAN on the employee (H6): no copy |
| H-P3 | `payroll_adjustments` | — | `id, employee_id, kind (allowance · bonus · deduction), label, amount, recurrence (once · monthly), month, end_month, notes, paid_run_ids[]` | New table; months as `char(7)` (or the first day, `date`); `paid_run_ids` → pivot `payroll_line_adjustments (line_id, adjustment_id)` |
| H-P4 | `employee_loans` + `loan_repayments` | — | `id, employee_id, kind (advance · loan), principal, installment_amount, start_month, reason, status (active · repaid · cancelled · settled)` + `repayments[{run_id, month, amount, source}]` | Two tables; `loan_repayments.run_id → payroll_runs.id null` (a settlement repayment has none) |
| H-P5 | `payroll_runs` | — | `id, month, status (draft · calculated · approved · paid), currency, period_start, period_end, pay_date, calculated_at / by, approved_at / by, paid_at / by, notes, exports[{at, by, format, count}]` | New table UNIQUE `(company_id, month)`; maker–checker enforced in the service (`approved_by <> calculated_by`); bank-file exports → `audit_logs` |
| H-P6 | `payroll_lines` + `payroll_line_items` | — | lines embedded in the run: employee snapshot (name, number, department, nationality, bank name, masked IBAN), `contract_id, pay_method, pay_start, pay_end, days_in_month, paid_days, unpaid_leave_days, absence_days, leave_days, overtime_hours, gross, total_deductions, net, employee / employer social insurance, employer_cost, fixed_pay, variable_pay, warnings[] (acknowledged), notified_at` + `items[{code, label, type, amount, note}]` | Two tables; a paid run's lines are immutable (the payslip is the line); warnings as json or `payroll_line_warnings` |
| H-P7 | `final_settlements` | — | `id, employee_id, exit_date, reason (resignation · termination · contract_end), basic, housing, gratuity (json breakdown), unpaid_salary_from / days / amount, leave_days, leave_encashment, loan_balance, adjustments[], total, status (draft · paid), paid_at / by` | New table UNIQUE `(company_id, employee_id)`; paying it completes the offboarding step (H6) and settles the open loans |
| H-P8 | `leave_types.is_paid` | `is_paid` | approved requests of unpaid types are deducted in payroll; unpaid leave days are not UAE gratuity service | As designed |
| H-P9 | Stored notifications | `notifications.type` | new type `hr-payroll` (run awaiting approval, payslip available), bell group HR | Add the value to the notification type list |
| H-P10 | Payroll cost report (H-RP2) | — | `/hr/reports/payroll-cost` uses the approved / paid run lines (gross) for months with such a run, contracts otherwise; `source: payroll_runs` | Done in the mock; the backend report reads `payroll_lines` |

### Design gaps › HR (onboarding & offboarding)

Checklists (`src/shared/mocks/data/hrJourney.ts`, services `hrJourney.ts` / `hrJourneySystem.ts`). **The design has no
onboarding tables**; the mock's columns are the proposal. Company-scoped (`company_id`).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-J1 | `checklist_templates` | — | `id, kind (onboarding · offboarding), name, description, department_id, employment_type, active, timestamps` | New table; UNIQUE `(company_id, name)`; `department_id → departments.id null` |
| H-J2 | `checklist_template_items` | — | embedded `items[]`: `title, description, owner_role (hr · it · manager · employee · finance · user), owner_user_id, due_offset_days, due_anchor (start · probation_end), required, action {kind, asset_category, course_id, document_type}` | New table with `position smallint`; `action` as json or four nullable columns; `owner_user_id → users.id null` |
| H-J3 | `employee_journeys` | — | `id, kind, employee_id, template_id, template_name, status (active · completed · cancelled), started_at / by, completed_at / by, cancelled_at` | New table; partial UNIQUE `(company_id, employee_id, kind) WHERE status = 'active'`; template name copied (templates may be deleted) |
| H-J4 | `employee_journey_items` | — | embedded `items[]`: `title, description, owner_role, assignee_user_id, due_anchor, due_offset_days, due_date, due_overridden, required, blocking, action, system (assets · login · settlement), status (open · done · skipped), done_at / by, detail, note, alert_marks[], external_ref` | New table; INDEX `(company_id, assignee_user_id, status)` for My tasks; replace `alert_marks` by `assigned_notified_at`, `due_notified_for date`, `overdue_notified_for date`; `external_ref` = the probation review id (HR › Performance) |
| H-J5 | Offboarding state | `employees.offboarding_*` (H6) | kept on the profile; the journey's system items read the same sources (assets, `users.active`, `final_settlements.status`) | Keep H6 as the legal record; system items are computed, never stored as truth |
| H-J6 | Stored notifications | `notifications.type` | new type `hr-journey` (assigned, due, overdue, completed), bell group HR | Add the value to the notification type list |

### Design gaps › HR (performance)

Performance reviews (`src/shared/mocks/data/hrPerformance.ts`; services `hrPerformance.ts`, `hrPerformanceCore.ts`,
`hrPerformanceTick.ts`; rules `src/modules/hr/performance/calc.ts`; wire `src/shared/api/hrPerformanceMappers.ts`,
mechanical snake_case). **Design §14 has no performance tables**; the mock's columns are the proposal. Every table is
company-scoped (`company_id`).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-PF1 | `performance_templates` | — | `id, name, description, scale [{value, label}], sections [{id, title, questions [{id, text}]}], goals_enabled, goals_weight, competency_weight, self_review, for_probation, active, timestamps` | New table; `scale json`, `sections json` (or `performance_template_sections` + `_questions` tables), `goals_weight unsignedTinyInteger` (competency = 100 − goals), one `for_probation` per company (service) |
| H-PF2 | `performance_cycles` | — | `id, name, type (annual · mid_year · probation · ad_hoc), phase (draft · goal_setting · self_review · manager_review · calibration · shared · closed), template_id, template (snapshot json), period_start, period_end, department_ids[], employee_ids[], hired_before, deadlines {goal_setting, self_review, manager_review, calibration}, probation_contract_id, probation_end_date, launched_at, closed_at, created_by, marks[]` | New table; the template snapshot as `template_snapshot json` (launched cycles don't follow template edits); deadlines as four `date null` columns; participants filter as pivots `performance_cycle_departments` / `performance_cycle_employees`; `probation_contract_id → employee_contracts.id null` + UNIQUE `(probation_contract_id, probation_end_date)`; notification marks → stamps or a `notification_marks` table |
| H-PF3 | `performance_reviews` | — | `id, cycle_id, employee_id, manager_id (employee, at launch), self {answers[], goal_ratings[], summary, submitted_at}, manager {… , recommended_course_ids[], recommendation, extend_months}, calibrations[], shared_at / by, acknowledged_at, ack_comment, probation_outcome, outcome_applied_at, marks[]` | New table UNIQUE `(cycle_id, employee_id)`; answers as `performance_review_answers (review_id, author: self · manager, question_id, goal_id null, rating tinyint null, comment text)`; `recommended_course_ids` → pivot to `training_courses`; scores / final rating computed (or cached `final_rating` on share) |
| H-PF4 | `performance_calibrations` | — | `calibrations[{rating, previous_rating, note, by, at}]` on the review (HR only; also `audit_logs` `performance_review`) | New table (`review_id, rating, previous_rating, note text, calibrated_by → users.id, created_at`); never exposed through the employee / manager resources |
| H-PF5 | `performance_goals` | — | `id, review_id, cycle_id, employee_id, title, description, weight, target, progress, status (not_started · on_track · at_risk · completed · missed), approved, approved_at / by, created_by, timestamps` | New table; `weight unsignedTinyInteger` (total 100 per review, service rule), `progress unsignedTinyInteger` |
| H-PF6 | Probation outcome | `employee_contracts.probation_*` (H8) | extend moves `probation_end_date` / `probation_months` of the active contract; confirm / terminate → employee activity | As mocked; confirmation could also stamp `employee_contracts.probation_confirmed_at` |
| H-PF7 | Stored notifications | `notifications.type` | type `hr` (phase opened, due / overdue, shared, acknowledged, probation review) | Same `hr` type as H-N1 |

### Design gaps › HR (engagement surveys, 360° feedback)

Engagement surveys and 360° feedback (`src/shared/mocks/data/hrEngagement.ts`; services `hrEngagement.ts`,
`hrEngagementCore.ts`, `hrEngagementTick.ts`, `hrFeedback.ts`; rules `src/modules/hr/engagement/calc.ts`; wire
`src/shared/api/hrEngagementMappers.ts`). **The design has no survey or feedback tables**; the mock's columns are the
proposal. Every table is company-scoped (`company_id`).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-EN1 | `engagement_surveys` | — | `id, name, kind (enps · engagement · onboarding · exit · custom), template_key, anonymous, status (draft · scheduled · open · closed), questions json [{id, type, text, text_ar, driver, options [{id, text, text_ar}], required}], audience {type, department_ids, tenure_bands}, opens_on, closes_on, recurrence (none · monthly · quarterly), series_id, wave, target_employee_ids[], subject_employee_id, journey_id, launched_at, closed_at, created_by, marks[]` | New table; questions as `engagement_survey_questions` (+ `_options`) or `json` (frozen at launch); `series_id` self-reference to the first wave + UNIQUE `(series_id, wave)`; targets as `engagement_survey_targets (survey_id, employee_id)` frozen at open; `journey_id → employee_journeys.id null` |
| H-EN2 | `engagement_responses` | — | `id (random for anonymous), survey_id, respondent_employee_id (NULL for anonymous), sealed_key (anonymous), department_id, tenure_band, answers json [{question_id, value, choice_ids, text}], language (en · ar), submitted_on (date only)` | New table; **no FK / column to the employee for anonymous surveys** (`respondent_employee_id` only for non-anonymous, CHECK); `sealed_key` = HMAC(server secret, company, survey, employee) UNIQUE per survey, the secret in the secret store (never in the DB); UUID ids; no `created_at` timestamp (date only); answers in `engagement_response_answers` for reporting |
| H-EN3 | `engagement_participants` | — | `survey_id, employee_id` ("has responded" marker for reminders / response rate) | New table UNIQUE `(survey_id, employee_id)`, no timestamp, no link to the response row |
| H-EN4 | Demographics on anonymous rows | — | `department_id`, `tenure_band` kept on the response for breakdowns | Keep (needed for breakdowns); DB access to `engagement_responses` restricted (service account); the API's threshold (5) + complementary suppression + one-filter rule protect them |
| H-EN5 | `engagement_settings` | — | `feedback_names_visible_to_hr` (false), `exit_survey_auto` (true) | Columns on a per-company HR settings table (or `company_settings` keys) |
| H-EN6 | `feedback_rounds` | — | `id, subject_employee_id, manager_id (at request), cycle_id, review_id, competencies json [{id, text}], deadline, status (open · closed), allow_nominations, requested_by, closed_at, marks[]` | New table; `review_id → performance_reviews.id null` (one open round per review, service rule); competencies copied from the template at request |
| H-EN7 | `feedback_providers` | — | `id, round_id, employee_id, relationship (peer · direct_report · cross_functional), status (nominated · pending · submitted · declined · rejected), nominated_by (employee · manager · hr), ratings json [{competency_id, rating}], strengths, improvements, decline_reason, invited_at, submitted_at, marks[]` | New table UNIQUE `(round_id, employee_id)`; ratings as `feedback_ratings (provider_id, competency_id, rating tinyint null)`; the provider is stored (360° isn't anonymous in storage: HR may see names with the setting); never exposed with names to the subject / manager |
| H-EN8 | Stored notifications | `notifications.type` | type `hr` (survey open / mid-way / last day, feedback requested / nominated / declined / due / overdue) | Same `hr` type as H-N1 |
| H-EN9 | Exit survey trigger | employee status `notice` | the engagement tick creates the exit survey once per employee on notice (SEAM, no hook in the employee / journey services) | Backend: an event listener on the status change (`EmployeeMovedToNotice`), same once-only rule |

### Design gaps › HR (self-service, letters)

Self-service (`src/shared/mocks/services/hrSelfService.ts`) and HR letters (`hrLetters.ts`), stores
`src/shared/mocks/data/hrSelfService.ts`. None of these tables is in the design.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-SS1 | `employee_profile_change_requests` | — | `id, company_id, employee_id, requested_by, proposed json (mobile, emergency_contact, address, bank {bank_name, account_name, iban, iban_masked}), current json (IBAN masked only), iban_change, note, status (pending · approved · rejected · cancelled), decided_by, decided_at, decision_comment, notified[], created_at, updated_at` | Add; encrypt `proposed.bank.iban` and null it when the request closes (the mock wipes it); one `pending` per employee (partial unique index) |
| H-SS2 | `hr_letter_types` | — | `id, company_id, code (5 fixed), name, description, body (template), includes_salary, active, updated_by, updated_at` | Add; unique `(company_id, code)`; no template versions (the issued text is frozen on the letter) |
| H-SS3 | `hr_letter_requests` | — | `id, company_id, employee_id, letter_type_id, code, type_name, includes_salary, addressee, purpose, noc_purpose, language_note, requested_by, on_behalf, status, override_reason, rejection_reason, decided_by, decided_at, notified[]` + issued `reference_no, issue_date, verification_code, body, signatory_name, signatory_title, letterhead json` | Add (issued part may be `hr_letters`, 1:1). Unique `(company_id, reference_no)`, global unique `verification_code`; `body` of salary letters holds pay → protect like payslips |
| H-SS4 | `hr_letter_sequences` | — | `company_id:year → last number` (`hr.letterSeq`) | Add `(company_id, year, last_no)`, incremented in the issuing transaction |
| H-SS5 | `employees.mobile` vs `users.mobile` | separate | an approved mobile change updates the HR record only | Decide whether the login's mobile follows |
| H-SS6 | Public letter verification | — | **Done**: `GET /public/letters/verify?code=` (company from the address, rate-limited per client, masked name, no pay) + revocation (`status revoked, revoked_at, revoked_by, revoke_reason` on the request) | Add `revoked_*` columns to `hr_letter_requests` (or `hr_letters`); keep `verification_code` globally unique but always look it up **within** the host's company |
| H-SS7 | Bilingual letters | — | **Done**: `hr_letter_types.name_ar, body_ar` (optional, '' = English only); requests `language (en · ar · bilingual), layout (side_by_side · stacked), digits (western · arabic), addressee_ar, purpose_ar`; issued letters `title_ar, body_ar (RTL, bidi isolates), issue_date_ar` | Add the columns; `language` `string(10)`, `layout` / `digits` `string(12)`; server-side PDF still open (browser print, A4) |
| H-SS8 | `employees.full_name_ar`, `employees.job_title_ar` | — | Optional, Arabic letters only (validated: Arabic script), HR full edits; seeded for some staff | Add `string(120) null` each; Arabic letters refuse to issue without them (`422 missing_values`, `missing_ar`) |
| H-SS9 | Company legal name in Arabic | `fin_settings.legal_name_ar` (finance) | Reused for the Arabic letterhead and `{{company.legalName}}` in Arabic | Decide whether it moves to `companies` (it is company identity, not a finance setting) |

### Design gaps › HR (discipline, policies)

Services `src/shared/mocks/services/hrCompliance.ts` (+ `hrPolicyAudience.ts`), stores `src/shared/mocks/data/hrCompliance.ts`.
None of these tables is in the design.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| H-DC1 | `hr_disciplinary_actions` | — | `id, company_id, case_no (<PFX>-DA-<year>-0001), employee_id, type (verbal_warning · written_warning · final_warning · suspension_paid · suspension_unpaid · deduction), category (attendance · conduct · performance · policy_breach · safety · other), incident_date, description, description_ar, issue_date, expiry_months, expires_on, suspension_days, suspension_start, deduction_amount, deduction_month, currency, adjustment_id, issued_by, issued_by_name, issued_by_title, ack_status (pending · acknowledged · appealed), ack_at, employee_comment, withdrawn_at, withdrawn_by, withdraw_reason, notified[], created_at, updated_at` | Add; unique `(company_id, case_no)`; index `(company_id, employee_id)`; status (`active · expired · withdrawn`) is computed from `withdrawn_at` / `expires_on` and the company day, not stored; `deduction_amount` is pay (HR full + the employee only) |
| H-DC2 | `hr_disciplinary_attachments` | — | embedded `attachments[] {id, name, size_bytes, mime_type, url}` | Separate table (or the shared files table) counted against the plan's storage |
| H-DC3 | `hr_disciplinary_sequences` | — | `company_id:year → last number` (`hr.complianceSeq`) | Like H-SS4 |
| H-DC4 | Payroll link | `payroll_adjustments` | a `deduction` creates a one-off adjustment `source_ref = discipline:<id>` (idempotent); withdrawing removes it while unpaid | Use the existing `source_ref` column (H-P adjustments); suspensions without pay are **not** yet linked to payroll (unpaid-leave days are the natural seam) |
| H-PO1 | `hr_policies` | — | `id, company_id, title, category, status (draft · published · archived), version (current), audience json {kind: all · departments · roles, department_ids[], roles[]}, reminder_marks[], created_by, created_at, updated_at` | Add; audience as JSON or two link tables (`hr_policy_departments`, `hr_policy_roles`); `reminder_marks` → a `hr_policy_reminders (policy_id, version, employee_id, threshold)` table with a unique key |
| H-PO2 | `hr_policy_versions` | — | embedded `versions[] {version, body, file, effective_date, change_note, published_at, published_by}` + `draft {body, file, effective_date, change_note}` | Separate table unique `(policy_id, version)`; the draft is a row with `published_at null` |
| H-PO3 | `hr_policy_acknowledgements` | — | `id, company_id, policy_id, version, employee_id, user_id, at` | Add; unique `(policy_id, version, employee_id)`; a new version needs a new row |

### Design gaps › Finance (ledger & settings)

Ledger core (`src/shared/mocks/data/finance.ts`, `data/financeLedger.ts`; services `ledger.ts`, `financeLedger.ts`,
`financeRates.ts`; rules `src/modules/finance/ledger/calc.ts`; wire `src/shared/api/financeLedgerMappers.ts`, mechanical
snake_case). For Accounting the design (as recorded in this document: AC-1, AC-2, L6, L8) has `tax_rates (name, rate,
is_default, is_active)`, `bank_accounts (is_default, IBAN encrypted)`, `invoices`, `payments`, `expenses (vendor_id)` and
`vendors`; **it has no chart of accounts, journal, settings or exchange-rate tables** — the mock's columns are the
proposal (check the design's Accounting section before acting). Every table is company-scoped (`company_id`); amounts
`decimal(14,2)`, rates `decimal(18,6)`.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-L1 | `accounts` (chart of accounts) | — | `id, code, name, type (asset · liability · equity · income · expense), subtype, parent_id, system_role, is_header, active, currency, description, timestamps`; template ids `ACC-<code>` shared across companies, created ones `ACC-N<n>` | New table; UNIQUE `(company_id, code)`; UNIQUE `(company_id, system_role)` where not null (exactly one active per role, service rule); `parent_id → accounts.id` same company, header only, same type, no cycles; numeric surrogate key (the mock's shared `ACC-<code>` ids are a mock convenience) |
| F-L2 | `journal_entries` + `journal_lines` | — | entry `id, number (JV-yyyy-nnnn per company and year), date, memo, source_type (manual · invoice · credit_note · payment · payment_refund · pdc · opening_balance · payroll · bill · expense · bank), source_id, status (posted · reversed), reversal_of, reversed_by, created_by, created_at`; lines `account_id, debit, credit, description, customer_id, department_id, project_id, event_id, tax_code` (base currency) | Two tables; UNIQUE `(company_id, number)`; `source_type + source_id` polymorphic (index); lines `CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))`; balance enforced in the posting service inside one transaction; entries immutable (corrections by reversal) |
| F-L3 | Document sequences | — | `fin.seq.numbers` `company:series:year → last` | `document_sequences (company_id, series, year, last_no)` incremented with a row lock |
| F-L4 | `finance_settings` | partly `companies` (AC-2 legal profile), `tax_rates.is_default` (AC-1) | `fiscal_year_start_month, vat_registered, vat_number, legal_name_en, legal_name_ar, document_prefix, payment_terms_days, invoice_notes, invoice_terms, default_revenue_account_id, default_bank_account_id, lock_date, lock_date_set_at, lock_date_set_by, updated_at, updated_by` | New 1:1 table (or `companies.settings.finance` json). `vat_number` duplicates `companies.tax_number` (AC-2): decide one source (the mock seeds it from the company profile and keeps it separate; Apex's profile has none). `legal_name_ar` for KSA (ZATCA) invoices |
| F-L5 | `exchange_rates` | — | `id, currency, rate (1 unit in base), effective_date, created_at, created_by` | New table UNIQUE `(company_id, currency, effective_date)`; lookup = latest `effective_date <= document date`; documents snapshot `exchange_rate` |
| F-L6 | Lock date | — | `lock_date` on the settings; posting on or before it → `423 period_locked`; only Company Admin / Accountant move it; audit `finance_lock_date` | Column on F-L4 (or `accounting_periods (company_id, period_end, status open · closed)` for per-period closing later); enforced in the posting service |
| F-L7 | `tax_codes` vs `tax_rates` | `tax_rates (name, rate, is_default, is_active)` | `fin.taxCodes`: `id (VAT5 · VAT15 · ZR · EX · OOS), name, category (standard · zero_rated · exempt · out_of_scope), rate, active` | Extend `tax_rates` with `code` (UNIQUE per company) and `category`; `is_default` = the standard code (AC-1); no edit screen yet |
| F-L8 | Bank accounts | `bank_accounts (is_default, IBAN encrypted)` | none: bank = a ledger account (`system_role bank_default`), the default bank account in settings | Add `bank_accounts.account_id → accounts.id` so each bank record has its ledger account; `is_default` ↔ settings `default_bank_account_id` |
| F-L9 | Journal dimensions | — | line `department_id, project_id, event_id, customer_id` (validated against the company) | FKs on `journal_lines` (nullable); indexes for reporting |
| F-L10 | Audit | `audit_logs` | finance settings, lock date (`security`), accounts, exchange rates, manual journals / reversals / opening balances | As designed (`auditable_type` finance_settings · finance_lock_date · account · exchange_rate · journal_entry) |

### Design gaps › Finance (invoices, credit notes, recurring, ZATCA)

Invoices section (`src/shared/mocks/data/finance.ts` `fin.invoices`, `data/financeInvoices.ts`; services
`financeInvoices.ts`, `financeInvoiceCore.ts`; rules `src/modules/finance/invoices/calc.ts`, `zatca.ts`). The design has
an `invoices` table (with `tax_rates`, `payments`); the mock's columns are the proposal — check the design's Accounting
section before acting. Amounts `decimal(14,2)`, rates `decimal(18,6)`, company-scoped.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-I1 | `invoices` | `invoices` (number, status, totals, dates) | `id, number (<PREFIX>-INV-yyyy-nnnn, assigned on issue; "Draft" before), kind (tax_invoice · simplified), status (draft · issued · partially_paid · paid · void), customer_id, quotation_id, contract_id, lead_id, project_id, event_id, recurring_id, issue_date, due_date, payment_terms_days, currency, exchange_rate, subtotal, discount_total, tax_total, total, amount_paid, amount_credited, balance_due, notes, terms, journal_entry_id, void_journal_entry_id, created_by, issued_at, voided_at, void_reason, timestamps` | Extend `invoices` with the missing columns; UNIQUE `(company_id, number)` where issued; FKs same company; the number from `document_sequences` (F-L3) inside the issue transaction |
| F-I2 | Customer VAT / TRN | — (`customers` has no tax number) | `invoices.customer_vat_number` (per invoice; the next invoice of the customer defaults to the last one used) | Add `customers.tax_number string(20) null` (validated by country) and snapshot it on the invoice |
| F-I3 | `invoice_items` | — | lines `id, description, service_id, quantity, unit_price, discount (amount), tax_code_id, net, tax_amount, total, revenue_account_id` (VAT rounded per line) | New table `invoice_items (invoice_id, …)`; `tax_code_id → tax_rates` (F-L7), `revenue_account_id → accounts` (F-L1) |
| F-I4 | Partial / milestone billing | — | `billing_pct` (share of the quotation / one-off contract), `milestone` label; ≤ 100% over non-void invoices | Columns on `invoices`; the cap checked in the service with a row lock on the quotation / contract |
| F-I5 | `credit_notes` + `credit_note_items` | — | `id, number (<PREFIX>-CN-yyyy-nnnn), invoice_id, customer_id, date, reason, currency, exchange_rate, subtotal, tax_total, total, applied_amount, excess_amount, journal_entry_id, created_by, created_at`; lines `invoice_item_id, description, tax_code_id, tax_rate, net, tax_amount, total, revenue_account_id` | Two tables; `excess_amount` is customer credit (account 2300) consumed by Collections (refund / apply), or a `customer_credits` table owned by Collections |
| F-I6 | `recurring_invoices` | — | `id, customer_id, source_invoice_id, contract_id, frequency (monthly · quarterly · yearly), start_date, end_date, next_date, period_index, mode (draft · auto_issue), status (active · paused · ended), template json (currency, VAT no., terms, lines, notes, project), generated json [{period, invoice_id, at}], last_error, created_by, timestamps` | Table + `recurring_invoice_runs (schedule_id, period date, invoice_id)` UNIQUE `(schedule_id, period)` for idempotency; a scheduled job per company timezone |
| F-I7 | ZATCA data | — | per invoice / credit note `zatca {uuid, icv, pih, invoice_hash, qr, timestamp, type_code, subtype, status (not_submitted · cleared · reported · rejected)}`; chain per company `{icv, last_hash}` | `zatca_documents (company_id, document_type, document_id, uuid, icv, pih, invoice_hash, qr text, signed_xml longtext, status, submitted_at, response json)` UNIQUE `(company_id, icv)`; `zatca_devices (company_id, csid encrypted, private_key encrypted, onboarded_at)`; ICV / hash assigned under a company lock |
| F-I8 | Send log / history | `audit_logs` (Invoice morph) | `send_log[] {at, by_name, to, subject}`, `history[] {at, by_name, action, summary}` on the invoice | `invoice_events (invoice_id, action, to_email, user_id, at)` or `audit_logs` with auditable_type Invoice |
| F-I9 | KSA national address | `companies` (AC-2) | building number / district / postal code are placeholders in the XML | Add to the company profile or finance settings (required in B2B XML) |
| F-I10 | UAE e-invoicing | — | none (seam) | Peppol PINT AE through an accredited service provider: `einvoice_submissions (invoice_id, provider, status, message_id, response)` when it lands |


### Design gaps › Finance (collections: payments, PDC, receivables, payment links)

Collections section (`data/financeCollections.ts`; services `financeCollections.ts`, `financeReceivables.ts`,
`financeCollectionsCore.ts`). The design has a `payments` table against invoices; the rest is a proposal. Amounts
`decimal(14,2)`, rates `decimal(18,6)`, company-scoped, FKs to the same company.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-C1 | `payments` | `payments` (invoice_id, amount, method, date) | `id, number (<PREFIX>-RCT-yyyy-nnnn), customer_id, date, method (bank_transfer · cash · cheque · card · payment_link), amount, currency, exchange_rate, bank_charges, deposit_account_id, reference, notes, status (posted · void), source (manual · pdc · payment_link), pdc_id, payment_link_id, card_hint, created_by, voided_at, void_reason` | A payment belongs to a **customer**, not one invoice: drop `payments.invoice_id`, add the columns; UNIQUE `(company_id, number)` from `document_sequences` |
| F-C2 | `payment_allocations` | — | `id, payment_id, invoice_id, amount, date, kind (payment · credit), journal_entry_id null, reversed_on null` | New table; a partial refund splits a row (the refunded part gets `reversed_on`) so aging can be rebuilt as of any date |
| F-C3 | `payment_refunds` | — | `id, payment_id, date, amount, account_id, reference, journal_entry_id, deallocated json, created_by` | New table |
| F-C4 | Payment ↔ journal | `journal_entries.source_type/source_id` | `journal_entry_ids[]` on the payment | Use the source columns (types payment, payment_refund, pdc); no pivot needed |
| F-C5 | `post_dated_cheques` | — | `id, customer_id, cheque_no, bank_name, received_date, due_date, amount, currency, exchange_rate, status (received · deposited · cleared · bounced), deposit_account_id, deposited_date, cleared_date, bounced_date, bounce_reason, bounce_fee, payment_id, notes, due_notified_at` + allocations `(invoice_id, amount)` | Two tables (`post_dated_cheques`, `pdc_allocations`); UNIQUE `(company_id, customer_id, bank_name, cheque_no)` among non-bounced |
| F-C6 | `payment_links` | — | `id, token (letters only; served only inside the URL), invoice_id, amount, currency, expires_at, status (active · paid · void; expired derived), paid_at, payment_id` | New table + `gateway, gateway_ref, gateway_session_url` for real providers; UNIQUE `token` (platform-wide: it is the public lookup key) |
| F-C7 | Customer credit | — (`customers` has none) | `customer_id, credit_limit null, credit_hold, dunning_paused, bounced_cheques, last_bounce_date` | Columns on `customers` (`credit_limit decimal(14,2) null`, `credit_hold`, `dunning_paused`, bounce counters) or a 1:1 `customer_credit_settings` |
| F-C8 | Collections settings | — | per company `dunning_enabled, dunning_steps json [{id, offset_days, active, notify_owner}], credit_check_mode (warn · block), gateway_fee_pct, default_expiry_days` | Columns on `finance_settings` or a 1:1 `collections_settings` |
| F-C9 | `dunning_log` | — | `id, invoice_id, customer_id, step_id, offset_days, outcome (sent · skipped), sent_to, date, at` + invoice pauses `(invoice_id, paused_at, paused_by)` | New tables; UNIQUE `(invoice_id, step_id)` is the idempotency key |
| F-C10 | Credit-note excess usage | — | `credit_note_uses (credit_note_id, kind apply · refund, invoice_id null, amount, date, account_id null, journal_entry_id)` | New table, or one `customer_credit_movements` ledger for payments and credit notes |
| F-C11 | Customer timeline | `activities` (lead) | payment / reminder / statement lines are `activities` of the customer's Won lead (type email · system) | Fine as is; a backend may add `activities.customer_id` |
| F-C12 | Card data | — | none stored (brand + last 4 only) | Keep it that way: hosted checkout + webhook (PCI SAQ-A) |

### Design gaps › Finance (expenses, expense claims, petty cash)

| # | Area | Current DB | Mock (frontend) | Proposal |
|---|---|---|---|---|
| F-E1 | `expense_categories` | — | `id, name, account_id, description, monthly_limit null, active, timestamps` | New table; UNIQUE `(company_id, lower(name))`; FK account same company, type expense, not header |
| F-E2 | Expense policy | — | per company `receipt_required_above, receipt_mode (warn · block), claim_max_age_days, age_mode, limit_mode` | Columns on `finance_settings` or a 1:1 `expense_policies` |
| F-E3 | `expenses` | `expenses` (amount, category text, date) | `id, number (<PREFIX>-EXP-yyyy-nnnn), status (pending · approved · rejected · void), date, vendor_id null, payee_name, payee_vat_number, category_id, account_id, description, amount, currency, exchange_rate, tax_code_id, tax_rate, vat_amount, net_amount, vat_recoverable, vat_note, payment_method (card · bank_transfer · cash · petty_cash), petty_fund_id null, paid_from_account_id, reference, department_id, project_id, event_id, campaign_id, notes, journal_entry_id, void_journal_entry_id, created_by, approved_at, reject_reason, voided_at, void_reason` | Extend; category becomes an FK; UNIQUE `(company_id, number)` from `document_sequences` (F-L3); index `(company_id, payee, amount, date)` for the duplicate check |
| F-E4 | Receipts | — | `{name, size_bytes, mime_type, url}` inline on expense / claim line / petty expense | `attachments (owner_type, owner_id, file_key, name, size_bytes, mime_type)` in object storage; counted in plan storage |
| F-E5 | Approvals | — | `approval.steps [{approver, min_amount}]` frozen at submit + `approvals [{user_id, at}]` | Shared `document_approvals (doc_type, doc_id, step_index, approver_kind, approved_by, approved_at)` with the purchases section; rules in `approval_rules` (owned by purchases) |
| F-E6 | `expense_claims` | — | `id, number (<PREFIX>-ECL-…), status (draft · pending · approved · in_payroll · reimbursed · rejected), title, notes, employee_id, requester_id, department_id, journal_entry_id, reject_reason, submitted_at, approved_at, history` | New table; FKs same company |
| F-E7 | `expense_claim_lines` | — | `id, claim_id, date, category_id, description, merchant, merchant_vat_number, amount, currency, exchange_rate, base_amount, vat_base, project_id, customer_id, event_id` | New table (receipt via F-E4) |
| F-E8 | Claim reimbursement | — | `{method payment · payroll, account_id, date, journal_entry_id, payroll_adjustment_id, payroll_month, reimbursed_at, by}` | Columns on `expense_claims`; `payroll_adjustments.source_ref` (`claim:<id>`) UNIQUE for idempotency |
| F-E9 | Payroll adjustment kind | `payroll_adjustments.kind` (allowance · bonus · deduction · commission) | adds `reimbursement`; pay item type `reimbursement` (net, not gross, not SI base) | Extend the enum; payslip lines of type reimbursement; the payroll GL posting clears 2450 for them |
| F-E10 | `petty_cash_funds` | — | `id, name, custodian_employee_id, account_id (default 1115), float_limit, active, low_alerted` | New table |
| F-E11 | `petty_cash_expenses` | — | `id, number (<PREFIX>-PCE-…), fund_id, date, category_id, description, payee_name, payee_vat_number, amount, vat_amount, status (pending · approved · rejected), replenishment_id, reject_reason, created_by` | New table |
| F-E12 | `petty_cash_movements` | — | `id, number (PCT · PCR · PCC series), fund_id, kind (top_up · replenishment · count), date, amount (signed), expenses_total, top_up, counted, expected, difference, reason, from_account_id, journal_entry_id, expense_ids` | New table (or `replenishment_id` on F-E11 + a movements table without `expense_ids`) |
| F-E13 | Marketing campaign dimension | `journal_lines` has department / project / event | `expenses.campaign_id` only | Add `campaign_id` to `journal_lines` if campaign P&L is reported from the ledger |
| F-E14 | Notification marks | — | `alert_marks` on expenses / claims (once-only keys) | `notification_marks (owner_type, owner_id, key)` UNIQUE |

### Design gaps › Finance (purchases & payables: suppliers, POs, bills, payments, approval rules)

Purchases section (`data/financePurchases.ts`; services `financePurchases.ts`, `financePurchasesCore.ts`,
`financeBillBalance.ts`, `financeApprovals.ts`). The design has `vendors` (events) and nothing for AP; the rest is a
proposal. Amounts `decimal(14,2)`, quantities `decimal(14,3)`, rates `decimal(18,6)`, company-scoped, FKs to the same
company.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-P1 | Supplier master | `vendors` (events) | the event vendor directory IS the supplier list; finance adds a profile `(vendor_id, vat_number, payment_terms_days, default_expense_account_id, default_tax_code_id, currency, bank_name, iban, notes, updated_by)` | `supplier_profiles` 1:1 with `vendors` (or columns on `vendors`); UNIQUE `(company_id, vendor_id)`; `iban` encrypted at rest, served masked, reveal audited |
| F-P2 | `purchase_orders` | — | `id, number (<PREFIX>-PO-yyyy-nnnn), status (draft · pending_approval · rejected · approved · partially_received · received · closed · cancelled), vendor_id, requester_id, department_id, order_date, expected_date, currency, exchange_rate, subtotal, tax_total, total, notes, delivery_address, rejection_reason, cancel_reason, submitted_at, approved_at, closed_at, timestamps` | New table; number from `document_sequences` (F-L3) |
| F-P3 | `purchase_order_items` | — | `description, quantity, unit_price, tax_code_id, account_id, department_id, project_id, event_id, budget_line_id, net, tax_amount, total, received_qty` (billed qty derived from bill lines) | New table; FKs same company; `budget_line_id → event_budget_lines` |
| F-P4 | Goods / service receipts | — | `receipts[] (date, by, note, lines [{line_id, quantity}])` on the PO | `goods_receipts (po_id, date, received_by, note)` + `goods_receipt_items (receipt_id, po_item_id, quantity)` |
| F-P5 | Approvals | — | frozen `chain[]` + `decisions[] (index, decision, by, at, reason)` + `approved_by[]` on POs and bills | One polymorphic `approval_steps (approvable_type, approvable_id, index, approver_kind, min_amount, decision, decided_by, decided_at, reason)` shared with expenses / claims |
| F-P6 | Approval rules | — | perTenant `fin.approvalRules {rules: [{doc_type, min_amount, approver}]}` + `fin.purchasesSettings.match_tolerance_pct` | `approval_rules (company_id, doc_type, min_amount, approver_kind)`; tolerance on `finance_settings` |
| F-P7 | `bills` | — | `id, number (<PREFIX>-BILL-yyyy-nnnn), supplier_invoice_number, status (draft · pending_approval · rejected · open · partially_paid · paid · void), vendor_id, po_id, bill_date, due_date, terms_days, currency, exchange_rate, vendor_vat_number, subtotal, tax_total, total, amount_paid, amount_credited, balance_due, notes, journal_entry_id, void_journal_entry_id, rejection_reason, void_reason, due_soon_notified_at, posted_at, voided_at, timestamps` | New table; UNIQUE `(company_id, vendor_id, lower(supplier_invoice_number))` where status ≠ void |
| F-P8 | `bill_items` | — | `po_line_id, description, quantity, unit_price, tax_code_id, account_id, department_id, project_id, event_id, budget_line_id, net, tax_amount, total, vat_recoverable` | New table |
| F-P9 | Bill attachments | — | `{name, mime_type, size_bytes, data_url}` on the bill (≤ 512 KB, counted in storageMb) | Polymorphic `attachments` with object-storage keys (no data URLs) |
| F-P10 | `debit_notes` | — | `id, number (<PREFIX>-DN-yyyy-nnnn), bill_id, vendor_id, date, reason, currency, exchange_rate, net, tax_amount, total, account_id, journal_entry_id, status (posted · void), void_reason, voided_at, void_journal_entry_id` | New table (supplier credit). **Done:** debit-note void (`POST /finance/debit-notes/:id/void`: reversal + the bill's balance back through the bill-balance helper) |
| F-P11 | `bill_payments` | — | `id, number (<PREFIX>-PV-yyyy-nnnn), status (posted · void), vendor_id, date, method, reference, payment_account_id, currency, exchange_rate, amount, bank_charges, fx_difference, run_id, notes, journal_entry_id, void_journal_entry_id, void_reason` + `allocations [{bill_id, amount}]` | `bill_payments` + `bill_payment_allocations (payment_id, bill_id, amount)`. **Done:** supplier advances `fin.supplierAdvances (id, number <PREFIX>-ADV-yyyy-nnnn, vendor_id, po_id, date, method, reference, payment_account_id, currency, exchange_rate, amount, applications [{bill_id, date, amount, fx_difference, journal_entry_id}], refunds [{date, amount, account_id, exchange_rate, fx_difference, reference, journal_entry_id}], journal_entry_id)` on account 1420 (system role `supplier_advances`) → `supplier_advances` + `supplier_advance_applications` + `supplier_advance_refunds`; `purchase_orders.advance_pct`; `supplier_profiles.swift_bic` |
| F-P12 | Payment runs | — | `payment_runs (id, number <PREFIX>-PRUN-yyyy-nnnn, date, payment_account_id, payment_ids[])` | New table. **Done:** bank upload file (`POST /finance/payment-runs/:id/bank-file`: ENBD / ADCB bulk CSV, Al Rajhi / SARIE CSV, SWIFT MT103-lite CSV; template + columns per bank account `bank_accounts.payment_file_template, payment_file_columns`) and the run's bank status: columns `bank_status (created · sent · confirmed), bank_reference, sent_at/by, confirmed_at/by` + `payment_run_exports (run_id, at, by, files, count)` |
| F-P13 | Journal source | `journal_entries.source_type` | bills, debit notes and bill payments all post as source `bill` (the contract enum has no `bill_payment` / `debit_note`) | Add `bill_payment`, `debit_note` to the enum when the ledger contract allows |
| F-P14 | Event cost link | `event_budget_lines.actual` | SEAM: `GET /finance/event-costs` shows billed cost per budget line next to `actual`; events data unchanged | Keep `budget_line_id` on bill items. **Done:** the Events budget shows a computed "Billed" column with links to the bills; event stats / ROI use Σ max(actual, billed) per line (services/financeEventCosts.ts, the Profitability rule) |

### Design gaps › Finance (banking, reconciliation, payroll posting, commissions)

Banking section (`data/financeBanking.ts`, `data/financeCommissions.ts`; services `financeBanking.ts`,
`financePayrollGl.ts`, `financeCommissions.ts`). Proposal; company-scoped, FKs to the same company.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-B1 | `bank_accounts` | — | `id, name, bank_name, kind, account_number, iban (stored full, served masked, reveal audited), currency, ledger_account_id, active, opening_balance, opening_date, opening_entry_id, reconcile_from, notes` | New table; UNIQUE `(company_id, ledger_account_id)`; number / IBAN encrypted at rest |
| F-B2 | Foreign amounts on journal lines | `journal_lines` base only | side table `bank_line_fx (entry_id, line_index, amount)` for lines banking posts; other lines on a foreign bank account = base ÷ the day's rate | Add `amount_currency, currency` to `journal_lines`, filled by every section |
| F-B3 | Journal line id | lines have no id | `<entry id>:L<index>` | `journal_lines.id` (PK), referenced by matches |
| F-B4 | `bank_statements`, `bank_statement_lines` | — | statement `(bank_account_id, file_name, start_date, end_date, closing_balance, skipped_duplicates, imported_by)`, lines `(statement_id, date, description, reference, amount signed, balance, dedupe_key)` | Two tables; index `(bank_account_id, dedupe_key)` |
| F-B5 | EOSB provision | account 2500 | **Done:** monthly `Dr 6120 (per department) / Cr 2500` from the HR gratuity calculator (services/financeEosb.ts; opening Dr 3300 / Cr 2500 at the first fiscal year); `fin.eosbPeriods (kind opening · month, month, date, status, entry_id, rows [{employee_id, department_id, target, charge}])`, `fin.eosbUses (employee_id, settlement_id, date, amount, gratuity)`; settlement Dr 2500 (provision used) + only the difference to 6120 | `eosb_provisions (company_id, month UNIQUE, entry_id, status)` + `eosb_provision_lines (provision_id, employee_id, department_id, target, charge)`; `final_settlements.eosb_provision_used` |
| F-B6 | `bank_matches` | — | `(bank_account_id, statement_line_ids[], journal_line_ids[], kind manual · auto · created, amount, reconciliation_id)` | `bank_matches` + `bank_match_lines` |
| F-B7 | `bank_reconciliations` | — | `(bank_account_id, statement_date, statement_balance, cleared_balance, difference, status finished · undone, match_ids, journal_line_ids, finished_by/at, undone_by/at)` | New table; `journal_lines.reconciliation_id` for the reversal lock |
| F-B8 | `bank_rules` | — | `(name, contains, direction any · in · out, account_id, bank_account_id null, active)` | New table |
| F-B9 | `bank_transfers` | — | `(number, date, from/to bank_account_id, amount_from, amount_to, fee, fx_difference, reference, memo, status, journal_entry_id, void_journal_entry_id)`; source `bank` | New table; add `bank_transfer` to the journal source enum |
| F-B10 | Payroll postings | — | `payroll_postings (kind run · loan · settlement, source_id, status, entry_id, payment_entry_id, reversed / reversal entry ids, paid_from_account_id, note)` | Columns on `payroll_runs` (`accrual_entry_id, payment_entry_id, paid_from_account_id`), `payroll_loans.disbursement_entry_id`, `final_settlements.journal_entry_id` |
| F-B11 | Payroll adjustment source | `payroll_adjustments` | `source_ref` (`commission:<id>`, `claim:<id>`), kind `commission` | `source_type, source_id` with a UNIQUE index (idempotent push) |
| F-B12 | `commission_plans` | — | `(name, basis, rate, tiers jsonb, cap_per_month, clawback, roles[], user_ids[], effective_from, active)` | New table (+ `commission_plan_members`) |
| F-B13 | `commission_statements` | — | `(number, user_id, month, plan_id, basis, currency, achievement, rate, base_total, gross, capped, clawback, total, status, lines jsonb, approvals jsonb, rejected_reason, journal_entry_id, payroll_adjustment_id, payroll_month)` | + `commission_statement_lines`; UNIQUE `(company_id, user_id, month)` among non-rejected |
| F-B14 | Journal source of commissions | enum has no `commission` | posted as source `payroll` (`source_id` CST-) | Add `commission` to the enum |
| F-B15 | Invoice paid date | — | latest active payment allocation date | `invoices.paid_at` |
| F-B16 | Reverse lock scope | — | enforced on manual reversal, transfer void and payroll reopen; payment / bill voids of other sections don't check it yet | Enforce in the ledger's `reverseJournal` for every source |

### Design gaps › Finance (financial statements, year-end close)

Statements section (`data/financeStatements.ts`; services `financeStatements.ts`, pure `modules/finance/statements/calc.ts`).
Statements are computed from `journal_entries` / `journal_lines` only; nothing is stored except the close records.
Proposal; company-scoped, FKs to the same company.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-S1 | `fiscal_year_closes` | — | `fin.yearEndCloses`: `id (YEC-<n>), fiscal_year_start, fiscal_year_end, status (closed · reopened), net_profit, journal_entry_id (null when nothing to close), previous_lock_date, note, closed_at, closed_by, reopened_at, reopened_by, reopen_reason, reversal_entry_id` | New table; partial UNIQUE `(company_id, fiscal_year_end) WHERE status = 'closed'`; FKs to `journal_entries` |
| F-S2 | Journal source `year_end_close` | `journal_entries.source_type` enum | added to `JournalSourceType` (contract `modules/finance/types.ts`); `source_id` = the close id; the re-open reversal keeps the same source | Add `year_end_close` to the enum; statements exclude it from P&L by source type |
| F-S3 | Statement line classification | `accounts.subtype` free text | P&L / balance sheet / cash flow sections come from `subtype` (`operating_income`, `other_income`, `cost_of_sales`, `operating_expense`, `other_expense`, `current_asset`, `fixed_asset`, `current_liability`, `non_current_liability`, `equity`); cash-flow adjustments are recognised by account **name** (accumulated depreciation / amortisation, end-of-service / gratuity / provision) | CHECK constraint on `subtype` + a `cash_flow_class` column (`cash · adjustment · working_capital · investing · financing`) instead of name matching |
| F-S4 | Cash accounts | — | accounts under the header of the cash / default bank account + the cash roles (as the overview) | `accounts.is_cash` flag (or `bank_accounts.ledger_account_id`) |
| F-S5 | Fiscal year changes | `fiscal_year_start_month` editable | not blocked after a close (closed years keep their dates in `fiscal_year_closes`) | Refuse a start-month change while a closed year exists after the new boundary, or keep a `fiscal_years` table |
| F-S6 | Opening balances in the cash flow | — | `opening_balance` entries count in the opening cash, not as flows | Same rule in the reporting views |
| F-S7 | Report snapshots | — | statements are computed on request (no stored copies); exports are client-side (CSV / Excel / print) | Optional `report_snapshots` (frozen statements per closed year) for audit |

### Design gaps › Finance (profitability) and Reports (company performance, hub)

Profitability is computed from `journal_lines` dimensions, `time_entries`, contracts and invoices; only settings and hub
preferences are stored. Proposal; company-scoped.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-PR1 | `profitability_settings` | — | `fin.profitSettings`: `standard_hours_per_month (default 176), cash_alert_threshold (null = 3 months' avg expenses), overdue_receivables_alert_pct (default 30), updated_at, updated_by` | One row per company |
| F-PR2 | `invoices.department_id` / `journal_lines.department_id` on sales | missing | income lines without a department count for the project manager's department | Add `department_id` to invoices (default: the project's / owner's department) |
| F-PR3 | labour cost | — | allocation at read time (hours × contract pay ÷ standard hours), never stored | Optional `project_cost_snapshots (project_id, month, hours, labour_cost)` if month-end freezing is needed |
| F-PR4 | `bill_lines.budget_line_id` → `event_budget_lines` | design has no link | used to avoid double counting event costs | Keep the FK (nullable) |
| F-PR5 | `projects.value` / budget | missing | contract value → quotation net → won lead value | Add `projects.budget_amount` |
| R-H1 | `report_hub_prefs` | — | `reports.hubPrefs`: `(company_id, user_id), favourites text[], recent jsonb [{report_id, at}] (≤ 8)` | One row per user; report ids are catalog keys |
| R-P1 | scheduled e-mail of Company performance / profitability | — | `report_schedules.report_type` only accepts Sales reports | Extend `report_type` when the backend renders these reports |

### Design gaps › Finance (tax, budgets, cash-flow forecast)

Tax and planning sections (`data/financeTax.ts`, `data/financeBudgets.ts`; services `financeTax.ts`, `financeBudgets.ts`,
`financeForecast.ts`; pure `modules/finance/tax/calc.ts`, `modules/finance/planning/calc.ts`). VAT returns are computed
from `journal_entries` / `journal_lines` (+ document lines for categories); only filed snapshots, settings, budgets and
forecast assumptions are stored. Proposal; company-scoped, FKs to the same company.

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| F-T1 | `vat_returns` | — | `fin.vatReturns`: `id (VATR-<n>), period_key, label, frequency, from, to, status (draft · filed · paid), snapshot jsonb (boxes, totals, items, warnings, assumptions), counted_entry_ids[], filing_reference, filed_date, filed_at, filed_by, settlement_entry_id, credit_used_by, credit_from, paid_date, paid_at, paid_by, payment_account_id, payment_reference, payment_entry_id` | New table; UNIQUE `(company_id, from, to)`; `vat_return_entries (vat_return_id, journal_entry_id)` instead of the id array; snapshot as jsonb (immutable once filed) |
| F-T2 | `tax_settings` | — | `perTenant:fin.taxSettings`: `vat_frequency (monthly · quarterly), tracking_from, adjustments [{kind, year, lines[{label, amount}]}], updated_at, updated_by` | Columns on `finance_settings` + `tax_estimate_adjustments (kind, fiscal_year, label, amount)` |
| F-T3 | Journal sources `vat_return`, `tax_provision` | `journal_entries.source_type` enum | added to `JournalSourceType`; provisions use `source_id = '<kind>:<year>'` (not a row id) | Extend the enum; a `tax_provisions` table if provisions need their own rows |
| F-T4 | Accounts 2210 / 6960 | chart template | "VAT payable to tax authority" (2210) and "Corporate tax / Zakat expense" (6960) are created on first use, not seeded | Add both to the UAE / KSA chart templates and give them system roles (`vat_payable`, `tax_expense`) |
| F-T5 | Tax category per journal line | `journal_lines.tax_code` only on VAT lines | revenue / expense lines carry no tax code (bill lines do); categories come from the document lines | Set `tax_code` on every taxable line (and `tax_base`) so returns can be computed from the ledger alone |
| F-T6 | Customer / supplier tax location | `customers.emirate`; no country | UAE emirate falls back to the company's; KSA exports = zero-rated sales in a foreign currency | Add `customers.country` (+ `place_of_supply` on invoices); `bills.is_import`, `reverse_charge` flags for boxes 3 / 6 / 10 (UAE) and 8 / 9 (KSA) |
| F-T7 | `budgets` | — | `fin.budgets`: `id (BUD-<n>), fiscal_year, name, status (draft · approved), approved_by, approved_at, alert_marks[], history jsonb, created_by, created_at, updated_at` | New table; UNIQUE `(company_id, fiscal_year)`; `budget_alerts_sent (budget_id, key)` for the once-only marks |
| F-T8 | `budget_lines` | — | embedded `lines[{id (BL-<n>), department_id, account_id, months[12]}]` | New table `budget_lines (budget_id, department_id, account_id, month, amount)` (one row per month) or `amounts numeric[12]`; UNIQUE `(budget_id, department_id, account_id)`; FKs to `departments`, `accounts` |
| F-T9 | Department on revenue | `journal_lines.department_id` | invoices post revenue without a department, so revenue budgets show actual 0 | Same as F-PR2 (department on invoices) |
| F-T10 | `cash_forecast_settings` | — | `perTenant:fin.forecastSettings`: `probabilities {current, d1_30, d31_60, d61_90, d90_plus}, bounced_pdc_pct, inflow_adjust_pct, outflow_adjust_pct, minimum_cash, lines[{id (FCL-<n>), label, date, amount, recurrence}]` | Settings row + `cash_forecast_lines` table |
| F-T11 | Forecast inputs | — | payroll from the last run, expenses from a 3-month average, VAT from draft returns — computed at read time | No storage; optional `cash_forecast_snapshots` to compare forecast vs actual later |

### Design gaps › AI assistant (conversations, messages, proposals, usage, settings)

AI assistant section (`data/ai.ts`; services `ai.ts`, `aiTools.ts`, `aiNlu.ts`; tool schemas `modules/ai-agent/toolSchemas.ts`).
The design has no AI tables. Proposal; company-scoped, FKs to the same company; conversations and messages are
**per user** (every query filters `company_id` AND `user_id`; admins read only aggregates).

| # | Table / column | Design | Mock / API | Proposal |
|---|---|---|---|---|
| AI-1 | `ai_conversations` | — | `ai.conversations`: `id (AIC-<n>), user_id, title, focus {type, id} (the record the conversation is about), created_at, updated_at` | New table; index `(company_id, user_id, updated_at desc)`; `focus_type, focus_id` columns instead of json; soft delete optional (the mock deletes) |
| AI-2 | `ai_messages` | — | `ai.messages`: `id (AIM-<n>), conversation_id, user_id, role (user · assistant), content, language (en · ar), blocks jsonb, tool_calls jsonb, tool_results jsonb, context {type, id}, intent, created_at` | New table, FK `conversation_id` ON DELETE CASCADE; for the Claude backend also store the raw Messages API `content` blocks (tool_use / tool_result) so the history replays exactly; encrypt `content` at rest; retention policy per company (e.g. 12 months) |
| AI-3 | `ai_actions` | — | `ai.actions`: `id (AIA-<n>), conversation_id, message_id, user_id, tool, status (pending · confirmed · cancelled · failed), title, summary, record {type, id, label}, input jsonb, editable[], changes jsonb, choices jsonb, result jsonb, error, created_at, decided_at` | New table (proposals); the confirmed change itself lives in its own table (activities, tasks, quotations, leads) + `audit_log` entry `entity ai:<tool>`; add `audit_log.via` (`ai_assistant`) instead of the summary suffix |
| AI-4 | `ai_usage` | `usage_records` (billing) | `ai.usage`: `user_id, at, period_start, tools[]` per message (rate limit: 20 / user / minute; report by user / tool); the billing counter stays `period_counters.ai_credits` | New table `ai_usage (company_id, user_id, at, period_start, tools text[], input_tokens, output_tokens, cache_read_tokens)` — token columns for the Claude backend; index `(company_id, period_start)`, `(company_id, user_id, at)` |
| AI-5 | `ai_settings` | — | `perTenant:ai.settings`: `enabled, roles {<role>: {enabled, write_tools}}, tools {<tool>: bool}, updated_at, updated_by` | One row per company + `ai_role_settings (company_id, role, enabled, write_tools)` and `ai_tool_settings (company_id, tool, enabled)`; defaults: every tool on, write tools on for roles with a full / team / own sales or tasks scope |
| AI-6 | Id sequence | — | one counter `ai.seq` across companies (AIC- / AIM- / AIA- / AIT-) | UUIDs or bigint PKs in the backend; the prefixes are display only |
| AI-7 | AI credits per message | `plan_limits.ai_credits` | 1 credit per message, `402 LIMIT_REACHED` at the limit, warning at 80 % | Decide whether credits stay per message or become token-based (AI-4 token columns) before launch |

### Design gaps › Integrations

Insights & admin › Integrations (`src/shared/mocks/data/integrations.ts`; services `integrations.ts`,
`integrationsWhatsApp.ts`, `integrationsDeveloper.ts`, `integrationsCore.ts`; wire `src/shared/api/integrationsMappers.ts`;
API in `docs/API.md` › Integrations). The design has `integrations` (company_id, provider, label, status, `credentials`
encrypted, connected_by, last_synced_at; UNIQUE `(company_id, provider, label)`), `integration_sync_logs` and
`web_form_endpoints` only (see also IN-1, IN-2, M1–M3, G7). Everything below is company-scoped; credentials are
encrypted at rest and never selected into API resources.

| # | Need | Design | Mock / API | Proposal |
|---|---|---|---|---|
| I-1 | One row per connector | `integrations.provider` free text | perTenant `integrations.email` / `.whatsapp` / `.payments` + rows per ad account (M1) | Providers `smtp, google_workspace, microsoft_365` (email; IN-1 maps `google`/`microsoft`), `whatsapp_cloud`, `telr, tap, paytabs, stripe` (payments), `website_webhook`; `status connected · error · paused · disconnected`; `settings json` for non-secret config (SMTP host/port/security/username, from name/address, phone number id, WABA id, merchant id, mode, currency); `credentials_hint string(12)` |
| I-2 | Write-only credentials | `credentials` encrypted json | `integrations.secrets` map (`<co>\|<kind>\|<id>`), only hints served; isolation guard sweeps every response | Keep `credentials` encrypted (Laravel `encrypted:array`), add `credentials_hint`; never in `$visible` / resources; rotate = overwrite + audit |
| I-3 | Default payment gateway | — | `payments.default_provider` used by payment links (SEAM `registerPaymentGateway`) | `companies.default_payment_integration_id → integrations.id null` (or `integrations.is_default` + partial unique per company and kind) |
| I-4 | Email domain authentication | — | `email.dns[{ kind, type, host, value, status, checked_at, message }]` | `email_domains (company_id, domain, spf_status, dkim_status, dmarc_status, dkim_selector, checked_at)` UNIQUE `(company_id, domain)` |
| I-5 | Default sender per purpose | `branding.email_sender_*` (one sender) | `email.senders { sales, invoices, hr: { name, address } }`, addresses on the sending domain | `email_senders (company_id, purpose sales·invoices·hr, name, address)` UNIQUE `(company_id, purpose)` |
| I-6 | Unified email log | — (sends live on invoices `send_log`, dunning log, bulk recipients, activities) | `GET /integrations/email/log` derives rows from those + `integrations.emailTests` | Add the `messages` table of IN-2 for every outgoing email (`source_type`, `source_id`, `status queued·sent·failed·bounced`, `provider_message_id`) and read the log from it |
| I-7 | Website webhook token | `web_form_endpoints.secret_hash`, `public_key` | one token per company in `integrations.secrets` (`whk_…`), full URL shown to Company Admins, `rotated_at/by`, counters `received`, `leads_created`, `last_received_at`, `field_map`, `default_source`, `default_owner_id`, `paused` | A `web_form_endpoints` row with `kind = 'webhook'`: `token_encrypted` (or `secret_hash` + show once), `field_map json`, `default_source_id`, `default_owner_id`, `is_active`, `received_count`, `last_used_at`, `rotated_at`, `rotated_by` |
| I-8 | WhatsApp templates | `message_templates (type whatsapp)` — local text only | `integrations.waTemplates (name, language en·ar, category, body with {{n}}, status pending·approved·rejected, rejection_reason, submitted_at, decided_at)` | `whatsapp_templates (company_id, integration_id, name, language, category, body, status, rejection_reason, provider_template_id, submitted_at, decided_at)` UNIQUE `(integration_id, name, language)` |
| I-9 | WhatsApp conversations | `messages` (IN-2) | `integrations.waConversations (from, name, lead_id, messages[{ direction, text, at }])` | `whatsapp_conversations (company_id, integration_id, wa_id/phone, lead_id null, last_message_at)` + `messages` rows (`channel whatsapp`, `direction`, `external_id`) |
| I-10 | Per-user calendar connection | — | `integrations.calendar (user_id, provider google·outlook, connected_as, token_hint, push_tasks, push_meetings, show_busy, last_sync_at, pushed_count)` | `user_calendar_connections (company_id, user_id UNIQUE, provider, account_email, credentials encrypted, credentials_hint, settings json, last_synced_at, sync_token)` + `calendar_event_links (task_id/activity_id, external_event_id)` for two-way updates |
| I-11 | OAuth state | — | `integrations.oauthStates (state, user_id, purpose, provider, account, expires_at)` | Cache / short-lived table `oauth_states` (state hash, user_id, company_id, purpose, provider, code_verifier encrypted, expires_at) |
| I-12 | API keys | — | `integrations.apiKeys (name, prefix, last4, hash, scopes { module: none·read·write }, created_by, last_used_at, revoked_at/by)` | `api_keys (company_id, name, prefix, last4, key_hash char(64) UNIQUE, scopes json, created_by, last_used_at, revoked_at, revoked_by)` |
| I-13 | Outgoing webhooks | — | `integrations.webhooks (url, events[], active, secret_hint, events_from)` | `webhook_endpoints (company_id, url, events json, is_active, secret_encrypted, secret_hint, created_by)` |
| I-14 | Webhook deliveries | — | `integrations.deliveries (endpoint_id, event, event_key, payload, signature, status success·retrying·failed, attempts, response_code, error, next_retry_at)`; events produced by a pump over leads / status history / invoices / payments / employees | `webhook_events` (transactional outbox: company_id, event, subject_type, subject_id, payload, created_at) + `webhook_deliveries (endpoint_id, webhook_event_id, status, attempts, response_code, error, next_retry_at)` UNIQUE `(endpoint_id, webhook_event_id)` |
| I-15 | Sync log | `integration_sync_logs (direction, status success·failed·partial, records_count, error_message, started_at, finished_at)` | `integrations.syncLog (integration, direction inbound·outbound·internal, status success·warning·error, message)` | Add `integration_key` (or FK) for connectors without an `integrations` row (api keys, webhooks, calendar), direction `internal`, status `warning`; `message` text |
| I-16 | Once-only failure notification | `notifications` | `integrations.notified` keys `<co>\|<integration>\|<company day>`; one notification per Company Admin | `notification_dedupe (company_id, key)` UNIQUE, or a unique `dedupe_key` on `notifications` |
| I-17 | Paused state | — | email / whatsapp / website flags, webhooks `integrations.paused` | `integrations.status = paused` (and `webhook_endpoints.is_active`) |
| I-18 | Rate limits of the public endpoints | — | `integrations.webhookHits`, `integrations.apiHits` (not company data) | Laravel `RateLimiter` (cache), no table |
