import type { ModuleKey, Role, Scope } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import { GATEABLE_MODULES } from '@/modules/billing/types'
import { scopeOf } from '@/shared/lib/permissions'
import type { ReportId } from '@/modules/reports/types'

/**
 * Reports › Reports hub: THE library of every report in the product, by area. Shared by the mock API (which filters it
 * per role and plan, GET /reports/hub) and the page (icons, grouping). An entry is visible exactly when its screen is:
 * the role's scope on `module` (and `scopes` when set; `alsoModule` must not be hidden either) and the plan module.
 * The phase-1 Reports spec items (leads by status / industry / source, conversion, agent performance, target
 * completion, Excel / PDF export) are the ready-made Sales reports: the hub links to them instead of duplicating them.
 */

export type HubArea = 'management' | 'sales' | 'marketing' | 'events' | 'projects' | 'hr' | 'finance'
export const HUB_AREAS: HubArea[] = ['management', 'sales', 'marketing', 'events', 'projects', 'hr', 'finance']
export const HUB_AREA_LABEL: Record<HubArea, string> = {
  management: 'Management',
  sales: 'Sales',
  marketing: 'Marketing',
  events: 'Events',
  projects: 'Projects & tasks',
  hr: 'HR',
  finance: 'Finance',
}

export interface HubAccess {
  module: ModuleKey
  scopes?: readonly Scope[]
  /** Must not be hidden either (sales reports: reports AND sales). */
  alsoModule?: ModuleKey
  /** Plan module (defaults to `module` when that one is plan-gated). */
  planModule?: PlanModule
}

export interface HubEntry {
  id: string
  area: HubArea
  title: string
  description: string
  path: string
  access: HubAccess
  /** A Sales report that the scheduled e-mail delivery (ScheduleModal) can send. */
  schedule?: ReportId
}

const SALES: HubAccess = { module: 'reports', alsoModule: 'sales' }
const FIN: HubAccess = { module: 'accounting' }
const HR_TEAM: HubAccess = { module: 'hr', scopes: ['full', 'team'] }

const sales = (id: ReportId, title: string, description: string): HubEntry => ({
  id: `sales-${id}`,
  area: 'sales',
  title,
  description,
  path: id === 'status' ? '/sales/reports' : `/sales/reports?report=${id}`,
  access: SALES,
  schedule: id,
})
const hr = (tab: string, title: string, description: string, access: HubAccess = HR_TEAM): HubEntry => ({
  id: `hr-${tab}`,
  area: 'hr',
  title,
  description,
  path: tab === 'overview' ? '/hr/reports' : `/hr/reports?tab=${tab}`,
  access,
})
const profit = (tab: string, title: string, description: string): HubEntry => ({
  id: `finance-profitability-${tab}`,
  area: 'finance',
  title,
  description,
  path: tab === 'projects' ? '/finance/profitability' : `/finance/profitability?tab=${tab}`,
  access: FIN,
})

