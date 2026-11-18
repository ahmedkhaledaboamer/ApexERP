import {
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  Clock,
  Contact,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  History,
  KanbanSquare,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  Network,
  Workflow,
  Package,
  Plane,
  Plug,
  Receipt,
  Settings,
  Target,
  Ticket,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wallet,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import { PATHS } from '@/app/paths'

export interface NavItem {
  label: string
  icon: LucideIcon
  to: string
  /** Hidden when the role has no view access to this module. */
  module?: ModuleKey
  /**
   * Plan module that must be in the subscription (defaults to `module`). Items whose plan module
   * isn't included are shown locked and their route renders the upgrade page (billing/gating.ts).
   */
  planModule?: PlanModule
  /** Built and live. Unbuilt items open the "coming soon" page with their spec summary. */
  ready?: boolean
  phase?: 1 | 2 | 3
  /** What the spec says this screen does; shown on its placeholder page. */
  description?: string
  /** Badge count source (resolved in the sidebar). */
  badge?: 'followups'
  /** Match only this exact path for the active state. */
  end?: boolean
}

export interface NavSection {
  id: string
  label: string
  /** Dot colour class. */
  dot: string
  items: NavItem[]
}

/** Always-visible items above the department sections. */
export const NAV_TOP: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: PATHS.dashboard, ready: true },
  {
    label: 'Follow-ups',
    icon: CalendarClock,
    to: '/follow-ups',
    module: 'sales',
    badge: 'followups',
    phase: 1,
    description: 'Today’s and overdue follow-ups for each agent, with one-click logging.',
  },
  { label: 'My tasks', icon: CheckSquare, to: '/tasks/my', module: 'tasks', ready: true, phase: 1, description: 'Your tasks across leads, customers, projects and events.' },
  { label: 'Calendar', icon: CalendarDays, to: '/tasks/calendar', module: 'tasks', ready: true, phase: 1, description: 'Task due dates by month or week; drag to reschedule.' },
]

