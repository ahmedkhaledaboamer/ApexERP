import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/** Opens the header "+ New" panel (retries: the first click can land before hydration). */
async function openNew(page: Page) {
  const search = page.getByRole('textbox', { name: 'Search what to create' })
  await expect(async () => {
    if (!(await search.isVisible())) await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(search).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  return search
}

test('admin: search "invoice" + Enter opens the invoice editor', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/dashboard')
  const search = await openNew(page)
  await search.fill('invoice')
  await expect(page.getByRole('menuitem').first()).toContainText('New invoice')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/finance\/invoices\/new$/)
  await expect(page.getByRole('heading', { name: 'New invoice' })).toBeVisible({ timeout: 30_000 })
})

test('admin: New contract opens the contract form; New task focuses the task form; Escape closes', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/dashboard')
  // No customer form exists (customers come from a won lead), so the menu has none.
  await openNew(page)
  await expect(page.getByRole('menuitem', { name: 'New customer' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Search what to create' })).toHaveCount(0)

  await openNew(page)
  await page.getByRole('menuitem', { name: 'New contract', exact: true }).click()
  await expect(page.getByRole('dialog').filter({ hasText: 'New contract' })).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/crm\/contracts$/) // the param is dropped once the form opens
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog').filter({ hasText: 'New contract' })).toHaveCount(0)

  await openNew(page)
  await page.getByRole('menuitem', { name: 'New task', exact: true }).first().click() // in "Common" and in Projects & tasks
  await expect(page).toHaveURL(/\/tasks\/my$/)
  await expect(page.getByRole('textbox', { name: 'Task title' })).toBeFocused({ timeout: 30_000 })
})

test('a Sales Agent sees self-service but no finance / HR-admin items', async ({ page }) => {
  await signInAs(page, 'u4')
  await page.goto('/dashboard')
  await openNew(page)
  for (const name of ['Request leave', 'New expense claim', 'Request a purchase', 'New lead', 'New quotation'])
    await expect(page.getByRole('menuitem', { name, exact: true }).first()).toBeVisible()
  for (const name of ['New invoice', 'New bill', 'New journal entry', 'New employee', 'New job opening', 'New payroll run', 'Add user'])
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0)
})

test('palette: "Create quotation" opens the quotation editor', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/dashboard')
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('Control+k')
  const input = page.getByRole('combobox', { name: 'Command' }).or(page.getByRole('textbox', { name: 'Command' }))
  await input.fill('Create quotation')
  await expect(page.getByRole('option').first()).toContainText('Create quotation')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/sales\/quotations\/new$/)
})
