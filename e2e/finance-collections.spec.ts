import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Collections end to end (Apex, mock API in the page):
 *   - Rashid Iqbal (u8, Accountant) records a partial payment, then the rest → the invoice is paid; the receipt prints;
 *   - a post-dated cheque is received, deposited and bounces → the invoice is open again;
 *   - a payment link is paid on the public page (no sign-in) → the invoice is paid;
 *   - Karim Nasser (u3, Sales Manager) sees the aging but can't record payments.
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET through the mock API with the signed-in session (wire names are snake_case). */
async function api(page: Page, path: string): Promise<Json> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}') as { token?: string }
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return r.json()
  }, path)
}

const dubaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())

/** An open AED invoice with nothing held by cheques, and its customer (skipping `skip` matches). */
async function openInvoice(page: Page, skip = 0): Promise<{ customerId: string; customerName: string; id: string; number: string; available: number }> {
  const customers = (await api(page, '/finance/customers')) as Json[]
  let seen = 0
  for (const c of customers.filter((x) => x.open_ar > 0)) {
    const items = await api(page, `/finance/customers/${c.customer_id}/open-items`)
    for (const i of items.invoices as Json[]) {
      if (i.currency === 'AED' && i.pdc_held === 0 && i.available >= 100 && i.available === i.balance_due) {
        if (seen++ < skip) continue
        return { customerId: c.customer_id, customerName: c.customer_name, id: i.id, number: i.number, available: i.available }
      }
    }
  }
  throw new Error('no open AED invoice')
}
const invoiceBalance = async (page: Page, customerId: string, invoiceId: string) =>
  ((await api(page, `/finance/customers/${customerId}/open-items`)).invoices as Json[]).find((i) => i.id === invoiceId) ?? null

test('accountant records a partial payment then the rest; the invoice is paid and the receipt prints', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/payments')
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
  const inv = await openInvoice(page)
  const half = Math.floor(inv.available / 2)
  const rest = Math.round((inv.available - half) * 100) / 100

  // Part one: the drawer opens prefilled for the invoice; pay half.
  await page.goto(`/finance/payments?record=1&customer=${inv.customerId}&invoice=${inv.id}`)
  const drawer = page.getByRole('dialog', { name: 'Record payment' })
  await expect(drawer.getByLabel(`Allocate to ${inv.number}`)).toHaveValue(String(inv.available))
  await drawer.getByLabel('Amount received').fill(String(half))
  await drawer.getByLabel(`Allocate to ${inv.number}`).fill(String(half))
  await drawer.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(/Payment APX-RCT-\d{4}-\d{4} recorded/)).toBeVisible()
  await expect.poll(async () => (await invoiceBalance(page, inv.customerId, inv.id))?.balance_due).toBe(rest)

  // Part two: the rest, prefilled with the remaining balance.
  await page.goto(`/finance/payments?record=1&customer=${inv.customerId}&invoice=${inv.id}`)
  const drawer2 = page.getByRole('dialog', { name: 'Record payment' })
  await expect(drawer2.getByLabel(`Allocate to ${inv.number}`)).toHaveValue(String(rest))
  await drawer2.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(/Payment APX-RCT-\d{4}-\d{4} recorded/).first()).toBeVisible()
  await expect.poll(async () => invoiceBalance(page, inv.customerId, inv.id)).toBeNull()

  // The detail drawer of the new payment → the printable receipt.
  const detail = page.getByRole('dialog', { name: /Payment APX-RCT-/ })
  await expect(detail.getByText(inv.number)).toBeVisible()
  await detail.getByRole('link', { name: 'Receipt' }).click()
  await expect(page).toHaveURL(/\/finance\/payments\/PAY-\d+\/receipt$/)
  const receipt = page.getByRole('article', { name: /Receipt APX-RCT-/ })
  await expect(receipt.getByRole('heading', { name: 'Receipt' })).toBeVisible()
  await expect(receipt).toContainText(inv.customerName)
  await expect(receipt).toContainText(inv.number)
  await page.evaluate(() => {
    ;(window as unknown as { __printed: number }).__printed = 0
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed++
    }
  })
  await page.getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)
})

