import { describe, expect, it } from 'vitest'
import {
  PLATFORM_ROLE_PERMISSIONS,
  companyCapabilities,
  platformHome,
  platformPermissions,
  visiblePlatformNav,
} from '@/modules/platform/permissions'
import { buildCsv, csvCell, csvFileName } from '@/modules/platform/csv'
import { countdownLabel, formatCountdown, msUntil } from '@/modules/platform/countdown'
import { auditFacets, auditQuery, changedKeys, EMPTY_AUDIT_FILTERS, filterAudit, filterCompanies } from '@/modules/platform/filters'
import type { PlatformAuditEntry, PlatformCompanyRow } from '@/modules/platform/types'

const navIds = (role: keyof typeof PLATFORM_ROLE_PERMISSIONS) => visiblePlatformNav(PLATFORM_ROLE_PERMISSIONS[role]).map((i) => i.id)

describe('platform permissions → navigation', () => {
  it('Owner sees every item', () => {
    expect(navIds('Platform Owner')).toEqual(['overview', 'companies', 'plans', 'settings', 'announcements', 'audit'])
  })
  it('Support sees companies and the audit log, not plans/settings/announcements', () => {
    expect(navIds('Platform Support')).toEqual(['overview', 'companies', 'audit'])
  })
  it('Billing sees plans and settings, not announcements or audit', () => {
    expect(navIds('Platform Billing')).toEqual(['overview', 'companies', 'plans', 'settings'])
  })
  it('no permissions → nothing visible, home falls back to /platform', () => {
    expect(visiblePlatformNav([])).toEqual([])
    expect(platformHome([])).toBe('/platform')
  })
  it('plans is visible with billing:view alone (read only)', () => {
    expect(visiblePlatformNav(['billing:view']).map((i) => i.id)).toEqual(['plans'])
    expect(platformHome(['audit:view'])).toBe('/platform/audit')
  })
  it('prefers a server-provided permission list and drops unknown names', () => {
    expect(platformPermissions({ platformRole: 'Platform Owner', permissions: ['audit:view', 'nope'] })).toEqual(['audit:view'])
    expect(platformPermissions({ platformRole: 'Platform Support' })).toContain('support:notes')
  })
  it('company capabilities follow the permissions', () => {
    const support = companyCapabilities(PLATFORM_ROLE_PERMISSIONS['Platform Support'])
    expect(support).toEqual({ manage: false, billingView: false, billingManage: false, subdomain: false, impersonate: true, notes: true })
    const billing = companyCapabilities(PLATFORM_ROLE_PERMISSIONS['Platform Billing'])
    expect(billing.billingManage && billing.billingView && !billing.manage && !billing.impersonate).toBe(true)
  })
})

describe('CSV export builder', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12.5)).toBe('12.5')
  })
  it('neutralises formula cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell(-5)).toBe('-5')
  })
  it('builds header + rows with CRLF', () => {
    const csv = buildCsv(
      [
        { n: 'Apex', u: 3 },
        { n: 'Crest, LLC', u: null },
      ],
      [
        { header: 'Name', value: (r) => r.n },
        { header: 'Users', value: (r) => r.u },
      ],
    )
    expect(csv).toBe('Name,Users\r\nApex,3\r\n"Crest, LLC",')
  })
  it('names the file by date', () => {
    expect(csvFileName('companies', new Date('2026-11-18T10:00:00Z'))).toBe('companies-2026-11-18.csv')
  })
})

describe('countdown formatting', () => {
  it('formats mm:ss and rounds up', () => {
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(1)).toBe('00:01')
    expect(formatCountdown(59_000)).toBe('00:59')
    expect(formatCountdown(60_000)).toBe('01:00')
    expect(formatCountdown(15 * 60_000 - 500)).toBe('15:00')
    expect(formatCountdown(75 * 60_000)).toBe('75:00')
    expect(formatCountdown(-5000)).toBe('00:00')
  })
  it('computes time left from an ISO date', () => {
    const now = Date.parse('2026-11-18T10:00:00Z')
    expect(msUntil('2026-11-18T10:05:00Z', now)).toBe(300_000)
    expect(msUntil('2026-11-18T09:00:00Z', now)).toBe(0)
    expect(msUntil(null, now)).toBe(0)
    expect(msUntil('garbage', now)).toBe(0)
  })
  it('has a spoken label', () => {
    expect(countdownLabel(61_000)).toBe('1 minute 1 second left')
    expect(countdownLabel(120_000)).toBe('2 minutes left')
    expect(countdownLabel(0)).toBe('0 seconds left')
  })
})

