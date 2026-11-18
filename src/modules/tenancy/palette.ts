import type { BrandScale } from '@/modules/tenancy/types'

/**
 * Brand colour helpers shared by Settings › Branding (client) and the mock API (server):
 * one primary hex → the 50–900 `BrandScale` behind the `--color-brand-*` variables.
 * The picked colour is the 600 step (buttons, active nav, focus ring, charts use it as is).
 */

export const SCALE_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const

/** `#7c3aed` / `#7C3AED` / `7c3aed` / `#abc` → `#7c3aed`; null when it isn't a hex colour. */
export function normalizeHex(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  return null
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** h 0–360, s and l 0–1. */
function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const k = h / 360
  return [hue(k + 1 / 3) * 255, hue(k) * 255, hue(k - 1 / 3) * 255]
}

/** How far each lighter step moves from the 600 lightness toward near-white (0 = 600, 1 = white). */
const TINT: Record<'50' | '100' | '200' | '300' | '400' | '500', number> = {
  '50': 0.965,
  '100': 0.9,
  '200': 0.76,
  '300': 0.58,
  '400': 0.37,
  '500': 0.17,
}
/** How much darker each deeper step is than the 600 lightness. */
const SHADE: Record<'700' | '800' | '900', number> = { '700': 0.16, '800': 0.31, '900': 0.44 }
/** Lightness of the 50 step at most (keeps a hint of colour). */
const TOP = 0.985

/**
 * The 50–900 scale for a primary colour. The input is the 600 step exactly; lighter steps keep its
 * hue and move toward near-white, darker steps lose lightness. Lightness strictly decreases from 50
 * to 900. Throws on an invalid hex (validate with `normalizeHex` first).
 */
export function deriveBrandScale(primary: string): BrandScale {
  const hex = normalizeHex(primary)
  if (!hex) throw new Error(`Not a hex colour: ${String(primary)}`)
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  // A very light primary still needs room for the steps above it.
  const base = Math.min(l, 0.86)
  const tint = (f: number) => rgbToHex(hslToRgb(h, Math.min(1, s * (1 - f * 0.1)), base + (TOP - base) * f))
  const shade = (f: number) => rgbToHex(hslToRgb(h, s, l * (1 - f)))
  return {
    '50': tint(TINT['50']),
    '100': tint(TINT['100']),
    '200': tint(TINT['200']),
    '300': tint(TINT['300']),
    '400': tint(TINT['400']),
    '500': tint(TINT['500']),
    '600': hex,
    '700': shade(SHADE['700']),
    '800': shade(SHADE['800']),
    '900': shade(SHADE['900']),
  }
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const norm = normalizeHex(hex)
  if (!norm) return 0
  const [r, g, b] = hexToRgb(norm).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export type ContrastLevel = 'good' | 'large-only' | 'poor'

/**
 * Contrast hint for white text on the primary (buttons, the active nav item): AA for normal text
 * from 4.5:1, large text / icons from 3:1, otherwise poor.
 */
export function primaryContrast(primary: string): { ratio: number; level: ContrastLevel } {
  const ratio = contrastRatio(primary, '#ffffff')
  return { ratio, level: ratio >= 4.5 ? 'good' : ratio >= 3 ? 'large-only' : 'poor' }
}

/** The primary of a palette: its 600 step. */
export function primaryOf(palette: BrandScale): string {
  return palette['600']
}

/** Inline CSS variables for a scale (previews of an unsaved colour). */
export function scaleVars(scale: BrandScale): Record<string, string> {
  const out: Record<string, string> = {}
  for (const step of SCALE_STEPS) out[`--color-brand-${step}`] = scale[step]
  const [r, g, b] = hexToRgb(scale['600'])
  out['--brand-rgb'] = `${r} ${g} ${b}`
  return out
}
