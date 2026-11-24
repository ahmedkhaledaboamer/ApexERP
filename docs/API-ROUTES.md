# Apex CRM: route index (generated)

Every route the MSW mock serves (`src/shared/mocks/handlers/`), **942 routes** (940 `http.*`
registrations; the PDC `deposit` / `clear` / `bounce` actions are one registration). Grouped by the `docs/API.md`
section that documents each route; the link goes to the exact subsection. Request / response shapes, permissions,
rules and error codes are in that section; this file is the checklist. Paths are relative to the API base
(`VITE_API_URL`, default `/api`).

Documented in docs/API.md: **942 / 942**. Routes marked in the *Production* column must not
be implemented as-is (see API.md › Production boundary).

Regenerate after adding or removing a handler (the extraction is a small Node script over the handler files, the
isolation coverage table and the services; it is not part of the repo). The authoritative list of routes is
`src/shared/mocks/isolation/endpoints.ts`: `npm run test:isolation` fails when a handler is missing from it.

## Columns

- **Kind**: the route's entry in the isolation coverage table (`src/shared/mocks/isolation/*Endpoints.ts`), i.e. how
  it is tenant-scoped (docs/TESTING.md › What each kind means):
  - `company-list`: GET of the caller's company rows / state; only own rows, counts equal an own recomputation.
  - `company-item`: an owned id in the path; another company's id answers exactly like a missing one (`404`, same body).
  - `company-write`: create / update / action without an owned path id; spoofed `company_id` / `tenant_id` / headers ignored.
  - `company-search`: duplicate checks, pickers, import checks; scoped per company.
  - `company-export`: exports, reports, dashboards; numbers equal an own-company recomputation.
  - `public`: no session by design (the token / key / subdomain in the request selects the company).
  - `auth`: sign-in endpoints (no session yet). `platform`: `/platform/*`, platform token only.
  - `dev`: mock-only; never implement.
  Every `company-*` route also requires a session (`401` without), answers `401` to platform tokens and
  `403 tenant_mismatch` when `X-Workspace` names another company.
- **Module**: the `module` label of the isolation entry (plan module / permission area it belongs to).
- **Handler**: file and line in `src/shared/mocks/handlers/`.

Kinds: `company-item` 462 · `company-list` 177 · `company-write` 167 · `company-export` 61 · `public` 26 · `platform` 24 · `company-search` 13 · `dev` 8 · `auth` 4.

## Contents

