import { expect, test, type Page } from '@playwright/test'
import { centerOf, mouseDrag, signInAs } from './helpers'

/**
 * Marketing creative end to end (Apex, Enterprise plan, company timezone Asia/Dubai):
 *  - content calendar: a Marketing Manager creates an item in review (can't approve their own),
 *    Management approves and schedules it, it shows on the calendar, dragging it to another day
 *    reschedules it (kept after a reload);
 *  - design requests: a Sales Agent asks for a design from the New menu and sees only their own
 *    requests; the Marketing Manager assigns a designer, walks it to delivered with a file and saves
 *    it to Brand assets;
 *  - brand assets: the upload form refuses a fake image and a wrong type, then uploads a real PNG.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** yyyy-MM-dd in Dubai, `days` from today. */
function dubaiDay(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() + days * 86_400_000))
}

function dialog(page: Page, name: string | RegExp) {
  return page.getByRole('dialog', { name })
}

test('content: create → approve → schedule → on the calendar → drag to reschedule', async ({ page }) => {
  const TITLE = 'E2E webinar teaser'
  const day = dubaiDay(2)
  await signInAs(page, 'u7')
  await page.goto(`/marketing/content?cal=week&d=${day}`)
  await expect(page.getByRole('heading', { name: 'Content calendar' })).toBeVisible()

  await page.getByRole('button', { name: 'New content', exact: true }).click()
  const form = dialog(page, 'New content')
  await form.getByLabel('Title').fill(TITLE)
  await form.getByLabel('Start as').selectOption('in_review')
  await form.getByLabel('Publish date').fill(day)
  await form.getByLabel('Publish time').fill('10:00')
  await form.getByRole('button', { name: 'Create content' }).click()

  // The new item opens; its owner can't approve it.
  const item = dialog(page, TITLE)
  await expect(item.getByText('In review', { exact: true })).toBeVisible()
  await expect(item.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await expect(page).toHaveURL(/item=CI-/)
  const id = new URL(page.url()).searchParams.get('item')!

  // Management approves and schedules it.
  await signInAs(page, 'u2')
  await page.goto(`/marketing/content?cal=week&d=${day}&item=${id}`)
  await dialog(page, TITLE).getByRole('button', { name: 'Approve' }).click()
  await expect(dialog(page, TITLE).getByText('Approved', { exact: true })).toBeVisible()
  await dialog(page, TITLE).getByRole('button', { name: 'Schedule' }).click()
  await dialog(page, TITLE).getByRole('button', { name: 'Confirm schedule' }).click()
  await expect(dialog(page, TITLE).getByText('Scheduled', { exact: true })).toBeVisible()
  await dialog(page, TITLE).getByRole('button', { name: 'Close' }).click()

  // On the calendar, on its day.
  const chip = page.locator(`[data-day="${day}"] [data-content-id="${id}"]`)
  await expect(chip).toBeVisible()

  // Drag to the next day of the same week (or the previous one when it's the week's last day).
  const next = dubaiDay(3)
  const target = (await page.locator(`[data-day="${next}"]`).count()) > 0 ? next : dubaiDay(1)
  await mouseDrag(page, await centerOf(chip), await centerOf(page.locator(`[data-day="${target}"]`)))
  await expect(page.locator(`[data-day="${target}"] [data-content-id="${id}"]`)).toBeVisible()
  await expect(page.getByText(/^Moved to /).first()).toBeVisible()

  // Saved on the server, at the same wall time (company timezone).
  const saved = await page.evaluate(async (cid) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api/marketing/content/${cid}`, { headers: { Authorization: `Bearer ${s.token}`, 'X-Workspace': 'apexaora' } })
    return (await r.json()) as { publish_local: string; status: string }
  }, id)
  expect(saved).toMatchObject({ publish_local: `${target}T10:00`, status: 'scheduled' })
  await expect(page.locator(`[data-day="${target}"] [data-content-id="${id}"]`)).toContainText('10:00')
})

test('design request: a Sales Agent asks and sees only theirs; marketing assigns, delivers and saves to Brand assets', async ({ page }) => {
  const TITLE = 'E2E clinic flyer'
  await signInAs(page, 'u4')
  await page.goto('/dashboard')
  const menuItem = page.getByRole('menuitem', { name: /New design request/ })
  await expect(async () => {
    if (!(await menuItem.isVisible())) await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(menuItem).toBeVisible({ timeout: 2_000 })
  }).toPass()
  await menuItem.click()

  const form = dialog(page, 'New design request')
  await expect(form.getByLabel('Designer')).toHaveCount(0) // requesters can't assign
  await form.getByLabel('Title').fill(TITLE)
  await form.getByLabel('Type').selectOption('brochure')
  await form.getByLabel('Brief').fill('A5 flyer for the clinic open day, our colours.')
  await form.getByRole('button', { name: 'Send request' }).click()

  await expect(page).toHaveURL(/\/marketing\/design-requests\?request=DR-/)
  const id = new URL(page.url()).searchParams.get('request')!
  await expect(dialog(page, TITLE)).toBeVisible()
  await dialog(page, TITLE).getByRole('button', { name: 'Close' }).click()

  // Only their own requests: theirs (new + seed) yes, a marketing one no.
  await expect(page.getByRole('heading', { name: 'Design requests' })).toBeVisible()
  const requested = page.locator('section[aria-label^="Requested, "]')
  await expect(requested).toContainText(TITLE)
  await expect(requested).toContainText('One-pager for the healthcare pitch')
  await expect(page.getByText('Case study cover for Al Noor Clinics')).toHaveCount(0)

  // The Marketing Manager assigns the designer and walks it to delivered.
  await signInAs(page, 'u7')
  await page.goto(`/marketing/design-requests?request=${id}`)
  const req = dialog(page, TITLE)
  await req.getByRole('button', { name: 'Edit' }).click()
  const edit = dialog(page, 'Edit design request')
  await edit.getByLabel('Designer').selectOption({ label: 'Hind Al Mansoori · UI Designer' })
  await edit.getByRole('button', { name: 'Save request' }).click()
  await expect(edit).toHaveCount(0)
  await expect(req.getByText('Hind Al Mansoori', { exact: true })).toBeVisible()

  for (const [button, status] of [
    ['Start work', 'In progress'],
    ['Send for review', 'In review'],
    ['Approve', 'Approved'],
  ] as const) {
    await req.getByRole('button', { name: button, exact: true }).click()
    await expect(req.getByText(status, { exact: true }).first()).toBeVisible()
  }
  await req.getByTestId('design-file-input').setInputFiles({ name: 'flyer-final.png', mimeType: 'image/png', buffer: PNG })
  await expect(req.getByText('flyer-final.png', { exact: true })).toBeVisible()
  await req.getByRole('button', { name: 'Mark delivered' }).click()
  await expect(req.getByText('Delivered', { exact: true }).first()).toBeVisible()
  await req.getByRole('button', { name: 'Save to Brand assets' }).click()

  await expect(page).toHaveURL(/\/marketing\/assets\?asset=BA-/)
  await expect(dialog(page, TITLE)).toBeVisible()
  await expect(dialog(page, TITLE).getByRole('link', { name: 'Design request' })).toBeVisible()
})

test('brand assets: upload validation refuses a fake image and a wrong type, accepts a real PNG', async ({ page }) => {
  await signInAs(page, 'u7')
  await page.goto('/marketing/assets')
  await expect(page.getByRole('heading', { name: 'Brand assets' })).toBeVisible()
  // The company logo from Settings › Branding is listed as a read-only system asset.
  await expect(page.getByText('Company logo (light theme)')).toBeVisible()

  await page.getByRole('button', { name: 'Upload asset' }).click()
  const modal = dialog(page, 'Upload asset')
  const input = modal.getByLabel('Asset file')

  await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('this is not really a png') })
  await expect(modal.getByRole('alert')).toContainText('content doesn’t match')

  await input.setInputFiles({ name: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') })
  await expect(modal.getByRole('alert')).toContainText('files must be one of')

  await input.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG })
  await expect(modal.getByRole('alert')).toHaveCount(0)
  await modal.getByLabel('Name').fill('E2E pixel')
  await modal.getByLabel('Tags').fill('e2e, web')
  await modal.getByRole('button', { name: 'Upload' }).click()

  await expect(page).toHaveURL(/asset=BA-/)
  await expect(dialog(page, 'E2E pixel')).toBeVisible()
  await expect(dialog(page, 'E2E pixel').getByText('image/png · 70 B')).toBeVisible()
})
