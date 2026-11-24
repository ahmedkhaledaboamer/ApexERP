import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Employees, Employee contracts, Company assets end to end (Apex):
 *   - Mariam Saeed (u9, HR Manager) creates an employee in Delivery + a passport → Daniel Ortiz (u10, Department
 *     Head of Delivery) sees the profile with the number masked (last 4), never in full;
 *   - an expiring seeded document shows the alert badge on the Employees list;
 *   - a contract is renewed (the old one shows as Renewed);
 *   - an asset is assigned, then returned;
 *   - Noura Al Ketbi (u11, Employee) sees only her own profile.
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

const settle = (page: Page) => page.waitForTimeout(800)
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

test('HR creates an employee + document; the department head sees the number masked', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Date.now().toString(36)
  const name = `Zara E2E ${tag}`
  await signInAs(page, 'u9')
  await page.goto('/hr/employees')
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible()
  await page.getByRole('button', { name: 'New employee' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Full name').fill(name)
  await drawer.locator('#emp-title').fill('Field Engineer') // not "Job title in Arabic"
  await drawer.getByLabel('Department').selectOption({ label: 'Delivery' })
  await drawer.getByRole('button', { name: 'Add employee' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  const url = page.url()

  await page.getByRole('tab', { name: /Documents/ }).click()
  await page.getByRole('button', { name: 'Add document' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Document number').fill('E2EP12345678')
  await modal.getByLabel('Expiry date').fill(isoIn(800))
  await modal.getByRole('button', { name: 'Add document' }).click()
  const docs = page.getByRole('table', { name: 'Documents' })
  await expect(docs.getByText('•••• 5678')).toBeVisible()
  await expect(page.getByText('E2EP12345678')).toHaveCount(0)
  await settle(page)

  // The head of Delivery sees the new team member, number masked, no reveal.
  await signInAs(page, 'u10')
  await page.goto(url)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await page.getByRole('tab', { name: /Documents/ }).click()
  await expect(page.getByRole('table', { name: 'Documents' }).getByText('•••• 5678')).toBeVisible()
  await expect(page.getByRole('button', { name: /Show Passport number/ })).toHaveCount(0)
  await expect(page.getByText('E2EP12345678')).toHaveCount(0)
})

test('an expiring document shows the alert badge on the Employees list', async ({ page }) => {
  await signInAs(page, 'u9')
  await page.goto('/hr/employees')
  await page.getByLabel('Search employees').fill('Noura Al Ketbi')
  const row = page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' })
  await expect(row.getByText('Expiring doc')).toBeVisible()
  await row.click()
  await page.getByRole('tab', { name: /Documents/ }).click()
  await expect(page.getByRole('table', { name: 'Documents' }).getByText(/Expiring/)).toBeVisible()
})

test('a contract is renewed; the old one is kept as Renewed', async ({ page }) => {
  await signInAs(page, 'u9')
  await page.goto('/hr/employees/EMP-u14?tab=contract')
  await expect(page.getByRole('heading', { name: 'Yusuf Rahman' })).toBeVisible()
  const list = page.getByRole('list', { name: 'Contracts' })
  await expect(list.getByText('Active')).toBeVisible()
  await list.getByRole('button', { name: 'Renew' }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Basic salary').fill('21000')
  await drawer.getByRole('button', { name: 'Renew contract' }).click()
  await expect(list.getByText('Renewed')).toBeVisible()
  await expect(list.getByText('Active')).toHaveCount(1)
})

test('an asset is assigned, then returned', async ({ page }) => {
  test.setTimeout(90_000)
  const tagNo = `E2E-${Date.now().toString(36).toUpperCase()}`
  await signInAs(page, 'u9')
  await page.goto('/hr/assets')
  await expect(page.getByRole('heading', { name: 'Company Assets' })).toBeVisible()
  expect((await apiCall(page, 'POST', '/hr/assets', { tag: tagNo, name: 'E2E test laptop', category: 'laptop', brand: 'Dell' })).status).toBe(200)
  // Let the mock DB save (debounced) before the reload picks it up.
  await settle(page)
  await page.reload()
  await page.getByLabel('Search assets').fill(tagNo)
  const row = page.getByRole('row').filter({ hasText: tagNo })
  await expect(row.getByText('In stock')).toBeVisible()
  await row.getByRole('button', { name: 'Assign' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Employee').selectOption({ label: 'Yusuf Rahman · APX-0014' })
  await modal.getByRole('button', { name: 'Assign' }).click()
  await expect(row.getByText('Assigned')).toBeVisible()
  await expect(row.getByText('Yusuf Rahman')).toBeVisible()
  await row.getByRole('button', { name: 'Return' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm return' }).click()
  await expect(row.getByText('In stock')).toBeVisible()
  // The history keeps the hand-over and the return.
  await row.getByText('E2E test laptop').click()
  await expect(page.getByRole('list', { name: 'Assignment history' }).getByText('Yusuf Rahman')).toBeVisible()
})

test('an employee sees only their own profile', async ({ page }) => {
  await signInAs(page, 'u11')
  await page.goto('/hr/employees')
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible()
  const rows = page.getByRole('row').filter({ hasText: 'APX-' })
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Noura Al Ketbi')
  await expect(page.getByRole('button', { name: 'New employee' })).toHaveCount(0)
  await page.goto('/hr/employees/EMP-u14')
  await expect(page.getByText('Not found.')).toBeVisible()
  await page.goto('/hr/employees/EMP-u11?tab=contract')
  await expect(page.getByRole('heading', { name: 'Noura Al Ketbi' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Contracts' }).getByText('Total / month')).toBeVisible()
})
