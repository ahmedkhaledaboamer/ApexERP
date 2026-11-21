import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Reports › Company performance, Reports hub and Accounts & finance › Profitability end to end (Apex):
 *   - Management (u2) sees the financial KPIs and the department scorecard with money columns;
 *   - a Department Head (u10, no accounting) sees sales / delivery tiles, no financial section, a scorecard without money;
 *   - the Sales Manager (u3, accounting view) sees project profitability without the labour cost column;
 *   - the Accountant (u8) opens project profitability and drills into a project (monthly trend, ledger lines);
 *   - the Reports hub lists reports by area and a favourite persists across a reload.
 */

test('management sees financial KPIs and the department scorecard', async ({ page }) => {
  await signInAs(page, 'u2')
  await page.goto('/reports/performance')
  await expect(page.getByRole('heading', { name: 'Company performance' })).toBeVisible()
  const fin = page.getByRole('region', { name: 'Financial KPIs' })
  await expect(fin).toBeVisible({ timeout: 30_000 })
  await expect(fin.getByText('Revenue (period)')).toBeVisible()
  await expect(fin.getByText('Cash and bank')).toBeVisible()
  await expect(fin.getByText('Receivables overdue')).toBeVisible()
  const card = page.getByRole('table', { name: 'Department scorecard' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('columnheader', { name: /Revenue/ })).toBeVisible()
  await expect(card.getByRole('link', { name: 'Delivery' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Operational KPIs' }).getByText('Pipeline value')).toBeVisible()
})

test('a department head sees sales and delivery tiles but no financial figures', async ({ page }) => {
  await signInAs(page, 'u10')
  await page.goto('/reports/performance')
  const ops = page.getByRole('region', { name: 'Operational KPIs' })
  await expect(ops).toBeVisible({ timeout: 30_000 })
  await expect(ops.getByText('Pipeline value')).toBeVisible()
  await expect(ops.getByText('Overdue tasks')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Financial KPIs' })).toHaveCount(0)
  await expect(page.getByText('Revenue (period)')).toHaveCount(0)
  await expect(page.getByText('Cash and bank')).toHaveCount(0)
  const card = page.getByRole('table', { name: 'Department scorecard' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('columnheader', { name: /Revenue|Margin/ })).toHaveCount(0)
})

test('the sales manager sees project profitability without the labour cost', async ({ page }) => {
  await signInAs(page, 'u3')
  await page.goto('/finance/profitability')
  const table = page.getByRole('table', { name: 'Project profitability' })
  await expect(table).toBeVisible({ timeout: 30_000 })
  await expect(table.getByRole('columnheader', { name: 'Labour h' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Labour cost' })).toHaveCount(0)
  await expect(page.getByText(/margins here are before labour/)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0)
})

test('the accountant drills into a project’s profitability', async ({ page }) => {
  await signInAs(page, 'u8')
  await page.goto('/finance/profitability')
  const table = page.getByRole('table', { name: 'Project profitability' })
  await expect(table).toBeVisible({ timeout: 30_000 })
  await expect(table.getByRole('columnheader', { name: 'Labour cost' })).toBeVisible()
  const first = table.getByRole('row').nth(1).getByRole('link').first()
  const name = (await first.textContent())!.trim()
  await first.click()
  await expect(page).toHaveURL(/\/finance\/profitability\/projects\//)
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Monthly trend')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Ledger lines of the project' })).toBeVisible()
  await expect(page.getByText(/Labour is an allocation, not a ledger posting/)).toBeVisible()
  // The other reports open from the tabs.
  await page.goto('/finance/profitability?tab=customers')
  await expect(page.getByRole('table', { name: 'Customer profitability' })).toBeVisible({ timeout: 30_000 })
  await page.goto('/finance/profitability?tab=departments')
  await expect(page.getByRole('table', { name: 'Department P&L' })).toBeVisible({ timeout: 30_000 })
})

test('the reports hub lists reports by area and a favourite persists', async ({ page }) => {
  await signInAs(page, 'u2')
  await page.goto('/reports')
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible()
  for (const area of ['Management', 'Sales', 'Finance']) await expect(page.getByRole('region', { name: area })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Leads by status' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Project profitability' }).first()).toBeVisible()

  const star = page.getByRole('button', { name: 'Add Agent performance to favourites' })
  await star.click()
  await expect(page.getByRole('button', { name: 'Remove Agent performance from favourites' })).toBeVisible()
  // The mock DB saves on a 300 ms debounce: let it persist before a full reload.
  await page.waitForTimeout(1000)
  await page.reload()
  await expect(page.getByRole('list', { name: 'Favourites' }).getByRole('link', { name: 'Agent performance' })).toBeVisible({ timeout: 30_000 })
  const remove = page.getByRole('button', { name: 'Remove Agent performance from favourites' })
  await expect(remove).toHaveAttribute('aria-pressed', 'true')
  // Cleanup.
  await remove.click()
  await expect(page.getByRole('button', { name: 'Add Agent performance to favourites' })).toBeVisible()
  await page.waitForTimeout(1000)
})
