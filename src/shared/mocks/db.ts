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

/**
 * In-memory data the service functions read from. Dates are relative to the moment the
 * module loads, so "due today" and "this month" always have something in them.
 */

export const users: User[] = [
  {
    id: 'u1', name: 'Omar Haddad', email: 'omar@apexaora.ae', role: 'System Admin', title: 'IT & Systems Lead', managerId: null,
    mobile: '+971 50 412 7781', departmentId: 'd-it', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 720).toISOString(),
  },
  {
    id: 'u2', name: 'Layla Mansour', email: 'layla@apexaora.ae', role: 'Management', title: 'Managing Director', managerId: null,
    mobile: '+971 50 118 2204', departmentId: 'd-management', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 720).toISOString(),
  },
  {
    id: 'u3', name: 'Karim Nasser', email: 'karim@apexaora.ae', role: 'Sales Manager', title: 'Head of Sales', managerId: 'u2',
    mobile: '+971 55 734 9012', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 1 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 610).toISOString(),
  },
  {
    id: 'u4', name: 'Bincy Thomas', email: 'bincy@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 52 268 4410', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 420).toISOString(),
  },
  {
    id: 'u5', name: 'Ahmed Al Falasi', email: 'ahmed@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 50 991 3307', departmentId: 'd-sales', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 390).toISOString(),
  },
  {
    id: 'u6', name: 'Priya Raman', email: 'priya@apexaora.ae', role: 'Sales Agent', title: 'Business Development Rep', managerId: 'u3',
    mobile: '+971 56 402 7718', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 210).toISOString(),
  },
  {
    id: 'u7', name: 'Sara Khoury', email: 'sara@apexaora.ae', role: 'Marketing Manager', title: 'Marketing Manager', managerId: 'u2',
    mobile: '+971 54 337 0925', departmentId: 'd-marketing', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 48 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 540).toISOString(),
  },
  {
    id: 'u8', name: 'Rashid Iqbal', email: 'rashid@apexaora.ae', role: 'Accountant', title: 'Senior Accountant', managerId: 'u2',
    mobile: '+971 50 625 1183', departmentId: 'd-finance', active: true, twoFactorEnabled: true,
    lastLoginAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 480).toISOString(),
  },
  {
    id: 'u9', name: 'Mariam Saeed', email: 'mariam@apexaora.ae', role: 'HR Manager', title: 'HR Manager', managerId: 'u2',
    mobile: '+971 58 214 6650', departmentId: 'd-hr', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 72 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 455).toISOString(),
  },
  {
    id: 'u10', name: 'Daniel Ortiz', email: 'daniel@apexaora.ae', role: 'Department Head', title: 'Head of Delivery', managerId: 'u2',
    mobile: '+971 55 870 4436', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 9 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 330).toISOString(),
  },
  {
    id: 'u11', name: 'Noura Al Ketbi', email: 'noura@apexaora.ae', role: 'Employee', title: 'Solutions Consultant', managerId: 'u10',
    mobile: '+971 56 155 2290', departmentId: 'd-delivery', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 30 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 160).toISOString(),
  },
  {
    id: 'u12', name: 'Hassan Qureshi', email: 'hassan@apexaora.ae', role: 'Sales Agent', title: 'Partner Sales Rep', managerId: 'u10',
    mobile: '+971 52 640 8871', departmentId: 'd-sales', active: true, twoFactorEnabled: false,
    lastLoginAt: new Date(Date.now() - 52 * 3_600_000).toISOString(), createdAt: subDays(new Date(), 140).toISOString(),
  },
  {
    id: 'u13', name: 'Fatima Zahra', email: 'fatima@apexaora.ae', role: 'Sales Agent', title: 'Account Executive', managerId: 'u3',
    mobile: '+971 50 377 5164', departmentId: 'd-sales', active: false, twoFactorEnabled: false,
    lastLoginAt: subDays(new Date(), 64).toISOString(), createdAt: subDays(new Date(), 300).toISOString(),
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

function firstServiceOf(category: ServiceCategory): string | null {
  return catalog.find((s) => s.active && s.category === category)?.id ?? null
}

function migrateServices(categories: ServiceCategory[], i: number) {
  const serviceIds = categories
    .slice(0, (i % 3) + 1)
    .map(firstServiceOf)
    .filter((id): id is string => !!id)
  const legacy = LEGACY_FREE_TEXT[i] ?? categories[0]
  const match = matchServiceText(legacy, catalog)
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

export const leads: Lead[] = SEED.map(
  ([company, contact, domain, industry, subIndustry, source, status, ownerId, value, createdDaysAgo, followUpInDays, dnc], i) => ({
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
    nextFollowUpDate: followUpInDays === null ? null : addDays(NOW, followUpInDays).toISOString(),
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

/** Builds a customer from a Won lead, carrying its data over so nobody retypes it. */
export function customerFromLead(lead: Lead, opts: { id: string; wonAt: string; address?: string; status?: Customer['status'] }): Customer {
  return {
    id: opts.id,
    name: lead.company,
    industry: lead.industry,
    subIndustry: lead.subIndustry,
    leadId: lead.id,
    ownerId: lead.ownerId,
    createdAt: opts.wonAt,
    website: websiteFromLead(lead),
    address: opts.address ?? '',
    emirate: emirateFromLead(lead),
    status: opts.status ?? 'Active',
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
}

export const customers: Customer[] = leads
  .filter((l) => l.customerId)
  .map((l) =>
    customerFromLead(l, {
      id: l.customerId as string,
      wonAt: l.stageChangedAt,
      address: SEED_ADDRESSES[l.company] ?? '',
      status: l.value >= 140000 ? 'VIP' : l.company === 'Sahara Rent A Car' ? 'Paused' : 'Active',
    }),
  )

const TITLES = ['General Manager', 'Operations Director', 'IT Manager', 'Practice Manager', 'Head of Marketing', 'Finance Director']
const SECOND_CONTACTS = ['Ravi Kumar', 'Lina Aziz', 'Hamad Al Blooshi', 'Joanna Kim', 'Samir Toufic', 'Amna Al Shehhi', 'Peter Novak', 'Dina Saleh', 'Zaid Obeid', 'Maria Santos']

export const contacts: Contact[] = leads.flatMap((l, i) => {
  const domain = l.contactEmail.split('@')[1]
  const primary: Contact = {
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
  const first = lead.contactName.replace(/^Dr\.\s|^Chef\s/, '').split(' ')[0]
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
  }
}

export const activities: Activity[] = leads.flatMap((l) => {
  const depth = STAGE_DEPTH[l.status]
  const created = new Date(l.createdAt).getTime()
  const span = Math.max(1, NOW.getTime() - created)
  return Array.from({ length: depth }, (_, k) => {
    const type = ACTIVITY_SEQUENCE[k % ACTIVITY_SEQUENCE.length]
    return {
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

export const notes: Note[] = leads.flatMap((l, i) => {
  const depth = STAGE_DEPTH[l.status]
  if (depth < 2) return []
  const count = depth >= 4 ? 2 : 1
  return Array.from({ length: count }, (_, k) => ({
    id: `N-${l.id}-${k}`,
    leadId: l.id,
    body: NOTE_BODIES[(i + k) % NOTE_BODIES.length],
    authorId: k === 1 ? 'u3' : l.ownerId,
    createdAt: subDays(NOW, Math.max(0, 6 - k * 3 - (i % 3))).toISOString(),
  }))
})

export const tasks: LeadTask[] = leads.flatMap((l, i) => {
  const depth = STAGE_DEPTH[l.status]
  if (depth < 3 || l.status === 'Lost' || l.status === 'Not interested' || l.status === 'Cold') return []
  const list: LeadTask[] = [
    {
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
    list.push({
      id: `T-${l.id}-2`,
      leadId: l.id,
      title: l.status === 'Won' ? 'Schedule kickoff call' : 'Send quotation for review',
      ownerId: l.ownerId,
      dueDate: addDays(NOW, (i % 4) + 1).toISOString(),
      status: 'To do',
      priority: 'High',
    })
  }
  return list
})
