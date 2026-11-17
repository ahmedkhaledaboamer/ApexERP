import { subDays } from 'date-fns'
import type { PricingType, ProjectTemplate, Service, ServicePackage, TemplateTask } from '@/modules/services/types'

/**
 * Synthetic service catalog, packages and project templates (mock only).
 * IDs S-101…S-701 are referenced by seeded quotations and contracts; keep them.
 */

const at = (daysAgo: number) => subDays(new Date(), daysAgo).toISOString()

type Seed = [id: string, name: string, category: string, pricing: PricingType, price: number, days: number, industries: string[], description: string, active?: boolean]

const SEED: Seed[] = [
  ['S-101', 'AI customer-service chatbot (WhatsApp + web)', 'Chatbot', 'Fixed', 28000, 20, ['Healthcare', 'Hospitality', 'Education', 'Retail', 'Automotive'], 'Bilingual chatbot that answers FAQs, books appointments and hands over to staff.'],
  ['S-102', 'Chatbot hosting & tuning', 'Chatbot', 'Monthly', 2500, 0, ['Healthcare', 'Hospitality', 'Education', 'Retail', 'Automotive'], 'Monthly hosting, monitoring and answer tuning for a deployed chatbot.'],
  ['S-103', 'Voice assistant for call centres', 'Chatbot', 'Fixed', 46000, 35, ['Financial Services', 'Healthcare', 'Automotive'], 'Arabic/English voice bot for inbound calls with live-agent transfer.'],
  ['S-201', 'CRM automation setup', 'CRM Automation', 'Fixed', 35000, 25, ['Real Estate', 'Automotive', 'Healthcare', 'Education', 'Professional Services'], 'Lead capture, assignment rules, follow-up sequences and reporting in the client CRM.'],
  ['S-202', 'CRM data migration & clean-up', 'CRM Automation', 'Fixed', 12000, 10, ['Real Estate', 'Professional Services', 'Retail'], 'Moves contacts and deals from spreadsheets or a legacy CRM, de-duplicated and validated.'],
  ['S-301', 'Document OCR & data extraction', 'OCR', 'Fixed', 42000, 30, ['Logistics', 'Financial Services', 'Construction', 'Professional Services', 'Healthcare'], 'Extracts data from invoices, IDs and forms into the client systems.'],
  ['S-302', 'Emirates ID & passport scanning', 'OCR', 'Monthly', 1800, 0, ['Financial Services', 'Hospitality', 'Real Estate'], 'Hosted ID-scanning API with per-month volume and compliance logging.'],
  ['S-401', 'Executive BI dashboards', 'Dashboards', 'Fixed', 30000, 21, ['Retail', 'Real Estate', 'Logistics', 'Construction', 'Financial Services'], 'Live dashboards for sales, operations and finance, connected to existing data.'],
  ['S-402', 'Dashboard support & new reports', 'Dashboards', 'Hourly', 300, 0, ['Retail', 'Logistics', 'Financial Services'], 'On-demand report changes and new KPIs on existing dashboards.'],
  ['S-501', 'System integration (ERP / POS / PMS)', 'System Integration', 'Hourly', 350, 15, ['Hospitality', 'Logistics', 'Financial Services', 'Construction'], 'Connects the client’s systems with APIs and scheduled syncs.'],
  ['S-601', 'Website & booking app', 'Website & Apps', 'Fixed', 24000, 25, ['Hospitality', 'Education', 'Retail', 'Healthcare'], 'Fast bilingual website with online booking and CMS.'],
  ['S-701', 'Support & maintenance retainer', 'System Integration', 'Monthly', 4500, 0, [], 'Monthly support hours, updates and priority fixes.'],
  ['S-801', 'Legacy SMS gateway setup', 'System Integration', 'Fixed', 6000, 5, ['Retail'], 'Retired offering kept for old quotations.', false],
]

export const services: Service[] = SEED.map(([id, name, category, pricingType, price, deliveryDays, industries, description, active = true], i) => ({
  id,
  name,
  category,
  description,
  industries,
  pricingType,
  price,
  currency: 'AED',
  deliveryDays,
  active,
  createdAt: at(400 - i * 20),
  updatedAt: at(60 - i * 3),
}))

