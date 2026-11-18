import type { Contact, LeadTask } from '@/shared/types'
import type {
  ActivityView,
  DuplicateMatch,
  ImportCheckRow,
  ImportLeadRow,
  ImportRequest,
  ImportResult,
  LeadDetail,
  LeadOwnerOption,
  LeadRow,
  LeadUpdateInput,
  LeadCreateInput,
  QuickAddInput,
  NoteView,
  TaskView,
} from '@/modules/leads/types'
import type {
  ContactInput as CrmContactInput,
  ContactRow,
  ContactUpdateInput,
  ContractInput,
  ContractRow,
  ContractUpdateInput,
  CustomerDetail,
  CustomerRow,
  CustomerUpdateInput,
} from '@/modules/crm/types'
import type { ListOption, LookupList, Lookups, StatusOption } from '@/modules/settings/types'
import type { Quotation, QuotationInput, QuotationItem, QuotationTotals, QuotationUpdateInput } from '@/modules/quotations/types'
import type { WonInput, WonPreview, WonPreviewProject, WonPreviewTask, WonResult } from '@/modules/won/types'
import type { WonPreviewQuery } from '@/modules/won/api'
import type { SendMessageInput, SendMessageResult } from '@/modules/leads/api/messagesApi'
import type {
  TaskAttachment,
  TaskComment,
  TaskEvent,
  TaskFilter,
  TaskInput,
  TaskUpdateInput,
  TaskView as TaskDetailView,
  TimeEntryInput,
  TimeEntryView,
  ProjectDetail,
  ProjectInput,
  ProjectRow,
  ProjectUpdateInput,
} from '@/modules/tasks/types'
import type { AuditEntry, AutomationRules } from '@/modules/settings/types'
import type { MessageTemplate, TemplateFilter, TemplateInput } from '@/modules/settings/templates/types'
import type { AgentTargetRow, TargetDefaults, TargetsMonth, UpdateTargetsInput } from '@/modules/targets/types'
import type { CustomReport, CustomReportInput, ReportSchedule, SalesReport, ScheduleInput } from '@/modules/reports/types'
import type { DashboardSummary } from '@/shared/types'
import type { Branding, Company, CompanyProfile, RegionalSettings } from '@/modules/tenancy/types'
import type { CompanyProfilePatch } from '@/modules/settings/companyProfile'
import type { BrandingPatch, BrandingSettings } from '@/modules/settings/branding'
import type { EmailConnection, OnboardingState } from '@/modules/signup/types'
import type { CompanyAnnouncement } from '@/modules/platform/types'
import type { Department as SettingsDepartment, SettingsUserRow, UserInput } from '@/modules/settings/users/types'
import type { CompanyRoleDefinition } from '@/modules/signup/types'
import type { BackupStatusInfo } from '@/modules/settings/security/types'
import type {
  DepartmentDetail,
  DepartmentGoal,
  DepartmentInput,
  DepartmentMember,
  DepartmentRow,
  DepartmentUpdateInput,
  GoalInput,
  MoveMembersInput,
  OrgNode,
} from '@/modules/departments/types'
import type { AssignableUser } from '@/modules/tasks/api/tasksApi'
import type {
  PackageInput,
  PackageItem,
  PackageRow,
  PackageUpdateInput,
  ProjectTemplate,
  ProjectTemplateInput,
  ServiceDetail,
  ServiceInput,
  ServiceRow,
  ServiceUpdateInput,
  TemplateTask,
} from '@/modules/services/types'
import { defineMapper, extendMapper, type Mapper } from './mapping'

/**
 * The resource mappers (UI camelCase ↔ API / database snake_case). Field names follow the
 * "Apex Aora ERP Database Design" columns of each table; fields the design has no column for keep a
 * plain snake_case name and are listed under "Design gaps" in docs/DB-ALIGNMENT.md. Converted so far:
 * leads (with contacts, activities, notes, stage moves, duplicates, owners, import), contacts, and
 * the settings lookups (lead statuses, sources, industries, loss reasons, tags, service categories).
 */

/* ---------------- Contacts (table contacts) ---------------- */

/** A contact on a lead: contacts.lead_id, name, title, mobile, email, is_decision_maker. */
export const contactMapper = defineMapper<Contact>({
  fields: { leadId: 'lead_id', isDecisionMaker: 'is_decision_maker' },
})

