import {
  BadgePercent,
  Banknote,
  BookOpen,
  Bot,
  Briefcase,
  Building,
  CalendarRange,
  CheckSquare,
  CircleUser,
  ClipboardList,
  Contact,
  FileCheck2,
  FileInput,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Gavel,
  GraduationCap,
  Handshake,
  HeartPulse,
  Images,
  Laptop,
  LayoutTemplate,
  ListChecks,
  ListTree,
  Luggage,
  Magnet,
  MapPinned,
  Megaphone,
  Mic2,
  Network,
  Package,
  Palette,
  Plane,
  Receipt,
  Settings,
  Store,
  Target,
  Ticket,
  Truck,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleKey, Role, Scope } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import { planIncludes, type GateEntitlements } from '@/modules/billing/gating'
import { can, scopeOf } from '@/shared/lib/permissions'
import { PATHS } from '@/app/paths'
import { MARKETING_PATHS } from '@/modules/marketing/paths'
import { NAV_SECTIONS } from './navigation'

/**
 * One registry of every record that can be created from anywhere: the header "+ New" menu and the
 * Ctrl K command palette ("Create …") both read it, so they never drift.
 *
 * Each action opens the record's real form: a global dialog (New lead) or a page URL the page handles
 * (`/…/new`, or `?new=1` via useNewParam, `?record=1`, `?request=1`). Who sees an action follows the same
 * rule as the target page's create button: the role column (`can` / scopes of permissions.ts) and the plan
 * module (`planIncludes`). Self-service actions (leave, letters, expense claims, purchase requests,
 * design requests) are for every employee and only need the plan module.
 *
 * Pure (no React): unit-tested in createActions.test.ts.
 */

/** Groups in sidebar order (ids of NAV_SECTIONS). */
export type CreateArea = 'sales' | 'services' | 'projects' | 'marketing' | 'events' | 'hr' | 'finance' | 'insights'

export type CreateTarget = { kind: 'route'; to: string } | { kind: 'lead-quick-add' }

export interface CreateAction {
  id: string
  label: string
  /** Extra words the search matches (synonyms). */
  keywords?: string
  area: CreateArea
  icon: LucideIcon
  target: CreateTarget
  /** Role module the action needs (omitted: self-service, every role). */
  module?: ModuleKey
  /** Only these scopes of `module` (default: any scope that may `action`). */
  scopes?: readonly Scope[]
  /** What the role must be able to do on `module` (default `create`). */
  action?: 'create' | 'edit'
  /** Plan module that must be in the subscription (defaults to `module`). */
  planModule?: PlanModule
}

const route = (to: string): CreateTarget => ({ kind: 'route', to })

