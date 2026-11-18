import { addDays, subDays } from 'date-fns'
import type {
  Activity,
  ActivityType,
  Contact,
  Customer,
  Lead,
  LeadStatus,
  LeadTask,
  Note,
  ServiceCategory,
  SourceType,
  User,
} from '@/shared/types'
import { services as catalog } from '@/shared/mocks/data/services'
import { matchServiceText } from '@/modules/services/match'
import type { CountryCode } from '@/modules/tenancy/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'
import { toFollowUpDate } from '@/shared/domain/followUp'

/**
 * In-memory data the service functions read from. Dates are relative to the moment the
 * module loads, so "due today" and "this month" always have something in them.
 */

export const users: User[] = [
  {
    id: 'u1', companyId: 'co_apex', name: 'Omar Haddad', email: 'omar@apexaora.ae', role: 'Company Admin', title: 'IT & Systems Lead', managerId: null,
    mobile: '+971 50 412 7781', departmentId: 'd-it', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 720).toISOString(),
  },
  {
    id: 'u2', companyId: 'co_apex', name: 'Layla Mansour', email: 'layla@apexaora.ae', role: 'Management', title: 'Managing Director', managerId: null,
    mobile: '+971 50 118 2204', departmentId: 'd-management', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 720).toISOString(),
  },
  {
    id: 'u3', companyId: 'co_apex', name: 'Karim Nasser', email: 'karim@apexaora.ae', role: 'Sales Manager', title: 'Head of Sales', managerId: 'u2',
    mobile: '+971 55 734 9012', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 1 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 610).toISOString(),
  },
  {
    id: 'u4', companyId: 'co_apex', name: 'Bincy Thomas', email: 'bincy@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 52 268 4410', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 420).toISOString(),
  },
  {
    id: 'u5', companyId: 'co_apex', name: 'Ahmed Al Falasi', email: 'ahmed@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 50 991 3307', departmentId: 'd-sales', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 390).toISOString(),
  },
  {
    id: 'u6', companyId: 'co_apex', name: 'Priya Raman', email: 'priya@apexaora.ae', role: 'Sales Agent', title: 'Business Development Rep', managerId: 'u3',
    mobile: '+971 56 402 7718', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 210).toISOString(),
  },
  {
    id: 'u7', companyId: 'co_apex', name: 'Sara Khoury', email: 'sara@apexaora.ae', role: 'Marketing Manager', title: 'Marketing Manager', managerId: 'u2',
    mobile: '+971 54 337 0925', departmentId: 'd-marketing', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 48 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 540).toISOString(),
  },
  {
    id: 'u8', companyId: 'co_apex', name: 'Rashid Iqbal', email: 'rashid@apexaora.ae', role: 'Accountant', title: 'Senior Accountant', managerId: 'u2',
    mobile: '+971 50 625 1183', departmentId: 'd-finance', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 480).toISOString(),
  },
  {
    id: 'u9', companyId: 'co_apex', name: 'Mariam Saeed', email: 'mariam@apexaora.ae', role: 'HR Manager', title: 'HR Manager', managerId: 'u2',
    mobile: '+971 58 214 6650', departmentId: 'd-hr', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 72 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 455).toISOString(),
  },
  {
    id: 'u10', companyId: 'co_apex', name: 'Daniel Ortiz', email: 'daniel@apexaora.ae', role: 'Department Head', title: 'Head of Delivery', managerId: 'u2',
    mobile: '+971 55 870 4436', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 9 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 330).toISOString(),
  },
  {
    id: 'u11', companyId: 'co_apex', name: 'Noura Al Ketbi', email: 'noura@apexaora.ae', role: 'Employee', title: 'Solutions Consultant', managerId: 'u10',
    mobile: '+971 56 155 2290', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 30 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 160).toISOString(),
  },
  {
    id: 'u12', companyId: 'co_apex', name: 'Hassan Qureshi', email: 'hassan@apexaora.ae', role: 'Sales Agent', title: 'Partner Sales Rep', managerId: 'u10',
    mobile: '+971 52 640 8871', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 52 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 140).toISOString(),
  },
  {
    id: 'u13', companyId: 'co_apex', name: 'Fatima Zahra', email: 'fatima@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 50 377 5164', departmentId: 'd-sales', active: false, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 64).toISOString(), createdAt: subDays(new Date(), 300).toISOString(),
  },
  // Delivery team (synthetic): project template roles resolve to these people in the Won flow.
  {
    id: 'u14', companyId: 'co_apex', name: 'Yusuf Rahman', email: 'yusuf@apexaora.ae', role: 'Employee', title: 'Developer', managerId: 'u10',
    mobile: '+971 55 210 4471', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 1).toISOString(), createdAt: subDays(new Date(), 260).toISOString(),
  },
  {
    id: 'u15', companyId: 'co_apex', name: 'Leena Joseph', email: 'leena@apexaora.ae', role: 'Employee', title: 'QA Engineer', managerId: 'u10',
    mobile: '+971 52 118 9034', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 2).toISOString(), createdAt: subDays(new Date(), 240).toISOString(),
  },
  {
    id: 'u16', companyId: 'co_apex', name: 'Omar Siddiqui', email: 'omar.s@apexaora.ae', role: 'Employee', title: 'AI Engineer', managerId: 'u10',
    mobile: '+971 50 663 2207', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 1).toISOString(), createdAt: subDays(new Date(), 200).toISOString(),
  },
  {
    id: 'u17', companyId: 'co_apex', name: 'Hind Al Mansoori', email: 'hind@apexaora.ae', role: 'Employee', title: 'UI Designer', managerId: 'u10',
    mobile: '+971 56 774 1902', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 4).toISOString(), createdAt: subDays(new Date(), 180).toISOString(),
  },

  // ---- Second tenant (synthetic): Crest Logistics, Riyadh. Ids u101+ so ids never collide across tenants.
  {
    id: 'u101', companyId: 'co_crest', name: 'Faisal Al Harbi', email: 'faisal@crestlogistics.sa', role: 'Company Admin', title: 'IT Manager', managerId: null,
    mobile: '+966 55 120 4471', departmentId: 'c2-it', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 4 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 400).toISOString(),
  },
  {
    id: 'u102', companyId: 'co_crest', name: 'Noura Al Qahtani', email: 'noura@crestlogistics.sa', role: 'Management', title: 'General Manager', managerId: null,
    mobile: '+966 50 338 9102', departmentId: 'c2-management', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 8 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 400).toISOString(),
  },
  {
    id: 'u103', companyId: 'co_crest', name: 'Majed Al Dossari', email: 'majed@crestlogistics.sa', role: 'Sales Manager', title: 'Sales Director', managerId: 'u102',
    mobile: '+966 54 771 2036', departmentId: 'c2-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 380).toISOString(),
  },
  {
    id: 'u104', companyId: 'co_crest', name: 'Reem Al Shammari', email: 'reem@crestlogistics.sa', role: 'Sales Agent', title: 'Account Manager', managerId: 'u103',
    mobile: '+966 56 402 1189', departmentId: 'c2-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 300).toISOString(),
  },
  {
    id: 'u105', companyId: 'co_crest', name: 'Tariq Al Mutairi', email: 'tariq@crestlogistics.sa', role: 'Sales Agent', title: 'Account Manager', managerId: 'u103',
    mobile: '+966 53 915 6620', departmentId: 'c2-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 30 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 260).toISOString(),
  },
  {
    id: 'u106', companyId: 'co_crest', name: 'Sultan Al Ghamdi', email: 'sultan@crestlogistics.sa', role: 'Department Head', title: 'Head of Operations', managerId: 'u102',
    mobile: '+966 55 604 3318', departmentId: 'c2-ops', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 12 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 350).toISOString(),
  },
  {
    id: 'u107', companyId: 'co_crest', name: 'Huda Al Zahrani', email: 'huda@crestlogistics.sa', role: 'Employee', title: 'Operations Coordinator', managerId: 'u106',
    mobile: '+966 59 227 8045', departmentId: 'c2-ops', active: true, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 1).toISOString(), createdAt: subDays(new Date(), 200).toISOString(),
  },
]

