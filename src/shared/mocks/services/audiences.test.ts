import { describe, expect, it } from 'vitest'
import { contacts, leads } from '@/shared/mocks/db'
import { bulkEmailRecipients } from '@/shared/mocks/data/marketing'
import { audiences } from '@/shared/mocks/data/marketingGrowth'
import { statusOf } from '@/shared/mocks/data/lookups'
import { sha256Hex } from '@/shared/mocks/services/audiences'
import { APEX, CREST, api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * Audiences through the real handlers: rule resolution (industries, statuses and status types,
 * sources, campaigns, events, owners, dates, has email), Do Not Contact always left out (rules,
 * frozen lists, exports), static vs dynamic, bulk emails resolving the audience again at send time,
 * CSV / SHA-256 exports.
 */

useSeedPerTest()

/** Independent SHA-256 hex (WebCrypto, no app code). */
async function sha256(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const apexAdmin = (method: string, path: string, body?: unknown) => api(userToken('u1'), method, path, { body })
const crestAdmin = (method: string, path: string, body?: unknown) => api(userToken('u101'), method, path, { body })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const apexLeads = () => leads.filter((l) => l.companyId === APEX)
const preview = async (rules: Record<string, unknown>) => {
  const r = await apexAdmin('POST', '/marketing/audiences/preview', { rules })
  expect(r.status, r.text).toBe(200)
  return r.body as { counts: { leads: number; emails: number; excluded_dnc: number }; members: { lead_id: string }[] }
}

describe('rule resolution', () => {
  it('industries / statuses / sources / owners combine with AND; Do Not Contact is always left out', async () => {
    const expected = apexLeads().filter((l) => l.industry === 'Healthcare')
    const p = await preview({ industries: ['Healthcare'] })
    expect(p.counts.leads).toBe(expected.filter((l) => !l.doNotContact).length)
    expect(p.counts.excluded_dnc).toBe(expected.filter((l) => l.doNotContact).length)
    // Mark one as Do Not Contact: it leaves the audience and is counted as left out.
    const target = expected.find((l) => !l.doNotContact)!
    target.doNotContact = true
    const after = await preview({ industries: ['Healthcare'] })
    expect(after.counts.leads).toBe(p.counts.leads - 1)
    expect(after.counts.excluded_dnc).toBe(p.counts.excluded_dnc + 1)
    expect(after.members.map((m) => m.lead_id)).not.toContain(target.id)

    const owner = apexLeads()[0].ownerId
    const both = await preview({ industries: ['Healthcare'], owner_ids: [owner] })
    expect(both.counts.leads).toBe(apexLeads().filter((l) => l.industry === 'Healthcare' && l.ownerId === owner && !l.doNotContact).length)
    const src = await preview({ sources: ['Website'] })
    expect(src.counts.leads).toBe(apexLeads().filter((l) => l.sourceType === 'Website' && !l.doNotContact).length)
  })

  it('status types match every status of that type; statuses and status types are OR-ed', async () => {
    const won = await preview({ status_types: ['won'] })
    expect(won.counts.leads).toBe(apexLeads().filter((l) => statusOf(APEX, l.status)?.type === 'won' && !l.doNotContact).length)
    const mix = await preview({ statuses: ['New'], status_types: ['won'] })
    expect(mix.counts.leads).toBe(apexLeads().filter((l) => (l.status === 'New' || statusOf(APEX, l.status)?.type === 'won') && !l.doNotContact).length)
    expect((await apexAdmin('POST', '/marketing/audiences/preview', { rules: { status_types: ['maybe'] } })).status).toBe(422)
  })

  it('events attended, campaigns, created dates, last activity and has-email', async () => {
    const ev = await preview({ event_ids: ['EV-1001'] })
    expect(ev.counts.leads).toBeGreaterThan(0)
    expect(ev.counts.leads).toBe(apexLeads().filter((l) => l.eventId === 'EV-1001' && !l.doNotContact).length)
    const cmp = await preview({ campaign_ids: ['CMP-1001'] })
    expect(cmp.counts.leads).toBe(apexLeads().filter((l) => l.campaignId === 'CMP-1001' && !l.doNotContact).length)
    expect((await preview({ created_from: '2999-01-01' })).counts.leads).toBe(0)
    expect((await preview({ last_activity_after: '2999-01-01' })).counts.leads).toBe(0)
    expect((await preview({ last_activity_before: '2999-01-01' })).counts.leads).toBe(apexLeads().filter((l) => !l.doNotContact).length)
    const noEmail = apexLeads().find((l) => !l.doNotContact)!
    noEmail.contactEmail = ''
    for (const c of contacts) if (c.leadId === noEmail.id) c.email = ''
    const has = await preview({ has_email: true })
    expect(has.members.map((m) => m.lead_id)).not.toContain(noEmail.id)
    expect((await apexAdmin('POST', '/marketing/audiences/preview', { rules: { created_from: 'yesterday' } })).status).toBe(422)
  })

  it('ids of another company in the rules are refused exactly like missing ones', async () => {
    for (const [key, foreign] of [['campaign_ids', 'CMP-5001'], ['event_ids', 'EV-5001'], ['owner_ids', 'u104']] as const) {
      const theirs = await apexAdmin('POST', '/marketing/audiences', { name: `x ${key}`, rules: { [key]: [foreign] } })
      const missing = await apexAdmin('POST', '/marketing/audiences', { name: `x ${key}`, rules: { [key]: ['zz-missing'] } })
      expect(theirs.status, key).toBe(422)
      expect(theirs.text, key).toBe(missing.text)
    }
  })
})

describe('static vs dynamic', () => {
  it('a static audience keeps its frozen members; dynamic follows the data; freeze re-snapshots', async () => {
    const rules = { sources: ['Website'] }
    const dyn = await apexAdmin('POST', '/marketing/audiences', { name: 'Web dynamic', rules, kind: 'dynamic' })
    const sta = await apexAdmin('POST', '/marketing/audiences', { name: 'Web static', rules, kind: 'static' })
    expect(sta.body.frozen_at).toBeTruthy()
    expect(sta.body.counts.leads).toBe(dyn.body.counts.leads)
    const created = await apexAdmin('POST', '/leads', {
      company_name: 'New Web Lead LLC',
      source_id: 'Website',
      industry_id: 'Healthcare',
      contacts: [{ name: 'Web Person', title: '', mobile: '+971 50 555 0199', email: 'web.person@newweb.example.org', is_decision_maker: false }],
      next_follow_up_date: null,
    })
    expect(created.status, created.text).toBe(200)
    expect((await apexAdmin('GET', `/marketing/audiences/${dyn.body.id}`)).body.counts.leads).toBe(dyn.body.counts.leads + 1)
    expect((await apexAdmin('GET', `/marketing/audiences/${sta.body.id}`)).body.counts.leads).toBe(sta.body.counts.leads)
    // A frozen member that becomes Do Not Contact is still left out.
    const member = leads.find((l) => audiences.find((a) => a.id === sta.body.id)!.memberLeadIds.includes(l.id))!
    member.doNotContact = true
    expect((await apexAdmin('GET', `/marketing/audiences/${sta.body.id}`)).body.counts.leads).toBe(sta.body.counts.leads - 1)
    const frozen = await apexAdmin('POST', `/marketing/audiences/${sta.body.id}/freeze`)
    expect(frozen.body.counts.leads).toBe(sta.body.counts.leads)
    expect(frozen.body.kind).toBe('static')
  })

  it('roles: view reads, full writes and exports', async () => {
    expect((await api(userToken('u3'), 'GET', '/marketing/audiences')).status).toBe(200)
    expect((await api(userToken('u3'), 'POST', '/marketing/audiences', { body: { name: 'No' } })).status).toBe(403)
    expect((await api(userToken('u3'), 'GET', '/marketing/audiences/AUD-1001/export')).status).toBe(403)
    expect((await api(userToken('u4'), 'GET', '/marketing/audiences')).status).toBe(403)
  })
})

describe('bulk email with a saved audience', () => {
  it('the audience is resolved again at send time; every exclusion still applies', async () => {
    // Clean data for a predictable audience: Apex leads owned by u4, with unique emails.
    const mine = apexLeads().filter((l) => l.ownerId === 'u4')
    mine.forEach((l, i) => {
      l.doNotContact = false
      l.status = 'Contacted'
      l.contactEmail = `aud${i}@apex.example.org`
    })
    const aud = await apexAdmin('POST', '/marketing/audiences', { name: 'u4 leads', rules: { owner_ids: ['u4'] } })
    expect(aud.status, aud.text).toBe(200)
    const created = await apexAdmin('POST', '/marketing/emails', { name: 'To the audience', subject: 'Hello {{lead.firstName}}', body: 'Hi', filters: { audience_id: aud.body.id } })
    expect(created.status, created.text).toBe(200)
    expect(created.body.filters.audience_id).toBe(aud.body.id)
    const id = created.body.id
    const p1 = await apexAdmin('POST', `/marketing/emails/${id}/preview-audience`)
    expect(p1.body.matched).toBe(mine.length)

    // Data changes after saving: a new lead of u4 joins, one becomes Do Not Contact.
    leads.push({ ...mine[0], id: 'L-AUD-NEW', contactEmail: 'new.member@apex.example.org', company: 'New Member LLC' })
    mine[1].doNotContact = true
    const p2 = await apexAdmin('POST', `/marketing/emails/${id}/preview-audience`)
    expect(p2.body.matched).toBe(mine.length + 1)
    expect(p2.body.excluded.dnc).toBe(1)

    const send = await apexAdmin('POST', `/marketing/emails/${id}/send-now`)
    expect(send.status, send.text).toBe(200)
    const rows = bulkEmailRecipients.filter((r) => r.bulkEmailId === id)
    expect(rows.some((r) => r.leadId === 'L-AUD-NEW')).toBe(true)
    expect(rows.find((r) => r.leadId === mine[1].id)).toMatchObject({ status: 'skipped', skipReason: 'dnc' })
    expect(rows.every((r) => leads.find((l) => l.id === r.leadId)?.ownerId === 'u4')).toBe(true)
  })

  it('another company’s audience id is refused like a missing one; a deleted audience leaves nobody to send to', async () => {
    const theirs = await apexAdmin('POST', '/marketing/emails', { name: 'x', filters: { audience_id: 'AUD-5001' } })
    const missing = await apexAdmin('POST', '/marketing/emails', { name: 'x', filters: { audience_id: 'zz-missing' } })
    expect(theirs.status).toBe(422)
    expect(theirs.text).toBe(missing.text)
    const e = await apexAdmin('POST', '/marketing/emails', { name: 'x', subject: 'S', body: 'B', filters: { audience_id: 'AUD-1001' } })
    await apexAdmin('DELETE', '/marketing/audiences/AUD-1001')
    const send = await apexAdmin('POST', `/marketing/emails/${e.body.id}/send-now`)
    expect(send.status).toBe(422)
  })
})

describe('export for ad platforms', () => {
  it('plain CSV: lower-case unique emails of the members and their contacts, never Do Not Contact', async () => {
    const r = await crestAdmin('GET', '/marketing/audiences/AUD-5001/export')
    expect(r.status, r.text).toBe(200)
    const lines = (r.body.content as string).trim().split('\n')
    expect(lines[0]).toBe('email')
    expect(r.body.rows).toBe(lines.length - 1)
    expect(r.body.file_name).toBe('cold-leads-to-re-engage.csv')
    const values = lines.slice(1)
    expect(new Set(values).size).toBe(values.length)
    expect(values.every((v) => EMAIL_RE.test(v) && v === v.toLowerCase())).toBe(true)
    const dnc = leads.filter((l) => l.companyId === CREST && l.doNotContact && l.contactEmail).map((l) => l.contactEmail.toLowerCase())
    expect(values.some((v) => dnc.includes(v))).toBe(false)
    const withoutContacts = await crestAdmin('GET', '/marketing/audiences/AUD-5001/export?include_contacts=false')
    expect(withoutContacts.body.rows).toBeLessThanOrEqual(r.body.rows)
  })

  it('hashed: SHA-256 hex of each trimmed, lower-cased email', async () => {
    const plain = await crestAdmin('GET', '/marketing/audiences/AUD-5001/export')
    const hashed = await crestAdmin('GET', '/marketing/audiences/AUD-5001/export?hashed=true')
    expect(hashed.status).toBe(200)
    const lines = (hashed.body.content as string).trim().split('\n')
    expect(lines[0]).toBe('email_sha256')
    expect(hashed.body.hashed).toBe(true)
    const emails = (plain.body.content as string).trim().split('\n').slice(1)
    expect(lines.slice(1)).toEqual(await Promise.all(emails.map(sha256)))
    expect(await sha256Hex('  Name@Example.COM ')).toBe(await sha256('name@example.com'))
    // Known vector: SHA-256 of the empty string.
    expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
