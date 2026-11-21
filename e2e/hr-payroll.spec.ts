import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Salary Management end to end (Apex, current month):
 *   - Mariam Saeed (u9, HR Manager) opens this month's draft run and calculates it; she can't approve her own run;
 *   - Layla Mansour (u2, Management) acknowledges the warnings, approves (maker–checker), marks it paid and downloads
 *     the WPS SIF file;
 *   - Noura Al Ketbi (u11, Employee) sees only her own payslips, including this month's, and opens the printable one.
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
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

test('HR calculates, a second approver approves and pays, WPS downloads, the employee sees the payslip', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u9')
  await page.goto('/hr/salary')
  await expect(page.getByRole('heading', { name: 'Salary Management' })).toBeVisible()
  const runs = await apiCall(page, 'GET', '/hr/payroll/runs')
  const run = (runs.body as { id: string; month: string; status: string }[]).find((r) => r.status !== 'paid')!
  expect(run).toBeTruthy()
  const label = monthLabel(run.month)

  // 1. The maker calculates this month's run.
  await page.getByRole('table', { name: 'Payroll runs' }).getByRole('button', { name: label }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText(`Payroll ${label}`)).toBeVisible()
  await drawer.getByRole('button', { name: /^(Calculate|Recalculate)$/ }).click()
  await expect(drawer.getByText('Awaiting approval').first()).toBeVisible()
  await expect(drawer.getByRole('table', { name: 'Payroll lines' })).toBeVisible()
  await expect(drawer.getByText(/Maker–checker/)).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await settle(page)

  // 2. The checker approves (after acknowledging the warnings), marks it paid and downloads the WPS file.
  await signInAs(page, 'u2')
  await page.goto(`/hr/salary?run=${run.id}`)
  const d2 = page.getByRole('dialog')
  await expect(d2.getByText(`Payroll ${label}`)).toBeVisible()
  await d2.getByRole('button', { name: 'Acknowledge all warnings' }).click()
  await expect(d2.getByRole('button', { name: 'Approve' })).toBeEnabled()
  await d2.getByRole('button', { name: 'Approve' }).click()
  await expect(d2.getByText('Approved by Layla Mansour')).toBeVisible()
  await d2.getByRole('button', { name: 'Mark paid' }).click()
  await expect(d2.getByText(/This run is paid and locked/)).toBeVisible()
  const download = page.waitForEvent('download')
  await d2.getByRole('button', { name: 'Download WPS file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^\d{13}\d{12}\.SIF$/)
  await settle(page)

  // 3. The employee sees only their own payslips, this month's included.
  await signInAs(page, 'u11')
  await page.goto('/hr/salary')
  await expect(page.getByRole('heading', { name: 'My payslips' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Payslips' })
  await expect(table.getByText(label, { exact: true })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Employee' })).toHaveCount(0)
  await table.getByRole('link', { name: `View payslip for ${label}` }).click()
  await expect(page.getByRole('heading', { name: `Payslip · ${label}` })).toBeVisible()
  await expect(page.getByRole('article').getByText('Noura Al Ketbi', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible()
  // Someone else's payroll is not reachable.
  expect((await apiCall(page, 'GET', '/hr/payroll/runs')).status).toBe(403)
})