type Seed = [
  company: string,
  contact: string,
  domain: string,
  industry: string,
  subIndustry: string,
  source: SourceType,
  status: LeadStatus,
  ownerId: string,
  value: number,
  createdDaysAgo: number,
  followUpInDays: number | null,
  doNotContact?: boolean,
]

const SEED: Seed[] = [
  ['Al Noor Medical Centre', 'Dr. Fatima Al Hashimi', 'alnoormedical.ae', 'Healthcare', 'Clinics', 'Website', 'Interested', 'u4', 48000, 4, 0],
  ['Emirates Smile Dental', 'Rami Haddad', 'emiratessmile.ae', 'Healthcare', 'Clinics', 'LinkedIn', 'Meeting', 'u4', 36000, 12, 2],
  ['Gulf Horizon Properties', 'Khalid Al Mazrouei', 'gulfhorizon.ae', 'Real Estate', 'Brokerage', 'Referral', 'Proposal', 'u5', 125000, 21, 1],
  ['Desert Rose Hotels', 'Elena Petrova', 'desertrosehotels.com', 'Hospitality', 'Hotels', 'Event', 'Won', 'u5', 210000, 60, null],
  ['Marina Bay Logistics', 'Suresh Menon', 'marinabaylogistics.ae', 'Logistics', 'Freight', 'Directory', 'Contacted', 'u6', 54000, 3, 1],
  ['Sharjah Learning Academy', 'Huda Al Qasimi', 'sla.edu.ae', 'Education', 'Schools', 'Online Research', 'No response', 'u6', 28000, 9, -2],
  ['Falcon Auto Group', 'Tariq Siddiqui', 'falconauto.ae', 'Automotive', 'Dealerships', 'Cold Outreach', 'Call later', 'u12', 76000, 15, 5],
  ['Oasis Pharmacy Chain', 'Aisha Rahman', 'oasispharmacy.ae', 'Healthcare', 'Pharmacies', 'Website', 'New', 'u4', 42000, 1, 0],
  ['Al Fardan Exchange Partners', 'Mohammed Al Fardan', 'alfardanpartners.ae', 'Financial Services', 'Exchange Houses', 'Referral', 'Interested', 'u5', 98000, 18, -1],
  ['Blue Wave Restaurants', 'Chef Marco Rossi', 'bluewavegroup.ae', 'Hospitality', 'Restaurants', 'LinkedIn', 'Lost', 'u6', 22000, 75, null],
  ['Abu Dhabi Build Contracting', 'Saeed Al Nuaimi', 'adbuild.ae', 'Construction', 'Contracting', 'Event', 'Proposal', 'u12', 160000, 30, 3],
  ['Palm Retail Group', 'Nadia Farouk', 'palmretail.ae', 'Retail', 'Fashion', 'Website', 'Won', 'u4', 88000, 95, null],
  ['Crescent Diagnostics', 'Dr. Imran Shah', 'crescentdx.ae', 'Healthcare', 'Diagnostics', 'Online Research', 'Contacted', 'u4', 64000, 6, 0],
  ['Ajman Freight Hub', 'Vikram Patel', 'ajmanfreight.ae', 'Logistics', 'Warehousing', 'Directory', 'Not interested', 'u5', 30000, 110, null],
  ['Jumeirah Legal Associates', 'Sophie Laurent', 'jumeirahlegal.ae', 'Professional Services', 'Legal', 'Referral', 'Meeting', 'u6', 52000, 25, 4],
  ['Noon Electronics Trading', 'Faisal Al Shamsi', 'noonelectronics.ae', 'Retail', 'Electronics', 'Cold Outreach', 'New', 'u12', 45000, 0, 1],
  ['Hatta Mountain Resorts', 'Grace Mwangi', 'hattaresorts.ae', 'Hospitality', 'Hotels', 'Event', 'Won', 'u5', 145000, 130, null],
  ['Al Ain Insurance Brokers', 'Yousef Al Dhaheri', 'alaininsure.ae', 'Financial Services', 'Insurance', 'LinkedIn', 'No response', 'u4', 58000, 11, -3, true],
  ['Ras Al Khaimah Ceramics Trading', 'Omar Bakr', 'rakceramicstrading.ae', 'Construction', 'Interior Fit-out', 'Directory', 'Call later', 'u11', 39000, 20, 7],
  ['Dubai Knowledge Training', 'Leila Haddad', 'dktraining.ae', 'Education', 'Training Centers', 'Website', 'Interested', 'u6', 33000, 7, -1],
  ['Sahara Rent A Car', 'Ali Raza', 'saharacars.ae', 'Automotive', 'Rentals', 'Online Research', 'Won', 'u12', 67000, 160, null],
  ['Corniche Family Clinics', 'Dr. Hana Yousef', 'cornicheclinics.ae', 'Healthcare', 'Clinics', 'Referral', 'Proposal', 'u4', 72000, 35, 2],
  ['Meydan Property Management', 'James Whitfield', 'meydanpm.ae', 'Real Estate', 'Property Management', 'LinkedIn', 'Contacted', 'u5', 81000, 5, 0],
  ['Fujairah Fresh Grocers', 'Rashida Begum', 'fujairahfresh.ae', 'Retail', 'Grocery', 'Cold Outreach', 'Lost', 'u6', 19000, 140, null],
  ['Khaleej Consulting Partners', 'Nasser Al Kaabi', 'khaleejconsult.ae', 'Professional Services', 'Consulting', 'Event', 'Won', 'u4', 115000, 45, null],
  ['Emaar Lane Developers', 'Reem Al Suwaidi', 'emaarlane.ae', 'Real Estate', 'Developers', 'Referral', 'Meeting', 'u12', 190000, 14, 1],
  ['Swift Last Mile', 'Arjun Nair', 'swiftlastmile.ae', 'Logistics', 'Last Mile', 'Website', 'New', 'u6', 26000, 2, 2],
  ['Zayed University Partners Office', 'Dr. Salma Al Marri', 'zupartners.ae', 'Education', 'Universities', 'Directory', 'Proposal', 'u5', 99000, 40, -2],
  ['Mirdif MEP Services', 'George Haddad', 'mirdifmep.ae', 'Construction', 'MEP', 'Cold Outreach', 'Cold', 'u11', 41000, 16, null],
  ['Pearl Accounting Firm', 'Mona Al Zarooni', 'pearlaccounting.ae', 'Professional Services', 'Accounting Firms', 'LinkedIn', 'Won', 'u6', 54000, 100, null],
  // Parked after three unanswered attempts (No response → Cold).
  ['Al Quoz Courier Services', 'Bilal Chaudhry', 'alquozcourier.ae', 'Logistics', 'Last Mile', 'Directory', 'Cold', 'u4', 23000, 28, null],
]

