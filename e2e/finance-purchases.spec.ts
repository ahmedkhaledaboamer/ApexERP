import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Purchases & payables end to end (Apex, mock API in the page):
 *   Noura Al Ketbi (u11, Employee, Delivery) requests a 12,600 AED purchase order → Daniel Ortiz (u10, her department
 *   head, no accounting access) approves step 1 → Rashid Iqbal (u8, Accountant) approves step 2 (over 10,000) → goods
 *   are received → a bill is created from the PO (3-way matched) and posted → paid; the AP aging moves with it.
 * The dev mock DB saves to IndexedDB on a 300 ms debounce: wait before a full page load (signInAs / goto).
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(page: Page, path: string): Promise<Json> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}') as { token?: string }
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return r.json()
  }, path)
}
const settle = (page: Page) => page.waitForTimeout(1200)

test('employee PO request → head + accountant approve → received → bill from PO posted → paid; AP aging updates', async ({ page }) => {
  test.setTimeout(240_000)
  const tag = Date.now().toString(36).toUpperCase()
  const item = `E2E exhibition banners ${tag}`

  // 1. The employee requests the purchase (own department).
  await signInAs(page, 'u11')
  await page.goto('/finance/purchase-orders/new')
  await page.getByLabel('Supplier', { exact: true }).selectOption('VND-1002')
  await page.getByLabel('Line 1 description').fill(item)
  await page.getByLabel('Line 1 quantity').fill('10')
  await page.getByLabel('Line 1 unit price').fill('1200')
  await page.getByRole('button', { name: 'Save and submit' }).click()
  await page.waitForURL(/\/finance\/purchase-orders\/PO-[^/]+$/)
  const poId = decodeURIComponent(page.url().split('/').pop()!)
  await expect.poll(async () => (await api(page, `/finance/purchase-orders/${poId}`)).status).toBe('pending_approval')
  const po0 = await api(page, `/finance/purchase-orders/${poId}`)
  expect(po0.department_id).toBe('d-delivery')
  expect(po0.total).toBe(12600)
  expect(po0.pending_step).toBe('department_head')
  await settle(page)

  // 2. The department head approves step 1 (no accounting access).
  await signInAs(page, 'u10')
  await page.goto(`/finance/purchase-orders/${poId}`)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await api(page, `/finance/purchase-orders/${poId}`)).pending_step).toBe('Accountant')
  await settle(page)

  // 3. The accountant approves step 2 (12,600 ≥ 10,000) and receives the goods.
  await signInAs(page, 'u8')
  await page.goto(`/finance/purchase-orders/${poId}`)
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect.poll(async () => (await api(page, `/finance/purchase-orders/${poId}`)).status).toBe('approved')
  await page.getByRole('button', { name: 'Receive goods' }).click()
  await page.getByLabel(`Receive ${item}`).fill('10')
  await page.getByRole('button', { name: 'Confirm receipt' }).click()
  await expect.poll(async () => (await api(page, `/finance/purchase-orders/${poId}`)).status).toBe('received')

  const asOf = (await api(page, '/finance/purchases/meta')).today as string
  const agingBefore = (await api(page, `/finance/payables/aging?as_of=${asOf}`)).totals.total as number

  // 4. Bill from the PO (prefilled, 3-way matched) → post directly.
  await page.getByRole('button', { name: 'Create bill' }).click()
  await page.waitForURL(/\/finance\/bills\/new\?po=/)
  await page.getByLabel('Supplier invoice number').fill(`EPH-E2E-${tag}`)
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL(/\/finance\/bills\/BILL-[^/]+$/)
  const billId = decodeURIComponent(page.url().split('/').pop()!)
  await page.getByRole('button', { name: 'Post bill' }).click()
  await expect.poll(async () => (await api(page, `/finance/bills/${billId}`)).status).toBe('open')
  const bill = await api(page, `/finance/bills/${billId}`)
  expect(bill.total).toBe(12600)
  expect(bill.match.kind).toBe('three_way')
  expect(bill.match.ok).toBe(true)
  expect(bill.journal.lines.some((l: Json) => l.account_code === '1300' && l.debit === 600)).toBe(true)
  expect(bill.journal.lines.some((l: Json) => l.account_code === '2100' && l.credit === 12600)).toBe(true)
  await expect.poll(async () => (await api(page, `/finance/purchase-orders/${poId}`)).status).toBe('closed')
  await expect.poll(async () => (await api(page, `/finance/payables/aging?as_of=${asOf}`)).totals.total).toBe(Math.round((agingBefore + 12600) * 100) / 100)

  // 5. Pay it.
  await page.getByRole('button', { name: 'Record payment' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Record payment' }).click()
  await expect.poll(async () => (await api(page, `/finance/bills/${billId}`)).status).toBe('paid')
  await expect.poll(async () => (await api(page, `/finance/payables/aging?as_of=${asOf}`)).totals.total).toBe(agingBefore)

  // 6. The payables tab shows the aging.
  await page.goto('/finance/bills?tab=payables')
  await expect(page.getByRole('tab', { name: 'Payables' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Emirates Print House').first()).toBeVisible()
})

test('the requester sees only her own requests; the bills page is not for her', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u11')
  const pos = (await api(page, '/finance/purchase-orders')) as Json[]
  expect(pos.length).toBeGreaterThan(0)
  for (const p of pos) expect(p.requester_id === 'u11' || p.awaiting_me).toBe(true)
  const bills = await api(page, '/finance/bills')
  expect(bills).toEqual([])
  await page.goto('/finance/purchase-orders')
  await expect(page.getByRole('button', { name: /New purchase request/ }).or(page.getByRole('link', { name: /New purchase request/ })).first()).toBeVisible()
})