export const packages: ServicePackage[] = [
  {
    id: 'PK-1',
    name: 'Clinic growth bundle',
    description: 'Chatbot for bookings, CRM automation for follow-ups, and the first year of hosting.',
    items: [
      { serviceId: 'S-101', quantity: 1 },
      { serviceId: 'S-201', quantity: 1 },
      { serviceId: 'S-102', quantity: 12 },
    ],
    packagePrice: 79000,
    currency: 'AED',
    active: true,
    createdAt: at(120),
    updatedAt: at(14),
  },
  {
    id: 'PK-2',
    name: 'Back-office automation',
    description: 'OCR for incoming documents plus executive dashboards on the extracted data.',
    items: [
      { serviceId: 'S-301', quantity: 1 },
      { serviceId: 'S-401', quantity: 1 },
    ],
    packagePrice: 64000,
    currency: 'AED',
    active: true,
    createdAt: at(90),
    updatedAt: at(30),
  },
  {
    id: 'PK-3',
    name: 'Starter web presence',
    description: 'Website with booking and six months of support.',
    items: [
      { serviceId: 'S-601', quantity: 1 },
      { serviceId: 'S-701', quantity: 6 },
    ],
    packagePrice: 45000,
    currency: 'AED',
    active: false,
    createdAt: at(200),
    updatedAt: at(45),
  },
]

type T = [title: string, role: TemplateTask['role'], dayOffset: number, hours: number]

const TEMPLATE_SEED: Record<string, T[]> = {
  'S-101': [
    ['Kick-off & requirements workshop', 'Project manager', 0, 6],
    ['Collect FAQs and booking rules', 'Solutions consultant', 1, 10],
    ['Design conversation flows (AR/EN)', 'AI engineer', 3, 16],
    ['WhatsApp Business & web widget setup', 'Developer', 5, 12],
    ['Booking system integration', 'Developer', 7, 20],
    ['UAT with client team', 'QA', 13, 10],
    ['Staff training & handover', 'Trainer', 16, 6],
    ['Go-live & hypercare', 'Project manager', 18, 8],
  ],
  'S-103': [
    ['Discovery & call-flow mapping', 'Solutions consultant', 0, 12],
    ['Voice persona and scripts', 'AI engineer', 4, 18],
    ['Telephony integration', 'Developer', 8, 28],
    ['Load and accent testing', 'QA', 20, 16],
    ['Go-live & monitoring', 'Project manager', 30, 10],
  ],
  'S-201': [
    ['Process mapping workshop', 'Solutions consultant', 0, 8],
    ['Pipeline & field design', 'Solutions consultant', 2, 12],
    ['Lead capture forms & routing', 'Developer', 5, 16],
    ['Follow-up sequences & templates', 'Developer', 9, 14],
    ['Reports & dashboards', 'Data analyst', 14, 10],
    ['Training & handover', 'Trainer', 20, 6],
  ],
  'S-202': [
    ['Source data audit', 'Data analyst', 0, 6],
    ['Mapping & de-duplication rules', 'Data analyst', 2, 8],
    ['Test import & sign-off', 'QA', 5, 6],
    ['Final migration', 'Developer', 8, 6],
  ],
  'S-301': [
    ['Document inventory & samples', 'Solutions consultant', 0, 8],
    ['Extraction model setup', 'AI engineer', 4, 24],
    ['Validation rules & review queue', 'Developer', 12, 18],
    ['ERP export integration', 'Developer', 18, 16],
    ['Accuracy testing', 'QA', 24, 12],
    ['Go-live & training', 'Trainer', 28, 6],
  ],
  'S-401': [
    ['KPI workshop', 'Solutions consultant', 0, 6],
    ['Data source connections', 'Data analyst', 2, 14],
    ['Data model & measures', 'Data analyst', 6, 16],
    ['Dashboard design', 'Designer', 10, 12],
    ['Review & refinements', 'QA', 15, 8],
    ['Rollout & training', 'Trainer', 19, 4],
  ],
  'S-601': [
    ['Sitemap & content plan', 'Designer', 0, 8],
    ['UI design (AR/EN)', 'Designer', 3, 20],
    ['Build & CMS setup', 'Developer', 9, 32],
    ['Booking flow', 'Developer', 15, 14],
    ['QA & launch', 'QA', 22, 8],
  ],
}

export const projectTemplates: ProjectTemplate[] = Object.entries(TEMPLATE_SEED).map(([serviceId, tasks]) => ({
  serviceId,
  tasks: tasks.map(([title, role, dayOffset, hours], i) => ({ id: `${serviceId}-T${i + 1}`, title, role, dayOffset, hours })),
  updatedAt: at(40),
  updatedBy: 'Omar Haddad',
}))

/**
 * Selector for the Won → project flow (next step): the stored delivery template for a service.
 * Services without one get an empty template.
 */
export function projectTemplateFor(serviceId: string): ProjectTemplate {
  return projectTemplates.find((t) => t.serviceId === serviceId) ?? { serviceId, tasks: [], updatedAt: null, updatedBy: null }
}

/** Catalog price × quantity sum for a package's items (today's prices). */
export function packageListPrice(items: { serviceId: string; quantity: number }[]): number {
  return items.reduce((s, it) => s + (services.find((x) => x.id === it.serviceId)?.price ?? 0) * it.quantity, 0)
}