const NOW = new Date()

/** A seeded follow-up `days` from now, as the company-local calendar date (yyyy-MM-dd) it falls on. */
const seedFollowUp = (days: number, timezone: string): string => toFollowUpDate(addDays(NOW, days).toISOString(), timezone) as string

/** Company ids of the seeded tenants (kept local: db.ts can't import data/tenancy, which imports users from here). */
const APEX = 'co_apex'
const CREST = 'co_crest'

function mobileFor(index: number): string {
  const n = String(1000000 + index * 73291).slice(-7)
  return `+971 5${index % 10} ${n.slice(0, 3)} ${n.slice(3)}`
}

function emailFor(contact: string, domain: string): string {
  const first = contact.replace(/^Dr\.\s|^Chef\s/, '').split(' ')[0].toLowerCase()
  return `${first}@${domain}`
}

const NEXT_STEPS: Partial<Record<LeadStatus, string>> = {
  Interested: 'Book a discovery call with the decision maker',
  Meeting: 'Demo the chatbot flow on their booking data',
  Proposal: 'Walk through the quotation and confirm the start date',
}

const SOURCE_DETAIL: Record<SourceType, string[]> = {
  Website: ['apexaorainnovations.com contact form', 'Pricing page chat'],
  Directory: ['Dubai Chamber directory', 'UAE Yellow Pages'],
  'Online Research': ['Google Maps search', 'Industry association list'],
  LinkedIn: ['LinkedIn Sales Navigator', 'LinkedIn post reply'],
  Referral: ['Referred by Desert Rose Hotels', 'Referred by Khaleej Consulting'],
  Event: ['GITEX Global 2026', 'Arab Health 2026'],
  'Cold Outreach': ['Q3 cold-call list', 'Outbound email sequence'],
}

