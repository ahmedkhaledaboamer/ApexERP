import { subDays } from 'date-fns'
import type { PricingType, ProjectTemplate, Service, ServicePackage, TemplateTask } from '@/modules/services/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Synthetic service catalog, packages and project templates (mock only), per company.
 * Apex Aora: IDs S-101…S-801 are referenced by seeded quotations and contracts; keep them.
 * Crest Logistics: S-901…S-905 (SAR). Ids are globally unique; codes and names are unique per company.
 */

const APEX = 'co_apex'
const CREST = 'co_crest'

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

const CREST_SEED: Seed[] = [
  ['S-901', 'Freight Forwarding', 'Freight', 'Fixed', 8500, 7, ['Logistics', 'Retail & FMCG', 'Manufacturing', 'Oil & Gas Services'], 'Door-to-door sea, air and land freight across the GCC, with booking, documentation and tracking.'],
  ['S-902', 'Contract Warehousing', 'Warehousing', 'Monthly', 18000, 0, ['Retail & FMCG', 'Healthcare', 'Manufacturing'], 'Dedicated pallet positions in Riyadh and Dammam with WMS access, pick-and-pack and monthly stock counts.'],
  ['S-903', 'Customs Clearance', 'Customs Clearance', 'Fixed', 2200, 3, ['Logistics', 'Manufacturing', 'Retail & FMCG', 'Construction'], 'Import and export clearance through FASAH, including HS classification and SABER certificates.'],
  ['S-904', 'Fleet Tracking', 'Fleet & Tracking', 'Monthly', 4500, 10, ['Logistics', 'Construction', 'Oil & Gas Services'], 'GPS tracking, driver behaviour and temperature alerts for client fleets, with a live dispatch dashboard.'],
  ['S-905', 'Supply Chain Assessment', 'Supply Chain Consulting', 'Fixed', 35000, 20, ['Manufacturing', 'Retail & FMCG', 'Healthcare'], 'Review of network, inventory and transport costs with a prioritised savings plan.'],
]

const toService = (companyId: string, currency: string, daysBack: number) =>
  ([id, name, category, pricingType, price, deliveryDays, industries, description, active = true]: Seed, i: number): Tenant<Service> => ({
    id,
    companyId,
    name,
    category,
    description,
    industries,
    pricingType,
    price,
    currency,
    deliveryDays,
    active,
    createdAt: at(daysBack - i * 20),
    updatedAt: at(60 - i * 3),
  })

export const services: Tenant<Service>[] = [...SEED.map(toService(APEX, 'AED', 400)), ...CREST_SEED.map(toService(CREST, 'SAR', 380))]

export const packages: Tenant<ServicePackage>[] = [
  {
    id: 'PK-1',
    companyId: APEX,
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
    companyId: APEX,
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
    companyId: APEX,
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
  {
    id: 'PK-4',
    companyId: CREST,
    name: 'Import starter bundle',
    description: 'Freight forwarding and customs clearance for a first shipment, plus three months of warehousing.',
    items: [
      { serviceId: 'S-901', quantity: 1 },
      { serviceId: 'S-903', quantity: 1 },
      { serviceId: 'S-902', quantity: 3 },
    ],
    packagePrice: 59000,
    currency: 'SAR',
    active: true,
    createdAt: at(80),
    updatedAt: at(12),
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

/**
 * Crest delivery runs through Operations (c2-ops): "Project manager" tasks belong to the Head of
 * Operations (u106), "Solutions consultant" tasks to the Operations Coordinator (u107).
 */
const CREST_TEMPLATE_SEED: Record<string, T[]> = {
  'S-901': [
    ['Shipment booking & carrier selection', 'Project manager', 0, 4],
    ['Collect commercial invoice & packing list', 'Solutions consultant', 1, 3],
    ['Arrange pickup and export documents', 'Solutions consultant', 2, 4],
    ['Track transit and update the customer', 'Solutions consultant', 4, 3],
    ['Delivery confirmation & POD', 'Project manager', 7, 2],
  ],
  'S-902': [
    ['Onboarding call & SKU list', 'Project manager', 0, 3],
    ['Set up client in WMS', 'Solutions consultant', 1, 6],
    ['Allocate pallet positions', 'Solutions consultant', 2, 4],
    ['First inbound receipt', 'Solutions consultant', 4, 6],
  ],
  'S-903': [
    ['Review documents & HS codes', 'Solutions consultant', 0, 3],
    ['Submit declaration on FASAH', 'Solutions consultant', 1, 2],
    ['Inspection & release follow-up', 'Project manager', 2, 3],
  ],
  'S-904': [
    ['Fleet survey & device plan', 'Project manager', 0, 4],
    ['Install trackers', 'Solutions consultant', 3, 16],
    ['Configure alerts & dashboard', 'Solutions consultant', 7, 6],
    ['Dispatcher training', 'Trainer', 9, 4],
  ],
  'S-905': [
    ['Kick-off & data request', 'Project manager', 0, 6],
    ['Network & cost analysis', 'Solutions consultant', 3, 30],
    ['Site visits', 'Solutions consultant', 8, 16],
    ['Savings plan & presentation', 'Project manager', 16, 10],
  ],
}

const toTemplates = (companyId: string, updatedBy: string, seed: Record<string, T[]>): Tenant<ProjectTemplate>[] =>
  Object.entries(seed).map(([serviceId, tasks]) => ({
    serviceId,
    companyId,
    tasks: tasks.map(([title, role, dayOffset, hours], i) => ({ id: `${serviceId}-T${i + 1}`, title, role, dayOffset, hours })),
    updatedAt: at(40),
    updatedBy,
  }))

export const projectTemplates: Tenant<ProjectTemplate>[] = [
  ...toTemplates(APEX, 'Omar Haddad', TEMPLATE_SEED),
  ...toTemplates(CREST, 'Sultan Al Ghamdi', CREST_TEMPLATE_SEED),
]

registerArray('services', services)
registerArray('packages', packages)
registerArray('projectTemplates', projectTemplates)

/** One company's catalog (services are looked up by globally unique id elsewhere). */
export function servicesOf(companyId: string): Tenant<Service>[] {
  return services.filter((s) => s.companyId === companyId)
}

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
