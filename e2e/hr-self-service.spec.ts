import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Self-service end to end (Apex): an employee (u11 Noura, Employee) opens My HR, requests a salary certificate →
 * HR (u9 Mariam, HR Manager) approves it → Noura opens the issued letter (reference, verification code, her name) and
 * prints it. Then Noura asks for a new mobile number → HR approves → her profile shows it.
 */

test('salary certificate: employee requests → HR approves → employee opens and prints the letter', async ({ page }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  await expect(page.getByRole('heading', { name: 'My HR' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'My profile' })).toContainText('noura@apexaora.ae')
  // The other HR sections' slot cards render inside the portal (performance always; onboarding only with tasks).
  await expect(page.locator('[data-slot="reviews"]')).toContainText('My reviews')
  await page.getByRole('button', { name: 'Request a letter' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request a letter' })
  await dialog.getByLabel('Letter').selectOption({ label: 'Salary certificate' })
  await dialog.getByLabel('Addressee').fill('Emirates NBD')
  await dialog.getByLabel('Purpose').fill('a credit card application')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText('Letter requested')).toBeVisible()
  await expect(page.getByRole('table', { name: 'My letter requests' })).toContainText('Waiting for HR')
  await page.waitForTimeout(1000)

  await signInAs(page, 'u9')
  await page.goto('/hr/requests?tab=letters')
  const row = page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' }).filter({ hasText: 'Salary certificate' }).first()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Issue letter' }).click()
  await expect(page.getByText('Letter issued')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' }).filter({ hasText: 'Salary certificate' }).first()).toContainText('Issued')
  await page.waitForTimeout(1000) // the mock DB's debounced save, before the next sign-in reloads it

  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  const open = page.getByRole('link', { name: /Open APX-HRL-\d{4}-\d{4}/ })
  await expect(open).toBeVisible()
  await open.click()
  await expect(page.getByTestId('letter-ref')).toHaveText(/APX-HRL-\d{4}-\d{4}/)
  await expect(page.getByTestId('letter-body')).toContainText('Noura Al Ketbi')
  await expect(page.getByTestId('letter-body')).toContainText('Emirates NBD')
  await expect(page.getByTestId('letter-body')).toContainText('Total monthly salary')
  await expect(page.getByTestId('letter-code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed++
    }
  })
  await page.getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
})

test('profile change: employee asks for a new mobile → HR approves → profile updated', async ({ page }) => {
  test.setTimeout(240_000)
  const mobile = '+971 50 246 8135'
  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  await page.getByRole('button', { name: 'Request a change' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request a profile change' })
  await dialog.getByLabel('Mobile', { exact: true }).fill(mobile)
  await dialog.getByRole('button', { name: 'Send to HR' }).click()
  await expect(page.getByText('Sent to HR')).toBeVisible()
  await expect(page.getByTestId('pending-change')).toContainText(mobile)
  await page.waitForTimeout(1000)

  await signInAs(page, 'u9')
  await page.goto('/hr/requests?tab=profile')
  const row = page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' }).filter({ hasText: mobile })
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Approve change' }).click()
  await expect(page.getByText('Change approved')).toBeVisible()
  // The decided row (the list refetched) — and the mock DB's debounced save has run before the next sign-in reloads it.
  await expect(page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' }).filter({ hasText: 'Approved' }).first()).toBeVisible()
  await page.waitForTimeout(1000)

  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  await expect(page.getByRole('region', { name: 'My profile' })).toContainText(mobile)
  await expect(page.getByTestId('pending-change')).toHaveCount(0)
})