/**
 * Migration of the old free-text "recommended service" (it used to hold a category name or a
 * short title typed by hand). Each value is matched to a catalog item with `matchServiceText`;
 * anything that can't be matched stays visible as `recommendedServiceText` ("unmatched").
 * A few seed leads carry hand-typed values to show both outcomes.
 */
const LEGACY_FREE_TEXT: Record<number, string> = {
  3: 'BI dashboards',
  8: 'Loyalty points app',
  14: 'document OCR',
  19: 'Arabic voice IVR upgrade',
}

/** Apex Aora's own catalog (the services store also holds other tenants' services). */
const apexCatalog = () => catalog.filter((s) => (s as { companyId?: string }).companyId !== CREST)

function firstServiceOf(category: ServiceCategory): string | null {
  return apexCatalog().find((s) => s.active && s.category === category)?.id ?? null
}

function migrateServices(categories: ServiceCategory[], i: number) {
  const serviceIds = categories
    .slice(0, (i % 3) + 1)
    .map(firstServiceOf)
    .filter((id): id is string => !!id)
  const legacy = LEGACY_FREE_TEXT[i] ?? categories[0]
  const match = matchServiceText(legacy, apexCatalog())
  return {
    serviceIds,
    recommendedServiceId: match?.id ?? null,
    recommendedServiceText: match ? null : legacy,
  }
}

const INDUSTRY_SERVICES: Record<string, ServiceCategory[]> = {
  Healthcare: ['Chatbot', 'CRM Automation', 'OCR'],
  'Real Estate': ['CRM Automation', 'Dashboards', 'Chatbot'],
  Hospitality: ['Chatbot', 'System Integration', 'Website & Apps'],
  Logistics: ['OCR', 'Dashboards', 'System Integration'],
  Education: ['Chatbot', 'Website & Apps', 'CRM Automation'],
  Automotive: ['CRM Automation', 'Chatbot', 'Dashboards'],
  'Financial Services': ['OCR', 'System Integration', 'Dashboards'],
  Retail: ['Dashboards', 'Website & Apps', 'Chatbot'],
  Construction: ['OCR', 'Dashboards', 'System Integration'],
  'Professional Services': ['OCR', 'CRM Automation', 'Dashboards'],
}

const COMPANY_SERVICES: Record<string, string[]> = {
  Healthcare: ['Outpatient care', 'Online booking', 'Lab tests'],
  'Real Estate': ['Off-plan sales', 'Leasing', 'Property management'],
  Hospitality: ['Rooms', 'Events & banquets', 'F&B'],
  Logistics: ['Freight forwarding', 'Customs clearance', 'Warehousing'],
  Education: ['K-12 programs', 'Admissions', 'Corporate training'],
  Automotive: ['New cars', 'Service centre', 'Rentals'],
  'Financial Services': ['Remittance', 'Insurance plans', 'FX'],
  Retail: ['E-commerce', 'Loyalty program', 'Stores'],
  Construction: ['Fit-out', 'MEP works', 'Contracting'],
  'Professional Services': ['Advisory', 'Audit', 'Corporate services'],
}

/** Rough interest by stage, plus a stable per-lead offset. */
const SCORE_BASE: Record<LeadStatus, number> = {
  New: 30, Contacted: 42, 'No response': 18, 'Call later': 35, Interested: 62, Meeting: 72, Proposal: 82, Cold: 10, Won: 95, Lost: 12, 'Not interested': 8,
}

const apexLeads: Tenant<Lead>[] = SEED.map(
  ([company, contact, domain, industry, subIndustry, source, status, ownerId, value, createdDaysAgo, followUpInDays, dnc], i) => ({
    companyId: APEX,
    id: `L-${String(1001 + i)}`,
    company,
    contactName: contact,
    contactEmail: emailFor(contact, domain),
    mobile: mobileFor(i),
    industry,
    subIndustry,
    sourceType: source,
    sourceDetail: SOURCE_DETAIL[source][i % 2],
    status,
    stageChangedAt: subDays(NOW, Math.min(createdDaysAgo, ((i * 7) % 19) + 1)).toISOString(),
    ownerId,
    value,
    // Company-local calendar date (Apex: Asia/Dubai).
    nextFollowUpDate: followUpInDays === null ? null : seedFollowUp(followUpInDays, 'Asia/Dubai'),
    createdAt: subDays(NOW, createdDaysAgo).toISOString(),
    doNotContact: dnc ?? false,
    nextStep: NEXT_STEPS[status] ?? '',
    lossReason: status === 'Lost' ? 'Chose a competitor' : status === 'Not interested' ? 'Timing — not a priority' : '',
    customerId: status === 'Won' ? `C-${String(1001 + i)}` : null,
    companyServices: COMPANY_SERVICES[industry] ?? [subIndustry],
    ...migrateServices(INDUSTRY_SERVICES[industry] ?? ['Chatbot'], i),
    score: Math.min(99, SCORE_BASE[status] + ((i * 37) % 17)),
  }),
)

/* ---------------- Crest Logistics (second tenant, fully synthetic Saudi companies) ---------------- */

/** Crest seed ids live in their own block (L-5001+, C-5xxx, CT-L-5xxx…) so they never collide with Apex. */
export const CREST_SEED_LEAD_BASE = 5001

type CrestSeed = [...Seed, lossReason?: string]