- [Multi-tenancy (read first)](#multi-tenancy-read-first) (5)
- [Auth](#auth) (6)
- [Leads](#leads) (18)
- [Sales targets](#sales-targets) (5)
- [Dashboard](#dashboard) (1)
- [Services](#services) (14)
- [CRM](#crm) (9)
- [Quotations](#quotations) (8)
- [Reports](#reports) (10)
- [Lookups & automation](#lookups--automation) (7)
- [My account](#my-account) (2)
- [Settings: users](#settings-users) (7)
- [Settings: security](#settings-security) (11)
- [Settings: templates](#settings-templates) (8)
- [Settings: company profile](#settings-company-profile) (2)
- [Settings: branding](#settings-branding) (3)
- [Self-service sign-up (public)](#self-service-sign-up-public) (8)
- [Subscription, roles, email connection](#subscription-roles-email-connection) (4)
- [Plans, limits and subscription lifecycle](#plans-limits-and-subscription-lifecycle) (24)
- [Super-Admin Console (platform)](#super-admin-console-platform) (29)
- [Onboarding](#onboarding) (6)
- [Departments](#departments) (11)
- [The Won flow](#the-won-flow) (1)
- [Tasks](#tasks) (10)
- [Projects](#projects) (4)
- [Events](#events) (100)
- [Marketing](#marketing) (82)
- [HR](#hr) (245)
- [Finance](#finance) (242)
- [AI assistant](#ai-assistant) (11)
- [Integrations](#integrations) (49)
- [Error code catalog](#error-code-catalog)

## Multi-tenancy (read first)

API.md: [Multi-tenancy (read first)](API.md#multi-tenancy-read-first)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/tenant` | company-list | regional/branding | [Multi-tenancy (read first)](API.md#multi-tenancy-read-first) |  | auth.ts:39 |
| POST | `/public/signup` | public | onboarding | [Multi-tenancy (read first)](API.md#multi-tenancy-read-first) |  | companyProfile.ts:54 |
| GET | `/public/workspaces/:subdomain` | public | auth | [Multi-tenancy (read first)](API.md#multi-tenancy-read-first) |  | auth.ts:41 |
| GET | `/auth/dev/accounts` | dev | auth | [Multi-tenancy (read first)](API.md#multi-tenancy-read-first) | dev only: never implement | auth.ts:45 |
| POST | `/auth/dev/sign-in` | dev | auth | [Multi-tenancy (read first)](API.md#multi-tenancy-read-first) | dev only: never implement | auth.ts:46 |

## Auth

API.md: [Auth](API.md#auth)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| POST | `/auth/login` | auth | auth | [Auth](API.md#auth) |  | auth.ts:21 |
| POST | `/auth/login/2fa` | auth | auth | [Auth](API.md#auth) |  | auth.ts:25 |
| POST | `/auth/refresh` | auth | auth | [Auth](API.md#auth) |  | auth.ts:30 |
| GET | `/auth/me` | company-list | auth | [Auth](API.md#auth) |  | auth.ts:38 |
| POST | `/auth/switch-role` | company-write | auth | [Auth](API.md#auth) | demo: omit | auth.ts:34 |
| GET | `/users` | company-list | auth | [Auth](API.md#auth) |  | auth.ts:42 |

## Leads

API.md: [Leads](API.md#leads)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/leads` | company-list | leads | [Leads](API.md#leads) |  | leads.ts:39 |
| POST | `/leads` | company-write | leads | [Leads](API.md#leads) |  | leads.ts:40 |
| GET | `/leads/duplicates` | company-search | leads | [Leads](API.md#leads) |  | leads.ts:24 |
| GET | `/leads/owners` | company-search | leads | [Leads](API.md#leads) |  | leads.ts:38 |
| GET | `/leads/:id` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:44 |
| PATCH | `/leads/:id` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:45 |
| PATCH | `/leads/:id/stage` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:49 |
| POST | `/leads/:id/won` | company-item | won flow | [Leads](API.md#leads) |  | won.ts:16 |
| PATCH | `/leads/:id/do-not-contact` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:53 |
| GET | `/leads/:id/activities` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:57 |
| POST | `/leads/:id/activities` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:60 |
| GET | `/leads/:id/notes` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:64 |
| POST | `/leads/:id/notes` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:67 |
| POST | `/leads/:id/messages` | company-item | messages | [Leads](API.md#leads) |  | messages.ts:10 |
| GET | `/leads/:id/tasks` | company-item | leads | [Leads](API.md#leads) |  | leads.ts:71 |
| GET | `/tasks` | company-list | tasks | [Leads](API.md#leads) |  | tasks.ts:28 |
| POST | `/leads/import/check` | company-search | imports | [Leads](API.md#leads) |  | leadImport.ts:9 |
| POST | `/leads/import` | company-write | imports | [Leads](API.md#leads) |  | leadImport.ts:15 |

## Sales targets

API.md: [Sales targets](API.md#sales-targets)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/targets` | company-list | targets | [Sales targets](API.md#sales-targets) |  | targets.ts:18 |
| PUT | `/targets/:userId` | company-item | targets | [Sales targets](API.md#sales-targets) |  | targets.ts:19 |
| DELETE | `/targets/:userId` | company-item | targets | [Sales targets](API.md#sales-targets) |  | targets.ts:23 |
| GET | `/targets/defaults` | company-list | targets | [Sales targets](API.md#sales-targets) |  | targets.ts:13 |
| PUT | `/targets/defaults` | company-write | targets | [Sales targets](API.md#sales-targets) |  | targets.ts:14 |

## Dashboard

API.md: [Dashboard](API.md#dashboard)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/dashboard/summary` | company-export | dashboard | [Dashboard](API.md#dashboard) |  | dashboard.ts:8 |

## Services

API.md: [Services](API.md#services)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/services` | company-list | services/packages | [Services](API.md#services) |  | services.ts:38 |
| POST | `/services` | company-write | services/packages | [Services](API.md#services) |  | services.ts:39 |
| GET | `/services/:id` | company-item | services/packages | [Services](API.md#services) |  | services.ts:43 |
| PATCH | `/services/:id` | company-item | services/packages | [Services](API.md#services) |  | services.ts:44 |
| POST | `/services/:id/deactivate` | company-item | services/packages | [Services](API.md#services) |  | services.ts:48 |
| POST | `/services/:id/reactivate` | company-item | services/packages | [Services](API.md#services) |  | services.ts:51 |
| GET | `/services/:id/project-template` | company-item | services/packages | [Services](API.md#services) |  | services.ts:54 |
| PUT | `/services/:id/project-template` | company-item | services/packages | [Services](API.md#services) |  | services.ts:57 |
| GET | `/services/packages` | company-list | services/packages | [Services](API.md#services) |  | services.ts:21 |
| POST | `/services/packages` | company-write | services/packages | [Services](API.md#services) |  | services.ts:22 |
| GET | `/services/packages/:id` | company-item | services/packages | [Services](API.md#services) |  | services.ts:26 |
| PATCH | `/services/packages/:id` | company-item | services/packages | [Services](API.md#services) |  | services.ts:27 |
| POST | `/services/packages/:id/deactivate` | company-item | services/packages | [Services](API.md#services) |  | services.ts:31 |
| POST | `/services/packages/:id/reactivate` | company-item | services/packages | [Services](API.md#services) |  | services.ts:34 |

## CRM

API.md: [CRM](API.md#crm)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/customers` | company-list | customers | [CRM](API.md#crm) |  | crm.ts:11 |
| GET | `/customers/:id` | company-item | customers | [CRM](API.md#crm) |  | crm.ts:12 |
| PATCH | `/customers/:id` | company-item | customers | [CRM](API.md#crm) |  | crm.ts:15 |
| GET | `/contacts` | company-list | contacts | [CRM](API.md#crm) |  | crm.ts:21 |
| POST | `/contacts` | company-write | contacts | [CRM](API.md#crm) |  | crm.ts:22 |
| PATCH | `/contacts/:id` | company-item | contacts | [CRM](API.md#crm) |  | crm.ts:26 |
| GET | `/contracts` | company-list | contracts | [CRM](API.md#crm) |  | crm.ts:31 |
| POST | `/contracts` | company-write | contracts | [CRM](API.md#crm) |  | crm.ts:32 |
| PATCH | `/contracts/:id` | company-item | contracts | [CRM](API.md#crm) |  | crm.ts:36 |

## Quotations

API.md: [Quotations](API.md#quotations)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/quotations` | company-list | quotations | [Quotations](API.md#quotations) |  | quotations.ts:11 |
| GET | `/quotations/:id` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:19 |
| POST | `/quotations` | company-write | quotations | [Quotations](API.md#quotations) |  | quotations.ts:15 |
| PATCH | `/quotations/:id` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:22 |
| POST | `/quotations/:id/send` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:26 |
| POST | `/quotations/:id/status` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:29 |
| POST | `/quotations/:id/viewed` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:34 |
| POST | `/quotations/:id/duplicate` | company-item | quotations | [Quotations](API.md#quotations) |  | quotations.ts:37 |

## Reports

API.md: [Reports](API.md#reports)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/reports/sales` | company-export | reports | [Reports](API.md#reports) |  | reports.ts:17 |
| POST | `/reports/custom` | company-export | reports | [Reports](API.md#reports) |  | reports.ts:28 |
| GET | `/reports/schedules` | company-list | reports | [Reports](API.md#reports) |  | reports.ts:31 |
| POST | `/reports/schedules` | company-write | reports | [Reports](API.md#reports) |  | reports.ts:32 |
| DELETE | `/reports/schedules/:id` | company-item | reports | [Reports](API.md#reports) |  | reports.ts:35 |
| GET | `/reports/performance` | company-export | reports/performance | [Company performance](API.md#company-performance) |  | reportsPerformance.ts:20 |
| GET | `/reports/hub` | company-list | reports/hub | [Reports hub](API.md#reports-hub) |  | reportsPerformance.ts:26 |
| PUT | `/reports/hub/favourites/:reportId` | company-item | reports/hub | [Reports hub](API.md#reports-hub) |  | reportsPerformance.ts:27 |
| DELETE | `/reports/hub/favourites/:reportId` | company-item | reports/hub | [Reports hub](API.md#reports-hub) |  | reportsPerformance.ts:30 |
| POST | `/reports/hub/recent` | company-write | reports/hub | [Reports hub](API.md#reports-hub) |  | reportsPerformance.ts:33 |

## Lookups & automation

API.md: [Lookups & automation](API.md#lookups--automation)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/lookups` | company-list | settings lists | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:9 |
| PUT | `/lookups/:list` | company-item | settings lists | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:10 |
| GET | `/alerts` | company-list | notifications/alerts | [Lookups & automation](API.md#lookups--automation) |  | alerts.ts:6 |
| GET | `/settings/automation` | company-list | automation rules | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:17 |
| PUT | `/settings/automation` | company-write | automation rules | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:18 |
| POST | `/settings/automation/reset` | company-write | automation rules | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:22 |
| GET | `/audit-log` | company-list | audit log | [Lookups & automation](API.md#lookups--automation) |  | settings.ts:23 |

## My account

API.md: [My account](API.md#my-account)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/account` | company-list | account/security | [My account](API.md#my-account) |  | account.ts:15 |
| POST | `/account/password` | company-write | account/security | [My account](API.md#my-account) |  | account.ts:16 |

## Settings: users

API.md: [Settings: users](API.md#settings-users)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/settings/users` | company-list | settings users | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:16 |
| GET | `/departments` | company-list | departments | [Settings: users](API.md#settings-users) |  | departments.ts:25 |
| GET | `/settings/departments` | company-list | departments | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:17 |
| POST | `/settings/users` | company-write | settings users | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:18 |
| PATCH | `/settings/users/:id` | company-item | settings users | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:22 |
| POST | `/settings/users/:id/deactivate` | company-item | settings users | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:26 |
| POST | `/settings/users/:id/reactivate` | company-item | settings users | [Settings: users](API.md#settings-users) |  | settingsUsers.ts:40 |

## Settings: security

API.md: [Settings: security](API.md#settings-security)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/security/2fa` | company-list | account/security | [Settings: security](API.md#settings-security) |  | security.ts:16 |
| POST | `/security/2fa/setup` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:17 |
| POST | `/security/2fa/verify` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:18 |
| POST | `/security/2fa/disable` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:22 |
| GET | `/security/sessions` | company-list | account/security | [Settings: security](API.md#settings-security) |  | security.ts:26 |
| DELETE | `/security/sessions/:id` | company-item | account/security | [Settings: security](API.md#settings-security) |  | security.ts:28 |
| POST | `/security/sessions/revoke-others` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:27 |
| GET | `/security/backups` | company-list | account/security | [Settings: security](API.md#settings-security) |  | security.ts:31 |
| POST | `/security/backups/run` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:32 |
| GET | `/security/policy` | company-list | account/security | [Settings: security](API.md#settings-security) |  | security.ts:33 |
| PUT | `/security/policy` | company-write | account/security | [Settings: security](API.md#settings-security) |  | security.ts:34 |

## Settings: templates

API.md: [Settings: templates](API.md#settings-templates)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/templates` | company-list | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:10 |
| GET | `/templates/:id` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:20 |
| POST | `/templates` | company-write | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:21 |
| PATCH | `/templates/:id` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:25 |
| POST | `/templates/:id/duplicate` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:29 |
| POST | `/templates/:id/default` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:32 |
| POST | `/templates/:id/deactivate` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:35 |
| POST | `/templates/:id/reactivate` | company-item | message templates | [Settings: templates](API.md#settings-templates) |  | templates.ts:38 |

## Settings: company profile

API.md: [Settings: company profile](API.md#settings-company-profile)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/settings/company-profile` | company-list | company profile | [Settings: company profile](API.md#settings-company-profile) |  | companyProfile.ts:21 |
| PATCH | `/settings/company-profile` | company-write | company profile | [Settings: company profile](API.md#settings-company-profile) |  | companyProfile.ts:22 |

## Settings: branding

API.md: [Settings: branding](API.md#settings-branding)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/settings/branding` | company-list | branding | [Settings: branding](API.md#settings-branding) |  | branding.ts:8 |
| PATCH | `/settings/branding` | company-write | branding | [Settings: branding](API.md#settings-branding) |  | branding.ts:9 |
| POST | `/settings/branding/reset` | company-write | branding | [Settings: branding](API.md#settings-branding) |  | branding.ts:15 |

## Self-service sign-up (public)

API.md: [Self-service sign-up (public)](API.md#self-service-sign-up-public)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/public/plans` | public | billing | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:50 |
| GET | `/public/signup/availability` | public | onboarding | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:51 |
| GET | `/public/signup/:id` | public | onboarding | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:58 |
| POST | `/public/signup/:id/resend` | public | onboarding | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:59 |
| POST | `/public/signup/:id/verify` | public | onboarding | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:60 |
| POST | `/public/checkout` | public | billing | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:69 |
| POST | `/public/signup/:id/complete` | public | onboarding | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:64 |
| POST | `/public/contact-sales` | public | billing | [Self-service sign-up (public)](API.md#self-service-sign-up-public) |  | companyProfile.ts:73 |

## Subscription, roles, email connection

API.md: [Subscription, roles, email connection](API.md#subscription-roles-email-connection)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/settings/roles` | company-list | company profile | [Subscription, roles, email connection](API.md#subscription-roles-email-connection) |  | companyProfile.ts:26 |
| GET | `/settings/email-connection` | company-list | integrations/email | [Subscription, roles, email connection](API.md#subscription-roles-email-connection) |  | companyProfile.ts:27 |
| POST | `/settings/email-connection` | company-write | integrations/email | [Subscription, roles, email connection](API.md#subscription-roles-email-connection) |  | companyProfile.ts:28 |
| DELETE | `/settings/email-connection` | company-write | integrations/email | [Subscription, roles, email connection](API.md#subscription-roles-email-connection) |  | companyProfile.ts:32 |

## Plans, limits and subscription lifecycle

API.md: [Plans, limits and subscription lifecycle](API.md#plans-limits-and-subscription-lifecycle)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/billing/entitlements` | company-list | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:18 |
| GET | `/billing/overview` | company-list | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:19 |
| POST | `/billing/change-plan` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:20 |
| DELETE | `/billing/scheduled-change` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:28 |
| POST | `/billing/payment-method` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:29 |
| POST | `/billing/cancel` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:33 |
| POST | `/billing/resume` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:34 |
| POST | `/billing/reactivate` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:35 |
| GET | `/billing/export` | company-export | exports | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:39 |
| POST | `/ai/credits/consume` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) | not called by the client: internal | billing.ts:42 |
| GET | `/finance/invoices` | company-list | finance/invoices | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | financeInvoices.ts:28 |
| GET | `/hr/employees` | company-list | hr | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | hrPeople.ts:45 |
| GET | `/integrations` | company-list | integrations | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | integrations.ts:23 |
| POST | `/billing/trial-plan` | company-write | billing/usage | [Plans, limits and subscription lifecycle › Endpoints](API.md#endpoints) |  | billing.ts:24 |
| POST | `/tasks/:id/attachments` | company-item | tasks | [Limits (enforced by the API)](API.md#limits-enforced-by-the-api) |  | tasks.ts:51 |
| POST | `/ai/conversations/:id/messages` | company-item | ai | [Limits (enforced by the API)](API.md#limits-enforced-by-the-api) |  | ai.ts:40 |
| PATCH | `/alerts/:id/read` | company-item | notifications/alerts | [Request policy (every authenticated request, in `userFrom`)](API.md#request-policy-every-authenticated-request-in-userfrom) |  | alerts.ts:8 |
| POST | `/alerts/read-all` | company-write | notifications/alerts | [Request policy (every authenticated request, in `userFrom`)](API.md#request-policy-every-authenticated-request-in-userfrom) |  | alerts.ts:7 |
| GET | `/dev/billing/state` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:9 |
| POST | `/dev/billing/advance` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:10 |
| POST | `/dev/billing/status` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:14 |
| POST | `/dev/billing/fail-next-payment` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:18 |
| POST | `/dev/billing/usage` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:22 |
| POST | `/dev/billing/reset` | dev | billing/usage | [Dev only (mock; loaded with a dynamic import only when `import.meta.env.DEV`, so not in the production bundle)](API.md#dev-only-mock-loaded-with-a-dynamic-import-only-when-importmetaenvdev-so-not-in-the-production-bundle) | dev only: never implement | devBilling.ts:26 |

## Super-Admin Console (platform)

API.md: [Super-Admin Console (platform)](API.md#super-admin-console-platform)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| POST | `/platform/auth/login` | auth | platform | [Super-Admin Console (platform) › Auth](API.md#auth-1) |  | auth.ts:52 |
| GET | `/platform/me` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:20 |
| GET | `/platform/companies` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:23 |
| GET | `/platform/companies/:id` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:38 |
| GET | `/platform/companies/:id/users` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:41 |
| GET | `/platform/companies/:id/timeline` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:44 |
| GET | `/platform/companies/:id/notes` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:47 |
| POST | `/platform/companies/:id/notes` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:50 |
| POST | `/platform/companies/:id/actions` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:54 |
| POST | `/platform/companies/:id/modules` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:60 |
| GET | `/platform/subdomains/check` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:68 |
| POST | `/platform/companies/:id/subdomain` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:64 |
| GET | `/platform/overview` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:77 |
| GET | `/platform/plans` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:78 |
| POST | `/platform/plans` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:79 |
| PATCH | `/platform/plans/:id` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:83 |
| DELETE | `/platform/plans/:id` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:88 |
| GET | `/platform/settings` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:94 |
| PATCH | `/platform/settings` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:95 |
| GET | `/announcements` | company-list | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:114 |
| GET | `/platform/announcements` | platform | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:101 |
| POST | `/platform/announcements` | platform | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:102 |
| PATCH | `/platform/announcements/:id` | platform | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:106 |
| DELETE | `/platform/announcements/:id` | platform | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:110 |
| GET | `/platform/audit` | platform | audit log | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:120 |
| POST | `/platform/impersonations` | platform | platform | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:137 |
| POST | `/announcements/:id/dismiss` | company-item | announcements | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | platform.ts:115 |
| POST | `/auth/impersonation/write-mode` | company-write | account/security | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | auth.ts:64 |
| POST | `/auth/impersonation/stop` | company-write | account/security | [Super-Admin Console (platform) › Endpoints](API.md#endpoints-1) |  | auth.ts:58 |

## Onboarding

API.md: [Onboarding](API.md#onboarding)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/onboarding` | company-list | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:34 |
| POST | `/onboarding/items/:id/complete` | company-item | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:41 |
| PATCH | `/onboarding/items/:id` | company-item | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:44 |
| POST | `/onboarding/dismiss` | company-write | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:39 |
| POST | `/onboarding/restore` | company-write | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:40 |
| PATCH | `/onboarding` | company-write | onboarding | [Onboarding](API.md#onboarding) |  | companyProfile.ts:35 |

## Departments

API.md: [Departments](API.md#departments)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/departments/org-chart` | company-list | departments | [Departments](API.md#departments) |  | departments.ts:20 |
| GET | `/departments/:id` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:33 |
| POST | `/departments` | company-write | departments | [Departments](API.md#departments) |  | departments.ts:29 |
| PATCH | `/departments/:id` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:34 |
| POST | `/departments/:id/deactivate` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:38 |
| POST | `/departments/:id/reactivate` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:41 |
| POST | `/departments/move-members` | company-write | departments | [Departments](API.md#departments) |  | departments.ts:21 |
| PATCH | `/departments/:id/members/:userId` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:44 |
| POST | `/departments/:id/goals` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:48 |
| PATCH | `/departments/:id/goals/:goalId` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:52 |
| DELETE | `/departments/:id/goals/:goalId` | company-item | departments | [Departments](API.md#departments) |  | departments.ts:56 |

## The Won flow

API.md: [The Won flow](API.md#the-won-flow)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| POST | `/leads/:id/won/preview` | company-item | won flow | [The Won flow](API.md#the-won-flow) |  | won.ts:12 |

## Tasks

API.md: [Tasks](API.md#tasks)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/tasks/assignable` | company-search | tasks | [Tasks](API.md#tasks) |  | tasks.ts:32 |
| GET | `/tasks/:id` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:33 |
| POST | `/tasks` | company-write | tasks | [Tasks](API.md#tasks) |  | tasks.ts:34 |
| PATCH | `/tasks/:id` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:38 |
| POST | `/tasks/:id/block` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:42 |
| POST | `/tasks/:id/unblock` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:46 |
| POST | `/tasks/:id/comments` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:47 |
| DELETE | `/tasks/:id/attachments/:attachmentId` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:55 |
| POST | `/tasks/:id/time-entries` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:58 |
| DELETE | `/tasks/:id/time-entries/:entryId` | company-item | tasks | [Tasks](API.md#tasks) |  | tasks.ts:62 |

## Projects

API.md: [Projects](API.md#projects)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/projects` | company-list | projects | [Projects](API.md#projects) |  | projects.ts:10 |
| GET | `/projects/:id` | company-item | projects | [Projects](API.md#projects) |  | projects.ts:15 |
| POST | `/projects` | company-write | projects | [Projects](API.md#projects) |  | projects.ts:11 |
| PATCH | `/projects/:id` | company-item | projects | [Projects](API.md#projects) |  | projects.ts:16 |

## Events

API.md: [Events](API.md#events)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/events` | company-list | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:39 |
| POST | `/events` | company-write | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:45 |
| GET | `/events/:id` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:50 |
| PATCH | `/events/:id` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:51 |
| DELETE | `/events/:id` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:55 |
| POST | `/events/:id/team` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:57 |
| DELETE | `/events/:id/team/:userId` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:61 |
| GET | `/events/:id/attendees` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:67 |
| POST | `/events/:id/attendees` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:73 |
| PATCH | `/events/:id/attendees/:attendeeId` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:77 |
| DELETE | `/events/:id/attendees/:attendeeId` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:81 |
| POST | `/events/:id/attendees/import` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:69 |
| POST | `/events/:id/attendees/:attendeeId/check-in` | company-item | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:84 |
| GET | `/events/:id/stats` | company-export | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:65 |
| GET | `/public/events/:token` | public | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:90 |
| POST | `/public/events/:token/register` | public | events | [Events › Endpoints](API.md#endpoints-2) |  | events.ts:91 |
| GET | `/event-templates` | company-list | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:54 |
| POST | `/event-templates` | company-write | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:55 |
| GET | `/event-templates/:id` | company-item | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:59 |
| PATCH | `/event-templates/:id` | company-item | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:60 |
| DELETE | `/event-templates/:id` | company-item | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:64 |
| POST | `/events/:id/apply-template` | company-item | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:66 |
| GET | `/events/:id/checklist` | company-item | events | [Templates & prep checklist](API.md#templates--prep-checklist) |  | eventsAdvanced.ts:65 |
| GET | `/events/:id/agenda` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:72 |
| POST | `/events/:id/sessions` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:73 |
| PATCH | `/events/:id/sessions/:sessionId` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:77 |
| DELETE | `/events/:id/sessions/:sessionId` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:81 |
| POST | `/events/:id/speakers` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:82 |
| PATCH | `/events/:id/speakers/:speakerId` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:86 |
| DELETE | `/events/:id/speakers/:speakerId` | company-item | events | [Agenda & speakers](API.md#agenda--speakers) |  | eventsAdvanced.ts:90 |
| GET | `/events/:id/ticket-types` | company-item | events | [Tickets, capacity, waitlist & questions](API.md#tickets-capacity-waitlist--questions) |  | eventsAdvanced.ts:93 |
| POST | `/events/:id/ticket-types` | company-item | events | [Tickets, capacity, waitlist & questions](API.md#tickets-capacity-waitlist--questions) |  | eventsAdvanced.ts:94 |
| PATCH | `/events/:id/ticket-types/:ticketTypeId` | company-item | events | [Tickets, capacity, waitlist & questions](API.md#tickets-capacity-waitlist--questions) |  | eventsAdvanced.ts:98 |
| DELETE | `/events/:id/ticket-types/:ticketTypeId` | company-item | events | [Tickets, capacity, waitlist & questions](API.md#tickets-capacity-waitlist--questions) |  | eventsAdvanced.ts:102 |
| POST | `/events/:id/attendees/:attendeeId/cancel` | company-item | events | [Tickets, capacity, waitlist & questions](API.md#tickets-capacity-waitlist--questions) |  | eventsAdvanced.ts:103 |
| POST | `/events/:id/check-in` | company-item | events | [Check-in, tickets & badges](API.md#check-in-tickets--badges) |  | eventsAdvanced.ts:107 |
| GET | `/events/:id/check-in` | company-item | events | [Check-in, tickets & badges](API.md#check-in-tickets--badges) |  | eventsAdvanced.ts:106 |
| GET | `/public/tickets/:code` | public | events | [Check-in, tickets & badges](API.md#check-in-tickets--badges) |  | eventsAdvanced.ts:111 |
| POST | `/events/:id/invite` | company-item | events | [Invitations, reminders & calendar](API.md#invitations-reminders--calendar) |  | eventsAdvanced.ts:116 |
| GET | `/events/:id/emails` | company-item | events | [Invitations, reminders & calendar](API.md#invitations-reminders--calendar) |  | eventsAdvanced.ts:120 |
| GET | `/public/events/:token/calendar.ics` | public | events | [Invitations, reminders & calendar](API.md#invitations-reminders--calendar) |  | eventsAdvanced.ts:121 |
| GET | `/public/tickets/:code/calendar.ics` | public | events | [Invitations, reminders & calendar](API.md#invitations-reminders--calendar) |  | eventsAdvanced.ts:122 |
| POST | `/events/:id/captures` | company-item | events | [Booth capture & leaderboard](API.md#booth-capture--leaderboard) |  | eventsAdvanced.ts:126 |
| GET | `/events/:id/captures` | company-item | events | [Booth capture & leaderboard](API.md#booth-capture--leaderboard) |  | eventsAdvanced.ts:125 |
| GET | `/events/:id/leaderboard` | company-export | events | [Booth capture & leaderboard](API.md#booth-capture--leaderboard) |  | eventsAdvanced.ts:130 |
| POST | `/events/:id/follow-up` | company-item | events | [After the event](API.md#after-the-event) |  | eventsAdvanced.ts:133 |
| GET | `/events/:id/survey` | company-export | events | [Feedback survey](API.md#feedback-survey) |  | eventsAdvanced.ts:139 |
| GET | `/public/surveys/:token` | public | events | [Feedback survey](API.md#feedback-survey) |  | eventsAdvanced.ts:140 |
| POST | `/public/surveys/:token` | public | events | [Feedback survey](API.md#feedback-survey) |  | eventsAdvanced.ts:141 |
| GET | `/events/:id/budget` | company-item | events | [Budget & ROI](API.md#budget--roi) |  | eventsAdvanced.ts:147 |
| POST | `/events/:id/budget-lines` | company-item | events | [Budget & ROI](API.md#budget--roi) |  | eventsAdvanced.ts:148 |
| PATCH | `/events/:id/budget-lines/:lineId` | company-item | events | [Budget & ROI](API.md#budget--roi) |  | eventsAdvanced.ts:152 |
| DELETE | `/events/:id/budget-lines/:lineId` | company-item | events | [Budget & ROI](API.md#budget--roi) |  | eventsAdvanced.ts:156 |
| PUT | `/events/:id/campaign` | company-item | events | [Budget & ROI](API.md#budget--roi) |  | eventsAdvanced.ts:157 |
| GET | `/events/attendees` | company-list | events | [Cross-event sections: Attendees, Booth leads, Event analytics](API.md#cross-event-sections-attendees-booth-leads-event-analytics) |  | eventSections.ts:27 |
| GET | `/events/attendees/export` | company-export | events | [Cross-event sections: Attendees, Booth leads, Event analytics](API.md#cross-event-sections-attendees-booth-leads-event-analytics) |  | eventSections.ts:28 |
| GET | `/events/booth-leads` | company-list | events | [Cross-event sections: Attendees, Booth leads, Event analytics](API.md#cross-event-sections-attendees-booth-leads-event-analytics) |  | eventSections.ts:29 |
| POST | `/events/booth-leads/assign` | company-write | events | [Cross-event sections: Attendees, Booth leads, Event analytics](API.md#cross-event-sections-attendees-booth-leads-event-analytics) |  | eventSections.ts:30 |
| GET | `/events/analytics` | company-export | events | [Cross-event sections: Attendees, Booth leads, Event analytics](API.md#cross-event-sections-attendees-booth-leads-event-analytics) |  | eventSections.ts:34 |
| GET | `/event-speakers` | company-list | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:37 |
| POST | `/event-speakers` | company-write | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:38 |
| GET | `/event-speakers/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:42 |
| PATCH | `/event-speakers/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:43 |
| DELETE | `/event-speakers/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:47 |
| POST | `/event-speakers/:id/ratings` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:48 |
| GET | `/event-venues` | company-list | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:54 |
| POST | `/event-venues` | company-write | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:55 |
| GET | `/event-venues/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:59 |
| PATCH | `/event-venues/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:60 |
| DELETE | `/event-venues/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:64 |
| GET | `/event-vendors` | company-list | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:67 |
| POST | `/event-vendors` | company-write | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:68 |
| GET | `/event-vendors/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:72 |
| PATCH | `/event-vendors/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:73 |
| DELETE | `/event-vendors/:id` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:77 |
| POST | `/event-vendors/:id/reviews` | company-item | events | [Speakers, venues & vendors](API.md#speakers-venues--vendors) |  | eventLibrary.ts:78 |
| GET | `/events/sponsors` | company-list | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:46 |
| GET | `/events/sponsor-organizations` | company-search | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:51 |
| GET | `/events/:id/sponsorship` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:53 |
| POST | `/events/:id/sponsor-packages` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:54 |
| PATCH | `/events/:id/sponsor-packages/:packageId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:58 |
| DELETE | `/events/:id/sponsor-packages/:packageId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:62 |
| POST | `/events/:id/sponsors` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:63 |
| GET | `/events/:id/sponsors/:sponsorId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:67 |
| PATCH | `/events/:id/sponsors/:sponsorId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:68 |
| DELETE | `/events/:id/sponsors/:sponsorId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:72 |
| POST | `/events/:id/sponsors/:sponsorId/stage` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:73 |
| PATCH | `/events/:id/sponsors/:sponsorId/deliverables/:deliverableId` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:77 |
| POST | `/events/:id/sponsors/:sponsorId/deliverables/:deliverableId/task` | company-item | events | [Sponsors & exhibitors](API.md#sponsors--exhibitors) |  | eventSponsorsLogistics.ts:81 |
| GET | `/events/logistics` | company-list | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:86 |
| GET | `/events/:id/logistics` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:87 |
| POST | `/events/:id/trips` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:88 |
| PATCH | `/events/:id/trips/:tripId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:92 |
| DELETE | `/events/:id/trips/:tripId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:96 |
| POST | `/events/:id/shipments` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:97 |
| PATCH | `/events/:id/shipments/:shipmentId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:101 |
| DELETE | `/events/:id/shipments/:shipmentId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:105 |
| POST | `/events/:id/deadlines` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:106 |
| PATCH | `/events/:id/deadlines/:deadlineId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:110 |
| DELETE | `/events/:id/deadlines/:deadlineId` | company-item | events | [Travel & logistics](API.md#travel--logistics) |  | eventSponsorsLogistics.ts:114 |

## Marketing

API.md: [Marketing](API.md#marketing)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/marketing/options` | company-list | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:36 |
| GET | `/marketing/campaigns` | company-list | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:38 |
| POST | `/marketing/campaigns` | company-write | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:42 |
| GET | `/marketing/campaigns/:id` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:46 |
| PATCH | `/marketing/campaigns/:id` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:49 |
| POST | `/marketing/campaigns/:id/costs` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:53 |
| GET | `/marketing/campaigns/:id/results` | company-export | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:57 |
| GET | `/marketing/emails` | company-list | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:61 |
| POST | `/marketing/emails` | company-write | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:66 |
| GET | `/marketing/emails/:id` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:70 |
| PATCH | `/marketing/emails/:id` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:73 |
| DELETE | `/marketing/emails/:id` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:77 |
| POST | `/marketing/emails/:id/preview-audience` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:81 |
| POST | `/marketing/emails/:id/schedule` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:85 |
| POST | `/marketing/emails/:id/send-now` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:89 |
| POST | `/marketing/emails/:id/test` | company-item | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:92 |
| GET | `/marketing/reports/cost-per-lead` | company-export | marketing | [Marketing › Endpoints](API.md#endpoints-3) |  | marketing.ts:97 |
| GET | `/marketing/forms` | company-list | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:70 |
| POST | `/marketing/forms` | company-write | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:71 |
| GET | `/marketing/forms/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:75 |
| PATCH | `/marketing/forms/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:76 |
| DELETE | `/marketing/forms/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:80 |
| GET | `/marketing/forms/:id/submissions` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:81 |
| GET | `/marketing/landing-pages` | company-list | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:86 |
| POST | `/marketing/landing-pages` | company-write | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:87 |
| PATCH | `/marketing/landing-pages/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:91 |
| DELETE | `/marketing/landing-pages/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:95 |
| GET | `/marketing/utm-links` | company-list | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:98 |
| POST | `/marketing/utm-links` | company-write | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:99 |
| DELETE | `/marketing/utm-links/:id` | company-item | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:103 |
| GET | `/public/forms/:key` | public | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:106 |
| POST | `/public/forms/:key/submit` | public | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:107 |
| GET | `/public/pages/:slug` | public | marketing | [Lead generation](API.md#lead-generation) |  | marketingGrowth.ts:113 |
| GET | `/marketing/audiences` | company-list | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:119 |
| GET | `/marketing/audiences/options` | company-list | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:120 |
| POST | `/marketing/audiences/preview` | company-search | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:121 |
| POST | `/marketing/audiences` | company-write | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:125 |
| GET | `/marketing/audiences/:id` | company-item | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:129 |
| PATCH | `/marketing/audiences/:id` | company-item | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:130 |
| DELETE | `/marketing/audiences/:id` | company-item | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:134 |
| POST | `/marketing/audiences/:id/freeze` | company-item | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:135 |
| GET | `/marketing/audiences/:id/export` | company-export | marketing | [Audiences](API.md#audiences) |  | marketingGrowth.ts:136 |
| GET | `/marketing/seo/pages` | company-list | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:143 |
| POST | `/marketing/seo/pages` | company-write | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:144 |
| PATCH | `/marketing/seo/pages/:id` | company-item | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:148 |
| DELETE | `/marketing/seo/pages/:id` | company-item | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:152 |
| GET | `/marketing/seo/keywords` | company-list | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:153 |
| POST | `/marketing/seo/keywords` | company-write | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:154 |
| PATCH | `/marketing/seo/keywords/:id` | company-item | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:163 |
| DELETE | `/marketing/seo/keywords/:id` | company-item | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:167 |
| POST | `/marketing/seo/keywords/:id/positions` | company-item | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:168 |
| POST | `/marketing/seo/keywords/import` | company-write | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:159 |
| GET | `/marketing/seo/website-leads` | company-export | marketing | [Website & SEO](API.md#website--seo) |  | marketingGrowth.ts:172 |
| GET | `/marketing/content` | company-list | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:48 |
| POST | `/marketing/content` | company-write | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:61 |
| GET | `/marketing/content/:id` | company-item | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:65 |
| PATCH | `/marketing/content/:id` | company-item | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:68 |
| POST | `/marketing/content/:id/status` | company-item | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:72 |
| POST | `/marketing/content/:id/comments` | company-item | marketing | [Content calendar](API.md#content-calendar) |  | marketingCreative.ts:76 |
| GET | `/marketing/design-requests/options` | company-list | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:82 |
| GET | `/marketing/design-requests` | company-list | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:85 |
| POST | `/marketing/design-requests` | company-write | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:90 |
| GET | `/marketing/design-requests/:id` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:94 |
| PATCH | `/marketing/design-requests/:id` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:97 |
| POST | `/marketing/design-requests/:id/status` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:101 |
| POST | `/marketing/design-requests/:id/comments` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:105 |
| POST | `/marketing/design-requests/:id/attachments` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:109 |
| DELETE | `/marketing/design-requests/:id/attachments/:attachmentId` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:113 |
| POST | `/marketing/design-requests/:id/save-to-assets` | company-item | marketing | [Design requests](API.md#design-requests) |  | marketingCreative.ts:116 |
| GET | `/marketing/assets` | company-list | marketing | [Brand assets](API.md#brand-assets) |  | marketingCreative.ts:122 |
| POST | `/marketing/assets` | company-write | marketing | [Brand assets](API.md#brand-assets) |  | marketingCreative.ts:127 |
| GET | `/marketing/assets/:id` | company-item | marketing | [Brand assets](API.md#brand-assets) |  | marketingCreative.ts:131 |
| PATCH | `/marketing/assets/:id` | company-item | marketing | [Brand assets](API.md#brand-assets) |  | marketingCreative.ts:134 |
| DELETE | `/marketing/assets/:id` | company-item | marketing | [Brand assets](API.md#brand-assets) |  | marketingCreative.ts:138 |
| GET | `/marketing/ads/connections` | company-list | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:28 |
| GET | `/marketing/ads/providers/:provider/accounts` | company-list | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:42 |
| POST | `/marketing/ads/connections` | company-write | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:29 |
| GET | `/marketing/ads/connections/:id` | company-item | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:33 |
| DELETE | `/marketing/ads/connections/:id` | company-item | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:36 |
| POST | `/marketing/ads/connections/:id/sync` | company-item | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:39 |
| PATCH | `/marketing/ads/campaigns/:id` | company-item | marketing/ads | [Ads integrations](API.md#ads-integrations) |  | ads.ts:45 |
| GET | `/marketing/analytics` | company-export | marketing/analytics | [Marketing analytics](API.md#marketing-analytics) |  | ads.ts:50 |

## HR

API.md: [HR](API.md#hr)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/hr/employees/export` | company-export | hr | [Employees](API.md#employees) |  | hrPeople.ts:46 |
| POST | `/hr/employees` | company-write | hr | [Employees](API.md#employees) |  | hrPeople.ts:47 |
| GET | `/hr/employees/:id` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:52 |
| PATCH | `/hr/employees/:id` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:53 |
| POST | `/hr/employees/:id/reveal` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:57 |
| GET | `/hr/users/unlinked` | company-search | hr | [Employees](API.md#employees) |  | hrPeople.ts:51 |
| POST | `/hr/employees/:id/link-user` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:61 |
| POST | `/hr/employees/:id/offboarding/complete` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:65 |
| POST | `/hr/employees/:id/documents` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:70 |
| PATCH | `/hr/documents/:id` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:74 |
| DELETE | `/hr/documents/:id` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:78 |
| POST | `/hr/documents/:id/reveal` | company-item | hr | [Employees](API.md#employees) |  | hrPeople.ts:79 |
| GET | `/hr/contracts` | company-list | hr | [Employee contracts](API.md#employee-contracts) |  | hrPeople.ts:82 |
| GET | `/hr/contracts/:id` | company-item | hr | [Employee contracts](API.md#employee-contracts) |  | hrPeople.ts:92 |
| POST | `/hr/contracts` | company-write | hr | [Employee contracts](API.md#employee-contracts) |  | hrPeople.ts:88 |
| PATCH | `/hr/contracts/:id` | company-item | hr | [Employee contracts](API.md#employee-contracts) |  | hrPeople.ts:93 |
| POST | `/hr/contracts/:id/renew` | company-item | hr | [Employee contracts](API.md#employee-contracts) |  | hrPeople.ts:97 |
| GET | `/hr/assets` | company-list | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:103 |
| GET | `/hr/assets/:id` | company-item | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:111 |
| POST | `/hr/assets` | company-write | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:107 |
| PATCH | `/hr/assets/:id` | company-item | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:112 |
| POST | `/hr/assets/:id/assign` | company-item | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:116 |
| POST | `/hr/assets/:id/return` | company-item | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:120 |
| POST | `/hr/assets/:id/lost` | company-item | hr | [Company assets](API.md#company-assets) |  | hrPeople.ts:124 |
| GET | `/hr/recruitment/options` | company-list | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:28 |
| GET | `/hr/recruitment/openings` | company-list | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:29 |
| POST | `/hr/recruitment/openings` | company-write | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:30 |
| GET | `/hr/recruitment/openings/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:34 |
| PATCH | `/hr/recruitment/openings/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:35 |
| POST | `/hr/recruitment/openings/:id/status` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:39 |
| GET | `/hr/recruitment/candidates` | company-list | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:44 |
| POST | `/hr/recruitment/candidates` | company-write | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:45 |
| GET | `/hr/recruitment/candidates/check` | company-search | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:49 |
| GET | `/hr/recruitment/candidates/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:52 |
| PATCH | `/hr/recruitment/candidates/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:53 |
| POST | `/hr/recruitment/candidates/:id/cv` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:57 |
| POST | `/hr/recruitment/applications` | company-write | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:62 |
| POST | `/hr/recruitment/applications/:id/stage` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:66 |
| POST | `/hr/recruitment/applications/:id/interviews` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:70 |
| PATCH | `/hr/recruitment/interviews/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:80 |
| PUT | `/hr/recruitment/interviews/:id/scorecard` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:84 |
| GET | `/hr/recruitment/my-interviews` | company-list | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:79 |
| POST | `/hr/recruitment/applications/:id/offers` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:74 |
| PATCH | `/hr/recruitment/offers/:id` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:89 |
| POST | `/hr/recruitment/offers/:id/status` | company-item | hr | [Recruitment](API.md#recruitment) |  | hrTalent.ts:93 |
| GET | `/hr/training/options` | company-list | hr | [Training](API.md#training) |  | hrTalent.ts:99 |
| GET | `/hr/training/courses` | company-list | hr | [Training](API.md#training) |  | hrTalent.ts:103 |
| POST | `/hr/training/courses` | company-write | hr | [Training](API.md#training) |  | hrTalent.ts:104 |
| GET | `/hr/training/courses/:id` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:108 |
| PATCH | `/hr/training/courses/:id` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:109 |
| POST | `/hr/training/courses/:id/sessions` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:113 |
| PATCH | `/hr/training/sessions/:id` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:117 |
| POST | `/hr/training/sessions/:id/enrollments` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:121 |
| PATCH | `/hr/training/enrollments/:id` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:125 |
| GET | `/hr/training/certificates` | company-list | hr | [Training](API.md#training) |  | hrTalent.ts:129 |
| PATCH | `/hr/training/certificates/:id` | company-item | hr | [Training](API.md#training) |  | hrTalent.ts:130 |
| GET | `/hr/training/matrix` | company-export | hr | [Training](API.md#training) |  | hrTalent.ts:100 |
| GET | `/hr/training/budget` | company-export | hr | [Training](API.md#training) |  | hrTalent.ts:101 |
| GET | `/hr/training/my` | company-list | hr | [Training](API.md#training) |  | hrTalent.ts:102 |
| GET | `/hr/attendance/me` | company-list | hr | [Attendance](API.md#attendance) |  | hrTime.ts:23 |
| POST | `/hr/attendance/clock-in` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:24 |
| POST | `/hr/attendance/clock-out` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:28 |
| GET | `/hr/attendance/today` | company-list | hr | [Attendance](API.md#attendance) |  | hrTime.ts:33 |
| GET | `/hr/attendance/sheet` | company-export | hr | [Attendance](API.md#attendance) |  | hrTime.ts:34 |
| GET | `/hr/attendance/employees/:employeeId` | company-item | hr | [Attendance](API.md#attendance) |  | hrTime.ts:40 |
| POST | `/hr/attendance/entries` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:43 |
| POST | `/hr/attendance/import` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:47 |
| GET | `/hr/attendance/shifts` | company-list | hr | [Attendance](API.md#attendance) |  | hrTime.ts:52 |
| POST | `/hr/attendance/shifts` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:53 |
| PATCH | `/hr/attendance/shifts/:id` | company-item | hr | [Attendance](API.md#attendance) |  | hrTime.ts:57 |
| DELETE | `/hr/attendance/shifts/:id` | company-item | hr | [Attendance](API.md#attendance) |  | hrTime.ts:61 |
| PUT | `/hr/attendance/assignments` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:62 |
| GET | `/hr/attendance/corrections` | company-list | hr | [Attendance](API.md#attendance) |  | hrTime.ts:67 |
| POST | `/hr/attendance/corrections` | company-write | hr | [Attendance](API.md#attendance) |  | hrTime.ts:68 |
| POST | `/hr/attendance/corrections/:id/decide` | company-item | hr | [Attendance](API.md#attendance) |  | hrTime.ts:72 |
| GET | `/hr/leave/me` | company-list | hr | [Leave](API.md#leave) |  | hrTime.ts:78 |
| GET | `/hr/leave/types` | company-list | hr | [Leave](API.md#leave) |  | hrTime.ts:79 |
| POST | `/hr/leave/types` | company-write | hr | [Leave](API.md#leave) |  | hrTime.ts:80 |
| PATCH | `/hr/leave/types/:id` | company-item | hr | [Leave](API.md#leave) |  | hrTime.ts:84 |
| PUT | `/hr/leave/settings` | company-write | hr | [Leave](API.md#leave) |  | hrTime.ts:88 |
| GET | `/hr/leave/balances` | company-list | hr | [Leave](API.md#leave) |  | hrTime.ts:92 |
| GET | `/hr/leave/calendar` | company-list | hr | [Leave](API.md#leave) |  | hrTime.ts:96 |
| GET | `/hr/leave/requests` | company-list | hr | [Leave](API.md#leave) |  | hrTime.ts:97 |
| POST | `/hr/leave/requests/preview` | company-write | hr | [Leave](API.md#leave) |  | hrTime.ts:102 |
| POST | `/hr/leave/requests` | company-write | hr | [Leave](API.md#leave) |  | hrTime.ts:106 |
| GET | `/hr/leave/requests/:id` | company-item | hr | [Leave](API.md#leave) |  | hrTime.ts:110 |
| POST | `/hr/leave/requests/:id/decide` | company-item | hr | [Leave](API.md#leave) |  | hrTime.ts:111 |
| POST | `/hr/leave/requests/:id/cancel` | company-item | hr | [Leave](API.md#leave) |  | hrTime.ts:115 |
| GET | `/hr/holidays` | company-list | hr | [Public holidays](API.md#public-holidays) |  | hrTime.ts:121 |
| POST | `/hr/holidays` | company-write | hr | [Public holidays](API.md#public-holidays) |  | hrTime.ts:122 |
| PATCH | `/hr/holidays/:id` | company-item | hr | [Public holidays](API.md#public-holidays) |  | hrTime.ts:126 |
| DELETE | `/hr/holidays/:id` | company-item | hr | [Public holidays](API.md#public-holidays) |  | hrTime.ts:130 |
| GET | `/hr/payroll/settings` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:43 |
| PATCH | `/hr/payroll/settings` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:44 |
| GET | `/hr/payroll/profiles` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:50 |
| PATCH | `/hr/payroll/profiles/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:51 |
| POST | `/hr/payroll/profiles/:id/reveal` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:55 |
| GET | `/hr/payroll/adjustments` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:58 |
| POST | `/hr/payroll/adjustments` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:62 |
| PATCH | `/hr/payroll/adjustments/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:66 |
| DELETE | `/hr/payroll/adjustments/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:70 |
| GET | `/hr/payroll/loans` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:73 |
| POST | `/hr/payroll/loans` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:77 |
| PATCH | `/hr/payroll/loans/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:81 |
| GET | `/hr/payroll/runs` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:87 |
| POST | `/hr/payroll/runs` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:88 |
| GET | `/hr/payroll/runs/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:92 |
| DELETE | `/hr/payroll/runs/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:93 |
| POST | `/hr/payroll/runs/:id/calculate` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:94 |
| POST | `/hr/payroll/runs/:id/acknowledge` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:95 |
| POST | `/hr/payroll/runs/:id/approve` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:99 |
| POST | `/hr/payroll/runs/:id/reopen` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:100 |
| POST | `/hr/payroll/runs/:id/pay` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:101 |
| POST | `/hr/payroll/runs/:id/bank-file` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:102 |
| GET | `/hr/payroll/payslips` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:108 |
| GET | `/hr/payroll/payslips/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:112 |
| GET | `/hr/payroll/summary` | company-export | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:115 |
| GET | `/hr/payroll/settlements` | company-list | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:118 |
| POST | `/hr/payroll/settlements/preview` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:119 |
| POST | `/hr/payroll/settlements` | company-write | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:123 |
| GET | `/hr/payroll/settlements/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:127 |
| PATCH | `/hr/payroll/settlements/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:128 |
| DELETE | `/hr/payroll/settlements/:id` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:132 |
| POST | `/hr/payroll/settlements/:id/pay` | company-item | hr | [Salary management](API.md#salary-management) |  | hrPayroll.ts:133 |
| GET | `/hr/reports/options` | company-list | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:26 |
| GET | `/hr/reports/overview` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:27 |
| GET | `/hr/reports/headcount` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:28 |
| GET | `/hr/reports/turnover` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:29 |
| GET | `/hr/reports/nationalisation` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:30 |
| GET | `/hr/reports/attendance` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:31 |
| GET | `/hr/reports/leave` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:32 |
| GET | `/hr/reports/compliance` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:33 |
| GET | `/hr/reports/assets` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:34 |
| GET | `/hr/reports/recruitment` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:35 |
| GET | `/hr/reports/training` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:36 |
| GET | `/hr/reports/payroll-cost` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:37 |
| GET | `/hr/reports/:report/export` | company-export | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:42 |
| PUT | `/hr/reports/settings` | company-write | hr | [HR reports](API.md#hr-reports) |  | hrReports.ts:38 |
| GET | `/hr/me` | company-list | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:25 |
| GET | `/hr/me/payslips/:id` | company-item | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:26 |
| GET | `/hr/profile-changes` | company-list | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:29 |
| POST | `/hr/profile-changes` | company-write | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:30 |
| POST | `/hr/profile-changes/:id/approve` | company-item | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:34 |
| POST | `/hr/profile-changes/:id/reject` | company-item | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:38 |
| POST | `/hr/profile-changes/:id/cancel` | company-item | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:42 |
| POST | `/hr/profile-changes/:id/reveal` | company-item | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:43 |
| GET | `/hr/self-service/inbox` | company-list | hr | [Self-service](API.md#self-service) |  | hrSelfService.ts:46 |
| GET | `/hr/letters/types` | company-list | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:49 |
| PATCH | `/hr/letters/types/:id` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:50 |
| POST | `/hr/letters/types/:id/reset` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:54 |
| GET | `/hr/letters/requests` | company-list | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:56 |
| POST | `/hr/letters/requests` | company-write | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:60 |
| GET | `/hr/letters/requests/:id` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:64 |
| POST | `/hr/letters/requests/:id/approve` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:65 |
| POST | `/hr/letters/requests/:id/reject` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:69 |
| POST | `/hr/letters/requests/:id/cancel` | company-item | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:73 |
| GET | `/hr/letters/verify` | company-search | hr | [HR letters](API.md#hr-letters) |  | hrSelfService.ts:55 |
| POST | `/hr/letters/requests/:id/revoke` | company-item | hr | [Letters: languages and verification](API.md#letters-languages-and-verification) |  | hrSelfService.ts:74 |
| GET | `/public/letters/verify` | public | hr | [Letters: languages and verification](API.md#letters-languages-and-verification) |  | hrSelfService.ts:80 |
| GET | `/hr/discipline` | company-list | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:24 |
| POST | `/hr/discipline` | company-write | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:30 |
| GET | `/hr/discipline/:id` | company-item | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:34 |
| GET | `/hr/discipline/:id/letter` | company-item | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:35 |
| POST | `/hr/discipline/:id/attachments` | company-item | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:39 |
| POST | `/hr/discipline/:id/withdraw` | company-item | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:43 |
| POST | `/hr/discipline/:id/acknowledge` | company-item | hr | [Discipline](API.md#discipline) |  | hrCompliance.ts:47 |
| GET | `/hr/policies` | company-list | hr | [Policies](API.md#policies) |  | hrCompliance.ts:53 |
| POST | `/hr/policies` | company-write | hr | [Policies](API.md#policies) |  | hrCompliance.ts:54 |
| GET | `/hr/policies/my` | company-list | hr | [Policies](API.md#policies) |  | hrCompliance.ts:58 |
| GET | `/hr/policies/:id` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:59 |
| PATCH | `/hr/policies/:id` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:60 |
| POST | `/hr/policies/:id/publish` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:64 |
| POST | `/hr/policies/:id/archive` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:68 |
| GET | `/hr/policies/:id/status` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:69 |
| GET | `/hr/policies/:id/export` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:70 |
| POST | `/hr/policies/:id/acknowledge` | company-item | hr | [Policies](API.md#policies) |  | hrCompliance.ts:71 |
| GET | `/hr/journeys` | company-list | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:50 |
| POST | `/hr/journeys` | company-write | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:54 |
| GET | `/hr/journeys/my-tasks` | company-list | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:33 |
| GET | `/hr/journeys/options` | company-search | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:34 |
| GET | `/hr/journeys/:id` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:58 |
| POST | `/hr/journeys/:id/items` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:61 |
| PATCH | `/hr/journeys/:id/items/:itemId` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:65 |
| DELETE | `/hr/journeys/:id/items/:itemId` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:69 |
| POST | `/hr/journeys/:id/items/:itemId/complete` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:70 |
| POST | `/hr/journeys/:id/items/:itemId/reopen` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:74 |
| POST | `/hr/journeys/:id/activate` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:59 |
| POST | `/hr/journeys/:id/cancel` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:60 |
| GET | `/hr/journeys/templates` | company-list | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:37 |
| POST | `/hr/journeys/templates` | company-write | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:38 |
| GET | `/hr/journeys/templates/:id` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:42 |
| PATCH | `/hr/journeys/templates/:id` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:43 |
| DELETE | `/hr/journeys/templates/:id` | company-item | hr | [Onboarding & offboarding](API.md#onboarding--offboarding) |  | hrJourney.ts:47 |
| GET | `/hr/performance/options` | company-list | hr | [Performance](API.md#performance) |  | hrPerformance.ts:27 |
| GET | `/hr/performance/my` | company-list | hr | [Performance](API.md#performance) |  | hrPerformance.ts:28 |
| GET | `/hr/performance/templates` | company-list | hr | [Performance](API.md#performance) |  | hrPerformance.ts:31 |
| POST | `/hr/performance/templates` | company-write | hr | [Performance](API.md#performance) |  | hrPerformance.ts:32 |
| PATCH | `/hr/performance/templates/:id` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:36 |
| GET | `/hr/performance/cycles` | company-list | hr | [Performance](API.md#performance) |  | hrPerformance.ts:42 |
| POST | `/hr/performance/cycles` | company-write | hr | [Performance](API.md#performance) |  | hrPerformance.ts:43 |
| GET | `/hr/performance/cycles/:id` | company-export | hr | [Performance](API.md#performance) |  | hrPerformance.ts:47 |
| PATCH | `/hr/performance/cycles/:id` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:48 |
| POST | `/hr/performance/cycles/:id/advance` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:53 |
| POST | `/hr/performance/cycles/:id/close` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:54 |
| POST | `/hr/performance/cycles/:id/launch` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:52 |
| POST | `/hr/performance/cycles/:id/remind` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:55 |
| GET | `/hr/performance/reviews` | company-list | hr | [Performance](API.md#performance) |  | hrPerformance.ts:58 |
| GET | `/hr/performance/reviews/:id` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:61 |
| PUT | `/hr/performance/reviews/:id/self` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:62 |
| PUT | `/hr/performance/reviews/:id/manager` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:66 |
| POST | `/hr/performance/reviews/:id/calibrate` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:70 |
| POST | `/hr/performance/reviews/:id/share` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:74 |
| POST | `/hr/performance/reviews/:id/acknowledge` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:75 |
| POST | `/hr/performance/reviews/:id/goals` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:81 |
| POST | `/hr/performance/reviews/:id/goals/approve` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:85 |
| PATCH | `/hr/performance/goals/:id` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:86 |
| DELETE | `/hr/performance/goals/:id` | company-item | hr | [Performance](API.md#performance) |  | hrPerformance.ts:90 |
| GET | `/hr/engagement/options` | company-list | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:31 |
| PATCH | `/hr/engagement/settings` | company-write | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:32 |
| GET | `/hr/engagement/overview` | company-export | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:36 |
| GET | `/hr/engagement/surveys` | company-list | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:43 |
| POST | `/hr/engagement/surveys` | company-write | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:44 |
| GET | `/hr/engagement/surveys/:id` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:48 |
| PATCH | `/hr/engagement/surveys/:id` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:49 |
| POST | `/hr/engagement/surveys/:id/launch` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:53 |
| POST | `/hr/engagement/surveys/:id/close` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:54 |
| GET | `/hr/engagement/surveys/:id/results` | company-export | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:55 |
| GET | `/hr/engagement/surveys/:id/export` | company-export | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:58 |
| GET | `/hr/engagement/my` | company-list | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:37 |
| GET | `/hr/engagement/my/:id` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:38 |
| PUT | `/hr/engagement/my/:id` | company-item | hr | [Engagement surveys](API.md#engagement-surveys) |  | hrEngagement.ts:39 |
| GET | `/hr/feedback/options` | company-list | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:61 |
| GET | `/hr/feedback/my` | company-list | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:62 |
| GET | `/hr/feedback/rounds` | company-list | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:63 |
| POST | `/hr/feedback/rounds` | company-write | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:64 |
| GET | `/hr/feedback/rounds/:id` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:68 |
| POST | `/hr/feedback/rounds/:id/providers` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:69 |
| POST | `/hr/feedback/rounds/:id/nominations` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:73 |
| POST | `/hr/feedback/rounds/:id/nominations/decide` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:77 |
| POST | `/hr/feedback/rounds/:id/close` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:81 |
| GET | `/hr/feedback/rounds/:id/summary` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:82 |
| GET | `/hr/feedback/reviews/:id` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:83 |
| GET | `/hr/feedback/invitations/:id` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:84 |
| PUT | `/hr/feedback/invitations/:id` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:85 |
| POST | `/hr/feedback/invitations/:id/decline` | company-item | hr | [360° feedback](API.md#360-feedback) |  | hrEngagement.ts:89 |

## Finance

API.md: [Finance](API.md#finance)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/finance/settings` | company-list | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:40 |
| PATCH | `/finance/settings` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:41 |
| PUT | `/finance/settings/lock-date` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:45 |
| GET | `/finance/exchange-rates/lookup` | company-search | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:49 |
| POST | `/finance/exchange-rates` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:53 |
| DELETE | `/finance/exchange-rates/:id` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:57 |
| GET | `/finance/accounts` | company-list | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:60 |
| POST | `/finance/accounts` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:65 |
| PATCH | `/finance/accounts/:id` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:69 |
| DELETE | `/finance/accounts/:id` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:73 |
| POST | `/finance/accounts/import-template` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:64 |
| GET | `/finance/accounts/:id/ledger` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:74 |
| GET | `/finance/journal` | company-list | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:80 |
| GET | `/finance/journal/dimensions` | company-list | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:86 |
| POST | `/finance/journal` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:87 |
| GET | `/finance/journal/:id` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:91 |
| POST | `/finance/journal/:id/reverse` | company-item | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:92 |
| POST | `/finance/opening-balances` | company-write | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:96 |
| GET | `/finance/reports/trial-balance` | company-export | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:102 |
| GET | `/finance/overview` | company-export | accounting | [Ledger & settings](API.md#ledger--settings) |  | financeLedger.ts:106 |
| POST | `/finance/invoices` | company-write | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:41 |
| GET | `/finance/invoices/meta` | company-list | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:45 |
| GET | `/finance/invoices/sources` | company-list | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:46 |
| POST | `/finance/invoices/from-source` | company-write | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:47 |
| GET | `/finance/invoices/:id` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:51 |
| PATCH | `/finance/invoices/:id` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:52 |
| DELETE | `/finance/invoices/:id` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:56 |
| POST | `/finance/invoices/:id/issue` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:57 |
| POST | `/finance/invoices/:id/void` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:58 |
| POST | `/finance/invoices/:id/send` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:62 |
| POST | `/finance/invoices/:id/zatca-xml` | company-item | finance/invoices | [Invoices](API.md#invoices) |  | financeInvoices.ts:66 |
| GET | `/finance/credit-notes` | company-list | finance/invoices | [Credit notes](API.md#credit-notes) |  | financeInvoices.ts:69 |
| POST | `/finance/credit-notes` | company-write | finance/invoices | [Credit notes](API.md#credit-notes) |  | financeInvoices.ts:70 |
| GET | `/finance/credit-notes/:id` | company-item | finance/invoices | [Credit notes](API.md#credit-notes) |  | financeInvoices.ts:74 |
| POST | `/finance/credit-notes/:id/zatca-xml` | company-item | finance/invoices | [Credit notes](API.md#credit-notes) |  | financeInvoices.ts:75 |
| GET | `/finance/recurring-invoices` | company-list | finance/invoices | [Recurring invoices](API.md#recurring-invoices) |  | financeInvoices.ts:78 |
| POST | `/finance/recurring-invoices` | company-write | finance/invoices | [Recurring invoices](API.md#recurring-invoices) |  | financeInvoices.ts:79 |
| GET | `/finance/recurring-invoices/:id` | company-item | finance/invoices | [Recurring invoices](API.md#recurring-invoices) |  | financeInvoices.ts:83 |
| PATCH | `/finance/recurring-invoices/:id` | company-item | finance/invoices | [Recurring invoices](API.md#recurring-invoices) |  | financeInvoices.ts:84 |
| GET | `/finance/payments` | company-list | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:38 |
| POST | `/finance/payments` | company-write | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:44 |
| GET | `/finance/payments/:id` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:49 |
| GET | `/finance/payments/:id/receipt` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:50 |
| POST | `/finance/payments/:id/apply-credit` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:51 |
| POST | `/finance/payments/:id/refund` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:55 |
| POST | `/finance/payments/:id/void` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:59 |
| POST | `/finance/credit-note-credits/:id/apply` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:66 |
| POST | `/finance/credit-note-credits/:id/refund` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:70 |
| GET | `/finance/deposit-accounts` | company-list | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:48 |
| GET | `/finance/customers/:id/open-items` | company-item | finance/collections | [Payments](API.md#payments) |  | financeCollections.ts:112 |
| GET | `/finance/pdcs` | company-list | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:75 |
| POST | `/finance/pdcs` | company-write | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:79 |
| GET | `/finance/pdcs/:id` | company-item | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:83 |
| POST | `/finance/pdcs/:id/deposit` | company-item | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:85 |
| POST | `/finance/pdcs/:id/clear` | company-item | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:85 |
| POST | `/finance/pdcs/:id/bounce` | company-item | finance/collections | [PDC](API.md#pdc) |  | financeCollections.ts:85 |
| GET | `/finance/receivables/aging` | company-export | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:104 |
| GET | `/finance/receivables/aging/:id` | company-item | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:105 |
| GET | `/finance/customers/:id/statement` | company-item | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:113 |
| POST | `/finance/customers/:id/statement/email` | company-item | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:117 |
| GET | `/finance/customers` | company-list | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:106 |
| GET | `/finance/customers/:id/credit` | company-item | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:107 |
| PATCH | `/finance/customers/:id/credit` | company-item | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:108 |
| GET | `/finance/credit-check` | company-search | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:121 |
| GET | `/finance/collections/settings` | company-list | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:127 |
| PATCH | `/finance/collections/settings` | company-write | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:128 |
| GET | `/finance/dunning/log` | company-list | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:132 |
| POST | `/finance/dunning/pause` | company-write | finance/collections | [Receivables](API.md#receivables) |  | financeCollections.ts:136 |
| GET | `/finance/payment-links` | company-list | finance/collections | [Payment links](API.md#payment-links) |  | financeCollections.ts:93 |
| POST | `/finance/payment-links` | company-write | finance/collections | [Payment links](API.md#payment-links) |  | financeCollections.ts:97 |
| POST | `/finance/payment-links/:id/void` | company-item | finance/collections | [Payment links](API.md#payment-links) |  | financeCollections.ts:101 |
| GET | `/public/pay/:token` | public | finance/collections | [Payment links](API.md#payment-links) |  | financeCollections.ts:142 |
| POST | `/public/pay/:token` | public | finance/collections | [Payment links](API.md#payment-links) |  | financeCollections.ts:143 |
| GET | `/finance/expense-categories` | company-list | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:46 |
| POST | `/finance/expense-categories` | company-write | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:47 |
| PATCH | `/finance/expense-categories/:id` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:51 |
| GET | `/finance/expense-policy` | company-list | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:55 |
| PATCH | `/finance/expense-policy` | company-write | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:56 |
| GET | `/finance/expenses` | company-list | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:62 |
| GET | `/finance/expenses/meta` | company-list | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:72 |
| POST | `/finance/expenses/check-duplicate` | company-search | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:73 |
| POST | `/finance/expenses` | company-write | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:68 |
| GET | `/finance/expenses/:id` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:77 |
| PATCH | `/finance/expenses/:id` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:78 |
| POST | `/finance/expenses/:id/approve` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:82 |
| POST | `/finance/expenses/:id/reject` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:83 |
| POST | `/finance/expenses/:id/void` | company-item | finance/expenses | [Expenses](API.md#expenses) |  | financeExpenses.ts:87 |
| GET | `/finance/expense-claims` | company-list | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:93 |
| GET | `/finance/expense-claims/meta` | company-list | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:101 |
| POST | `/finance/expense-claims` | company-write | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:97 |
| GET | `/finance/expense-claims/:id` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:102 |
| PATCH | `/finance/expense-claims/:id` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:103 |
| DELETE | `/finance/expense-claims/:id` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:107 |
| POST | `/finance/expense-claims/:id/submit` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:108 |
| POST | `/finance/expense-claims/:id/approve` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:109 |
| POST | `/finance/expense-claims/:id/reject` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:110 |
| POST | `/finance/expense-claims/:id/reimburse` | company-item | finance/expenses | [Expense claims](API.md#expense-claims) |  | financeExpenses.ts:114 |
| GET | `/finance/petty-cash/meta` | company-list | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:120 |
| GET | `/finance/petty-cash/funds` | company-list | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:121 |
| POST | `/finance/petty-cash/funds` | company-write | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:122 |
| GET | `/finance/petty-cash/funds/:id` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:126 |
| PATCH | `/finance/petty-cash/funds/:id` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:127 |
| POST | `/finance/petty-cash/funds/:id/top-up` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:131 |
| POST | `/finance/petty-cash/funds/:id/expenses` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:135 |
| POST | `/finance/petty-cash/funds/:id/replenish` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:139 |
| POST | `/finance/petty-cash/funds/:id/count` | company-item | finance/expenses | [Petty cash](API.md#petty-cash) |  | financeExpenses.ts:143 |
| GET | `/finance/suppliers` | company-list | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:33 |
| POST | `/finance/suppliers` | company-write | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:34 |
| GET | `/finance/suppliers/:id` | company-item | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:38 |
| PATCH | `/finance/suppliers/:id` | company-item | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:39 |
| POST | `/finance/suppliers/:id/reveal-iban` | company-item | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:43 |
| GET | `/finance/suppliers/:id/statement` | company-export | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:44 |
| GET | `/finance/purchases/meta` | company-list | finance/purchases | [Suppliers](API.md#suppliers) |  | financePurchases.ts:50 |
| GET | `/finance/purchase-orders` | company-list | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:53 |
| POST | `/finance/purchase-orders` | company-write | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:57 |
| GET | `/finance/purchase-orders/:id` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:61 |
| PATCH | `/finance/purchase-orders/:id` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:62 |
| DELETE | `/finance/purchase-orders/:id` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:66 |
| POST | `/finance/purchase-orders/:id/approve` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:68 |
| POST | `/finance/purchase-orders/:id/reject` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:69 |
| POST | `/finance/purchase-orders/:id/submit` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:67 |
| POST | `/finance/purchase-orders/:id/cancel` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:73 |
| POST | `/finance/purchase-orders/:id/receive` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:77 |
| POST | `/finance/purchase-orders/:id/close` | company-item | finance/purchases | [Purchase orders](API.md#purchase-orders) |  | financePurchases.ts:81 |
| GET | `/finance/bills` | company-list | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:84 |
| POST | `/finance/bills` | company-write | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:90 |
| GET | `/finance/bills/:id` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:94 |
| PATCH | `/finance/bills/:id` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:95 |
| DELETE | `/finance/bills/:id` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:99 |
| POST | `/finance/bills/:id/approve` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:102 |
| POST | `/finance/bills/:id/post` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:101 |
| POST | `/finance/bills/:id/reject` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:103 |
| POST | `/finance/bills/:id/submit` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:100 |
| POST | `/finance/bills/:id/void` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:107 |
| POST | `/finance/bills/:id/attachments` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:111 |
| DELETE | `/finance/bills/:id/attachments/:attachmentId` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:115 |
| GET | `/finance/debit-notes` | company-list | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:120 |
| POST | `/finance/debit-notes` | company-write | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:124 |
| POST | `/finance/debit-notes/:id/void` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:128 |
| GET | `/finance/bill-payments` | company-list | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:153 |
| GET | `/finance/bill-payments/:id` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:176 |
| POST | `/finance/bill-payments` | company-write | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:157 |
| POST | `/finance/bill-payments/run` | company-write | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:161 |
| GET | `/finance/payment-runs` | company-list | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:165 |
| POST | `/finance/payment-runs/:id/bank-file` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:167 |
| POST | `/finance/payment-runs/:id/confirm` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:172 |
| POST | `/finance/payment-runs/:id/sent` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:168 |
| POST | `/finance/bill-payments/:id/void` | company-item | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:177 |
| GET | `/finance/payables/aging` | company-export | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:183 |
| GET | `/finance/payables/due` | company-export | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:184 |
| GET | `/finance/payables/overview` | company-export | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:185 |
| GET | `/finance/event-costs` | company-export | finance/purchases | [Bills](API.md#bills) |  | financePurchases.ts:186 |
| GET | `/finance/supplier-advances` | company-list | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:134 |
| POST | `/finance/supplier-advances` | company-write | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:138 |
| GET | `/finance/supplier-advances/:id` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:142 |
| POST | `/finance/supplier-advances/:id/apply` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:143 |
| POST | `/finance/supplier-advances/:id/refund` | company-item | finance/gaps | [Bills](API.md#bills) |  | financePurchases.ts:147 |
| GET | `/finance/approval-rules` | company-list | finance/purchases | [Approval rules](API.md#approval-rules) |  | financePurchases.ts:189 |
| PUT | `/finance/approval-rules` | company-write | finance/purchases | [Approval rules](API.md#approval-rules) |  | financePurchases.ts:190 |
| GET | `/finance/bank-accounts` | company-list | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:25 |
| GET | `/finance/bank-accounts/ledger-options` | company-list | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:26 |
| POST | `/finance/bank-accounts` | company-write | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:27 |
| GET | `/finance/bank-accounts/:id` | company-item | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:31 |
| PATCH | `/finance/bank-accounts/:id` | company-item | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:32 |
| POST | `/finance/bank-accounts/:id/reveal` | company-item | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:36 |
| GET | `/finance/bank-transfers` | company-list | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:84 |
| POST | `/finance/bank-transfers` | company-write | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:85 |
| POST | `/finance/bank-transfers/:id/void` | company-item | accounting | [Bank accounts](API.md#bank-accounts) |  | financeBanking.ts:89 |
| GET | `/finance/bank-accounts/:id/statements` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:39 |
| POST | `/finance/bank-accounts/:id/statements/preview` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:40 |
| POST | `/finance/bank-accounts/:id/statements` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:44 |
| GET | `/finance/bank-statements/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:48 |
| DELETE | `/finance/bank-statements/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:49 |
| GET | `/finance/bank-accounts/:id/reconcile` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:52 |
| POST | `/finance/bank-accounts/:id/matches` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:53 |
| POST | `/finance/bank-accounts/:id/auto-match` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:57 |
| DELETE | `/finance/bank-matches/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:58 |
| POST | `/finance/bank-statement-lines/:id/create-entry` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:59 |
| POST | `/finance/bank-accounts/:id/reconciliations` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:63 |
| GET | `/finance/bank-reconciliations` | company-list | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:67 |
| GET | `/finance/bank-reconciliations/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:68 |
| POST | `/finance/bank-reconciliations/:id/undo` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:69 |
| GET | `/finance/bank-rules` | company-list | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:72 |
| POST | `/finance/bank-rules` | company-write | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:73 |
| PATCH | `/finance/bank-rules/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:77 |
| DELETE | `/finance/bank-rules/:id` | company-item | accounting | [Reconciliation](API.md#reconciliation) |  | financeBanking.ts:81 |
| GET | `/finance/payroll-postings` | company-list | accounting | [Payroll posting](API.md#payroll-posting) |  | financeBanking.ts:92 |
| GET | `/finance/payroll-postings/:id` | company-item | accounting | [Payroll posting](API.md#payroll-posting) |  | financeBanking.ts:93 |
| PUT | `/finance/payroll-postings/:id/paid-from` | company-item | accounting | [Payroll posting](API.md#payroll-posting) |  | financeBanking.ts:94 |
| GET | `/finance/eosb-provision` | company-export | finance/gaps | [Payroll posting](API.md#payroll-posting) |  | financeBanking.ts:100 |
| POST | `/finance/eosb-provision/run` | company-write | finance/gaps | [Payroll posting](API.md#payroll-posting) |  | financeBanking.ts:101 |
| GET | `/finance/commission-plans` | company-list | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:18 |
| POST | `/finance/commission-plans` | company-write | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:19 |
| PATCH | `/finance/commission-plans/:id` | company-item | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:23 |
| GET | `/finance/commissions/mine` | company-list | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:27 |
| GET | `/finance/commission-statements` | company-list | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:28 |
| POST | `/finance/commission-statements/generate` | company-write | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:32 |
| GET | `/finance/commission-statements/:id` | company-item | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:36 |
| POST | `/finance/commission-statements/:id/approve` | company-item | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:37 |
| POST | `/finance/commission-statements/:id/reject` | company-item | accounting | [Commissions](API.md#commissions) |  | financeCommissions.ts:38 |
| GET | `/finance/statements/meta` | company-list | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:46 |
| GET | `/finance/statements/profit-and-loss` | company-export | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:47 |
| GET | `/finance/statements/balance-sheet` | company-export | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:48 |
| GET | `/finance/statements/cash-flow` | company-export | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:49 |
| GET | `/finance/statements/general-ledger` | company-export | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:50 |
| GET | `/finance/statements/trial-balance` | company-export | accounting | [Financial statements](API.md#financial-statements) |  | financeStatements.ts:51 |
| GET | `/finance/year-end` | company-list | accounting | [Year-end close](API.md#year-end-close) |  | financeStatements.ts:53 |
| GET | `/finance/year-end/preview` | company-export | accounting | [Year-end close](API.md#year-end-close) |  | financeStatements.ts:54 |
| POST | `/finance/year-end/close` | company-write | accounting | [Year-end close](API.md#year-end-close) |  | financeStatements.ts:57 |
| POST | `/finance/year-end/closes/:id/reopen` | company-item | accounting | [Year-end close](API.md#year-end-close) |  | financeStatements.ts:61 |
| GET | `/finance/profitability/options` | company-list | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:29 |
| PUT | `/finance/profitability/settings` | company-write | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:30 |
| GET | `/finance/profitability/projects` | company-export | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:34 |
| GET | `/finance/profitability/projects/:id` | company-item | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:39 |
| GET | `/finance/profitability/events` | company-export | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:42 |
| GET | `/finance/profitability/customers` | company-export | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:43 |
| GET | `/finance/profitability/departments` | company-export | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:44 |
| GET | `/finance/profitability/:report/export` | company-export | finance/profitability | [Profitability](API.md#profitability) |  | financeProfitability.ts:36 |
| GET | `/finance/tax/settings` | company-list | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:22 |
| PATCH | `/finance/tax/settings` | company-write | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:23 |
| GET | `/finance/vat-returns` | company-list | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:27 |
| GET | `/finance/vat-returns/:id` | company-item | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:28 |
| GET | `/finance/vat-returns/:id/boxes/:box` | company-item | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:29 |
| POST | `/finance/vat-returns/:id/file` | company-item | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:30 |
| POST | `/finance/vat-returns/:id/pay` | company-item | accounting | [VAT returns](API.md#vat-returns) |  | financeTax.ts:34 |
| GET | `/finance/tax/corporate-tax` | company-export | accounting | [Corporate tax & zakat](API.md#corporate-tax--zakat) |  | financeTax.ts:38 |
| GET | `/finance/tax/zakat` | company-export | accounting | [Corporate tax & zakat](API.md#corporate-tax--zakat) |  | financeTax.ts:39 |
| POST | `/finance/tax/provisions` | company-write | accounting | [Corporate tax & zakat](API.md#corporate-tax--zakat) |  | financeTax.ts:44 |
| PUT | `/finance/tax/adjustments` | company-write | accounting | [Corporate tax & zakat](API.md#corporate-tax--zakat) |  | financeTax.ts:40 |
| GET | `/finance/budgets` | company-list | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:52 |
| POST | `/finance/budgets` | company-write | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:53 |
| GET | `/finance/budgets/:id` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:57 |
| PUT | `/finance/budgets/:id/lines` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:59 |
| POST | `/finance/budgets/:id/copy-actuals` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:63 |
| POST | `/finance/budgets/:id/approve` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:67 |
| POST | `/finance/budgets/:id/reopen` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:68 |
| DELETE | `/finance/budgets/:id` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:58 |
| GET | `/finance/budgets/:id/vs-actual` | company-item | accounting | [Budgets](API.md#budgets) |  | financeTax.ts:69 |
| GET | `/finance/forecast` | company-export | accounting | [Cash-flow forecast](API.md#cash-flow-forecast) |  | financeTax.ts:72 |
| PUT | `/finance/forecast/settings` | company-write | accounting | [Cash-flow forecast](API.md#cash-flow-forecast) |  | financeTax.ts:73 |
| POST | `/finance/forecast/lines` | company-write | accounting | [Cash-flow forecast](API.md#cash-flow-forecast) |  | financeTax.ts:77 |
| DELETE | `/finance/forecast/lines/:id` | company-item | accounting | [Cash-flow forecast](API.md#cash-flow-forecast) |  | financeTax.ts:81 |

## AI assistant

API.md: [AI assistant](API.md#ai-assistant)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| GET | `/ai/me` | company-list | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:21 |
| GET | `/ai/conversations` | company-list | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:29 |
| POST | `/ai/conversations` | company-write | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:30 |
| GET | `/ai/conversations/:id` | company-item | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:34 |
| PATCH | `/ai/conversations/:id` | company-item | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:35 |
| DELETE | `/ai/conversations/:id` | company-item | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:39 |
| POST | `/ai/actions/:id/confirm` | company-item | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:45 |
| POST | `/ai/actions/:id/cancel` | company-item | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:49 |
| GET | `/ai/settings` | company-list | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:22 |
| PUT | `/ai/settings` | company-write | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:23 |
| GET | `/ai/usage` | company-list | ai | [AI assistant › Endpoints](API.md#endpoints-4) |  | ai.ts:27 |

## Integrations

API.md: [Integrations](API.md#integrations)

| Method | Path | Kind | Module | Documented in | Production | Handler |
|---|---|---|---|---|---|---|
| PATCH | `/integrations/state/:key` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:24 |
| POST | `/integrations/oauth/start` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:28 |
| GET | `/integrations/email` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:34 |
| PUT | `/integrations/email/smtp` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:36 |
| POST | `/integrations/email/connect` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:40 |
| DELETE | `/integrations/email` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:44 |
| POST | `/integrations/email/test` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:45 |
| POST | `/integrations/email/verify-domain` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:49 |
| PATCH | `/integrations/email/senders` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:50 |
| GET | `/integrations/email/log` | company-export | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:35 |
| GET | `/integrations/website` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:56 |
| PUT | `/integrations/website/webhook` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:57 |
| POST | `/integrations/website/webhook/rotate` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:61 |
| POST | `/integrations/website/webhook/preview` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:62 |
| POST | `/public/integrations/forms/:token` | public | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:67 |
| GET | `/integrations/whatsapp` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:74 |
| PUT | `/integrations/whatsapp` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:75 |
| DELETE | `/integrations/whatsapp` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:79 |
| POST | `/integrations/whatsapp/templates` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:80 |
| DELETE | `/integrations/whatsapp/templates/:id` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:84 |
| GET | `/integrations/whatsapp/send-options` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:85 |
| POST | `/integrations/whatsapp/messages` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:86 |
| GET | `/integrations/whatsapp/conversations` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:90 |
| POST | `/integrations/whatsapp/inbound` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) | simulation: replace with Meta webhook | integrations.ts:91 |
| POST | `/integrations/whatsapp/conversations/:id/lead` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:95 |
| GET | `/integrations/calendar/me` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:101 |
| POST | `/integrations/calendar/me/connect` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:102 |
| PATCH | `/integrations/calendar/me` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:106 |
| POST | `/integrations/calendar/me/sync` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:110 |
| DELETE | `/integrations/calendar/me` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:111 |
| GET | `/integrations/calendar/connections` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:112 |
| GET | `/integrations/payments` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:115 |
| PUT | `/integrations/payments/:provider` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:116 |
| DELETE | `/integrations/payments/:provider` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:120 |
| POST | `/integrations/payments/:provider/default` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:121 |
| POST | `/integrations/payments/:provider/test` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:122 |
| GET | `/integrations/api-keys` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:125 |
| POST | `/integrations/api-keys` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:126 |
| DELETE | `/integrations/api-keys/:id` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:130 |
| GET | `/public/v1/leads` | public | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:152 |
| POST | `/public/v1/leads` | public | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:153 |
| GET | `/integrations/webhooks` | company-list | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:131 |
| POST | `/integrations/webhooks` | company-write | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:132 |
| PATCH | `/integrations/webhooks/:id` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:136 |
| DELETE | `/integrations/webhooks/:id` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:140 |
| GET | `/integrations/webhooks/:id/deliveries` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:141 |
| POST | `/integrations/webhooks/:id/test` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:142 |
| POST | `/integrations/webhook-deliveries/:id/retry` | company-item | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:143 |
| GET | `/integrations/sync-log` | company-export | integrations | [Integrations › Endpoints](API.md#endpoints-5) |  | integrations.ts:146 |

## Error code catalog

Machine `code` values the mock services throw (238), extracted from `src/shared/mocks/services/`
(`CodedApiError` and the per-service `invalid` / `bad` / `conflict` helpers). Body:
`{ message, code, ...extra fields }`. **In API.md** = the code appears in docs/API.md; the ones marked **no** are
not yet listed next to their endpoint, the message shows where they come from. The same code can be thrown by
several endpoints. Codes thrown from handlers (auth, tenant, billing policy, platform) are in API.md › Multi-tenancy,
Auth and Plans; codes built dynamically are not listed.

| Status | Code | In API.md | Thrown in (services) | Example message |
|---|---|---|---|---|
| 401 | `invalid_api_key` | yes | `services/integrationsDeveloper.ts` |  |
| 401 | `platform_auth_required` | yes | `handlers/utils.ts` |  |
| 401 | `session_expired` | yes | `handlers/utils.ts`, `services/auth.ts` |  |
| 402 | `card_declined` | yes | `services/financeCollections.ts` | The card was declined. Try another card. |
| 403 | `ai_disabled` | yes | `services/ai.ts` |  |
| 403 | `already_approved_step` | yes | `services/financeApprovals.ts` | You already approved a step of this request. |
| 403 | `approve_forbidden` | yes | `services/financeBudgets.ts` | Only Management or a Company Admin can approve or reopen a budget. |
| 403 | `duplicate_lead` | yes | `services/eventSponsors.ts` | Possible duplicate: … (…, owned by …) already exists. Pick that lead, or ask a manager to add it anyway. |
| 403 | `forbidden` | yes | `services/ai.ts`, `services/financeBanking.ts`, `services/financeBudgets.ts`, `services/financeCollectionsCore.ts`, `services/financeCommissions.ts`, `services/financeEosb.ts`, `services/financeExpensesClaims.ts`, `services/financeExpensesCore.ts`, `services/financeForecast.ts`, `services/financeLedger.ts`, `services/financePayrollGl.ts`, `services/financeProfitability.ts`, `services/financePurchases.ts`, `services/financeReceivables.ts`, `services/financeStatements.ts`, `services/financeTax.ts`, `services/hrEngagementCore.ts`, `services/hrPerformanceCore.ts`, `services/hrReports.ts`, `services/hrTimeAccess.ts`, `services/integrationsCore.ts`, `services/reportsHub.ts`, `services/reportsPerformance.ts` | Only a Company Admin can change the AI assistant settings. |
| 403 | `insufficient_scope` | yes | `services/integrationsDeveloper.ts` | This key has no …:… scope. |
| 403 | `lock_date_forbidden` | yes | `services/financeLedger.ts` | Only a Company Admin or an Accountant can move the lock date. |
| 403 | `maker_checker` | yes | `services/hrPayroll.ts` | Maker–checker: another HR user (Company Admin, Management or HR Manager) must approve the run you calculated. |
| 403 | `module_not_in_plan` | yes | `services/won.ts` | This feature isn’t included in your … plan. Upgrade to use it. |
| 403 | `no_employee_record` | yes | `services/hrTimeAccess.ts` | You don’t have an active employee record in this company. Ask HR to add you. |
| 403 | `not_impersonating` | yes | `services/auth.ts` | This is not a support session. |
| 403 | `not_owner` | yes | `services/financeExpensesClaims.ts` | Only the employee who made the claim can change it. |
| 403 | `not_your_step` | yes | `services/financeApprovals.ts`, `services/financeCommissions.ts` | This step needs another approver. |
| 403 | `own_department_only` | yes | `services/financePurchases.ts` | You can request purchases for your own department only. |
| 403 | `own_fund` | yes | `services/financeExpensesPetty.ts` | You hold this fund: another accountant replenishes it. |
| 403 | `own_request` | yes | `services/financeApprovals.ts`, `services/hrLetters.ts` | You can’t approve your own request. |
| 403 | `platform_forbidden` | yes | `handlers/utils.ts` | Your platform role doesn’t allow this. |
| 403 | `reopen_forbidden` | yes | `services/financeStatements.ts` | Only a Company Admin can re-open a closed year. |
| 403 | `tenant_mismatch` | yes | `handlers/utils.ts` | You are signed in to a different workspace than the one this address belongs to. |
| 403 | `tool_disabled` | yes | `services/ai.ts` | The “…” tool is turned off for your company. |
| 403 | `workspace_suspended` | yes | `handlers/utils.ts`, `services/auth.ts` | This workspace is suspended. Contact your administrator. |
| 403 | `write_tools_disabled` | yes | `services/ai.ts` | Changes through the assistant are turned off for your role. |
| 403 | `year_end_forbidden` | yes | `services/financeStatements.ts` | Only a Company Admin or an Accountant can close a fiscal year (it moves the lock date). |
| 404 | `event_not_found` | yes | `services/events.ts` | This registration link isn’t valid. |
| 404 | `form_not_found` | yes | `services/leadGen.ts` | This form isn’t available. |
| 404 | `letter_not_found` | yes | `services/hrLetters.ts` |  |
| 404 | `not_found` | yes | `services/financeProfitability.ts`, `services/hrEngagementCore.ts`, `services/hrPerformanceCore.ts`, `services/hrReports.ts`, `services/hrTimeAccess.ts`, `services/ledger.ts`, `services/reportsHub.ts` | Journal entry not found. |
| 404 | `page_not_found` | yes | `services/leadGen.ts` | This page isn’t available. |
| 404 | `payment_link_not_found` | yes | `services/financeCollections.ts` |  |
| 404 | `survey_not_found` | yes | `services/eventSurvey.ts` | This survey link isn’t valid. |
| 404 | `ticket_not_found` | yes | `services/eventCheckIn.ts` | This ticket link isn’t valid. |
| 404 | `webhook_not_found` | yes | `services/integrations.ts` |  |
| 404 | `workspace_not_found` | yes | `handlers/utils.ts`, `services/auth.ts` | Workspace not found. |
| 409 | `action_not_pending` | yes | `services/ai.ts` | This proposal was already handled. |
| 409 | `already_enrolled` | yes | `services/hrTraining.ts` | Everyone picked is already on this session. |
| 409 | `already_filed` | yes | `services/financeTax.ts` | This return is already filed. |
| 409 | `already_matched` | yes | `services/financeBanking.ts` | A line is already matched: unmatch it first. |
| 409 | `already_paid` | yes | `services/financeTax.ts` | This return is already paid. |
| 409 | `already_reconciled` | yes | `services/financeBanking.ts` | This account is reconciled up to …: choose a later statement date. |
| 409 | `already_registered` | yes | `services/events.ts` | … is already registered for …. |
| 409 | `already_reopened` | yes | `services/financeStatements.ts` | This close was already re-opened. |
| 409 | `already_reversed` | yes | `services/financeLedger.ts`, `services/ledger.ts` | This entry is already reversed. |
| 409 | `already_sponsor` | yes | `services/eventSponsors.ts` | … is already a sponsor of …. |
| 409 | `already_submitted` | yes | `services/eventSurvey.ts` | You’ve already answered this survey. Thank you! |
| 409 | `already_undone` | **no** | `services/financeBanking.ts` | This reconciliation is already undone. |
| 409 | `already_void` | yes | `services/financeBanking.ts`, `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | This transfer is already void. |
| 409 | `application_closed` | **no** | `services/hrRecruitment.ts` | This candidate is no longer in the pipeline. |
| 409 | `bill_not_open` | yes | `services/financePurchasesCore.ts` | Bill … isn’t open. |
| 409 | `bill_void` | yes | `services/financePurchasesCore.ts` | The bill of this debit note is void. |
| 409 | `budget_locked` | yes | `services/financeBudgets.ts` | This budget is approved and locked. Ask Management to reopen it first. |
| 409 | `chart_not_empty` | yes | `services/financeLedger.ts` | Your chart of accounts isn’t empty. The template only fills an empty chart. |
| 409 | `company_deleted` | yes | `services/auth.ts` | This workspace has been deleted. |
| 409 | `company_locked` | yes | `services/auth.ts` | This workspace is locked. Reactivate it before opening a support session. |
| 409 | `credit_blocked` | yes | `services/financeReceivables.ts` | Credit check failed. |
| 409 | `default_account` | yes | `services/financeLedger.ts` | This is a default account in Finance settings. Choose another default first. |
| 409 | `duplicate_application` | yes | `services/hrRecruitment.ts` | … has already applied to …. |
| 409 | `duplicate_budget` | yes | `services/financeBudgets.ts` | There is already a budget for …. |
| 409 | `duplicate_candidate` | yes | `services/hrRecruitment.ts` | … is already a candidate with this …. |
| 409 | `duplicate_code` | yes | `services/financeLedger.ts` | Code … is already used in your chart. |
| 409 | `duplicate_lead` | yes | `services/eventSponsors.ts` | Possible duplicate: … (…, owned by …) already exists. Pick that lead, or ask a manager to add it anyway. |
| 409 | `duplicate_rate` | yes | `services/financeLedger.ts` | There is already a … rate effective …. Delete it first. |
| 409 | `duplicate_supplier_invoice` | yes | `services/financePurchasesCore.ts` | This supplier’s invoice … is already entered. |
| 409 | `earlier_run_unpaid` | yes | `services/hrPayroll.ts` | Pay … first. |
| 409 | `email_taken` | yes | `services/settingsUsers.ts` |  |
| 409 | `event_cancelled` | yes | `services/eventComms.ts` | This event was cancelled. |
| 409 | `event_completed` | yes | `services/events.ts` | A completed event can’t be cancelled. |
| 409 | `form_closed` | yes | `services/leadGen.ts` | This form can’t take responses right now. |
| 409 | `form_paused` | yes | `services/leadGen.ts` | This form isn’t accepting responses right now. |
| 409 | `frequency_misaligned` | yes | `services/financeTax.ts` | The last filed return doesn’t end on a calendar quarter: file the remaining months of the quarter monthly first. |
| 409 | `has_active_children` | yes | `services/financeLedger.ts` | Deactivate its sub-accounts first. |
| 409 | `has_balance` | yes | `services/financeLedger.ts` | The account still has a balance. Move it to another account with a journal entry first. |
| 409 | `has_children` | yes | `services/financeLedger.ts` | Move or remove its sub-accounts before changing the type. |
| 409 | `has_matches` | yes | `services/financeBanking.ts` | Some lines of this statement are matched: unmatch them first. |
| 409 | `has_postings` | yes | `services/financeLedger.ts` | This account has postings: its type can’t change. Create a new account instead. |
| 409 | `has_reconciliations` | yes | `services/financeBanking.ts` | This account has finished reconciliations: undo them before moving “reconcile from”. |
| 409 | `has_settlements` | yes | `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | An invoice with payments or credit notes can’t be voided. Issue a credit note instead. |
| 409 | `interview_cancelled` | **no** | `services/hrRecruitment.ts` | This interview was cancelled. |
| 409 | `invalid_stage` | yes | `services/eventSponsors.ts` |  |
| 409 | `invalid_stage_move` | yes | `services/hrRecruitment.ts` | Interview the candidate before making an offer. |
| 409 | `invalid_transition` | yes | `services/hrRecruitment.ts` | An opening can’t go from … to …. |
| 409 | `is_draft` | yes | `services/financeInvoiceCore.ts` | A draft isn’t posted: delete it instead. |
| 409 | `is_reversal` | yes | `services/financeLedger.ts` | This entry is itself a reversal. |
| 409 | `journey_closed` | yes | `services/hrJourney.ts` | This … is …. |
| 409 | `journey_exists` | yes | `services/hrJourney.ts` | … already has a … in progress. |
| 409 | `later_year_closed` | yes | `services/financeStatements.ts` |  |
| 409 | `ledger_account_in_use` | yes | `services/financeBanking.ts` | Another bank account already uses this ledger account. |
| 409 | `loan_closed` | yes | `services/hrPayroll.ts` | This loan is closed. |
| 409 | `loan_repaying` | yes | `services/hrPayroll.ts` | Part of this loan is repaid: it can’t be cancelled; change the installment instead. |
| 409 | `managed_by_finance` | yes | `services/hrPayroll.ts` | This reimbursement comes from an approved expense claim: Accounts & finance manages it. |
| 409 | `managed_by_logistics` | yes | `services/eventBudget.ts` | This line follows a … in Travel & logistics: change the … there. |
| 409 | `missing_system_account` | yes | `services/financeCollectionsCore.ts`, `services/financeEosb.ts`, `services/ledger.ts` | The chart of accounts has no active Bank charges (6800) account. |
| 409 | `missing_tax_account` | **no** | `services/financeTax.ts` | The chart has no active liability 2700 (corporate tax / zakat payable). |
| 409 | `not_applicable` | yes | `services/financeTax.ts` | Corporate tax applies to UAE companies; KSA companies see the zakat estimate. |
| 409 | `not_approved` | yes | `services/financeBudgets.ts` | Only an approved budget can be reopened. |
| 409 | `not_attended` | **no** | `services/hrTraining.ts` | You can rate a training once you attended it. |
| 409 | `not_draft` | yes | `services/financeBudgets.ts`, `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | An approved budget can’t be deleted. Reopen it first. |
| 409 | `not_filed` | yes | `services/financeTax.ts` | File the return before recording its payment. |
| 409 | `not_issued` | yes | `services/financeInvoiceCore.ts` | Credit notes are for issued invoices. |
| 409 | `not_latest` | yes | `services/financeBanking.ts` | Undo the later reconciliations of this account first. |
| 409 | `not_open` | **no** | `services/financePurchasesCore.ts` | Debit notes are for open bills with a balance. |
| 409 | `not_pending` | yes | `services/financeCommissions.ts` | Nothing to approve. |
| 409 | `not_posted` | yes | `services/financePurchasesCore.ts` | Only a posted bill can be voided; delete a draft instead. |
| 409 | `not_receivable` | **no** | `services/financePurchasesCore.ts` | Goods can be received on an approved order only. |
| 409 | `not_registered` | yes | `services/events.ts` | … is on the waitlist, not registered yet. |
| 409 | `nothing_to_pay` | yes | `services/financeTax.ts` | Nothing to pay: this return is a credit carried forward. |
| 409 | `nothing_to_post` | yes | `services/financeTax.ts` | The provision already matches the estimate. |
| 409 | `offer_exists` | yes | `services/hrRecruitment.ts` | This candidate already has an open offer. |
| 409 | `offer_expired` | yes | `services/hrRecruitment.ts` | This offer expired before it was accepted. |
| 409 | `offer_locked` | yes | `services/hrRecruitment.ts` | Only a draft offer can be edited. |
| 409 | `opening_filled` | yes | `services/hrRecruitment.ts` | Every position is filled. Raise the headcount before reopening. |
| 409 | `opening_not_open` | yes | `services/hrRecruitment.ts` | Candidates can only apply to open openings. |
| 409 | `package_in_use` | yes | `services/eventSponsors.ts` | Sponsors are on the … package: move or delete them first. |
| 409 | `period_open` | yes | `services/financeTax.ts` | The period ends on …: file it once the period has ended. |
| 409 | `quantity_below_sold` | yes | `services/eventSponsors.ts` | … … slot… already signed: the quantity can’t be lower. |
| 409 | `reconciled` | yes | `services/financeBanking.ts` | This match is part of a finished reconciliation: undo the reconciliation first. |
| 409 | `registration_closed` | yes | `services/events.ts` |  |
| 409 | `run_draft` | **no** | `services/hrPayroll.ts` | The run is already a draft. |
| 409 | `run_exists` | yes | `services/hrPayroll.ts` | There is already a run for …. |
| 409 | `run_locked` | yes | `services/hrPayroll.ts` | This adjustment is in a paid run: add a correction in a later month instead. |
| 409 | `run_not_approved` | yes | `services/hrPayroll.ts` | Only an approved run can be marked paid. |
| 409 | `run_not_calculated` | yes | `services/hrPayroll.ts` | Warnings are acknowledged on a calculated run. |
| 409 | `run_paid` | yes | `services/financePayrollGl.ts` | This run is paid: its payment entry is posted. |
| 409 | `session_cancelled` | yes | `services/hrTraining.ts` | This session was cancelled. |
| 409 | `session_full` | yes | `services/hrTraining.ts` | Only … seats are left. |
| 409 | `session_not_started` | yes | `services/hrTraining.ts` | This session hasn’t started yet. |
| 409 | `session_overlap` | yes | `services/eventAgenda.ts` | … is taken by “…” (… …–…). |
| 409 | `settlement_exists` | yes | `services/hrPayroll.ts` | … already has a final settlement. |
| 409 | `settlement_paid` | yes | `services/hrPayroll.ts` | This settlement is paid and locked. |
| 409 | `slug_taken` | yes | `services/leadGen.ts` | Another landing page already uses /p/…. |
| 409 | `sold_out` | yes | `services/eventSponsors.ts` | … is sold out (… of … signed). Raise the quantity or pick another package. |
| 409 | `source_document` | yes | `services/financeLedger.ts` | This entry was posted from a …. Correct it from that document. |
| 409 | `speaker_exists` | yes | `services/eventLibrary.ts` |  : ''}. |
| 409 | `survey_closed` | yes | `services/eventSurvey.ts` |  |
| 409 | `system_role` | yes | `services/financeLedger.ts` | A system account’s type can’t change. |
| 409 | `tax_expense_account` | **no** | `services/financeTax.ts` | Account 6960 must be an active, postable expense account for the tax provision. |
| 409 | `ticket_not_on_sale` | yes | `services/events.ts` | … tickets aren’t on sale right now. |
| 409 | `trip_exists` | yes | `services/eventLogistics.ts` | … already has a trip for …: edit that one. |
| 409 | `unresolved_warnings` | yes | `services/hrPayroll.ts` | … warning… to resolve (fix and recalculate) or acknowledge first. |
| 409 | `use_won_flow` | yes | `services/leads.ts` |  |
| 409 | `user_deactivated` | yes | `services/auth.ts` | This user is deactivated and can’t be impersonated. |
| 409 | `vat_payable_account` | **no** | `services/financeTax.ts` | Account 2210 must be an active, postable liability to hold VAT payable to the tax authority. |
| 409 | `vendor_exists` | yes | `services/eventLibrary.ts` | A vendor named … already exists. |
| 409 | `venue_exists` | yes | `services/eventLibrary.ts` | A venue named … already exists. |
| 409 | `webhook_paused` | yes | `services/integrations.ts` | This webhook is paused. |
| 409 | `workspace_required` | yes | `services/auth.ts` | This email is used in more than one workspace. Open your workspace’s address to sign in. |
| 422 | `amounts_differ` | yes | `services/financeBanking.ts` | The amounts don’t agree: statement … vs book …. |
| 422 | `before_reconcile_from` | yes | `services/financeBanking.ts` | That book line is before “reconcile from” (already part of the opening balance). |
| 422 | `before_start` | yes | `services/financeEosb.ts` | The provision starts in …. |
| 422 | `budget_line_not_found` | **no** | `services/financePurchasesCore.ts` | Line …: budget line not found on this event. |
| 422 | `consent_denied` | yes | `services/integrationsCore.ts` | Access wasn’t granted, so nothing was connected. |
| 422 | `consent_required` | yes | `services/leadGen.ts` | Tick the consent box to continue. |
| 422 | `currency_mismatch` | yes | `services/financeBanking.ts`, `services/financePurchasesCore.ts` | The ledger account is in …. |
| 422 | `department_not_found` | **no** | `services/financePurchasesCore.ts` | Line …: department not found. |
| 422 | `difference_not_zero` | yes | `services/financeBanking.ts` | The statement balance and the cleared book balance differ by …. Match or create the missing lines first. |
| 422 | `duplicate_bill` | **no** | `services/financePurchasesCore.ts` | A bill appears twice. |
| 422 | `empty_budget` | yes | `services/financeBudgets.ts` | Add at least one line before approving. |
| 422 | `empty_statement` | yes | `services/financeBanking.ts` | No new lines to import (all are duplicates or invalid). |
| 422 | `event_not_found` | yes | `services/financePurchasesCore.ts` | Line …: event not found. |
| 422 | `event_source_missing` | yes | `services/events.ts`, `services/eventSponsors.ts` |  |
| 422 | `exceeds_advance` | yes | `services/financePurchasesCore.ts` | At most … … of this advance is unapplied. |
| 422 | `exceeds_balance` | yes | `services/financePurchasesCore.ts` | At most … … (the bill’s balance) can be credited. |
| 422 | `exceeds_line` | yes | `services/financeInvoiceCore.ts` | At most … … of “…” can still be credited. |
| 422 | `future_date` | **no** | `services/financeInvoiceCore.ts` | The issue date can’t be in the future. |
| 422 | `invalid_account` | yes | `services/financeBanking.ts`, `services/financeBudgets.ts`, `services/financeCollectionsCore.ts`, `services/financeInvoiceCore.ts`, `services/financeLedger.ts`, `services/financePayrollGl.ts`, `services/financePurchasesCore.ts`, `services/financeTax.ts`, `services/ledger.ts` | Choose an active, postable account under 1100 Cash and bank. |
| 422 | `invalid_action` | yes | `services/ai.ts` | This action can’t be run. |
| 422 | `invalid_amount` | **no** | `services/financePurchasesCore.ts` | The amount must be greater than 0. |
| 422 | `invalid_bank_account` | **no** | `services/financeBanking.ts` | Choose the account the money leaves. |
| 422 | `invalid_card` | yes | `services/financeCollections.ts` | Enter the name on the card. |
| 422 | `invalid_charges` | **no** | `services/financePurchasesCore.ts` | Bank charges must be 0 or more. |
| 422 | `invalid_currency` | yes | `services/financePurchasesCore.ts` | Currency must be a 3-letter ISO code. |
| 422 | `invalid_date` | **no** | `services/financePurchasesCore.ts` | The application date is before the advance or the bill. |
| 422 | `invalid_department` | yes | `services/financeBudgets.ts` | Choose a department of the company. |
| 422 | `invalid_dimension` | yes | `services/financeLedger.ts` | Unknown dimension value. |
| 422 | `invalid_due_date` | **no** | `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | The due date can’t be before the issue date. |
| 422 | `invalid_fiscal_year` | yes | `services/financeStatements.ts` | … isn’t the last day of a fiscal year (the fiscal year starts in month …). |
| 422 | `invalid_journal_line` | **no** | `services/financeBanking.ts` | Unknown book line of this account. |
| 422 | `invalid_line` | yes | `services/financeInvoiceCore.ts`, `services/financeLedger.ts`, `services/ledger.ts` | Line not found on this invoice. |
| 422 | `invalid_lines` | yes | `services/financeBanking.ts` | … line… can’t be read: … |
| 422 | `invalid_mapping` | **no** | `services/financeBanking.ts` | Map the … column. |
| 422 | `invalid_month` | **no** | `services/financeEosb.ts` | month is yyyy-MM. |
| 422 | `invalid_organization` | yes | `services/eventSponsors.ts` | That lead doesn’t exist. |
| 422 | `invalid_package` | yes | `services/eventSponsors.ts` |  |
| 422 | `invalid_parent` | yes | `services/financeLedger.ts` | Choose a header account of your chart as the parent. |
| 422 | `invalid_rate` | **no** | `services/financeCollectionsCore.ts`, `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | Exchange rate must be a positive number. |
| 422 | `invalid_registration` | yes | `services/events.ts` | Pick a ticket. |
| 422 | `invalid_statement_line` | **no** | `services/financeBanking.ts` | Unknown statement line. |
| 422 | `invalid_submission` | yes | `services/integrations.ts`, `services/leadGen.ts` |  |
| 422 | `invalid_survey` | yes | `services/eventSurvey.ts` | Rate the event from 1 to 5. |
| 422 | `invalid_tax_code` | yes | `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | Line …: unknown or inactive tax code. |
| 422 | `invalid_ticket` | **no** | `services/events.ts` | That ticket type doesn’t exist for this event. |
| 422 | `invalid_user` | yes | `services/financeCommissions.ts` | Unknown user. |
| 422 | `invalid_vat_number` | yes | `services/financeLedger.ts` |  |
| 422 | `invalid_year` | **no** | `services/financeEosb.ts` | year is yyyy. |
| 422 | `items_open` | yes | `services/hrJourney.ts` | Finish the required items first: …. |
| 422 | `loan_repaying` | yes | `services/hrPayroll.ts` | Part of this loan is repaid: it can’t be cancelled; change the installment instead. |
| 422 | `lost_reason_required` | yes | `services/eventSponsors.ts` | Give a reason the sponsor was lost. |
| 422 | `missing_exchange_rate` | yes | `services/financeRates.ts` | No exchange rate for … on or before …. Add one in Finance settings › Exchange rates. |
| 422 | `missing_rate` | **no** | `services/financeCollectionsCore.ts` | No exchange rate for …. Add one in Finance settings or type the rate. |
| 422 | `mixed_currencies` | **no** | `services/financePurchasesCore.ts` | Every bill of a payment must be in the same currency. |
| 422 | `mixed_suppliers` | **no** | `services/financePurchasesCore.ts` | Every bill of a payment must be from the same supplier. |
| 422 | `month_not_closed` | yes | `services/financeEosb.ts` | Only a closed month can be accrued (up to …). |
| 422 | `month_paid` | yes | `services/hrPayroll.ts` | … is already paid: put the correction in a later month. |
| 422 | `no_allocations` | **no** | `services/financePurchasesCore.ts` | Choose at least one bill to pay. |
| 422 | `no_code` | **no** | `services/financeBanking.ts` | No free account code left under 1100 Cash and bank. |
| 422 | `no_contract` | yes | `services/hrPayroll.ts` | … has no contract: the settlement needs the basic salary. |
| 422 | `no_employee_record` | yes | `services/financeExpensesClaims.ts` | You have no employee record, so you can’t claim expenses. Ask HR to add you. |
| 422 | `no_lines` | **no** | `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | Add at least one line. |
| 422 | `not_leaving` | yes | `services/hrPayroll.ts` | … is not leaving: set the status to Notice period or Left (with the exit date) first. |
| 422 | `not_organizer` | yes | `services/eventSponsors.ts` | Sponsors and exhibitors are for events your company organizes. |
| 422 | `nothing_received` | **no** | `services/financePurchasesCore.ts` | Enter a received quantity on at least one line. |
| 422 | `nothing_to_credit` | yes | `services/financeInvoiceCore.ts` | Choose what to credit. |
| 422 | `oauth_state_invalid` | yes | `services/integrationsCore.ts` | This sign-in link has expired. Start again. |
| 422 | `over_received` | yes | `services/financePurchasesCore.ts` | “…”: at most … more can be received. |
| 422 | `payment_before_bill` | **no** | `services/financePurchasesCore.ts` | Bill … is dated after the payment. |
| 422 | `po_line_not_found` | **no** | `services/financePurchasesCore.ts` | Line …: PO line not found. |
| 422 | `policy_blocked` | yes | `services/financeExpensesClaims.ts` |  |
| 422 | `project_not_found` | yes | `services/financePurchasesCore.ts` | Line …: project not found. |
| 422 | `rate_required` | yes | `services/financeInvoiceCore.ts` | Enter the exchange rate from … to …. |
| 422 | `reason_required` | yes | `services/auth.ts` | Give a reason of at least 10 characters. The company admin sees it in their audit log. |
| 422 | `run_exists` | yes | `services/hrPayroll.ts` | There is already a run for …. |
| 422 | `run_not_approved` | yes | `services/hrPayroll.ts` | Only an approved run can be marked paid. |
| 422 | `service_not_found` | yes | `services/financeInvoiceCore.ts` | Line …: service not found. |
| 422 | `settings_incomplete` | yes | `services/hrPayroll.ts` | Set the WPS employer id and routing code in the pay settings first. |
| 422 | `supplier_invoice_required` | **no** | `services/financePurchasesCore.ts` | Enter the supplier’s invoice number. |
| 422 | `too_many_lines` | **no** | `services/financeForecast.ts` | Up to 100 manual lines. |
| 422 | `unbalanced` | yes | `services/financeLedger.ts`, `services/ledger.ts` | An entry needs at least two lines. |
| 422 | `use_won_flow` | yes | `services/leads.ts` |  |
| 422 | `validation_failed` | yes | `services/ai.ts`, `services/financeBanking.ts`, `services/financeBudgets.ts`, `services/financeCollectionsCore.ts`, `services/financeCommissions.ts`, `services/financeEosb.ts`, `services/financeForecast.ts`, `services/financeInvoiceCore.ts`, `services/financeLedger.ts`, `services/financeProfitability.ts`, `services/financePurchasesCore.ts`, `services/financeStatements.ts`, `services/financeTax.ts`, `services/hrEngagementCore.ts`, `services/hrJourney.ts`, `services/hrPayroll.ts`, `services/hrPerformanceCore.ts`, `services/hrRecruitment.ts`, `services/hrReports.ts`, `services/hrTimeAccess.ts`, `services/hrTraining.ts`, `services/integrationsCore.ts`, `services/reportsPerformance.ts` | The IBAN looks wrong (two letters, two check digits, then the account). |
| 422 | `vendor_blacklisted` | yes | `services/eventLibraryCore.ts` | … is blacklisted and can’t be picked for budget lines. Pick another vendor or ask a marketing manager. |
| 422 | `vendor_mismatch` | yes | `services/financePurchasesCore.ts` | The bill is from another supplier. |
| 422 | `zero_total` | **no** | `services/financeInvoiceCore.ts`, `services/financePurchasesCore.ts` | The invoice total must be greater than 0. |
| 423 | `period_locked` | yes | `services/financeLedger.ts` | The books are locked up to …. Use a later date, or ask a Company Admin or Accountant to move the lock date. |
| 423 | `workspace_read_only` | yes | `services/integrationsDeveloper.ts`, `services/won.ts` | This workspace is read-only. |
| 429 | `rate_limited` | yes | `services/ai.ts`, `services/rateLimit.ts` | You’re sending messages to the assistant too quickly. Try again in … seconds. |
