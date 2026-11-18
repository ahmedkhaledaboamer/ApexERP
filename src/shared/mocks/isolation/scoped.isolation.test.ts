import { addDays, format } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { activities, customers, leads, users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { quotations } from '@/shared/mocks/data/quotations'
import { services, packages } from '@/shared/mocks/data/services'
import { templates } from '@/shared/mocks/data/templates'
import { contracts } from '@/shared/mocks/data/contracts'
import { tasks, projects } from '@/shared/mocks/data/tasks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
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
      const t = await api(adminToken(co), 'POST', '/templates', { body: { channel: 'email', name: tpl, purpose: 'First follow-up', subject: 'Hi', body: 'Hello there' } })
      expect(t.status, t.text).toBe(200)
      const svcName = exclusive(services, co, (s) => s.name)
      const base = one(services, co, (s) => s.active)
      const s = await api(adminToken(co), 'POST', '/services', { body: { name: svcName, category: base.category, description: '', industries: [], pricingType: base.pricingType, price: 10, currency: base.currency, deliveryDays: 1 } })
      expect(s.status, s.text).toBe(200)
      const pkgName = exclusive(packages, co, (p) => p.name)
      const two = of(services, co, (x) => x.active).slice(0, 2)
      const p = await api(adminToken(co), 'POST', '/services/packages', { body: { name: pkgName, description: '', items: two.map((x) => ({ serviceId: x.id, quantity: 1 })), packagePrice: 10, currency: base.currency } })
      expect(p.status, p.text).toBe(200)
      const deptName = exclusive(departments, co, (d) => d.name)
      const d = await api(adminToken(co), 'POST', '/departments', { body: { name: deptName, parentId: null, headId: null } })
      expect(d.status, d.text).toBe(200)
    })

    it(`${label(co)}: list values (lookups) of ${label(them)} don't clash`, async () => {
      const mine = (await api(adminToken(co), 'GET', '/lookups')).body.industries as { key: string; label: string }[]
      const theirs = (await api(adminToken(them), 'GET', '/lookups')).body.industries as { key: string; label: string; active: boolean; order: number }[]
      const extra = theirs.find((x) => !mine.some((m) => m.label.toLowerCase() === x.label.toLowerCase()))
      if (!extra) throw new Error('no exclusive industry')
      const res = await api(adminToken(co), 'PUT', '/lookups/industries', { body: { items: [...mine, { ...extra, order: mine.length }] } })
      expect(res.status, res.text).toBe(200)
    })

    it(`${label(co)}: email uniqueness is platform-wide by design — 409 email_taken that never names ${label(them)}`, async () => {
      const theirEmail = users.find((u) => u.companyId === them)!.email
      const sales = one(departments, co, (x) => /sales/i.test(x.name))
      const res = await api(adminToken(co), 'POST', '/settings/users', { body: { name: 'Probe', email: theirEmail, mobile: dial(co), role: 'Sales Agent', title: 'Rep', departmentId: sales.id, managerId: null } })
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

const REFS: Ref[] = [
  { name: 'task owner', method: 'POST', path: () => '/tasks', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ title: 'Ref', ownerId: id }) },
  { name: 'task follower', method: 'POST', path: () => '/tasks', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ title: 'Ref', followerIds: [id] }) },
  { name: 'task link lead', method: 'POST', path: () => '/tasks', id: (co) => openLead(co).id, body: (_co, id) => ({ title: 'Ref', link: { type: 'lead', id } }) },
  { name: 'task project', method: 'POST', path: () => '/tasks', id: (co) => one(projects, co).id, body: (_co, id) => ({ title: 'Ref', projectId: id }) },
  { name: 'contract customer', method: 'POST', path: () => '/contracts', id: (co) => one(customers, co).id, body: (co, id) => ({ customerId: id, title: 'Ref', serviceIds: [one(services, co, (s) => s.active).id], value: 1, billing: 'Monthly', startDate: day(1), renewalDate: day(300) }) },
  { name: 'contract service', method: 'POST', path: () => '/contracts', id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ customerId: one(customers, co).id, title: 'Ref', serviceIds: [id], value: 1, billing: 'Monthly', startDate: day(1), renewalDate: day(300) }) },
  { name: 'quotation lead', method: 'POST', path: () => '/quotations', id: (co) => openLead(co).id, body: (co, id) => ({ leadId: id, title: 'Ref', validUntil: day(30), items: [{ description: 'x', quantity: 1, unit: 'project', unitPrice: 1, discountPct: 0, serviceId: one(services, co, (s) => s.active).id }], notes: '', terms: '' }) },
  { name: 'quotation service', method: 'POST', path: () => '/quotations', id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ leadId: openLead(co).id, title: 'Ref', validUntil: day(30), items: [{ description: 'x', quantity: 1, unit: 'project', unitPrice: 1, discountPct: 0, serviceId: id }], notes: '', terms: '' }) },
  { name: 'project customer', method: 'POST', path: () => '/projects', id: (co) => one(customers, co).id, body: (co, id) => ({ name: 'Ref', customerId: id, serviceId: one(services, co, (s) => s.active).id, managerId: ADMIN[co], startDate: day(10), endDate: day(40), status: 'Planned', estimatedHours: 0, generateTasks: false }) },
  { name: 'project manager', method: 'POST', path: () => '/projects', id: (co) => ADMIN[co], body: (co, id) => ({ name: 'Ref', customerId: one(customers, co).id, serviceId: one(services, co, (s) => s.active).id, managerId: id, startDate: day(10), endDate: day(40), status: 'Planned', estimatedHours: 0, generateTasks: false }) },
  { name: 'contact record', method: 'POST', path: () => '/contacts', id: (co) => openLead(co).id, body: (co, id) => ({ recordType: 'lead', recordId: id, name: 'Ref', title: '', mobile: dial(co), email: 'ref@example.org', isDecisionMaker: false }) },
  { name: 'lead owner', method: 'PATCH', path: (co) => `/leads/${openLead(co).id}`, id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (_co, id) => ({ ownerId: id }) },
  { name: 'lead services', method: 'PATCH', path: (co) => `/leads/${openLead(co).id}`, id: (co) => one(services, co, (s) => s.active).id, body: (_co, id) => ({ serviceIds: [id] }) },
  { name: 'move members user', method: 'POST', path: () => '/departments/move-members', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, body: (co, id) => ({ userIds: [id], toDepartmentId: one(departments, co, (d) => d.active).id }) },
  { name: 'move members target', method: 'POST', path: () => '/departments/move-members', id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => ({ userIds: [one(users, co, (u) => u.role === 'Sales Agent').id], toDepartmentId: id }) },
  { name: 'department head', method: 'POST', path: () => '/departments', id: (co) => one(users, co, (u) => u.role === 'Sales Manager').id, body: (_co, id) => ({ name: 'Ref Dept', parentId: null, headId: id }) },
  { name: 'department parent', method: 'POST', path: () => '/departments', id: (co) => one(departments, co, (d) => d.active).id, body: (_co, id) => ({ name: 'Ref Dept', parentId: id, headId: null }) },
  { name: 'user department', method: 'POST', path: () => '/settings/users', id: (co) => one(departments, co, (d) => d.active).id, body: (co, id) => ({ name: 'Ref', email: `ref-${co}@example.org`, mobile: dial(co), role: 'Sales Agent', title: 'Rep', departmentId: id, managerId: null }) },
  { name: 'user manager', method: 'POST', path: () => '/settings/users', id: (co) => one(users, co, (u) => u.role === 'Sales Manager').id, body: (co, id) => ({ name: 'Ref', email: `ref-${co}@example.org`, mobile: dial(co), role: 'Sales Agent', title: 'Rep', departmentId: one(departments, co, (d) => /sales/i.test(d.name)).id, managerId: id }) },
  { name: 'won project manager', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => ADMIN[co], body: (co, id) => ({ serviceIds: [one(services, co, (s) => s.active).id], projectManagerId: id, startDate: day(20), idempotencyKey: `ref-${co}` }) },
  { name: 'won service', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => one(services, co, (s) => s.active).id, body: (co, id) => ({ serviceIds: [id], projectManagerId: ADMIN[co], startDate: day(20), idempotencyKey: `ref-${co}` }) },
  { name: 'won quotation', method: 'POST', path: (co) => `/leads/${openLead(co).id}/won`, id: (co) => one(quotations, co).id, body: (co, id) => ({ quotationId: id, serviceIds: [one(services, co, (s) => s.active).id], projectManagerId: ADMIN[co], startDate: day(20), idempotencyKey: `ref-${co}` }) },
  { name: 'message template', method: 'POST', path: (co) => `/leads/${openLead(co).id}/messages`, id: (co) => one(templates, co, (t) => t.active).id, body: (co, id) => ({ channel: 'email', to: openLead(co).contactEmail, subject: 'x', body: 'x', templateId: id }) },
  { name: 'package service', method: 'POST', path: () => '/services/packages', id: (co) => of(services, co, (s) => s.active)[1].id, body: (co, id) => ({ name: 'Ref package', description: '', items: [{ serviceId: one(services, co, (s) => s.active).id, quantity: 1 }, { serviceId: id, quantity: 1 }], packagePrice: 1 }) },
  { name: 'report owner filter', method: 'GET', path: () => '/reports/sales', id: (co) => one(users, co, (u) => u.role === 'Sales Agent').id, query: (id) => `?from=${day(-300)}&to=${day(0)}&ownerId=${id}` },
  { name: 'report department filter', method: 'GET', path: () => '/reports/sales', id: (co) => one(departments, co, (d) => d.active).id, query: (id) => `?from=${day(-300)}&to=${day(0)}&departmentId=${id}` },
  { name: 'quotations lead filter', method: 'GET', path: () => '/quotations', id: (co) => one(quotations, co).leadId, query: (id) => `?leadId=${id}` },
  { name: 'tasks owner filter', method: 'GET', path: () => '/tasks', id: (co) => one(tasks, co).ownerId, query: (id) => `?ownerId=${id}&includeDone=true` },
  { name: 'audit user filter', method: 'GET', path: () => '/audit-log', id: (co) => ADMIN[co], query: (id) => `?userId=${id}` },
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
      expect(res.body.totalLeads).toBe(of(leads, co).length)
      const closed = ['Won', 'Lost', 'Not interested', 'Cold']
      expect(res.body.openLeads).toBe(of(leads, co, (l) => !closed.includes(l.status)).length)
    })

    it(`${label(co)}: GET /reports/sales and POST /reports/custom`, async () => {
      const from = day(-1000)
      const to = day(0)
      const res = await api(adminToken(co), 'GET', `/reports/sales?from=${from}&to=${to}`)
      expect(res.status, res.text).toBe(200)
      expect(leaksIn(res.body, co)).toEqual([])
      const inRange = of(leads, co, (l) => l.createdAt.slice(0, 10) >= from && l.createdAt.slice(0, 10) <= to)
      expect(res.body.kpis.leadsCreated).toBe(inRange.length)
      const acts = activities.filter((a) => of(leads, co).some((l) => l.id === a.leadId)).length
      expect(res.body.kpis.leadsCreated + acts).toBeGreaterThan(0)
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
