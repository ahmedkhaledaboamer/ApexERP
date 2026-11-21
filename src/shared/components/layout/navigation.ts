import {
  BarChart3,
  Banknote,
  BadgePercent,
  Building,
  BookUser,
  ChartPie,
  ScanLine,
  Mic2,
  MapPinned,
  Store,
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
  FileChartColumn,
  FolderKanban,
  GraduationCap,
  Laptop,
  History,
  KanbanSquare,
  LayoutDashboard,
  LayoutTemplate,
  Megaphone,
  CalendarRange,
  Images,
  Magnet,
  Palette,
  SearchCheck,
  UsersRound,
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
  HandCoins,
  WandSparkles,
  type LucideIcon,
  Handshake,
  CircleUser,
  Inbox,
  Luggage,
  ListChecks,
  Landmark,
  ListTree,
  BookOpen,
  SlidersHorizontal,
  Truck,
  FileInput,
  Scale,
  ScrollText,
} from 'lucide-react'
import type { ModuleKey, Scope } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import { PATHS } from '@/app/paths'

export interface NavItem {
  label: string
  icon: LucideIcon
  to: string
  /** Hidden when the role has no view access to this module. */
  module?: ModuleKey
  /** Only these scopes of `module` see the item (default: any scope that can view). */
  scopes?: readonly Scope[]
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
        ready: true,
        phase: 2,
        description: 'Campaigns with channel, budget, dates, goal and owner; cost per lead per campaign.',
      },
      {
        label: 'Content Calendar',
        icon: CalendarRange,
        to: '/marketing/content',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Posts, articles and newsletters by channel: review, approval, scheduling and publishing.',
      },
      {
        label: 'Bulk email',
        icon: WandSparkles,
        to: '/marketing/email',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Email builder and target lists by industry and status; excludes Do Not Contact.',
      },
      {
        label: 'Lead Generation',
        icon: Magnet,
        to: '/marketing/lead-generation',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Lead capture forms (hosted page and embed), landing pages and UTM links; every submission becomes a lead.',
      },
      {
        label: 'Audiences',
        icon: UsersRound,
        to: '/marketing/audiences',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Saved lead segments by rules (dynamic or frozen) for bulk emails and ad-platform exports; never Do Not Contact.',
      },
      {
        label: 'Design Requests',
        icon: Palette,
        to: '/marketing/design-requests',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Briefs to the design team: assign, review, deliver and save to Brand assets.',
      },
      {
        label: 'Brand Assets',
        icon: Images,
        to: '/marketing/assets',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Logos, images, videos, templates and fonts with usage rights and campaigns.',
      },
      {
        label: 'Website & SEO',
        icon: SearchCheck,
        to: '/marketing/seo',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Site pages with automatic on-page SEO checks, a keyword position tracker and the leads your website brings.',
      },
      {
        label: 'Ads Integrations',
        icon: Plug,
        to: '/marketing/ads',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Meta, Google, LinkedIn and TikTok ad accounts: daily spend sync, campaign mapping and lead-form leads.',
      },
      {
        label: 'Marketing Analytics',
        icon: BarChart3,
        to: '/marketing/analytics',
        module: 'marketing',
        ready: true,
        phase: 2,
        description: 'Spend, leads, cost per lead, ROI and funnel across campaigns, email, events and ads.',
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
        to: PATHS.events,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Exhibitions, meetings and webinars; registered attendees become leads with source “Event”.',
      },
      {
        label: 'Events calendar',
        icon: CalendarDays,
        to: PATHS.eventCalendar,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Events by month or week, in the company’s time zone.',
      },
      {
        label: 'Event templates',
        icon: LayoutTemplate,
        to: PATHS.eventTemplates,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Preparation checklists per event type: tasks dated before and after the event, assigned by role.',
      },
      {
        label: 'Attendees',
        icon: BookUser,
        to: PATHS.eventAttendees,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Everyone registered at your events, one row per person: events attended, check-ins, tickets and their lead.',
      },
      {
        label: 'Booth leads',
        icon: ScanLine,
        to: PATHS.eventBoothLeads,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Every booth capture across events with its follow-up state; overdue follow-ups highlighted.',
      },
      {
        label: 'Speakers',
        icon: Mic2,
        to: PATHS.eventSpeakers,
        module: 'marketing',
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'The company’s speaker directory: profiles, topics, fees, the events and sessions they spoke at, ratings.',
      },
      {
        label: 'Venues',
        icon: MapPinned,
        to: PATHS.eventVenues,
        module: 'marketing',
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Exhibition centres, hotels and halls with rooms, capacity, contacts and rates; past and upcoming events there.',
      },
      {
        label: 'Vendors',
        icon: Store,
        to: PATHS.eventVendors,
        module: 'marketing',
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Booth builders, printers, caterers and other event suppliers: spend per event from budget lines, ratings, blacklist.',
      },
      {
        label: 'Sponsors & exhibitors',
        icon: Handshake,
        to: PATHS.eventSponsors,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Sponsorship packages and the sponsors of the events you organize: pipeline, deliverables, income in the event’s ROI.',
      },
      {
        label: 'Travel & logistics',
        icon: Luggage,
        to: PATHS.eventLogistics,
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Team trips (flights, hotels, visas), booth shipments and exhibitor deadlines; costs post to the event budget.',
      },
      // Other Events sections (Speakers, Venues, Vendors, Sponsors & exhibitors, Travel & logistics) go above; Event analytics stays last.
      {
        label: 'Event analytics',
        icon: ChartPie,
        to: PATHS.eventAnalytics,
        module: 'marketing',
        planModule: 'events',
        ready: true,
        phase: 2,
        description: 'Compare the events held in a period: attendance, leads, cost per lead, won deals, ROI and NPS.',
      },
    ],
  },
  {
    id: 'hr',
    label: 'HR & Admin',
    dot: 'bg-danger-500',
    items: [
      // My HR first (self-service of the signed-in employee). Roles with hr hidden reach it from the user menu.
      {
        label: 'My HR',
        icon: CircleUser,
        to: PATHS.hrMe,
        module: 'hr',
        ready: true,
        phase: 3,
        description: 'Your own profile, documents, contract, leave, attendance, payslips, assets, training and HR letters.',
      },
      {
        label: 'Employees',
        icon: Users,
        to: PATHS.hrEmployees,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Employee profiles and documents, with alerts 60 days before residency or passport expiry.',
      },
      {
        label: 'Onboarding & offboarding',
        icon: ListChecks,
        to: PATHS.hrJourneys,
        module: 'hr',
        ready: true,
        phase: 3,
        description: 'Checklists for joiners and leavers from templates: who does what by when, progress, overdue items, My tasks.',
      },
      {
        label: 'Recruitment',
        icon: UserPlus,
        to: PATHS.hrRecruitment,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Job openings with approval, candidates, a pipeline from applied to hired, interview scorecards and offers.',
      },
      {
        label: 'Attendance',
        icon: Clock,
        to: PATHS.hrAttendance,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Clock in / out, the today board, monthly sheets, shifts, corrections and punch imports, in the company timezone.',
      },
      {
        label: 'Leave',
        icon: Plane,
        to: PATHS.hrLeave,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Leave types, balances and approvals: department head first, then HR. Team calendar and public holidays.',
      },
      // Employee Contracts and Salary Management go above Training; Company Assets and HR Reports below.
      {
        label: 'Employee Contracts',
        icon: FileSignature,
        to: PATHS.hrContracts,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Contracts per employee with history: type, probation, notice, pay, renewals and end-date alerts.',
      },
      {
        label: 'Salary Management',
        icon: Banknote,
        to: PATHS.hrSalary,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Monthly payroll (WPS / Mudad files), payslips, adjustments, loans and end-of-service settlements.',
      },
      {
        label: 'Training',
        icon: GraduationCap,
        to: PATHS.hrTraining,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'Courses, sessions and enrollments; certificates with expiry alerts; the mandatory training matrix and budget.',
      },
      {
        label: 'Performance',
        icon: Target,
        to: PATHS.hrPerformance,
        module: 'hr',
        ready: true,
        phase: 3,
        description: 'Review cycles with goals, self and manager reviews, HR calibration and shared results; probation reviews before probation ends.',
      },
      {
        label: 'Company Assets',
        icon: Laptop,
        to: PATHS.hrAssets,
        module: 'hr',
        ready: true,
        phase: 2,
        description: 'The asset register: laptops, phones, vehicles, cards; who holds what, hand-overs and returns, warranty alerts.',
      },
      {
        label: 'Employee Requests',
        icon: Inbox,
        to: PATHS.hrRequests,
        module: 'hr',
        scopes: ['full'],
        ready: true,
        phase: 3,
        description: 'Profile changes and HR letter requests from My HR in one queue; letter templates and verification codes.',
      },
      // Keep HR Reports the last HR item.
      {
        label: 'HR Reports',
        icon: ChartPie,
        to: PATHS.hrReports,
        module: 'hr',
        scopes: ['full', 'team'],
        ready: true,
        phase: 2,
        description: 'Headcount, turnover, nationalisation, attendance, leave, expiries, assets, recruitment, training and committed payroll cost, with CSV exports.',
      },
    ],
  },
  {
    id: 'finance',
    label: 'Accounts & finance',
    dot: 'bg-success-500',
    items: [
      // Final order: Finance overview, Invoices, Payments, Receivables, Suppliers, Purchase orders, Bills, Expenses, Banking, Commissions, Financial statements, (Tax, Budgets & forecast), Profitability, Chart of accounts, Journal, Finance settings.
      { label: 'Finance overview', icon: Landmark, to: PATHS.financeOverview, module: 'accounting', ready: true, end: true, phase: 3, description: 'Cash and bank balances, receivables and overdue, revenue this month vs last, the VAT estimate and the latest journal entries.' },
      { label: 'Invoices', icon: Receipt, to: PATHS.financeInvoices, module: 'accounting', ready: true, phase: 3, description: 'Tax invoices from quotations, contracts and won deals; credit notes, recurring billing, print (bilingual in KSA) and ZATCA e-invoicing data.' },
      { label: 'Payments', icon: Wallet, to: PATHS.financePayments, module: 'accounting', ready: true, phase: 3, description: 'Payments received with allocation to invoices, customer credit, refunds and receipts; post-dated cheques; online payment links.' },
      { label: 'Receivables', icon: HandCoins, to: PATHS.financeReceivables, module: 'accounting', ready: true, phase: 3, description: 'Aging by customer, statements of account, credit limits and automatic payment reminders.' },
      { label: 'Suppliers', icon: Truck, to: PATHS.financeSuppliers, module: 'accounting', ready: true, phase: 3, description: 'The vendor directory with finance profiles (VAT number, terms, bank details), balances, statements and AP aging.' },
      // Self-service: every employee requests purchases for their own department (plan gate only; the API scopes what each sees).
      { label: 'Purchase orders', icon: ClipboardList, to: PATHS.financePurchaseOrders, planModule: 'accounting', ready: true, phase: 3, description: 'Purchase requests with amount-based approvals, printable POs and goods / service receipts.' },
      { label: 'Bills', icon: FileInput, to: PATHS.financeBills, module: 'accounting', ready: true, phase: 3, description: 'Supplier bills with PO matching, approvals, debit notes, payment runs, payment vouchers and payables aging.' },
      // Self-service too: every employee files expense claims here (plan gate only; company expenses need accounting, the API scopes the rest).
      { label: 'Expenses', icon: FileSpreadsheet, to: PATHS.financeExpenses, planModule: 'accounting', ready: true, phase: 3, description: 'Company expenses with receipts and VAT, employee expense claims reimbursed now or through payroll, petty cash funds, categories and policy.' },
      { label: 'Banking', icon: Building, to: PATHS.financeBanking, module: 'accounting', ready: true, phase: 3, description: 'Bank and cash accounts, transfers (multi-currency), CSV statement import, reconciliation with bank rules, and payroll postings.' },
      { label: 'Commissions', icon: BadgePercent, to: PATHS.financeCommissions, module: 'accounting', ready: true, phase: 3, description: 'Commission plans (collected revenue or won deals, tiers by target achievement, caps, clawback), monthly statements approved by the Sales Manager and an Accountant, pushed to payroll.' },
      { label: 'Financial statements', icon: FileChartColumn, to: PATHS.financeStatements, module: 'accounting', ready: true, phase: 3, description: 'Profit and loss (comparisons, department / project / event / customer filters, 12-month trend), balance sheet, cash flow, general ledger and trial balance from the journal; CSV / Excel / print; year-end close.' },
      { label: 'Tax', icon: ScrollText, to: PATHS.financeTax, module: 'accounting', ready: true, phase: 3, description: 'VAT returns (UAE FTA VAT 201 / KSA ZATCA) by filing period with drill-down, filing and payment; the UAE corporate tax and KSA zakat estimates with provisions.' },
      { label: 'Budgets & forecast', icon: Target, to: PATHS.financePlanning, module: 'accounting', ready: true, phase: 3, description: 'Department budgets with approval, budget vs actual with 90 % / 100 % alerts, and the 13-week / 6-month cash-flow forecast. Department heads see their own budget from My HR.' },
      { label: 'Profitability', icon: Scale, to: PATHS.financeProfitability, module: 'accounting', ready: true, phase: 3, description: 'Project, event and customer profitability (ledger revenue and costs plus allocated labour), DSO, ROI and the department P&L; CSV / Excel.' },
      { label: 'Chart of accounts', icon: ListTree, to: PATHS.financeAccounts, module: 'accounting', ready: true, phase: 3, description: 'Accounts by type with balances, system roles, account ledgers and the country template.' },
      { label: 'Journal', icon: BookOpen, to: PATHS.financeJournal, module: 'accounting', ready: true, phase: 3, description: 'Every posting: filters, manual journal entries, reversals, opening balances and the trial balance.' },
      { label: 'Finance settings', icon: SlidersHorizontal, to: PATHS.financeSettings, module: 'accounting', ready: true, phase: 3, description: 'Fiscal year, VAT registration, invoice defaults, exchange rates and the lock date.' },
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
        to: PATHS.reportsHub,
        module: 'reports',
        ready: true,
        // `/reports/performance` has its own item.
        end: true,
        phase: 1,
        description: 'Every report by area with favourites and recently viewed; leads by status, industry and source, conversion, agent performance and target completion (Sales reports), scheduled e-mails.',
      },
      {
        label: 'Company performance',
        icon: TrendingUp,
        to: PATHS.companyPerformance,
        module: 'reports',
        ready: true,
        phase: 1,
        description: 'Management view: revenue, margin, cash, receivables (finance roles), pipeline, delivery, people, a department scorecard and alerts.',
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
