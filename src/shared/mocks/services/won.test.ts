import { beforeEach, describe, expect, it } from 'vitest'
import { parseISO } from 'date-fns'
import type { ImportLeadRow } from '@/modules/leads/types'
import { activities, contacts, customers, leads, notes, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { projectTemplateFor } from '@/shared/mocks/data/services'
import { notifications, projects, tasks } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { addWorkingDays, isoDate } from '@/modules/won/plan'
import { WON_INVALIDATES } from '@/modules/won/invalidation'
import { crmKeys } from '@/modules/crm/queryKeys'
import { leadKeys } from '@/modules/leads/queryKeys'
import { quotationKeys } from '@/modules/quotations/queryKeys'
import { dashboardKeys } from '@/modules/dashboard/queryKeys'
import { createLead, getLeadActivities, moveLeadStage, updateLead } from '@/shared/mocks/services/leads'
import { checkImport, runImport } from '@/shared/mocks/services/leadImport'
import { getCustomer } from '@/shared/mocks/services/crm'
import { getProject } from '@/shared/mocks/services/projects'
import { saveLookupList } from '@/shared/mocks/services/settings'
import { previewWon, winLead, WonError, type WonFailKind } from '@/shared/mocks/services/won'

const admin = users.find((u) => u.id === 'u1')!
const seed = takeSnapshot(true)
beforeEach(() => {
  restoreSnapshot(seed)
})
let keySeq = 0
const key = () => `test-key-${++keySeq}`

/** An open lead (not won) with at least one contact, owned by a sales agent. */
function openLeadWithContact(exclude: string[] = []) {
  const lead = leads.find(
    (l) => !['Won', 'Lost', 'Not interested', 'Cold'].includes(l.status) && !exclude.includes(l.id) && contacts.some((c) => c.leadId === l.id),
  )
  if (!lead) throw new Error('No suitable seed lead')
  return lead
}

/** Counts of every store the Won flow writes to. */
function storeSizes() {
  return {
    customers: customers.length,
    contracts: contracts.length,
    projects: projects.length,
    tasks: tasks.length,
    notifications: notifications.length,
    activities: activities.length,
    audit: auditLog.length,
  }
}

describe('Won flow: POST /leads/:id/won', () => {
  it('happy path: customer, projects and template tasks with resolved owners and due dates', async () => {
    const lead = openLeadWithContact()
    const before = storeSizes()
    // S-101 (8-task template incl. Developer/QA/AI engineer roles) + S-102 (no template).
    const input = { serviceIds: ['S-101', 'S-102'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() }

    const res = await winLead(admin, lead.id, input)

    // 1. Lead is Won and linked to the customer.
    expect(lead.status).toBe('Won')
    expect(lead.customerId).toBe(res.customerId)
    expect(lead.nextFollowUpDate).toBeNull()
    // 2. Customer created from the lead (no retyping).
    const customer = customers.find((c) => c.id === res.customerId)!
    expect(customer.name).toBe(lead.company)
    expect(customer.leadId).toBe(lead.id)
    expect(customer.serviceIds).toEqual(expect.arrayContaining(['S-101', 'S-102']))
    // 4. One project per purchased service.
    expect(res.projectIds).toHaveLength(2)
    const tpl = projectTemplateFor('S-101').tasks
    expect(res.taskIds).toHaveLength(tpl.length) // S-102 has no template → no tasks
    const generated = tasks.filter((t) => res.taskIds.includes(t.id))
    // Due date = start + offset + (length in working days − 1), on working days.
    for (const t of generated) {
      const src = tpl.find((x) => x.id === t.templateTaskId)!
      const expected = isoDate(addWorkingDays(parseISO('2026-12-07'), src.dayOffset + Math.max(1, Math.ceil(src.hours / 8)) - 1))
      expect(t.dueDate).toBe(expected)
      expect(t.link).toBeNull()
      expect(t.projectId).toBe(res.projectIds[0])
    }
    // Role → person in the delivery department; unmatched roles fall back to the project manager.
    expect(generated.find((t) => t.description.startsWith('Developer'))?.ownerId).toBe('u14')
    expect(generated.find((t) => t.description.startsWith('Solutions consultant'))?.ownerId).toBe('u11')
    expect(generated.find((t) => t.description.startsWith('QA'))?.ownerId).toBe('u15')
    expect(generated.find((t) => t.description.startsWith('AI engineer'))?.ownerId).toBe('u16')
    expect(generated.find((t) => t.description.startsWith('Project manager'))?.ownerId).toBe('u10')
    // 5. Team notified (owner, PM, task owners) · 6. audit + system activity.
    expect(notifications.length).toBeGreaterThan(before.notifications)
    expect(notifications.some((n) => n.userId === lead.ownerId && n.type === 'won')).toBe(true)
    expect(notifications.some((n) => n.userId === 'u14' && n.type === 'assignment')).toBe(true)
    expect(auditLog[0].entityId).toBe(lead.id)
    expect(activities.some((a) => a.leadId === lead.id && a.type === 'system')).toBe(true)
    expect(res.redirectTo).toBe(`/projects/${res.projectIds[0]}`)
    expect(storeSizes().projects).toBe(before.projects + 2)
  })

  it('creates a contract from the accepted quotation’s monthly lines', async () => {
    const lead = openLeadWithContact()
    const q = quotations.find((x) => x.leadId === lead.id) ?? quotations[0]
    // Make it an accepted quotation for this lead with a 12-month recurring line.
    q.leadId = lead.id
    q.status = 'accepted'
    q.items = [
      { id: 'L1', serviceId: 'S-201', description: 'CRM automation setup', quantity: 1, unit: 'project', unitPrice: 35000, discountPct: 0 },
      { id: 'L2', serviceId: 'S-102', description: 'Hosting & tuning', quantity: 12, unit: 'month', unitPrice: 2500, discountPct: 0 },
    ]
    const res = await winLead(admin, lead.id, {
      quotationId: q.id,
      serviceIds: ['S-201', 'S-102'],
      projectManagerId: 'u10',
      startDate: '2026-12-01',
      idempotencyKey: key(),
    })
    const c = contracts.find((x) => x.id === res.contractId)!
    expect(c.billing).toBe('Monthly')
    expect(c.value).toBe(2500)
    expect(c.renewalDate).toBe('2027-12-01')
    expect(c.customerId).toBe(res.customerId)
  })

  it('missing template: the project is created without tasks and the preview warns', async () => {
    const lead = openLeadWithContact()
    const preview = await previewWon(admin, lead.id, { serviceIds: ['S-102'], projectManagerId: 'u10', startDate: '2026-12-07' })
    expect(preview.projects[0].hasTemplate).toBe(false)
    expect(preview.warnings.join(' ')).toMatch(/no project template/i)
    expect(preview.problems).toEqual([])
    const res = await winLead(admin, lead.id, { serviceIds: ['S-102'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })
    expect(res.projectIds).toHaveLength(1)
    expect(res.taskIds).toHaveLength(0)
  })

  it('missing contact: refused with 422 at validate, nothing saved', async () => {
    const lead = openLeadWithContact()
    // Strip the contacts.
    for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].leadId === lead.id) contacts.splice(i, 1)
    lead.contactName = ''
    const before = storeSizes()
    const status = lead.status
    await expect(winLead(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })).rejects.toMatchObject({
      status: 422,
      step: 'validate',
      message: expect.stringMatching(/at least one contact/i),
    })
    expect(lead.status).toBe(status)
    expect(storeSizes()).toEqual(before)
  })

  it('missing service: refused with 422', async () => {
    const lead = openLeadWithContact()
    await expect(winLead(admin, lead.id, { serviceIds: [], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/purchased service/i),
    })
  })

  it('already won: 409 and nothing changes', async () => {
    const lead = leads.find((l) => l.status === 'Won' && l.customerId)!
    const before = storeSizes()
    await expect(winLead(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })).rejects.toMatchObject({
      status: 409,
    })
    expect(storeSizes()).toEqual(before)
  })

  it('double submit: the same idempotency key is refused the second time', async () => {
    const lead = openLeadWithContact()
    const k = key()
    await winLead(admin, lead.id, { serviceIds: ['S-401'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: k })
    const other = openLeadWithContact([lead.id])
    await expect(winLead(admin, other.id, { serviceIds: ['S-401'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: k })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/already submitted/i),
    })
  })

  it.each(['customer', 'contract', 'projects', 'notify', 'audit'] as const)('rollback: a failure at “%s” saves nothing', async (failAt) => {
    const lead = openLeadWithContact()
    const snapshotLead = { ...lead }
    const before = storeSizes()
    const k = key()
    const err = await winLead(admin, lead.id, { serviceIds: ['S-101', 'S-301'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: k }, { failAt }).catch((e) => e)
    expect(err).toBeInstanceOf(WonError)
    expect(err.step).toBe(failAt)
    expect(err.message).toMatch(/nothing was saved/i)
    // Stores and the lead are exactly as before.
    expect(storeSizes()).toEqual(before)
    const now = leads.find((l) => l.id === lead.id)!
    expect(now.status).toBe(snapshotLead.status)
    expect(now.customerId).toBe(snapshotLead.customerId)
    // The key is released, so a retry after the fix succeeds.
    const ok = await winLead(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: k })
    expect(ok.projectIds).toHaveLength(1)
  })

  it('the old stage endpoint can no longer win a lead', async () => {
    const lead = openLeadWithContact()
    await expect(moveLeadStage(admin, { id: lead.id, status: 'Won' })).rejects.toMatchObject({ status: 409 })
  })

  it('keeps the other transition rules: Interested needs next step + date, Lost needs a listed reason', async () => {
    // A lead not already in Interested (a move to the current status is a no-op).
    const lead = openLeadWithContact(leads.filter((l) => l.status === 'Interested').map((l) => l.id))
    await expect(moveLeadStage(admin, { id: lead.id, status: 'Interested' })).rejects.toMatchObject({ status: 422 })
    await expect(moveLeadStage(admin, { id: lead.id, status: 'Lost', lossReason: 'free text' })).rejects.toMatchObject({ status: 422 })
  })

  it('preview defaults the project manager to the lead owner’s manager', async () => {
    const lead = openLeadWithContact()
    const owner = users.find((u) => u.id === lead.ownerId)!
    const preview = await previewWon(admin, lead.id)
    expect(preview.defaults.projectManagerId).toBe(owner.managerId ?? owner.id)
  })
})

