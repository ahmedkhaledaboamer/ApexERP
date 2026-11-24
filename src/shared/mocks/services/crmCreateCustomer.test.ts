import { describe, expect, it } from 'vitest'
import { contacts, customers, leads, users } from '@/shared/mocks/db'
import { SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { createCustomer, getCustomer, getCustomers } from '@/shared/mocks/services/crm'
import { getLeads } from '@/shared/mocks/services/leads'
import type { CustomerCreateInput } from '@/modules/crm/types'

/** POST /customers (services/crm.ts createCustomer): permissions, validation and tenant isolation. */

const user = (id: string) => users.find((u) => u.id === id)!
const apexAdmin = user('u1')
const apexAgent = user('u4') // Sales Agent: sales own
const apexAccountant = user('u8') // sales view
const apexHr = user('u9') // sales hidden
const crestAdmin = user('u101')

let seq = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}${++seq}`
const input = (over: Partial<CustomerCreateInput> = {}): CustomerCreateInput => ({
  name: unique('Direct Customer'),
  industry: 'Logistics',
  sourceType: 'Website',
  ...over,
})

describe('POST /customers: create a customer directly', () => {
  it('creates the customer with a backing Won lead and its primary contact, in the caller’s company', async () => {
    const before = customers.length
    const row = await createCustomer(apexAdmin, input({ website: 'direct-cust-a.ae', emirate: 'Dubai', address: 'Office 1, Business Bay', contact: { name: 'Mona Saleh', title: 'CFO', email: 'mona@direct-cust-a.ae' } }))
    expect(customers.length).toBe(before + 1)
    expect(row).toMatchObject({ status: 'active', website: 'https://direct-cust-a.ae', emirate: 'Dubai', address: 'Office 1, Business Bay', ownerId: 'u1', contactsCount: 1 })
    expect('companyId' in row).toBe(false)

    const stored = customers.find((c) => c.id === row.id)!
    expect(stored.companyId).toBe('co_apex')
    const lead = leads.find((l) => l.id === stored.leadId)!
    expect(lead).toMatchObject({ companyId: 'co_apex', status: SYSTEM_STATUS.won, customerId: row.id, nextFollowUpDate: null })
    const contact = contacts.find((c) => c.leadId === lead.id)!
    expect(contact).toMatchObject({ companyId: 'co_apex', customerId: row.id, name: 'Mona Saleh', isDecisionMaker: true })

    const detail = await getCustomer(apexAdmin, row.id)
    expect(detail.contacts.map((c) => c.name)).toEqual(['Mona Saleh'])
    expect(detail.recentActivities[0].summary).toContain('Added as a customer')
    expect((await getCustomers(apexAdmin)).some((c) => c.id === row.id)).toBe(true)
    // Not a sales opportunity: kept out of the leads list and the pipeline board.
    expect(lead.addedAsCustomer).toBe(true)
    expect((await getLeads(apexAdmin)).some((l) => l.id === lead.id)).toBe(false)
  })

  it('needs Sales edit: view-only and hidden roles are refused (403), own scope may add its own', async () => {
    await expect(createCustomer(apexAccountant, input())).rejects.toMatchObject({ status: 403 })
    await expect(createCustomer(apexHr, input())).rejects.toMatchObject({ status: 403 })
    const mine = await createCustomer(apexAgent, input())
    expect(mine.ownerId).toBe('u4')
    // Own scope can't give the customer to someone else.
    await expect(createCustomer(apexAgent, input({ ownerId: 'u5' }))).rejects.toMatchObject({ status: 403 })
  })

  it('validates the fields (422) and refuses duplicates (409)', async () => {
    await expect(createCustomer(apexAdmin, input({ name: '  ' }))).rejects.toMatchObject({ status: 422 })
    await expect(createCustomer(apexAdmin, input({ industry: 'Not an industry' }))).rejects.toMatchObject({ status: 422 })
    await expect(createCustomer(apexAdmin, input({ sourceType: '' }))).rejects.toMatchObject({ status: 422 })
    await expect(createCustomer(apexAdmin, input({ website: 'nope' }))).rejects.toMatchObject({ status: 422 })
    await expect(createCustomer(apexAdmin, input({ status: 'gold' as never }))).rejects.toMatchObject({ status: 422 })
    await expect(createCustomer(apexAdmin, input({ contact: { name: '', email: 'x@y.ae' } }))).rejects.toMatchObject({ status: 422 })

    const existing = customers.find((c) => c.companyId === 'co_apex')!
    await expect(createCustomer(apexAdmin, input({ name: existing.name }))).rejects.toMatchObject({ status: 409 })
    const openLead = leads.find((l) => l.companyId === 'co_apex' && !l.customerId)!
    await expect(createCustomer(apexAdmin, input({ name: openLead.company }))).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Mark it Won') })
  })

  it('tenant isolation: another company’s owner, name or emirate rules never apply across companies', async () => {
    // An owner of the other company is unknown here.
    await expect(createCustomer(apexAdmin, input({ ownerId: 'u104' }))).rejects.toMatchObject({ status: 422 })
    // The same name as an Apex customer is fine in Crest (duplicates are per company).
    const apexName = customers.find((c) => c.companyId === 'co_apex')!.name
    const crestRow = await createCustomer(crestAdmin, input({ name: apexName }))
    expect(customers.find((c) => c.id === crestRow.id)!.companyId).toBe('co_crest')
    // Emirates are UAE-only (Crest is in Saudi Arabia).
    await expect(createCustomer(crestAdmin, input({ emirate: 'Dubai' }))).rejects.toMatchObject({ status: 422 })
    // Each company lists only its own new customer.
    expect((await getCustomers(apexAdmin)).some((c) => c.id === crestRow.id)).toBe(false)
    await expect(getCustomer(apexAdmin, crestRow.id)).rejects.toMatchObject({ status: 404 })
    expect((await getCustomers(crestAdmin)).some((c) => c.id === crestRow.id)).toBe(true)
  })
})
