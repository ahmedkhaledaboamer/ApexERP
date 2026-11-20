import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Cross-event Events sections (Apex): the attendee directory (filter + person drawer), booth leads
 * (overdue filter + bulk assign owner) and event analytics (a row's cost per lead = the event page's).
 */

test('attendees directory: filter by event and open a person', async ({ page }) => {
  await signInAs(page, 'u7')
  await page.goto('/events/attendees')
  await expect(page.getByRole('heading', { name: 'Attendees', exact: true })).toBeVisible()
  const count = page.getByTestId('attendee-count')
  await expect(count).toContainText(/\d+ people/)
  const before = await count.textContent()
  await page.getByLabel('Event', { exact: true }).selectOption({ label: 'Smart Property AI Webinar' })
  await expect(count).not.toHaveText(before ?? '')
  const firstRow = page.locator('tbody tr').first()
  await firstRow.click()
  const regs = page.getByTestId('person-registration')
  await expect(regs.filter({ hasText: 'Smart Property AI Webinar' })).toHaveCount(1)
  await expect(page.getByText('Registrations', { exact: true })).toBeVisible()
})

test('booth leads: overdue filter and assign owner', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/events/booth-leads')
  await expect(page.getByRole('heading', { name: 'Booth leads', exact: true })).toBeVisible()
  await page.getByRole('switch', { name: 'Overdue follow-up only' }).click()
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  const n = await rows.count()
  await expect(page.getByTestId('overdue-flag')).toHaveCount(n)
  await rows.first().getByRole('checkbox', { name: 'Select row' }).check()
  await page.getByRole('button', { name: 'Assign owner' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New owner').selectOption({ label: await dialog.getByLabel('New owner').locator('option', { hasText: 'Bincy Thomas' }).first().innerText() })
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(page.getByText(/1 lead reassigned/)).toBeVisible()
  await expect(rows.first()).toContainText('Bincy Thomas')
})

test('event analytics: an event row and its cost per lead match the event page', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/events/analytics')
  await expect(page.getByRole('heading', { name: 'Event analytics', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Hospitality Leaders Roundtable' })).toBeVisible()
  const cpl = (await page.getByTestId('cpl-EV-1005').innerText()).replace('*', '').trim()
  expect(cpl).not.toBe('—')
  await page.goto('/events/EV-1005?tab=leads')
  await expect(page.getByRole('region', { name: 'Event results' }).getByText(cpl, { exact: true })).toBeVisible()
})
