import { beforeEach, describe, expect, it } from 'vitest'
import { contacts, leads, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { leadStatusHistory, recordLeadStatusChange, statusHistoryOf } from '@/shared/mocks/data/leadStatusHistory'
import { projects, tasks } from '@/shared/mocks/data/tasks'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { getCustomer } from '@/shared/mocks/services/crm'
import { winLead, WonError } from '@/shared/mocks/services/won'

/**
 * Won flow alignment with the database design (docs/DB-ALIGNMENT.md): contacts get
 * customer_id and keep lead_id (nothing copied), the lead gets customer_id + won_at and a
 * lead_status_history row, the accepted quotation gets customer_id + accepted_at, and the
 * contract / projects / tasks carry the design's columns. A failure rolls all of it back.
 */

const admin = users.find((u) => u.id === 'u1')!
const seed = takeSnapshot(true)
beforeEach(() => restoreSnapshot(seed))
let keySeq = 0
const key = () => `align-key-${++keySeq}`

function openLeadWithContacts() {
  const lead = leads.find(
    (l) => l.companyId === 'co_apex' && !['Won', 'won', 'Lost', 'lost', 'Not interested', 'not_interested', 'Cold', 'cold'].includes(l.status) && !l.customerId && contacts.filter((c) => c.leadId === l.id).length >= 1,
  )
  if (!lead) throw new Error('No suitable seed lead')
  return lead
}

/** Makes a quotation of the lead accepted, with one monthly line (so a contract is created). */
function acceptedQuote(leadId: string) {
  const q = quotations.find((x) => x.companyId === 'co_apex' && x.leadId === leadId) ?? quotations.find((x) => x.companyId === 'co_apex')!
  q.leadId = leadId
  q.status = 'accepted'
  q.customerId = null
  q.acceptedAt = null
  q.decidedAt = '2026-11-10T09:00:00.000Z'
  q.items = [
    { id: 'L1', serviceId: 'S-101', description: 'Chatbot', quantity: 1, unit: 'project', unitPrice: 40000, discountPct: 0 },
    { id: 'L2', serviceId: 'S-102', description: 'Hosting & tuning', quantity: 12, unit: 'month', unitPrice: 2500, discountPct: 0 },
  ]
  return q
}

describe('Won flow writes the design’s columns', () => {
  it('contacts get customer_id and keep lead_id (no copies); GET /customers/:id lists them', async () => {
    const lead = openLeadWithContacts()
    const before = contacts.length
    const leadContacts = contacts.filter((c) => c.leadId === lead.id)
    const res = await winLead(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })
    expect(contacts.length).toBe(before)
    for (const c of leadContacts) expect(c).toMatchObject({ leadId: lead.id, customerId: res.customerId })
    // Other leads' contacts are untouched.
    expect(contacts.filter((c) => c.leadId !== lead.id && c.customerId === res.customerId)).toEqual([])
    const customer = await getCustomer(admin, res.customerId)
    expect(customer.contacts.map((c) => c.id).sort()).toEqual(leadContacts.map((c) => c.id).sort())
  })

  it('the lead gets customer_id, won_at and a lead_status_history row (from → won, by, at)', async () => {
    const lead = openLeadWithContacts()
    const from = lead.status
    const rowsBefore = leadStatusHistory.length
    const res = await winLead(admin, lead.id, { serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })
    expect(lead.customerId).toBe(res.customerId)
    expect(lead.wonAt).toBeTruthy()
    expect(leadStatusHistory.length).toBe(rowsBefore + 1)
    const row = statusHistoryOf(lead.id).at(-1)!
    expect(row).toMatchObject({ companyId: 'co_apex', leadId: lead.id, fromStatusId: from, toStatusId: lead.status, changedBy: admin.id, changedAt: lead.wonAt })
    expect(row.reason).toMatch(/Won/)
  })

  it('the accepted quotation gets customer_id and accepted_at; the contract, projects and tasks carry the design’s columns', async () => {
    const lead = openLeadWithContacts()
    const q = acceptedQuote(lead.id)
    const res = await winLead(admin, lead.id, { quotationId: q.id, serviceIds: ['S-101', 'S-102'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })
    expect(q.customerId).toBe(res.customerId)
    expect(q.acceptedAt).toBe('2026-11-10T09:00:00.000Z') // the decision time, kept
    const contract = contracts.find((c) => c.id === res.contractId)!
    expect(contract).toMatchObject({ customerId: res.customerId, quotationId: q.id, createdBy: admin.id })
    const created = projects.filter((p) => res.projectIds.includes(p.id))
    for (const p of created) {
      expect(p).toMatchObject({ status: 'planned', customerId: res.customerId, quotationId: q.id, contractId: res.contractId, leadId: lead.id, managerId: 'u10' })
    }
    expect(created.find((p) => p.serviceId === 'S-101')!.projectTemplateId).toBe('S-101')
    expect(created.find((p) => p.serviceId === 'S-102')!.projectTemplateId).toBeNull() // no template
    const generated = tasks.filter((t) => res.taskIds.includes(t.id))
    expect(generated.length).toBeGreaterThan(0)
    for (const [i, t] of generated.entries()) {
      expect(t).toMatchObject({ status: 'todo', link: null, parentTaskId: null, blockedAt: null, reminderSentAt: null, overdueNotifiedAt: null, completedAt: null })
      expect(['low', 'medium', 'high', 'urgent']).toContain(t.priority)
      expect(t.sortOrder).toBe(i + 1)
    }
  })

  it('accepted_at falls back to the Won time when the quotation has no decision time', async () => {
    const lead = openLeadWithContacts()
    const q = acceptedQuote(lead.id)
    q.decidedAt = null
    await winLead(admin, lead.id, { quotationId: q.id, serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() })
    expect(q.acceptedAt).toBe(lead.wonAt)
  })

  it('a failure rolls back contacts, quotation, lead and its history row too', async () => {
    const lead = openLeadWithContacts()
    const q = acceptedQuote(lead.id)
    const rowsBefore = leadStatusHistory.length
    const contactIds = contacts.filter((c) => c.leadId === lead.id).map((c) => c.id)
    await expect(
      winLead(admin, lead.id, { quotationId: q.id, serviceIds: ['S-101'], projectManagerId: 'u10', startDate: '2026-12-07', idempotencyKey: key() }, { failAt: 'notify' }),
    ).rejects.toBeInstanceOf(WonError)
    expect(leadStatusHistory.length).toBe(rowsBefore)
    const fresh = leads.find((l) => l.id === lead.id)!
    expect(fresh.customerId).toBeNull()
    expect(fresh.wonAt ?? null).toBeNull()
    for (const id of contactIds) expect(contacts.find((c) => c.id === id)!.customerId ?? null).toBeNull()
    const freshQ = quotations.find((x) => x.id === q.id)!
    expect(freshQ.customerId).toBeNull()
    expect(freshQ.acceptedAt ?? null).toBeNull()
  })
})

describe('lead_status_history helper (for every stage change)', () => {
  it('records from / to / by / reason / at in the lead’s company, and skips a no-op', () => {
    const lead = leads.find((l) => l.companyId === 'co_crest')!
    const row = recordLeadStatusChange(lead, 'new', 'contacted', { changedBy: 'u104', reason: '  First call done  ', at: '2026-11-18T08:00:00.000Z' })
    expect(row).toMatchObject({ companyId: 'co_crest', leadId: lead.id, fromStatusId: 'new', toStatusId: 'contacted', changedBy: 'u104', reason: 'First call done', changedAt: '2026-11-18T08:00:00.000Z' })
    expect(recordLeadStatusChange(lead, 'contacted', 'contacted')).toBeNull()
    expect(statusHistoryOf(lead.id).at(-1)).toEqual(row)
  })
})
