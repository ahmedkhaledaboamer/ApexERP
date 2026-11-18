import { describe, expect, it } from 'vitest'
import { departments } from '@/shared/mocks/data/departments'
import { APEX, COMPANIES, CREST, DEMO_PASSWORD, api, adminToken, label, other, platformToken, sliceText, subdomainOf, useSeedPerTest, type Co } from './harness'

/**
 * §6 Enforcement per company: plan limits (402 LIMIT_REACHED), module gating (403 module_not_in_plan),
 * billing read-only (423), the operator's full lock (403 workspace_suspended, sign-in refused) and a
 * deleted workspace (410) apply to the one company only — the other keeps working and its data is
 * deep-equal afterwards.
 */

useSeedPerTest()

const ADMIN_EMAIL: Record<Co, string> = { co_apex: 'omar@apexaora.ae', co_crest: 'faisal@crestlogistics.sa' }
const dial = (co: Co) => (co === APEX ? '+971 50 555 0177' : '+966 55 555 0177')
const salesDept = (co: Co) => departments.find((d) => d.companyId === co && /sales/i.test(d.name))!.id
let n = 0
const newUser = (co: Co) => ({ name: 'Limit Probe', email: `limit${++n}-${co}@example.org`, mobile: dial(co), role: 'Sales Agent', title: 'Rep', department_id: salesDept(co), manager_id: null })
/** POST /leads body in the API's snake_case (leads columns). */
const newLead = (co: Co) => ({ company_name: `Limit Probe ${++n} Co`, contact_name: 'Probe Person', phone: dial(co), email: `lead${n}@limit-probe.example`, source_id: 'Website', industry_id: 'Logistics' })
const newTask = () => ({ title: `Write probe ${++n}` })

/** The other company still reads and writes normally. */
async function expectUnaffected(co: Co) {
  expect((await api(adminToken(co), 'GET', '/leads')).status, `${label(co)} read`).toBe(200)
  const w = await api(adminToken(co), 'POST', '/tasks', { body: newTask() })
  expect(w.status, `${label(co)} write: ${w.text}`).toBe(200)
}

async function login(co: Co) {
  return api(null, 'POST', '/auth/login', { body: { email: ADMIN_EMAIL[co], password: DEMO_PASSWORD }, headers: { 'X-Workspace': subdomainOf(co) } })
}

describe('§6 Plan limits: LIMIT_REACHED for one company only', () => {
  it('Crest (Business) at its user limit gets 402 with limit/current/max; Apex (Enterprise, unlimited) adds users', async () => {
    const apex = sliceText(APEX)
    expect((await api(adminToken(CREST), 'POST', '/dev/billing/usage', { body: { key: 'users', percent: 100 } })).status).toBe(200)
    const blocked = await api(adminToken(CREST), 'POST', '/settings/users', { body: newUser(CREST) })
    expect(blocked.status, blocked.text).toBe(402)
    expect(blocked.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'users', max: 25, planId: 'business' })
    expect(blocked.body.current).toBeGreaterThanOrEqual(25)
    expect(sliceText(APEX), 'Crest’s limit work touched Apex').toBe(apex)
    const ok = await api(adminToken(APEX), 'POST', '/settings/users', { body: newUser(APEX) })
    expect(ok.status, ok.text).toBe(200)
  })

  it('Crest at its leads+contacts limit can’t add leads; Apex can', async () => {
    expect((await api(adminToken(CREST), 'POST', '/dev/billing/usage', { body: { key: 'leadsContacts', percent: 100 } })).status).toBe(200)
    const blocked = await api(adminToken(CREST), 'POST', '/leads', { body: newLead(CREST) })
    expect(blocked.status, blocked.text).toBe(402)
    expect(blocked.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'leadsContacts', max: 25000 })
    expect((await api(adminToken(APEX), 'POST', '/leads', { body: newLead(APEX) })).status).toBe(200)
  })

  it('the other way round: Apex moved to Starter and at its limit is blocked; Crest (Business) is not', async () => {
    const moved = await api(platformToken(), 'POST', `/platform/companies/${APEX}/actions`, { body: { action: 'change_plan', planId: 'starter', reason: 'Isolation test downgrade' } })
    expect(moved.status, moved.text).toBe(200)
    expect((await api(adminToken(APEX), 'POST', '/dev/billing/usage', { body: { key: 'leadsContacts', percent: 100 } })).status).toBe(200)
    const crest = sliceText(CREST)
    const blocked = await api(adminToken(APEX), 'POST', '/leads', { body: newLead(APEX) })
    expect(blocked.status, blocked.text).toBe(402)
    expect(blocked.body).toMatchObject({ code: 'LIMIT_REACHED', limit: 'leadsContacts', planId: 'starter' })
    expect(sliceText(CREST)).toBe(crest)
    expect((await api(adminToken(CREST), 'POST', '/leads', { body: newLead(CREST) })).status).toBe(200)
  })
})

