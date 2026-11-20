import { describe, expect, it } from 'vitest'
import { activities, contacts, leads, notes } from '@/shared/mocks/db'
import { formSubmissions, landingPages, leadForms } from '@/shared/mocks/data/marketingGrowth'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { usageSimulation } from '@/shared/mocks/data/subscriptions'
import { usedOf } from '@/shared/mocks/services/billing'
import { FORM_SUBMIT_LIMIT } from '@/shared/mocks/services/leadGen'
import { buildUtmUrl } from '@/modules/marketing/growth/types'
import { APEX, CREST, api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * Lead generation rules through the real MSW handlers (snake_case wire format): the public form
 * submit (lead with the form's source / campaign / round-robin owner, duplicate email → linked,
 * Do Not Contact kept, plan limit → stored without a lead, honeypot, rate limit, paused / unknown /
 * no Marketing module), views and stats, landing page slugs per company, UTM links.
 */

useSeedPerTest()

const apexAdmin = (method: string, path: string, body?: unknown) => api(userToken('u1'), method, path, { body })
const crestAdmin = (method: string, path: string, body?: unknown) => api(userToken('u101'), method, path, { body })
const keyOf = (id: string) => leadForms.find((f) => f.id === id)!.publicKey
let n = 0
const email = (tag = 'web') => `${tag}-${++n}-${Date.now().toString(36)}@visitor-${n}.example.org`
const submit = (formId: string, values: Record<string, string>, extra: Record<string, unknown> = {}, client = `c-${++n}`) =>
  api(null, 'POST', `/public/forms/${keyOf(formId)}/submit`, { body: { values, consent: true, ...extra }, headers: { 'X-Client-Id': client } })
const subsOf = (formId: string) => formSubmissions.filter((s) => s.formId === formId)

function setUsage(companyId: string, target: number): void {
  for (let i = usageSimulation.length - 1; i >= 0; i--) {
    if (usageSimulation[i].companyId === companyId && usageSimulation[i].key === 'leadsContacts') usageSimulation.splice(i, 1)
  }
  usageSimulation.push({ companyId, key: 'leadsContacts', offset: target - usedOf(companyId, 'leadsContacts') })
}

describe('public form submit creates a lead', () => {
  it('new email → a lead with the form’s source, campaign and source detail; owners in turn; answers in the note', async () => {
    const before = leads.length
    const r1 = await submit('LF-1002', { contact_name: 'Mona Saleh', email: email(), company_name: 'Saleh Hotels', custom_1: 'About 300', source_detail: 'A friend' })
    expect(r1.status, JSON.stringify(r1.body)).toBe(200)
    expect(r1.body).toMatchObject({ ok: true, message: expect.stringContaining('demo request'), redirect_url: null })
    expect(leads.length).toBe(before + 1)
    const s1 = subsOf('LF-1002').at(-1)!
    expect(s1).toMatchObject({ outcome: 'created', channel: 'hosted', companyId: APEX })
    const lead1 = leads.find((l) => l.id === s1.leadId)!
    expect(lead1).toMatchObject({ companyId: APEX, sourceType: 'LinkedIn', campaignId: 'CMP-1001', sourceDetail: 'A friend', company: 'Saleh Hotels', ownerId: 'u5', status: 'New' })
    expect(contacts.some((c) => c.leadId === lead1.id && c.name === 'Mona Saleh')).toBe(true)
    expect(notes.find((x) => x.leadId === lead1.id)?.body).toContain('How many guest messages do you get per day?: About 300')

    // Round-robin: the second lead goes to the next owner, the third back to the first.
    const r2 = await submit('LF-1002', { contact_name: 'Karim Daher', email: email(), company_name: 'Daher Group' })
    expect(r2.status).toBe(200)
    expect(leads.find((l) => l.id === subsOf('LF-1002').at(-1)!.leadId)?.ownerId).toBe('u12')
    await submit('LF-1002', { contact_name: 'Third Person', email: email(), company_name: 'Third Co' })
    const lead3 = leads.find((l) => l.id === subsOf('LF-1002').at(-1)!.leadId)!
    expect(lead3.ownerId).toBe('u5')
    // No source-detail answer → the form name.
    expect(lead3.sourceDetail).toBe('AI chatbot demo request')
  })

  it('the lead is visible through the API with its source and campaign', async () => {
    await submit('LF-1002', { contact_name: 'Api Check', email: email(), company_name: 'Api Check LLC' })
    const id = subsOf('LF-1002').at(-1)!.leadId!
    const lead = await apexAdmin('GET', `/leads/${id}`)
    expect(lead.status).toBe(200)
    expect(lead.body).toMatchObject({ source_id: 'LinkedIn', campaign_id: 'CMP-1001', company_name: 'Api Check LLC' })
  })

  it('an existing lead’s or contact’s email links the submission (no duplicate) and logs an activity', async () => {
    const existing = leads.find((l) => l.companyId === APEX && l.contactEmail && !l.doNotContact)!
    const before = leads.length
    const acts = activities.length
    const r = await submit('LF-1001', { contact_name: existing.contactName, email: existing.contactEmail.toUpperCase(), company_name: existing.company })
    expect(r.status).toBe(200)
    expect(leads.length).toBe(before)
    expect(activities.length).toBe(acts + 1)
    expect(subsOf('LF-1001').at(-1)).toMatchObject({ outcome: 'linked', leadId: existing.id, doNotContact: false })
    const timeline = await apexAdmin('GET', `/leads/${existing.id}/activities`)
    expect(JSON.stringify(timeline.body)).toContain('submitted the form “Website contact form”')
    // A contact's email (not the primary) links too.
    const c = contacts.find((x) => x.companyId === APEX && x.leadId && x.email && x.email.toLowerCase() !== leads.find((l) => l.id === x.leadId)?.contactEmail.toLowerCase())
    if (c) {
      await submit('LF-1001', { contact_name: c.name, email: c.email, company_name: 'X' })
      expect(subsOf('LF-1001').at(-1)).toMatchObject({ outcome: 'linked', leadId: c.leadId })
    }
  })

  it('Do Not Contact is respected: linked, flagged on the submission, the lead stays Do Not Contact', async () => {
    const lead = leads.find((l) => l.companyId === APEX && l.contactEmail)!
    lead.doNotContact = true
    const r = await submit('LF-1001', { contact_name: 'Again', email: lead.contactEmail, company_name: lead.company })
    expect(r.status).toBe(200)
    expect(subsOf('LF-1001').at(-1)).toMatchObject({ outcome: 'linked', leadId: lead.id, doNotContact: true })
    expect(lead.doNotContact).toBe(true)
    expect(activities.at(-1)?.summary).toContain('Do Not Contact')
    const list = await apexAdmin('GET', '/marketing/forms/LF-1001/submissions')
    expect(list.body[0]).toMatchObject({ outcome: 'linked', do_not_contact: true })
  })

  it('the plan’s leads + contacts limit: the submission is stored with outcome limit, no lead, the visitor still sees success', async () => {
    setUsage(CREST, 25_000)
    const before = leads.length
    const r = await submit('LF-5001', { company_name: 'Full Co', contact_name: 'Limit Person', mobile: '+966 55 123 4567' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(leads.length).toBe(before)
    expect(subsOf('LF-5001').at(-1)).toMatchObject({ outcome: 'limit', leadId: null, companyId: CREST })
    const form = await crestAdmin('GET', '/marketing/forms/LF-5001')
    expect(form.body.stats.limit_reached).toBe(1)
  })

  it('mobile numbers are checked against the company’s country; consent is required when the form has consent text', async () => {
    const uae = await submit('LF-5001', { company_name: 'A', contact_name: 'B', mobile: '+971 50 123 4567' })
    expect(uae.status).toBe(422)
    expect(uae.body.code).toBe('invalid_submission')
    const noConsent = await submit('LF-5001', { company_name: 'A', contact_name: 'B', mobile: '+966 55 765 4321' }, { consent: false })
    expect(noConsent.status).toBe(422)
    expect(noConsent.body.code).toBe('consent_required')
    const missing = await submit('LF-1001', { contact_name: 'No Email' })
    expect(missing.status).toBe(422)
    const ok = await submit('LF-5001', { company_name: 'Saudi Co', contact_name: 'Saudi Person', mobile: '0551234567' })
    expect(ok.status).toBe(200)
    const lead = leads.find((l) => l.id === subsOf('LF-5001').at(-1)!.leadId)!
    expect(lead).toMatchObject({ companyId: CREST, sourceType: 'Website', campaignId: 'CMP-5002' })
    expect(['u104', 'u105']).toContain(lead.ownerId)
  })

  it('honeypot: a fake success, stored as spam, no lead', async () => {
    const before = leads.length
    const r = await submit('LF-1001', { contact_name: 'Bot', email: email('bot'), company_name: 'Bots' }, { website: 'http://spam.example' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(leads.length).toBe(before)
    expect(subsOf('LF-1001').at(-1)).toMatchObject({ outcome: 'spam', leadId: null })
    const form = await apexAdmin('GET', '/marketing/forms/LF-1001')
    expect(form.body.stats.spam).toBe(2)
  })

  it('rate limit: per client, then per email → 429 rate_limited', async () => {
    for (let i = 0; i < FORM_SUBMIT_LIMIT; i++) {
      expect((await submit('LF-1001', { contact_name: 'Same Client', email: email(), company_name: 'Rate Co' }, {}, 'one-client')).status).toBe(200)
    }
    const r = await submit('LF-1001', { contact_name: 'Same Client', email: email(), company_name: 'Rate Co' }, {}, 'one-client')
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('rate_limited')
    const same = email('same')
    for (let i = 0; i < FORM_SUBMIT_LIMIT; i++) await submit('LF-1001', { contact_name: 'Same Email', email: same }, {}, `client-${i}`)
    expect((await submit('LF-1001', { contact_name: 'Same Email', email: same }, {}, 'client-x')).status).toBe(429)
  })

  it('paused form: the page shows it closed (200, accepting false); a submit → 409 form_paused', async () => {
    const page = await api(null, 'GET', `/public/forms/${keyOf('LF-5002')}`)
    expect(page.status).toBe(200)
    expect(page.body).toMatchObject({ accepting: false, name: 'Cold-chain brochure download' })
    const r = await submit('LF-5002', { contact_name: 'Late', email: email() })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('form_paused')
  })

  it('unknown key → 404; a company without the Marketing module → the same 404', async () => {
    const unknown = await api(null, 'GET', '/public/forms/zzzzzzzzzzzzzzzzzzzz')
    expect(unknown.status).toBe(404)
    expect((await api(null, 'POST', '/public/forms/zzzzzzzzzzzzzzzzzzzz/submit', { body: { values: {} } })).status).toBe(404)
    moduleOverrides.push({ companyId: CREST, module: 'marketing', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const off = await api(null, 'GET', `/public/forms/${keyOf('LF-5001')}`)
    expect(off.status).toBe(404)
    expect(off.text.replace(keyOf('LF-5001'), '<k>')).toBe(unknown.text.replace('zzzzzzzzzzzzzzzzzzzz', '<k>'))
    expect((await submit('LF-5001', { company_name: 'A', contact_name: 'B', mobile: '0551234567' })).status).toBe(404)
    // The authenticated side answers module_not_in_plan.
    expect((await crestAdmin('GET', '/marketing/forms')).body.code).toBe('module_not_in_plan')
  })

  it('views: each public load counts; stats give conversion, leads created and won deals', async () => {
    const before = leadForms.find((f) => f.id === 'LF-1002')!.views
    await api(null, 'GET', `/public/forms/${keyOf('LF-1002')}`)
    await api(null, 'GET', `/public/forms/${keyOf('LF-1002')}`)
    await submit('LF-1002', { contact_name: 'Won Later', email: email(), company_name: 'Won Later Co' })
    const lead = leads.find((l) => l.id === subsOf('LF-1002').at(-1)!.leadId)!
    lead.status = 'Won'
    const r = await apexAdmin('GET', '/marketing/forms/LF-1002')
    expect(r.body.stats).toMatchObject({ views: before + 2, submissions: 1, leads_created: 1, won_deals: 1 })
    expect(r.body.stats.conversion_rate).toBe(Math.round((1 / (before + 2)) * 1000) / 10)
  })
})

describe('forms: builder rules and roles', () => {
  const fields = [
    { key: 'contact_name', type: 'contact_name', label: 'Name', required: true },
    { key: 'email', type: 'email', label: 'Email', required: true },
  ]

  it('creates a form with a public key; the builder needs a required email or mobile, unique field types, own owners', async () => {
    const r = await apexAdmin('POST', '/marketing/forms', { name: 'Test form', default_source_id: 'Website', field_map: fields, default_owner_ids: ['u4'] })
    expect(r.status, r.text).toBe(200)
    expect(r.body).toMatchObject({ name: 'Test form', status: 'active', default_source_id: 'Website', default_owner_ids: ['u4'] })
    expect(r.body.public_key).toMatch(/^[a-z]{20}$/)
    expect((await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Website', field_map: [{ key: 'contact_name', type: 'contact_name', label: 'N', required: true }] })).status).toBe(422)
    expect((await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Website', field_map: [...fields, { key: 'email2', type: 'email', label: 'E', required: false }] })).status).toBe(422)
    expect((await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Nope', field_map: fields })).status).toBe(422)
    // Another company's user is refused exactly like a missing one.
    const foreign = await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Website', field_map: fields, default_owner_ids: ['u104'] })
    const missing = await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Website', field_map: fields, default_owner_ids: ['zz-missing'] })
    expect(foreign.status).toBe(422)
    expect(foreign.text).toBe(missing.text)
    // An owner who can't own leads (an accountant) is refused.
    expect((await apexAdmin('POST', '/marketing/forms', { name: 'X', default_source_id: 'Website', field_map: fields, default_owner_ids: ['u8'] })).status).toBe(422)
  })

  it('a form with submissions can’t be deleted (409); an unused one can', async () => {
    expect((await apexAdmin('DELETE', '/marketing/forms/LF-1001')).status).toBe(409)
    const r = await apexAdmin('POST', '/marketing/forms', { name: 'Throwaway', default_source_id: 'Website', field_map: fields })
    expect((await apexAdmin('DELETE', `/marketing/forms/${r.body.id}`)).status).toBe(200)
  })

  it('Sales Manager (Marketing view) reads but can’t change; Sales Agent (hidden) gets 403', async () => {
    expect((await api(userToken('u3'), 'GET', '/marketing/forms')).status).toBe(200)
    expect((await api(userToken('u3'), 'PATCH', '/marketing/forms/LF-1001', { body: { name: 'Nope' } })).status).toBe(403)
    expect((await api(userToken('u4'), 'GET', '/marketing/forms')).status).toBe(403)
  })
})

describe('landing pages', () => {
  it('slugs are unique per company: 409 slug_taken in the same company, fine in the other', async () => {
    const dup = await apexAdmin('POST', '/marketing/landing-pages', { slug: 'ai-chatbot-demo', title: 'Copy' })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('slug_taken')
    const other = await crestAdmin('POST', '/marketing/landing-pages', { slug: 'ai-chatbot-demo', title: 'Crest page', headline: 'Crest headline', form_id: 'LF-5001', published: true })
    expect(other.status, other.text).toBe(200)
    expect((await apexAdmin('POST', '/marketing/landing-pages', { slug: 'Bad Slug!', title: 'x' })).status).toBe(422)
    // Changing a slug to one already used by another page of the company → 409.
    expect((await apexAdmin('PATCH', '/marketing/landing-pages/LP-1002', { slug: 'ai-chatbot-demo' })).status).toBe(409)
    // A form of the other company is refused like a missing one.
    const foreign = await apexAdmin('POST', '/marketing/landing-pages', { slug: 'x-1', title: 'x', form_id: 'LF-5001' })
    const missing = await apexAdmin('POST', '/marketing/landing-pages', { slug: 'x-1', title: 'x', form_id: 'zz-missing' })
    expect(foreign.status).toBe(422)
    expect(foreign.text).toBe(missing.text)
  })

  it('the public page resolves the company from the workspace; unpublished / unknown → 404; views count', async () => {
    await crestAdmin('POST', '/marketing/landing-pages', { slug: 'ai-chatbot-demo', title: 'Crest page', headline: 'Crest headline', form_id: 'LF-5001', published: true })
    const apex = await api(null, 'GET', '/public/pages/ai-chatbot-demo', { headers: { 'X-Workspace': 'apexaora' } })
    expect(apex.status).toBe(200)
    expect(apex.body).toMatchObject({ title: 'AI chatbot for hotels | Book a demo', form: { name: 'AI chatbot demo request', accepting: true } })
    const crest = await api(null, 'GET', '/public/pages/ai-chatbot-demo', { headers: { 'X-Workspace': 'crest' } })
    expect(crest.status).toBe(200)
    expect(crest.body.headline).toBe('Crest headline')
    expect((await api(null, 'GET', '/public/pages/ai-chatbot-demo')).status).toBe(404)
    expect((await api(null, 'GET', '/public/pages/ocr-invoices', { headers: { 'X-Workspace': 'apexaora' } })).status).toBe(404)
    expect((await api(null, 'GET', '/public/pages/ai-chatbot-demo', { headers: { 'X-Workspace': 'nobody' } })).status).toBe(404)
    expect(landingPages.find((p) => p.id === 'LP-1001')!.views).toBe(165)
  })

  it('a submission from a landing page is attributed to it (channel landing, page submissions)', async () => {
    const r = await submit('LF-1002', { contact_name: 'From Page', email: email(), company_name: 'Page Co' }, { landing_page: 'ai-chatbot-demo' })
    expect(r.status).toBe(200)
    expect(subsOf('LF-1002').at(-1)).toMatchObject({ channel: 'landing', landingPageId: 'LP-1001' })
    const pages = await apexAdmin('GET', '/marketing/landing-pages')
    expect(pages.body.find((p: { id: string }) => p.id === 'LP-1001').submissions).toBe(1)
    // A slug of a page that doesn't embed this form is ignored.
    await submit('LF-1001', { contact_name: 'Other', email: email() }, { landing_page: 'ai-chatbot-demo' })
    expect(subsOf('LF-1001').at(-1)).toMatchObject({ channel: 'hosted', landingPageId: null })
  })
})

describe('UTM links', () => {
  it('builds the tagged URL (existing query kept) and saves it; a foreign campaign is refused like a missing one', async () => {
    const r = await apexAdmin('POST', '/marketing/utm-links', { base_url: 'https://apexaora.ae/offer?lang=en', utm_source: 'linkedin', utm_medium: 'paid', utm_campaign: 'q4-outreach', campaign_id: 'CMP-1001' })
    expect(r.status, r.text).toBe(200)
    expect(r.body.url).toBe('https://apexaora.ae/offer?lang=en&utm_source=linkedin&utm_medium=paid&utm_campaign=q4-outreach')
    expect(r.body.campaign_name).toBe('Q4 LinkedIn outreach')
    expect((await apexAdmin('POST', '/marketing/utm-links', { base_url: 'https://x.example', utm_source: 'a b', utm_medium: 'x' })).status).toBe(422)
    expect((await apexAdmin('POST', '/marketing/utm-links', { base_url: 'notaurl', utm_source: 'a', utm_medium: 'x' })).status).toBe(422)
    const foreign = await apexAdmin('POST', '/marketing/utm-links', { base_url: 'https://x.example', utm_source: 'a', utm_medium: 'b', campaign_id: 'CMP-5001' })
    const missing = await apexAdmin('POST', '/marketing/utm-links', { base_url: 'https://x.example', utm_source: 'a', utm_medium: 'b', campaign_id: 'zz-missing' })
    expect(foreign.status).toBe(422)
    expect(foreign.text).toBe(missing.text)
  })

  it('buildUtmUrl keeps the #hash and drops empty values', () => {
    expect(buildUtmUrl('https://a.example/p#form', { utmSource: 'x', utmMedium: 'y', utmCampaign: '', utmTerm: '', utmContent: 'c' })).toBe('https://a.example/p?utm_source=x&utm_medium=y&utm_content=c#form')
  })
})
