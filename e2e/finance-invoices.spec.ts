import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Accounts & finance › Invoices end to end:
 *   - Rashid Iqbal (u8, Apex Accountant) invoices accepted quotation QT-2026-0006 from the quotation screen, issues it,
 *     sees the journal entry, prints it, then a credit note reduces the balance;
 *   - Faisal Al Harbi (u101, Crest admin, KSA) opens a seeded standard tax invoice: bilingual title, ZATCA QR, XML download;
 *   - Karim Nasser (u3, Apex Sales Manager) can view invoices but has no Issue button.
 */

const settle = (page: Page) => page.waitForTimeout(600)

test('accountant invoices a quotation, issues it, sees the journal entry, prints it and credits part of it', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u8')
  await page.goto('/sales/quotations/Q-1006')
  await page.getByRole('button', { name: 'Create invoice' }).first().click()
  await expect(page).toHaveURL(/\/finance\/invoices\?from=quotation&id=Q-1006/)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Invoice a quotation, contract or won deal')).toBeVisible()
  await expect(dialog.getByLabel('Quotation')).toHaveValue('Q-1006')
  await dialog.getByRole('button', { name: 'Create draft' }).click()
  await expect(page).toHaveURL(/\/finance\/invoices\/INV-\d+$/)
  await expect(page.getByRole('heading', { name: /Draft invoice INV-/ })).toBeVisible()
  await expect(page.getByTestId('invoice-document')).toContainText('CRM automation setup')

  // Issue: number assigned, journal entry posted (Dr AR / Cr revenue / Cr VAT).
  await page.getByRole('button', { name: 'Issue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /APX-INV-\d{4}-\d{4}/ })).toBeVisible()
  const journal = page.getByTestId('invoice-journal').first()
  await expect(journal).toContainText(/JV-\d{4}-\d{4}/)
  await expect(journal).toContainText('1200 Accounts receivable')
  await expect(journal).toContainText('2200 VAT payable (output)')
  await expect(page.getByTestId('invoice-title')).toHaveText('Tax Invoice')
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)

  // Print: the A4 copy is in the print portal; window.print is called.
  await page.evaluate(() => {
    ;(window as unknown as { __printed: number }).__printed = 0
    window.print = () => {
      ;(window as unknown as { __printed: number }).__printed++
    }
  })
  await page.getByRole('button', { name: 'Print / PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1)
  await expect(page.locator('.invoice-print-root article.invoice-paper')).toHaveCount(1)

  // A credit note of 1,000.00 (+5% VAT) reduces the balance by 1,050.00.
  const balanceText = async () => (await page.getByTestId('invoice-balance').textContent()) ?? ''
  const toNum = (s: string) => Number(s.replace(/[^\d.]/g, ''))
  const before = toNum(await balanceText())
  await page.getByRole('button', { name: 'Credit note' }).click()
  const cn = page.getByRole('dialog')
  await cn.getByLabel('Reason').fill('Scope reduced')
  await cn.getByText('Credit everything still creditable').click()
  await cn.getByLabel(/Credit amount for/).first().fill('1000')
  await cn.getByRole('button', { name: 'Issue credit note' }).click()
  await expect(page.getByText(/Credit note APX-CN-\d{4}-\d{4} issued/)).toBeVisible()
  await expect.poll(async () => toNum(await balanceText())).toBe(Math.round((before - 1050) * 100) / 100)
  await expect(page.getByText('Partially paid').first()).toBeVisible()
  await settle(page)
})

test('a Crest (KSA) invoice is bilingual, shows the ZATCA QR and downloads the UBL XML', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u101', 'crest')
  await page.goto('/finance/invoices/INV-5001')
  await expect(page.getByTestId('invoice-title')).toHaveText('Tax Invoice')
  await expect(page.getByTestId('invoice-document').getByText('فاتورة ضريبية', { exact: true })).toBeVisible()
  const qr = page.getByTestId('zatca-qr')
  await expect(qr).toBeVisible()
  await expect(qr.locator('svg')).toBeVisible()
  await expect(page.getByText('Cryptographic stamping (XAdES)', { exact: false })).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ZATCA XML' }).click()])
  expect(download.suggestedFilename()).toMatch(/^CRS-INV-\d{4}-\d{4}\.xml$/)
  const xml = readFileSync((await download.path())!, 'utf8')
  expect(xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>')
  expect(xml).toContain('<cbc:ID>PIH</cbc:ID>')
  expect(xml).toContain('<cbc:ID>QR</cbc:ID>')
})

test('a Sales Manager can view invoices but has no Issue button', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAs(page, 'u3')
  await page.goto('/finance/invoices')
  await expect(page.getByRole('heading', { name: 'Invoices', exact: true })).toBeVisible()
  await expect(page.getByText('View only')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New invoice' })).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'Invoices' })).toBeVisible()
  await page.goto('/finance/invoices/INV-1010')
  await expect(page.getByRole('heading', { name: 'Draft invoice INV-1010' })).toBeVisible()
  await expect(page.getByTestId('invoice-document')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Issue', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Credit note' })).toHaveCount(0)
})
