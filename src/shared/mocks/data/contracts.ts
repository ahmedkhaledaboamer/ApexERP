import { addDays, subDays } from 'date-fns'
import type { Contract, ContractBilling } from '@/modules/crm/types'
import { customers } from '@/shared/mocks/db'

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

const NOW = new Date()

export const contracts: Contract[] = SEED.flatMap(([name, title, serviceIds, value, billing, startDaysAgo, renewInDays, cancelled], i) => {
  const customer = customers.find((c) => c.name === name)
  if (!customer) return []
  return [
    {
      id: `CON-${1001 + i}`,
      customerId: customer.id,
      title,
      serviceIds,
      value,
      billing,
      startDate: subDays(NOW, startDaysAgo).toISOString(),
      renewalDate: addDays(NOW, renewInDays).toISOString(),
      status: cancelled ? 'Cancelled' : 'Active',
      ownerId: customer.ownerId,
    },
  ]
})
