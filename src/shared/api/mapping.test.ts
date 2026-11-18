import { describe, expect, it } from 'vitest'
import { contacts, leads } from '@/shared/mocks/db'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { untenant, toRow } from '@/shared/mocks/services/leads'
import { defineMapper, toCamel, toSnake } from '@/shared/api/mapping'
import {
  contactRowMapper,
  importRequestMapper,
  importResultMapper,
  leadInputMapper,
  leadMapper,
  LOOKUP_LIST_API,
  lookupListFromApi,
  lookupsMapper,
} from '@/shared/api/mappers'

/** Every key of a JSON value, recursively (to check a payload is all snake_case). */
function keysOf(v: unknown, skip: readonly string[] = []): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => keysOf(x, skip))
  if (!v || typeof v !== 'object') return []
  return Object.entries(v).flatMap(([k, x]) => (skip.includes(k) ? [k] : [k, ...keysOf(x, skip)]))
}
const notSnake = (keys: string[]) => keys.filter((k) => !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(k))

describe('defineMapper', () => {
  const child = defineMapper<{ isDecisionMaker: boolean }>({ fields: { isDecisionMaker: 'is_decision_maker' } })
  const m = defineMapper<{ company: string; ownerId: string; contacts: { isDecisionMaker: boolean }[]; extra?: { a: number }; decisions: Record<number, string> }>({
    fields: { company: 'company_name' },
    nested: { contacts: child as never, extra: child as never },
    opaque: ['decisions'],
  })

  it('renames explicit fields, converts the rest mechanically, maps nested arrays and objects', () => {
    const ui = { company: 'Acme', ownerId: 'u1', contacts: [{ isDecisionMaker: true }], extra: { a: 1 }, decisions: { 2: 'skip' } }
    const api = m.toApi(ui)
    expect(api).toEqual({ company_name: 'Acme', owner_id: 'u1', contacts: [{ is_decision_maker: true }], extra: { a: 1 }, decisions: { 2: 'skip' } })
    expect(m.fromApi(api)).toEqual(ui)
  })

  it('leaves opaque values untouched in both directions (keys inside are data)', () => {
    const api = m.toApi({ decisions: { 1: 'import', 12: 'skip' } } as never)
    expect(api.decisions).toEqual({ 1: 'import', 12: 'skip' })
    expect(m.fromApi({ decisions: { some_key: 'x' } }).decisions).toEqual({ some_key: 'x' })
  })

  it('maps arrays of records and passes null / primitives through', () => {
    expect(m.toApi([{ ownerId: 'a' }, { ownerId: 'b' }] as never)).toEqual([{ owner_id: 'a' }, { owner_id: 'b' }])
    expect(m.fromApiList([{ owner_id: 'a' }])).toEqual([{ ownerId: 'a' }])
    expect(m.fromApiList(null)).toEqual([])
    expect(m.toApi({ ownerId: null, contacts: null } as never)).toEqual({ owner_id: null, contacts: null })
  })

  it('refuses two UI fields mapped to the same API column', () => {
    expect(() => defineMapper({ fields: { a: 'x', b: 'x' } })).toThrow(/mapped from both/)
  })

  it('snake / camel helpers', () => {
    expect(toSnake('recommendedServiceId')).toBe('recommended_service_id')
    expect(toSnake('nextFollowUpDate')).toBe('next_follow_up_date')
    expect(toCamel('no_response_attempts')).toBe('noResponseAttempts')
    expect(toCamel('status')).toBe('status')
  })
})