/** GET /contacts rows: the contact plus the record it hangs off (lead or customer). */
export const contactRowMapper = extendMapper<ContactRow>(contactMapper, {
  fields: { company: 'company_name', recordType: 'record_type', recordId: 'record_id', ownerName: 'owner_name' },
})

/** POST /contacts and PATCH /contacts/:id bodies. */
export const contactInputMapper = extendMapper<CrmContactInput & ContactUpdateInput>(contactMapper, {
  fields: { recordType: 'record_type', recordId: 'record_id' },
})

/* ---------------- Leads (table leads) ---------------- */

/**
 * Lead fields → leads columns. `contactEmail` / `mobile` are the primary contact's, stored as
 * leads.email / leads.phone (the design's duplicate-check columns).
 */
const LEAD_FIELDS = {
  company: 'company_name',
  contactName: 'contact_name',
  contactEmail: 'email',
  mobile: 'phone',
  industry: 'industry_id',
  subIndustry: 'sub_industry_id',
  sourceType: 'source_id',
  sourceDetail: 'source_detail',
  status: 'status_id',
  stageChangedAt: 'stage_changed_at',
  ownerId: 'owner_id',
  value: 'estimated_value',
  nextFollowUpDate: 'next_follow_up_date',
  createdAt: 'created_at',
  doNotContact: 'do_not_contact',
  nextStep: 'next_step',
  lossReason: 'loss_reason_id',
  customerId: 'customer_id',
  companyServices: 'company_services',
  serviceIds: 'service_ids',
  recommendedServiceId: 'recommended_service_id',
  recommendedServiceText: 'recommended_service_text',
  score: 'score',
  ownerName: 'owner_name',
  reopenEligible: 'reopen_eligible',
  website: 'website',
  eventId: 'event_id',
} as const

/** Lead rows (GET /leads), the detail (GET /leads/:id, with contacts), PATCH bodies and stage moves. */
export const leadMapper = defineMapper<LeadDetail>({
  fields: LEAD_FIELDS,
  nested: { contacts: contactMapper as never },
})
/** Same fields as `leadMapper`, typed for rows and PATCH bodies. */
export const leadRowMapper = leadMapper as unknown as Mapper<LeadRow>
export const leadUpdateMapper = leadMapper as unknown as Mapper<LeadUpdateInput & { status?: string }>

/**
 * POST /leads (quick add or full form). The quick add's `email` / `mobile` are the first contact's,
 * so `email` stays `email` here (no `contactEmail` on this body).
 */
const { contactEmail: _contactEmail, ...LEAD_INPUT_FIELDS } = LEAD_FIELDS
export const leadInputMapper = defineMapper<QuickAddInput & LeadCreateInput>({
  fields: LEAD_INPUT_FIELDS,
  nested: { contacts: contactMapper as never },
})

/** activities: user_id, type, summary, occurred_at; the lead is the activity's subject (lead_id here). */
export const activityMapper = defineMapper<ActivityView>({
  fields: { leadId: 'lead_id', userId: 'user_id', at: 'occurred_at', userName: 'user_name' },
  nested: {
    autoStatus: defineMapper({ fields: { from: 'from_status_id', to: 'to_status_id', label: 'label', attempts: 'attempts' } }) as never,
  },
})

/** notes: user_id (the author), body, created_at; the lead is the note's subject (lead_id here). */
export const noteMapper = defineMapper<NoteView>({
  fields: { leadId: 'lead_id', authorId: 'user_id', createdAt: 'created_at', authorName: 'author_name' },
})

/** Legacy GET /leads/:id/tasks rows (tasks table columns). */
export const leadTaskMapper = defineMapper<TaskView & LeadTask>({
  fields: { leadId: 'lead_id', ownerId: 'owner_id', dueDate: 'due_date', ownerName: 'owner_name' },
})

export const duplicateMapper = defineMapper<DuplicateMatch>({
  fields: { leadId: 'lead_id', company: 'company_name', ownerName: 'owner_name', status: 'status_id' },
})

export const ownerOptionMapper = defineMapper<LeadOwnerOption>({ fields: { openLeads: 'open_leads' } })

/** GET /leads/duplicates query parameters (UI → API names). */
export const DUPLICATE_QUERY = { company: 'company_name', email: 'email', emails: 'emails', website: 'website', excludeId: 'exclude_id' } as const

/* ---------------- Lead import (table lead_imports + leads) ---------------- */

export const importRowMapper = defineMapper<ImportLeadRow>({
  fields: { ...LEAD_INPUT_FIELDS, contactTitle: 'contact_title', isDecisionMaker: 'is_decision_maker', email: 'email', notes: 'notes' },
})

