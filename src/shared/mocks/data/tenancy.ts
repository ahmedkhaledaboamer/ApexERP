import { subDays } from 'date-fns'
import type { Company, Membership, PlatformUser, PublicCompany } from '@/modules/tenancy/types'
import { users } from '@/shared/mocks/db'
import { registerArray } from '@/shared/mocks/persist/registry'

/**
 * Tenants of the Apex CRM platform. Apex Aora is the first tenant; Crest Logistics is a second,
 * fully synthetic company (Saudi, SAR, different industries and palette) used to demonstrate
 * isolation. Company ids live only on the server side of the contract: the client never sends one.
 */

export const APEX_ID = 'co_apex'
export const CREST_ID = 'co_crest'

const VIOLET = {
  '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '300': '#c4b5fd', '400': '#a78bfa',
  '500': '#8b5cf6', '600': '#7c3aed', '700': '#6d28d9', '800': '#5b21b6', '900': '#4c1d95',
}
const TEAL = {
  '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '300': '#5eead4', '400': '#2dd4bf',
  '500': '#14b8a6', '600': '#0d9488', '700': '#0f766e', '800': '#115e59', '900': '#134e4a',
}

export const companies: Company[] = [
  {
    id: APEX_ID,
    name: 'Apex Aora Innovations',
    subdomain: 'apexaora',
    status: 'active',
    plan: 'enterprise',
    enabledModules: ['sales', 'services', 'marketing', 'accounting', 'hr', 'reports', 'settings', 'departments', 'tasks'],
    regional: {
      country: 'AE',
      currency: 'AED',
      timezone: 'Asia/Dubai',
      language: 'en',
      dateFormat: 'd MMM yyyy',
      weekStartsOn: 1,
      weekend: [0, 6],
      vatPct: 5,
    },
    branding: {
      displayName: 'Apex Aora',
      logoUrl: 'https://cdn.magicpatterns.com/uploads/eKKXVjahfoDq12vpjN8HQk/logo.png',
      monogram: 'AA',
      palette: VIOLET,
      emailSenderName: 'Apex Aora Sales',
      emailSenderAddress: 'sales@apexaora.ae',
    },
    // Phone and TRN left empty on purpose: the onboarding checklist asks the admin to complete them.
    profile: {
      legalName: 'Apex Aora Innovations',
      tradeName: 'Apex Aora',
      address: { line1: 'Business Bay', line2: '', city: 'Dubai', region: 'Dubai', country: 'AE' },
      location: { lat: 25.1857, lng: 55.2727 },
      taxNumber: '',
      commercialLicenseNo: '',
      phone: '',
      email: 'sales@apexaora.ae',
      website: 'apexaorainnovations.com',
      bank: null,
    },
    createdAt: subDays(new Date(), 720).toISOString(),
  },
  {
    id: CREST_ID,
    name: 'Crest Logistics Co.',
    subdomain: 'crest',
    status: 'active',
    plan: 'business',
    // = the Business plan's role modules (kept in sync with the plan by services/billing.ts): no HR.
    enabledModules: ['sales', 'services', 'marketing', 'accounting', 'reports', 'settings', 'departments', 'tasks'],
    regional: {
      country: 'SA',
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
      language: 'en',
      dateFormat: 'dd/MM/yyyy',
      weekStartsOn: 0,
      weekend: [5, 6],
      vatPct: 15,
    },
    branding: {
      displayName: 'Crest Logistics',
      logoUrl: null,
      monogram: 'CL',
      palette: TEAL,
      emailSenderName: 'Crest Logistics',
      emailSenderAddress: 'hello@crestlogistics.sa',
    },
    // Fully synthetic: the VAT number, CR number and IBAN only pass the format checks.
    profile: {
      legalName: 'Crest Logistics Co.',
      tradeName: 'Crest Logistics',
      address: { line1: 'King Fahd Road, Al Olaya', line2: 'Building 7, Floor 3', city: 'Riyadh', region: 'Riyadh Province', country: 'SA' },
      location: { lat: 24.6907, lng: 46.6853 },
      taxNumber: '310123456700003',
      commercialLicenseNo: '1010123456',
      phone: '+966 11 455 2200',
      email: 'hello@crestlogistics.sa',
      website: 'crestlogistics.sa',
      bank: { bankName: 'Gulf Commerce Bank', accountName: 'Crest Logistics Co.', iban: 'SA0810000012345678900001', swift: 'GCBKSARI' },
    },
    createdAt: subDays(new Date(), 400).toISOString(),
  },
]

/** One active membership per user (for now). Role here is the source of truth; User.role mirrors it. */
export const memberships: Membership[] = users.map((u, i) => ({
  id: `m${i + 1}`,
  userId: u.id,
  companyId: u.companyId,
  role: u.role,
  status: 'active',
  createdAt: u.createdAt,
}))

/** Platform operators. They sign in to the platform console, never to a workspace (except by impersonation). */
export const platformUsers: PlatformUser[] = [
  { id: 'p1', name: 'Nadia Karam', email: 'owner@apexcrm.app', platformRole: 'Platform Owner' },
  { id: 'p2', name: 'Sami Haddad', email: 'support@apexcrm.app', platformRole: 'Platform Support' },
  { id: 'p3', name: 'Lina Farouk', email: 'billing@apexcrm.app', platformRole: 'Platform Billing' },
]

registerArray('companies', companies)
registerArray('memberships', memberships)
registerArray('platformUsers', platformUsers)

export function companyById(id: string): Company | undefined {
  return companies.find((c) => c.id === id)
}

export function companyBySubdomain(subdomain: string): Company | undefined {
  const s = subdomain.trim().toLowerCase()
  return companies.find((c) => c.subdomain === s)
}

export function activeMembershipOf(userId: string): Membership | undefined {
  return memberships.find((m) => m.userId === userId && m.status === 'active')
}

/** Adds the membership for a user created in Settings > Users (same company as the admin). */
export function addMembership(userId: string, companyId: string, role: Membership['role']): Membership {
  const m: Membership = {
    id: `m${memberships.length + 1}`,
    userId,
    companyId,
    role,
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  memberships.push(m)
  return m
}

/** Keeps the membership in step when an admin changes a user's role or deactivates them. */
export function syncMembership(userId: string, patch: Partial<Pick<Membership, 'role' | 'status'>>): void {
  const m = memberships.find((x) => x.userId === userId)
  if (m) Object.assign(m, patch)
}

export function toPublicCompany(c: Company): PublicCompany {
  return { id: c.id, name: c.name, subdomain: c.subdomain, status: c.status, branding: c.branding }
}
