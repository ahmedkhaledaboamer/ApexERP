import { describe, expect, it } from 'vitest'
import { formatIban, isValidIban, isValidTaxNumber, normalizeTaxNumber, taxLabel, taxNumberError } from './taxNumber'

describe('taxLabel', () => {
  it('follows the company country', () => {
    expect(taxLabel('AE')).toBe('TRN')
    expect(taxLabel('SA')).toBe('VAT number')
    expect(taxLabel('EG')).toBe('Tax ID')
    for (const c of ['QA', 'KW', 'BH', 'OM'] as const) expect(taxLabel(c)).toBeTruthy()
  })
})

describe('isValidTaxNumber', () => {
  it('UAE TRN: 15 digits starting with 100', () => {
    expect(isValidTaxNumber('100123456700003', 'AE')).toBe(true)
    expect(isValidTaxNumber('100 1234 5670 0003', 'AE')).toBe(true)
    expect(isValidTaxNumber('200123456700003', 'AE')).toBe(false)
    expect(isValidTaxNumber('10012345670000', 'AE')).toBe(false)
  })

  it('Saudi VAT: 15 digits starting and ending with 3', () => {
    expect(isValidTaxNumber('310123456700003', 'SA')).toBe(true)
    expect(isValidTaxNumber('310123456700004', 'SA')).toBe(false)
    expect(isValidTaxNumber('210123456700003', 'SA')).toBe(false)
    expect(isValidTaxNumber('31012345670003', 'SA')).toBe(false)
  })

  it('Egypt: 9 digits', () => {
    expect(isValidTaxNumber('123-456-789', 'EG')).toBe(true)
    expect(isValidTaxNumber('12345678', 'EG')).toBe(false)
  })

  it('others: 8–15 letters or digits', () => {
    expect(isValidTaxNumber('OM1100012345', 'OM')).toBe(true)
    expect(isValidTaxNumber('1234567', 'QA')).toBe(false)
    expect(isValidTaxNumber('1234567890123456', 'KW')).toBe(false)
    expect(isValidTaxNumber('ABCD1234', 'BH')).toBe(true)
  })

  it('empty is never valid', () => {
    expect(isValidTaxNumber('', 'AE')).toBe(false)
  })

  it('normalizes and explains', () => {
    expect(normalizeTaxNumber(' om-1100.0123 ')).toBe('OM11000123')
    expect(taxNumberError('AE')).toContain('TRN')
  })
})

describe('IBAN', () => {
  it('checks shape and checksum', () => {
    expect(isValidIban('SA0810000012345678900001')).toBe(true)
    expect(isValidIban('sa08 1000 0012 3456 7890 0001')).toBe(true)
    expect(isValidIban('SA0910000012345678900001')).toBe(false)
    expect(isValidIban('SA08')).toBe(false)
    expect(isValidIban('GB82WEST12345698765432')).toBe(true)
  })

  it('formats in groups of four', () => {
    expect(formatIban('SA0810000012345678900001')).toBe('SA08 1000 0012 3456 7890 0001')
  })
})