/** POST /leads/import: decisions are keyed by row number (opaque map). */
export const importRequestMapper = defineMapper<ImportRequest>({
  fields: { ownerRule: 'owner_rule' },
  nested: { rows: importRowMapper as never },
  opaque: ['decisions'],
})

export const importCheckMapper = defineMapper<ImportCheckRow>({
  fields: { fileDuplicateOf: 'file_duplicate_of' },
  nested: { matches: duplicateMapper as never },
})

const importFailureMapper = defineMapper({ fields: { company: 'company_name' } })

/** lead_imports: imported_rows, duplicate_rows, failed_rows… The limit details keep the 402 envelope shape (opaque). */
export const importResultMapper = defineMapper<ImportResult>({
  fields: {
    created: 'imported_rows',
    skipped: 'duplicate_rows',
    failed: 'failures',
    skippedRows: 'skipped_rows',
    createdIds: 'created_ids',
    skippedForLimit: 'skipped_for_limit',
    limitReached: 'limit_reached',
  },
  nested: { failed: importFailureMapper as never, skippedRows: importFailureMapper as never },
  opaque: ['limitReached'],
})

/* ---------------- Settings lookups (lead_statuses, lead_sources, industries, loss_reasons, tags, service_categories) ---------------- */

/** A plain list item: `key` is the row's id; name, sort_order, is_active. */
export const listOptionMapper = defineMapper<ListOption>({
  fields: { key: 'id', label: 'name', active: 'is_active', order: 'sort_order', system: 'is_system', hiddenFromPickers: 'hidden_from_pickers' },
})

/** lead_statuses: code (the stable key), name, type, color, sort_order, is_active + the requirement flags. */
export const statusOptionMapper = defineMapper<StatusOption>({
  fields: {
    ...listOptionMapper.fields,
    key: 'code',
    requiresNextStep: 'requires_next_step',
    requiresLossReason: 'requires_loss_reason',
  },
})

/** industries (a tree): sub-industries are the children (industries.parent_id). */
export const industryOptionMapper = extendMapper(listOptionMapper, { fields: { subIndustries: 'sub_industries' }, nested: { subIndustries: listOptionMapper as never } })

/** The list names on the wire (GET /lookups keys and PUT /lookups/:list): the table names. */
export const LOOKUP_LIST_API: Record<LookupList, string> = {
  statuses: 'lead_statuses',
  sources: 'lead_sources',
  industries: 'industries',
  lossReasons: 'loss_reasons',
  tags: 'tags',
  serviceCategories: 'service_categories',
}

const LIST_ITEM_MAPPER: Record<LookupList, Mapper<unknown>> = {
  statuses: statusOptionMapper as never,
  sources: listOptionMapper as never,
  industries: industryOptionMapper as never,
  lossReasons: listOptionMapper as never,
  tags: listOptionMapper as never,
  serviceCategories: listOptionMapper as never,
}

/** The item mapper of one list. */
export const lookupItemMapper = (list: LookupList) => LIST_ITEM_MAPPER[list]

export const lookupsMapper = defineMapper<Lookups>({
  fields: LOOKUP_LIST_API,
  nested: LIST_ITEM_MAPPER,
})

/* ---------------- Contracts (table contracts) ---------------- */

/**
 * contracts: customer_id, quotation_id, created_by, title, status, start_date, renewal_date. The
 * per-cycle amount and its cycle have no column (gaps): cycle_value / billing_period (part A's proposal).
 * Services live in contract_items in the design; the app keeps the ids on the contract (service_ids).
 */
const CONTRACT_FIELDS = {
  customerId: 'customer_id',
  quotationId: 'quotation_id',
  createdBy: 'created_by',
  value: 'cycle_value',
  billing: 'billing_period',
  startDate: 'start_date',
  renewalDate: 'renewal_date',
  ownerId: 'owner_id',
  serviceIds: 'service_ids',
} as const

/** GET /contracts rows (with the derived renewal_due, customer_name, annual_value, mrr…). */
export const contractRowMapper = defineMapper<ContractRow>({ fields: CONTRACT_FIELDS })

/** POST /contracts and PATCH /contracts/:id bodies. */
export const contractInputMapper = defineMapper<ContractInput & ContractUpdateInput>({ fields: CONTRACT_FIELDS })

/* ---------------- Customers (table customers) ---------------- */

