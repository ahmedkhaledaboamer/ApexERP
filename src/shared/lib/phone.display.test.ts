import { describe, expect, it } from 'vitest'
import { displayMobile } from '@/shared/lib/phone'

describe('displayMobile', () => {
  it('groups numbers from supported countries, keeps foreign ones as stored', () => {
    expect(displayMobile('+971559087766')).toBe('+971 55 908 7766')
    expect(displayMobile('+966551234567')).toBe('+966 55 123 4567')
    expect(displayMobile('+971 55 908 7766')).toBe('+971 55 908 7766')
    expect(displayMobile('+17028920711')).toBe('+17028920711')
    expect(displayMobile('')).toBe('')
    expect(displayMobile(null)).toBe('')
  })
})
