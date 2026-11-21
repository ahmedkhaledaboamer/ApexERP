import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR â€º Reports end to end (Apex):
 *   - Mariam Saeed (u9, HR Manager) opens the reports, switches tabs, filters by department and exports a CSV;
 *     the Payroll cost tab is there for her;
 *   - Daniel Ortiz (u10, Department Head of Delivery) sees only Delivery and no Payroll cost tab;
 *   - Noura Al Ketbi (u11, Employee) has no HR Reports item and is sent away from the page.
 */

test('HR manager: tabs, department filter, CSV export, payroll tab', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u9')
  await page.goto('/hr/reports')
  await expect(page.getByRole('heading', { name: 'HR Reports' })).toBeVisible()
  await expect(page.getByLabel('Main navigation').getByRole('link', { name: 'HR Reports' })).toBeVisible()
  await expect(page.getByTestId('kpi-headcount')).toHaveText(/^\d+$/)

  const tabs = page.getByRole('tablist', { name: 'Reports' })
  await expect(tabs.getByRole('tab', { name: 'Payroll cost' })).toBeVisible()
  await tabs.getByRole('tab', { name: 'Headcount' }).click()
  await expect(page).toHaveURL(/tab=headcount/)
  const total = page.getByTestId('headcount-total')
  await expect(total).toHaveText(/^\d+$/)
  const all = Number(await total.textContent())

  await page.getByLabel('Department', { exact: true }).selectOption({ label: 'Delivery' })
  await expect(total).not.toHaveText(String(all))
  const delivery = Number(await total.textContent())
  expect(delivery).toBeGreaterThan(0)
  expect(delivery).toBeLessThan(all)
  await expect(page.getByRole('list', { name: 'Headcount by department' }).getByText('Sales')).toHaveCount(0)

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
  expect(download.suggestedFilename()).toMatch(/^hr-headcount-d-delivery-\d{4}-01-01-to-\d{4}-12-31\.csv$/)
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv).toContain('Employee no,Name,Department')
  expect(csv.trim().split(/\r?\n/)).toHaveLength(delivery + 1)
  expect(csv).not.toMatch(/IBAN|salary/i)

  await tabs.getByRole('tab', { name: 'Emiratisation' }).click()
  await expect(page.getByText(/not an official MOHRE/i)).toBeVisible()
  await tabs.getByRole('tab', { name: 'Payroll cost' }).click()
  await expect(page.getByTestId('payroll-current')).toBeVisible()
  await tabs.getByRole('tab', { name: 'Compliance & expiries' }).click()
  await expect(page.getByRole('table', { name: 'Expiries summary' })).toBeVisible()
})

test('department head sees only their department and no payroll; an employee has no reports', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u10')
  await page.goto('/hr/reports')
  await expect(page.getByRole('heading', { name: 'HR Reports' })).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Reports' })
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: 'Payroll cost' })).toHaveCount(0)
  const options = await page.getByLabel('Department', { exact: true }).locator('option').allTextContents()
  expect(options).toEqual(['All my departments', 'Delivery'])
  await tabs.getByRole('tab', { name: 'Headcount' }).click()
  const byDept = page.getByRole('list', { name: 'Headcount by department' })
  await expect(byDept.getByText('Delivery')).toBeVisible()
  await expect(byDept.locator('li')).toHaveCount(1)
  // A direct link to the payroll tab falls back to the overview.
  await page.goto('/hr/reports?tab=payroll-cost')
  await expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('kpi-payroll')).toHaveCount(0)

  await signInAs(page, 'u11')
  await page.goto('/hr/leave')
  await expect(page.getByLabel('Main navigation').getByRole('link', { name: 'Leave', exact: true })).toBeVisible()
  await expect(page.getByLabel('Main navigation').getByRole('link', { name: 'HR Reports' })).toHaveCount(0)
  await page.goto('/hr/reports')
  await expect(page).toHaveURL(/\/dashboard/)
})