/** Department sections, in the spec's phase order. */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'sales',
    label: 'Sales',
    dot: 'bg-accent-500',
    items: [
      { label: 'Sales pipeline', icon: KanbanSquare, to: PATHS.pipeline, module: 'sales', ready: true },
      { label: 'Leads', icon: UserPlus, to: PATHS.leads, module: 'sales', ready: true, end: true },
      {
        label: 'Lead import',
        icon: Upload,
        to: '/leads/import',
        module: 'sales',
        phase: 1,
        description: 'Excel import: upload, map columns, clean values, detect duplicates, confirm.',
      },
      {
        label: 'Customers',
        icon: Building2,
        to: '/crm/customers',
        module: 'sales',
        phase: 1,
        description: 'Customer list and 360° profile: contacts, contracts, services and full communication history.',
      },
      { label: 'Contacts', icon: Contact, to: '/crm/contacts', module: 'sales', phase: 1, description: 'Every contact across companies, with decision-maker flags.' },
      {
        label: 'Quotations',
        icon: FileText,
        to: '/sales/quotations',
        module: 'sales',
        phase: 1,
        description: 'Quotations built from the service catalog and sent from the system.',
      },
      {
        label: 'Contracts',
        icon: FileSignature,
        to: '/crm/contracts',
        module: 'sales',
        phase: 1,
        description: 'Contracts, purchased services and renewal dates, with an alert 30 days before renewal.',
      },
      {
        label: 'Sales targets',
        icon: Target,
        to: '/sales/targets',
        module: 'sales',
        phase: 1,
        description: 'Monthly activity targets per agent: leads, calls, emails, visits, meetings, proposals, partnerships.',
      },
      {
        label: 'Sales reports',
        icon: BarChart3,
        to: '/sales/reports',
        module: 'reports',
        phase: 1,
        description: 'Leads by status, industry and source; conversion; performance per agent; target completion. Excel and PDF export.',
      },
    ],
  },
  {
    id: 'services',
    label: 'Services',
    dot: 'bg-brand-500',
    items: [
      // `end`: /services/packages and /services/templates have their own items; service pages
      // (/services/:id) still resolve to the catalog through navMatch's prefix match.
      { label: 'Service catalog', icon: Briefcase, to: PATHS.services, module: 'services', ready: true, end: true },
      { label: 'Packages', icon: Package, to: PATHS.servicePackages, module: 'services', ready: true },
      { label: 'Project templates', icon: LayoutTemplate, to: PATHS.serviceTemplates, module: 'services', ready: true },
    ],
  },
  {
    id: 'projects',
    label: 'Projects & tasks',
    dot: 'bg-teal-500',
    items: [
      {
        label: 'Projects',
        icon: FolderKanban,
        to: '/projects',
        module: 'tasks',
        ready: true,
        phase: 1,
        description: 'Delivery projects: customer, service, manager, dates, status and hours.',
      },
      { label: 'Task board', icon: ClipboardList, to: '/tasks/board', module: 'tasks', ready: true, phase: 1, description: 'Kanban board of tasks by status.' },
      { label: 'All tasks', icon: CheckSquare, to: '/tasks/list', module: 'tasks', ready: true, phase: 1, description: 'Every task you can see, as a table.' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    dot: 'bg-pink-500',
    items: [
      {
        label: 'Campaigns',
        icon: Megaphone,
        to: '/marketing/campaigns',
        module: 'marketing',
        phase: 2,
        description: 'Campaigns with channel, budget, dates, goal and owner; cost per lead per campaign.',
      },
      {
        label: 'Bulk email',
        icon: WandSparkles,
        to: '/marketing/email',
        module: 'marketing',
        phase: 2,
        description: 'Email builder and target lists by industry and status; excludes Do Not Contact.',
      },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    dot: 'bg-warning-500',
    items: [
      {
        label: 'Events',
        icon: Ticket,
        to: '/events',
        planModule: 'events',
        phase: 2,
        description: 'Exhibitions, meetings and webinars; registered attendees become leads with source “Event”.',
      },
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    dot: 'bg-danger-500',
    items: [
      {
        label: 'Employees',
        icon: Users,
        to: '/hr/employees',
        module: 'hr',
        phase: 2,
        description: 'Employee profiles and documents, with alerts 60 days before residency or passport expiry.',
      },
      { label: 'Attendance', icon: Clock, to: '/hr/attendance', module: 'hr', phase: 2, description: 'Daily attendance records.' },
      {
        label: 'Leave',
        icon: Plane,
        to: '/hr/leave',
        module: 'hr',
        phase: 2,
        description: 'Leave types, balances and approvals: department head first, then HR.',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Accounts & finance',
    dot: 'bg-success-500',
    items: [
      { label: 'Invoices', icon: Receipt, to: '/finance/invoices', module: 'accounting', phase: 3, description: 'Invoices from contracts or won deals, with overdue alerts.' },
      { label: 'Payments', icon: Wallet, to: '/finance/payments', module: 'accounting', phase: 3, description: 'Payments received against invoices.' },
      { label: 'Expenses', icon: FileSpreadsheet, to: '/finance/expenses', module: 'accounting', phase: 3, description: 'Expenses with receipts, vendors and bank accounts.' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights & admin',
    dot: 'bg-info-500',
    items: [
      {
        label: 'Reports',
        icon: BarChart3,
        to: '/reports',
        module: 'reports',
        phase: 1,
        description: 'Leads by status, industry and source; conversion; agent performance; target completion. Excel and PDF export.',
      },
      {
        label: 'Company performance',
        icon: TrendingUp,
        to: '/reports/performance',
        module: 'reports',
        phase: 1,
        description: 'Management view: sales, projects, overdue tasks and, later, financials.',
      },
      {
        label: 'Departments',
        icon: Network,
        to: '/departments',
        module: 'departments',
        ready: true,
        phase: 1,
        description: 'Department list, org chart, and each department’s members, tasks and figures.',
      },
      {
        label: 'Company structure',
        icon: Workflow,
        to: '/departments/org-chart',
        module: 'departments',
        ready: true,
        phase: 1,
        description: 'Interactive org chart of departments, heads and members.',
      },
      {
        label: 'Integrations',
        icon: Plug,
        to: '/integrations',
        module: 'settings',
        planModule: 'integrations',
        phase: 1,
        description: 'Email and website form now; WhatsApp, ads, calendar and payments in phase 3. Status and sync log.',
      },
      {
        label: 'Audit log',
        icon: History,
        to: '/settings/audit-log',
        module: 'settings',
        phase: 1,
        description: 'Who changed or deleted sensitive data, and when.',
      },
      {
        label: 'AI assistant',
        icon: Bot,
        to: '/ai',
        // Hook point for the AI assistant: gated by useEntitlements().hasModule('ai').
        planModule: 'ai',
        phase: 1,
        description: 'Drafts emails, suggests services, summarizes notes. Any change asks for your confirmation first.',
      },
      {
        label: 'Settings',
        icon: Settings,
        to: '/settings',
        module: 'settings',
        phase: 1,
        description: 'Users and roles, fixed lists, templates, targets and security (2FA, backups).',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_TOP, ...NAV_SECTIONS.flatMap((s) => s.items)]

/** The nav item (and its section) that owns a pathname: exact match first, then longest prefix. */
export function navMatch(pathname: string): { item: NavItem; section?: NavSection } | null {
  const candidates = [
    ...NAV_TOP.map((item) => ({ item, section: undefined })),
    ...NAV_SECTIONS.flatMap((section) => section.items.map((item) => ({ item, section }))),
  ]
  const exact = candidates.find((c) => c.item.to === pathname)
  if (exact) return exact
  const prefix = candidates
    .filter((c) => pathname.startsWith(c.item.to + '/'))
    .sort((a, b) => b.item.to.length - a.item.to.length)[0]
  return prefix ?? null
}
