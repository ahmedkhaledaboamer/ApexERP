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

  // 1. The employee requests the purchase from My HR (own department; no Accounts & finance section for her).
  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Purchase orders' })).toHaveCount(0)
  const card = page.locator('[data-slot="purchases"]')
  await expect(card.getByText('My purchase requests').first()).toBeVisible({ timeout: 30_000 })
  // The mock's service worker may reload the page once on a cold start: click until the form is open.
  await expect(async () => {
    await card.getByRole('button', { name: 'Request a purchase' }).click()
    await expect(page).toHaveURL(/\/finance\/purchase-orders\/new$/, { timeout: 3000 })
  }).toPass({ timeout: 45_000 })
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

test('payment run: the bank file downloads (full IBANs only in the file), then sent → confirmed', async ({ page }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/bills?tab=runs')
  const table = page.getByRole('table', { name: 'Payment runs' })
  await expect(table).toBeVisible({ timeout: 30_000 })
  const row = table.locator('tbody tr').first()
  const download = page.waitForEvent('download')
  await row.getByRole('button', { name: 'Bank file' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/PRUN-\d{4}-\d{4}-ae_enbd_bulk\.csv$/)
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8')
  const lines = text.trim().split('\r\n')
  expect(lines[0]).toContain('Beneficiary IBAN')
  expect(lines[lines.length - 1]).toMatch(/^TOTAL,\d+,\d+\.\d{2}$/)
  expect(text).toMatch(/AE\d{21}/)
  // The list (a GET) never carries a full IBAN.
  const runs = JSON.stringify(await api(page, '/finance/payment-runs'))
  expect(runs).not.toMatch(/AE\d{21}/)
  await row.getByRole('button', { name: 'Mark sent to bank' }).click()
  await expect(row.getByText('Sent to bank')).toBeVisible()
  await row.getByRole('button', { name: 'Confirm' }).click()
  await expect(row.getByText('Confirmed by bank')).toBeVisible()
})

test('supplier advance: pay an advance, apply it to an open bill of the supplier', async ({ page }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'u8')
  const bills = (await api(page, '/finance/bills?status=open')) as Json[]
  const bill = bills.find((b) => b.currency === 'AED' && b.balance_due > 200)!
  const before = bill.balance_due as number
  await page.goto('/finance/bills?tab=advances')
  await settle(page)
  const drawer = page.getByRole('dialog', { name: 'Pay a supplier advance' })
  // The mock's service worker may reload the page once: open the drawer until it stays open.
  await expect(async () => {
    if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Pay an advance' }).click()
    await expect(drawer.getByLabel('Amount')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 45_000 })
  await drawer.getByLabel('Supplier').selectOption(bill.vendor_id)
  await drawer.getByLabel('Amount').fill('150')
  await drawer.getByRole('button', { name: 'Pay advance' }).click()
  await expect(page.getByText(/Advance .*-ADV-\d{4}-\d{4} paid/)).toBeVisible()
  await settle(page)
  await page.goto(`/finance/bills/${bill.id}`)
  const modal = page.getByRole('dialog', { name: 'Apply advance' })
  await expect(async () => {
    if (!(await modal.isVisible())) await page.getByRole('button', { name: 'Apply advance' }).click()
    await expect(modal.getByLabel('Amount to apply')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 45_000 })
  await modal.getByLabel('Amount to apply').fill('150')
  await modal.getByRole('button', { name: 'Apply' }).click()
  await expect.poll(async () => (await api(page, `/finance/bills/${bill.id}`)).balance_due).toBe(Math.round((before - 150) * 100) / 100)
  const after = await api(page, `/finance/bills/${bill.id}`)
  expect(after.advances.some((a: Json) => a.amount === 150)).toBe(true)
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
