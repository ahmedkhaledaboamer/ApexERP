import type { BrandScale, Branding } from '@/modules/tenancy/types'

/** The platform product. Tenants show their own name; the product name appears on the bare domain. */
export const PRODUCT_NAME = 'Apex CRM'

/** Default palette (violet). A tenant without its own palette keeps it. */
export const DEFAULT_PALETTE: BrandScale = {
  '50': '#f5f3ff',
  '100': '#ede9fe',
  '200': '#ddd6fe',
  '300': '#c4b5fd',
  '400': '#a78bfa',
  '500': '#8b5cf6',
  '600': '#7c3aed',
  '700': '#6d28d9',
  '800': '#5b21b6',
  '900': '#4c1d95',
}

export const DEFAULT_BRANDING: Branding = {
  displayName: PRODUCT_NAME,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: null,
  monogram: 'AC',
  palette: DEFAULT_PALETTE,
  emailSenderName: PRODUCT_NAME,
  emailSenderAddress: 'no-reply@apexcrm.app',
}

const STEPS = Object.keys(DEFAULT_PALETTE) as (keyof BrandScale)[]

/** `#7c3aed` → `124 58 237` for rgb(var(--…) / alpha) uses (focus rings, selection). */
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/**
 * Writes the tenant palette to the `--color-brand-*` CSS variables on <html>. Every brand-*
 * Tailwind class reads these, so the whole UI re-themes without a rebuild. `--brand-rgb` is the
 * 600 step as an rgb triplet for translucent uses.
 */
export function applyBranding(branding: Branding, root: HTMLElement = document.documentElement): void {
  const palette = { ...DEFAULT_PALETTE, ...branding.palette }
  for (const step of STEPS) root.style.setProperty(`--color-brand-${step}`, palette[step])
  root.style.setProperty('--brand-rgb', hexToRgbTriplet(palette['600']))
}

/** Document title: "<Page> · <Tenant>" inside a workspace, "<Page> · Apex CRM" on the bare domain. */
export function brandTitle(branding: Branding): string {
  return branding.displayName === PRODUCT_NAME ? PRODUCT_NAME : `${branding.displayName} · ${PRODUCT_NAME}`
}

/** The product's tab icon (index.html); used whenever no workspace favicon applies. */
export const DEFAULT_FAVICON = '/favicon.svg'

/**
 * The logo image for a theme: dark → the dark logo, else the light one; light → the light logo
 * only (a dark-theme logo is usually white and would vanish on a light background). Null → monogram.
 */
export function logoFor(branding: Pick<Branding, 'logoUrl' | 'logoDarkUrl'>, theme: 'light' | 'dark'): string | null {
  if (theme === 'dark') return branding.logoDarkUrl || branding.logoUrl || null
  return branding.logoUrl || null
}

/**
 * A square tab icon drawn from the workspace monogram on its brand colour (SVG data URL), for a
 * company without a favicon or logo.
 */
export function monogramFavicon(branding: Pick<Branding, 'monogram' | 'palette'>): string {
  const color = branding.palette?.['600'] || DEFAULT_PALETTE['600']
  const text = (branding.monogram || '').slice(0, 2).toUpperCase().replace(/[<>&"']/g, '')
  const size = text.length > 1 ? 30 : 38
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="33" dominant-baseline="middle" text-anchor="middle" fill="#fff" ` +
    `font-family="Inter,Segoe UI,Arial,sans-serif" font-size="${size}" font-weight="700">${text}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * The workspace's browser-tab icon: its own favicon, else its logo, else its monogram on the brand
 * colour. Null for the product itself (bare domain), which keeps the product icon.
 */
export function workspaceFavicon(branding: Branding): string | null {
  if (branding.faviconUrl) return branding.faviconUrl
  if (branding.logoUrl) return branding.logoUrl
  if (branding.displayName === PRODUCT_NAME) return null
  return monogramFavicon(branding)
}

/** MIME type of a favicon URL for <link type>, when it can be told. */
function faviconType(url: string): string | null {
  const m = /^data:([^;,]+)/.exec(url)
  if (m) return m[1]
  if (/\.svg(\?|$)/i.test(url)) return 'image/svg+xml'
  if (/\.png(\?|$)/i.test(url)) return 'image/png'
  return null
}

/**
 * Points the document's <link rel="icon"> at `url` (the workspace favicon), or back to the product
 * icon with null. The element is reused, so the change shows without a reload.
 */
export function applyFavicon(url: string | null | undefined, doc: Document = document): void {
  const href = url || DEFAULT_FAVICON
  let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'icon'
    doc.head.appendChild(link)
  }
  if (link.getAttribute('href') === href) return
  const type = faviconType(href)
  if (type) link.type = type
  else link.removeAttribute('type')
  link.setAttribute('href', href)
  link.dataset.workspaceFavicon = url ? 'true' : 'false'
}
