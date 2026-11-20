import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Events › Speakers, Venues, Vendors end to end (Apex, Enterprise plan), as Sara Khoury (Marketing Manager,
 * marketing full): a directory speaker used in an event's agenda; a venue picked for a new event (its location
 * fills); a vendor linked to a budget line (the vendor page shows the spend); a blacklisted vendor can't be picked.
 */

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<Res> {
  return page.evaluate(
    async ({ m, p, b }) => {
      const raw = localStorage.getItem('apexcrm.session')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
      const r = await fetch(`/api${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
      return { status: r.status, body: await r.json() }
    },
    { m: method, p: path, b: body },
  )
}

/** The mock DB saves to IndexedDB on a debounce: let it settle before a full navigation. */
const settle = (page: Page) => page.waitForTimeout(800)
const suffix = () => Date.now().toString(36)

async function futureDate(page: Page, days: number): Promise<string> {
  return page.evaluate((n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() + n * 86_400_000)), days)
}

test('a directory speaker is added to an event’s agenda and speaks in a session', async ({ page }) => {
  test.setTimeout(90_000)
  const speaker = `E2E Speaker ${suffix()}`
  await signInAs(page, 'u7')
  await page.goto('/events/speakers')
  await expect(page.getByRole('heading', { name: 'Speakers', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New speaker' }).click()
  await page.getByRole('dialog').getByLabel(/^Name/).fill(speaker)
  await page.getByLabel('Company', { exact: true }).fill('E2E Labs')
  await page.getByLabel('Topics').fill('Testing, Automation')
  await page.getByRole('button', { name: 'Add speaker' }).click()
  await expect(page.getByRole('heading', { name: speaker })).toBeVisible()

  const date = await futureDate(page, 9)
  const ev = await apiCall(page, 'POST', '/events', { name: `E2E Agenda ${suffix()}`, type: 'conference', start_date: date, start_time: '09:00', end_time: '17:00' })
  expect(ev.status).toBe(200)
  await settle(page)
  await page.goto(`/events/${ev.body.id}?tab=agenda`)
  // Pick the speaker from the directory.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByLabel('Speaker', { exact: true }).selectOption({ label: `${speaker} · E2E Labs` })
  await page.getByRole('button', { name: 'Add to agenda' }).click()
  await expect(page.getByRole('list', { name: 'Speakers' }).getByRole('link', { name: speaker })).toBeVisible()
  // A session with that speaker.
  await page.getByRole('button', { name: 'Add session' }).click()
  await page.getByLabel('Title').fill('Testing in production')
  await page.getByRole('dialog').getByLabel(speaker, { exact: true }).check()
  await page.getByRole('button', { name: 'Save session' }).click()
  await expect(page.getByRole('region', { name: /Sessions on/ }).getByText('Testing in production')).toBeVisible()
  await expect(page.getByRole('region', { name: /Sessions on/ }).getByText(speaker)).toBeVisible()
  // The speaker page lists the event and the session.
  await page.getByRole('list', { name: 'Speakers' }).getByRole('link', { name: speaker }).click()
  await expect(page.getByRole('list', { name: 'Events' }).getByText('Testing in production')).toBeVisible()
})

test('a new venue is picked for a new event and fills its location', async ({ page }) => {
  test.setTimeout(90_000)
  const venue = `E2E Hall ${suffix()}`
  await signInAs(page, 'u7')
  await page.goto('/events/venues')
  await page.getByRole('button', { name: 'New venue' }).click()
  await page.getByRole('dialog').getByLabel(/^Name/).fill(venue)
  await page.getByRole('dialog').getByLabel('City', { exact: true }).fill('Dubai')
  await page.getByRole('dialog').getByLabel('Total capacity').fill('150')
  await page.getByRole('button', { name: 'Add venue' }).click()
  await expect(page.getByRole('heading', { name: venue })).toBeVisible()

  await page.getByRole('link', { name: 'All venues' }).click()
  await page.getByRole('link', { name: 'Back to events' }).click()
  await page.getByRole('button', { name: 'New event' }).click()
  const name = `E2E Venue Event ${suffix()}`
  await page.getByRole('dialog').getByLabel(/^Name/).fill(name)
  await page.getByLabel('Venue', { exact: true }).selectOption({ label: `${venue} · Dubai · 150 people` })
  await expect(page.getByLabel('Location', { exact: true })).toHaveValue(`${venue}, Dubai`)
  await page.getByRole('button', { name: 'Create event' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: venue })).toBeVisible()
})

test('a vendor linked to a budget line shows the spend; a blacklisted vendor can’t be picked', async ({ page }) => {
  test.setTimeout(90_000)
  const vendor = `E2E Print Co ${suffix()}`
  await signInAs(page, 'u7')
  await page.goto('/events/vendors')
  await page.getByRole('button', { name: 'New vendor' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Company name').fill(vendor)
  await drawer.getByLabel('Category').selectOption({ label: 'Printing' })
  await page.getByRole('button', { name: 'Add vendor' }).click()
  await expect(page.getByRole('heading', { name: vendor })).toBeVisible()

  const ev = await apiCall(page, 'POST', '/events', { name: `E2E Budget ${suffix()}`, type: 'exhibition', start_date: await futureDate(page, 12), budget: 10000 })
  expect(ev.status).toBe(200)
  await settle(page)
  await page.goto(`/events/${ev.body.id}?tab=budget`)
  const form = page.getByRole('form', { name: 'Add a budget line' })
  // Blacklisted vendors are listed but can't be picked.
  await expect(form.getByLabel('Vendor').locator('option', { hasText: 'Gulf Giveaways Trading' })).toBeDisabled()
  await form.getByLabel('Category').selectOption({ label: 'Printing' })
  await form.getByLabel('Planned').fill('2500')
  await form.getByLabel('Actual').fill('2300')
  await form.getByLabel('Vendor').selectOption({ label: `${vendor} · Printing` })
  await form.getByRole('button', { name: 'Add' }).click()
  const line = page.getByRole('table', { name: 'Budget lines' }).getByRole('link', { name: vendor })
  await expect(line).toBeVisible()
  // The API refuses a blacklisted vendor with a clear message.
  const refused = await apiCall(page, 'POST', `/events/${ev.body.id}/budget-lines`, { category: 'other', vendor_id: 'VND-1004' })
  expect(refused.status).toBe(422)
  expect(refused.body.message).toMatch(/blacklisted/)
  // The vendor page shows the spend from the line.
  await line.click()
  await expect(page.getByRole('heading', { name: vendor })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Spend per event' }).getByText(/AED\s2,300/)).toBeVisible()
})
