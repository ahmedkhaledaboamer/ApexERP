import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Banking, payroll posting and commissions end to end (Apex):
 *   - the accountant (u8) imports a CSV statement for the ADCB savings account, auto-matches it, creates a bank-charge
 *     entry from the unmatched line (the "fee" bank rule suggests 6800) and finishes the reconciliation at 0;
 *   - HR calculates the current payroll run, Management (u2) approves it in HR and the run shows its journal entry;
 *   - a sales rep (u4) opens "My commissions" from Sales targets and sees their statement.
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
const r2 = (n: number) => Math.round(n * 100) / 100

test('accountant imports a statement, auto-matches, creates a bank-charge entry and reconciles at zero', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/banking')
  await expect(page.getByRole('heading', { name: 'Banking' })).toBeVisible()
  const accounts = (await apiCall(page, 'GET', '/finance/bank-accounts')).body as { id: string; name: string; opening_balance: number }[]
  const savings = accounts.find((a) => a.name.startsWith('ADCB'))!
  const ws = (await apiCall(page, 'GET', `/finance/bank-accounts/${savings.id}/reconcile`)).body as { book_lines: { date: string; amount: number; memo: string }[] }
  const today = (await apiCall(page, 'GET', '/finance/overview')).body.today as string
  let bal = savings.opening_balance
  const rows = [...ws.book_lines.map((l) => ({ date: l.date, d: `INWARD ${l.memo}`, a: l.amount })), { date: today, d: 'BANK CHARGE MONTHLY FEE', a: -25 }]
  const csv = ['Date,Description,Amount,Balance', ...rows.map((r) => `${r.date},"${r.d}",${r.a},${(bal = r2(bal + r.a))}`)].join('\n')

  await page.goto(`/finance/banking?tab=reconcile&account=${savings.id}`)
  await page.getByRole('button', { name: 'Import statement' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import bank statement' })
  await dialog.locator('#stmt-file').setInputFiles({ name: 'adcb-statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(dialog.getByRole('table', { name: 'Statement preview' })).toContainText('BANK CHARGE MONTHLY FEE')
  await dialog.getByRole('button', { name: /^Import \d+ lines$/ }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Auto-match' }).click()
  await expect(page.getByTestId('recon-difference')).toContainText('-25.00')
  const lines = page.getByRole('table', { name: 'Statement lines' })
  await lines.getByRole('row', { name: /BANK CHARGE MONTHLY FEE/ }).getByRole('button', { name: 'Create entry' }).click()
  const entry = page.getByRole('dialog', { name: 'Create an entry from the statement line' })
  await expect(entry.locator('#ce-account')).toHaveValue('ACC-6800')
  await entry.getByRole('button', { name: 'Post and match' }).click()
  await expect(entry).toBeHidden()
  await expect(page.getByTestId('recon-difference')).toContainText('0.00')
  await expect(page.getByTestId('recon-difference')).not.toContainText('-')

  await page.getByRole('button', { name: 'Finish reconciliation' }).click()
  const finish = page.getByRole('dialog', { name: 'Finish reconciliation' })
  await finish.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByRole('dialog', { name: 'Reconciliation report' })).toBeVisible()
  const recs = (await apiCall(page, 'GET', `/finance/bank-reconciliations?bank_account_id=${savings.id}`)).body as { difference: number; status: string }[]
  expect(recs[0]).toMatchObject({ difference: 0, status: 'finished' })
})

test('a payroll run approved in HR shows its journal entry', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u9') // HR Manager: calculates (maker)
  const runs = (await apiCall(page, 'GET', '/hr/payroll/runs')).body as { id: string; status: string }[]
  const run = runs.find((r) => r.status === 'draft' || r.status === 'calculated')!
  expect((await apiCall(page, 'POST', `/hr/payroll/runs/${run.id}/calculate`)).status).toBe(200)
  expect((await apiCall(page, 'POST', `/hr/payroll/runs/${run.id}/acknowledge`, { all: true })).status).toBeLessThan(500)
  await page.waitForTimeout(1200) // the dev mock DB saves on a debounce

  await signInAs(page, 'u2') // Management: approves (checker) and can see the ledger
  await page.goto(`/hr/salary?run=${run.id}`)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByTestId('payroll-journal')).toContainText(/accrual JV-\d{4}-\d{4}/)
})

test('a sales rep sees their own commission statement', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u4')
  await page.goto('/sales/targets')
  await page.getByRole('link', { name: 'My commissions' }).click()
  await expect(page.getByRole('heading', { name: 'My commissions' })).toBeVisible()
  const list = page.getByRole('list', { name: 'My commission statements' })
  await expect(list.getByRole('listitem')).not.toHaveCount(0)
  await list.getByRole('button').first().click()
  await expect(list.getByText('Target achievement')).toBeVisible()
})