/* ---------------- Gaps closed: plan limits, bypasses, requirements, carry-over, audit ---------------- */

const crestAdmin = users.find((u) => u.id === 'u101')!
const base = (extra: Record<string, unknown> = {}) => ({ serviceIds: ['S-101', 'S-301'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key(), ...extra })

/** Everything the Won flow can write, deep-cloned: rollback means exactly the same data. */
function wonStores() {
  return structuredClone({ leads, customers, contracts, projects, tasks, notifications, activities, auditLog })
}

function crestProposalLead() {
  const lead = leads.find((l) => l.companyId === 'co_crest' && l.status === 'Proposal' && contacts.some((c) => c.leadId === l.id))
  if (!lead) throw new Error('No Crest proposal lead')
  return lead
}

describe('Won flow: requirements', () => {
  it('contactName text alone is not a contact: no contact record and no mobile/email → 422', async () => {
    const lead = openLeadWithContact()
    for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].leadId === lead.id) contacts.splice(i, 1)
    lead.contactName = 'Only A Name'
    lead.mobile = ''
    lead.contactEmail = ''
    const preview = await previewWon(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07' })
    expect(preview.problems.join(' ')).toMatch(/at least one contact \(a name with a mobile or an email\)/i)
    const before = wonStores()
    await expect(winLead(admin, lead.id, base())).rejects.toMatchObject({ status: 422, step: 'validate', message: expect.stringMatching(/at least one contact/i) })
    expect(wonStores()).toEqual(before)
  })

  it('the primary contact with a name and an email counts as a contact (no record needed)', async () => {
    const lead = openLeadWithContact()
    for (let i = contacts.length - 1; i >= 0; i--) if (contacts[i].leadId === lead.id) contacts.splice(i, 1)
    lead.contactName = 'Primary Person'
    lead.mobile = ''
    lead.contactEmail = 'primary@example.org'
    const res = await winLead(admin, lead.id, base({ serviceIds: ['S-102'] }))
    expect(res.projectIds).toHaveLength(1)
  })

  it('a non-accepted quotation is refused (422 quotation_not_accepted) and the preview blocks on it', async () => {
    const lead = openLeadWithContact()
    const q = quotations.find((x) => x.companyId === lead.companyId && x.status === 'sent')!
    q.leadId = lead.id
    const preview = await previewWon(admin, lead.id, { quotationId: q.id })
    expect(preview.problems[0]).toContain(`${q.number} is Sent, not Accepted`)
    expect(preview.contract).toBeNull()
    const before = wonStores()
    const err = await winLead(admin, lead.id, base({ quotationId: q.id })).catch((e) => e)
    expect(err).toMatchObject({ status: 422, step: 'validate', code: 'quotation_not_accepted' })
    expect(wonStores()).toEqual(before)
    // Accepting it and winning in one go works (the dialog opens right after the accept).
    q.status = 'accepted'
    const ok = await winLead(admin, lead.id, base({ quotationId: q.id }))
    expect(projects.find((p) => p.id === ok.projectIds[0])?.quotationId).toBe(q.id)
  })

  it('a quotation of another lead is refused (422)', async () => {
    const lead = openLeadWithContact()
    const q = quotations.find((x) => x.companyId === lead.companyId && x.status === 'accepted' && x.leadId !== lead.id)!
    await expect(winLead(admin, lead.id, base({ quotationId: q.id }))).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/another lead/) })
  })

  it('another company’s quotation or project manager answers 404, exactly like a missing one', async () => {
    const lead = openLeadWithContact()
    const crestQuote = quotations.find((x) => x.companyId === 'co_crest')!
    const foreignQ = await winLead(admin, lead.id, base({ quotationId: crestQuote.id })).catch((e) => e)
    const missingQ = await winLead(admin, lead.id, base({ quotationId: 'Q-missing' })).catch((e) => e)
    expect(foreignQ).toMatchObject({ status: 404, step: 'validate' })
    expect(foreignQ.message).toBe(missingQ.message)
    const foreignPm = await winLead(admin, lead.id, base({ projectManagerId: crestAdmin.id })).catch((e) => e)
    const missingPm = await winLead(admin, lead.id, base({ projectManagerId: 'u-missing' })).catch((e) => e)
    expect(foreignPm).toMatchObject({ status: 404, step: 'validate' })
    expect(foreignPm.message).toBe(missingPm.message)
    // The preview never shows a name from the other company.
    const preview = await previewWon(admin, lead.id, { projectManagerId: crestAdmin.id, serviceIds: ['S-101'] })
    expect(JSON.stringify(preview)).not.toContain(crestAdmin.name)
  })

  it('another company’s lead is 404 for preview and submit', async () => {
    const crestLead = crestProposalLead()
    await expect(previewWon(admin, crestLead.id)).rejects.toMatchObject({ status: 404 })
    await expect(winLead(admin, crestLead.id, base())).rejects.toMatchObject({ status: 404 })
  })
})