/**
 * customers: industry_id, account_manager_id (the owner), address_line, city (the emirate),
 * status, customer_since (when the lead was won), website. The won lead, deal value, source and services
 * have no customers column (gaps): lead_id, won_value, source_id, service_ids, company_services.
 */
const CUSTOMER_FIELDS = {
  industry: 'industry_id',
  subIndustry: 'sub_industry_id',
  leadId: 'lead_id',
  ownerId: 'account_manager_id',
  ownerName: 'account_manager_name',
  createdAt: 'created_at',
  address: 'address_line',
  emirate: 'city',
  wonValue: 'won_value',
  wonAt: 'customer_since',
  sourceType: 'source_id',
  serviceIds: 'service_ids',
  companyServices: 'company_services',
} as const

/** GET /customers rows and the PATCH answer. */
export const customerRowMapper = defineMapper<CustomerRow>({ fields: CUSTOMER_FIELDS })

/** GET /customers/:id: the row plus the won lead (leads columns), contacts, contracts, activities and notes. */
export const customerDetailMapper = extendMapper<CustomerDetail>(customerRowMapper, {
  nested: {
    lead: leadMapper as never,
    contacts: contactMapper as never,
    contracts: contractRowMapper as never,
    recentActivities: activityMapper as never,
    notes: noteMapper as never,
  },
})

/** PATCH /customers/:id body: status, website, address_line, city, account_manager_id. */
export const customerUpdateMapper = defineMapper<CustomerUpdateInput>({ fields: CUSTOMER_FIELDS })

/* ---------------- Quotations (tables quotations + quotation_items) ---------------- */

/**
 * quotation_items: service_id, description, quantity, unit_price, discount_percent. The billing unit,
 * the line's own currency and the package grouping have no column (gaps): unit, currency_code, group_id, group_label.
 */
export const quotationItemMapper = defineMapper<QuotationItem>({
  fields: { serviceId: 'service_id', unitPrice: 'unit_price', discountPct: 'discount_percent', currency: 'currency_code', groupId: 'group_id', groupLabel: 'group_label' },
})

/** The computed totals: quotations.subtotal, discount_total, tax_total, total. */
export const quotationTotalsMapper = defineMapper<QuotationTotals>({ fields: { discount: 'discount_total', vat: 'tax_total' } })

/**
 * quotations: number, lead_id, customer_id, created_by, title, status, currency_code, valid_until,
 * sent_at, accepted_at, notes, terms. Gaps: the copied client details (company_name, contact_name,
 * contact_email), the VAT percent (tax_percent, a quotation_items column in the design), viewed_at, decided_at.
 */
const QUOTATION_FIELDS = {
  leadId: 'lead_id',
  customerId: 'customer_id',
  company: 'company_name',
  contactName: 'contact_name',
  contactEmail: 'contact_email',
  vatPct: 'tax_percent',
  currency: 'currency_code',
  validUntil: 'valid_until',
  createdBy: 'created_by',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  sentAt: 'sent_at',
  decidedAt: 'decided_at',
  viewedAt: 'viewed_at',
  acceptedAt: 'accepted_at',
} as const

/** Every quotation response (list, detail, create, update, send, status, viewed, duplicate). */
export const quotationMapper = defineMapper<Quotation>({
  fields: QUOTATION_FIELDS,
  nested: { items: quotationItemMapper as never, totals: quotationTotalsMapper as never },
})

/** POST /quotations and PATCH /quotations/:id bodies. */
export const quotationInputMapper = defineMapper<QuotationInput & QuotationUpdateInput>({
  fields: QUOTATION_FIELDS,
  nested: { items: quotationItemMapper as never },
})

/** GET /quotations query parameters (UI → API names). */
export const QUOTATION_QUERY = { leadId: 'lead_id' } as const

/* ---------------- Won flow (POST /leads/:id/won, /won/preview) ---------------- */

/** The body: quotation_id, service_ids, project_manager_id (→ projects.manager_id), start_date, idempotency_key. */
export const wonInputMapper = defineMapper<WonInput & WonPreviewQuery>()

const wonPreviewTaskMapper = defineMapper<WonPreviewTask>({ fields: { hours: 'estimated_hours' } })
const wonPreviewProjectMapper = defineMapper<WonPreviewProject>({ nested: { tasks: wonPreviewTaskMapper as never } })
const wonQuotationMapper = defineMapper({ fields: { status: 'status' } })

