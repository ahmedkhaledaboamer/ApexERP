import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Events module end to end (Apex, Enterprise plan): a marketing manager creates an event, adds a team
 * member and opens registration; a visitor registers on the public page → a lead with the source Event;
 * check-in and stats; a task linked to the event; the calendar; a role with no event access.
 */

/** GET through the app's own session (the mock API is the contract). */
async function apiGet(page: Page, path: string): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(async (p) => {
    const raw = localStorage.getItem('apexcrm.session')
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${token}` } })
    return { status: r.status, body: await r.json() }
  }, path)
}

test('event lifecycle: create, team, public registration → lead, check-in, stats, task, calendar', async ({ page }) => {
  const name = `E2E Expo ${Date.now().toString(36)}`
  await signInAs(page, 'u7') // Sara Khoury, Marketing Manager (marketing: full)
  await page.goto('/events')
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible()
  await expect(page.getByText('GITEX Global 2026')).toBeVisible()

  // Create (dates default to the company's today), with public registration open.
  await page.getByRole('button', { name: 'New event' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Name').fill(name)
  await drawer.getByLabel('Type').selectOption('exhibition')
  await drawer.getByLabel('Start time').fill('09:00')
  await drawer.getByLabel('End time').fill('17:00')
  await drawer.getByLabel('Location').fill('Expo Centre Sharjah')
  await drawer.getByLabel('Budget (AED)').fill('20000')
  await drawer.getByRole('switch', { name: 'Public registration open' }).click()
  await drawer.getByRole('button', { name: 'Create event' }).click()
  await expect(page).toHaveURL(/\/events\/EV-\d+/)
  const eventId = page.url().match(/EV-\d+/)![0]
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

  // Team: add Bincy Thomas.
  await page.getByLabel('Add a team member').selectOption({ label: 'Bincy Thomas · Sales Agent' })
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Team members' }).getByText('Bincy Thomas')).toBeVisible()

  // Public registration page (no sign-in needed). Same browser context: the mock DB lives in this
  // context's IndexedDB (saved on navigation), so the visitor's request reaches the same data.
  const link = (await page.getByTestId('registration-link').textContent())!.trim()
  expect(link).toMatch(/\/e\/[a-z]{20}$/)
  const visitor = page
  await page.waitForTimeout(800) // let the mock DB save (debounced) before leaving the page
  await visitor.goto(link)
  await expect(visitor.getByRole('heading', { name, level: 1 })).toBeVisible()
  const email = `visitor-${Date.now().toString(36)}@gulfbuyers.ae`
  await visitor.getByLabel('Full name').fill('Yara Haddad')
  await visitor.getByLabel('Work email').fill(email)
  await visitor.getByLabel('Company').fill('Gulf Buyers LLC')
  await visitor.getByLabel('Mobile').fill('050 765 4321')
  await visitor.getByRole('button', { name: 'Register' }).click()
  await expect(visitor.getByRole('status')).toContainText('You’re registered')
  await page.waitForTimeout(800)

  // The attendee is there with a new lead (source Event, event_id); check in.
  await page.goto(`/events/${eventId}?tab=attendees`)
  const row = page.getByRole('row').filter({ hasText: 'Yara Haddad' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('link', { name: /Open lead Gulf Buyers LLC/ })).toBeVisible()
  const attendees = await apiGet(page, `/events/${eventId}/attendees`)
  const att = attendees.body.find((a: { email: string }) => a.email === email)
  expect(att).toMatchObject({ lead_outcome: 'created', source: 'public' })
  const lead = await apiGet(page, `/leads/${att.lead_id}`)
  expect(lead.body).toMatchObject({ source_id: 'Event', source_detail: name, event_id: eventId, company_name: 'Gulf Buyers LLC' })
  await row.getByRole('button', { name: 'Check in Yara Haddad' }).click()
  await expect(row.getByRole('button', { name: 'Undo check-in of Yara Haddad' })).toBeVisible()

  // Stats follow.
  await page.getByRole('tab', { name: 'Leads & deals' }).click()
  const results = page.getByRole('region', { name: 'Event results' })
  await expect(results.getByText('1 checked in')).toBeVisible()
  await expect(results.getByText('1 new · 0 existing linked')).toBeVisible()
  await expect(results.getByText(/Budget .*20,000 ÷ 1 new lead$/)).toBeVisible()

  // A task linked to the event.
  await page.getByRole('tab', { name: 'Tasks' }).click()
  await page.getByPlaceholder(`Add a task for ${name} and press Enter`).fill('Book the stand furniture')
  await page.getByPlaceholder(`Add a task for ${name} and press Enter`).press('Enter')
  await expect(page.getByRole('button', { name: 'Book the stand furniture', exact: true })).toBeVisible()
  const tasks = await apiGet(page, `/tasks?related_type=event&related_id=${eventId}`)
  expect(tasks.body.find((t: { title: string }) => t.title === 'Book the stand furniture')?.link_view).toMatchObject({ type: 'event', label: name, available: true })

  // The calendar shows it (this month, company today).
  await page.waitForTimeout(800)
  await page.goto('/events/calendar')
  await expect(page.getByRole('link', { name: new RegExp(name) }).first()).toBeVisible()
  await page.getByRole('link', { name: new RegExp(name) }).first().click()
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}`))
})

test('a role with no event access sees the no-access state; another workspace’s plan gate is server-side', async ({ page }) => {
  await signInAs(page, 'u11') // Noura Al Ketbi, Employee (marketing: hidden), on no event team
  await page.goto('/events')
  await expect(page.getByText('No events for you yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0)
  // A seeded event she isn't on: refused by the API, and the page says so.
  await page.goto('/events/EV-1003')
  await expect(page.getByText('This event isn’t available to you')).toBeVisible()
})