describe('resource mappers', () => {
  const lead = leads.find((l) => l.companyId === 'co_apex' && contacts.some((c) => c.leadId === l.id))!
  const detail = { ...toRow(lead), contacts: contacts.filter((c) => c.leadId === lead.id).map(untenant), website: 'https://example.ae' }

  it('a lead detail goes out with the leads / contacts column names only, and comes back identical', () => {
    const api = leadMapper.toApi(detail)
    expect(notSnake(keysOf(api))).toEqual([])
    expect(api).toMatchObject({
      id: lead.id,
      company_name: lead.company,
      status_id: lead.status,
      source_id: lead.sourceType,
      industry_id: lead.industry,
      owner_id: lead.ownerId,
      email: lead.contactEmail,
      phone: lead.mobile,
      next_follow_up_date: lead.nextFollowUpDate,
      do_not_contact: lead.doNotContact,
      recommended_service_id: lead.recommendedServiceId,
      estimated_value: lead.value,
    })
    expect((api.contacts as Record<string, unknown>[])[0]).toHaveProperty('is_decision_maker')
    expect((api.contacts as Record<string, unknown>[])[0]).toHaveProperty('lead_id', lead.id)
    expect(leadMapper.fromApi(JSON.parse(JSON.stringify(api)))).toEqual(detail)
  })

  it('the quick-add body keeps its own email / phone (no clash with the lead row’s contact email)', () => {
    const body = { company: 'Acme', contactName: 'Sam', mobile: '+971 50 000 0000', email: 's@acme.ae', sourceType: 'Website', industry: 'Retail' }
    const api = leadInputMapper.toApi(body as never)
    expect(api).toEqual({ company_name: 'Acme', contact_name: 'Sam', phone: '+971 50 000 0000', email: 's@acme.ae', source_id: 'Website', industry_id: 'Retail' })
    expect(leadInputMapper.fromApi(api)).toEqual(body)
  })

  it('contact rows map record_type / record_id / company_name', () => {
    const row = { id: 'CT-1', leadId: 'L-1', name: 'A', title: '', mobile: '', email: '', isDecisionMaker: false, company: 'Acme', recordType: 'Lead' as const, recordId: 'L-1', ownerName: 'X' }
    const api = contactRowMapper.toApi(row)
    expect(notSnake(keysOf(api))).toEqual([])
    expect(api).toMatchObject({ company_name: 'Acme', record_type: 'Lead', record_id: 'L-1', is_decision_maker: false })
    expect(contactRowMapper.fromApi(api)).toEqual(row)
  })

  it('import: decisions stay keyed by row number; the limit details keep the 402 envelope shape', () => {
    const req = { rows: [], decisions: { 3: 'skip' as const }, ownerRule: 'auto' as const }
    expect(importRequestMapper.toApi(req)).toEqual({ rows: [], decisions: { 3: 'skip' }, owner_rule: 'auto' })
    const res = { created: 1, skipped: 0, failed: [{ row: 2, company: 'X', reason: 'r' }], skippedRows: [], createdIds: ['L-1'], skippedForLimit: 0, limitReached: { limitKey: 'leadsContacts' } as never }
    const api = importResultMapper.toApi(res)
    expect(api).toMatchObject({ imported_rows: 1, duplicate_rows: 0, failures: [{ row: 2, company_name: 'X', reason: 'r' }], created_ids: ['L-1'], limit_reached: { limitKey: 'leadsContacts' } })
    expect(importResultMapper.fromApi(api)).toEqual(res)
  })

  it('lookups: table names, lead_statuses columns and flags, industries tree', () => {
    const lookups = lookupsFor('co_apex')
    const api = lookupsMapper.toApi(lookups)
    expect(Object.keys(api).sort()).toEqual(Object.values(LOOKUP_LIST_API).sort())
    expect(notSnake(keysOf(api))).toEqual([])
    const interested = (api.lead_statuses as Record<string, unknown>[]).find((s) => s.code === 'Interested')
    expect(interested).toMatchObject({ name: 'Interested', type: 'open', requires_next_step: true, requires_loss_reason: false, is_active: true })
    expect((api.industries as Record<string, unknown>[])[0]).toHaveProperty('sub_industries')
    expect(lookupsMapper.fromApi(JSON.parse(JSON.stringify(api)))).toEqual(JSON.parse(JSON.stringify(lookups)))
    expect(lookupListFromApi('lead_statuses')).toBe('statuses')
    expect(lookupListFromApi('statuses')).toBeNull()
  })
})

describe('deep mappers (aggregates)', () => {
  const m = defineMapper<{ wonValue: number; byMonth: Record<string, number>; rows: { ownerId: string; perStatus: Record<string, number> }[] }>({
    deep: true,
    opaque: ['byMonth', 'perStatus'],
  })
  const ui = { wonValue: 5, byMonth: { '2026-11': 1, inProgress: 2 }, rows: [{ ownerId: 'u1', perStatus: { Not_contacted: 3, newLead: 1 } }] }

  it('converts nested keys at any depth and leaves opaque maps untouched', () => {
    const api = m.toApi(ui)
    expect(api).toEqual({ won_value: 5, by_month: { '2026-11': 1, inProgress: 2 }, rows: [{ owner_id: 'u1', per_status: { Not_contacted: 3, newLead: 1 } }] })
    expect(m.fromApi(api)).toEqual(ui)
  })

  it('a shallow mapper still leaves undeclared nested objects as they are', () => {
    expect(defineMapper().toApi({ rows: [{ ownerId: 'u1' }] } as never)).toEqual({ rows: [{ ownerId: 'u1' }] })
  })
})
