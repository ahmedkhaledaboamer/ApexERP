import { afterAll, describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/lib/apiError'
import { activities, contacts, customers, leads, users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, platformUsers } from '@/shared/mocks/data/tenancy'
import { quotations } from '@/shared/mocks/data/quotations'
import { projectTemplateFor, services } from '@/shared/mocks/data/services'
import { departments } from '@/shared/mocks/data/departments'
import { notifications, projects, tasks } from '@/shared/mocks/data/tasks'
import { createLead, getLead, getLeads, setDoNotContact, updateLead } from '@/shared/mocks/services/leads'
import { getCustomer, getCustomers } from '@/shared/mocks/services/crm'
import { getQuotation, getQuotations } from '@/shared/mocks/services/quotations'
import { getDepartment, listDepartments } from '@/shared/mocks/services/departments'
import { getService, listServices } from '@/shared/mocks/services/services'
import { createUser, getSettingsUsers } from '@/shared/mocks/services/settingsUsers'
import { getAuditLog, getLookups, saveLookupList } from '@/shared/mocks/services/settings'
import { getDashboardSummary } from '@/shared/mocks/services/dashboard'
import { alertsFor } from '@/shared/mocks/services/alerts'
import { createTask, getTask, getTasks } from '@/shared/mocks/services/tasks'
import { getProject, listProjects } from '@/shared/mocks/services/projects'
import { winLead, WonError } from '@/shared/mocks/services/won'
import { listTenants, login, setTenantStatus, startImpersonation } from '@/shared/mocks/services/auth'
import { DEMO_PASSWORD } from '@/shared/lib/constants'
import type { TaskInput } from '@/modules/tasks/types'
import type { QuickAddInput } from '@/modules/leads/types'

/**
 * Tenant isolation across the mock API: Apex Aora (co_apex) and Crest Logistics (co_crest) share
 * one in-memory db, and every service must behave as if the other company did not exist.
 */

const u = (id: string) => {
  const found = users.find((x) => x.id === id)
  if (!found) throw new Error(`Seed user ${id} is missing`)
  return found
}
const apexAdmin = u('u1')
const apexManager = u('u3')
const apexAgent = u('u4')
const crestAdmin = u('u101')
const crestManager = u('u103')
const crestAgent = u('u104')

const owner = platformUsers.find((p) => p.platformRole === 'Platform Owner')!
const support = platformUsers.find((p) => p.platformRole === 'Platform Support')!
const billing = platformUsers.find((p) => p.platformRole === 'Platform Billing')!

const idsOf = (company: string, rows: readonly { id: string; companyId: string }[]) =>
  new Set(rows.filter((r) => r.companyId === company).map((r) => r.id))
const userIds = (company: string) => new Set(users.filter((x) => x.companyId === company).map((x) => x.id))

/** Awaits a rejection and returns it as an ApiError (fails the test otherwise). */
async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

const apexLead = () => leads.find((l) => l.companyId === APEX_ID)!
const crestLeadIds = () => idsOf(CREST_ID, leads)
const apexLeadIds = () => idsOf(APEX_ID, leads)

describe('Leads are company-scoped', () => {
  it('a Crest user lists only Crest leads, and an Apex user only Apex leads', async () => {
    const crest = await getLeads(crestAdmin)
    expect(crest.length).toBeGreaterThan(0)
    const apexIds = apexLeadIds()
    expect(crest.filter((l) => apexIds.has(l.id))).toEqual([])

    const apex = await getLeads(apexAdmin)
    expect(apex.length).toBeGreaterThan(0)
    const crestIds = crestLeadIds()
    expect(apex.filter((l) => crestIds.has(l.id))).toEqual([])
  })

  it('reading an Apex lead as a Crest user is a 404 with the same message as a missing id', async () => {
    const missing = await apiError(getLead(crestAdmin, 'L-999999'))
    const foreign = await apiError(getLead(crestAdmin, apexLead().id))
    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(foreign.message).toBe(missing.message)
  })

  it('changing a foreign lead is a 404 and leaves it untouched', async () => {
    const lead = apexLead()
    const before = { company: lead.company, doNotContact: lead.doNotContact }
    const upd = await apiError(updateLead(crestAdmin, lead.id, { company: 'Hijacked' }))
    expect(upd.status).toBe(404)
    const dnc = await apiError(setDoNotContact(crestAdmin, lead.id, !lead.doNotContact))
    expect(dnc.status).toBe(404)
    expect({ company: lead.company, doNotContact: lead.doNotContact }).toEqual(before)
  })

  it('duplicate detection is per company', async () => {
    const source = apexLead()
    const probe: QuickAddInput = {
      company: source.company,
      contactName: 'Saeed Al Otaibi',
      mobile: '+966 55 321 7788',
      email: source.contactEmail || 'saeed@example.sa',
      sourceType: 'Website',
      industry: 'Logistics',
    }
    // Same company name / email as an Apex lead: fine in Crest.
    const created = await createLead(crestManager, probe)
    expect(leads.find((l) => l.id === created.id)?.companyId).toBe(CREST_ID)
    // The same again inside Crest is a duplicate.
    const dup = await apiError(createLead(crestManager, { ...probe, contactName: 'Another Person' }))
    expect(dup.status).toBe(409)
  })

  it('a companyId in the body is ignored: the record lands in the caller’s company', async () => {
    const body = {
      company: 'Body Spoof Trading',
      contactName: 'Fahad Al Saud',
      mobile: '+966 50 765 4321',
      email: 'fahad@bodyspoof.sa',
      sourceType: 'Referral',
      industry: 'Logistics',
      companyId: APEX_ID,
    } as QuickAddInput
    const row = await createLead(crestManager, body)
    expect(leads.find((l) => l.id === row.id)?.companyId).toBe(CREST_ID)

    const task = await createTask(crestManager, { title: 'Spoofed company task', companyId: APEX_ID } as TaskInput)
    expect(tasks.find((t) => t.id === task.id)?.companyId).toBe(CREST_ID)
  })
})

describe('Phone numbers follow the company country', () => {
  it('Crest accepts a +966 mobile and rejects a +971 one', async () => {
    const base: QuickAddInput = {
      company: 'Mobile Format Test Co',
      contactName: 'Nasser Al Harbi',
      mobile: '+971 50 123 4567',
      email: 'nasser@mobiletest.sa',
      sourceType: 'Website',
      industry: 'Logistics',
    }
    const bad = await apiError(createLead(crestManager, base))
    expect(bad.status).toBe(422)
    const ok = await createLead(crestManager, { ...base, mobile: '+966 55 123 4567' })
    expect(ok.id).toBeTruthy()
  })
})

describe('Other modules are company-scoped', () => {
  it('customers', async () => {
    const apexIds = idsOf(APEX_ID, customers)
    const crest = await getCustomers(crestAdmin)
    expect(crest.length).toBeGreaterThan(0)
    expect(crest.filter((c) => apexIds.has(c.id))).toEqual([])
    const foreignId = [...apexIds][0]
    expect((await apiError(getCustomer(crestAdmin, foreignId))).status).toBe(404)
  })

  it('quotations', async () => {
    const apexIds = idsOf(APEX_ID, quotations)
    const crest = await getQuotations(crestAdmin)
    expect(crest.filter((q) => apexIds.has(q.id))).toEqual([])
    const crestIds = idsOf(CREST_ID, quotations)
    const apex = await getQuotations(apexAdmin)
    expect(apex.filter((q) => crestIds.has(q.id))).toEqual([])
    expect((await apiError(getQuotation(crestAdmin, [...apexIds][0]))).status).toBe(404)
  })

  it('tasks', async () => {
    const crestTasks = await getTasks(crestAdmin, { includeDone: true })
    expect(crestTasks.length).toBeGreaterThan(0)
    const apexIds = idsOf(APEX_ID, tasks)
    expect(crestTasks.filter((t) => apexIds.has(t.id))).toEqual([])
    const crestIds = idsOf(CREST_ID, tasks)
    const apexTasks = await getTasks(apexAdmin, { includeDone: true })
    expect(apexTasks.filter((t) => crestIds.has(t.id))).toEqual([])

    const missing = await apiError(getTask(crestAdmin, 'TK-999999'))
    const foreign = await apiError(getTask(crestAdmin, [...apexIds][0]))
    expect(foreign.status).toBe(404)
    expect(foreign.message).toBe(missing.message)
  })

  it('tasks: owners, followers and links from another company count as unknown', async () => {
    expect((await apiError(createTask(crestAdmin, { title: 'Assign to Apex', ownerId: apexAgent.id }))).status).toBe(422)
    expect((await apiError(createTask(crestAdmin, { title: 'Follow from Apex', followerIds: [apexManager.id] }))).status).toBe(422)
    const link = { type: 'lead' as const, id: apexLead().id }
    expect((await apiError(createTask(crestAdmin, { title: 'Link to Apex', link }))).status).toBe(422)
  })

  it('projects', async () => {
    const crestIds = idsOf(CREST_ID, projects)
    const apexIds = idsOf(APEX_ID, projects)
    const crest = await listProjects(crestAdmin)
    // Seeded Crest delivery project (for a won Crest customer), staffed by Crest people.
    expect(crest.length).toBeGreaterThan(0)
    const seeded = tasks.filter((t) => t.projectId === crest[crest.length - 1].id)
    for (const t of seeded) expect(userIds(CREST_ID).has(t.ownerId)).toBe(true)
    expect(crest.filter((p) => apexIds.has(p.id))).toEqual([])
    const apex = await listProjects(apexAdmin)
    expect(apex.length).toBeGreaterThan(0)
    expect(apex.filter((p) => crestIds.has(p.id))).toEqual([])
    expect((await apiError(getProject(crestAdmin, [...apexIds][0]))).status).toBe(404)
  })

  it('departments', async () => {
    const apexIds = idsOf(APEX_ID, departments)
    const crest = await listDepartments(crestAdmin, true)
    expect(crest.length).toBeGreaterThan(0)
    expect(crest.filter((d) => apexIds.has(d.id))).toEqual([])
    expect((await apiError(getDepartment(crestAdmin, 'd-sales'))).status).toBe(404)
  })

  it('services', async () => {
    const svc = services as readonly { id: string; companyId: string }[]
    const apexIds = idsOf(APEX_ID, svc)
    const crest = await listServices(crestAdmin)
    expect(crest.length).toBeGreaterThan(0)
    expect(crest.filter((s) => apexIds.has(s.id))).toEqual([])
    expect((await apiError(getService(crestAdmin, 'S-101'))).status).toBe(404)
  })

  it('settings users', async () => {
    const apex = userIds(APEX_ID)
    const crest = await getSettingsUsers(crestAdmin)
    expect(crest.length).toBeGreaterThan(0)
    expect(crest.filter((r) => apex.has(r.id))).toEqual([])
  })

  it('audit log', async () => {
    const apex = userIds(APEX_ID)
    const crest = userIds(CREST_ID)
    const crestLog = await getAuditLog(crestAdmin, {})
    expect(crestLog.filter((e) => apex.has(e.userId))).toEqual([])
    const apexLog = await getAuditLog(apexAdmin, {})
    expect(apexLog.length).toBeGreaterThan(0)
    expect(apexLog.filter((e) => crest.has(e.userId))).toEqual([])
  })

  it('dashboard counts', async () => {
    const crest = await getDashboardSummary(crestAdmin, '12m')
    expect(crest.totalLeads).toBe(leads.filter((l) => l.companyId === CREST_ID).length)
    const apex = await getDashboardSummary(apexAdmin, '12m')
    expect(apex.totalLeads).toBe(leads.filter((l) => l.companyId === APEX_ID).length)
    const crestTaskIds = idsOf(CREST_ID, tasks)
    expect(apex.tasks.next.filter((t) => crestTaskIds.has(t.id))).toEqual([])
  })

  it('alerts', () => {
    for (const [user, other] of [
      [crestManager, APEX_ID],
      [crestAgent, APEX_ID],
      [apexManager, CREST_ID],
      [apexAgent, CREST_ID],
    ] as const) {
      const foreignLeads = idsOf(other, leads)
      const foreignTasks = idsOf(other, tasks)
      const list = alertsFor(user)
      expect(list.filter((a) => (a.leadId && foreignLeads.has(a.leadId)) || (a.taskId && foreignTasks.has(a.taskId)))).toEqual([])
    }
    const foreignNotes = new Set(notifications.filter((n) => n.companyId !== CREST_ID).map((n) => n.id))
    expect(alertsFor(crestManager).filter((a) => a.stored && foreignNotes.has(a.id))).toEqual([])
  })
})

describe('Uniqueness is per company', () => {
  it('list values: a label that exists only in Apex can be added in Crest; an existing Crest label cannot', async () => {
    const before = (await getLookups(crestAdmin)).sources
    expect(before.some((s) => s.label === 'Directory')).toBe(false)
    const after = await saveLookupList(crestAdmin, 'sources', [...before, { label: 'Directory', active: true }])
    expect(after.sources.some((s) => s.label === 'Directory')).toBe(true)

    const dup = await apiError(saveLookupList(crestAdmin, 'sources', [...after.sources, { label: 'Website', active: true }]))
    expect(dup.status).toBe(422)
    // Apex's list is untouched.
    expect((await getLookups(apexAdmin)).sources.filter((s) => s.label === 'Directory')).toHaveLength(1)
  })

  it('user emails: one email = one company (an Apex email is refused in Crest without naming Apex)', async () => {
    const input = {
      name: 'Karim Duplicate',
      email: apexManager.email,
      mobile: '+966 55 777 1234',
      role: 'Sales Agent' as const,
      title: 'Account Manager',
      departmentId: 'c2-sales',
      managerId: null,
    }
    // Platform-wide identity rule (src/shared/mocks/data/identity.ts).
    const other = await apiError(createUser(crestAdmin, input))
    expect(other.status).toBe(409)
    expect(other.code).toBe('email_taken')
    expect(other.message).not.toContain('Apex Aora')
    const created = await createUser(crestAdmin, { ...input, email: 'karim.duplicate@crestlogistics.sa' })
    expect(users.find((x) => x.id === created.id)?.companyId).toBe(CREST_ID)

    const taken = await apiError(createUser(crestAdmin, { ...input, name: 'Reem Duplicate', email: crestAgent.email, mobile: '+966 55 777 4321' }))
    expect([409, 422]).toContain(taken.status)
  })

  it('user mobiles follow the company country (+971 rejected in Crest)', async () => {
    const bad = await apiError(
      createUser(crestAdmin, {
        name: 'Wrong Country',
        email: 'wrong.country@crestlogistics.sa',
        mobile: '+971 50 123 4567',
        role: 'Employee',
        title: 'Coordinator',
        departmentId: 'c2-ops',
        managerId: null,
      }),
    )
    expect(bad.status).toBe(422)
  })
})

describe('Won flow inside a tenant', () => {
  /** An open Crest lead with a contact. */
  function openCrestLead() {
    const lead = leads.find(
      (l) =>
        l.companyId === CREST_ID &&
        !['Won', 'Lost', 'Not interested', 'Cold'].includes(l.status) &&
        !l.customerId &&
        contacts.some((c) => c.leadId === l.id),
    )
    if (!lead) throw new Error('No open Crest lead with a contact in the seed')
    return lead
  }
  const crestService = () => {
    const list = (services as readonly (typeof services)[number][]).filter((s) => (s as { companyId?: string }).companyId === CREST_ID && s.active)
    return list.find((s) => projectTemplateFor(s.id).tasks.length > 0) ?? list[0]
  }

  it('a foreign lead is a 404', async () => {
    const e = await apiError(winLead(crestAdmin, apexLead().id, { serviceIds: ['S-101'], projectManagerId: 'u106', startDate: '2026-12-07', idempotencyKey: 'x-foreign' }))
    expect(e.status).toBe(404)
  })

  it('an Apex project manager or service is rejected for a Crest lead', async () => {
    const lead = openCrestLead()
    const pm = await apiError(winLead(crestAdmin, lead.id, { serviceIds: [crestService().id], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: 'x-pm' }))
    expect(pm).toBeInstanceOf(WonError)
    // Another company's person answers exactly like a missing one (docs/API.md, the Won flow).
    expect(pm.status).toBe(404)
    const svc = await apiError(winLead(crestAdmin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u106', startDate: '2026-12-07', idempotencyKey: 'x-svc' }))
    expect(svc.status).toBe(422)
    expect(lead.status).not.toBe('Won')
  })

  it('creates Crest-stamped records and assigns Crest people only, on Crest working days', async () => {
    const lead = openCrestLead()
    const service = crestService()
    const crest = userIds(CREST_ID)
    const activitiesBefore = activities.length
    const notesBefore = new Set(notifications.map((n) => n.id))
    // 2026-12-04 is a Friday: a working day in the UAE, the weekend in Saudi Arabia.
    const res = await winLead(crestAdmin, lead.id, { serviceIds: [service.id], projectManagerId: 'u106', startDate: '2026-12-04', idempotencyKey: 'shared-key' })

    expect(customers.find((c) => c.id === res.customerId)?.companyId).toBe(CREST_ID)
    expect(res.projectIds.length).toBe(1)
    const project = projects.find((p) => p.id === res.projectIds[0])!
    expect(project.companyId).toBe(CREST_ID)
    expect(project.startDate).toBe('2026-12-06')
    const created = tasks.filter((t) => res.taskIds.includes(t.id))
    expect(created.length).toBe(projectTemplateFor(service.id).tasks.length)
    for (const t of created) {
      expect(t.companyId).toBe(CREST_ID)
      expect(crest.has(t.ownerId)).toBe(true)
      for (const f of t.followerIds) expect(crest.has(f)).toBe(true)
      const day = new Date(`${t.dueDate}T12:00:00`).getDay()
      expect([5, 6]).not.toContain(day)
    }
    const pushed = notifications.filter((n) => !notesBefore.has(n.id))
    expect(pushed.length).toBeGreaterThan(0)
    for (const n of pushed) {
      expect(n.companyId).toBe(CREST_ID)
      expect(crest.has(n.userId)).toBe(true)
    }
    const added = activities.slice(activitiesBefore)
    expect(added.length).toBeGreaterThan(0)
    for (const a of added) expect(a.companyId).toBe(CREST_ID)
    // The Crest admin now sees the project; Apex does not.
    expect((await listProjects(crestAdmin)).some((p) => p.id === project.id)).toBe(true)
    expect((await apiError(getProject(apexAdmin, project.id))).status).toBe(404)
  })

  it('idempotency keys are per company: Apex may reuse a key Crest already used', async () => {
    const lead = leads.find(
      (l) => l.companyId === APEX_ID && !['Won', 'Lost', 'Not interested', 'Cold'].includes(l.status) && contacts.some((c) => c.leadId === l.id),
    )!
    const res = await winLead(apexAdmin, lead.id, { serviceIds: ['S-102'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: 'shared-key' })
    expect(customers.find((c) => c.id === res.customerId)?.companyId).toBe(APEX_ID)
    // Inside one company the key is still single-use.
    const again = await apiError(winLead(apexAdmin, lead.id, { serviceIds: ['S-102'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: 'shared-key' }))
    expect(again.status).toBe(409)
  })
})

describe('Platform helpers', () => {
  afterAll(async () => {
    await setTenantStatus(owner, CREST_ID, 'active')
  })

  it('listTenants works for every platform role with tenants:view and reports per-tenant counts', async () => {
    for (const pu of [owner, support, billing]) {
      const list = await listTenants(pu)
      const crest = list.find((t) => t.id === CREST_ID)!
      expect(crest.users).toBe(users.filter((x) => x.companyId === CREST_ID).length)
      expect(crest.leads).toBe(leads.filter((l) => l.companyId === CREST_ID).length)
    }
  })

  it('only the Platform Owner changes a tenant status', async () => {
    expect((await apiError(setTenantStatus(support, CREST_ID, 'suspended'))).status).toBe(403)
    expect((await apiError(setTenantStatus(billing, CREST_ID, 'suspended'))).status).toBe(403)
    const c = await setTenantStatus(owner, CREST_ID, 'trial')
    expect(c.status).toBe('trial')
    await setTenantStatus(owner, CREST_ID, 'active')
  })

  it('only Owner and Support impersonate; the session carries the impersonation and the target tenant', async () => {
    expect((await apiError(startImpersonation({ user: billing, ip: '10.0.0.1' }, crestAgent.id, 'Customer asked for help with leads'))).status).toBe(403)
    for (const pu of [owner, support]) {
      const session = await startImpersonation({ user: pu, ip: '10.0.0.1' }, crestAgent.id, 'Customer asked for help with leads')
      expect(session.user.id).toBe(crestAgent.id)
      expect(session.tenant.id).toBe(CREST_ID)
      expect(session.impersonation?.platformUserId).toBe(pu.id)
    }
  })

  it('users of a suspended workspace cannot sign in (workspace_suspended)', async () => {
    await setTenantStatus(owner, CREST_ID, 'suspended')
    try {
      const e = await apiError(login(crestAgent.email, DEMO_PASSWORD, 'crest'))
      expect(e.code).toBe('workspace_suspended')
    } finally {
      await setTenantStatus(owner, CREST_ID, 'active')
    }
    // Back to active: the same sign-in works again.
    const ok = await login(crestAgent.email, DEMO_PASSWORD, 'crest')
    expect('token' in ok || 'twoFactorRequired' in ok).toBe(true)
  })
})
