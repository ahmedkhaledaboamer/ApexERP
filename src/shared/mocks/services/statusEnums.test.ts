import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { customers, users } from '@/shared/mocks/db'
import { quotations } from '@/shared/mocks/data/quotations'
import { contracts } from '@/shared/mocks/data/contracts'
import { APEX_ID } from '@/shared/mocks/data/tenancy'
import { advanceClock, resetClock } from '@/shared/mocks/clock'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { addDaysIso } from '@/shared/lib/companyDay'
import { CONTRACT_STATUSES, CUSTOMER_STATUSES, QUOTATION_STATUSES } from '@/shared/domain/enums'
import { getContracts, getCustomers, updateContract, updateCustomer } from '@/shared/mocks/services/crm'
import { expireQuotations, getQuotation, getQuotations, markQuotationViewed, setQuotationStatus } from '@/shared/mocks/services/quotations'
import { runLifecycle } from '@/shared/mocks/services/billing'

/** Status enums on the wire: lower-case values from shared/domain/enums.ts, validated by the server. */

const admin = (): User => users.find((u) => u.id === 'u1')!

let snap: ReturnType<typeof takeSnapshot>
beforeEach(() => {
  snap = takeSnapshot(true)
  resetClock()
})
afterEach(() => {
  resetClock()
  restoreSnapshot(snap)
})

describe('customer status: active | paused | vip | churned', () => {
  it('every customer and every API row uses a known value', async () => {
    for (const c of customers) expect(CUSTOMER_STATUSES).toContain(c.status)
    for (const r of await getCustomers(admin())) expect(CUSTOMER_STATUSES).toContain(r.status)
  })

  it('accepts churned and refuses unknown or label-cased values', async () => {
    const c = customers.find((x) => x.companyId === APEX_ID)!
    expect((await updateCustomer(admin(), c.id, { status: 'churned' })).status).toBe('churned')
    await expect(updateCustomer(admin(), c.id, { status: 'Active' as never })).rejects.toMatchObject({ status: 422 })
    await expect(updateCustomer(admin(), c.id, { status: 'lost' as never })).rejects.toMatchObject({ status: 422 })
    expect(c.status).toBe('churned')
  })
})

describe('contract status: draft | active | expired | cancelled | renewed', () => {
  it('rows use known values; an active contract past its renewal date reads expired', async () => {
    const rows = await getContracts(admin())
    for (const r of rows) expect(CONTRACT_STATUSES).toContain(r.status)
    const k = contracts.find((x) => x.companyId === APEX_ID && x.status === 'active')!
    k.renewalDate = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const row = (await getContracts(admin())).find((r) => r.id === k.id)!
    expect(row).toMatchObject({ status: 'expired', renewalDue: false })
    expect(k.status).toBe('active')
  })

  it('renewalDue marks an active contract inside the renewal window (shown as Expiring)', async () => {
    const k = contracts.find((x) => x.companyId === APEX_ID && x.status === 'active')!
    k.renewalDate = new Date(Date.now() + 5 * 86_400_000).toISOString()
    expect((await getContracts(admin())).find((r) => r.id === k.id)).toMatchObject({ status: 'active', renewalDue: true })
  })

  it('only active and cancelled can be set', async () => {
    const k = contracts.find((x) => x.companyId === APEX_ID && x.status === 'active')!
    expect((await updateContract(admin(), k.id, { status: 'cancelled' })).status).toBe('cancelled')
    await expect(updateContract(admin(), k.id, { status: 'expired' as never })).rejects.toMatchObject({ status: 422 })
    await expect(updateContract(admin(), k.id, { status: 'Active' as never })).rejects.toMatchObject({ status: 422 })
  })
})

describe('quotation status: draft | sent | viewed | accepted | rejected | expired', () => {
  const apexQuote = (status: string, valid = true) =>
    quotations.find((q) => q.companyId === APEX_ID && q.status === status && (!valid || q.validUntil >= companyDayOf(APEX_ID).today))!

  it('every row uses a known value', async () => {
    for (const q of await getQuotations(admin())) expect(QUOTATION_STATUSES).toContain(q.status)
  })

  it('opening as the customer marks a sent quotation viewed, once', async () => {
    const q = apexQuote('sent')
    const viewed = await markQuotationViewed(admin(), q.id)
    expect(viewed.status).toBe('viewed')
    expect(viewed.viewedAt).toBeTruthy()
    const first = viewed.viewedAt
    expect((await markQuotationViewed(admin(), q.id)).viewedAt).toBe(first)
    // Viewed can still be decided.
    expect((await setQuotationStatus(admin(), q.id, 'accepted')).status).toBe('accepted')
    // A decided quotation stays decided when opened again.
    expect((await markQuotationViewed(admin(), q.id)).status).toBe('accepted')
  })

  it('a draft can’t be viewed by the client', async () => {
    await expect(markQuotationViewed(admin(), apexQuote('draft').id)).rejects.toMatchObject({ status: 409 })
  })

  it('expires (stored) once valid_until passes on the mock clock, lazily on read', async () => {
    const q = apexQuote('sent')
    q.validUntil = addDaysIso(companyDayOf(APEX_ID).today, 1)
    expect((await getQuotation(admin(), q.id)).status).toBe('sent')
    advanceClock(1)
    expect((await getQuotation(admin(), q.id)).status).toBe('sent') // the last valid day is still valid
    advanceClock(1)
    expect((await getQuotation(admin(), q.id)).status).toBe('expired')
    expect(q.status).toBe('expired')
    // Can't accept an expired one.
    await expect(setQuotationStatus(admin(), q.id, 'accepted')).rejects.toMatchObject({ status: 409 })
  })

  it('the lifecycle tick expires sent and viewed ones, never accepted / rejected / draft', () => {
    const past = addDaysIso(companyDayOf(APEX_ID).today, -1)
    const byStatus = Object.fromEntries(
      (['sent', 'viewed', 'accepted', 'rejected', 'draft'] as const).map((s) => {
        const q = quotations.find((x) => x.companyId === APEX_ID && x.status === s)!
        q.validUntil = past
        return [s, q]
      }),
    )
    runLifecycle(APEX_ID)
    expect(byStatus.sent.status).toBe('expired')
    expect(byStatus.viewed.status).toBe('expired')
    expect(byStatus.accepted.status).toBe('accepted')
    expect(byStatus.rejected.status).toBe('rejected')
    expect(byStatus.draft.status).toBe('draft')
    expect(expireQuotations(APEX_ID)).toBe(0)
  })

  it('decisions are lower-case values; labels are refused', async () => {
    const q = apexQuote('sent')
    await expect(setQuotationStatus(admin(), q.id, 'Accepted' as never)).rejects.toMatchObject({ status: 422 })
    expect((await setQuotationStatus(admin(), q.id, 'rejected')).status).toBe('rejected')
  })
})
