# Apex CRM (frontend)

Multi-tenant CRM / ERP frontend. Apex Aora is the first tenant. React 18 + TypeScript + Vite,
Tailwind v4, TanStack Query + Table, Redux Toolkit. Until the backend exists, the API is mocked
in the browser with MSW. The API contract is in [docs/API.md](docs/API.md).

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc
npm test           # vitest (mock services, tenancy, storage rules)
npm run build
```

### Connecting the real backend

```
VITE_API_URL=https://your-backend/api
VITE_API_MOCK=false
```

With `VITE_API_MOCK=false` the mock code, the dev tenant tools and the dev data persistence are
not loaded.

## Tenants and demo accounts (mock)

| Workspace | Address (dev) | Country / currency | Example accounts |
|---|---|---|---|
| Apex Aora | `?workspace=apexaora` | UAE / AED | omar@apexaora.ae (Company Admin), karim@apexaora.ae (Sales Manager) |
| Crest Logistics (synthetic) | `?workspace=crest` | Saudi Arabia / SAR | faisal@crestlogistics.sa (Company Admin), majed@crestlogistics.sa (Sales Manager) |

The password for every demo account is `apex2025`. In production a workspace is opened at
`<subdomain>.apexcrm.app`; in dev use `?workspace=<subdomain>` or `<subdomain>.localhost`.

- **Dev workspace switcher** (header chip, dev only): sign in as any seeded user of either company
  to see isolation (data, palette, currency, enabled modules change).
- **Sign-up**: `/signup` creates a new trial workspace; country, currency and timezone are
  prefilled from the chosen country.
- **Platform console**: `/platform/login` (owner@apexcrm.app, support@apexcrm.app,
  billing@apexcrm.app): tenants, status, impersonation.
- **RTL check**: add `?dir=rtl` (or `?dir=ltr`) to any URL.

## Dev mock data persistence

In dev (and only with the mock API), the mock database is saved in IndexedDB
(`apexcrm-dev-mockdb`) after every change, so a full page refresh keeps your data.
**Reset demo data** in the dev section of the workspace switcher (or `window.__apexDevReset()`)
deletes it and reseeds both synthetic companies. It is never included in production builds and is
not touched by the app's storage clearing (it isn't localStorage/sessionStorage). If the shape of
stored records changes, bump `VERSION` in `src/shared/mocks/persist/registry.ts`.

## Client storage

| Kind | Scope | Cleared |
|---|---|---|
| TanStack Query cache | memory, keys include the company id | sign-in, sign-out, tenant switch, impersonation start/stop |
| UI preferences (table views, column order, filters, sidebar, theme) | `<companyId>:<userId>:apexcrm.pref.*` | never by the app |
| User data (unsaved drafts, cached records) | `<companyId>:<userId>:apexcrm.data.*` | sign-out and tenant switch |
| Session, platform session, workspace address, last theme | `apexcrm.*` | — |

Use `userStorage.pref` / `userStorage.data` from `src/shared/lib/storage.ts`; never call
`localStorage` directly. Details in docs/API.md ("Client storage rules").

## Project layout

```
src/
  app/         router, providers, store, session transitions
  modules/     feature modules (leads, crm, quotations, tasks, settings, tenancy, platform, ...)
  shared/      UI components, lib (phone, region, tax numbers, storage), types
  shared/mocks MSW handlers, mock services (tenant-isolated), seed data, dev persistence
docs/API.md    API contract for the backend
```
