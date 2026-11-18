import { describe, expect, it } from 'vitest'
import { SCALE_STEPS, contrastRatio, deriveBrandScale, luminance, normalizeHex, primaryContrast, scaleVars } from '@/modules/tenancy/palette'
import { applyBranding, DEFAULT_BRANDING, logoFor } from '@/modules/tenancy/branding'

const HEX = /^#[0-9a-f]{6}$/

describe('palette: normalizeHex', () => {
  it('accepts 3/6 digit hex with or without #, any case', () => {
    expect(normalizeHex('#7C3AED')).toBe('#7c3aed')
    expect(normalizeHex('7c3aed')).toBe('#7c3aed')
    expect(normalizeHex(' #abc ')).toBe('#aabbcc')
  })
  it('rejects everything else', () => {
    for (const v of ['', '#12345', '#1234567', 'purple', 'rgb(1,2,3)', '#ggg000', null, 42]) expect(normalizeHex(v)).toBeNull()
  })
})

describe('palette: deriveBrandScale', () => {
  const samples = ['#7c3aed', '#0d9488', '#2563eb', '#be123c', '#ea580c', '#16a34a', '#111827', '#808080', '#000000', '#e11d48']

  it.each(samples)('%s: 10 valid steps, the input is exactly 600', (hex) => {
    const scale = deriveBrandScale(hex)
    expect(Object.keys(scale)).toEqual([...SCALE_STEPS])
    for (const step of SCALE_STEPS) expect(scale[step]).toMatch(HEX)
    expect(scale['600']).toBe(hex)
  })

  it.each(samples)('%s: lightness goes down from 50 to 900', (hex) => {
    const scale = deriveBrandScale(hex)
    const lum = SCALE_STEPS.map((s) => luminance(scale[s]))
    for (let i = 1; i < lum.length; i++) expect(lum[i], `${SCALE_STEPS[i - 1]} → ${SCALE_STEPS[i]}`).toBeLessThanOrEqual(lum[i - 1])
    // The 50 step is a near-white tint, the 900 step clearly darker than 600 (unless 600 is black).
    expect(lum[0]).toBeGreaterThan(0.85)
    if (hex !== '#000000') expect(lum[9]).toBeLessThan(lum[6])
  })

  it('keeps the hue: a blue stays blue, a red stays red', () => {
    const blue = deriveBrandScale('#2563eb')
    const red = deriveBrandScale('#be123c')
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    for (const step of ['100', '300', '800'] as const) {
      const [r, , b] = rgb(blue[step])
      expect(b).toBeGreaterThan(r)
      const [r2, , b2] = rgb(red[step])
      expect(r2).toBeGreaterThan(b2)
    }
  })

  it('normalises the input and is deterministic', () => {
    expect(deriveBrandScale('#7C3AED')).toEqual(deriveBrandScale('7c3aed'))
    expect(deriveBrandScale('#abc')['600']).toBe('#aabbcc')
  })

  it('throws on an invalid colour', () => {
    expect(() => deriveBrandScale('nope')).toThrow(/Not a hex colour/)
  })
})

describe('palette: contrast', () => {
  it('WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#7c3aed', '#ffffff')).toBeCloseTo(5.7, 1)
  })
  it('hint levels for white text on the primary', () => {
    expect(primaryContrast('#7c3aed').level).toBe('good')
    expect(primaryContrast('#0284c7').level).toBe('large-only')
    expect(primaryContrast('#0ea5e9').level).toBe('poor')
    expect(primaryContrast('#fde047').level).toBe('poor')
  })
})

describe('branding helpers', () => {
  it('applyBranding writes every --color-brand-* step and --brand-rgb on the root', () => {
    const props = new Map<string, string>()
    const root = { style: { setProperty: (k: string, v: string) => props.set(k, v) } } as unknown as HTMLElement
    applyBranding({ ...DEFAULT_BRANDING, palette: deriveBrandScale('#0d9488') }, root)
    expect(props.get('--color-brand-600')).toBe('#0d9488')
    expect(props.get('--brand-rgb')).toBe('13 148 136')
    expect([...props.keys()].filter((k) => k.startsWith('--color-brand-'))).toHaveLength(10)
    expect(scaleVars(deriveBrandScale('#0d9488'))['--color-brand-600']).toBe('#0d9488')
  })

  it('logoFor: dark mode prefers the dark logo, light mode never uses it', () => {
    expect(logoFor({ logoUrl: 'L', logoDarkUrl: 'D' }, 'dark')).toBe('D')
    expect(logoFor({ logoUrl: 'L', logoDarkUrl: null }, 'dark')).toBe('L')
    expect(logoFor({ logoUrl: 'L', logoDarkUrl: 'D' }, 'light')).toBe('L')
    expect(logoFor({ logoUrl: null, logoDarkUrl: 'D' }, 'light')).toBeNull()
  })
})