describe('Won flow: concurrency', () => {
  it('two concurrent submits with different keys: one wins, the other gets 409 (in flight)', async () => {
    const lead = openLeadWithContact()
    const results = await Promise.allSettled([winLead(admin, lead.id, base()), winLead(admin, lead.id, base())])
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0].reason).toMatchObject({ status: 409, step: 'validate' })
    expect(projects.filter((p) => p.leadId === lead.id && p.createdFrom === 'won')).toHaveLength(2) // S-101 + S-301, once
    await expect(winLead(admin, lead.id, base())).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already Won/) })
  })
})

describe('Won flow: plan errors inside the flow keep code + details and roll everything back', () => {
  const STEPS = ['lead', 'customer', 'contract', 'projects', 'notify', 'audit'] as const

  it.each(STEPS)('402 LIMIT_REACHED at “%s”: full rollback, code + details preserved, step tagged', async (failAt) => {
    // Crest is on a plan with limits, so current / max are real numbers.
    const lead = crestProposalLead()
    const q = quotations.find((x) => x.companyId === 'co_crest' && x.status === 'accepted')!
    q.leadId = lead.id
    q.items = [{ id: 'L1', serviceId: 'S-901', description: 'Retainer', quantity: 12, unit: 'month', unitPrice: 1000, discountPct: 0 }]
    const input = { quotationId: q.id, serviceIds: ['S-901'], projectManagerId: 'u101', startDate: '2026-12-07', idempotencyKey: key() }
    const before = wonStores()
    const err = await winLead(crestAdmin, lead.id, input, { failAt, failWith: 'limit' }).catch((e) => e)
    expect(err).toBeInstanceOf(WonError)
    expect(err).toMatchObject({ status: 402, code: 'LIMIT_REACHED', step: failAt })
    expect(err.details).toMatchObject({ limit: 'leadsContacts', max: 25000, planId: 'business' })
    expect(typeof err.details.current).toBe('number')
    expect(wonStores()).toEqual(before)
    // The key was released: the same request succeeds once the limit is gone.
    const ok = await winLead(crestAdmin, lead.id, input)
    expect(ok.contractId).toBeTruthy()
  })

  it.each([
    ['module', 403, 'module_not_in_plan', { module: 'accounting' }],
    ['read_only', 423, 'workspace_read_only', { status: 'suspended' }],
  ] as [WonFailKind, number, string, Record<string, unknown>][])('%s inside the flow → %i %s with details, rolled back', async (failWith, status, code, details) => {
    const lead = openLeadWithContact()
    const before = wonStores()
    const err = await winLead(admin, lead.id, base(), { failAt: 'projects', failWith }).catch((e) => e)
    expect(err).toMatchObject({ status, code, step: 'projects', details })
    expect(wonStores()).toEqual(before)
  })

  it('the browser failpoint globals work the same way (window.__apexWonFailAt / __apexWonFailWith)', async () => {
    const g = globalThis as { __apexWonFailAt?: string; __apexWonFailWith?: string }
    const lead = openLeadWithContact()
    const before = wonStores()
    g.__apexWonFailAt = 'customer'
    g.__apexWonFailWith = 'limit'
    try {
      await expect(winLead(admin, lead.id, base())).rejects.toMatchObject({ status: 402, code: 'LIMIT_REACHED', step: 'customer' })
    } finally {
      delete g.__apexWonFailAt
      delete g.__apexWonFailWith
    }
    expect(wonStores()).toEqual(before)
  })

  it('no limit is reachable naturally: a Won adds no leads + contacts, users or storage usage', async () => {
    const { usedOf } = await import('@/shared/mocks/services/billing')
    const usage = () => ({ lc: usedOf('co_crest', 'leadsContacts'), users: usedOf('co_crest', 'users'), storage: usedOf('co_crest', 'storageMb') })
    const before = usage()
    await winLead(crestAdmin, crestProposalLead().id, { serviceIds: ['S-901'], projectManagerId: 'u101', startDate: '2026-12-07', idempotencyKey: key() })
    expect(usage()).toEqual(before)
  })
})

