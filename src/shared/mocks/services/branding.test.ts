import { describe, expect, it } from 'vitest'
import { leads, users } from '@/shared/mocks/db'
import { auditLog } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { DEFAULT_PALETTE } from '@/modules/tenancy/branding'
import { deriveBrandScale } from '@/modules/tenancy/palette'
import {
  FAVICON_MAX_BYTES,
  LOGO_MAX_BYTES,
  checkImageBytes,
  describeImageUrl,
  imageDimensions,
  svgProblem,
  toDataUrl,
} from '@/modules/settings/branding'
import { APEX, CREST, PLATFORM, adminToken, api, platformToken, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/**
 * Settings › Branding through the real MSW handlers (the API contract): validation of every image
 * kind, permissions, tenant isolation, audit entries without image data, reset, the central
 * read-only policies, and where the branding shows up (public workspace lookup, sent emails).
 */

useSeedPerTest()

/* ---------------- Test images (built byte by byte; no canvas in node) ---------------- */

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
/** A valid 1×1 PNG. */
const PNG_1x1 = b64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')

/** The same PNG with another size in its header (320×80). */
function png(width: number, height: number, padTo = 0): Uint8Array {
  const out = new Uint8Array(Math.max(PNG_1x1.length, padTo))
  out.set(PNG_1x1)
  const dv = new DataView(out.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return out
}

function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ])
}

function webp(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30)
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
  new DataView(b.buffer).setUint32(4, 22, true)
  b.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8)
  new DataView(b.buffer).setUint32(16, 10, true)
  const w = width - 1
  const h = height - 1
  b.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 24)
  return b
}

const enc = (s: string) => new TextEncoder().encode(s)
const SVG_OK = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><defs><linearGradient id="g"><stop offset="0" stop-color="#123"/></linearGradient></defs><rect width="120" height="40" fill="url(#g)"/><use href="#g"/></svg>'

const url = (mime: string, bytes: Uint8Array) => toDataUrl(mime, bytes)
const PNG_URL = url('image/png', png(320, 80))
const JPEG_URL = url('image/jpeg', jpeg(400, 100))
const WEBP_URL = url('image/webp', webp(64, 64))
const SVG_URL = url('image/svg+xml', enc(SVG_OK))

const ADMIN_APEX = adminToken(APEX)
const ADMIN_CREST = adminToken(CREST)
const roleToken = (co: string, role: string) => {
  const u = users.find((x) => x.companyId === co && x.role === role && x.active !== false)
  if (!u) throw new Error(`no ${role} in ${co}`)
  return userToken(u.id)
}

const patch = (token: string, body: unknown) => api(token, 'PATCH', '/settings/branding', { body })

/* ---------------- Validation ---------------- */

