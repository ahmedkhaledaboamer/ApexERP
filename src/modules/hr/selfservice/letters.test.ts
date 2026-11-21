import { describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  MISSING_VALUE,
  PLACEHOLDERS,
  defaultLetterTypes,
  letterDate,
  letterMoney,
  letterReference,
  makeVerificationCode,
  normalizeCode,
  placeholdersIn,
  renderTemplate,
  validateTemplate,
} from './letters'

describe('renderTemplate', () => {
  it('fills placeholders, with or without inner spaces', () => {
    const r = renderTemplate('Dear {{addressee}}, {{ employee.fullName }} works here.', { addressee: 'Emirates NBD', 'employee.fullName': 'Noura Al Ketbi' })
    expect(r.text).toBe('Dear Emirates NBD, Noura Al Ketbi works here.')
    expect(r.missing).toEqual([])
    expect(r.unknown).toEqual([])
  })

  it('a missing or blank value becomes a visible gap and is reported', () => {
    const r = renderTemplate('Since {{employee.hireDate}} in {{employee.department}}.', { 'employee.hireDate': '1 March 2024', 'employee.department': '   ' })
    expect(r.text).toBe(`Since 1 March 2024 in ${MISSING_VALUE}.`)
    expect(r.missing).toEqual(['employee.department'])
  })

  it('an optional placeholder left empty renders as nothing, without a double space', () => {
    expect(renderTemplate('that {{employee.salutation}} {{employee.fullName}} is', { 'employee.fullName': 'Sam Lee' }).text).toBe('that Sam Lee is')
    expect(renderTemplate('that {{employee.salutation}} {{employee.fullName}} is', { 'employee.salutation': 'Ms.', 'employee.fullName': 'Sam Lee' }).text).toBe('that Ms. Sam Lee is')
  })

  it('unknown placeholders stay as written and are reported', () => {
    const r = renderTemplate('Passport {{employee.passportNo}}', {})
    expect(r.text).toBe('Passport {{employee.passportNo}}')
    expect(r.unknown).toEqual(['employee.passportNo'])
  })

  it('values are inserted literally: no recursive expansion, markup stays text', () => {
    const r = renderTemplate('To: {{addressee}} / {{purpose}}', { addressee: '{{salary.total}}', purpose: '<b>x</b> & "y"', 'salary.total': '99,000.00' })
    expect(r.text).toBe('To: {{salary.total}} / <b>x</b> & "y"')
    expect(r.text).not.toContain('99,000')
  })

  it('strips control characters and caps very long values', () => {
    const r = renderTemplate('{{purpose}}', { purpose: `a\u0000b\u0007c${'x'.repeat(1000)}` })
    expect(r.text.startsWith('abc')).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(500)
  })

  it('numbers render as given', () => {
    expect(renderTemplate('{{salary.total}}', { 'salary.total': 12500 }).text).toBe('12500')
  })
})

describe('validateTemplate', () => {
  it('accepts the seeded templates for both countries', () => {
    for (const country of ['AE', 'SA']) for (const t of defaultLetterTypes(country)) expect(validateTemplate(t.body, t.includesSalary), `${country} ${t.code}`).toEqual([])
  })

  it('refuses salary / bank placeholders outside salary letters', () => {
    expect(validateTemplate('Pay {{salary.total}}', false).join(' ')).toMatch(/Only salary letters/)
    expect(validateTemplate('IBAN {{bank.ibanLast4}}', false).join(' ')).toMatch(/bank\.ibanLast4/)
    expect(validateTemplate('Pay {{salary.total}}', true)).toEqual([])
  })

  it('refuses unknown placeholders, empty text and unclosed braces', () => {
    expect(validateTemplate('{{employee.iban}}', true).join(' ')).toMatch(/Unknown placeholder/)
    expect(validateTemplate('   ', false).join(' ')).toMatch(/empty/)
    expect(validateTemplate('Dear {{employee.fullName}', false).join(' ')).toMatch(/not closed/)
  })

  it('no seeded non-salary template can show pay', () => {
    for (const t of defaultLetterTypes('AE').filter((x) => !x.includesSalary)) expect(placeholdersIn(t.body).some((k) => k.startsWith('salary.') || k.startsWith('bank.'))).toBe(false)
  })

  it('the catalogue has no full IBAN or document number placeholder', () => {
    expect(PLACEHOLDERS.map((p) => p.key).filter((k) => /iban$|passport|number$/i.test(k))).toEqual([])
  })
})

describe('reference numbers, codes, formatting', () => {
  it('letterReference: prefix, HRL, year, 4-digit sequence', () => {
    expect(letterReference('APX', 2026, 1)).toBe('APX-HRL-2026-0001')
    expect(letterReference('crs', 2027, 42)).toBe('CRS-HRL-2027-0042')
    expect(letterReference('', 2026, 12345)).toBe('HR-HRL-2026-12345')
  })

  it('verification codes: XXXX-XXXX-XXXX from the unambiguous alphabet, and normalised input', () => {
    const code = makeVerificationCode()
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    for (const ch of code.replace(/-/g, '')) expect(CODE_ALPHABET).toContain(ch)
    expect(makeVerificationCode(() => new Uint8Array(12))).toBe('AAAA-AAAA-AAAA')
    expect(normalizeCode(' abcd efgh jkmn ')).toBe('ABCD-EFGH-JKMN')
    expect(normalizeCode('ABCD-EFGH-JKM')).toBeNull()
    expect(normalizeCode('ABCD-EFGH-JKM0')).toBeNull() // 0 is not in the alphabet
    expect(normalizeCode(42)).toBeNull()
  })

  it('dates and money', () => {
    expect(letterDate('2026-11-20')).toBe('20 November 2026')
    expect(letterDate('2026-01-05')).toBe('5 January 2026')
    expect(letterDate(null)).toBe('')
    expect(letterMoney(12500)).toBe('12,500.00')
    expect(letterMoney(null)).toBe('')
  })
})
