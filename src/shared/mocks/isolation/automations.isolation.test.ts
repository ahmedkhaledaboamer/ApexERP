import { addDays, format } from 'date-fns'
import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { advanceClock } from '@/shared/mocks/clock'
import { contracts } from '@/shared/mocks/data/contracts'
import { notifications, tasks } from '@/shared/mocks/data/tasks'
import { billingInvoices, subscriptions } from '@/shared/mocks/data/subscriptions'
import { runLifecycle, runLifecycleForAll } from '@/shared/mocks/services/billing'
import { APEX, COMPANIES, CREST, DEMO_PASSWORD, api, adminToken, label, leaksIn, other, sliceText, userToken, useSeedPerTest, type Co } from './harness'

/**
 * §2 Automations and notifications: a tick or an action of one company (alerts, reminders, renewal
 * alerts, task due / overdue, usage warnings, the billing lifecycle, trial reminders) never reads or
 * writes another company. Pattern: snapshot the other company's rows (notifications, audit,
 * subscription, usage counters, invoices… = its whole owned slice), run the tick, compare.
 */

useSeedPerTest()

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')
const companyOfUser = (id: string) => users.find((u) => u.id === id)?.companyId

/** Every notification created after `before` belongs to `co` and goes to a user of `co`. */
function expectNewNotificationsOnlyFor(co: Co, beforeIds: Set<string>, what: string) {
  const fresh = notifications.filter((n) => !beforeIds.has(n.id))
  for (const n of fresh) {
    expect(n.companyId, `${what}: notification ${n.id} "${n.title}"`).toBe(co)
    expect(companyOfUser(n.userId), `${what}: notification ${n.id} to ${n.userId}`).toBe(co)
  }
  return fresh
}
const ids = () => new Set(notifications.map((n) => n.id))
const stable = (body: unknown) => JSON.stringify(body).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<t>')

describe('§2 Billing lifecycle', () => {
  for (const co of COMPANIES) {
    const them = other(co)

    it(`runLifecycle(${label(co)}) after 45 days renews ${label(co)} only; ${label(them)} is deep-equal`, async () => {
      const before = sliceText(them)
      const notes = ids()
      const invoices = billingInvoices.length
      advanceClock(45)
      runLifecycle(co)
      expect(sliceText(them), `the ${label(co)} lifecycle touched ${label(them)}`).toBe(before)
      expect(billingInvoices.slice(invoices).every((i) => i.companyId === co)).toBe(true)
      expectNewNotificationsOnlyFor(co, notes, 'lifecycle')
    })

    it(`a request by ${label(co)} after the clock moved runs only ${label(co)}’s lifecycle`, async () => {
      advanceClock(45)
      const before = sliceText(them)
      const res = await api(adminToken(co), 'GET', '/billing/overview')
      expect(res.status).toBe(200)
      expect(leaksIn(res.body, co)).toEqual([])
      expect(sliceText(them)).toBe(before)
    })
  }

  it('runLifecycleForAll: each company’s invoices and reminders go to its own admins only', () => {
    const notes = ids()
    const invoices = billingInvoices.length
    advanceClock(70)
    runLifecycleForAll()
    for (const inv of billingInvoices.slice(invoices)) expect(subscriptions.some((s) => s.companyId === inv.companyId)).toBe(true)
    for (const n of notifications.filter((x) => !notes.has(x.id))) {
      expect(companyOfUser(n.userId), `notification ${n.id} "${n.title}" crossed companies`).toBe(n.companyId)
    }
  })

  it('a failed payment of Crest (dev fail-next-payment + renewal) makes Crest past due and leaves Apex untouched', async () => {
    expect((await api(adminToken(CREST), 'POST', '/dev/billing/fail-next-payment', { body: { fail: true } })).status).toBe(200)
    const apex = sliceText(APEX)
    const notes = ids()
    advanceClock(45)
    runLifecycleForAll()
    expect(subscriptions.find((s) => s.companyId === CREST)!.status).not.toBe('active')
    expect(subscriptions.find((s) => s.companyId === APEX)!.status).toBe('active')
    const apexAfter = sliceText(APEX)
    // Apex renewed on its own schedule; nothing of Crest's failure reached it.
    expect(apexAfter.includes('past_due')).toBe(apex.includes('past_due'))
    for (const n of notifications.filter((x) => !notes.has(x.id) && x.companyId === CREST)) expect(companyOfUser(n.userId)).toBe(CREST)
  })
})