export const HUB_CATALOG: HubEntry[] = [
  {
    id: 'company-performance',
    area: 'management',
    title: 'Company performance',
    description: 'Management view: revenue, margin, cash, pipeline, delivery, people, department scorecard and alerts.',
    path: '/reports/performance',
    access: { module: 'reports' },
  },
  sales('status', 'Leads by status', 'Where the leads created in the period stand, from New to Won.'),
  sales('industry', 'Leads by industry', 'Volume, value and win rate per industry and sub-industry.'),
  sales('source', 'Leads by source', 'Which channels bring leads and which of them close.'),
  sales('funnel', 'Conversion over time', 'Leads created against deals won, month by month.'),
  sales('agents', 'Agent performance', 'Activity, pipeline progress and results per owner.'),
  sales('targets', 'Monthly target completion', 'Actuals against each agent’s monthly targets.'),
  sales('overdue', 'Overdue follow-ups & tasks', 'Follow-ups and tasks that have slipped, as of today.'),
  { id: 'sales-targets-page', area: 'sales', title: 'Sales targets', description: 'Monthly activity targets per agent with live actuals.', path: '/sales/targets', access: { module: 'sales' } },
  {
    id: 'marketing-analytics',
    area: 'marketing',
    title: 'Marketing analytics',
    description: 'Spend, leads, cost per lead, ROI and funnel across campaigns, email, events and ads.',
    path: '/marketing/analytics',
    access: { module: 'marketing' },
  },
  {
    id: 'event-analytics',
    area: 'events',
    title: 'Event analytics',
    description: 'Attendance, leads, cost per lead, won deals, ROI and NPS of the events held in a period.',
    path: '/events/analytics',
    access: { module: 'marketing', planModule: 'events' },
  },
  { id: 'projects-list', area: 'projects', title: 'Projects', description: 'Delivery projects with progress, logged hours and overdue tasks.', path: '/projects', access: { module: 'tasks' } },
  { id: 'tasks-list', area: 'projects', title: 'All tasks', description: 'Every task you can see, filterable and exportable as a table.', path: '/tasks/list', access: { module: 'tasks' } },
  hr('overview', 'HR overview', 'Headcount, joiners and leavers, absence, open positions and expiring documents.'),
  hr('headcount', 'Headcount', 'Employees by department, type, nationality and tenure.'),
  hr('turnover', 'Turnover', 'Joiners, leavers and turnover rate by month.'),
  hr('attendance', 'Attendance', 'Absence, lateness and overtime in the company timezone.'),
  hr('leave', 'Leave', 'Leave taken and balances by type and department.'),
  hr('recruitment', 'Recruitment', 'Open positions, pipeline funnel and days to hire.'),
  hr('training', 'Training', 'Mandatory training compliance, certificates and spend.'),
  hr('payroll-cost', 'Payroll cost', 'Committed and paid payroll cost by month and department.', { module: 'hr', scopes: ['full'] }),
  { id: 'finance-overview', area: 'finance', title: 'Finance overview', description: 'Cash and bank, receivables, revenue this month vs last and the VAT estimate.', path: '/finance', access: FIN },
  { id: 'finance-trial-balance', area: 'finance', title: 'Trial balance', description: 'Debits and credits by account as of a date.', path: '/finance/journal?tab=trial-balance', access: FIN },
  { id: 'finance-receivables', area: 'finance', title: 'Receivables aging', description: 'Open invoices by customer and age bucket; statements of account.', path: '/finance/receivables', access: FIN },
  { id: 'finance-payables', area: 'finance', title: 'Payables aging', description: 'Open supplier bills by age bucket and due date.', path: '/finance/bills?tab=payables', access: FIN },
  { id: 'finance-commissions', area: 'finance', title: 'Commission statements', description: 'Monthly commission statements per rep and plan.', path: '/finance/commissions', access: FIN },
  profit('projects', 'Project profitability', 'Revenue, direct costs, allocated labour and margin per project, budget vs actual.'),
  profit('events', 'Event profitability', 'Event income vs costs without double counting, ROI, cost per attendee and lead.'),
  profit('customers', 'Customer profitability', 'Revenue net of credit notes, costs, margin, DSO, collected vs outstanding.'),
  profit('departments', 'Department P&L', 'Revenue and costs by department dimension.'),
]

export const HUB_IDS = new Set(HUB_CATALOG.map((e) => e.id))

/** Is the entry's screen open to this role in a company with these plan modules? */
export function hubEntryVisible(entry: Pick<HubEntry, 'access'>, role: Role, planModules: readonly string[]): boolean {
  const a = entry.access
  const scope = scopeOf(role, a.module)
  if (scope === 'hidden') return false
  if (a.scopes && !a.scopes.includes(scope)) return false
  if (a.alsoModule && scopeOf(role, a.alsoModule) === 'hidden') return false
  const plan = a.planModule ?? ((GATEABLE_MODULES as string[]).includes(a.module) ? (a.module as PlanModule) : null)
  if (plan && !planModules.includes(plan)) return false
  return true
}
