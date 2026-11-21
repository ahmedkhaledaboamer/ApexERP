import { addDays, format } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { activities, customers, leads, users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { quotations } from '@/shared/mocks/data/quotations'
import { services, packages } from '@/shared/mocks/data/services'
import { templates } from '@/shared/mocks/data/templates'
import { campaigns } from '@/shared/mocks/data/marketing'
import { adCampaigns } from '@/shared/mocks/data/ads'
import { accountsFor } from '@/shared/mocks/services/ads'
import { events } from '@/shared/mocks/data/events'
import { contracts } from '@/shared/mocks/data/contracts'
import { tasks, projects } from '@/shared/mocks/data/tasks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { hrApplications, hrCandidates, hrCourses, hrOpenings, hrSessions } from '@/shared/mocks/data/hrTalent'
import { empIdForUser } from '@/shared/mocks/data/hrEmployees'
import { hrJourneys, hrJourneyTemplates } from '@/shared/mocks/data/hrJourney'
import { hrLetterTypes } from '@/shared/mocks/data/hrSelfService'
import { hrPerfCycles, hrPerfReviews, hrPerfTemplates } from '@/shared/mocks/data/hrPerformance'
import { withHr } from './hrTalentEndpoints'
import { finToday, ownAccount } from './financeLedgerEndpoints'
import { collectionsFixtures as colFx } from './financeCollectionsEndpoints'
import { financeCreditNotes, invoiceRecords } from '@/shared/mocks/data/financeInvoices'
import { companyById } from '@/shared/mocks/data/tenancy'
import { todayIsoIn } from '@/shared/lib/companyDay'
import { addMonths as addMonthsYm } from '@/modules/hr/payroll/calc'
import {
  ADMIN,
  APEX,
  COMPANIES,
  CREST,
  api,
  adminToken,
  label,
  leaksIn,
  other,
  platformToken,
  sliceText,
  useSeedPerTest,
  type Co,
} from './harness'

/**
 * §1 targeted tests: search / duplicate detection / uniqueness are scoped to the company (except the
 * documented platform-wide rules), ids of the other company inside a body or query behave exactly
 * like ids that don't exist, and exports / reports / dashboard numbers equal an own-company recomputation.
 */

useSeedPerTest()

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
const of = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => rows.filter((r) => r.companyId === co && pred(r))
const one = <T extends { companyId: string }>(rows: readonly T[], co: Co, pred: (r: T) => boolean = () => true) => {
  const r = of(rows, co, pred)[0]
  if (!r) throw new Error(`no row in ${co}`)
  return r
}
/** A value of `them` that `co` doesn't have (case-insensitive), so it can only clash across tenants. */
function exclusive<T extends { companyId: string }>(rows: readonly T[], co: Co, value: (r: T) => string): string {
  const mine = new Set(of(rows, co).map((r) => value(r).toLowerCase()))
  const v = of(rows, other(co)).map(value).find((x) => x && !mine.has(x.toLowerCase()))
  if (!v) throw new Error(`no exclusive value in ${other(co)}`)
  return v
}
const openLead = (co: Co) => one(leads, co, (l) => !['Won', 'Lost', 'Not interested'].includes(l.status) && !l.doNotContact)
const dial = (co: Co) => (co === APEX ? '+971 50 555 0199' : '+966 55 555 0199')

describe('Duplicate detection, search and uniqueness are per company', () => {
  for (const co of COMPANIES) {
    const them = other(co)

    it(`${label(co)}: GET /leads/duplicates ignores ${label(them)} leads (a value only ${label(them)} has is no duplicate)`, async () => {
      const theirs = openLead(them)
      const res = await api(adminToken(co), 'GET', `/leads/duplicates?company=${encodeURIComponent(theirs.company)}&email=${encodeURIComponent(theirs.contactEmail)}`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
      // The same probe inside the owning company does find it (the check works).
      const own = await api(adminToken(them), 'GET', `/leads/duplicates?company=${encodeURIComponent(theirs.company)}&email=${encodeURIComponent(theirs.contactEmail)}`)
      expect(own.body.length).toBeGreaterThan(0)
    })

    it(`${label(co)}: import duplicate check ignores ${label(them)} leads`, async () => {
      const theirs = openLead(them)
      const row = { row: 1, company: theirs.company, website: '', contactName: 'Probe', contactTitle: '', mobile: dial(co), email: theirs.contactEmail, isDecisionMaker: true, sourceType: 'Website', sourceDetail: '', industry: 'Logistics', subIndustry: '', status: 'New', ownerId: '', nextFollowUpDate: '', nextStep: '', value: null, companyServices: [], recommendedServiceId: '', recommendedServiceText: '' }
      const res = await api(adminToken(co), 'POST', '/leads/import/check', { body: { rows: [row] } })
      expect(res.status, res.text).toBe(200)
      expect(res.body[0].matches).toEqual([])
      expect(leaksIn(res.body, co)).toEqual([])
      const own = await api(adminToken(them), 'POST', '/leads/import/check', { body: { rows: [{ ...row, mobile: dial(them) }] } })
      expect(own.body[0].matches.length).toBeGreaterThan(0)
    })

    it(`${label(co)}: a lead named like a ${label(them)} lead is created (no 409)`, async () => {
      const theirs = openLead(them)
      const res = await api(adminToken(co), 'POST', '/leads', { body: { company: theirs.company, contactName: 'Probe Person', mobile: dial(co), email: theirs.contactEmail, sourceType: 'Website', industry: 'Logistics' } })
      expect(res.status, res.text).toBe(200)
      expect(leads.find((l) => l.id === res.body.id)?.companyId).toBe(co)
    })

    it(`${label(co)}: template, service, package and department names of ${label(them)} are free to use`, async () => {
      const tpl = exclusive(templates, co, (t) => t.name)
      const t = await api(adminToken(co), 'POST', '/templates', { body: { type: 'email', name: tpl, purpose: 'First follow-up', subject: 'Hi', body: 'Hello there' } })
      expect(t.status, t.text).toBe(200)
      const svcName = exclusive(services, co, (s) => s.name)
      const base = one(services, co, (s) => s.active)
      const s = await api(adminToken(co), 'POST', '/services', { body: { name: svcName, category_id: base.category, description: '', industry_ids: [], pricing_type: base.pricingType, price: 10, currency_code: base.currency, delivery_days: 1 } })
      expect(s.status, s.text).toBe(200)
      const pkgName = exclusive(packages, co, (p) => p.name)
      const two = of(services, co, (x) => x.active).slice(0, 2)
      const p = await api(adminToken(co), 'POST', '/services/packages', { body: { name: pkgName, description: '', items: two.map((x) => ({ service_id: x.id, quantity: 1 })), price: 10, currency_code: base.currency } })
      expect(p.status, p.text).toBe(200)
      const deptName = exclusive(departments, co, (d) => d.name)
      const d = await api(adminToken(co), 'POST', '/departments', { body: { name: deptName, parent_id: null, head_user_id: null } })
      expect(d.status, d.text).toBe(200)
    })

    it(`${label(co)}: list values (lookups) of ${label(them)} don't clash`, async () => {
      // GET /lookups speaks the industries columns: id, name, is_active, sort_order.
      const mine = (await api(adminToken(co), 'GET', '/lookups')).body.industries as { id: string; name: string }[]
      const theirs = (await api(adminToken(them), 'GET', '/lookups')).body.industries as { id: string; name: string; is_active: boolean; sort_order: number }[]
      const extra = theirs.find((x) => !mine.some((m) => m.name.toLowerCase() === x.name.toLowerCase()))
      if (!extra) throw new Error('no exclusive industry')
      const res = await api(adminToken(co), 'PUT', '/lookups/industries', { body: { items: [...mine, { ...extra, sort_order: mine.length }] } })
      expect(res.status, res.text).toBe(200)
      expect((res.body.industries as { name: string }[]).some((x) => x.name === extra.name)).toBe(true)
    })

    it(`${label(co)}: email uniqueness is platform-wide by design — 409 email_taken that never names ${label(them)}`, async () => {
      const theirEmail = users.find((u) => u.companyId === them)!.email
      const sales = one(departments, co, (x) => /sales/i.test(x.name))
      const res = await api(adminToken(co), 'POST', '/settings/users', { body: { name: 'Probe', email: theirEmail, mobile: dial(co), role: 'Sales Agent', title: 'Rep', department_id: sales.id, manager_id: null } })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('email_taken')
      expect(leaksIn(res.body, co)).toEqual([])
      expect(res.text).not.toMatch(/crest|apex aora|co_/i)
    })
  }

  it('subdomain availability is platform-wide by design and never names the holder', async () => {
    const res = await api(null, 'GET', '/public/signup/availability?subdomain=crest')
    expect(res.status).toBe(200)
    expect(res.body.available).toBe(false)
    expect(res.text).not.toMatch(/Crest Logistics|co_crest/)
  })
})

/** A request whose body/query names an id: the other company's id must behave exactly like a missing one. */
interface Ref {
  name: string
  method: string
  path: (co: Co) => string
  body?: (co: Co, id: string) => unknown
  query?: (id: string) => string
  /** An id of `co`'s own kind (the foreign variant uses the other company's). */
  id: (co: Co) => string
}

/** HR refs: the path turns HR on for the caller's company first (Crest's plan has no HR). */
const hrPath = (path: string) => (co: Co) => {
  withHr(co)
  return path
}
const hrOpen = (co: Co) => one(hrOpenings, co, (o) => o.status === 'open')
/** The month after the company's current one (payroll adjustments / loans can't target a paid month). */
const payNext = (co: Co) => addMonthsYm(todayIsoIn(companyById(co)!.regional.timezone).slice(0, 7), 1)
/** Performance refs: the check-in template (goals off), a valid ad-hoc cycle body, and the review of the top manager (no manager: the admin, HR full, reviews it). */
const perfCheckin = (co: Co) => one(hrPerfTemplates, co, (t) => !t.goalsEnabled && t.selfReview && !t.forProbation).id
const perfCycle = (co: Co, extra: Record<string, unknown>) => ({
  name: 'Ref cycle', type: 'ad_hoc', template_id: perfCheckin(co), period_start: day(-30), period_end: day(0),
  deadlines: { self_review: day(5), manager_review: day(10), calibration: day(15) }, ...extra,
})
const perfTopReview = (co: Co) => one(hrPerfReviews, co, (r) => r.employeeId === empIdForUser(co === APEX ? 'u2' : 'u102') && r.cycleId === one(hrPerfCycles, co, (c) => c.phase === 'self_review').id).id
const hrApp = (co: Co) => one(hrApplications, co, (a) => a.stage === 'screening').id

const REFS: Ref[] = [
  { name: 'task owner', method: 'POST', path: () => '/tasks', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ title: 'Ref', owner_id: id }) },
  { name: 'task follower', method: 'POST', path: () => '/tasks', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ title: 'Ref', follower_ids: [id] }) },
  { name: 'task link lead', method: 'POST', path: () => '/tasks', id: (co) => openLead(co).id, body: (_co, id) => ({ title: 'Ref', link: { type: 'lead', id } }) },
  { name: 'task project', method: 'POST', path: () => '/tasks', id: (co) => one(projects, co).id, body: (_co, id) => ({ title: 'Ref', project_id: id }) },
  { name: 'contract customer', method: 'POST', path: () => '/contracts', id: (co) => one(customers, co).id, body: (co, id) => ({ customer_id: id, title: 'Ref', service_ids: [one(services, co, (s) => s.active).id], cycle_value: 1, billing_period: 'Monthly', start_date: day(1), renewal_date: day(300) }) },
  { name: 'contract service', method: 'POST', path: () => '/contracts', id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ customer_id: one(customers, co).id, title: 'Ref', service_ids: [id], cycle_value: 1, billing_period: 'Monthly', start_date: day(1), renewal_date: day(300) }) },
  { name: 'quotation lead', method: 'POST', path: () => '/quotations', id: (co) => openLead(co).id, body: (co, id) => ({ lead_id: id, title: 'Ref', valid_until: day(30), items: [{ description: 'x', quantity: 1, unit: 'project', unit_price: 1, discount_percent: 0, service_id: one(services, co, (s) => s.active).id }], notes: '', terms: '' }) },
  { name: 'quotation service', method: 'POST', path: () => '/quotations', id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ lead_id: openLead(co).id, title: 'Ref', valid_until: day(30), items: [{ description: 'x', quantity: 1, unit: 'project', unit_price: 1, discount_percent: 0, service_id: id }], notes: '', terms: '' }) },
  { name: 'project customer', method: 'POST', path: () => '/projects', id: (co) => one(customers, co).id, body: (co, id) => ({ name: 'Ref', customer_id: id, service_id: one(services, co, (s) => s.active).id, manager_id: ADMIN[co], start_date: day(10), end_date: day(40), status: 'planned', estimated_hours: 0, generate_tasks: false }) },
  { name: 'project manager', method: 'POST', path: () => '/projects', id: (co) => ADMIN[co], body: (co, id) => ({ name: 'Ref', customer_id: one(customers, co).id, service_id: one(services, co, (s) => s.active).id, manager_id: id, start_date: day(10), end_date: day(40), status: 'planned', estimated_hours: 0, generate_tasks: false }) },
  { name: 'contact record', method: 'POST', path: () => '/contacts', id: (co) => openLead(co).id, body: (co, id) => ({ recordType: 'lead', recordId: id, name: 'Ref', title: '', mobile: dial(co), email: 'ref@example.org', isDecisionMaker: false }) },
  { name: 'lead owner', method: 'PATCH', path: (co) => `/leads/${openLead(co).id}`, id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ ownerId: id }) },
  { name: 'lead services', method: 'PATCH', path: (co) => `/leads/${openLead(co).id}`, id: (co) => one(services, co, (s) => s.active).id, body: (_co, id) => ({ service_ids: [id] }) },
  { name: 'move members user', method: 'POST', path: () => '/departments/move-members', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (co, id) => ({ user_ids: [id], to_department_id: one(departments, co, (d) => d.active).id }) },
  { name: 'move members target', method: 'POST', path: () => '/departments/move-members', id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => ({ user_ids: [one(users, co, (u) => u.role === 'Sales Agent').id], to_department_id: id }) },
  { name: 'department head', method: 'POST', path: () => '/departments', id: (co) => one(users, co, (u) => u.role === 'Sales Manager').id, body: (_co, id) => ({ name: 'Ref Dept', parent_id: null, head_user_id: id }) },
  { name: 'department parent', method: 'POST', path: () => '/departments', id: (co) => one(departments, co, (d) => d.active).id, body: (_co, id) => ({ name: 'Ref Dept', parent_id: id, head_user_id: null }) },
  { name: 'user department', method: 'POST', path: () => '/settings/users', id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => ({ name: 'Ref', email: `ref-${co}@example.org`, mobile: dial(co), role: 'Sales Agent', title: 'Rep', department_id: id, manager_id: null }) },
  { name: 'user manager', method: 'POST', path: () => '/settings/users', id: (co) => one(users, co, (u) => u.role === 'Sales Manager').id, body: (co, id) => ({ name: 'Ref', email: `ref-${co}@example.org`, mobile: dial(co), role: 'Sales Agent', title: 'Rep', department_id: one(departments, co, (d) => /sales/i.test(d.name)).id, manager_id: id }) },
  { name: 'won project manager', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => ADMIN[co], body: (co, id) => ({ service_ids: [one(services, co, (s) => s.active).id], project_manager_id: id, start_date: day(20), idempotency_key: `ref-${co}` }) },
  { name: 'won service', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ service_ids: [id], project_manager_id: ADMIN[co], start_date: day(20), idempotency_key: `ref-${co}` }) },
  { name: 'won quotation', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => one(quotations, co).id, body: (co, id) => ({ quotation_id: id, service_ids: [one(services, co, (s) => s.active).id], project_manager_id: ADMIN[co], start_date: day(20), idempotency_key: `ref-${co}` }) },
  { name: 'message template', method: 'POST', path: (co) => `/leads/${openLead(co).id}/messages`, id: (co) => one(templates, co, (t) => t.active).id, body: (co, id) => ({ channel: 'email', to_address: openLead(co).contactEmail, subject: 'x', body: 'x', message_template_id: id }) },
  { name: 'package service', method: 'POST', path: () => '/services/packages', id: (co) => of(services, co, (s) => s.active)[1].id, body: (co, id) => ({ name: 'Ref package', description: '', items: [{ service_id: one(services, co, (s) => s.active).id, quantity: 1 }, { service_id: id, quantity: 1 }], price: 1 }) },
  { name: 'report owner filter', method: 'GET', path: () => '/reports/sales', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, query: (id) => `?from=${day(-300)}&to=${day(0)}&owner_id=${id}` },
  { name: 'report department filter', method: 'GET', path: () => '/reports/sales', id: (co) => one(departments, co, (d) => d.active).id, query: (id) => `?from=${day(-300)}&to=${day(0)}&department_id=${id}` },
  { name: 'quotations lead filter', method: 'GET', path: () => '/quotations', id: (co) => one(quotations, co).leadId, query: (id) => `?lead_id=${id}` },
  { name: 'tasks owner filter', method: 'GET', path: () => '/tasks', id: (co) => one(tasks, co).ownerId, query: (id) => `?owner_id=${id}&include_done=true` },
  { name: 'lead campaign', method: 'PATCH', path: (co) => `/leads/${openLead(co).id}`, id: (co) => one(campaigns, co).id, body: (_co, id) => ({ campaign_id: id }) },
  { name: 'campaign owner', method: 'POST', path: () => '/marketing/campaigns', id: (co) => ADMIN[co], body: (_co, id) => ({ name: 'Ref campaign', channel: 'ads', owner_id: id }) },
  { name: 'bulk email campaign', method: 'POST', path: () => '/marketing/emails', id: (co) => one(campaigns, co).id, body: (_co, id) => ({ name: 'Ref email', campaign_id: id }) },
  { name: 'bulk email template', method: 'POST', path: () => '/marketing/emails', id: (co) => one(templates, co, (t) => t.active && t.channel === 'email').id, body: (_co, id) => ({ name: 'Ref email', message_template_id: id }) },
  { name: 'bulk email owner filter', method: 'POST', path: () => '/marketing/emails', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ name: 'Ref email', filters: { owner_ids: [id] } }) },
  { name: 'event owner', method: 'POST', path: () => '/events', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ name: 'Ref event', type: 'meeting', start_date: day(10), owner_id: id }) },
  { name: 'event team on create', method: 'POST', path: () => '/events', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ name: 'Ref event', type: 'meeting', start_date: day(10), team_ids: [id] }) },
  { name: 'event team member', method: 'POST', path: (co) => `/events/${one(events, co, (e) => e.status === 'confirmed').id}/team`, id: (co) => one(users, co, (u) => u.role === 'Management').id, body: (_co, id) => ({ user_id: id }) },
  { name: 'event owner change', method: 'PATCH', path: (co) => `/events/${one(events, co, (e) => e.status === 'confirmed').id}`, id: (co) => one(users, co, (u) => u.role === 'Management').id, body: (_co, id) => ({ owner_id: id }) },
  { name: 'task link event', method: 'POST', path: () => '/tasks', id: (co) => one(events, co).id, body: (_co, id) => ({ title: 'Ref', link: { type: 'event', id } }) },
  { name: 'ad campaign mapping', method: 'PATCH', path: (co) => `/marketing/ads/campaigns/${one(adCampaigns, co).id}`, id: (co) => one(campaigns, co).id, body: (_co, id) => ({ campaign_id: id }) },
  { name: 'ad account connect', method: 'POST', path: () => '/marketing/ads/connections', id: (co) => accountsFor(co, 'tiktok')[2].accountId, body: (_co, id) => ({ provider: 'tiktok', account_id: id, consent: true }) },
  { name: 'audit user filter', method: 'GET', path: () => '/audit-log', id: (co) => ADMIN[co], query: (id) => `?user_id=${id}` },
  /* HR › recruitment, training (Crest gets HR through a module override; hrOpen(co) turns it on). */
  { name: 'hr opening department', method: 'POST', path: hrPath('/hr/recruitment/openings'), id: (co) => hrOpen(co).departmentId, body: (co, id) => ({ title: 'Ref role', department_id: id, hiring_manager_id: ADMIN[co], headcount: 1 }) },
  { name: 'hr opening hiring manager', method: 'POST', path: hrPath('/hr/recruitment/openings'), id: (co) => ADMIN[co], body: (co, id) => ({ title: 'Ref role', department_id: hrOpen(co).departmentId, hiring_manager_id: id, headcount: 1 }) },
  { name: 'hr candidate opening', method: 'POST', path: hrPath('/hr/recruitment/candidates'), id: (co) => hrOpen(co).id, body: (co, id) => ({ full_name: 'Ref Candidate', email: `ref-${co}@candidates.test`, opening_id: id }) },
  { name: 'hr application candidate', method: 'POST', path: hrPath('/hr/recruitment/applications'), id: (co) => one(hrCandidates, co).id, body: (co, id) => ({ candidate_id: id, opening_id: hrOpen(co).id }) },
  { name: 'hr application opening', method: 'POST', path: hrPath('/hr/recruitment/applications'), id: (co) => hrOpen(co).id, body: (co, id) => ({ candidate_id: one(hrCandidates, co).id, opening_id: id }) },
  { name: 'hr interviewers', method: 'POST', path: (co) => hrPath(`/hr/recruitment/applications/${hrApp(co)}/interviews`)(co), id: (co) => ADMIN[co], body: (_co, id) => ({ date: day(5), time: '10:00', type: 'video', interviewer_ids: [id] }) },
  { name: 'hr enrollment employee', method: 'POST', path: (co) => hrPath(`/hr/training/sessions/${one(hrSessions, co, (s) => s.status === 'scheduled').id}/enrollments`)(co), id: (co) => empIdForUser(ADMIN[co]), body: (_co, id) => ({ employee_ids: [id] }) },
  // HR › Salary Management (handlers/hrPayroll.ts): employee ids in bodies and filters.
  { name: 'payroll adjustment employee', method: 'POST', path: hrPath('/hr/payroll/adjustments'), id: (co) => empIdForUser(ADMIN[co]), body: (co, id) => ({ employee_id: id, kind: 'bonus', label: 'Ref bonus', amount: 10, month: payNext(co) }) },
  { name: 'payroll loan employee', method: 'POST', path: hrPath('/hr/payroll/loans'), id: (co) => empIdForUser(ADMIN[co]), body: (co, id) => ({ employee_id: id, principal: 100, installment_amount: 50, start_month: payNext(co) }) },
  { name: 'payroll settlement preview employee', method: 'POST', path: hrPath('/hr/payroll/settlements/preview'), id: (co) => empIdForUser(ADMIN[co]), body: (_co, id) => ({ employee_id: id, reason: 'termination', exit_date: day(0) }) },
  { name: 'payroll settlement employee', method: 'POST', path: hrPath('/hr/payroll/settlements'), id: (co) => empIdForUser(ADMIN[co]), body: (_co, id) => ({ employee_id: id, reason: 'termination', exit_date: day(0) }) },
  { name: 'payroll adjustments filter', method: 'GET', path: hrPath('/hr/payroll/adjustments'), query: (id) => `?employee_id=${id}`, id: (co) => empIdForUser(ADMIN[co]) },
  { name: 'payroll payslips filter', method: 'GET', path: hrPath('/hr/payroll/payslips'), query: (id) => `?employee_id=${id}`, id: (co) => empIdForUser(ADMIN[co]) },
  { name: 'hr report department filter', method: 'GET', path: hrPath('/hr/reports/headcount'), query: (id) => `?department_id=${id}`, id: (co) => one(departments, co, (d) => d.active).id },
  { name: 'hr report export department filter', method: 'GET', path: hrPath('/hr/reports/attendance/export'), query: (id) => `?department_id=${id}`, id: (co) => one(departments, co, (d) => d.active).id },
  // HR › Self-service / letters (handlers/hrSelfService.ts): HR files a letter for an employee; the type; the list filter.
  { name: 'hr letter request employee', method: 'POST', path: hrPath('/hr/letters/requests'), id: (co) => empIdForUser(co === 'co_apex' ? 'u14' : 'u107'), body: (co, id) => ({ letter_type_id: one(hrLetterTypes, co, (t) => t.code === 'employment_certificate').id, employee_id: id, addressee: 'Ref' }) },
  { name: 'hr letter request type', method: 'POST', path: hrPath('/hr/letters/requests'), id: (co) => one(hrLetterTypes, co, (t) => t.code === 'employment_certificate').id, body: (co, id) => ({ letter_type_id: id, employee_id: empIdForUser(co === 'co_apex' ? 'u14' : 'u107'), addressee: 'Ref' }) },
  { name: 'hr letter requests employee filter', method: 'GET', path: hrPath('/hr/letters/requests'), query: (id) => `?employee_id=${id}`, id: (co) => empIdForUser(co === 'co_apex' ? 'u14' : 'u107') },
  // HR › Onboarding & offboarding (isolation/hrJourneyEndpoints.ts).
  { name: 'journey employee', method: 'POST', path: hrPath('/hr/journeys'), id: (co) => empIdForUser(ADMIN[co]), body: (_co, id) => ({ employee_id: id, kind: 'onboarding' }) },
  { name: 'journey template', method: 'POST', path: hrPath('/hr/journeys'), id: (co) => one(hrJourneyTemplates, co, (t) => t.kind === 'onboarding').id, body: (co, id) => ({ employee_id: empIdForUser(ADMIN[co]), kind: 'onboarding', template_id: id }) },
  { name: 'journey employee filter', method: 'GET', path: hrPath('/hr/journeys'), query: (id) => `?employee_id=${id}`, id: (co) => one(hrJourneys, co).employeeId },
  { name: 'journey template department', method: 'POST', path: hrPath('/hr/journeys/templates'), id: (co) => one(departments, co, (d) => d.active).id, body: (_co, id) => ({ kind: 'onboarding', name: 'Ref template', department_id: id, items: [{ title: 'Ref step', owner_role: 'hr', due_offset_days: 0 }] }) },
  { name: 'journey template owner user', method: 'POST', path: hrPath('/hr/journeys/templates'), id: (co) => ADMIN[co], body: (_co, id) => ({ kind: 'onboarding', name: 'Ref template', items: [{ title: 'Ref step', owner_role: 'user', owner_user_id: id, due_offset_days: 0 }] }) },
  // HR › Performance (isolation/hrPerformanceEndpoints.ts): cycle template / departments / participants, the reviews filter, recommended courses.
  { name: 'performance cycle template', method: 'POST', path: hrPath('/hr/performance/cycles'), id: (co) => perfCheckin(co), body: (co, id) => perfCycle(co, { template_id: id }) },
  { name: 'performance cycle department', method: 'POST', path: hrPath('/hr/performance/cycles'), id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => perfCycle(co, { department_ids: [id] }) },
  { name: 'performance cycle participant', method: 'POST', path: hrPath('/hr/performance/cycles'), id: (co) => empIdForUser(ADMIN[co]), body: (co, id) => perfCycle(co, { employee_ids: [id] }) },
  { name: 'performance reviews cycle filter', method: 'GET', path: hrPath('/hr/performance/reviews'), query: (id) => `?cycle_id=${id}`, id: (co) => one(hrPerfCycles, co, (c) => c.phase === 'self_review').id },
  { name: 'performance recommended course', method: 'PUT', path: (co) => hrPath(`/hr/performance/reviews/${perfTopReview(co)}/manager`)(co), id: (co) => one(hrCourses, co).id, body: (_co, id) => ({ recommended_course_ids: [id], submit: false }) },
  { name: 'journey item assignee', method: 'POST', path: (co) => hrPath(`/hr/journeys/${one(hrJourneys, co, (j) => j.status === 'active').id}/items`)(co), id: (co) => ADMIN[co], body: (_co, id) => ({ title: 'Ref item', owner_role: 'user', assignee_user_id: id }) },
  // Accounts & finance › ledger (isolation/financeLedgerEndpoints.ts): account / dimension ids in bodies and filters
  // (seeded chart ids are shared by design, so the refs use a company-unique `ACC-N…` account).
  { name: 'manual journal account', method: 'POST', path: () => '/finance/journal', id: (co) => ownAccount(co).id, body: (co, id) => ({ date: finToday(co), memo: 'Ref', lines: [{ account_id: id, debit: 1, credit: 0 }, { account_id: 'ACC-1120', debit: 0, credit: 1 }] }) },
  { name: 'manual journal department', method: 'POST', path: () => '/finance/journal', id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => ({ date: finToday(co), memo: 'Ref', lines: [{ account_id: 'ACC-6800', debit: 1, credit: 0, department_id: id }, { account_id: 'ACC-1120', debit: 0, credit: 1 }] }) },
  { name: 'manual journal customer', method: 'POST', path: () => '/finance/journal', id: (co) => one(customers, co).id, body: (co, id) => ({ date: finToday(co), memo: 'Ref', lines: [{ account_id: 'ACC-6800', debit: 1, credit: 0, customer_id: id }, { account_id: 'ACC-1120', debit: 0, credit: 1 }] }) },
  { name: 'manual journal event', method: 'POST', path: () => '/finance/journal', id: (co) => one(events, co).id, body: (co, id) => ({ date: finToday(co), memo: 'Ref', lines: [{ account_id: 'ACC-6800', debit: 1, credit: 0, event_id: id }, { account_id: 'ACC-1120', debit: 0, credit: 1 }] }) },
  { name: 'opening balance account', method: 'POST', path: () => '/finance/opening-balances', id: (co) => ownAccount(co).id, body: (co, id) => ({ date: finToday(co), lines: [{ account_id: id, debit: 5, credit: 0 }] }) },
  { name: 'account parent', method: 'POST', path: () => '/finance/accounts', id: (co) => ownAccount(co, 'expense', true).id, body: (_co, id) => ({ code: '6971', name: 'Ref account', type: 'expense', parent_id: id }) },
  { name: 'finance default revenue account', method: 'PATCH', path: () => '/finance/settings', id: (co) => ownAccount(co, 'income').id, body: (_co, id) => ({ default_revenue_account_id: id }) },
  { name: 'finance default bank account', method: 'PATCH', path: () => '/finance/settings', id: (co) => ownAccount(co, 'asset').id, body: (_co, id) => ({ default_bank_account_id: id }) },
  { name: 'journal account filter', method: 'GET', path: () => '/finance/journal', query: (id) => `?account_id=${id}`, id: (co) => ownAccount(co).id },
  // Accounts & finance › invoices, credit notes, recurring (isolation/financeInvoicesEndpoints.ts): customer / source / invoice ids in bodies and filters.
  { name: 'invoice customer', method: 'POST', path: () => '/finance/invoices', id: (co) => one(customers, co).id, body: (_co, id) => ({ customer_id: id, lines: [{ description: 'Ref', quantity: 1, unit_price: 10 }] }) },
  { name: 'invoice project', method: 'POST', path: () => '/finance/invoices', id: (co) => one(projects, co).id, body: (co, id) => ({ customer_id: one(customers, co).id, project_id: id, lines: [{ description: 'Ref', quantity: 1, unit_price: 10 }] }) },
  { name: 'invoice event', method: 'POST', path: () => '/finance/invoices', id: (co) => one(events, co).id, body: (co, id) => ({ customer_id: one(customers, co).id, event_id: id, lines: [{ description: 'Ref', quantity: 1, unit_price: 10 }] }) },
  { name: 'invoice line service', method: 'POST', path: () => '/finance/invoices', id: (co) => one(services, co).id, body: (co, id) => ({ customer_id: one(customers, co).id, lines: [{ description: 'Ref', service_id: id, quantity: 1, unit_price: 10 }] }) },
  { name: 'invoice draft customer (PATCH)', method: 'PATCH', path: (co) => `/finance/invoices/${one(invoiceRecords, co, (i) => i.status === 'draft').id}`, id: (co) => one(customers, co).id, body: (_co, id) => ({ customer_id: id }) },
  { name: 'invoice from quotation', method: 'POST', path: () => '/finance/invoices/from-source', id: (co) => one(quotations, co, (q) => q.status === 'accepted').id, body: (_co, id) => ({ quotation_id: id, percent: 1 }) },
  { name: 'invoice from contract', method: 'POST', path: () => '/finance/invoices/from-source', id: (co) => one(contracts, co, (c) => c.billing === 'Monthly' && c.status !== 'cancelled').id, body: (_co, id) => ({ contract_id: id }) },
  { name: 'invoice from won deal', method: 'POST', path: () => '/finance/invoices/from-source', id: (co) => one(customers, co).leadId, body: (_co, id) => ({ lead_id: id }) },
  { name: 'invoices customer filter', method: 'GET', path: () => '/finance/invoices', query: (id) => `?customer_id=${id}`, id: (co) => one(customers, co).id },
  { name: 'credit note invoice', method: 'POST', path: () => '/finance/credit-notes', id: (co) => one(invoiceRecords, co, (i) => i.status === 'issued' && i.balanceDue > 10).id, body: (_co, id) => ({ invoice_id: id, reason: 'Ref credit', full: true }) },
  { name: 'credit notes invoice filter', method: 'GET', path: () => '/finance/credit-notes', query: (id) => `?invoice_id=${id}`, id: (co) => one(financeCreditNotes, co).invoiceId },
  { name: 'recurring source invoice', method: 'POST', path: () => '/finance/recurring-invoices', id: (co) => one(invoiceRecords, co, (i) => i.status === 'issued' && !i.recurringId).id, body: (_co, id) => ({ source_invoice_id: id, frequency: 'monthly', start_date: '2099-01-01' }) },
  { name: 'recurring contract', method: 'POST', path: () => '/finance/recurring-invoices', id: (co) => one(contracts, co, (c) => c.billing === 'Annual').id, body: (_co, id) => ({ contract_id: id, start_date: '2099-01-01' }) },
  // Accounts & finance › collections (isolation/financeCollectionsEndpoints.ts): customer / invoice ids in payments,
  // allocations, cheques, payment links, credit applications, dunning pauses, credit checks and list filters.
  { name: 'payment customer', method: 'POST', path: () => '/finance/payments', id: (co) => colFx.customerId(co), body: (co, id) => ({ customer_id: id, date: finToday(co), method: 'cash', amount: 1, allocation_mode: 'none' }) },
  { name: 'payment allocation invoice', method: 'POST', path: () => '/finance/payments', id: (co) => colFx.openInvoice(co).id, body: (co, id) => ({ customer_id: colFx.customerId(co), date: finToday(co), method: 'cash', amount: 1, currency: colFx.openInvoice(co).currency, exchange_rate: colFx.openInvoice(co).exchangeRate, allocation_mode: 'manual', allocations: [{ invoice_id: id, amount: 1 }] }) },
  { name: 'payments customer filter', method: 'GET', path: () => '/finance/payments', query: (id) => `?customer_id=${id}`, id: (co) => colFx.customerId(co) },
  { name: 'payments invoice filter', method: 'GET', path: () => '/finance/payments', query: (id) => `?invoice_id=${id}`, id: (co) => colFx.openInvoice(co).id },
  { name: 'apply credit invoice', method: 'POST', path: (co) => `/finance/payments/${colFx.creditPayment(co).id}/apply-credit`, id: (co) => colFx.openInvoice(co).id, body: (_co, id) => ({ allocations: [{ invoice_id: id, amount: 1 }] }) },
  { name: 'cheque customer', method: 'POST', path: () => '/finance/pdcs', id: (co) => colFx.customerId(co), body: (co, id) => ({ customer_id: id, cheque_no: 'REF1', bank_name: 'Ref Bank', received_date: finToday(co), due_date: finToday(co), amount: 1, currency: colFx.openInvoice(co).currency, exchange_rate: colFx.openInvoice(co).exchangeRate }) },
  { name: 'cheque allocation invoice', method: 'POST', path: () => '/finance/pdcs', id: (co) => colFx.openInvoice(co).id, body: (co, id) => ({ customer_id: colFx.customerId(co), cheque_no: 'REF2', bank_name: 'Ref Bank', received_date: finToday(co), due_date: finToday(co), amount: 1, currency: colFx.openInvoice(co).currency, exchange_rate: colFx.openInvoice(co).exchangeRate, allocations: [{ invoice_id: id, amount: 1 }] }) },
  { name: 'cheques customer filter', method: 'GET', path: () => '/finance/pdcs', query: (id) => `?customer_id=${id}`, id: (co) => colFx.customerId(co) },
  { name: 'payment link invoice', method: 'POST', path: () => '/finance/payment-links', id: (co) => colFx.openInvoice(co).id, body: (_co, id) => ({ invoice_id: id }) },
  { name: 'payment links invoice filter', method: 'GET', path: () => '/finance/payment-links', query: (id) => `?invoice_id=${id}`, id: (co) => colFx.openInvoice(co).id },
  { name: 'dunning pause invoice', method: 'POST', path: () => '/finance/dunning/pause', id: (co) => colFx.openInvoice(co).id, body: (_co, id) => ({ target_type: 'invoice', target_id: id, paused: true }) },
  { name: 'dunning pause customer', method: 'POST', path: () => '/finance/dunning/pause', id: (co) => colFx.customerId(co), body: (_co, id) => ({ target_type: 'customer', target_id: id, paused: true }) },
  { name: 'dunning log invoice filter', method: 'GET', path: () => '/finance/dunning/log', query: (id) => `?invoice_id=${id}`, id: (co) => colFx.openInvoice(co).id },
  { name: 'dunning log customer filter', method: 'GET', path: () => '/finance/dunning/log', query: (id) => `?customer_id=${id}`, id: (co) => colFx.customerId(co) },
  { name: 'credit check customer', method: 'GET', path: () => '/finance/credit-check', query: (id) => `?customer_id=${id}&amount=100`, id: (co) => colFx.customerId(co) },
  { name: 'credit check lead', method: 'GET', path: () => '/finance/credit-check', query: (id) => `?lead_id=${id}&amount=100`, id: (co) => one(customers, co).leadId },
]