describe('Won flow: carry-over, audit and activities', () => {
  it('the customer 360 shows the lead’s contacts, notes and full history; audit covers customer, contract and each project', async () => {
    const lead = openLeadWithContact()
    notes.push({ companyId: lead.companyId, id: 'N-won-carry', leadId: lead.id, body: 'Carry me over', authorId: 'u1', createdAt: '2026-11-01T09:00:00.000Z' })
    const q = quotations.find((x) => x.companyId === lead.companyId && x.status === 'accepted')!
    q.leadId = lead.id
    q.items = [{ id: 'L1', serviceId: 'S-101', description: 'Retainer', quantity: 6, unit: 'month', unitPrice: 2000, discountPct: 0 }]
    const historyBefore = activities.filter((a) => a.leadId === lead.id).length
    const res = await winLead(admin, lead.id, base({ quotationId: q.id }))

    const c = await getCustomer(admin, res.customerId)
    expect(c.contacts.length).toBeGreaterThan(0)
    expect(c.contacts.map((x) => x.id).sort()).toEqual(contacts.filter((x) => x.leadId === lead.id).map((x) => x.id).sort())
    expect(c.notes.some((n) => n.id === 'N-won-carry')).toBe(true)
    expect(c.recentActivities[0].summary).toMatch(/^Won by/)
    // The customer page's Activity tab lists the lead's whole history (ActivityLog → GET /leads/:id/activities).
    expect(await getLeadActivities(admin, c.leadId)).toHaveLength(historyBefore + 1)

    expect(auditLog.find((e) => e.entity === 'customer' && e.entityId === res.customerId)).toMatchObject({ action: 'create' })
    expect(auditLog.find((e) => e.entity === 'contract' && e.entityId === res.contractId)).toMatchObject({ action: 'create' })
    for (const id of res.projectIds) {
      const p = await getProject(admin, id)
      expect(p.audit, `project ${id} Activity tab`).toHaveLength(1)
      expect(p.audit[0].summary).toMatch(/created by the Won flow/i)
      expect(p.tasks.length).toBe(projectTemplateFor(p.serviceId).tasks.length)
    }
    expect(auditLog[0]).toMatchObject({ entity: 'lead', entityId: lead.id })
  })

  it('linking an existing customer of another lead: audit says linked and the activity lands on that customer’s timeline too', async () => {
    const lead = openLeadWithContact()
    const existing = customers.find((c) => c.companyId === lead.companyId && c.leadId !== lead.id)!
    lead.company = existing.name
    const res = await winLead(admin, lead.id, base({ serviceIds: ['S-102'] }))
    expect(res).toMatchObject({ customerId: existing.id, customerCreated: false })
    expect(auditLog.find((e) => e.entity === 'customer' && e.entityId === existing.id)?.summary).toMatch(/linked/)
    expect(activities.filter((a) => a.type === 'system' && a.summary.startsWith('Won by') && [lead.id, existing.leadId].includes(a.leadId))).toHaveLength(2)
    expect((await getCustomer(admin, existing.id)).recentActivities[0].summary).toMatch(/^Won by/)
  })
})