/** What will happen: the lead (leads columns), the customer, the quotation, contract (contracts columns) and projects. */
export const wonPreviewMapper = defineMapper<WonPreview>({
  fields: { company: 'company_name', status: 'status_id' },
  nested: {
    customer: defineMapper() as never,
    quotation: wonQuotationMapper as never,
    quotationOptions: wonQuotationMapper as never,
    defaults: defineMapper() as never,
    contract: contractRowMapper as never,
    projects: wonPreviewProjectMapper as never,
    notify: defineMapper() as never,
  },
})

/** The result: lead_id, customer_id, customer_created, contract_id, project_ids, task_ids, redirect_to. */
export const wonResultMapper = defineMapper<WonResult>()

/* ---------------- Messages (POST /leads/:id/messages, table messages) ---------------- */

/** The composer body: channel, to_address, subject, body; the template it started from (message_template_id, gap on messages). */
export const sendMessageMapper = defineMapper<SendMessageInput>({ fields: { to: 'to_address', templateId: 'message_template_id' } })

/** The answer: the logged activity (activities columns), the automatic status move, and the email that went out (from_address). */
export const sendMessageResultMapper = defineMapper<SendMessageResult>({
  nested: {
    activity: activityMapper as never,
    autoStatus: activityMapper.spec.nested!.autoStatus as never,
    email: defineMapper({ fields: { from: 'from_address' } }) as never,
  },
})

/* ---------------- Services, packages, project templates ---------------- */

/** project_template_tasks: title, day_offset, estimated_hours. The delivery role has no column (gap: role). */
export const templateTaskMapper = defineMapper<TemplateTask>({ fields: { dayOffset: 'day_offset', hours: 'estimated_hours' } })

/** project_templates (one per service): service_id + its tasks; updated_at / updated_by (updated_by: gap). */
export const projectTemplateMapper = defineMapper<ProjectTemplate & ProjectTemplateInput>({
  fields: { serviceId: 'service_id' },
  nested: { tasks: templateTaskMapper as never },
})

/**
 * services: category_id, name, description, pricing_type, price, currency_code, delivery_days, is_active.
 * Suitable industries are the service_industry pivot in the design (industry_ids here).
 */
const SERVICE_FIELDS = { category: 'category_id', industries: 'industry_ids', currency: 'currency_code', active: 'is_active' } as const

/** Catalog rows (with usage counts, template_tasks, template_hours, package_count) and every write's answer. */
export const serviceRowMapper = defineMapper<ServiceRow>({ fields: SERVICE_FIELDS, nested: { usage: defineMapper() as never } })

/** POST /services and PATCH /services/:id bodies. */
export const serviceInputMapper = defineMapper<ServiceInput & ServiceUpdateInput>({ fields: SERVICE_FIELDS })

const activeFlagMapper = defineMapper({ fields: { active: 'is_active' } })
const leadRefMapper = defineMapper({ fields: { company: 'company_name', status: 'status_id' } })

/** GET /services/:id: the row + its template, packages, recommending leads (leads columns), recent quotations, customers. */
export const serviceDetailMapper = extendMapper<ServiceDetail>(serviceRowMapper, {
  nested: {
    template: projectTemplateMapper as never,
    packages: activeFlagMapper as never,
    recommendingLeads: leadRefMapper as never,
    recentQuotations: defineMapper({ fields: { company: 'company_name' } }) as never,
    customers: defineMapper() as never,
  },
})

/** service_package_items: service_id, quantity. */
const packageItemMapper = defineMapper<PackageItem>({ fields: { serviceId: 'service_id' } })

/** service_packages: name, description, price (the package price), currency_code, is_active + items. */
const PACKAGE_FIELDS = { packagePrice: 'price', currency: 'currency_code', active: 'is_active' } as const

/** Package rows (with list_price, saving, saving_pct and the display lines). */
export const packageRowMapper = defineMapper<PackageRow>({
  fields: PACKAGE_FIELDS,
  nested: { items: packageItemMapper as never, lines: defineMapper({ fields: { serviceId: 'service_id', active: 'is_active' } }) as never },
})

/** POST /services/packages and PATCH /services/packages/:id bodies. */
export const packageInputMapper = defineMapper<PackageInput & PackageUpdateInput>({ fields: PACKAGE_FIELDS, nested: { items: packageItemMapper as never } })

/* ---------------- Tasks (tasks, task_followers, comments, attachments, time_entries) ---------------- */

