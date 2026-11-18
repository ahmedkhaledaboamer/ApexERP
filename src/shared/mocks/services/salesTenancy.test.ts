import { describe, expect, it } from 'vitest'
import { contacts, customers, leads, users } from '@/shared/mocks/db'
import { contracts } from '@/shared/mocks/data/contracts'
import { quotations } from '@/shared/mocks/data/quotations'
import { checkDuplicates, createLead, getLead, getLeadOwners, getLeads, updateLead } from '@/shared/mocks/services/leads'
import { getContacts, getContracts, getCustomer, getCustomers, updateCustomer } from '@/shared/mocks/services/crm'
import { createQuotation, getQuotation, getQuotations } from '@/shared/mocks/services/quotations'
import { sendMessage } from '@/shared/mocks/services/messages'

const user = (id: string) => users.find((u) => u.id === id)!
const apexAdmin = user('u1')
const crestAdmin = user('u101')
const crestManager = user('u103')

const apexLead = leads.find((l) => l.companyId === 'co_apex')!
const crestLead = leads.find((l) => l.companyId === 'co_crest')!

describe('Sales mock API: tenant isolation', () => {
  it('seeds every sales row with a company, and Crest data in its own id blocks', () => {
    for (const rows of [leads, customers, contacts, contracts, quotations]) {
      expect(rows.every((r) => r.companyId === 'co_apex' || r.companyId === 'co_crest')).toBe(true)
    }
    const crest = leads.filter((l) => l.companyId === 'co_crest')
    expect(crest.length).toBeGreaterThanOrEqual(20)
    expect(crest.every((l) => /^L-5\d{3}$/.test(l.id) && l.mobile.startsWith('+966 5'))).toBe(true)
    expect(new Set([...leads.map((l) => l.id)]).size).toBe(leads.length)
    expect(new Set(quotations.map((q) => q.number)).size).toBe(quotations.length)
    expect(quotations.filter((q) => q.companyId === 'co_crest').every((q) => q.currency === 'SAR' && q.vatPct === 15)).toBe(true)
  })

  it('lists only the caller’s company, without leaking companyId', async () => {
    const apex = await getLeads(apexAdmin)
    const crest = await getLeads(crestAdmin)
    expect(apex.every((l) => l.id < 'L-5000')).toBe(true)
    expect(crest.every((l) => l.id >= 'L-5001')).toBe(true)
    expect('companyId' in apex[0]).toBe(false)
    expect((await getCustomers(crestAdmin)).every((c) => c.id.startsWith('C-50'))).toBe(true)
    expect((await getContacts(crestAdmin)).every((c) => c.recordId.slice(2) >= '5001')).toBe(true)
    expect((await getContracts(crestAdmin)).every((c) => c.id.startsWith('CON-50'))).toBe(true)
    expect((await getQuotations(crestAdmin)).every((q) => q.leadId >= 'L-5001')).toBe(true)
    expect((await getLeadOwners(crestManager)).every((o) => o.id.startsWith('u10'))).toBe(true)
  })

  it('answers 404 (same message) for another company’s records', async () => {
    await expect(getLead(crestAdmin, apexLead.id)).rejects.toMatchObject({ status: 404, message: 'That lead doesn’t exist.' })
    await expect(getLead(crestAdmin, 'L-9999')).rejects.toMatchObject({ status: 404, message: 'That lead doesn’t exist.' })
    await expect(getCustomer(apexAdmin, customers.find((c) => c.companyId === 'co_crest')!.id)).rejects.toMatchObject({ status: 404 })
    await expect(getQuotation(apexAdmin, quotations.find((q) => q.companyId === 'co_crest')!.id)).rejects.toMatchObject({ status: 404 })
    await expect(sendMessage(apexAdmin, crestLead.id, { channel: 'email', to: 'a@b.sa', subject: 'Hi', body: 'Hello' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('validates referenced ids inside the tenant', async () => {
    await expect(updateLead(apexAdmin, apexLead.id, { ownerId: 'u104' })).rejects.toMatchObject({ status: 422 })
    await expect(updateCustomer(apexAdmin, customers[0].id, { ownerId: 'u104' })).rejects.toMatchObject({ status: 422 })
    await expect(
      createQuotation(apexAdmin, {
        leadId: crestLead.id,
        title: 'x',
        validUntil: '2099-01-01',
        items: [{ description: 'x', quantity: 1, unit: 'project', unitPrice: 1, discountPct: 0, serviceId: null }],
      } as never),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('checks duplicates within the company only, and phones by the company country', async () => {
    expect(await checkDuplicates(crestAdmin, { company: apexLead.company, email: apexLead.contactEmail })).toEqual([])
    expect((await checkDuplicates(apexAdmin, { company: apexLead.company, email: '' })).length).toBeGreaterThan(0)

    const base = { company: 'Hail Cold Stores', sourceType: 'Website', industry: 'Logistics', contactName: 'Saad', email: 'saad@hailcold.sa' }
    await expect(createLead(crestAdmin, { ...base, mobile: '+971 50 123 4567' })).rejects.toMatchObject({ status: 422 })
    const created = await createLead(crestAdmin, { ...base, mobile: '0551234567' })
    expect(created.mobile).toBe('+966551234567')
    expect(leads.find((l) => l.id === created.id)!.companyId).toBe('co_crest')
    expect(Number(created.id.slice(2))).toBeLessThan(5000)
    // Apex lists don't see it; the same company name is not a duplicate in Apex.
    expect((await getLeads(apexAdmin)).some((l) => l.id === created.id)).toBe(false)
    expect(await checkDuplicates(apexAdmin, { company: 'Hail Cold Stores', email: '' })).toEqual([])
  })
})