const CREST_SEED: CrestSeed[] = [
  ['Najd Cold Chain Co.', 'Abdullah Al Otaibi', 'najdcoldchain.sa', 'Logistics', 'Cold Chain', 'Website', 'New', 'u104', 85000, 1, 0],
  ['Red Sea Builders', 'Eng. Saad Al Ghamdi', 'redseabuilders.sa', 'Construction', 'Contracting', 'Tender Portal', 'Proposal', 'u103', 420000, 26, 2],
  ['Eastern Gulf Drilling Services', 'Khalid Al Shehri', 'egdrilling.sa', 'Oil & Gas Services', 'Upstream Services', 'Trade Show', 'Won', 'u105', 650000, 120, null],
  ['Al Waha Medical Supplies', 'Dr. Lama Al Harthi', 'alwahamedical.sa', 'Healthcare', 'Medical Supply', 'Referral', 'Interested', 'u104', 140000, 9, -1],
  ['Dammam Packaging Industries', 'Hisham Bakr', 'dammampack.sa', 'Manufacturing', 'Packaging', 'LinkedIn', 'Meeting', 'u105', 210000, 18, 3],
  ['Qassim Fresh Markets', 'Yazeed Al Rasheed', 'qassimfresh.sa', 'Retail & FMCG', 'Supermarkets', 'Cold Outreach', 'Contacted', 'u104', 95000, 4, 1],
  ['Jeddah Port Traders', 'Omar Al Jahdali', 'jeddahporttraders.sa', 'Logistics', 'Freight Forwarding', 'Website', 'Won', 'u104', 310000, 90, null],
  ['Salwa Infrastructure Partners', 'Faris Al Mutlaq', 'salwainfra.sa', 'Construction', 'Infrastructure', 'Tender Portal', 'Lost', 'u103', 520000, 140, null, false, 'Lost the tender'],
  ['Hijaz Hospital Group', 'Dr. Mansour Al Zahrani', 'hijazhospitals.sa', 'Healthcare', 'Hospitals', 'Trade Show', 'Proposal', 'u105', 260000, 33, 1],
  ['Tabuk Agro Processing', 'Nawaf Al Balawi', 'tabukagro.sa', 'Manufacturing', 'Food Processing', 'Referral', 'Won', 'u105', 180000, 150, null],
  ['Khobar Plastics Factory', 'Rakan Al Anazi', 'khobarplastics.sa', 'Manufacturing', 'Plastics', 'LinkedIn', 'No response', 'u104', 70000, 12, -2, true],
  ['Desert Line Distribution', 'Bandar Al Qahtani', 'desertlinedist.sa', 'Retail & FMCG', 'Distribution', 'Cold Outreach', 'Call later', 'u105', 120000, 15, 6],
  ['Jubail Equipment Rentals', 'Saleh Al Hajri', 'jubailrentals.sa', 'Oil & Gas Services', 'Equipment Rental', 'Website', 'Not interested', 'u104', 90000, 100, null, false, 'Project postponed'],
  ['Asir Last Mile Express', 'Mohammed Al Asiri', 'asirexpress.sa', 'Logistics', 'Last Mile', 'Website', 'Interested', 'u105', 60000, 7, 0],
  ['Al Kharj Warehousing Hub', 'Turki Al Subaie', 'kharjhub.sa', 'Logistics', 'Warehousing', 'Referral', 'Meeting', 'u103', 380000, 21, 2],
  ['Yanbu Downstream Services', 'Ali Al Juhani', 'yanbuds.sa', 'Oil & Gas Services', 'Downstream', 'Tender Portal', 'Contacted', 'u105', 230000, 5, 1],
  ['Madinah Care Hospital', 'Dr. Reem Al Harbi', 'madinahcare.sa', 'Healthcare', 'Hospitals', 'LinkedIn', 'Cold', 'u104', 150000, 40, null],
  ['Riyadh Gate Supermarkets', 'Waleed Al Shammari', 'riyadhgatemarkets.sa', 'Retail & FMCG', 'Supermarkets', 'Trade Show', 'Won', 'u102', 275000, 70, null],
  ['Sahm MEP Contracting', 'Ibrahim Al Malki', 'sahmmep.sa', 'Construction', 'MEP', 'Cold Outreach', 'Lost', 'u105', 110000, 120, null, false, 'Price too high'],
  ['Al Ahsa Dates Factory', 'Hamad Al Mulhim', 'ahsadates.sa', 'Manufacturing', 'Food Processing', 'Website', 'New', 'u104', 55000, 0, 1],
  ['Gulf Coast Freight Lines', 'Sami Al Ghamdi', 'gulfcoastfreight.sa', 'Logistics', 'Freight Forwarding', 'LinkedIn', 'Proposal', 'u105', 190000, 28, -1],
  ['Unaizah Building Materials', 'Fahad Al Muqbil', 'unaizahbm.sa', 'Construction', 'Contracting', 'Referral', 'New', 'u103', 75000, 2, 2],
]

/** Saudi mobiles, +966 5X XXX XXXX. */
function crestMobileFor(index: number): string {
  const n = String(2000000 + index * 61813).slice(-7)
  return `+966 5${(index * 3) % 10} ${n.slice(0, 3)} ${n.slice(3)}`
}

function crestEmailFor(contact: string, domain: string): string {
  const first = contact.replace(/^(Dr|Eng)\.\s/, '').split(' ')[0].toLowerCase()
  return `${first}@${domain}`
}