describe('branding: image validation (server)', () => {
  it.each([
    ['PNG', PNG_URL, 'PNG'],
    ['JPG', JPEG_URL, 'JPG'],
    ['WebP', WEBP_URL, 'WebP'],
    ['SVG', SVG_URL, 'SVG'],
  ])('accepts a %s for every image kind', async (_, dataUrl, label) => {
    const res = await patch(ADMIN_APEX, { logo_light: dataUrl, logo_dark: dataUrl, favicon: dataUrl })
    expect(res.status, res.text).toBe(200)
    expect(res.body.branding.logo_url).toBe(dataUrl)
    expect(res.body.branding.logo_dark_url).toBe(dataUrl)
    expect(res.body.branding.favicon_url).toBe(dataUrl)
    expect(describeImageUrl(res.body.branding.logo_url)).toMatch(new RegExp(`^${label} `))
  })

  it('reads the size from each format', () => {
    expect(imageDimensions('png', png(320, 80))).toEqual({ width: 320, height: 80 })
    expect(imageDimensions('jpeg', jpeg(400, 100))).toEqual({ width: 400, height: 100 })
    expect(imageDimensions('webp', webp(64, 48))).toEqual({ width: 64, height: 48 })
    expect(imageDimensions('svg', enc(SVG_OK))).toEqual({ width: 120, height: 40 })
    expect(describeImageUrl(PNG_URL)).toBe(`PNG ${PNG_1x1.length} B, 320×80`)
  })

  it('rejects a type that isn’t allowed (GIF, text, PDF)', async () => {
    for (const [mime, bytes] of [
      ['image/gif', enc('GIF89a....')],
      ['text/plain', enc('hello')],
      ['application/pdf', enc('%PDF-1.7')],
    ] as const) {
      const res = await patch(ADMIN_APEX, { logo_light: url(mime, bytes) })
      expect(res.status, mime).toBe(422)
      expect(res.body.message).toMatch(/must be a PNG, JPG, SVG or WebP image/)
    }
  })

  it('rejects content that doesn’t match the declared type (magic bytes)', async () => {
    const txt = await patch(ADMIN_APEX, { logo_light: url('image/png', enc('this is a text file renamed to .png')) })
    expect(txt.status).toBe(422)
    expect(txt.body.message).toBe('The light logo isn’t a real PNG image (its content doesn’t match the file type).')
    const jpgAsPng = await patch(ADMIN_APEX, { favicon: url('image/png', jpeg(10, 10)) })
    expect(jpgAsPng.status).toBe(422)
    expect(jpgAsPng.body.message).toMatch(/says it is PNG but its content is JPG/)
    const pngAsSvg = await patch(ADMIN_APEX, { logo_dark: url('image/svg+xml', png(10, 10)) })
    expect(pngAsSvg.status).toBe(422)
    expect(pngAsSvg.body.message).toMatch(/dark logo says it is SVG but its content is PNG/)
  })

  it('rejects oversize images per kind (logo 1 MB, favicon 256 KB)', async () => {
    expect((await patch(ADMIN_APEX, { logo_light: url('image/png', png(10, 10, LOGO_MAX_BYTES)) })).status).toBe(200)
    const logo = await patch(ADMIN_APEX, { logo_light: url('image/png', png(10, 10, LOGO_MAX_BYTES + 1)) })
    expect(logo.status).toBe(422)
    expect(logo.body.message).toMatch(/light logo .*the limit is 1 MB/)
    const fav = await patch(ADMIN_APEX, { favicon: url('image/png', png(10, 10, FAVICON_MAX_BYTES + 1)) })
    expect(fav.status).toBe(422)
    expect(fav.body.message).toMatch(/favicon .*the limit is 256 KB/)
    expect((await patch(ADMIN_APEX, { favicon: url('image/png', png(10, 10, FAVICON_MAX_BYTES)) })).status).toBe(200)
  })

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', /contains a script/],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>', /event handler/],
    ['event handler (entity-encoded)', '<svg xmlns="http://www.w3.org/2000/svg"><rect &#111;nclick="x()"/></svg>', /event handler/],
    ['javascript: link', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>', /javascript:|external reference/],
    ['encoded javascript:', '<svg xmlns="http://www.w3.org/2000/svg"><a href="#" xlink:title="&#106;avascript:alert(1)"/></svg>', /javascript:/],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>', /foreignObject/],
    ['external image', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>', /external/],
    ['external use', '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://evil.example/s.svg#a"/></svg>', /external reference/],
    ['external url()', '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.example/p)"/></svg>', /url\(\)/],
    ['@import', '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "x.css";</style></svg>', /@import/],
    ['entity declaration', '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', /DOCTYPE|no <svg> root/],
  ])('rejects a dangerous SVG: %s', async (_, svg, why) => {
    expect(svgProblem(svg)).toMatch(why)
    const res = await patch(ADMIN_APEX, { logo_light: url('image/svg+xml', enc(svg)) })
    expect(res.status).toBe(422)
    expect(res.body.message).toMatch(/^The light logo SVG .*Upload an SVG without scripts, links or embedded content, or a PNG\.$/)
    expect(companyById(APEX)!.branding.logoUrl).not.toContain('svg')
  })

  it('rejects malformed values, colours and names; nothing is written on a failed request', async () => {
    const before = structuredClone(companyById(APEX)!.branding)
    expect((await patch(ADMIN_APEX, { logo_light: 'https://evil.example/logo.png' })).status).toBe(422)
    expect((await patch(ADMIN_APEX, { logo_light: 'data:image/png;base64,@@@' })).status).toBe(422)
    expect((await patch(ADMIN_APEX, { brand_color: 'purple' })).body.message).toMatch(/hex value/)
    expect((await patch(ADMIN_APEX, { display_name: '   ' })).status).toBe(422)
    expect((await patch(ADMIN_APEX, { display_name: 'x'.repeat(61) })).status).toBe(422)
    // A valid colour with an invalid image: all-or-nothing.
    expect((await patch(ADMIN_APEX, { brand_color: '#0ea5e9', favicon: url('image/png', enc('nope')) })).status).toBe(422)
    expect((await patch(ADMIN_APEX, [])).status).toBe(400)
    expect(companyById(APEX)!.branding).toEqual(before)
  })

  it('the client check gives the same answer as the server', () => {
    const r = checkImageBytes('logoLight', 'png', enc('plain text'))
    expect(r.ok).toBe(false)
    expect(checkImageBytes('favicon', 'webp', webp(32, 32))).toEqual({ ok: true, info: { type: 'webp', bytes: 30, width: 32, height: 32 } })
  })
})

