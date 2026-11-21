import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Expenses end to end (Apex, mock API in the page):
 *   - Ahmed Al Falasi (u5, Sales Agent, accounting hidden) submits a claim from My HR with a receipt → Karim Nasser
 *     (u3, head of Sales) approves → Rashid Iqbal (u8, Accountant) approves and sends it to payroll;
 *   - the accountant records a supplier expense with a valid TRN: 5% VAT is recovered;
 *   - Noura Al Ketbi (u11) records a petty expense on her fund; the accountant replenishes it back to the float.
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(page: Page, path: string): Promise<Json> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}') as { token?: string }
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return r.json()
  }, path)
}
const png = { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex') }
/** The dev mock DB saves to IndexedDB on a 300 ms debounce: wait before switching user (full reload). */
const settle = (page: Page) => page.waitForTimeout(1200)

test('a Sales Agent claims from My HR; the department head and the accountant approve; it goes to payroll', async ({ page }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'u5')
  await page.goto('/hr/me')
  const card = page.locator('[data-slot="expenses"]')
  await expect(card.getByText('My expense claims').first()).toBeVisible({ timeout: 30_000 })
  const drawer = page.getByRole('dialog', { name: 'New expense claim' })
  // The mock's service worker may reload the page once on a cold start: click until the drawer is open.
  await expect(async () => {
    await card.getByRole('button', { name: 'New claim' }).click()
    await expect(drawer.getByLabel('Title')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 45_000 })
  await drawer.getByLabel('Title').fill('E2E client visit')
  await drawer.getByLabel('Purpose').fill('Lunch with a prospect')
  await drawer.getByLabel('Merchant', { exact: true }).fill('Operation Falafel')
  await drawer.getByLabel('Amount').fill('150')
  await drawer.getByLabel('Receipt').setInputFiles(png)
  await drawer.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(page.getByText(/Claim APX-ECL-\d{4}-\d{4} submitted/)).toBeVisible()
  const mine = (await api(page, '/finance/expense-claims')) as Json[]
  const claim = mine.find((c) => c.title === 'E2E client visit')!
  expect(claim.status).toBe('pending')
  expect(claim.lines[0].receipt.name).toBe('receipt.png')
  await settle(page)

  await signInAs(page, 'u3')
  await page.goto(`/finance/expenses?tab=claims&claim=${claim.id}`)
  const detail = page.getByRole('dialog', { name: `Expense claim ${claim.number}` })
  await detail.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await api(page, `/finance/expense-claims/${claim.id}`)).steps[0].status).toBe('approved')
  await settle(page)

  await signInAs(page, 'u8')
  await page.goto(`/finance/expenses?tab=claims&claim=${claim.id}`)
  const d2 = page.getByRole('dialog', { name: `Expense claim ${claim.number}` })
  await d2.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await api(page, `/finance/expense-claims/${claim.id}`)).status).toBe('approved')
  await d2.getByRole('button', { name: 'Reimburse…' }).click()
  await page.getByRole('dialog', { name: 'Reimburse claim' }).getByRole('button', { name: 'Add to payroll' }).click()
  await expect.poll(async () => (await api(page, `/finance/expense-claims/${claim.id}`)).status).toBe('in_payroll')
  const after = await api(page, `/finance/expense-claims/${claim.id}`)
  expect(after.reimbursement.payroll_adjustment_id).toMatch(/^PADJ-/)
})

test('an accountant records a supplier expense with VAT', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/expenses?tab=expenses&new=1')
  const drawer = page.getByRole('dialog', { name: 'Record expense' })
  await drawer.getByLabel('Supplier').selectOption({ label: 'Expo Craft Stands LLC' })
  await expect(drawer.getByRole('textbox', { name: 'Payee', exact: true })).toHaveValue('Expo Craft Stands LLC')
  await drawer.getByLabel('Description').fill('E2E stand repairs')
  await drawer.getByLabel('Amount paid (VAT included)').fill('2100')
  await expect(drawer.getByTestId('vat-preview')).toContainText('100.00')
  await drawer.getByLabel('Receipt').setInputFiles(png)
  await drawer.getByRole('button', { name: 'Save expense' }).click()
  await expect(page.getByText(/Expense APX-EXP-\d{4}-\d{4} recorded/)).toBeVisible()
  const list = (await api(page, '/finance/expenses?q=E2E%20stand')) as Json[]
  expect(list[0]).toMatchObject({ vat_amount: 100, net_amount: 2000, vat_recoverable: true, status: 'pending' })
})

test('a custodian’s petty expenses are replenished back to the float', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u11')
  await page.goto('/finance/expenses?tab=petty')
  await page.getByRole('button', { name: 'Open Head office petty cash' }).click()
  const drawer = page.getByRole('dialog', { name: 'Head office petty cash' })
  await drawer.getByRole('button', { name: 'Record petty expense' }).click()
  const form = drawer.getByRole('group', { name: 'Record petty expense' }).or(drawer.locator('section[aria-label="Record petty expense"]'))
  await form.getByLabel('Amount').fill('40')
  await form.getByLabel('Payee', { exact: true }).fill('E2E stationer')
  await form.getByLabel('What for').fill('Envelopes')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(drawer.getByText('E2E stationer')).toBeVisible()
  const funds = (await api(page, '/finance/petty-cash/funds')) as Json[]
  expect(funds).toHaveLength(1)
  const fundId = funds[0].id
  await settle(page)

  await signInAs(page, 'u8')
  await page.goto(`/finance/expenses?tab=petty&fund=${fundId}`)
  const d2 = page.getByRole('dialog', { name: 'Head office petty cash' })
  await d2.getByRole('button', { name: 'Replenish…' }).click()
  await d2.getByRole('button', { name: 'Approve and replenish' }).click()
  await expect.poll(async () => (await api(page, `/finance/petty-cash/funds/${fundId}`)).pending_total).toBe(0)
  const f = await api(page, `/finance/petty-cash/funds/${fundId}`)
  expect(f.cash_expected).toBe(f.float_limit)
  expect(f.movements[0].kind).toBe('replenishment')
})
