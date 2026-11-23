import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR gaps part A end to end (Apex):
 *  1. Noura (u11, Employee) requests an ARABIC salary certificate → HR (u9 Mariam) approves → the printed letter is Arabic
 *     RTL with a QR code to the public verification page; the public page shows it valid, then revoked after HR revokes.
 *  2. HR issues a written warning to Noura → Noura acknowledges it in My HR.
 *  3. HR publishes a policy → Sara (u7, the only login in Marketing) acknowledges it in My HR → HR sees Marketing at 100%.
 * The dev mock DB saves to IndexedDB on a 300 ms debounce: wait ~1 s after writes before signing in as someone else.
 */

/** Calls the mock API as the signed-in user (session token from storage). */
async function apiAs(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = (JSON.parse(localStorage.getItem('apexcrm.session') ?? '{}') as { token?: string }).token
      const r = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Workspace': 'apexaora' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, body: await r.json().catch(() => null) }
    },
    { method, path, body },
  )
}

test('Arabic salary certificate: request → approve → RTL print with QR → public verify valid → revoked', async ({ page }) => {
  test.setTimeout(300_000)
  // The company's Arabic legal name (Accounts & finance › Settings) is needed for Arabic letters.
  await signInAs(page, 'u1')
  const set = await apiAs(page, 'PATCH', '/finance/settings', { legal_name_ar: 'شركة أبكس أورا ذ.م.م' })
  expect(set.status).toBe(200)
  await page.waitForTimeout(1000)

  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  await page.getByRole('button', { name: 'Request a letter' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request a letter' })
  await dialog.getByLabel('Letter', { exact: true }).selectOption({ label: 'Salary certificate' })
  await dialog.getByLabel('Addressee', { exact: true }).fill('Emirates NBD')
  await dialog.getByLabel('Purpose', { exact: true }).fill('a credit card application')
  await dialog.getByLabel('Language', { exact: true }).selectOption('ar')
  await dialog.getByLabel('Addressee in Arabic').fill('بنك الإمارات دبي الوطني')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText('Letter requested')).toBeVisible()
  await expect(page.getByRole('table', { name: 'My letter requests' })).toContainText('Arabic')
  await page.waitForTimeout(1000)

  await signInAs(page, 'u9')
  await page.goto('/hr/requests?tab=letters')
  const row = page.getByRole('row').filter({ hasText: 'Noura Al Ketbi' }).filter({ hasText: 'Salary certificate' }).filter({ hasText: 'Arabic' }).first()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Issue letter' }).click()
  await expect(page.getByText('Letter issued')).toBeVisible()
  await page.waitForTimeout(1000)

  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  const open = page.getByRole('link', { name: /Open APX-HRL-\d{4}-\d{4}/ }).first()
  await expect(open).toBeVisible()
  const letterHref = await open.getAttribute('href')
  await open.click()
  const sheet = page.getByRole('article')
  await expect(sheet).toHaveAttribute('data-language', 'ar')
  const ar = page.getByTestId('letter-ar')
  await expect(ar).toHaveAttribute('dir', 'rtl')
  await expect(ar).toHaveAttribute('lang', 'ar')
  await expect(page.getByTestId('letter-body-ar')).toContainText('نورة الكتبي')
  await expect(page.getByTestId('letter-body-ar')).toContainText('بنك الإمارات دبي الوطني')
  await expect(page.getByTestId('letter-body-ar')).toContainText('إجمالي الراتب الشهري')
  await expect(page.getByTestId('letter-body')).toHaveCount(0) // Arabic only
  await expect(page.getByTestId('letter-date-ar')).toContainText(/(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)/)
  const qr = page.getByTestId('letter-qr')
  await expect(qr.locator('svg')).toBeVisible()
  const verifyUrl = (await qr.getAttribute('data-url'))!
  const code = (await page.getByTestId('letter-code').textContent())!.trim()
  expect(verifyUrl).toContain(`/verify/letter?code=${code}`)
  expect(verifyUrl).toContain('workspace=apexaora')
  const ref = (await page.getByTestId('letter-ref').textContent())!.trim()
  await page.evaluate(() => {
    ;(window as unknown as { printed: number }).printed = 0
    window.print = () => {
      ;(window as unknown as { printed: number }).printed++
    }
  })
  await page.getByRole('button', { name: 'Print' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)

  // The public verification page (what the QR code opens): valid, masked name, no salary.
  await page.goto(verifyUrl)
  const status = page.getByTestId('verify-status')
  await expect(status).toHaveAttribute('data-status', 'valid')
  await expect(page.getByTestId('verify-ref')).toHaveText(ref)
  await expect(status).toContainText('Noura K.')
  await expect(status).not.toContainText('Ketbi')
  await expect(status).not.toContainText('AED')

  // HR revokes it (reason, audited) → the public page shows "revoked".
  await signInAs(page, 'u9')
  await page.goto(letterHref!)
  await page.getByRole('button', { name: 'Revoke' }).click()
  const rv = page.getByRole('dialog').filter({ hasText: 'Revoke' })
  await rv.getByLabel('Reason').fill('Issued with the wrong addressee')
  await rv.getByRole('button', { name: 'Revoke letter' }).click()
  await expect(page.getByText('Letter revoked')).toBeVisible()
  await expect(page.getByTestId('letter-revoked')).toBeVisible()
  await page.waitForTimeout(1000)
  await page.goto(verifyUrl)
  await expect(page.getByTestId('verify-status')).toHaveAttribute('data-status', 'revoked')
})

test('written warning: HR issues it → the employee acknowledges it in My HR', async ({ page }) => {
  test.setTimeout(240_000)
  await signInAs(page, 'u9')
  await page.goto('/hr/discipline')
  await expect(page.getByRole('heading', { name: 'Discipline' })).toBeVisible()
  await page.getByRole('button', { name: 'New record' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'New disciplinary record' })
  await dialog.getByLabel('Employee', { exact: true }).selectOption('EMP-u11')
  await dialog.getByLabel('Action', { exact: true }).selectOption('written_warning')
  await dialog.getByLabel('Reason category').selectOption('attendance')
  await dialog.getByLabel('Description', { exact: true }).fill('Arrived more than 30 minutes late on three days this week without notice.')
  await dialog.getByRole('button', { name: 'Issue' }).click()
  await expect(page.getByText('Written warning issued')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Disciplinary records' })).toContainText('Noura Al Ketbi')
  await page.waitForTimeout(1000)

  await signInAs(page, 'u11')
  await page.goto('/hr/me')
  const card = page.locator('[data-slot="discipline"]')
  await expect(card).toContainText('Written warning')
  await card.getByRole('button', { name: 'Read and acknowledge' }).first().click()
  const ack = page.getByRole('dialog').filter({ hasText: 'Written warning' })
  await expect(ack).toContainText('three days this week')
  await ack.getByLabel('Comment (optional)').fill('Understood, it won’t happen again.')
  await ack.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByText('Acknowledged', { exact: true }).first()).toBeVisible()
  await expect(card).toContainText('Acknowledged')
})

test('policy: HR publishes → employee acknowledges in My HR → HR sees 100% for that department', async ({ page }) => {
  test.setTimeout(240_000)
  const title = `Remote work policy ${Date.now().toString(36)}`
  await signInAs(page, 'u9')
  await page.goto('/hr/policies')
  await page.getByRole('button', { name: 'New policy' }).click()
  const drawer = page.getByRole('dialog').filter({ hasText: 'New policy' })
  await drawer.getByLabel('Title', { exact: true }).fill(title)
  await drawer.getByLabel('Category', { exact: true }).selectOption('other')
  await drawer.getByLabel('Policy text').fill('# Working from home\n- Up to two days a week, agreed with your manager.\n- **Be reachable** during core hours.')
  await drawer.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).first().click()
  await page.getByRole('dialog').filter({ hasText: 'Publish version 1' }).getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Version 1 published')).toBeVisible()
  await page.waitForTimeout(1000)

  await signInAs(page, 'u7')
  await page.goto('/hr/me')
  const card = page.locator('[data-slot="policies"]')
  await expect(card).toContainText(title)
  await card.getByRole('listitem').filter({ hasText: title }).getByRole('link', { name: 'Read and acknowledge' }).click()
  await expect(page.getByRole('heading', { name: 'My policies' })).toBeVisible()
  const view = page.getByRole('region', { name: title })
  await expect(view.getByTestId('policy-body')).toContainText('Be reachable')
  await view.getByRole('checkbox').check()
  await view.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByText('Policy acknowledged')).toBeVisible()
  await expect(view).toContainText('You acknowledged version 1')
  await page.waitForTimeout(1000)

  await signInAs(page, 'u9')
  await page.goto('/hr/policies')
  await page.getByRole('link', { name: title }).click()
  await expect(page.getByTestId('dept-Marketing')).toContainText('100%')
})
