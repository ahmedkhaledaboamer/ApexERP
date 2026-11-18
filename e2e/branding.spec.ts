import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Settings › Branding end to end (mock API in the browser, IndexedDB persistence): upload light /
 * dark logos and a favicon through the crop dialog, pick a primary colour, save, and check that it
 * shows at once (no reload) in the sidebar, the switcher, the favicon, dark mode, quotations, the
 * template preview and the workspace sign-in page; plus validation, Management read-only, Crest
 * isolation, the audit log and reset.
 */

const APEX_ADMIN = 'u1'
const APEX_MANAGEMENT = 'u2'
const CREST_ADMIN = 'u101'
const ROSE = '#e11d48'

/** A real PNG drawn on a canvas in the page (so the browser can decode and crop it). */
async function makePng(page: Page, w: number, h: number, color: string, text: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ w, h, color, text }) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.fillStyle = color
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${Math.round(h * 0.45)}px sans-serif`
      ctx.fillText(text, h * 0.2, h * 0.65)
      return c.toDataURL('image/png')
    },
    { w, h, color, text },
  )
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

const brand600 = (page: Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--color-brand-600').trim())
const faviconHref = (page: Page) => page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href') ?? '')
const sidebarLogo = (page: Page) => page.locator('#sidebar-tenant-logo')

/** Lets the debounced IndexedDB save of the mock DB finish before a full page load. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}

async function openBranding(page: Page, userId: string, workspace = 'apexaora') {
  await signInAs(page, userId, workspace)
  await page.goto('/settings/branding')
  await expect(page.locator('#branding-page')).toBeVisible()
  await page.waitForLoadState('networkidle')
}

async function uploadAndCrop(page: Page, kind: 'logoLight' | 'logoDark' | 'favicon', file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.setInputFiles(`#branding-${kind}-input`, file)
  const dialog = page.locator('#crop-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('data-kind', kind)
  // Zoom in with the keyboard and pan by dragging on the canvas.
  await page.locator('#crop-zoom').focus()
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
  const canvas = page.locator('#crop-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 - 5, { steps: 5 })
  await page.mouse.up()
  await page.locator('#crop-apply').click()
  await expect(dialog).toBeHidden()
  await expect(page.locator(`#branding-${kind}`)).toHaveAttribute('data-has-image', 'true')
}

test('Apex admin brands the workspace; it shows everywhere at once; Management, Crest, audit, reset', async ({ page }) => {
  await openBranding(page, APEX_ADMIN)
  await expect(sidebarLogo(page)).toBeVisible()

  const light = await makePng(page, 640, 160, '#1d4ed8', 'APEX LIGHT')
  const dark = await makePng(page, 640, 160, '#fafafa', 'APEX DARK')
  const fav = await makePng(page, 96, 96, '#e11d48', 'A')

  await uploadAndCrop(page, 'logoLight', { name: 'logo.png', mimeType: 'image/png', buffer: light })
  await uploadAndCrop(page, 'logoDark', { name: 'logo-dark.png', mimeType: 'image/png', buffer: dark })
  await uploadAndCrop(page, 'favicon', { name: 'icon.png', mimeType: 'image/png', buffer: fav })
  // The crop output is a PNG scaled down (logo ≤ 800×400, favicon ≤ 128×128).
  await expect(page.locator('#branding-logoLight-summary')).toHaveText(/^PNG \d+ (B|KB), \d+×\d+$/)
  await expect(page.locator('#branding-favicon-summary')).toHaveText(/^PNG \d+ (B|KB), (\d+)×\2$/)

  // Primary colour: hex input → scale + previews (unsaved), contrast hint.
  await page.locator('#branding-color-hex').fill(ROSE)
  await expect(page.locator('#branding-scale li[data-step="600"]')).toHaveAttribute('data-hex', ROSE)
  await expect(page.locator('#branding-contrast')).toHaveAttribute('data-level', 'good')
  await expect(page.locator('#branding-preview-header-light img[data-tenant-logo="light"]')).toBeVisible()
  await expect(page.locator('#branding-preview-header-dark img[data-tenant-logo="dark"]')).toBeVisible()
  await expect(page.locator('#branding-preview-signin-light img[data-tenant-logo="light"]')).toBeVisible()
  await expect(page.locator('#branding-preview-favicon-dark img[data-favicon-preview="workspace"]')).toBeVisible()

  // Save without a reload: a marker on window survives only if the page isn't reloaded.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
  const before600 = await brand600(page)
  expect(before600).toBe('#7c3aed')
  await page.locator('#branding-save').click()
  await expect(page.getByText('Branding saved')).toBeVisible()

  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'light')
  await expect(sidebarLogo(page)).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect.poll(() => brand600(page)).toBe(ROSE)
  // Buttons (bg-brand-600) follow the variable.
  await expect(page.locator('#branding-save')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await expect.poll(() => faviconHref(page)).toMatch(/^data:image\/png;base64,/)
  await expect(page.locator('#workspace-switcher img[data-company-mark="logo"]')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)

  // Dark mode: the dark logo.
  const lightSrc = await sidebarLogo(page).getAttribute('src')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'dark')
  expect(await sidebarLogo(page).getAttribute('src')).not.toBe(lightSrc)
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'light')

  // Audit log (in-app navigation).
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: /Audit log/ }).click()
  await expect(page.getByText(/Updated the branding \(/).first()).toBeVisible()

  // Template preview: the email starts with the branded header (light logo).
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: /Templates/ }).click()
  await expect(page.locator('#email-brand-header img[data-tenant-logo="light"]')).toHaveAttribute('src', /^data:image\/png;base64,/)

  // Quotation document and its print view.
  await settle(page)
  const quotationId = await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}').token
    const r = await fetch('/api/quotations', { headers: { Authorization: `Bearer ${token}` } })
    const rows = (await r.json()) as { id: string }[]
    return rows[0].id
  })
  await page.goto(`/sales/quotations/${encodeURIComponent(quotationId)}`)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.quotation-print-root .quotation-paper img[data-tenant-logo="light"]')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await page.emulateMedia({ media: 'screen' })
  await expect.poll(() => brand600(page)).toBe(ROSE)

  // Remove the dark logo (confirm): dark mode falls back to the light logo.
  await page.goto('/settings/branding')
  await expect(page.locator('#branding-logoDark')).toHaveAttribute('data-has-image', 'true')
  await page.locator('#branding-logoDark-remove').click()
  await page.locator('#branding-remove-confirm').click()
  await expect(page.locator('#branding-logoDark')).toHaveAttribute('data-has-image', 'false')
  await page.locator('#branding-save').click()
  await expect(page.getByText('Branding saved')).toBeVisible()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'light')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await settle(page)

  // The workspace sign-in page (signed out): new logo and favicon; the bare domain: product icon.
  await page.evaluate(() => localStorage.removeItem('apexcrm.session'))
  await page.goto('/w/apexaora')
  await expect(page.locator('#signin-tenant-logo')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect.poll(() => faviconHref(page)).toMatch(/^data:image\/png;base64,/)
  await expect.poll(() => brand600(page)).toBe(ROSE)
  await page.goto('/login?workspace=')
  await expect(page.locator('#signin-tenant-logo')).toHaveAttribute('data-tenant-logo', 'monogram')
  await expect.poll(() => faviconHref(page)).toBe('/favicon.svg')

  // Management: read-only view of the same branding.
  await openBranding(page, APEX_MANAGEMENT)
  await expect(page.locator('#branding-page')).toHaveAttribute('data-can-edit', 'false')
  await expect(page.locator('#branding-readonly-note')).toBeVisible()
  await expect(page.locator('#branding-save')).toHaveCount(0)
  await expect(page.locator('#branding-logoLight-upload')).toHaveCount(0)
  await expect(page.locator('#branding-reset')).toHaveCount(0)
  await expect(page.locator('#branding-name')).toBeDisabled()
  await expect(page.locator('#branding-logoLight-preview img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(sidebarLogo(page)).toHaveAttribute('src', /^data:image\/png;base64,/)

  // Crest keeps its own branding: monogram, teal, product favicon; its sign-in page too.
  await signInAs(page, CREST_ADMIN, 'crest')
  await page.goto('/dashboard')
  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'monogram')
  await expect(sidebarLogo(page)).toHaveText('CL')
  await expect.poll(() => brand600(page)).toBe('#0d9488')
  await expect.poll(() => faviconHref(page)).toBe('/favicon.svg')
  await page.goto('/settings/branding')
  await expect(page.locator('#branding-logoLight')).toHaveAttribute('data-has-image', 'false')
  await expect(page.locator('#branding-name')).toHaveValue('Crest Logistics')
  await page.evaluate(() => localStorage.removeItem('apexcrm.session'))
  await page.goto('/w/crest')
  await expect(page.locator('#signin-tenant-logo')).toHaveAttribute('data-tenant-logo', 'monogram')
  await expect.poll(() => faviconHref(page)).toBe('/favicon.svg')

  // Reset (confirm) as the Apex admin: monogram, default palette, product favicon.
  await openBranding(page, APEX_ADMIN)
  await expect.poll(() => brand600(page)).toBe(ROSE)
  await page.locator('#branding-reset').click()
  await page.locator('#branding-reset-confirm').click()
  await expect(page.getByText('Branding reset')).toBeVisible()
  await expect(sidebarLogo(page)).toHaveAttribute('data-tenant-logo', 'monogram')
  await expect(sidebarLogo(page)).toHaveText('AA')
  await expect.poll(() => brand600(page)).toBe('#7c3aed')
  await expect.poll(() => faviconHref(page)).toBe('/favicon.svg')
  await expect(page.locator('#branding-logoLight')).toHaveAttribute('data-has-image', 'false')
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: /Audit log/ }).click()
  await expect(page.getByText(/Reset the branding to the default/).first()).toBeVisible()
})

