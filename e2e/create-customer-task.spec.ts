import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * The "+ New" menu's New customer and New task popups (shared Drawer, variant="dialog"): each opens
 * from the menu, creates a record through the mock API, and the record survives a full reload
 * (the dev mock DB persists to IndexedDB on a 300 ms debounce, so wait before reloading).
 */

/** Opens the header "+ New" panel (retries: the first click can land before hydration). */
async function openNew(page: Page) {
  const search = page.getByRole('textbox', { name: 'Search what to create', exact: true })
  await expect(async () => {
    if (!(await search.isVisible())) await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(search).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

/** Calls the mock API as the signed-in user. */
async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return r.json()
  }, path)
}

const stamp = () => Date.now().toString(36)

test('New customer: the popup creates a customer and opens its profile', async ({ page }) => {
  const name = `E2E Direct Client ${stamp()} LLC`
  await signInAs(page, 'u1')
  await page.goto('/dashboard')
  await openNew(page)
  await page.getByRole('menuitem', { name: 'New customer', exact: true }).click()

  const dialog = page.getByRole('dialog').filter({ hasText: 'New customer' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/crm\/customers$/) // the param is dropped once the form opens
  await expect(dialog.getByRole('textbox', { name: 'Company name', exact: true })).toBeFocused()

  // Required fields first: submitting empty shows the errors and keeps the popup open.
  await dialog.getByRole('button', { name: 'Add customer', exact: true }).click()
  await expect(dialog.getByText('Company name is required.')).toBeVisible()

  await dialog.getByRole('textbox', { name: 'Company name', exact: true }).fill(name)
  await dialog.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('Logistics')
  await dialog.getByRole('combobox', { name: 'Source', exact: true }).selectOption('Website')
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('vip')
  await dialog.getByRole('textbox', { name: 'Website', exact: true }).fill(`e2e-${stamp()}.ae`)
  await dialog.getByRole('combobox', { name: 'Emirate', exact: true }).selectOption('Dubai')
  await dialog.getByRole('textbox', { name: 'Contact name', exact: true }).fill('Mona Saleh')
  await dialog.getByRole('textbox', { name: 'Job title', exact: true }).fill('Finance Director')
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(`mona.${stamp()}@e2e-client.ae`)
  await dialog.getByRole('button', { name: 'Add customer', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/crm\/customers\/C-[\w-]+$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Mona Saleh').first()).toBeVisible()

  // It is in the list and survives a full reload.
  const rows = await apiGet<{ id: string; name: string; status: string; city: string }[]>(page, '/customers')
  expect(rows.find((r) => r.name === name)).toMatchObject({ status: 'vip', city: 'Dubai' })
  await page.waitForTimeout(1000)
  await page.goto('/crm/customers')
  await page.reload()
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 })
})

test('New task: the popup creates a task with every detail', async ({ page }) => {
  const title = `E2E full task ${stamp()}`
  await signInAs(page, 'u1')
  await page.goto('/dashboard')
  await openNew(page)
  await page.getByRole('menuitem', { name: 'New task', exact: true }).first().click() // in "Common" and in Projects & tasks

  const dialog = page.getByRole('dialog').filter({ hasText: 'New task' })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/tasks\/my$/)
  const titleBox = dialog.getByRole('textbox', { name: 'Title', exact: true })
  await expect(titleBox).toBeFocused()

  await titleBox.fill(title)
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Prepare the onboarding pack and share it with the client.')
  await dialog.getByRole('combobox', { name: 'Assignee', exact: true }).selectOption({ label: 'Karim Nasser' })
  await dialog.getByLabel('Due date').fill('2026-12-15')
  await dialog.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high')
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).selectOption('in_progress')
  // Related record: a customer.
  await dialog.getByRole('combobox', { name: 'Link type', exact: true }).selectOption('customer')
  const search = dialog.getByRole('combobox', { name: 'Search customers', exact: true })
  await search.click()
  await search.fill('Desert Rose')
  await dialog.getByRole('option').filter({ hasText: 'Desert Rose' }).first().click()
  await expect(dialog.getByRole('button', { name: 'Remove link', exact: true })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Estimated hours', exact: true }).fill('6')
  await dialog.getByRole('button', { name: 'Create task', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('Task created')).toBeVisible()

  type WireTask = { id: string; title: string; description: string; owner_id: string; priority: string; status: string; due_date: string; estimated_hours: number; link: { type: string; id: string } | null }
  const find = async () => (await apiGet<WireTask[]>(page, '/tasks')).find((t) => t.title === title)
  expect(await find()).toMatchObject({
    owner_id: 'u3',
    priority: 'high',
    status: 'in_progress',
    due_date: '2026-12-15',
    estimated_hours: 6,
    description: 'Prepare the onboarding pack and share it with the client.',
    link: { type: 'customer' },
  })

  // Survives a full reload.
  await page.waitForTimeout(1000)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'My tasks', exact: true })).toBeVisible({ timeout: 30_000 })
  expect((await find())?.title).toBe(title)
})