describe('§2 Trial reminders of a new company', () => {
  it('a trial company’s reminders and expiry never touch Apex or Crest', async () => {
    const start = await api(null, 'POST', '/public/signup', {
      body: { companyName: 'Isolation Trial Co', subdomain: 'iso-trial', country: 'AE', language: 'en', adminName: 'Trial Admin', adminEmail: 'admin@iso-trial.example', mobile: '0501234567', password: 'Sunny-Harbor-42', acceptTerms: true },
      headers: { 'X-Client-Id': 'iso-trial' },
    })
    expect(start.status, start.text).toBe(200)
    expect((await api(null, 'POST', `/public/signup/${start.body.signupId}/verify`, { body: { code: start.body.devCode } })).status).toBe(200)
    const done = await api(null, 'POST', `/public/signup/${start.body.signupId}/complete`, { body: { plan: 'trial' } })
    expect(done.status, done.text).toBe(200)
    const trialCo = done.body.tenant?.id ?? done.body.session?.tenant?.id
    expect(trialCo).toBeTruthy()
    expect(done.text).not.toContain(DEMO_PASSWORD)

    const apex = sliceText(APEX)
    const crest = sliceText(CREST)
    const notes = ids()
    for (const days of [5, 5, 5, 5, 5]) {
      advanceClock(days)
      runLifecycle(trialCo)
    }
    expect(sliceText(APEX), 'trial lifecycle touched Apex').toBe(apex)
    expect(sliceText(CREST), 'trial lifecycle touched Crest').toBe(crest)
    const fresh = notifications.filter((n) => !notes.has(n.id))
    expect(fresh.length).toBeGreaterThan(0)
    for (const n of fresh) {
      expect(n.companyId).toBe(trialCo)
      expect(companyOfUser(n.userId)).toBe(trialCo)
    }
  })
})

describe('§2 Usage warnings', () => {
  it('Crest crossing its usage thresholds warns Crest admins only; Apex is deep-equal', async () => {
    const apex = sliceText(APEX)
    const notes = ids()
    const res = await api(adminToken(CREST), 'POST', '/dev/billing/usage', { body: { key: 'leadsContacts', percent: 95 } })
    expect(res.status, res.text).toBe(200)
    const fresh = expectNewNotificationsOnlyFor(CREST, notes, 'usage warning')
    expect(fresh.some((n) => n.type === 'usage')).toBe(true)
    // Creating a lead then re-checks the warnings (once per threshold and period).
    const lead = await api(adminToken(CREST), 'POST', '/leads', { body: { company: 'Usage Probe Co', contactName: 'Probe', mobile: '+966 55 555 0123', email: 'probe@usage-probe.sa', sourceType: 'Website', industry: 'Logistics' } })
    expect([200, 402]).toContain(lead.status)
    expect(sliceText(APEX), 'Crest usage warnings touched Apex').toBe(apex)
  })
})