/* ---------------- Permissions ---------------- */

describe('branding: permissions', () => {
  it('Company Admin reads and writes (200)', async () => {
    expect((await api(ADMIN_APEX, 'GET', '/settings/branding')).status).toBe(200)
    expect((await patch(ADMIN_APEX, { brand_color: '#0ea5e9' })).status).toBe(200)
    expect((await api(ADMIN_APEX, 'POST', '/settings/branding/reset')).status).toBe(200)
  })

  it('Management reads (200) but can’t write (403)', async () => {
    const token = roleToken(APEX, 'Management')
    const get = await api(token, 'GET', '/settings/branding')
    expect(get.status).toBe(200)
    expect(get.body.branding.display_name).toBe('Apex Aora')
    expect(get.body.limits).toEqual({ logo_max_bytes: LOGO_MAX_BYTES, favicon_max_bytes: FAVICON_MAX_BYTES, types: ['PNG', 'JPG', 'SVG', 'WebP'], display_name_max: 60 })
    expect((await patch(token, { brand_color: '#0ea5e9' })).status).toBe(403)
    expect((await api(token, 'POST', '/settings/branding/reset')).status).toBe(403)
    expect(companyById(APEX)!.branding.palette).toEqual(DEFAULT_PALETTE)
  })

  it.each(['Sales Agent', 'Sales Manager', 'Accountant'])('%s gets 403 on every branding endpoint', async (role) => {
    const token = roleToken(APEX, role)
    expect((await api(token, 'GET', '/settings/branding')).status).toBe(403)
    expect((await patch(token, { brand_color: '#0ea5e9' })).status).toBe(403)
    expect((await api(token, 'POST', '/settings/branding/reset')).status).toBe(403)
  })

  it('no token → 401', async () => {
    expect((await api(null, 'GET', '/settings/branding')).status).toBe(401)
    expect((await api(null, 'PATCH', '/settings/branding', { body: {} })).status).toBe(401)
  })
})

/* ---------------- Tenant isolation ---------------- */

describe('branding: tenant isolation', () => {
  it('a Crest PATCH never changes Apex, even with Apex’s companyId in the body, query and headers', async () => {
    const apexBefore = structuredClone(companyById(APEX)!.branding)
    const res = await api(ADMIN_CREST, 'PATCH', '/settings/branding?companyId=co_apex', {
      body: { companyId: APEX, company_id: APEX, tenantId: APEX, id: APEX, brand_color: '#be123c', logo_light: PNG_URL, display_name: 'Crest Freight' },
      headers: { 'X-Company-Id': APEX, 'X-Tenant-Id': APEX },
    })
    expect(res.status, res.text).toBe(200)
    expect(res.body.id).toBe(CREST)
    expect(companyById(CREST)!.branding.displayName).toBe('Crest Freight')
    expect(companyById(CREST)!.branding.logoUrl).toBe(PNG_URL)
    expect(companyById(APEX)!.branding).toEqual(apexBefore)
    const apexGet = await api(ADMIN_APEX, 'GET', '/settings/branding')
    expect(apexGet.body.branding.logo_url).not.toBe(PNG_URL)
    expect(apexGet.body.branding.display_name).toBe('Apex Aora')
  })

  it('unknown fields are ignored (no mass assignment)', async () => {
    const res = await patch(ADMIN_APEX, { email_sender_address: 'evil@example.com', palette: { '600': '#000000' }, monogram: 'ZZ', subdomain: 'evil' })
    expect(res.status).toBe(200)
    const b = companyById(APEX)!.branding
    expect(b.emailSenderAddress).toBe('sales@apexaora.ae')
    expect(b.monogram).toBe('AA')
    expect(b.palette).toEqual(DEFAULT_PALETTE)
    expect(companyById(APEX)!.subdomain).toBe('apexaora')
  })

  it('reset touches only the caller’s company', async () => {
    await patch(ADMIN_APEX, { logo_light: PNG_URL, brand_color: '#0ea5e9' })
    const crestBefore = structuredClone(companyById(CREST)!.branding)
    expect((await api(ADMIN_CREST, 'POST', '/settings/branding/reset')).status).toBe(200)
    expect(companyById(APEX)!.branding.logoUrl).toBe(PNG_URL)
    expect(companyById(CREST)!.branding.palette).toEqual(DEFAULT_PALETTE)
    expect(crestBefore.palette).not.toEqual(DEFAULT_PALETTE)
  })
})

