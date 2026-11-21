import { afterAll, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { finCollectionsMeta } from '@/shared/mocks/data/financeCollections'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { listInvoices } from './financeInvoices'
import { getFinanceOverview } from './financeLedger'
import './financeCollections' // registers the collections seed on the finance access hook

/**
 * Every finance screen sees the same data whichever page opens first: the collections seed (payments,
 * PDCs, credits) runs on the first finance access of a company, not only on the first payments call.
 */

const snap = takeSnapshot(true)
afterAll(() => restoreSnapshot(snap))
const u = (id: string) => users.find((x) => x.id === id)! as User

describe('finance first access seeds collections once', () => {
  it('the invoices list already shows seeded payments (Apex)', async () => {
    expect(finCollectionsMeta.seeded).not.toContain(APEX_ID)
    const rows = await listInvoices(u('u8'), {})
    expect(finCollectionsMeta.seeded).toContain(APEX_ID)
    expect(rows.some((r) => r.status === 'paid')).toBe(true)
    expect(rows.some((r) => r.status === 'partially_paid')).toBe(true)
    const again = await listInvoices(u('u8'), {})
    expect(again.map((r) => [r.id, r.status])).toEqual(rows.map((r) => [r.id, r.status]))
  })

  it('the overview seeds the other company, and only that one', async () => {
    expect(finCollectionsMeta.seeded).not.toContain(CREST_ID)
    getFinanceOverview(u('u101'))
    expect(finCollectionsMeta.seeded).toContain(CREST_ID)
  })
})