describe('§2 Tasks, reminders and alerts', () => {
  for (const co of COMPANIES) {
    const them = other(co)

    it(`${label(co)}: an overdue task assigned inside ${label(co)} alerts ${label(co)} only; ${label(them)}’s alerts are unchanged`, async () => {
      const theirUsers = users.filter((u) => u.companyId === them && u.active !== false)
      const theirAlerts = await Promise.all(theirUsers.map(async (u) => stable((await api(userToken(u.id), 'GET', '/alerts')).body)))
      const notes = ids()
      const agent = users.find((u) => u.companyId === co && u.role === 'Sales Agent' && u.active !== false)!
      const created = await api(adminToken(co), 'POST', '/tasks', { body: { title: 'Isolation overdue task', ownerId: agent.id, dueDate: day(-2), priority: 'High' } })
      expect(created.status, created.text).toBe(200)
      expectNewNotificationsOnlyFor(co, notes, 'task assignment')
      const agentAlerts = await api(userToken(agent.id), 'GET', '/alerts')
      expect(agentAlerts.text).toContain('Isolation overdue task')
      expect(leaksIn(agentAlerts.body, co)).toEqual([])
      const after = await Promise.all(theirUsers.map(async (u) => stable((await api(userToken(u.id), 'GET', '/alerts')).body)))
      expect(after, `${label(them)} alerts changed`).toEqual(theirAlerts)
    })

    it(`${label(co)}: a contract renewal coming due alerts ${label(co)} only`, async () => {
      const theirAlerts = stable((await api(adminToken(them), 'GET', '/alerts')).body)
      const c = contracts.find((x) => x.companyId === co && x.status !== 'Cancelled')!
      const before = stable((await api(adminToken(co), 'GET', '/alerts')).body)
      c.renewalDate = day(3)
      const mine = await api(adminToken(co), 'GET', '/alerts')
      expect(leaksIn(mine.body, co)).toEqual([])
      expect(stable(mine.body), 'the renewal should show up for the owning company').not.toBe(before)
      expect(stable((await api(adminToken(them), 'GET', '/alerts')).body)).toBe(theirAlerts)
    })

    it(`${label(co)}: mentioning a ${label(them)} user in a task comment notifies nobody in ${label(them)}`, async () => {
      const t = tasks.find((x) => x.companyId === co)!
      const victim = users.find((u) => u.companyId === them && u.active !== false)!
      const notes = ids()
      const before = sliceText(them)
      const res = await api(adminToken(co), 'POST', `/tasks/${t.id}/comments`, { body: { body: `@${victim.name} please check`, mentions: [victim.id] } })
      expect([200, 422]).toContain(res.status)
      expect(sliceText(them)).toBe(before)
      expectNewNotificationsOnlyFor(co, notes, 'mention')
    })

    it(`${label(co)}: read-all marks only the caller’s own notifications`, async () => {
      const theirAdmin = users.find((u) => u.companyId === them && u.role === 'Company Admin')!
      const mineNote = notifications.length
      void mineNote
      const before = sliceText(them)
      // Give both admins an unread notification.
      for (const u of [users.find((x) => x.companyId === co && x.role === 'Company Admin')!, theirAdmin]) {
        notifications.unshift({ id: `NT-ISO-${u.id}`, companyId: u.companyId, userId: u.id, type: 'assignment', title: 'Iso', body: '', link: '/tasks', at: new Date().toISOString(), read: false })
      }
      const theirsBefore = sliceText(them)
      expect(theirsBefore).not.toBe(before)
      const res = await api(adminToken(co), 'POST', '/alerts/read-all')
      expect(res.status).toBe(200)
      expect(sliceText(them)).toBe(theirsBefore)
      expect(notifications.find((n) => n.id === `NT-ISO-${theirAdmin.id}`)!.read).toBe(false)
      const foreign = await api(adminToken(co), 'PATCH', `/alerts/NT-ISO-${theirAdmin.id}/read`)
      expect(foreign.status).toBe(404)
    })
  }

  it('winning a Crest lead creates customers, projects, tasks and notifications in Crest only', async () => {
    const lead = (await api(adminToken(CREST), 'GET', '/leads')).body.find((l: { status: string; doNotContact: boolean }) => !['Won', 'Lost', 'Not interested'].includes(l.status) && !l.doNotContact)
    const svc = (await api(adminToken(CREST), 'GET', '/services')).body.find((s: { active: boolean }) => s.active)
    const apex = sliceText(APEX)
    const notes = ids()
    const res = await api(adminToken(CREST), 'POST', `/leads/${lead.id}/won`, { body: { serviceIds: [svc.id], projectManagerId: 'u101', startDate: day(21), idempotencyKey: 'iso-won' } })
    expect(res.status, res.text).toBe(200)
    expect(leaksIn(res.body, CREST)).toEqual([])
    expect(sliceText(APEX)).toBe(apex)
    expectNewNotificationsOnlyFor(CREST, notes, 'won')
    // The same idempotency key in Apex is independent (keys are per company).
    const apexLead = (await api(adminToken(APEX), 'GET', '/leads')).body.find((l: { status: string; doNotContact: boolean }) => !['Won', 'Lost', 'Not interested'].includes(l.status) && !l.doNotContact)
    const apexSvc = (await api(adminToken(APEX), 'GET', '/services')).body.find((s: { active: boolean }) => s.active)
    const apexWin = await api(adminToken(APEX), 'POST', `/leads/${apexLead.id}/won`, { body: { serviceIds: [apexSvc.id], projectManagerId: 'u1', startDate: day(21), idempotencyKey: 'iso-won' } })
    expect(apexWin.status, apexWin.text).toBe(200)
  })
})
