import { addDays, subDays } from 'date-fns'
import type { Contract, ContractBilling } from '@/modules/crm/types'
import { customers } from '@/shared/mocks/db'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Seed contracts (mock), 1–2 per won customer. Dates are relative to load time so some
 * always renew within 30 days and one has already lapsed. Status is stored as Active or
 * Cancelled; the API derives Expiring and Expired from the renewal date.
 */

type Seed = [
  customerName: string,
  title: string,
  serviceIds: string[],
  value: number,
  billing: ContractBilling,
  startDaysAgo: number,
  renewInDays: number,
  cancelled?: boolean,
]

const SEED: Seed[] = [
  ['Desert Rose Hotels', 'Guest chatbot & booking site rollout', ['S-101', 'S-601'], 180000, 'One-off', 3, 362],
  ['Desert Rose Hotels', 'Chatbot hosting & tuning', ['S-102'], 2500, 'Monthly', 3, 27],
  ['Palm Retail Group', 'BI dashboards & e-commerce site', ['S-401', 'S-601'], 54000, 'One-off', 2, 363],
  ['Palm Retail Group', 'Support & maintenance retainer', ['S-701'], 4500, 'Monthly', 2, 28],
  ['Hatta Mountain Resorts', 'Booking site & PMS integration', ['S-601', 'S-501'], 96000, 'One-off', 18, 347],
  ['Hatta Mountain Resorts', 'Chatbot pilot', ['S-101'], 12000, 'One-off', 60, -5],
  ['Sahara Rent A Car', 'CRM automation setup', ['S-201'], 35000, 'One-off', 8, 357],
  ['Sahara Rent A Car', 'Support & maintenance retainer', ['S-701'], 4500, 'Monthly', 8, 22, true],
  ['Khaleej Consulting Partners', 'OCR & dashboards programme', ['S-301', 'S-401'], 72000, 'One-off', 17, 348],
  ['Khaleej Consulting Partners', 'Dashboard hosting & data refresh', ['S-401'], 18000, 'Annual', 17, 348],
  ['Pearl Accounting Firm', 'Invoice OCR & extraction', ['S-301'], 42000, 'One-off', 14, 16],
]

/** Crest Logistics (second tenant), SAR. Ids in their own block (CON-5001+) so they never collide. */
const CREST_SEED: Seed[] = [
  ['Jeddah Port Traders', 'Import freight forwarding & customs clearance', ['S-901', 'S-903'], 18500, 'Monthly', 40, 325],
  ['Riyadh Gate Supermarkets', 'Contract warehousing, Riyadh DC', ['S-902'], 240000, 'Annual', 25, 20],
]

/** First id of the Crest seed block; new contracts continue the global CON-1001… sequence. */
export const CREST_SEED_CONTRACT_BASE = 5001

const NOW = new Date()

function build(seed: Seed[], companyId: string, base: number): Tenant<Contract>[] {
  return seed.flatMap(([name, title, serviceIds, value, billing, startDaysAgo, renewInDays, cancelled], i) => {
    const customer = customers.find((c) => c.companyId === companyId && c.name === name)
    if (!customer) return []
    return [
      {
        companyId,
        id: `CON-${base + i}`,
        customerId: customer.id,
        title,
        serviceIds,
        value,
        billing,
        startDate: subDays(NOW, startDaysAgo).toISOString(),
        renewalDate: addDays(NOW, renewInDays).toISOString(),
        status: cancelled ? 'cancelled' : 'active',
        ownerId: customer.ownerId,
      },
    ]
  })
}

export const contracts: Tenant<Contract>[] = registerArray('contracts', [
  ...build(SEED, 'co_apex', 1001),
  ...build(CREST_SEED, 'co_crest', CREST_SEED_CONTRACT_BASE),
])