describe('Ids of the other company in a body or query behave like ids that don’t exist', () => {
  for (const ref of REFS) {
    for (const co of COMPANIES) {
      const them = other(co)
      it(`${label(co)}: ${ref.method} ${ref.name} with a ${label(them)} id`, async () => {
        const foreignId = ref.id(them)
        const missingId = 'zz-missing-ref'
        const send = (id: string) =>
          api(adminToken(co), ref.method, ref.path(co) + (ref.query ? ref.query(id) : ''), { body: ref.body ? ref.body(co, id) : undefined })
        const start = takeSnapshot(true)
        const before = sliceText(them)
        const theirs = await send(foreignId)
        expect(sliceText(them), `${ref.name}: ${label(them)} data changed`).toBe(before)
        expect(leaksIn(theirs.body, co), ref.name).toEqual([])
        // Same starting state for the missing-id call (the first call may have written).
        expect(restoreSnapshot(start)).toBe(true)
        const missing = await send(missingId)
        expect(theirs.status, `${ref.name}: foreign ${theirs.text} vs missing ${missing.text}`).toBe(missing.status)
        const norm = (text: string, id: string) => text.split(id).join('<id>').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<t>').replace(/"(id|number)":"[^"]+"/g, '"$1":"<x>"')
        expect(norm(theirs.text, foreignId), ref.name).toBe(norm(missing.text, missingId))
      })
    }
  }
})