/** attachments: original_name, size_bytes, mime_type, uploaded_by, created_at (the upload time). */
export const taskAttachmentMapper = defineMapper<TaskAttachment>({ fields: { name: 'original_name', uploadedAt: 'created_at' } })

/** comments: user_id (the author), body, created_at. @mentions have no column (gap: mentions). */
export const taskCommentMapper = defineMapper<TaskComment>({ fields: { authorId: 'user_id', at: 'created_at' } })

/** The task's history (audit trail): user_id, kind, summary, created_at. */
const taskEventMapper = defineMapper<TaskEvent>({ fields: { at: 'created_at' } })

/** time_entries: project_id, task_id, user_id, entry_date, hours, description, is_billable. */
export const timeEntryMapper = defineMapper<TimeEntryView & TimeEntryInput>()

/**
 * tasks: project_id, parent_task_id, owner_id, created_by, title, description, priority, status,
 * due_date, completed_at, estimated_hours, sort_order, reminder_sent_at, overdue_notified_at.
 * `link` is { type, id } = the design's related_type / related_id morph. Followers are task_followers
 * (follower_ids). Gaps: blocked_at, blocked_reason, template_task_id, day_offset.
 */
const TASK_NESTED = {
  link: defineMapper() as never,
  linkView: defineMapper() as never,
  attachments: taskAttachmentMapper as never,
  comments: taskCommentMapper as never,
  history: taskEventMapper as never,
  timeEntries: timeEntryMapper as never,
  subtasks: defineMapper() as never,
  subtaskProgress: defineMapper() as never,
}

/** Every task response (list, detail, create, update, block, comments, attachments, time entries). */
export const taskMapper = defineMapper<TaskDetailView>({ nested: TASK_NESTED })

/** POST /tasks and PATCH /tasks/:id bodies. */
export const taskInputMapper = defineMapper<TaskInput & TaskUpdateInput>({ nested: { link: defineMapper() as never } })

/** GET /tasks/assignable rows: id, name, title, role, department_id. */
export const assignableUserMapper = defineMapper<AssignableUser>()

/** GET /tasks query parameters (UI → API names): the related_type / related_id morph for the link. */
export const TASK_QUERY: Record<keyof TaskFilter, string> = {
  mine: 'mine',
  ownerId: 'owner_id',
  projectId: 'project_id',
  linkType: 'related_type',
  linkId: 'related_id',
  status: 'status',
  priority: 'priority',
  dueTo: 'due_to',
  dueFrom: 'due_from',
  includeDone: 'include_done',
  blocked: 'blocked',
}

/* ---------------- Audit entries (audit_logs) ---------------- */

/**
 * audit_logs: user_id, event (the action), auditable_type / auditable_id (the record), created_at.
 * The summary and the field-level changes have no column as such (gaps: summary, changes; the design
 * stores old_values / new_values). Change values are left as they are.
 */
export const auditEntryMapper = defineMapper<AuditEntry>({
  fields: { at: 'created_at', action: 'event', entity: 'auditable_type', entityId: 'auditable_id' },
  nested: { changes: defineMapper({ opaque: ['from', 'to'] }) as never },
})

/* ---------------- Projects (projects) ---------------- */

/**
 * projects: customer_id, service_id, quotation_id, contract_id, project_template_id, manager_id, name,
 * status, start_date, end_date, estimated_hours (all mechanical). Gaps: lead_id, created_by, created_from.
 */
export const projectRowMapper = defineMapper<ProjectRow>()

/** GET /projects/:id: the row + its tasks (tasks columns) and audit trail (audit_logs columns). */
export const projectDetailMapper = extendMapper<ProjectDetail>(projectRowMapper, {
  nested: { tasks: taskMapper as never, audit: auditEntryMapper as never },
})

/** POST /projects and PATCH /projects/:id bodies. */
export const projectInputMapper = defineMapper<ProjectInput & ProjectUpdateInput>()

/* ---------------- Departments (departments; goals = departments.goals json) ---------------- */

const DEPARTMENT_FIELDS = { headId: 'head_user_id', costCenter: 'cost_center_code', active: 'is_active' } as const

/** A goal inside departments.goals: title, owner_id, due_date, status, created_at (keys of the json). */
export const departmentGoalMapper = defineMapper<DepartmentGoal & GoalInput>()

/** departments: parent_id, head_user_id, name, cost_center_code, is_active (+ derived head_name, member_count…). */
export const departmentRowMapper = defineMapper<DepartmentRow>({ fields: DEPARTMENT_FIELDS })

