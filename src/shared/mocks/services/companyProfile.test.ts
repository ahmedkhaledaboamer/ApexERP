import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/lib/apiError'
import type { CompanyProfile } from '@/modules/tenancy/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companies, companyById } from '@/shared/mocks/data/tenancy'
import { auditLog } from '@/shared/mocks/data/audit'
import { getCompanyProfile, updateCompanyProfile } from '@/shared/mocks/services/companyProfile'
import { getOnboarding } from '@/shared/mocks/services/onboarding'
import { getTenant } from '@/shared/mocks/services/auth'
import { issuerFor } from '@/modules/quotations/lib/company'

const u = (id: string) => {
  const found = users.find((x) => x.id === id)
  if (!found) throw new Error(`Seed user ${id} is missing`)
  return found
}
const apexAdmin = u('u1')
const apexManagement = u('u2')
const apexManager = u('u3')
const crestAdmin = u('u101')
const crestManagement = u('u102')

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

// Restore the seed profiles after each test (the stores are shared module state).
const snapshot = new Map(companies.map((c) => [c.id, { name: c.name, profile: structuredClone(c.profile) as CompanyProfile }]))
afterEach(() => {
  for (const c of companies) {
    const s = snapshot.get(c.id)
    if (s) {
      c.name = s.name
      c.profile = structuredClone(s.profile)
    }
  }
})

describe('company profile: access', () => {
  it('Company Admin and Management can read; Management cannot write', async () => {
    expect((await getCompanyProfile(apexAdmin)).legalName).toBe('Apex Aora Innovations')
    expect((await getCompanyProfile(apexManagement)).tradeName).toBe('Apex Aora')
    expect((await apiError(updateCompanyProfile(apexManagement, { tradeName: 'Nope' }))).status).toBe(403)
    expect(companyById(APEX_ID)!.profile.tradeName).toBe('Apex Aora')
  })

  it('other roles get 403', async () => {
    expect((await apiError(getCompanyProfile(apexManager))).status).toBe(403)
    expect((await apiError(updateCompanyProfile(apexManager, { tradeName: 'x' }))).status).toBe(403)
  })
})

describe('company profile: tenant isolation', () => {
  it('Crest admin reads and edits only Crest, even with Apex’s companyId in the body', async () => {
    expect((await getCompanyProfile(crestAdmin)).legalName).toBe('Crest Logistics Co.')
    const saved = await updateCompanyProfile(crestAdmin, { companyId: APEX_ID, tradeName: 'Crest Freight' })
    expect(saved.tradeName).toBe('Crest Freight')
    expect(companyById(CREST_ID)!.profile.tradeName).toBe('Crest Freight')
    expect(companyById(APEX_ID)!.profile.tradeName).toBe('Apex Aora')
    expect((await getCompanyProfile(apexAdmin)).tradeName).toBe('Apex Aora')
  })

  it('GET /tenant carries the profile, so issuerFor prints it', async () => {
    await updateCompanyProfile(crestAdmin, { phone: '0114552200' })
    const tenant = await getTenant(crestAdmin)
    const issuer = issuerFor(tenant)
    expect(issuer.phone).toBe('+966 11 455 2200')
    expect(issuer.taxLabel).toBe('VAT number')
    expect(issuer.taxNumber).toBe('310123456700003')
    expect(issuer.addressLines).toContain('Saudi Arabia')
  })
})

describe('company profile: three separate names (regression)', () => {
  it('saving the profile never overwrites the workspace name; issuerFor picks the right name per document', async () => {
    const crest = companyById(CREST_ID)!
    const workspaceName = crest.branding.displayName
    const accountName = crest.name
    await updateCompanyProfile(crestAdmin, { legalName: 'Crest Logistics Holding Company LLC', tradeName: 'Crest Freight' })
    expect(crest.branding.displayName).toBe(workspaceName)
    expect(crest.name).toBe(accountName)

    const issuer = issuerFor(crest)
    expect(issuer.name).toBe('Crest Freight') // customer-facing: emails, letterhead
    expect(issuer.legalName).toBe('Crest Logistics Holding Company LLC') // quotations, contracts, invoices
    expect(issuer.taxNumber).toBe(crest.profile.taxNumber)

    // No trade name: customers see the workspace name; the legal name still prints on documents.
    await updateCompanyProfile(crestAdmin, { tradeName: '' }).catch(() => undefined)
    crest.profile.tradeName = ''
    expect(issuerFor(crest).name).toBe(workspaceName)
    expect(issuerFor(crest).legalName).toBe('Crest Logistics Holding Company LLC')
  })
})