describe('Won bypasses are closed', () => {
  const importRow = (status: string): ImportLeadRow => ({
    row: 2, company: `Bypass ${status} Co`, website: '', contactName: 'Bypass Person', contactTitle: '', mobile: '', email: `bypass-${status.toLowerCase()}@example.org`,
    isDecisionMaker: false, sourceType: 'Website', sourceDetail: '', industry: 'Logistics', subIndustry: '', status, ownerId: '', nextFollowUpDate: '',
    nextStep: '', value: null, companyServices: [], recommendedServiceId: '', recommendedServiceText: '', notes: '', doNotContact: false,
  })
  const signed = () =>
    lookupsFor('co_apex').statuses.push({ key: 'Signed', label: 'Signed', active: true, order: 99, probability: 100, type: 'won', requiresNextStep: false, requiresLossReason: false, tone: 'green', color: '#10b981', system: false })

  it('import: a Won row is an error in the check and is never created; an open status still imports', async () => {
    const [check] = await checkImport(admin, [importRow('Won')])
    expect(check.errors.join(' ')).toMatch(/can’t be imported.*Won flow/)
    const before = leads.length
    const res = await runImport(admin, { rows: [importRow('Won')], decisions: { 2: 'import' }, ownerRule: 'auto' })
    expect(res.created).toBe(0)
    expect(res.failed[0].reason).toMatch(/Won flow/)
    expect(leads.length).toBe(before)
    expect((await runImport(admin, { rows: [importRow('Proposal')], decisions: { 2: 'import' }, ownerRule: 'auto' })).created).toBe(1)
  })

  it('import: a custom status of type won is refused too', async () => {
    signed()
    const [check] = await checkImport(admin, [importRow('Signed')])
    expect(check.errors.join(' ')).toMatch(/Won flow/)
  })

  it('create and update: a Won status in the body → 422 use_won_flow, nothing changes', async () => {
    const quick = { company: 'Bypass Create', contactName: 'P', mobile: '', email: 'p@example.org', sourceType: 'Website', industry: 'Logistics', status: 'Won' }
    await expect(createLead(admin, quick as never)).rejects.toMatchObject({ status: 422, code: 'use_won_flow', message: expect.stringMatching(/Use the Won flow/) })
    const lead = openLeadWithContact()
    const status = lead.status
    await expect(updateLead(admin, lead.id, { status: 'Won', nextStep: 'x' } as never)).rejects.toMatchObject({ status: 422, code: 'use_won_flow' })
    expect(lead.status).toBe(status)
    expect(lead.customerId).toBeNull()
  })

  it('stage: refuses the built-in and a custom status of type won (409 use_won_flow)', async () => {
    const lead = openLeadWithContact()
    await expect(moveLeadStage(admin, { id: lead.id, status: 'Won' })).rejects.toMatchObject({ status: 409, code: 'use_won_flow' })
    signed()
    await expect(moveLeadStage(admin, { id: lead.id, status: 'Signed' })).rejects.toMatchObject({ status: 409, code: 'use_won_flow' })
    expect(lead.status).not.toBe('Signed')
  })

  it('settings: a status leads sit in can’t be turned into a Won-flow status', async () => {
    const statuses = lookupsFor('co_apex').statuses.map((s) => (s.key === 'Proposal' ? { ...s, type: 'won' as const } : s))
    await expect(saveLookupList(admin, 'statuses', statuses)).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/only the Won flow/) })
  })
})

describe('Won: client invalidation', () => {
  it('invalidates every affected cache root', () => {
    const roots = WON_INVALIDATES.map((k) => k[0])
    for (const root of [leadKeys.all[0], crmKeys.all[0], quotationKeys.all[0], dashboardKeys.all[0], 'projects', 'tasks', 'alerts', 'notifications', 'audit', 'reports']) {
      expect(roots, root).toContain(root)
    }
  })
})