describe('Exports, reports and the dashboard hold only own rows; key numbers equal an own recomputation', () => {
  for (const co of COMPANIES) {
    it(`${label(co)}: GET /billing/export`, async () => {
      const res = await api(adminToken(co), 'GET', '/billing/export')
      expect(res.status).toBe(200)
      expect(leaksIn(res.body, co)).toEqual([])
      const expected = {
        leads: of(leads, co).length,
        customers: of(customers, co).length,
        tasks: of(tasks, co).length,
        projects: of(projects, co).length,
        quotations: of(quotations, co).length,
        users: of(users as { companyId: string }[], co).length,
      }
      expect(res.body.counts).toMatchObject(expected)
      const ids = (k: string) => (res.body.data[k] as { id: string }[]).map((r) => r.id).sort()
      expect(ids('leads')).toEqual(of(leads, co).map((l) => l.id).sort())
      expect(ids('quotations')).toEqual(of(quotations, co).map((q) => q.id).sort())
    })

    it(`${label(co)}: GET /dashboard/summary KPIs`, async () => {
      const res = await api(adminToken(co), 'GET', '/dashboard/summary?period=12m')
      expect(res.status).toBe(200)
      expect(leaksIn(res.body, co)).toEqual([])
      expect(res.body.total_leads).toBe(of(leads, co).length)
      const closed = ['Won', 'Lost', 'Not interested', 'Cold']
      expect(res.body.open_leads).toBe(of(leads, co, (l) => !closed.includes(l.status)).length)
    })

    it(`${label(co)}: GET /reports/sales and POST /reports/custom`, async () => {
      const from = day(-1000)
      const to = day(0)
      const res = await api(adminToken(co), 'GET', `/reports/sales?from=${from}&to=${to}`)
      expect(res.status, res.text).toBe(200)
      expect(leaksIn(res.body, co)).toEqual([])
      const inRange = of(leads, co, (l) => l.createdAt.slice(0, 10) >= from && l.createdAt.slice(0, 10) <= to)
      expect(res.body.kpis.leads_created).toBe(inRange.length)
      const acts = activities.filter((a) => of(leads, co).some((l) => l.id === a.leadId)).length
      expect(res.body.kpis.leads_created + acts).toBeGreaterThan(0)
      const custom = await api(adminToken(co), 'POST', '/reports/custom', { body: { from, to, dimension: 'owner', measure: 'count' } })
      expect(custom.status, custom.text).toBe(200)
      expect(leaksIn(custom.body, co)).toEqual([])
      expect(custom.body.total).toBe(inRange.length)
    })

    it(`${label(co)}: report schedules, contracts, alerts and the audit log list only own rows`, async () => {
      for (const path of ['/reports/schedules', '/contracts', '/alerts', '/audit-log', '/contacts', '/targets', '/departments/org-chart', '/settings/departments', '/leads/owners']) {
        const res = await api(adminToken(co), 'GET', path)
        expect(res.status, path).toBe(200)
        expect(leaksIn(res.body, co), path).toEqual([])
      }
      const c = await api(adminToken(co), 'GET', '/contracts')
      expect(c.body.length).toBe(of(contracts, co).length)
    })
  }
})

describe('Announcements are platform rows targeted per segment', () => {
  it('one aimed at Business-plan companies reaches Crest only; Apex can’t see or dismiss it (404 like a missing id)', async () => {
    const created = await api(platformToken(), 'POST', '/platform/announcements', {
      body: { title: 'Business plan news', body: 'Only for Business', tone: 'info', audience: { plans: ['business'], countries: [] }, endsAt: new Date(Date.now() + 86_400_000).toISOString() },
    })
    expect(created.status, created.text).toBe(200)
    const id = created.body.id as string
    const crest = await api(adminToken(CREST), 'GET', '/announcements')
    expect(crest.body.map((a: { id: string }) => a.id)).toContain(id)
    const apex = await api(adminToken(APEX), 'GET', '/announcements')
    expect(apex.body.map((a: { id: string }) => a.id)).not.toContain(id)
    const before = sliceText(CREST)
    const dismiss = await api(adminToken(APEX), 'POST', `/announcements/${id}/dismiss`)
    const missing = await api(adminToken(APEX), 'POST', '/announcements/ANN-999999/dismiss')
    expect(dismiss.status).toBe(404)
    expect(dismiss.body).toEqual(missing.body)
    expect(sliceText(CREST)).toBe(before)
  })
})
