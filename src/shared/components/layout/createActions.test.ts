import { describe, expect, it } from 'vitest'
import type { Role } from '@/shared/types'
import { ROLES } from '@/shared/lib/constants'
import { PATHS } from '@/app/paths'
import { MARKETING_PATHS } from '@/modules/marketing/paths'
import { planOf } from '@/shared/mocks/data/plans'
import {
  CREATE_ACTIONS,
  COMMON_BY_ROLE,
  availableCreateActions,
  commonCreateActions,
  createCommandLabel,
  searchCreateActions,
} from './createActions'

const apex = { modules: planOf('enterprise').modules } // co_apex
const crest = { modules: planOf('business').modules } // co_crest: no hr
const ids = (role: Role, entitlements = apex) => availableCreateActions({ role, entitlements }).map((a) => a.id).sort()

const SELF = ['design-request', 'leave', 'letter', 'expense-claim', 'purchase-request', 'ai-conversation']
const SALES = ['lead', 'contact', 'customer', 'quotation', 'contract']
const SERVICES = ['service', 'package']
const MARKETING = ['campaign', 'content', 'bulk-email', 'lead-form', 'landing-page', 'utm-link', 'audience', 'brand-asset']
const EVENTS = ['event', 'event-template', 'speaker', 'venue', 'vendor', 'sponsor', 'trip']
const HR_FULL = ['employee', 'onboarding', 'job-opening', 'candidate', 'employee-contract', 'payroll-run', 'course', 'review-cycle', 'survey', 'asset', 'discipline', 'policy']
const FINANCE = ['invoice', 'payment', 'pdc', 'payment-link', 'supplier', 'bill', 'expense', 'bank-account', 'transfer', 'commission-plan', 'budget', 'ledger-account', 'journal-entry']
const HR_AREA = new Set([...HR_FULL, 'leave', 'letter'])

const EXPECTED: Record<Role, string[]> = {
  'Company Admin': [...SELF, ...SALES, ...SERVICES, 'task', 'project', ...MARKETING, ...EVENTS, ...HR_FULL, ...FINANCE, 'department', 'user'],
  Management: [...SELF, ...SALES, ...SERVICES, 'task', 'project', ...MARKETING, ...EVENTS, ...HR_FULL, ...FINANCE, 'department'],
  'Sales Manager': [...SELF, ...SALES, ...SERVICES, 'task', 'project'],
  'Sales Agent': [...SELF, ...SALES, 'task'],
  'Marketing Manager': [...SELF, 'task', 'project', ...MARKETING, ...EVENTS],
  Accountant: [...SELF, 'task', ...FINANCE],
  'HR Manager': [...SELF, 'task', ...HR_FULL, 'department'],
  'Department Head': [...SELF, ...SALES, 'task', 'project', 'job-opening'],
  Employee: [...SELF, ...SALES, 'task'],
}

describe('create actions registry', () => {
  it('has unique ids and covers every role', () => {
    expect(new Set(CREATE_ACTIONS.map((a) => a.id)).size).toBe(CREATE_ACTIONS.length)
    expect(Object.keys(EXPECTED).sort()).toEqual([...ROLES].sort())
  })

  it.each(ROLES)('%s gets exactly what it can create (co_apex, every module)', (role) => {
    expect(ids(role)).toEqual([...EXPECTED[role]].sort())
  })

  it.each(ROLES)('%s on co_crest (plan without hr) gets no HR items', (role) => {
    expect(crest.modules).not.toContain('hr')
    expect(ids(role, crest)).toEqual(EXPECTED[role].filter((id) => !HR_AREA.has(id)).sort())
  })

  it('a Sales Agent sees self-service but no finance / HR-admin items', () => {
    const got = ids('Sales Agent')
    expect(got).toEqual(expect.arrayContaining(['leave', 'expense-claim', 'purchase-request']))
    for (const id of [...FINANCE, ...HR_FULL]) expect(got).not.toContain(id)
  })

  it('shows nothing while the workspace is read-only or entitlements are loading', () => {
    expect(availableCreateActions({ role: 'Company Admin', entitlements: apex, readOnly: true })).toEqual([])
    // Ungated modules still work while entitlements load; gated ones wait.
    const loading = availableCreateActions({ role: 'Company Admin', entitlements: null }).map((a) => a.id)
    expect(loading).toContain('lead')
    expect(loading).not.toContain('invoice')
  })

  it('common group: known ids, up to five, only available ones', () => {
    const known = new Set(CREATE_ACTIONS.map((a) => a.id))
    for (const role of ROLES) {
      for (const id of COMMON_BY_ROLE[role]) expect(known.has(id)).toBe(true)
      const avail = availableCreateActions({ role, entitlements: crest })
      const common = commonCreateActions(role, avail)
      expect(common.length).toBeLessThanOrEqual(5)
      for (const a of common) expect(avail).toContain(a)
    }
  })

  it('search ranks label matches first and the palette says "Create …"', () => {
    const all = availableCreateActions({ role: 'Company Admin', entitlements: apex })
    expect(searchCreateActions(all, 'invoice')[0].id).toBe('invoice')
    expect(searchCreateActions(all, 'vacation')[0].id).toBe('leave')
    expect(createCommandLabel(CREATE_ACTIONS.find((a) => a.id === 'quotation')!)).toBe('Create quotation')
    expect(createCommandLabel(CREATE_ACTIONS.find((a) => a.id === 'leave')!)).toBe('Request leave')
  })
})