export const CREATE_ACTIONS: CreateAction[] = [
  /* ---- Sales ---- */
  { id: 'lead', label: 'New lead', keywords: 'prospect company deal', area: 'sales', icon: UserPlus, target: { kind: 'lead-quick-add' }, module: 'sales' },
  // Contacts and contracts: the pages' create buttons follow sales edit.
  { id: 'contact', label: 'New contact', keywords: 'person decision maker', area: 'sales', icon: Contact, target: route(`${PATHS.contacts}?new=1`), module: 'sales', action: 'edit' },
  { id: 'quotation', label: 'New quotation', keywords: 'quote proposal offer', area: 'sales', icon: FileText, target: route(PATHS.quotationNew), module: 'sales' },
  { id: 'contract', label: 'New contract', keywords: 'customer renewal subscription', area: 'sales', icon: FileSignature, target: route(`${PATHS.contracts}?new=1`), module: 'sales', action: 'edit' },

  /* ---- Services ---- */
  { id: 'service', label: 'New service', keywords: 'catalog product', area: 'services', icon: Briefcase, target: route(`${PATHS.services}?new=1`), module: 'services', action: 'edit' },
  { id: 'package', label: 'New package', keywords: 'bundle catalog', area: 'services', icon: Package, target: route(`${PATHS.servicePackages}?new=1`), module: 'services', action: 'edit' },

  /* ---- Projects & tasks ---- */
  { id: 'task', label: 'New task', keywords: 'todo to-do follow up', area: 'projects', icon: CheckSquare, target: route(`${PATHS.myTasks}?new=1`), module: 'tasks' },
  // Own-scope roles work inside projects; team and full scope create them (matches POST /projects).
  { id: 'project', label: 'New project', keywords: 'delivery', area: 'projects', icon: FolderKanban, target: route(`${PATHS.projects}?new=1`), module: 'tasks', scopes: ['full', 'team'] },

  /* ---- Marketing (marketing edit; plan module marketing) ---- */
  { id: 'campaign', label: 'New campaign', area: 'marketing', icon: Megaphone, target: route(`${MARKETING_PATHS.campaigns}?new=1`), module: 'marketing', action: 'edit' },
  { id: 'content', label: 'New content item', keywords: 'post article newsletter calendar social', area: 'marketing', icon: CalendarRange, target: route(`${MARKETING_PATHS.content}?new=1`), module: 'marketing', action: 'edit' },
  { id: 'bulk-email', label: 'New bulk email', keywords: 'newsletter mailing blast', area: 'marketing', icon: WandSparkles, target: route(`${MARKETING_PATHS.emails}?new=1`), module: 'marketing', action: 'edit' },
  { id: 'lead-form', label: 'New lead capture form', keywords: 'web form embed', area: 'marketing', icon: Magnet, target: route(`${MARKETING_PATHS.leadGeneration}?new=1`), module: 'marketing', action: 'edit' },
  { id: 'landing-page', label: 'New landing page', keywords: 'website page', area: 'marketing', icon: Magnet, target: route(`${MARKETING_PATHS.leadGeneration}?tab=pages&new=1`), module: 'marketing', action: 'edit' },
  { id: 'utm-link', label: 'New UTM link', keywords: 'tracking tagged url', area: 'marketing', icon: Magnet, target: route(`${MARKETING_PATHS.leadGeneration}?tab=utm&new=1`), module: 'marketing', action: 'edit' },
  { id: 'audience', label: 'New audience', keywords: 'segment list', area: 'marketing', icon: UsersRound, target: route(`${MARKETING_PATHS.audiences}?new=1`), module: 'marketing', action: 'edit' },
  { id: 'brand-asset', label: 'Upload brand asset', keywords: 'new logo image file', area: 'marketing', icon: Images, target: route(`${MARKETING_PATHS.assets}?new=1`), module: 'marketing', action: 'edit' },
  // Everyone may ask the design team (plan module only).
  { id: 'design-request', label: 'New design request', keywords: 'brief designer artwork', area: 'marketing', icon: Palette, target: route(`${MARKETING_PATHS.designRequests}?new=1`), planModule: 'marketing' },

  /* ---- Events (plan module events; marketing full manages events and the libraries) ---- */
  { id: 'event', label: 'New event', keywords: 'exhibition conference webinar meeting', area: 'events', icon: Ticket, target: route(`${PATHS.events}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'event-template', label: 'New event template', keywords: 'checklist', area: 'events', icon: LayoutTemplate, target: route(`${PATHS.eventTemplates}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'speaker', label: 'New speaker', area: 'events', icon: Mic2, target: route(`${PATHS.eventSpeakers}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'venue', label: 'New venue', keywords: 'hall hotel', area: 'events', icon: MapPinned, target: route(`${PATHS.eventVenues}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'vendor', label: 'New event vendor', keywords: 'supplier booth builder printer caterer', area: 'events', icon: Store, target: route(`${PATHS.eventVendors}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'sponsor', label: 'New sponsor deal', keywords: 'sponsorship exhibitor', area: 'events', icon: Handshake, target: route(`${PATHS.eventSponsors}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },
  { id: 'trip', label: 'New trip', keywords: 'travel flight hotel visa logistics', area: 'events', icon: Luggage, target: route(`${PATHS.eventLogistics}?new=1`), module: 'marketing', scopes: ['full'], planModule: 'events' },

  /* ---- HR & Admin (plan module hr) ---- */
  // Self-service, every employee.
  { id: 'leave', label: 'Request leave', keywords: 'vacation holiday time off absence', area: 'hr', icon: Plane, target: route(`${PATHS.hrLeave}?tab=me&request=1`), planModule: 'hr' },
  { id: 'letter', label: 'Request an HR letter', keywords: 'salary certificate noc employment letter', area: 'hr', icon: CircleUser, target: route(`${PATHS.hrMe}?new=letter`), planModule: 'hr' },
  // HR full (Department Heads request openings for their team).
  { id: 'employee', label: 'New employee', keywords: 'staff hire person', area: 'hr', icon: Users, target: route(`${PATHS.hrEmployees}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'onboarding', label: 'Start onboarding', keywords: 'offboarding journey checklist joiner leaver', area: 'hr', icon: ListChecks, target: route(`${PATHS.hrJourneys}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'job-opening', label: 'New job opening', keywords: 'vacancy position recruitment hiring', area: 'hr', icon: UserPlus, target: route(`${PATHS.hrRecruitment}?new=opening`), module: 'hr', scopes: ['full', 'team'] },
  { id: 'candidate', label: 'New candidate', keywords: 'applicant recruitment cv', area: 'hr', icon: UserPlus, target: route(`${PATHS.hrRecruitment}?new=candidate`), module: 'hr', scopes: ['full'] },
  { id: 'employee-contract', label: 'New employee contract', keywords: 'employment', area: 'hr', icon: FileSignature, target: route(`${PATHS.hrContracts}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'payroll-run', label: 'New payroll run', keywords: 'salary wps mudad', area: 'hr', icon: Banknote, target: route(`${PATHS.hrSalary}?tab=runs&new=1`), module: 'hr', scopes: ['full'] },
  { id: 'course', label: 'New training course', keywords: 'session learning', area: 'hr', icon: GraduationCap, target: route(`${PATHS.hrTraining}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'review-cycle', label: 'New review cycle', keywords: 'performance appraisal', area: 'hr', icon: Target, target: route(`${PATHS.hrPerformance}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'survey', label: 'New engagement survey', keywords: 'enps pulse', area: 'hr', icon: HeartPulse, target: route(`${PATHS.hrEngagement}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'asset', label: 'New company asset', keywords: 'laptop phone vehicle equipment', area: 'hr', icon: Laptop, target: route(`${PATHS.hrAssets}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'discipline', label: 'New disciplinary record', keywords: 'warning suspension deduction', area: 'hr', icon: Gavel, target: route(`${PATHS.hrDiscipline}?new=1`), module: 'hr', scopes: ['full'] },
  { id: 'policy', label: 'New policy', keywords: 'handbook rules', area: 'hr', icon: FileCheck2, target: route(`${PATHS.hrPolicies}?new=1`), module: 'hr', scopes: ['full'] },

  /* ---- Accounts & finance (plan module accounting) ---- */
  // Self-service, every employee.
  { id: 'expense-claim', label: 'New expense claim', keywords: 'reimbursement receipt', area: 'finance', icon: FileSpreadsheet, target: route(`${PATHS.financeExpenses}?tab=claims&new=1`), planModule: 'accounting' },
  { id: 'purchase-request', label: 'Request a purchase', keywords: 'purchase order po buy', area: 'finance', icon: ClipboardList, target: route(PATHS.financePurchaseOrderNew), planModule: 'accounting' },
  // Accounting full.
  { id: 'invoice', label: 'New invoice', keywords: 'tax invoice bill customer', area: 'finance', icon: Receipt, target: route(PATHS.financeInvoiceNew), module: 'accounting', scopes: ['full'] },
  { id: 'payment', label: 'Record payment', keywords: 'receipt received collection', area: 'finance', icon: Wallet, target: route(`${PATHS.financePayments}?record=1`), module: 'accounting', scopes: ['full'] },
  { id: 'pdc', label: 'Receive post-dated cheque', keywords: 'pdc check', area: 'finance', icon: Wallet, target: route(`${PATHS.financePayments}?tab=pdc&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'payment-link', label: 'New payment link', keywords: 'online pay card', area: 'finance', icon: Wallet, target: route(`${PATHS.financePayments}?tab=links&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'supplier', label: 'New supplier', keywords: 'vendor payee', area: 'finance', icon: Truck, target: route(`${PATHS.financeSuppliers}?new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'bill', label: 'New bill', keywords: 'supplier invoice payable', area: 'finance', icon: FileInput, target: route(PATHS.financeBillNew), module: 'accounting', scopes: ['full'] },
  { id: 'expense', label: 'Record expense', keywords: 'company spend receipt', area: 'finance', icon: FileSpreadsheet, target: route(`${PATHS.financeExpenses}?tab=expenses&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'bank-account', label: 'New bank account', keywords: 'cash account iban', area: 'finance', icon: Building, target: route(`${PATHS.financeBanking}?new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'transfer', label: 'New bank transfer', keywords: 'move money', area: 'finance', icon: Building, target: route(`${PATHS.financeBanking}?tab=transfers&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'commission-plan', label: 'New commission plan', keywords: 'sales commission tiers', area: 'finance', icon: BadgePercent, target: route(`${PATHS.financeCommissions}?tab=plans&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'budget', label: 'New budget', keywords: 'forecast planning', area: 'finance', icon: Target, target: route(`${PATHS.financePlanning}?tab=budgets&new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'ledger-account', label: 'New ledger account', keywords: 'chart of accounts gl', area: 'finance', icon: ListTree, target: route(`${PATHS.financeAccounts}?new=1`), module: 'accounting', scopes: ['full'] },
  { id: 'journal-entry', label: 'New journal entry', keywords: 'manual posting je', area: 'finance', icon: BookOpen, target: route(`${PATHS.financeJournal}?new=1`), module: 'accounting', scopes: ['full'] },

  /* ---- Insights & admin ---- */
  { id: 'department', label: 'New department', keywords: 'team org structure', area: 'insights', icon: Network, target: route(`${PATHS.departments}?new=1`), module: 'departments', scopes: ['full'] },
  { id: 'user', label: 'Add user', keywords: 'invite member colleague', area: 'insights', icon: Settings, target: route('/settings/users?new=1'), module: 'settings', action: 'edit' },
  { id: 'ai-conversation', label: 'New AI conversation', keywords: 'assistant chat ask', area: 'insights', icon: Bot, target: route(`${PATHS.aiAssistant}?new=1`), planModule: 'ai' },
]

/** Area labels and order: the sidebar's sections. */
export const CREATE_AREAS: { id: CreateArea; label: string }[] = NAV_SECTIONS.filter((s) =>
  (['sales', 'services', 'projects', 'marketing', 'events', 'hr', 'finance', 'insights'] as string[]).includes(s.id),
).map((s) => ({ id: s.id as CreateArea, label: s.label }))

export interface CreateContext {
  role: Role | null | undefined
  entitlements: GateEntitlements
  /** Read-only workspace: nothing can be created. */
  readOnly?: boolean
}

/** Can this role (and plan) create the action's record right now? */
export function canCreate(a: CreateAction, ctx: CreateContext): boolean {
  if (!ctx.role || ctx.readOnly) return false
  if (a.module) {
    if (a.scopes ? !a.scopes.includes(scopeOf(ctx.role, a.module)) : !can(ctx.role, a.module, a.action ?? 'create')) return false
  }
  const pm = a.planModule ?? a.module
  return !pm || planIncludes(ctx.entitlements, pm)
}

/** Every action the user may take, in area (sidebar) order. */
export function availableCreateActions(ctx: CreateContext): CreateAction[] {
  const order = new Map(CREATE_AREAS.map((a, i) => [a.id, i]))
  return CREATE_ACTIONS.filter((a) => canCreate(a, ctx)).sort((x, y) => (order.get(x.area) ?? 0) - (order.get(y.area) ?? 0))
}

/** The likeliest actions per role, best first ("Common" group). Unavailable ones are skipped. */
export const COMMON_BY_ROLE: Record<Role, string[]> = {
  'Company Admin': ['lead', 'quotation', 'task', 'invoice', 'employee'],
  Management: ['lead', 'quotation', 'task', 'invoice', 'employee'],
  'Sales Manager': ['lead', 'quotation', 'task', 'contract', 'contact'],
  'Sales Agent': ['lead', 'quotation', 'task', 'contact', 'expense-claim'],
  'Marketing Manager': ['campaign', 'content', 'design-request', 'bulk-email', 'event'],
  Accountant: ['invoice', 'bill', 'payment', 'expense', 'journal-entry'],
  'HR Manager': ['employee', 'job-opening', 'onboarding', 'employee-contract', 'leave'],
  'Department Head': ['task', 'leave', 'expense-claim', 'purchase-request', 'job-opening'],
  Employee: ['leave', 'expense-claim', 'purchase-request', 'task', 'letter'],
}

export function commonCreateActions(role: Role | null | undefined, available: CreateAction[], max = 5): CreateAction[] {
  if (!role) return []
  const byId = new Map(available.map((a) => [a.id, a]))
  return COMMON_BY_ROLE[role].flatMap((id) => byId.get(id) ?? []).slice(0, max)
}

const AREA_LABEL = new Map<string, string>(CREATE_AREAS.map((s) => [s.id, s.label]))

export const areaLabel = (area: CreateArea): string => AREA_LABEL.get(area) ?? area

/** The command palette's wording: "New quotation" → "Create quotation"; "Request leave" stays. */
export function createCommandLabel(a: CreateAction): string {
  return a.label.startsWith('New ') ? `Create ${a.label.slice(4)}` : a.label
}

const words = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean)

/** Search: every word must appear in the label, keywords or area name (case-insensitive). */
export function matchCreateAction(a: CreateAction, query: string): boolean {
  const ws = words(query)
  const hay = `${a.label} ${a.keywords ?? ''} ${areaLabel(a.area)}`.toLowerCase()
  return ws.every((w) => hay.includes(w))
}

/** Matching actions, those whose label matches every word first ("invoice" → New invoice before New bill). */
export function searchCreateActions(list: CreateAction[], query: string): CreateAction[] {
  const ws = words(query)
  if (ws.length === 0) return list
  const hits = list.filter((a) => matchCreateAction(a, query))
  const inLabel = (a: CreateAction) => ws.every((w) => a.label.toLowerCase().includes(w))
  return [...hits.filter(inLabel), ...hits.filter((a) => !inLabel(a))]
}