const CREST_NEXT_STEPS: Partial<Record<LeadStatus, string>> = {
  Interested: 'Survey their current warehouse and fleet set-up',
  Meeting: 'Present the logistics solution to the operations team',
  Proposal: 'Review the rate card and confirm the go-live date',
}

const CREST_SOURCE_DETAIL: Record<SourceType, string[]> = {
  Website: ['crestlogistics.sa quote request', 'Website live chat'],
  Referral: ['Referred by Jeddah Port Traders', 'Referred by an existing shipper'],
  'Tender Portal': ['Government tender portal', 'Private procurement portal'],
  LinkedIn: ['LinkedIn Sales Navigator', 'LinkedIn post reply'],
  'Trade Show': ['Saudi Logistics Expo 2026', 'Riyadh Supply Chain Forum 2026'],
  'Cold Outreach': ['Q3 cold-call list', 'Outbound email sequence'],
}

/** Crest catalog services (seeded by data/services.ts): S-901 Freight Forwarding … S-905 Supply Chain Assessment. */
const CREST_INDUSTRY_SERVICES: Record<string, string[]> = {
  Logistics: ['S-901', 'S-902', 'S-904'],
  Construction: ['S-901', 'S-903', 'S-904'],
  'Oil & Gas Services': ['S-903', 'S-901', 'S-902'],
  Healthcare: ['S-902', 'S-904', 'S-905'],
  'Retail & FMCG': ['S-902', 'S-904', 'S-905'],
  Manufacturing: ['S-903', 'S-902', 'S-905'],
}

const CREST_COMPANY_SERVICES: Record<string, string[]> = {
  Logistics: ['Freight', 'Cold storage', 'Distribution'],
  Construction: ['Civil works', 'Contracting', 'MEP'],
  'Oil & Gas Services': ['Drilling support', 'Equipment rental', 'Field services'],
  Healthcare: ['Inpatient care', 'Medical supplies', 'Pharmacy'],
  'Retail & FMCG': ['Supermarkets', 'Wholesale', 'Home delivery'],
  Manufacturing: ['Production', 'Packaging', 'Exports'],
}

const crestLeads: Tenant<Lead>[] = CREST_SEED.map(
  ([company, contact, domain, industry, subIndustry, source, status, ownerId, value, createdDaysAgo, followUpInDays, dnc, lossReason], i) => {
    const serviceIds = (CREST_INDUSTRY_SERVICES[industry] ?? []).slice(0, (i % 3) + 1)
    return {
      companyId: CREST,
      id: `L-${CREST_SEED_LEAD_BASE + i}`,
      company,
      contactName: contact,
      contactEmail: crestEmailFor(contact, domain),
      mobile: crestMobileFor(i),
      industry,
      subIndustry,
      sourceType: source,
      sourceDetail: CREST_SOURCE_DETAIL[source]?.[i % 2] ?? '',
      status,
      stageChangedAt: subDays(NOW, Math.min(createdDaysAgo, ((i * 5) % 17) + 1)).toISOString(),
      ownerId,
      value,
      // Company-local calendar date (Crest: Asia/Riyadh).
      nextFollowUpDate: followUpInDays === null ? null : seedFollowUp(followUpInDays, 'Asia/Riyadh'),
      createdAt: subDays(NOW, createdDaysAgo).toISOString(),
      doNotContact: dnc ?? false,
      nextStep: CREST_NEXT_STEPS[status] ?? '',
      lossReason: lossReason ?? '',
      customerId: status === 'Won' ? `C-${CREST_SEED_LEAD_BASE + i}` : null,
      companyServices: CREST_COMPANY_SERVICES[industry] ?? [subIndustry],
      serviceIds,
      recommendedServiceId: serviceIds[0] ?? null,
      recommendedServiceText: null,
      score: Math.min(99, SCORE_BASE[status] + ((i * 29) % 17)),
    }
  },
)

export const leads: Tenant<Lead>[] = [...apexLeads, ...crestLeads]

/* ---------------- Customers (CRM) ---------------- */

const FREE_MAIL = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com']

/** The company site, read from the lead's email domain (free-mail domains don't count). */
function websiteFromLead(lead: Lead): string {
  const domain = lead.contactEmail.split('@')[1]?.toLowerCase().trim()
  return domain && !FREE_MAIL.includes(domain) ? `https://${domain}` : ''
}

/** Best guess at the emirate from the company name; Dubai otherwise. */
function emirateFromLead(lead: Lead): Customer['emirate'] {
  const n = lead.company.toLowerCase()
  if (n.includes('abu dhabi') || n.includes('al ain') || n.includes('zayed')) return 'Abu Dhabi'
  if (n.includes('sharjah')) return 'Sharjah'
  if (n.includes('ajman')) return 'Ajman'
  if (n.includes('ras al khaimah') || n.includes('rak ')) return 'Ras Al Khaimah'
  if (n.includes('fujairah')) return 'Fujairah'
  if (n.includes('umm al quwain')) return 'Umm Al Quwain'
  return 'Dubai'
}

/**
 * Builds a customer from a Won lead, carrying its data over so nobody retypes it. The customer
 * belongs to the lead's company. `country` is the company's regional country: the emirate is only
 * guessed for UAE companies (callers pass `companyById(lead.companyId).regional.country`).
 */
