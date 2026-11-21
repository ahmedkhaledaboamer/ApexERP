import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › ledger core end to end (Apex, accountant Rashid Iqbal u8):
 *   - adds an expense account under Operating expenses in the chart of accounts;
 *   - posts a balanced manual journal entry to it and sees it in the trial balance;
 *   - sets the lock date in Finance settings, then a back-dated entry is refused (423 period_locked);
 *   - Sales Manager (u3) sees the overview read-only (no journal-entry button).
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

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

test('accountant adds an account, posts a journal, sees the trial balance, locks the period', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/accounts')
  await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible()
  const today = (await apiCall(page, 'GET', '/finance/overview')).body.today as string
  const accCode = '6455' // not in the UAE template
  const accName = 'Trade show booths'

  // 1. Add an account under Operating expenses.
  await expect(page.getByRole('table', { name: 'Expense accounts' })).toBeVisible()
  const modal = page.getByRole('dialog', { name: 'Add account' })
  // The page may re-mount once while the session / entitlements settle: retry the click until the dialog is open.
  await expect(async () => {
    if (!(await modal.isVisible())) await page.getByRole('button', { name: 'Add account' }).click()
    await expect(modal).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await modal.locator('#acc-code').fill(accCode)
  await modal.locator('#acc-name').fill(accName)
  await modal.locator('#acc-type').selectOption('expense')
  await modal.locator('#acc-parent').selectOption({ label: '6000 Operating expenses' })
  await modal.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('table', { name: 'Expense accounts' }).getByRole('button', { name: accName, exact: true })).toBeVisible()
  await page.waitForTimeout(1000) // let the dev mock DB save (300ms debounce) before the full reload

  // 2. Post a balanced manual entry.
  await page.goto('/finance/journal?new=1')
  const form = page.getByRole('dialog', { name: 'New journal entry' })
  await expect(form).toBeVisible()
  await form.locator('#je-date').fill(today)
  await form.locator('#je-memo').fill('Booth deposit, GITEX')
  await form.getByLabel('Line 1 account').selectOption({ label: `${accCode} ${accName}` })
  await form.getByLabel('Line 1 debit').fill('2500')
  await form.getByLabel('Line 2 account').selectOption({ label: '1120 Main bank account' })
  await form.getByLabel('Line 2 credit').fill('2500')
  await expect(form.getByText(/· Balanced$/)).toBeVisible()
  await form.getByRole('button', { name: 'Post entry' }).click()
  const entry = page.getByRole('dialog', { name: /^Journal entry JV-/ })
  await expect(entry).toBeVisible()
  await expect(entry.getByRole('table', { name: 'Entry lines' }).getByText(accName)).toBeVisible()
  await entry.getByRole('button', { name: /close/i }).first().click()

  // 3. The trial balance shows it, balanced.
  await page.getByRole('tab', { name: 'Trial balance' }).click()
  const tb = page.getByRole('table', { name: 'Trial balance' })
  const row = tb.getByRole('row').filter({ hasText: accName })
  await expect(row).toContainText('2,500.00')
  await expect(page.getByText(/Balanced at/)).toBeVisible()

  // 4. Lock the books up to yesterday.
  const lockDate = addDays(today, -1)
  await page.goto('/finance/settings')
  await expect(page.getByRole('heading', { name: 'Finance settings' })).toBeVisible()
  await page.getByLabel('Lock up to').fill(lockDate)
  await page.getByLabel('Reason (audit log)').fill('Month-end close (e2e)')
  await page.getByRole('button', { name: 'Set lock date' }).click()
  await expect(page.getByText('Books locked up to', { exact: false }).first()).toBeVisible()
  // The dev mock DB saves to IndexedDB on a 300ms debounce; let it land before the full reload below.
  await page.waitForTimeout(1000)

  // 5. A back-dated entry is refused.
  await page.goto('/finance/journal?new=1')
  const late = page.getByRole('dialog', { name: 'New journal entry' })
  await late.locator('#je-date').fill(addDays(today, -2))
  await late.locator('#je-memo').fill('Late accrual')
  await late.getByLabel('Line 1 account').selectOption({ label: `${accCode} ${accName}` })
  await late.getByLabel('Line 1 debit').fill('100')
  await late.getByLabel('Line 2 account').selectOption({ label: '1120 Main bank account' })
  await late.getByLabel('Line 2 credit').fill('100')
  await late.getByRole('button', { name: 'Post entry' }).click()
  await expect(late.getByRole('alert')).toContainText('The books are locked up to')
  const refused = await apiCall(page, 'POST', '/finance/journal', { date: addDays(today, -2), memo: 'x', lines: [{ account_id: 'ACC-6800', debit: 1, credit: 0 }, { account_id: 'ACC-1120', debit: 0, credit: 1 }] })
  expect(refused.status).toBe(423)
  expect(refused.body.code).toBe('period_locked')

  // Clean up the lock so later specs start open (the mock DB persists in the browser).
  expect((await apiCall(page, 'PUT', '/finance/settings/lock-date', { lock_date: null, reason: 'e2e cleanup' })).status).toBe(200)
})

test('Sales Manager sees the finance overview read-only', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAs(page, 'u3')
  await page.goto('/finance')
  await expect(page.getByRole('heading', { name: 'Finance overview' })).toBeVisible()
  await expect(page.getByText('Cash and bank', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Journal entry' })).toHaveCount(0)
  expect((await apiCall(page, 'POST', '/finance/journal', { date: '2026-11-01', memo: 'x', lines: [] })).status).toBe(403)
})
