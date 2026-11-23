import { describe, expect, it } from 'vitest'
import {
  AR_MONTHS,
  FSI,
  MISSING_VALUE,
  PDI,
  RLM,
  countryNameAr,
  defaultLetterTypes,
  hasArabic,
  letterDateAr,
  letterMoneyAr,
  letterVerifyUrl,
  maskedName,
  placeholdersIn,
  renderTemplate,
  stripBidi,
  toArabicDigits,
  validateTemplate,
} from './letters'

describe('Arabic rendering', () => {
  it('fills the same placeholders; every non-empty line starts with RLM; Latin / digit values are isolated (FSI … PDI)', () => {
    const r = renderTemplate('إلى: {{addressee}}\n\nتشهد {{company.legalName}} بأن {{employee.fullName}} رقم {{employee.employeeNo}}', {
      addressee: 'Emirates NBD',
      'company.legalName': 'شركة أبكس',
      'employee.fullName': 'نورة الكتبي',
      'employee.employeeNo': 'APX-0011',
    }, { rtl: true })
    const lines = r.text.split('\n')
    expect(lines[0]).toBe(`${RLM}إلى: ${FSI}Emirates NBD${PDI}`)
    expect(lines[1]).toBe('')
    expect(lines[2].startsWith(RLM)).toBe(true)
    // Arabic values are not wrapped; the Latin employee number is.
    expect(lines[2]).toContain('شركة أبكس بأن نورة الكتبي')
    expect(lines[2]).toContain(`${FSI}APX-0011${PDI}`)
    expect(stripBidi(r.text)).toBe('إلى: Emirates NBD\n\nتشهد شركة أبكس بأن نورة الكتبي رقم APX-0011')
    expect(r.missing).toEqual([])
  })

  it('a missing Arabic value is a visible gap and reported, like English; the salutation may be empty', () => {
    const r = renderTemplate('تشهد {{company.legalName}} بأن {{employee.salutation}} {{employee.fullName}}', { 'employee.fullName': '' }, { rtl: true })
    expect(r.missing).toEqual(['company.legalName', 'employee.fullName'])
    expect(stripBidi(r.text)).toBe(`تشهد ${MISSING_VALUE} بأن ${MISSING_VALUE}`)
  })

  it('values are still inserted literally in RTL (no recursive expansion)', () => {
    const r = renderTemplate('{{addressee}}', { addressee: '{{salary.total}}' }, { rtl: true })
    expect(stripBidi(r.text)).toBe('{{salary.total}}')
  })

  it('extra keys (the warning letter) are known only when passed', () => {
    expect(renderTemplate('{{warning.type}}', { 'warning.type': 'x' }).unknown).toEqual(['warning.type'])
    expect(renderTemplate('{{warning.type}}', { 'warning.type': 'x' }, { keys: new Set(['warning.type']) }).text).toBe('x')
  })
})

describe('Arabic dates, digits, names', () => {
  it('dates use the Gulf month names; Western digits by default, Arabic-Indic on request', () => {
    expect(letterDateAr('2026-11-20')).toBe('20 نوفمبر 2026')
    expect(letterDateAr('2026-01-05', 'arabic')).toBe('٥ يناير ٢٠٢٦')
    expect(AR_MONTHS).toHaveLength(12)
    expect(letterDateAr('')).toBe('')
  })

  it('money and digits: separators become Arabic ones between digits only', () => {
    expect(letterMoneyAr(12500)).toBe('12,500.00')
    expect(letterMoneyAr(12500, 'arabic')).toBe('١٢٬٥٠٠٫٠٠')
    expect(toArabicDigits('APX-0011')).toBe('APX-٠٠١١')
    expect(toArabicDigits('a, b. c')).toBe('a, b. c')
  })

  it('country names in Arabic; Arabic-letter detection', () => {
    expect(countryNameAr('AE')).toMatch(/الإمارات/)
    expect(countryNameAr('SA')).toMatch(/السعودية/)
    expect(hasArabic('نورة')).toBe(true)
    expect(hasArabic('Noura')).toBe(false)
  })
})

describe('Seeded Arabic templates', () => {
  it('every type has a formal Arabic template that validates with the same rules as English', () => {
    for (const country of ['AE', 'SA']) {
      for (const t of defaultLetterTypes(country)) {
        expect(t.nameAr, t.code).toMatch(/[\u0600-\u06FF]/)
        expect(validateTemplate(t.bodyAr, t.includesSalary), `${country} ${t.code}`).toEqual([])
        expect(hasArabic(t.bodyAr)).toBe(true)
      }
    }
  })

  it('pay placeholders only in the Arabic salary letters too; Arabic templates use the employee and company placeholders', () => {
    for (const t of defaultLetterTypes('AE')) {
      const keys = placeholdersIn(t.bodyAr)
      if (!t.includesSalary) expect(keys.some((k) => k.startsWith('salary.') || k.startsWith('bank.')), t.code).toBe(false)
      expect(keys, t.code).toEqual(expect.arrayContaining(['employee.fullName', 'company.legalName']))
    }
  })

  it('the Arabic template may be left empty (English only), not the English one', () => {
    expect(validateTemplate('', false, { optional: true })).toEqual([])
    expect(validateTemplate('', false).join(' ')).toMatch(/empty/)
  })
})

describe('QR payload and masked names', () => {
  it('production: the workspace subdomain; development: the origin with ?workspace=', () => {
    expect(letterVerifyUrl('ABCD-EFGH-JKMN', { subdomain: 'apexaora', origin: 'https://apexaora.apexcrm.app', rootDomain: 'apexcrm.app' })).toBe('https://apexaora.apexcrm.app/verify/letter?code=ABCD-EFGH-JKMN')
    expect(letterVerifyUrl('ABCD-EFGH-JKMN', { subdomain: 'crest', origin: 'http://localhost:5173', rootDomain: 'apexcrm.app' })).toBe('http://localhost:5173/verify/letter?code=ABCD-EFGH-JKMN&workspace=crest')
  })

  it('the public page shows first name + initial only', () => {
    expect(maskedName('Noura Al Ketbi')).toBe('Noura K.')
    expect(maskedName('Sam')).toBe('Sam')
    expect(maskedName('  ')).toBe('')
  })
})