export function customerFromLead(
  lead: Tenant<Lead>,
  opts: { id: string; wonAt: string; address?: string; status?: Customer['status']; country?: CountryCode },
): Tenant<Customer> {
  return {
    companyId: lead.companyId,
    id: opts.id,
    name: lead.company,
    industry: lead.industry,
    subIndustry: lead.subIndustry,
    leadId: lead.id,
    ownerId: lead.ownerId,
    createdAt: opts.wonAt,
    website: websiteFromLead(lead),
    address: opts.address ?? '',
    emirate: (opts.country ?? 'AE') === 'AE' ? emirateFromLead(lead) : '',
    status: opts.status ?? 'active',
    wonValue: lead.value,
    wonAt: opts.wonAt,
    sourceType: lead.sourceType,
    serviceIds: [...lead.serviceIds],
    companyServices: [...lead.companyServices],
  }
}

const SEED_ADDRESSES: Record<string, string> = {
  'Desert Rose Hotels': 'Sheikh Zayed Road, Trade Centre 1',
  'Palm Retail Group': 'Building 4, Al Quoz Industrial 3',
  'Hatta Mountain Resorts': 'Hatta–Oman Road, Hatta',
  'Sahara Rent A Car': 'Office 214, Al Garhoud Business Centre',
  'Khaleej Consulting Partners': 'Level 12, Gate Village 5, DIFC',
  'Pearl Accounting Firm': 'Office 905, Business Bay Executive Tower B',
  // Crest Logistics customers
  'Eastern Gulf Drilling Services': 'King Saud Street, 2nd Industrial City, Dammam',
  'Jeddah Port Traders': 'Office 310, Al Andalus District, Jeddah',
  'Tabuk Agro Processing': 'Industrial Area, Tabuk',
  'Riyadh Gate Supermarkets': 'King Fahd Road, Al Olaya, Riyadh',
}

export const customers: Tenant<Customer>[] = [
  ...apexLeads
    .filter((l) => l.customerId)
    .map((l) =>
      customerFromLead(l, {
        id: l.customerId as string,
        wonAt: l.stageChangedAt,
        address: SEED_ADDRESSES[l.company] ?? '',
        status: l.value >= 140000 ? 'vip' : l.company === 'Sahara Rent A Car' ? 'paused' : 'active',
        country: 'AE',
      }),
    ),
  ...crestLeads
    .filter((l) => l.customerId)
    .map((l) =>
      customerFromLead(l, {
        id: l.customerId as string,
        wonAt: l.stageChangedAt,
        address: SEED_ADDRESSES[l.company] ?? '',
        status: l.value >= 500000 ? 'vip' : 'active',
        country: 'SA',
      }),
    ),
]

const TITLES = ['General Manager', 'Operations Director', 'IT Manager', 'Practice Manager', 'Head of Marketing', 'Finance Director']
const SECOND_CONTACTS = ['Ravi Kumar', 'Lina Aziz', 'Hamad Al Blooshi', 'Joanna Kim', 'Samir Toufic', 'Amna Al Shehhi', 'Peter Novak', 'Dina Saleh', 'Zaid Obeid', 'Maria Santos']

const apexContacts: Tenant<Contact>[] = apexLeads.flatMap((l, i) => {
  const domain = l.contactEmail.split('@')[1]
  const primary: Tenant<Contact> = {
    companyId: l.companyId,
    id: `CT-${i}-1`,
    leadId: l.id,
    name: l.contactName,
    title: TITLES[i % TITLES.length],
    mobile: l.mobile,
    email: l.contactEmail,
    isDecisionMaker: i % 2 === 0,
  }
  if (i % 3 !== 0) return [primary]
  const name = SECOND_CONTACTS[(i / 3) % SECOND_CONTACTS.length]
  return [
    primary,
    {
      companyId: l.companyId,
      id: `CT-${i}-2`,
      leadId: l.id,
      name,
      title: TITLES[(i + 3) % TITLES.length],
      mobile: mobileFor(i + 40),
      email: `${name.split(' ')[0].toLowerCase()}@${domain}`,
      isDecisionMaker: i % 2 !== 0,
    },
  ]
})

const CREST_TITLES = ['Supply Chain Manager', 'Operations Director', 'Procurement Manager', 'Warehouse Manager', 'General Manager', 'Finance Director']
const CREST_SECOND_CONTACTS = ['Nasser Al Yami', 'Maha Al Dosari', 'Ziyad Al Saleh', 'Hanan Al Omari', 'Mazen Al Faraj', 'Rania Al Turki', 'Badr Al Shehri', 'Lujain Al Amri']

const crestContacts: Tenant<Contact>[] = crestLeads.flatMap((l, i) => {
  const domain = l.contactEmail.split('@')[1]
  const primary: Tenant<Contact> = {
    companyId: l.companyId,
    id: `CT-${l.id}-1`,
    leadId: l.id,
    name: l.contactName,
    title: CREST_TITLES[i % CREST_TITLES.length],
    mobile: l.mobile,
    email: l.contactEmail,
    isDecisionMaker: i % 2 === 0,
  }
  if (i % 3 !== 0) return [primary]
  const name = CREST_SECOND_CONTACTS[(i / 3) % CREST_SECOND_CONTACTS.length]
  return [
    primary,
    {
      companyId: l.companyId,
      id: `CT-${l.id}-2`,
      leadId: l.id,
      name,
      title: CREST_TITLES[(i + 3) % CREST_TITLES.length],
      mobile: crestMobileFor(i + 40),
      email: `${name.split(' ')[0].toLowerCase()}@${domain}`,
      isDecisionMaker: i % 2 !== 0,
    },
  ]
})

export const contacts: Tenant<Contact>[] = [...apexContacts, ...crestContacts]