/** Department members are users: manager_id, is_active (+ manager_name, is_head). */
export const departmentMemberMapper = defineMapper<DepartmentMember>({ fields: { active: 'is_active' } })

/** GET /departments/:id: the row + goals, members, children, path, tasks (tasks columns), figures, can. */
export const departmentDetailMapper = extendMapper<DepartmentDetail>(departmentRowMapper, {
  nested: {
    goals: departmentGoalMapper as never,
    members: departmentMemberMapper as never,
    children: defineMapper({ fields: { active: 'is_active' } }) as never,
    path: defineMapper() as never,
    tasks: defineMapper() as never,
    figures: defineMapper() as never,
    can: defineMapper() as never,
  },
})

/** GET /departments/org-chart nodes. */
export const orgNodeMapper = defineMapper<OrgNode>({ fields: { active: 'is_active' }, nested: { head: defineMapper() as never } })

/** POST /departments and PATCH /departments/:id bodies. */
export const departmentInputMapper = defineMapper<DepartmentInput & DepartmentUpdateInput>({ fields: DEPARTMENT_FIELDS })

/** POST /departments/move-members body (user_ids, to_department_id, manager_id) and answer (moved). */
export const moveMembersMapper = defineMapper<MoveMembersInput & { moved: number }>()

/** GET /departments query parameters. */
export const DEPARTMENT_QUERY = { includeInactive: 'include_inactive' } as const

/* ---------------- Settings users, roles, security, audit log ---------------- */

/** Records whose fields are all design columns or plain snake_case (security: 2FA status, sessions, policy). */
export const plainMapper = defineMapper<never>()

/**
 * users: department_id, manager_id, name, email, mobile, title (gap), is_active, last_login_at,
 * created_at. The role travels by name (`role`; design: role_id → roles); two_factor_enabled is derived
 * from users.two_factor_secret (gap as a flag). Derived: department_name, manager_name, direct_reports, open_leads.
 */
export const settingsUserMapper = defineMapper<SettingsUserRow & UserInput>({ fields: { active: 'is_active' } })

/** GET /settings/departments (id, name). */
export const departmentOptionMapper = defineMapper<SettingsDepartment>()

/** roles: id, name, is_system; the matrix (role_module_access) is keyed by module (opaque map). */
export const roleMapper = defineMapper<CompanyRoleDefinition>({ fields: { system: 'is_system' }, opaque: ['permissions'] })

/** GET /security/backups: schedule, last_success_at, next_at, retention_days + history runs. */
export const backupStatusMapper = defineMapper<BackupStatusInfo>({ nested: { history: defineMapper() as never } })

/** GET /audit-log query parameters (UI → API names, the audit_logs columns). */
export const AUDIT_QUERY = { entity: 'auditable_type', userId: 'user_id', action: 'event', from: 'from', to: 'to' } as const

/* ---------------- Message templates, targets, automation, reports, dashboard ---------------- */

/** message_templates: type (the channel), name, subject, body, is_active. Gaps: purpose, is_default, updated_by. */
export const templateMapper = defineMapper<MessageTemplate & TemplateInput>({ fields: { channel: 'type', active: 'is_active' } })

/** GET /templates query parameters. */
export const TEMPLATE_QUERY: Record<keyof TemplateFilter, string> = { channel: 'type', purpose: 'purpose', active: 'is_active' }

/**
 * Sales targets (activity_targets: user_id, month, metric, target_value). The app sends one row per
 * agent with `values` / `actuals` keyed by metric: opaque maps (metric keys are data).
 */
export const targetsMapper = defineMapper<TargetsMonth & AgentTargetRow & TargetDefaults & UpdateTargetsInput>({ deep: true, opaque: ['values', 'actuals'] })

/** workflow_settings: one row per company. */
export const automationMapper = defineMapper<AutomationRules>({
  fields: {
    noContactReminderDays: 'first_contact_reminder_days',
    noResponseFollowUpDays: 'no_response_followup_days',
    attemptsBeforeCold: 'max_attempts_before_cold',
    stalledInterestedDays: 'interested_stalled_days',
    lostReopenDays: 'reopen_lost_after_days',
  },
})

/** report_schedules: report_type (saved_reports.report_type; gap: no saved report), frequency, day (gap: day_of_week / day_of_month), run_at, recipients, format, created_by, next_run_at. */
export const reportScheduleMapper = defineMapper<ReportSchedule & ScheduleInput>({ fields: { report: 'report_type', time: 'run_at' } })