const entry = (over: Partial<PlatformAuditEntry>): PlatformAuditEntry => ({
  id: 'a',
  at: '2026-11-10T10:00:00.000Z',
  actorId: 'p1',
  actorName: 'Olivia Owner',
  actorRole: 'Platform Owner',
  action: 'company.suspended',
  companyId: 'co_apex',
  companyName: 'Apex',
  summary: 'Suspended Apex',
  before: { status: 'active' },
  after: { status: 'suspended' },
  reason: 'Fraud review',
  ip: '10.0.0.1',
  ...over,
})

describe('audit filters', () => {
  const rows = [
    entry({ id: '1' }),
    entry({ id: '2', actorId: 'p2', actorName: 'Sam Support', actorRole: 'Platform Support', action: 'impersonation.started', at: '2026-11-15T08:00:00.000Z', reason: 'Ticket 4411' }),
    entry({ id: '3', action: 'plan.updated', companyId: null, companyName: null, at: '2026-11-17T23:30:00.000Z', summary: 'Edited Business', reason: null }),
  ]
  it('drops empty fields from the query', () => {
    expect(auditQuery(EMPTY_AUDIT_FILTERS)).toEqual({})
    expect(auditQuery({ ...EMPTY_AUDIT_FILTERS, actor: 'p1', q: '  x ' })).toEqual({ actor: 'p1', q: 'x' })
  })
  it('turns dates into an inclusive range', () => {
    const q = auditQuery({ ...EMPTY_AUDIT_FILTERS, from: '2026-11-15', to: '2026-11-15' })
    expect(Date.parse(q.to!) - Date.parse(q.from!)).toBe(86_400_000 - 1)
    expect(auditQuery({ ...EMPTY_AUDIT_FILTERS, from: 'nope' })).toEqual({})
  })
  it('filters by actor, action (prefix), company and text', () => {
    expect(filterAudit(rows, { actor: 'p2' }).map((e) => e.id)).toEqual(['2'])
    expect(filterAudit(rows, { action: 'company' }).map((e) => e.id)).toEqual(['1'])
    expect(filterAudit(rows, { action: 'plan.updated' }).map((e) => e.id)).toEqual(['3'])
    expect(filterAudit(rows, { companyId: 'co_apex' }).map((e) => e.id)).toEqual(['1', '2'])
    expect(filterAudit(rows, { q: 'ticket' }).map((e) => e.id)).toEqual(['2'])
  })
  it('filters by date range', () => {
    const q = { from: '2026-11-14T00:00:00.000Z', to: '2026-11-16T00:00:00.000Z' }
    expect(filterAudit(rows, q).map((e) => e.id)).toEqual(['2'])
  })
  it('lists facets', () => {
    const f = auditFacets(rows)
    expect(f.actions).toEqual(['company.suspended', 'impersonation.started', 'plan.updated'])
    expect(f.actors.map((a) => a.value)).toEqual(['p1', 'p2'])
    expect(f.companies).toEqual([{ value: 'co_apex', label: 'Apex' }])
  })
  it('finds changed keys', () => {
    expect(changedKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(['b', 'c'])
    expect(changedKeys(null, null)).toEqual([])
  })
})

describe('company filters', () => {
  const row = (over: Partial<PlatformCompanyRow>): PlatformCompanyRow => ({
    id: 'co_apex',
    name: 'Apex',
    subdomain: 'apex',
    country: 'AE',
    planId: 'business',
    planName: 'Business',
    companyStatus: 'active',
    subscriptionStatus: 'active',
    users: 3,
    lastActivityAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    mrr: null,
    ...over,
  })
  const rows = [
    row({}),
    row({ id: 'co_crest', name: 'Crest', subdomain: 'crest', country: 'SA', planId: 'trial', subscriptionStatus: 'trialing' }),
    row({ id: 'co_x', name: 'Locked Co', subdomain: 'locked', companyStatus: 'suspended' }),
  ]
  it('filters by status, locked, plan, country and search', () => {
    expect(filterCompanies(rows, { status: 'trialing' }).map((r) => r.id)).toEqual(['co_crest'])
    expect(filterCompanies(rows, { status: 'locked' }).map((r) => r.id)).toEqual(['co_x'])
    expect(filterCompanies(rows, { plan: 'business', country: 'AE' }).map((r) => r.id)).toEqual(['co_apex', 'co_x'])
    expect(filterCompanies(rows, { q: 'CRE' }).map((r) => r.id)).toEqual(['co_crest'])
    expect(filterCompanies(rows, {}).length).toBe(3)
  })
})