/** How far along each stage usually is, which decides how much history a lead has. */
const STAGE_DEPTH: Record<LeadStatus, number> = {
  New: 0,
  Contacted: 1,
  'No response': 2,
  'Call later': 2,
  Interested: 3,
  Meeting: 4,
  Proposal: 5,
  /** Cold leads went quiet after several unanswered calls, emails and WhatsApps. */
  Cold: 4,
  Won: 6,
  Lost: 3,
  'Not interested': 2,
}

const ACTIVITY_SEQUENCE: ActivityType[] = ['call', 'email', 'whatsapp', 'call', 'meeting', 'visit', 'email']

function activitySummary(type: ActivityType, lead: Lead): string {
  const first = lead.contactName.replace(/^Dr\.\s|^Chef\s|^Eng\.\s/, '').split(' ')[0]
  switch (type) {
    case 'call':
      return `Called ${first} to walk through how ${lead.company} handles enquiries today.`
    case 'email':
      return `Sent ${first} a short overview and two case studies from ${lead.industry.toLowerCase()}.`
    case 'whatsapp':
      return `WhatsApp follow-up to ${first} confirming a good time to talk.`
    case 'meeting':
      return `Meeting with ${first} and team — mapped their current process and pain points.`
    case 'visit':
      return `Site visit at ${lead.company}; met the operations team.`
    case 'system':
      return `Updated by the system for ${lead.company}.`
  }
}

export const activities: Tenant<Activity>[] = leads.flatMap((l) => {
  const depth = STAGE_DEPTH[l.status]
  const created = new Date(l.createdAt).getTime()
  const span = Math.max(1, NOW.getTime() - created)
  return Array.from({ length: depth }, (_, k) => {
    const type = ACTIVITY_SEQUENCE[k % ACTIVITY_SEQUENCE.length]
    return {
      companyId: l.companyId,
      id: `A-${l.id}-${k}`,
      leadId: l.id,
      type,
      summary: activitySummary(type, l),
      userId: l.ownerId,
      at: new Date(created + (span * (k + 1)) / (depth + 1)).toISOString(),
    }
  })
})

const NOTE_BODIES = [
  'Prefers WhatsApp over email. Best reached after 2pm.',
  'Currently tracking everything in spreadsheets; open to automation if Arabic is supported.',
  'Budget sign-off sits with the finance director — loop them in before the proposal.',
  'Mentioned a competitor quote; price is a factor but turnaround matters more.',
]

const CREST_NOTE_BODIES = [
  'Prefers a call after Asr; WhatsApp for quick confirmations.',
  'Ships mostly through Jeddah Islamic Port; wants weekly consolidation to Riyadh.',
  'Procurement runs everything through their tender portal — register before quoting.',
  'Current provider misses cold-chain SLAs in summer; reliability matters more than price.',
]

/** Second author on a lead's history: the company's sales manager. */
const NOTE_MANAGER: Record<string, string> = { [APEX]: 'u3', [CREST]: 'u103' }

function notesFor(list: Tenant<Lead>[], bodies: string[]): Tenant<Note>[] {
  return list.flatMap((l, i) => {
    const depth = STAGE_DEPTH[l.status]
    if (depth < 2) return []
    const count = depth >= 4 ? 2 : 1
    return Array.from({ length: count }, (_, k) => ({
      companyId: l.companyId,
      id: `N-${l.id}-${k}`,
      leadId: l.id,
      body: bodies[(i + k) % bodies.length],
      authorId: k === 1 ? NOTE_MANAGER[l.companyId] : l.ownerId,
      createdAt: subDays(NOW, Math.max(0, 6 - k * 3 - (i % 3))).toISOString(),
    }))
  })
}

export const notes: Tenant<Note>[] = [...notesFor(apexLeads, NOTE_BODIES), ...notesFor(crestLeads, CREST_NOTE_BODIES)]

function leadTasksFor(list: Tenant<Lead>[]): Tenant<LeadTask>[] {
  return list.flatMap((l, i) => {
    const depth = STAGE_DEPTH[l.status]
    if (depth < 3 || l.status === 'Lost' || l.status === 'Not interested' || l.status === 'Cold') return []
    const out: Tenant<LeadTask>[] = [
      {
        companyId: l.companyId,
        id: `T-${l.id}-1`,
        leadId: l.id,
        title: l.status === 'Won' ? 'Hand over to delivery' : 'Prepare discovery questions',
        ownerId: l.ownerId,
        dueDate: addDays(NOW, (i % 5) - 1).toISOString(),
        status: l.status === 'Won' ? 'Done' : 'In progress',
        priority: 'Medium',
      },
    ]
    if (depth >= 5) {
      out.push({
        companyId: l.companyId,
        id: `T-${l.id}-2`,
        leadId: l.id,
        title: l.status === 'Won' ? 'Schedule kickoff call' : 'Send quotation for review',
        ownerId: l.ownerId,
        dueDate: addDays(NOW, (i % 4) + 1).toISOString(),
        status: 'To do',
        priority: 'High',
      })
    }
    return out
  })
}

/** Mutable stores of this module, for the dev persistence registry (leadTaskSeed below is seed-only). */
registerArray('users', users)
registerArray('leads', leads)
registerArray('customers', customers)
registerArray('contacts', contacts)
registerArray('activities', activities)
registerArray('notes', notes)

/** Seed for lead follow-up tasks; converted into the unified task store (shared/mocks/data/tasks.ts). */
export const leadTaskSeed: Tenant<LeadTask>[] = [...leadTasksFor(apexLeads), ...leadTasksFor(crestLeads)]