/** GET /reports/sales and POST /reports/custom: aggregates (no table), mechanical at every depth; per-type activity counts are an opaque map. */
export const reportMapper = defineMapper<SalesReport & CustomReport & CustomReportInput>({ deep: true, opaque: ['activities'] })

/** GET /reports/sales query parameters. */
export const REPORT_QUERY = { from: 'from', to: 'to', ownerId: 'owner_id', departmentId: 'department_id' } as const

/** GET /dashboard/summary: aggregates, mechanical at every depth. */
export const dashboardMapper = defineMapper<DashboardSummary>({ deep: true })

/* ---------------- Company profile, branding, onboarding, email connection, announcements ---------------- */

/** companies: country_code, currency_code (Settings › Regional); bank details have no column (gaps). */
export const regionalMapper = defineMapper<RegionalSettings>({ fields: { country: 'country_code', currency: 'currency_code' } })

/**
 * Branding (companies.brand_color, logo_path): brand_color is the picked colour; the logos are served
 * as URLs (logo_url, logo_dark_url, favicon_url; dark logo / favicon / monogram / sender are gaps). The
 * derived palette is keyed by shade ('50'…'900'): opaque.
 */
export const brandingMapper = defineMapper<Branding>({ fields: { primaryColor: 'brand_color' }, opaque: ['palette'] })

/** The company profile (legal and contact details: gaps on companies), mechanical at every depth (address, location, bank). */
export const companyProfileMapper = defineMapper<CompanyProfile & CompanyProfilePatch>({ deep: true })

/** A company as the branding endpoints answer it (companies: name, status, created_at; subdomain = company_domains.domain). */
export const companyMapper = defineMapper<Company>({
  nested: { regional: regionalMapper as never, branding: brandingMapper as never, profile: companyProfileMapper as never },
})

/** GET /settings/branding: the branding, the picked colour (brand_color) and the upload limits. */
export const brandingSettingsMapper = defineMapper<BrandingSettings>({
  fields: { primaryColor: 'brand_color' },
  nested: { branding: brandingMapper as never, limits: defineMapper() as never },
})

/** PATCH /settings/branding body: display_name, brand_color, logo_light, logo_dark, favicon. */
export const brandingPatchMapper = defineMapper<BrandingPatch>({ fields: { primaryColor: 'brand_color' }, opaque: ['palette'] })

/** GET /onboarding: items (id, title, description, href, done, manual), done, total, complete, dismissed. */
export const onboardingMapper = defineMapper<OnboardingState>({ nested: { items: defineMapper() as never } })

/** /settings/email-connection: provider, address, connected_at, connected_by (integrations: gap, no row yet). */
export const emailConnectionMapper = defineMapper<EmailConnection>()

/** announcements: title, body, ends_at (+ tone: gap). */
export const companyAnnouncementMapper = defineMapper<CompanyAnnouncement>()

/* ---------------- Billing (subscriptions, plans, plan_limits, platform_invoices, usage) ---------------- */

/**
 * Billing payloads (entitlements, overview, change plan, export, AI credits): mechanical at every depth
 * (subscription.plan_id, current_period_end, payment_method.last4, usage.items[], invoices[].issued_at…).
 * Opaque maps keyed by data: plan `limits` (keyed by limit key, the design's plan_limits.metric rows),
 * the export's `counts` / `data` (keyed by store; rows exported as stored) and the dev `simulated` usage.
 */
export const billingMapper = defineMapper<never>({ deep: true, opaque: ['limits', 'counts', 'data', 'simulated'] })

/* ---------------- Public sign-up (no table until the company exists: gaps) ---------------- */

/**
 * /public/signup*, /public/checkout, /public/contact-sales, /public/plans: mechanical at every depth
 * (signup_id, company_name, admin_email, resend_in_seconds, checkout_id, card_number…). Plans keep
 * their `limits` map opaque (keyed by limit key). The completed sign-up answers a session, which keeps
 * the auth session shape (`session` opaque, like POST /auth/login).
 */
export const signupMapper = defineMapper<never>({ deep: true, opaque: ['limits', 'session'] })

/** `lead_statuses` → `statuses`; unknown names → null. */
export function lookupListFromApi(name: string): LookupList | null {
  const hit = (Object.entries(LOOKUP_LIST_API) as [LookupList, string][]).find(([, api]) => api === name)
  return hit ? hit[0] : null
}