/* ---------------- targets ---------------- */

// Source text of the app's components (Vite's raw glob: no Node APIs, so the app's tsconfig types it).
const SOURCES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (p: string) => {
  const text = SOURCES[`/${p}`]
  if (text === undefined) throw new Error(`Source not found: ${p}`)
  return text
}
const router = read('src/app/router.tsx')

/** Route patterns the router mounts: PATHS / MARKETING_PATHS entries it references, plus Settings › Users. */
const ROUTES = new Map<string, boolean>([
  ...Object.entries(PATHS).map(([k, v]) => [v, router.includes(`PATHS.${k}`)] as [string, boolean]),
  ...Object.entries(MARKETING_PATHS).map(([k, v]) => [v, router.includes(`MARKETING_PATHS.${k}`)] as [string, boolean]),
  ['/settings/users', router.includes('path="users"')],
])

/** Where each URL target's trigger is handled: the file and the code that reads the param. */
const HANDLERS: Record<string, { file: string; code: string }> = {
  contact: { file: 'src/modules/crm/pages/ContactsPage.tsx', code: 'useNewParam(' },
  customer: { file: 'src/modules/crm/pages/CustomersPage.tsx', code: 'useNewParam(' },
  contract: { file: 'src/modules/crm/pages/ContractsPage.tsx', code: 'useNewParam(' },
  service: { file: 'src/modules/services/pages/ServiceCatalogPage.tsx', code: 'useNewParam(' },
  package: { file: 'src/modules/services/pages/PackagesPage.tsx', code: 'useNewParam(' },
  task: { file: 'src/modules/tasks/pages/MyTasksPage.tsx', code: 'useNewParam(' },
  project: { file: 'src/modules/tasks/pages/ProjectsPage.tsx', code: 'useNewParam(' },
  campaign: { file: 'src/modules/marketing/pages/CampaignsPage.tsx', code: 'useNewParam(' },
  content: { file: 'src/modules/marketing/creative/pages/ContentCalendarPage.tsx', code: 'useNewParam(' },
  'bulk-email': { file: 'src/modules/marketing/pages/BulkEmailsPage.tsx', code: 'useNewParam(' },
  'lead-form': { file: 'src/modules/marketing/growth/pages/LeadGenerationPage.tsx', code: 'useNewParam(' },
  'landing-page': { file: 'src/modules/marketing/growth/components/LandingPagesTab.tsx', code: 'useNewParam(' },
  'utm-link': { file: 'src/modules/marketing/growth/components/UtmLinksTab.tsx', code: 'useNewParam(' },
  audience: { file: 'src/modules/marketing/growth/pages/AudiencesPage.tsx', code: 'useNewParam(' },
  'brand-asset': { file: 'src/modules/marketing/creative/pages/BrandAssetsPage.tsx', code: 'useNewParam(' },
  'design-request': { file: 'src/modules/marketing/creative/pages/DesignRequestsPage.tsx', code: "params.get('new') === '1'" },
  event: { file: 'src/modules/events/components/EventsFrame.tsx', code: 'useNewParam(' },
  'event-template': { file: 'src/modules/events/pages/EventTemplatesPage.tsx', code: 'useNewParam(' },
  speaker: { file: 'src/modules/events/pages/SpeakersPage.tsx', code: 'useNewParam(' },
  venue: { file: 'src/modules/events/pages/VenuesPage.tsx', code: 'useNewParam(' },
  vendor: { file: 'src/modules/events/pages/VendorsPage.tsx', code: 'useNewParam(' },
  sponsor: { file: 'src/modules/events/pages/EventSponsorsPage.tsx', code: 'useNewParam(' },
  trip: { file: 'src/modules/events/components/LogisticsPanels.tsx', code: 'useNewParam(' },
  leave: { file: 'src/modules/hr/time/pages/LeavePage.tsx', code: "params.get('request')" },
  letter: { file: 'src/modules/hr/selfservice/pages/MyHrPage.tsx', code: "kind: 'letter'" },
  employee: { file: 'src/modules/hr/pages/EmployeesPage.tsx', code: 'useNewParam(' },
  onboarding: { file: 'src/modules/hr/journey/pages/JourneysPage.tsx', code: 'useNewParam(' },
  'job-opening': { file: 'src/modules/hr/pages/RecruitmentPage.tsx', code: "kind: 'opening'" },
  candidate: { file: 'src/modules/hr/pages/RecruitmentPage.tsx', code: "kind: 'candidate'" },
  'employee-contract': { file: 'src/modules/hr/pages/ContractsPage.tsx', code: 'useNewParam(' },
  'payroll-run': { file: 'src/modules/hr/payroll/components/RunsTab.tsx', code: 'useNewParam(' },
  course: { file: 'src/modules/hr/pages/TrainingPage.tsx', code: 'useNewParam(' },
  'review-cycle': { file: 'src/modules/hr/performance/PerformancePage.tsx', code: 'useNewParam(' },
  survey: { file: 'src/modules/hr/engagement/EngagementPage.tsx', code: 'useNewParam(' },
  asset: { file: 'src/modules/hr/pages/AssetsPage.tsx', code: 'useNewParam(' },
  discipline: { file: 'src/modules/hr/compliance/pages/DisciplinePage.tsx', code: 'useNewParam(' },
  policy: { file: 'src/modules/hr/compliance/pages/PoliciesPage.tsx', code: 'useNewParam(' },
  'expense-claim': { file: 'src/modules/finance/expenses/pages/ExpensesPage.tsx', code: "params.get('new') === '1'" },
  expense: { file: 'src/modules/finance/expenses/pages/ExpensesPage.tsx', code: "params.get('new') === '1'" },
  payment: { file: 'src/modules/finance/collections/pages/PaymentsPage.tsx', code: "params.get('record') === '1'" },
  pdc: { file: 'src/modules/finance/collections/components/PdcLinksTabs.tsx', code: 'useNewParam(() => setReceiving(true)' },
  'payment-link': { file: 'src/modules/finance/collections/components/PdcLinksTabs.tsx', code: 'useNewParam(() => setCreating(true)' },
  supplier: { file: 'src/modules/finance/purchases/pages/SuppliersPage.tsx', code: 'useNewParam(' },
  'bank-account': { file: 'src/modules/finance/banking/pages/BankingPage.tsx', code: "useNewParam(() => setEditing('new')" },
  transfer: { file: 'src/modules/finance/banking/pages/BankingPage.tsx', code: 'useNewParam(() => setOpen(true)' },
  'commission-plan': { file: 'src/modules/finance/commissions/pages/CommissionsPage.tsx', code: 'useNewParam(' },
  budget: { file: 'src/modules/finance/planning/components/BudgetsTab.tsx', code: 'useNewParam(' },
  'ledger-account': { file: 'src/modules/finance/ledger/pages/ChartOfAccountsPage.tsx', code: 'useNewParam(' },
  'journal-entry': { file: 'src/modules/finance/ledger/pages/JournalPage.tsx', code: "params.get('new') === '1'" },
  department: { file: 'src/modules/departments/pages/DepartmentsPage.tsx', code: 'useNewParam(' },
  user: { file: 'src/modules/settings/pages/UsersPage.tsx', code: 'useNewParam(' },
  'ai-conversation': { file: 'src/modules/ai-agent/pages/AiAssistantPage.tsx', code: 'useNewParam(' },
}