describe('§6 Module gating per company', () => {
  it('Crest (Business, no HR) → 403 module_not_in_plan; Apex (Enterprise) → 200', async () => {
    const crest = await api(adminToken(CREST), 'GET', '/hr/employees')
    expect(crest.status).toBe(403)
    expect(crest.body).toMatchObject({ code: 'module_not_in_plan', module: 'hr', planId: 'business' })
    expect((await api(adminToken(APEX), 'GET', '/hr/employees')).status).toBe(200)
  })

  it('a platform module override for Apex only (HR off) blocks Apex and leaves Crest’s plan alone', async () => {
    const res = await api(platformToken(), 'POST', `/platform/companies/${APEX}/modules`, { body: { module: 'hr', enabled: false, reason: 'Isolation test override' } })
    expect(res.status, res.text).toBe(200)
    expect((await api(adminToken(APEX), 'GET', '/hr/employees')).body.code).toBe('module_not_in_plan')
    expect((await api(adminToken(CREST), 'GET', '/hr/employees')).body.code).toBe('module_not_in_plan')
    expect((await api(adminToken(CREST), 'GET', '/events')).status).toBe(200)
  })
})

for (const co of COMPANIES) {
  const them = other(co)

  describe(`§6 ${label(co)} locked down, ${label(them)} unaffected`, () => {
    it(`billing read-only: ${label(co)} suspended → 423 on writes, reads work; ${label(them)} writes fine`, async () => {
      expect((await api(adminToken(co), 'POST', '/dev/billing/status', { body: { status: 'suspended' } })).status).toBe(200)
      const before = sliceText(them)
      const write = await api(adminToken(co), 'POST', '/tasks', { body: newTask() })
      expect(write.status).toBe(423)
      expect(write.body.code).toBe('workspace_read_only')
      expect((await api(adminToken(co), 'GET', '/leads')).status).toBe(200)
      expect(sliceText(them)).toBe(before)
      await expectUnaffected(them)
    })

    it(`operator full lock: ${label(co)} → 403 workspace_suspended and sign-in refused; ${label(them)} works and signs in`, async () => {
      const lock = await api(platformToken(), 'POST', `/platform/companies/${co}/actions`, { body: { action: 'suspend', reason: 'Isolation test lock' } })
      expect(lock.status, lock.text).toBe(200)
      const before = sliceText(them)
      const read = await api(adminToken(co), 'GET', '/leads')
      expect(read.status).toBe(403)
      expect(read.body.code).toBe('workspace_suspended')
      const signIn = await login(co)
      expect(signIn.status).toBeGreaterThanOrEqual(400)
      expect(signIn.body?.token).toBeUndefined()
      expect(sliceText(them)).toBe(before)
      await expectUnaffected(them)
      expect((await login(them)).status).toBe(200)
    })

    it(`deleted: ${label(co)} → 410 workspace_deleted (and at sign-in); ${label(them)} unaffected`, async () => {
      expect((await api(adminToken(co), 'POST', '/dev/billing/status', { body: { status: 'deleted' } })).status).toBe(200)
      const before = sliceText(them)
      const read = await api(adminToken(co), 'GET', '/leads')
      expect(read.status).toBe(410)
      expect(read.body.code).toBe('workspace_deleted')
      const signIn = await login(co)
      expect(signIn.status).toBe(410)
      expect(sliceText(them)).toBe(before)
      await expectUnaffected(them)
      expect((await login(them)).status).toBe(200)
    })
  })
}
