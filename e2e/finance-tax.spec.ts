import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Tax and Budgets & forecast end to end (mock API in the page):
 *   - Rashid Iqbal (u8, Apex Accountant) reviews the last quarter's VAT 201, drills into box 1; once its deadline has
 *     passed the seed has filed and paid it (reference, frozen snapshot), before that he marks it filed, then paid;
 *   - Faisal Al Harbi (u101, Crest admin) files and pays last month's ZATCA return (always a draft until its deadline,
 *     the end of the following month) and sees the zakat estimate;
 *   - Layla Mansour (u2, Apex Management) creates next year's budget from actuals, approves it; budget vs actual shows variance;
 *   - the accountant opens the cash-flow forecast: chart, table and the lowest-balance week.
 */

test('Apex accountant reviews the quarter’s VAT 201, drills into box 1, and it is filed and paid', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/tax')
  const rows = page.locator('tr[data-return]')
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  // Newest first: the current quarter is in progress; the one before has ended.
  await rows.nth(1).locator('button').first().click()
  await expect(page.getByRole('heading', { name: /VAT 201 return \(FTA\)/ })).toBeVisible()
  await expect(page.locator('tr[data-box="1b"]')).toBeVisible()
  await expect(page.locator('tr[data-box="14"]')).toContainText('Payable tax for the period')

  await page.getByRole('button', { name: 'All standard-rated sales (1a–1g)' }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('Standard rated supplies (boxes 1a–1g)')
  await expect(drawer.locator('tbody tr').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()

  // The seed files every return whose deadline (28 days after the quarter) has passed; within those 28 days the
  // quarter is still a draft and the accountant files it here.
  const markFiled = page.getByRole('button', { name: 'Mark filed' })
  if (await markFiled.isVisible()) {
    await markFiled.click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Filing reference').fill('FTA-230001234567')
    await dlg.getByRole('button', { name: 'Mark filed' }).click()
    await expect(page.getByText('Return filed')).toBeVisible()
    await expect(page.getByText('FTA-230001234567').first()).toBeVisible()
    await page.getByRole('button', { name: 'Mark paid' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Mark paid' }).click()
    await expect(page.getByText('Payment recorded')).toBeVisible()
  } else {
    await expect(page.getByText(/FTA-230\d+/).first()).toBeVisible()
  }
  await expect(page.getByText('frozen at filing')).toBeVisible()
  await expect(page.locator('main').getByText('Paid', { exact: true }).first()).toBeVisible()
})

test('Crest files and pays last month’s ZATCA return and sees the zakat estimate', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u101', 'crest')
  await page.goto('/finance/tax')
  const rows = page.locator('tr[data-return]')
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  await rows.nth(1).locator('button').first().click()
  await expect(page.getByRole('heading', { name: /VAT return \(ZATCA\)/ })).toBeVisible()
  await expect(page.locator('tr[data-box="1"]')).toContainText('Standard rated sales (15%)')
  await expect(page.locator('tr[data-box="16"]')).toContainText('Net VAT due')
  await page.getByRole('button', { name: 'Mark filed' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Filing reference').fill('ZATCA-3100998877')
  await dlg.getByRole('button', { name: 'Mark filed' }).click()
  await expect(page.getByText('Return filed')).toBeVisible()
  await expect(page.getByText('frozen at filing')).toBeVisible()
  await page.getByRole('button', { name: 'Mark paid' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mark paid' }).click()
  await expect(page.getByText('Payment recorded')).toBeVisible()
  await page.goto('/finance/tax')
  await expect(page.locator('tr[data-return]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('tab', { name: 'Zakat' }).click()
  await expect(page.getByText(/Estimate, consult your advisor/).first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Zakat base' })).toBeVisible()
})

test('a budget is created from actuals and approved; budget vs actual shows variance', async ({ page }) => {
  test.setTimeout(120_000)
  const next = new Date().getFullYear() + 1
  await signInAs(page, 'u2')
  await page.goto('/finance/planning')
  await expect(page.getByRole('table', { name: 'Budgets' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'New budget' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Fiscal year').selectOption(String(next))
  await dlg.getByLabel('Adjust by %').fill('5')
  await dlg.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Budget created')).toBeVisible()
  await expect(page.getByRole('heading', { name: `Operating budget ${next}` })).toBeVisible()
  await expect(page.locator('tr[data-line]').first()).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Budget approved and locked')).toBeVisible()
  await expect(page.locator('section[aria-label^="Budget "]').getByText('Approved (locked)')).toBeVisible()

  await page.getByRole('tab', { name: 'Budget vs actual' }).click()
  const table = page.getByRole('table', { name: 'Budget vs actual' })
  await expect(table).toBeVisible()
  await expect(table.locator('tr[data-row]').first()).toBeVisible()
  await expect(table).toContainText('Salaries and wages')
  await expect(page.locator('[data-department]').first()).toContainText('Year to date')
})

test('the cash-flow forecast renders with the lowest-balance week', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/planning?tab=forecast')
  await expect(page.getByRole('figure', { name: 'Cash-flow forecast chart' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Lowest balance · Week \d+/)).toBeVisible()
  const table = page.getByRole('table', { name: 'Cash-flow forecast table' })
  await expect(table).toContainText('Closing cash')
  await expect(table).toContainText('W13')
  await page.getByRole('radio', { name: '6 months' }).click()
  await expect(table).not.toContainText('W13')
})