/* ---------------- Audit, reset, propagation ---------------- */

describe('branding: audit, reset and where it shows', () => {
  it('audits every change with field diffs; images summarised, never the data URL', async () => {
    const res = await patch(ADMIN_APEX, { display_name: 'Apex Aora Studio', brand_color: '#0EA5E9', logo_light: PNG_URL, logo_dark: SVG_URL, favicon: WEBP_URL })
    expect(res.status).toBe(200)
    const entry = auditLog.find((a) => a.companyId === APEX && a.entity === 'branding')!
    expect(entry).toBeTruthy()
    expect(entry.entityId).toBe(APEX)
    expect(entry.userId).toBe('u1')
    expect(entry.summary).toMatch(/^Updated the branding \(/)
    const byField = Object.fromEntries(entry.changes.map((c) => [c.field, c]))
    expect(byField.displayName).toMatchObject({ from: 'Apex Aora', to: 'Apex Aora Studio' })
    expect(byField.monogram).toBeUndefined() // "Apex Aora Studio" keeps the initials AA
    expect(byField.primaryColor).toMatchObject({ from: '#7c3aed', to: '#0ea5e9' })
    expect(byField.logoLight.from).toBe('Hosted image (cdn.magicpatterns.com)')
    expect(byField.logoLight.to).toBe(`PNG ${PNG_1x1.length} B, 320×80`)
    expect(byField.logoDark).toMatchObject({ from: '—', to: expect.stringMatching(/^SVG \d+ B, 120×40$/) })
    expect(byField.favicon).toMatchObject({ from: '—', to: 'WebP 30 B, 64×64' })
    expect(JSON.stringify(entry)).not.toContain('data:')
    expect(JSON.stringify(entry)).not.toContain('base64')
    // The audit log endpoint lists it for the admin, and never for Crest.
    const list = await api(ADMIN_APEX, 'GET', '/audit-log')
    expect(list.status).toBe(200)
    expect(JSON.stringify(list.body)).toContain('Updated the branding')
    expect(JSON.stringify((await api(ADMIN_CREST, 'GET', '/audit-log')).body)).not.toContain('Updated the branding')
    // No entry when nothing changed.
    const count = auditLog.filter((a) => a.entity === 'branding').length
    await patch(ADMIN_APEX, { brand_color: '#0ea5e9' })
    expect(auditLog.filter((a) => a.entity === 'branding').length).toBe(count)
  })

  it('the primary colour derives the palette; the response is the updated Company', async () => {
    const res = await patch(ADMIN_APEX, { brand_color: '#0ea5e9' })
    expect(res.body.branding.brand_color).toBe('#0ea5e9')
    expect(res.body.branding.palette).toEqual(deriveBrandScale('#0ea5e9'))
    expect(res.body).toMatchObject({ id: APEX, subdomain: 'apexaora', profile: { trade_name: 'Apex Aora' } })
    // GET /tenant (session refresh) carries it.
    expect((await api(ADMIN_APEX, 'GET', '/tenant')).body.branding.palette['600']).toBe('#0ea5e9')
  })

  it('removing an image with null; reset restores monogram + default palette (audited)', async () => {
    await patch(ADMIN_APEX, { logo_light: PNG_URL, logo_dark: PNG_URL, favicon: PNG_URL, brand_color: '#0ea5e9' })
    const removed = await patch(ADMIN_APEX, { logo_dark: null })
    expect(removed.body.branding.logo_dark_url).toBeNull()
    expect(removed.body.branding.logo_url).toBe(PNG_URL)
    const reset = await api(ADMIN_APEX, 'POST', '/settings/branding/reset')
    expect(reset.status).toBe(200)
    expect(reset.body.branding).toMatchObject({ logo_url: null, logo_dark_url: null, favicon_url: null, brand_color: null, palette: DEFAULT_PALETTE, monogram: 'AA', display_name: 'Apex Aora' })
    const entry = auditLog.find((a) => a.companyId === APEX && a.entity === 'branding')!
    expect(entry.summary).toMatch(/^Reset the branding to the default/)
    expect(entry.changes.map((c) => c.field).sort()).toEqual(['favicon', 'logoLight', 'primaryColor'])
  })

  it('the public workspace lookup (sign-in page) returns the logos and favicon', async () => {
    await patch(ADMIN_APEX, { logo_light: PNG_URL, logo_dark: SVG_URL, favicon: WEBP_URL })
    const pub = await api(null, 'GET', '/public/workspaces/apexaora')
    expect(pub.status).toBe(200)
    expect(pub.body.branding).toMatchObject({ logoUrl: PNG_URL, logoDarkUrl: SVG_URL, faviconUrl: WEBP_URL })
    expect((await api(null, 'GET', '/public/workspaces/crest')).body.branding.logoUrl).toBeNull()
  })

  it('sent emails are rendered with the branded header (logo, else monogram)', async () => {
    await patch(ADMIN_APEX, { logo_light: PNG_URL })
    const lead = leads.find((l) => l.companyId === APEX && !l.doNotContact && l.contactEmail && !['Won', 'Lost', 'Not interested'].includes(l.status))!
    const sent = await api(ADMIN_APEX, 'POST', `/leads/${lead.id}/messages`, { body: { channel: 'email', to_address: lead.contactEmail, subject: 'Hello', body: 'Line 1\n<b>Line 2</b>' } })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body.email.from_address).toBe('Apex Aora Sales <sales@apexaora.ae>')
    expect(sent.body.email.html).toContain(`<img src="${PNG_URL}" alt="Apex Aora"`)
    expect(sent.body.email.html).toContain('Line 1<br>&lt;b&gt;Line 2&lt;/b&gt;')
    const crestLead = leads.find((l) => l.companyId === CREST && !l.doNotContact && l.contactEmail && !['Won', 'Lost', 'Not interested'].includes(l.status))!
    const crest = await api(ADMIN_CREST, 'POST', `/leads/${crestLead.id}/messages`, { body: { channel: 'email', to_address: crestLead.contactEmail, subject: 'Hi', body: 'Hello' } })
    expect(crest.status, crest.text).toBe(200)
    expect(crest.body.email.html).not.toContain('<img')
    expect(crest.body.email.html).toContain('>CL</span>')
    expect(crest.body.email.html).not.toContain(PNG_URL)
  })
})