describe('company profile: validation', () => {
  it('tax number is checked against the company country', async () => {
    // A valid UAE TRN is not a Saudi VAT number.
    expect((await apiError(updateCompanyProfile(crestAdmin, { taxNumber: '100123456700003' }))).status).toBe(422)
    expect((await apiError(updateCompanyProfile(apexAdmin, { taxNumber: '310123456700003' }))).status).toBe(422)
    const ok = await updateCompanyProfile(apexAdmin, { taxNumber: '100 1234 5670 0003' })
    expect(ok.taxNumber).toBe('100123456700003')
  })

  it('required fields, formats, coordinates and IBAN', async () => {
    const bad: Record<string, unknown>[] = [
      { legalName: '' },
      { tradeName: '  ' },
      { address: { line1: '' } },
      { address: { city: '' } },
      { address: { country: 'XX' } },
      { email: 'not-an-email' },
      { website: 'not a site' },
      { phone: '12345' },
      { location: { lat: 91, lng: 10 } },
      { location: { lat: 10, lng: -181 } },
      { bank: { bankName: 'B', accountName: 'A', iban: 'SA0910000012345678900001', swift: '' } },
    ]
    for (const patch of bad) {
      const err = await apiError(updateCompanyProfile(apexAdmin, patch))
      expect(err.status, JSON.stringify(patch)).toBe(422)
    }
    expect(companyById(APEX_ID)!.profile).toEqual(snapshot.get(APEX_ID)!.profile)
  })

  it('a valid full update is stored and optional parts can be cleared', async () => {
    const saved = await updateCompanyProfile(apexAdmin, {
      phone: '+971 4 123 4567',
      location: null,
      bank: { bankName: 'Synthetic Bank', accountName: 'Apex Aora Innovations', iban: 'GB82 WEST 1234 5698 7654 32', swift: 'synbaeadxxx' },
    })
    expect(saved.phone).toBe('+971 4 123 4567')
    expect(saved.location).toBeNull()
    expect(saved.bank?.iban).toBe('GB82WEST12345698765432')
    expect(saved.bank?.swift).toBe('SYNBAEADXXX')
  })
})

describe('company profile: audit', () => {
  it('writes an audit entry with field diffs in the caller’s company', async () => {
    const before = auditLog.length
    await updateCompanyProfile(crestAdmin, { website: 'crest-logistics.example', address: { city: 'Jeddah' } })
    expect(auditLog.length).toBe(before + 1)
    const row = auditLog[0]
    expect(row.companyId).toBe(CREST_ID)
    expect(row.entity).toBe('company-profile')
    expect(row.changes).toEqual(
      expect.arrayContaining([
        { field: 'website', from: 'crestlogistics.sa', to: 'crest-logistics.example' },
        { field: 'address.city', from: 'Riyadh', to: 'Jeddah' },
      ]),
    )
  })

  it('no entry when nothing changed', async () => {
    const before = auditLog.length
    await updateCompanyProfile(crestAdmin, { tradeName: 'Crest Logistics' })
    expect(auditLog.length).toBe(before)
  })
})

describe('onboarding', () => {
  it('is computed per tenant and closed to other roles', async () => {
    const apex = await getOnboarding(apexAdmin)
    expect(apex.items.find((i) => i.id === 'profile')?.done).toBe(false)
    expect(apex.items.find((i) => i.id === 'team')?.done).toBe(true)
    const crest = await getOnboarding(crestManagement)
    expect(crest.items.find((i) => i.id === 'profile')?.done).toBe(true)
    expect((await apiError(getOnboarding(apexManager))).status).toBe(403)
  })
})

// Sign-up tests live in signup.test.ts.
