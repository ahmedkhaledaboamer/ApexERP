import { describe, expect, it } from 'vitest'
import { DEFAULT_BRANDING, DEFAULT_PALETTE, monogramFavicon, workspaceFavicon } from './branding'

/** Browser-tab icon of a workspace: favicon → logo → monogram on the brand colour; the product keeps its icon. */
describe('workspace tab icon', () => {
  const company = { ...DEFAULT_BRANDING, displayName: 'Crest Logistics', monogram: 'CL', palette: { ...DEFAULT_PALETTE, '600': '#0d9488' } }

  it('prefers the uploaded favicon, then the logo', () => {
    expect(workspaceFavicon({ ...company, faviconUrl: 'data:image/png;base64,AAA', logoUrl: 'https://cdn/logo.png' })).toBe('data:image/png;base64,AAA')
    expect(workspaceFavicon({ ...company, logoUrl: 'https://cdn/logo.png' })).toBe('https://cdn/logo.png')
  })

  it('falls back to the monogram on the brand colour', () => {
    const svg = decodeURIComponent(workspaceFavicon(company)!.replace(/^data:image\/svg\+xml,/, ''))
    expect(svg).toContain('fill="#0d9488"')
    expect(svg).toContain('>CL</text>')
  })

  it('keeps the product icon on the bare domain, and escapes markup in a monogram', () => {
    expect(workspaceFavicon(DEFAULT_BRANDING)).toBeNull()
    expect(decodeURIComponent(monogramFavicon({ monogram: '<s', palette: DEFAULT_PALETTE }))).toContain('>S</text>')
  })
})