test('invalid files are refused with a clear message, before anything is uploaded', async ({ page }) => {
  await openBranding(page, APEX_ADMIN)

  // A text file renamed .png.
  await page.setInputFiles('#branding-logoLight-input', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('just some text, not an image') })
  await expect(page.locator('#branding-logoLight-error')).toHaveText('The light logo isn’t a real PNG image (its content doesn’t match the file type).')
  await expect(page.locator('#crop-dialog')).toHaveCount(0)

  // Oversize favicon (real PNG signature, 300 KB).
  const big = Buffer.concat([await makePng(page, 16, 16, '#000000', ''), Buffer.alloc(300 * 1024)])
  await page.setInputFiles('#branding-favicon-input', { name: 'icon.png', mimeType: 'image/png', buffer: big })
  await expect(page.locator('#branding-favicon-error')).toHaveText(/^The favicon is \d+ KB; the limit is 256 KB\.$/)

  // Not an allowed type.
  await page.setInputFiles('#branding-logoDark-input', { name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') })
  await expect(page.locator('#branding-logoDark-error')).toContainText('must be a PNG, JPG, SVG or WebP image')

  // A dangerous SVG.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><script>alert(1)</script></svg>'
  await page.setInputFiles('#branding-logoLight-input', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) })
  await expect(page.locator('#branding-logoLight-error')).toContainText('SVG contains a script')

  // A safe SVG: preview only (no crop), then it's staged.
  const okSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><rect width="200" height="50" fill="#e11d48"/></svg>'
  await page.setInputFiles('#branding-logoLight-input', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(okSvg) })
  await page.locator('#svg-apply').click()
  await expect(page.locator('#branding-logoLight-summary')).toHaveText(/^SVG \d+ B, 200×50$/)

  // The server refuses a bad image too (422 with the same message).
  const res = await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}').token
    const r = await fetch('/api/settings/branding', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoLight: `data:image/png;base64,${btoa('not a png')}` }),
    })
    return { status: r.status, body: await r.json() }
  })
  expect(res.status).toBe(422)
  expect(res.body.message).toBe('The light logo isn’t a real PNG image (its content doesn’t match the file type).')
})