test('a post-dated cheque is received, deposited and bounces: the invoice is open again', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/payments?tab=pdc')
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
  const inv = await openInvoice(page, 1)
  const today = dubaiToday()

  await page.getByRole('button', { name: 'Receive cheque' }).click()
  const drawer = page.getByRole('dialog', { name: 'Receive post-dated cheque' })
  await drawer.getByLabel(/^Customer/).selectOption(inv.customerId)
  await drawer.getByLabel('Cheque number').fill('E2E-778899')
  await drawer.getByLabel('Drawn on (bank)').fill('Emirates NBD')
  await drawer.getByLabel('Received on').fill(today)
  await drawer.getByLabel('Cheque date').fill(today)
  await drawer.getByLabel(/^Amount\*?$/).fill(String(inv.available))
  await drawer.getByLabel(`Secure ${inv.number}`).fill(String(inv.available))
  await drawer.getByRole('button', { name: 'Register cheque' }).click()
  await expect(page.getByText('Cheque E2E-778899 registered')).toBeVisible()

  // Secured, not paid: still open, held by the cheque.
  await expect.poll(async () => (await invoiceBalance(page, inv.customerId, inv.id))?.pdc_held).toBe(inv.available)
  const row = page.getByRole('row').filter({ hasText: 'E2E-778899' })
  await expect(row.getByText('Received (held)')).toBeVisible()
  await row.getByRole('button', { name: 'Deposit' }).click()
  await page.getByRole('dialog', { name: /Deposit cheque E2E-778899/ }).getByRole('button', { name: 'Deposit' }).click()
  await expect(row.getByText('Deposited')).toBeVisible()
  await row.getByRole('button', { name: 'Bounced' }).click()
  const modal = page.getByRole('dialog', { name: /Cheque E2E-778899 bounced/ })
  await modal.getByLabel('Reason', { exact: true }).fill('Insufficient funds')
  await modal.getByLabel(/returned-cheque fee/).fill('50')
  await modal.getByRole('button', { name: 'Mark bounced' }).click()
  await expect(row.getByText('Bounced', { exact: true })).toBeVisible()

  const after = await invoiceBalance(page, inv.customerId, inv.id)
  expect(after?.balance_due).toBe(inv.available)
  expect(after?.pdc_held).toBe(0)
  expect(after?.available).toBe(inv.available)
})

test('a payment link is paid on the public page: the invoice is paid', async ({ page, browser }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/finance/payments?tab=links')
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()
  const inv = await openInvoice(page, 2)

  await page.getByRole('button', { name: 'Create payment link' }).click()
  const modal = page.getByRole('dialog', { name: 'Create payment link' })
  await modal.getByLabel('Customer', { exact: true }).selectOption(inv.customerId)
  await modal.getByLabel('Invoice', { exact: true }).selectOption(inv.id)
  await modal.getByRole('button', { name: 'Create and copy link' }).click()
  await expect(page.getByRole('row').filter({ hasText: inv.number }).getByText('Active')).toBeVisible()
  const link = ((await api(page, `/finance/payment-links?invoice_id=${inv.id}`)) as Json[]).find((l) => l.status === 'active')!
  expect(link.url).toMatch(/^\/pay\/[A-Za-z]{32}$/)

  // The public page lives in the same browser profile as the mock (its data), but needs no sign-in.
  await page.goto(link.url)
  await expect(page.getByText('Test mode: no real payment is taken.')).toBeVisible()
  await expect(page.getByText(`Invoice ${inv.number}`)).toBeVisible()
  await page.getByLabel('Name on card').fill('E2E Payer')
  await page.getByLabel('Card number').fill('4000 0000 0000 0002')
  await page.getByLabel('Expiry (MM/YY)').fill('12/30')
  await page.getByLabel('CVC').fill('123')
  await page.getByRole('button', { name: /^Pay AED/ }).click()
  await expect(page.getByRole('alert')).toContainText('declined')
  await page.getByLabel('Card number').fill('4242 4242 4242 4242')
  await page.getByRole('button', { name: /^Pay AED/ }).click()
  await expect(page.getByRole('heading', { name: 'Payment received. Thank you!' })).toBeVisible()
  await expect.poll(async () => invoiceBalance(page, inv.customerId, inv.id)).toBeNull()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Already paid' })).toBeVisible()
  void browser
})

test('a Sales Manager sees the aging but can’t record payments', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u3')
  await page.goto('/finance/receivables')
  await expect(page.getByRole('heading', { name: 'Receivables' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Receivables aging' })).toBeVisible()
  await page.goto('/finance/payments')
  await expect(page.getByRole('table', { name: 'Payments received' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0)
  await page.goto('/finance/payments?record=1')
  await expect(page.getByRole('dialog', { name: 'Record payment' })).toHaveCount(0)
  await page.goto('/finance/payments?tab=pdc')
  await expect(page.getByRole('button', { name: 'Receive cheque' })).toHaveCount(0)
})
