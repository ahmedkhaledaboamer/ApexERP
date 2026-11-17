import type { QuotationItem, QuotationRecord, QuotationStatus } from '@/modules/quotations/types'
import { DEFAULT_VAT_PCT, UNIT_FOR_PRICING, addDaysIso } from '@/modules/quotations/lib/totals'
import { DEFAULT_NOTES, DEFAULT_TERMS } from '@/modules/quotations/lib/company'
import { leads } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'

/**
 * Seed quotations (mock) for leads in Meeting, Proposal and Won, built from the service
 * catalog. Dates are relative to load time so "expiring soon" and "this month" have data.
 */

type Line = [serviceId: string, quantity: number, discountPct?: number]

interface Seed {
  leadId: string
  status: QuotationStatus
  title: string
  lines: Line[]
  createdDaysAgo: number
  /** Days from today; negative is in the past. */
  validInDays: number
  sentDaysAgo?: number
  decidedDaysAgo?: number
  /** Author when not the lead owner. */
  createdBy?: string
}

const SEEDS: Seed[] = [
  { leadId: 'L-1021', status: 'Accepted', title: 'Fleet booking CRM automation', lines: [['S-201', 1], ['S-401', 1, 10]], createdDaysAgo: 170, sentDaysAgo: 168, decidedDaysAgo: 160, validInDays: -138 },
  { leadId: 'L-1017', status: 'Accepted', title: 'Guest chatbot and PMS integration', lines: [['S-101', 1], ['S-501', 40], ['S-102', 12]], createdDaysAgo: 140, sentDaysAgo: 138, decidedDaysAgo: 128, validInDays: -108 },
  { leadId: 'L-1030', status: 'Accepted', title: 'Client document OCR', lines: [['S-301', 1, 5]], createdDaysAgo: 48, sentDaysAgo: 46, decidedDaysAgo: 40, validInDays: -16 },
  { leadId: 'L-1004', status: 'Rejected', title: 'Group-wide guest experience platform', lines: [['S-101', 1], ['S-601', 1], ['S-701', 12], ['S-501', 120]], createdDaysAgo: 62, sentDaysAgo: 60, decidedDaysAgo: 55, validInDays: -30 },
  { leadId: 'L-1004', status: 'Accepted', title: 'Guest chatbot, phase one', lines: [['S-101', 1, 10], ['S-102', 12], ['S-501', 60]], createdDaysAgo: 54, sentDaysAgo: 53, decidedDaysAgo: 47, validInDays: -23 },
  { leadId: 'L-1025', status: 'Accepted', title: 'Advisory CRM automation and reporting', lines: [['S-201', 1], ['S-401', 1, 15], ['S-102', 6]], createdDaysAgo: 30, sentDaysAgo: 28, decidedDaysAgo: 10, validInDays: 2 },
  { leadId: 'L-1012', status: 'Accepted', title: 'Retail dashboards and storefront refresh', lines: [['S-401', 1], ['S-601', 1, 10]], createdDaysAgo: 20, sentDaysAgo: 18, decidedDaysAgo: 4, validInDays: 12 },
  { leadId: 'L-1003', status: 'Viewed', title: 'Brokerage CRM automation', lines: [['S-201', 1], ['S-401', 1, 10], ['S-501', 24]], createdDaysAgo: 8, sentDaysAgo: 6, validInDays: 24 },
  { leadId: 'L-1011', status: 'Sent', title: 'Site document OCR and project dashboards', lines: [['S-301', 1], ['S-401', 1, 5], ['S-701', 12]], createdDaysAgo: 28, sentDaysAgo: 26, validInDays: 4 },
  { leadId: 'L-1022', status: 'Sent', title: 'Patient booking chatbot', lines: [['S-101', 1], ['S-102', 12]], createdDaysAgo: 42, sentDaysAgo: 40, validInDays: -10 },
  { leadId: 'L-1022', status: 'Viewed', title: 'Patient booking chatbot and CRM follow-ups', lines: [['S-101', 1, 10], ['S-102', 12], ['S-201', 1, 10]], createdDaysAgo: 4, sentDaysAgo: 3, validInDays: 27 },
  { leadId: 'L-1028', status: 'Sent', title: 'Admissions chatbot and partner portal', lines: [['S-101', 1], ['S-601', 1], ['S-102', 12]], createdDaysAgo: 30, sentDaysAgo: 28, validInDays: 2 },
  { leadId: 'L-1002', status: 'Draft', title: 'Dental appointment chatbot', lines: [['S-101', 1], ['S-102', 12, 10]], createdDaysAgo: 1, validInDays: 29 },
  { leadId: 'L-1015', status: 'Draft', title: 'Case-file OCR', lines: [['S-301', 1], ['S-501', 16]], createdDaysAgo: 3, validInDays: 27 },
  { leadId: 'L-1026', status: 'Draft', title: 'Sales CRM and off-plan dashboards', lines: [['S-201', 1], ['S-401', 1], ['S-501', 30]], createdDaysAgo: 2, validInDays: 28, createdBy: 'u3' },
  // Old quotation with a since-deactivated service (S-801): its line is kept and shows "(inactive)".
  { leadId: 'L-1012', status: 'Rejected', title: 'Store SMS reminders', lines: [['S-801', 1], ['S-701', 6]], createdDaysAgo: 200, sentDaysAgo: 199, decidedDaysAgo: 190, validInDays: -170 },
]

const DAY = 86_400_000
const NOW = Date.now()
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function itemsFor(lines: Line[], key: string): QuotationItem[] {
  return lines.map(([serviceId, quantity, discountPct = 0], i) => {
    const service = services.find((s) => s.id === serviceId)
    return {
      id: `${key}-${i + 1}`,
      serviceId,
      description: service?.name ?? 'Service',
      quantity,
      unit: service ? UNIT_FOR_PRICING[service.pricingType] : 'project',
      unitPrice: service?.price ?? 0,
      discountPct,
      currency: service?.currency ?? 'AED',
    }
  })
}

export const quotations: QuotationRecord[] = SEEDS.map((s, i) => {
  const lead = leads.find((l) => l.id === s.leadId)
  const id = `Q-${String(1001 + i)}`
  const createdAt = ago(s.createdDaysAgo)
  return {
    id,
    number: `QT-${new Date(createdAt).getFullYear()}-${String(i + 1).padStart(4, '0')}`,
    leadId: s.leadId,
    customerId: lead?.customerId ?? null,
    company: lead?.company ?? '',
    contactName: lead?.contactName ?? '',
    contactEmail: lead?.contactEmail ?? '',
    title: s.title,
    status: s.status,
    items: itemsFor(s.lines, id),
    vatPct: DEFAULT_VAT_PCT,
    currency: 'AED',

    notes: DEFAULT_NOTES,
    terms: DEFAULT_TERMS,
    validUntil: addDaysIso(s.validInDays),
    createdBy: s.createdBy ?? lead?.ownerId ?? 'u3',
    createdAt,
    updatedAt: s.sentDaysAgo !== undefined ? ago(s.sentDaysAgo) : createdAt,
    sentAt: s.sentDaysAgo !== undefined ? ago(s.sentDaysAgo) : null,
    decidedAt: s.decidedDaysAgo !== undefined ? ago(s.decidedDaysAgo) : null,
  }
})
