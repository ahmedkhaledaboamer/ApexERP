import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Events › budget shows what finance billed (Accounts & finance › Bills linked to a budget line): the seeded
 * BILL-1005 is charged to the first budget line of Apex's seeded event, so that line's "Billed" cell shows the amount
 * and a link to the bill; the event cost counts max(actual, billed) per line (no double counting).
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
async function api(page: Page, path: string): Promise<Json> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}') as { token?: string }
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return r.json()
  }, path)
}

test('the event budget shows the Billed column with a link to the bill', async ({ page }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'u1')
  const bill = await api(page, '/finance/bills/BILL-1005')
  const line = (bill.lines as Json[]).find((l) => l.budget_line_id)!
  const budget = await api(page, `/events/${line.event_id}/budget`)
  const b = (budget.lines as Json[]).find((l) => l.id === line.budget_line_id)!
  expect(b.billed).toBeGreaterThan(0)
  expect(budget.cost_total).toBe((budget.lines as Json[]).reduce((s: number, l: Json) => Math.round((s + Math.max(l.actual, l.billed)) * 100) / 100, 0))

  await page.goto(`/events/${line.event_id}?tab=budget`)
  const table = page.getByRole('table', { name: 'Budget lines' })
  await expect(table.getByRole('columnheader', { name: 'Billed' })).toBeVisible({ timeout: 30_000 })
  const cell = page.getByTestId(`billed-${line.budget_line_id}`)
  await expect(cell.getByRole('link', { name: bill.number })).toBeVisible()
  await cell.getByRole('link', { name: bill.number }).click()
  await expect(page).toHaveURL(/\/finance\/bills\/BILL-1005$/)
})