describe('create action targets', () => {
  it.each(CREATE_ACTIONS.filter((a) => a.target.kind === 'route').map((a) => [a.id, a.target.kind === 'route' ? a.target.to : ''] as const))(
    '%s → %s is a mounted route',
    (_id, to) => {
      const path = to.split('?')[0]
      expect(ROUTES.get(path), `${path} is not a route in router.tsx`).toBe(true)
    },
  )

  it.each(CREATE_ACTIONS.filter((a) => a.target.kind === 'route' && a.target.to.includes('?')).map((a) => [a.id] as const))(
    '%s: the target page handles its param',
    (id) => {
      const h = HANDLERS[id]
      expect(h, `no handler listed for ${id}`).toBeDefined()
      expect(read(h.file)).toContain(h.code)
    },
  )

  it('every ?new=<kind> target uses that kind on its page', () => {
    for (const a of CREATE_ACTIONS) {
      if (a.target.kind !== 'route') continue
      const kind = new URLSearchParams(a.target.to.split('?')[1] ?? '').get('new')
      if (!kind || kind === '1') continue
      expect(read(HANDLERS[a.id].file)).toContain(`kind: '${kind}'`)
    }
  })

  it('/new editors are routed', () => {
    for (const p of [PATHS.quotationNew, PATHS.financeInvoiceNew, PATHS.financeBillNew, PATHS.financePurchaseOrderNew]) expect(ROUTES.get(p)).toBe(true)
  })
})
