import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Financial statements end to end (Apex, accountant Rashid Iqbal u8):
 *   - opens the P&L, filters by a department, drills into an account line (its journal lines);
 *   - the balance sheet shows "Balanced"; the cash-flow check line is 0.00;
 *   - year-end: with the fiscal year starting this month (the previous year ended last month) previews the closing
 *     entry, closes the year, and the lock date is set to the year's last day;
 *   - cleanup as the Company Admin (u1): re-open the year (reason), fiscal year back to January.
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

/** The same call with another user's token (dev sign-in inside the page, the stored session untouched). */
async function apiAs(page: Page, userId: string, method: string, path: string, body?: unknown): Promise<Res> {
  return page.evaluate(
    async ({ u, m, p, b }) => {
      const s = await fetch('/api/auth/dev/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u }) })
      const { token } = (await s.json()) as { token: string }
      const r = await fetch(`/api${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
      return { status: r.status, body: await r.json() }
    },
    { u: userId, m: method, p: path, b: body },
  )
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

test('accountant: P&L by department with drill-down, balanced balance sheet, reconciled cash flow, year-end close', async ({ page }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/statements')
  await expect(page.getByRole('heading', { name: 'Financial statements' })).toBeVisible()
  const pnl = page.getByRole('table', { name: 'Profit and loss' })
  await expect(pnl).toBeVisible({ timeout: 30_000 })
  await expect(pnl.getByText('Net profit')).toBeVisible()

  // 1. Filter by a department that has P&L lines this year, then drill into its first account.
  const meta = (await apiCall(page, 'GET', '/finance/statements/meta')).body
  let dept: { id: string; name: string } | null = null
  for (const d of meta.departments as { id: string; name: string }[]) {
    const r = await apiCall(page, 'GET', `/finance/statements/profit-and-loss?period=ytd&department_id=${d.id}`)
    if ((r.body.sections as { lines: unknown[] }[]).some((s) => s.lines.length)) {
      dept = d
      break
    }
  }
  expect(dept, 'a department with P&L lines').not.toBeNull()
  await page.getByLabel('Department').selectOption({ label: dept!.name })
  const filtered = (await apiCall(page, 'GET', `/finance/statements/profit-and-loss?period=ytd&department_id=${dept!.id}`)).body
  const firstLine = (filtered.sections as { lines: { code: string; name: string }[] }[]).flatMap((s) => s.lines)[0]
  const lineButton = pnl.getByRole('button', { name: `${firstLine.code} ${firstLine.name}` })
  await expect(lineButton).toBeVisible()
  await lineButton.click()
  const drill = page.getByRole('dialog', { name: `Account activity: ${firstLine.code} ${firstLine.name}` })
  await expect(drill).toBeVisible()
  const activity = drill.getByRole('table', { name: 'Account activity' })
  await expect(activity).toBeVisible()
  await expect(activity.getByRole('link', { name: /^JV-/ }).first()).toBeVisible()
  await drill.getByRole('button', { name: /close/i }).first().click()

  // 2. Balance sheet: balanced.
  await page.getByRole('tab', { name: 'Balance sheet' }).click()
  await expect(page.getByRole('table', { name: 'Balance sheet' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Balanced' })).toBeVisible()

  // 3. Cash flow: the check line is zero.
  await page.getByRole('tab', { name: 'Cash flow' }).click()
  await expect(page.getByRole('table', { name: 'Cash flow statement' })).toBeVisible()
  await expect(page.getByTestId('cash-flow-check')).toHaveText('0.00')
  await expect(page.getByText('Reconciles to cash and bank')).toBeVisible()

  // 4. Year-end: the fiscal year starts this month, so the previous one (ended last month) can be closed.
  const today = meta.today as string
  const fyEnd = addDays(`${today.slice(0, 7)}-01`, -1)
  expect((await apiCall(page, 'PATCH', '/finance/settings', { fiscal_year_start_month: Number(today.slice(5, 7)) })).status).toBe(200)
  await page.getByRole('tab', { name: 'Year-end' }).click()
  const years = page.getByRole('table', { name: 'Fiscal years' })
  await expect(years).toBeVisible()
  const row = years.getByRole('row').filter({ hasText: 'Ended, open' }).first()
  await row.getByRole('button', { name: /^Preview the close of/ }).click()
  const lines = page.getByRole('table', { name: 'Closing entry lines' })
  await expect(lines).toBeVisible()
  await expect(lines.getByText('Retained earnings')).toBeVisible()
  await page.getByRole('button', { name: /^Close FY/ }).click()
  const confirm = page.getByRole('dialog', { name: /^Close FY/ })
  await expect(confirm).toBeVisible()
  await confirm.locator('#ye-note').fill('e2e year-end')
  await confirm.getByRole('button', { name: 'Close the year' }).click()
  await expect(confirm).toBeHidden()
  await expect(years.getByRole('row').filter({ hasText: 'Closed' }).first()).toBeVisible()
  await expect(page.getByText('Books locked up to', { exact: false }).first()).toBeVisible()
  const settings = (await apiCall(page, 'GET', '/finance/settings')).body
  expect(settings.lock_date).toBe(fyEnd)

  // Cleanup (the mock DB persists in the browser): the Company Admin re-opens the year, fiscal year back to January.
  const ye = (await apiAs(page, 'u1', 'GET', '/finance/year-end')).body
  const closeId = (ye.history as { id: string; status: string }[]).find((h) => h.status === 'closed')!.id
  expect((await apiAs(page, 'u8', 'POST', `/finance/year-end/closes/${closeId}/reopen`, { reason: 'x' })).status).toBe(403) // Accountant: Company Admin only
  const reopened = await apiAs(page, 'u1', 'POST', `/finance/year-end/closes/${closeId}/reopen`, { reason: 'e2e cleanup' })
  expect(reopened.status).toBe(200)
  expect((await apiAs(page, 'u1', 'PATCH', '/finance/settings', { fiscal_year_start_month: 1 })).status).toBe(200)
  await page.waitForTimeout(1000)
})
