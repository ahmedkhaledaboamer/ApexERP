import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/lib/apiError'
import { normalizeMobile } from '@/shared/lib/phone'
import { users, leads } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID, companyById } from '@/shared/mocks/data/tenancy'
import { DEFAULT_TEMPLATES, defaultTemplatesFor, templates } from '@/shared/mocks/data/templates'
import { sendMessage } from '@/shared/mocks/services/messages'
import { createTemplate } from '@/shared/mocks/services/templates'
import { issuerAddress, issuerFor } from '@/modules/quotations/lib/company'
import { buildTemplateContext, companyContextFor } from './context'
import { findVariables, renderTemplate, unknownVariables } from './render'
import { getVariable, isKnownVariable, VARIABLES } from './variables'

const apex = companyById(APEX_ID)!
const crest = companyById(CREST_ID)!
const apexAdmin = users.find((u) => u.id === 'u1')!

const COMPANY_VARS = ['name', 'legal_name', 'phone', 'email', 'website', 'address'] as const

/** What each company variable must render to, straight from issuerFor. */
function expected(company: typeof apex): Record<(typeof COMPANY_VARS)[number], string> {
  const i = issuerFor(company)
  return { name: i.name, legal_name: i.legalName, phone: i.phone, email: i.email, website: i.website, address: issuerAddress(i) }
}

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('expected an ApiError')
}

describe('company variables', () => {
  it('the six company variables are canonical snake_case keys', () => {
    for (const f of COMPANY_VARS) {
      const v = getVariable(`company.${f}`)
      expect(v?.key).toBe(`company.${f}`)
      expect(v?.label).toBeTruthy()
      expect(v?.description).toBeTruthy()
    }
  })

  it.each([
    ['Apex', apex],
    ['Crest', crest],
  ])('each variable renders from issuerFor for %s', (_, company) => {
    const ctx = buildTemplateContext({ company: issuerFor(company) })
    const want = expected(company)
    for (const f of COMPANY_VARS) expect(renderTemplate(`{{company.${f}}}`, ctx)).toBe(want[f])
    // The shortcut used by the picker and the preview gives the same values.
    const direct = { company: companyContextFor(company) }
    for (const f of COMPANY_VARS) expect(renderTemplate(`{{company.${f}}}`, direct)).toBe(want[f])
  })

  it('reads the trade name and legal name, not the workspace name', () => {
    const ctx = { company: companyContextFor(crest) }
    expect(renderTemplate('{{company.name}} / {{company.legal_name}}', ctx)).toBe('Crest Logistics / Crest Logistics Co.')
    expect(renderTemplate('{{company.address}}', ctx)).toContain('Riyadh')
  })

  it('a missing profile value renders empty (Apex has no phone yet)', () => {
    expect(renderTemplate('[{{company.phone}}]', { company: companyContextFor(apex) })).toBe('[]')
  })

  it('deprecated camelCase aliases still render and stay out of the picker', () => {
    const ctx = { company: companyContextFor(crest) }
    expect(isKnownVariable('company.legalName')).toBe(true)
    expect(renderTemplate('{{company.legalName}}', ctx)).toBe(renderTemplate('{{company.legal_name}}', ctx))
    expect(renderTemplate('{{company.taxNumber}}', ctx)).toBe('310123456700003')
    expect(renderTemplate('{{company.taxLabel}}', ctx)).toBe(renderTemplate('{{company.tax_label}}', ctx))
    expect(getVariable('company.legalName')?.key).toBe('company.legal_name')
    const listed = VARIABLES.map((v) => v.key)
    expect(listed).not.toContain('company.legalName')
    expect(listed).not.toContain('company.taxNumber')
  })

  it('unknown variables are still rejected', () => {
    expect(unknownVariables('{{company.fax}} {{company.legal_name}} {{company.legalName}}')).toEqual(['company.fax'])
    expect(renderTemplate('{{company.fax}}', { company: companyContextFor(apex) })).toBe('[unknown: company.fax]')
  })
})

