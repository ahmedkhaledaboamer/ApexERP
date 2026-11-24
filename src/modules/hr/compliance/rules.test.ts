import { describe, expect, it } from 'vitest'
import { defaultExpiryMonths, disciplinaryStatus, dueReminder, escalationHint, expiryDate, inAudience, pct, policyBlocks } from './rules'

describe('discipline rules', () => {
  it('default expiry by type and the expiry date (end of month clamped; 0 = never)', () => {
    expect([defaultExpiryMonths('verbal_warning'), defaultExpiryMonths('written_warning'), defaultExpiryMonths('final_warning'), defaultExpiryMonths('deduction')]).toEqual([6, 12, 12, 0])
    expect(expiryDate('2026-11-23', 6)).toBe('2027-05-23')
    expect(expiryDate('2026-08-31', 6)).toBe('2027-02-28')
    expect(expiryDate('2026-11-23', 12)).toBe('2027-11-23')
    expect(expiryDate('2026-11-23', 0)).toBeNull()
  })

  it('status: active until the expiry date, lapsed after it; withdrawn wins', () => {
    const r = { withdrawnAt: null, expiresOn: '2027-05-23' }
    expect(disciplinaryStatus(r, '2027-05-23')).toBe('active')
    expect(disciplinaryStatus(r, '2027-05-24')).toBe('expired')
    expect(disciplinaryStatus({ withdrawnAt: 'x', expiresOn: null }, '2026-01-01')).toBe('withdrawn')
    expect(disciplinaryStatus({ withdrawnAt: null, expiresOn: null }, '2099-01-01')).toBe('active')
  })

  it('escalation: 2 verbal → written; 1 written → written; 2 written → final; an active final → HR decides', () => {
    expect(escalationHint([]).suggestion).toBeNull()
    expect(escalationHint([{ type: 'verbal_warning' }, { type: 'verbal_warning' }]).suggestion).toBe('written_warning')
    expect(escalationHint([{ type: 'written_warning' }]).suggestion).toBe('written_warning')
    const two = escalationHint([{ type: 'written_warning' }, { type: 'written_warning' }, { type: 'deduction' }])
    expect([two.suggestion, two.activeWritten]).toEqual(['final_warning', 2])
    const fin = escalationHint([{ type: 'final_warning' }, { type: 'written_warning' }, { type: 'written_warning' }])
    expect([fin.suggestion, fin.activeFinal]).toEqual([null, 1])
    expect(fin.message).toMatch(/final warning/)
  })
})

describe('policy rules', () => {
  it('reminders: at publish, +3, +7 days — once each; a late tick sends only the latest and marks the earlier ones', () => {
    expect(dueReminder('2026-11-01', '2026-11-01', 1, [])).toEqual({ send: 'v1:d0', mark: ['v1:d0'] })
    expect(dueReminder('2026-11-01', '2026-11-02', 1, ['v1:d0'])).toEqual({ send: null, mark: [] })
    expect(dueReminder('2026-11-01', '2026-11-04', 1, ['v1:d0'])).toEqual({ send: 'v1:d3', mark: ['v1:d3'] })
    expect(dueReminder('2026-11-01', '2026-11-20', 1, [])).toEqual({ send: 'v1:d7', mark: ['v1:d0', 'v1:d3', 'v1:d7'] })
    expect(dueReminder('2026-11-01', '2026-11-20', 1, ['v1:d0', 'v1:d3', 'v1:d7'])).toEqual({ send: null, mark: [] })
    // A new version starts over.
    expect(dueReminder('2026-11-10', '2026-11-10', 2, ['v1:d0', 'v1:d3', 'v1:d7']).send).toBe('v2:d0')
  })

  it('audience: all / departments with sub-departments / roles', () => {
    const tree = (id: string) => (id === 'd-sales' ? ['d-sales', 'd-sales-ksa'] : [id])
    const who = { departmentId: 'd-sales-ksa', role: 'Sales Agent' }
    expect(inAudience({ kind: 'all', departmentIds: [], roles: [] }, who, tree)).toBe(true)
    expect(inAudience({ kind: 'departments', departmentIds: ['d-sales'], roles: [] }, who, tree)).toBe(true)
    expect(inAudience({ kind: 'departments', departmentIds: ['d-hr'], roles: [] }, who, tree)).toBe(false)
    expect(inAudience({ kind: 'roles', departmentIds: [], roles: ['Sales Agent'] }, who, tree)).toBe(true)
    expect(inAudience({ kind: 'roles', departmentIds: [], roles: ['Employee'] }, who, tree)).toBe(false)
  })

  it('percentages and the light text format (headings, bullets, bold; no HTML)', () => {
    expect([pct(1, 3), pct(0, 0), pct(2, 2)]).toEqual([33.3, 0, 100])
    const b = policyBlocks('# Title\n\nSome **bold** text\n- item <b>x</b>')
    expect(b.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'bullet'])
    expect(b[1].runs).toEqual([{ text: 'Some ', bold: false }, { text: 'bold', bold: true }, { text: ' text', bold: false }])
    expect(b[2].runs[0].text).toBe('item <b>x</b>')
  })
})