/* ---------------- Central policies ---------------- */

describe('branding: read-only workspaces and support sessions (central policy)', () => {
  it('billing read-only (suspended) → 423 on PATCH and reset; GET works', async () => {
    expect((await api(ADMIN_APEX, 'POST', '/dev/billing/status', { body: { status: 'suspended' } })).status).toBe(200)
    const write = await patch(ADMIN_APEX, { brand_color: '#0ea5e9' })
    expect(write.status).toBe(423)
    expect(write.body.code).toBe('workspace_read_only')
    expect((await api(ADMIN_APEX, 'POST', '/settings/branding/reset')).status).toBe(423)
    expect((await api(ADMIN_APEX, 'GET', '/settings/branding')).status).toBe(200)
    expect(companyById(APEX)!.branding.palette).toEqual(DEFAULT_PALETTE)
    // Crest is unaffected.
    expect((await patch(ADMIN_CREST, { brand_color: '#be123c' })).status).toBe(200)
  })

  it('a read-only support session can view but not change the branding (403 impersonation_read_only)', async () => {
    const start = await api(platformToken(PLATFORM.support), 'POST', '/platform/impersonations', { body: { userId: 'u1', reason: 'Customer asked about their logo' } })
    expect(start.status, start.text).toBe(200)
    const token = start.body.token as string
    expect((await api(token, 'GET', '/settings/branding')).status).toBe(200)
    const write = await patch(token, { brand_color: '#0ea5e9' })
    expect(write.status).toBe(403)
    expect(write.body.code).toBe('impersonation_read_only')
    expect((await api(token, 'POST', '/settings/branding/reset')).body.code).toBe('impersonation_read_only')
    expect(companyById(APEX)!.branding.palette).toEqual(DEFAULT_PALETTE)
  })
})