describe('default templates', () => {
  it('there are 12, with no company identity written in', () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(12)
    for (const t of DEFAULT_TEMPLATES) {
      const text = `${t.name}\n${t.subject}\n${t.body}`
      expect(text).not.toMatch(/Apex|Aora|GITEX|apexaora/i)
    }
  })

  it('use only known variables, and company variables where it matters', () => {
    const used = new Set<string>()
    for (const t of DEFAULT_TEMPLATES) {
      expect(unknownVariables(t.subject)).toEqual([])
      expect(unknownVariables(t.body)).toEqual([])
      for (const k of findVariables(`${t.subject}\n${t.body}`)) used.add(k)
    }
    for (const f of COMPANY_VARS) expect(used).toContain(`company.${f}`)
    // Only canonical keys in the product defaults.
    for (const k of used) expect(getVariable(k)?.key).toBe(k)
  })

  it('defaultTemplatesFor stamps the company id and asks idFor for each id', () => {
    let n = 0
    const rows = defaultTemplatesFor('co_new', () => `X-${++n}`)
    expect(rows).toHaveLength(12)
    expect(rows.every((r) => r.companyId === 'co_new')).toBe(true)
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => `X-${i + 1}`))
    expect(rows.map((r) => r.body)).toEqual(DEFAULT_TEMPLATES.map((t) => t.body))
  })

  it("Apex's seed is the defaults, with ids TPL-1…TPL-12", () => {
    const apexRows = templates.filter((t) => t.companyId === APEX_ID)
    expect(apexRows.map((t) => t.id)).toEqual(Array.from({ length: 12 }, (_, i) => `TPL-${i + 1}`))
    expect(apexRows.map((t) => t.body)).toEqual(DEFAULT_TEMPLATES.map((t) => t.body))
  })

  it('Crest signatures use company variables', () => {
    const crestRows = templates.filter((t) => t.companyId === CREST_ID)
    expect(crestRows.length).toBeGreaterThan(0)
    for (const t of crestRows) {
      expect(t.body).toContain('{{company.')
      expect(unknownVariables(t.body)).toEqual([])
    }
  })
})

describe('server side', () => {
  it('the templates service accepts the new keys and the old alias, and rejects unknown ones', async () => {
    const ok = await createTemplate(apexAdmin, {
      channel: 'email',
      name: 'Signature check',
      purpose: 'General',
      subject: 'Hello from {{company.name}}',
      body: '{{agent.name}}\n{{company.legal_name}} · {{company.legalName}}\n{{company.address}}',
    })
    expect(ok.id).toBeTruthy()
    const err = await apiError(
      createTemplate(apexAdmin, { channel: 'email', name: 'Bad', purpose: 'General', subject: 'Hi', body: '{{company.fax}}' }),
    )
    expect(err.status).toBe(422)
    expect(err.message).toContain('{{company.fax}}')
  })

  it("sending fills {{company.*}} from the caller's company and still rejects unknown variables", async () => {
    const lead = leads.find((l) => l.companyId === APEX_ID && !l.doNotContact && normalizeMobile(l.mobile ?? '', 'AE'))
    expect(lead).toBeTruthy()
    const res = await sendMessage(apexAdmin, lead!.id, {
      channel: 'whatsapp',
      to: lead!.mobile!,
      body: 'Hi from {{company.name}} ({{company.legal_name}}, {{company.website}})',
    })
    const i = issuerFor(apex)
    expect(res.activity.summary).toContain(`Hi from ${i.name} (${i.legalName}, ${i.website})`)

    const err = await apiError(sendMessage(apexAdmin, lead!.id, { channel: 'whatsapp', to: lead!.mobile!, body: 'Hi {{company.fax}}' }))
    expect(err.status).toBe(422)
    // A company value the profile doesn't have yet (Apex: no phone) blocks too.
    const empty = await apiError(sendMessage(apexAdmin, lead!.id, { channel: 'whatsapp', to: lead!.mobile!, body: 'Call {{company.phone}}' }))
    expect(empty.message).toContain('{{company.phone}}')
  })
})
