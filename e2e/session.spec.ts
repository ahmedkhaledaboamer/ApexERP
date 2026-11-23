import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Session & error handling of the app shell (docs/FRONTEND.md › Error handling):
 * expiry → /login with the return path, transparent token refresh, a failing page query → the
 * friendly error card while the shell keeps working, and the offline banner.
 * Dev hooks (mock + dev server only): window.__apexAuth (app/devAuthHooks.ts) and
 * window.__apexMock (shared/mocks/devFailures.ts).
 */

type DevWindow = Window & {
  __apexAuth?: { expireAccessToken(): void; expireSession(): void }
  __apexMock?: { fail(path: string, status?: number | 'network', options?: { requestId?: string }): void; clear(): void }
}

async function waitForHooks(page: Page) {
  await page.waitForFunction(() => !!(window as DevWindow).__apexAuth && !!(window as DevWindow).__apexMock, null, { timeout: 30_000 })
}

test('an expired session goes to /login with the return path and comes back after sign-in', async ({ page }) => {
  await signInAs(page, 'u3')
  await page.goto('/crm/customers?view=all')
  await expect(page.getByRole('heading', { name: 'Customers' }).first()).toBeVisible({ timeout: 30_000 })
  await waitForHooks(page)

  // Access and refresh token both stop working; the next request finds out.
  await page.evaluate(() => (window as DevWindow).__apexAuth!.expireSession())
  await page.reload()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('#session-expired-notice')).toHaveText('Your session expired. Sign in again.')
  // One redirect, no loop: still on /login a moment later.
  await page.waitForTimeout(1000)
  await expect(page).toHaveURL(/\/login$/)

  await page.locator('#email').fill('karim@apexaora.ae')
  await page.locator('#password').fill('apex2025')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/crm\/customers\?view=all$/)
  await expect(page.getByRole('heading', { name: 'Customers' }).first()).toBeVisible()
})

test('an expired access token is refreshed without the user noticing', async ({ page }) => {
  await signInAs(page, 'u3')
  await page.goto('/crm/customers')
  await expect(page.getByRole('heading', { name: 'Customers' }).first()).toBeVisible({ timeout: 30_000 })
  await waitForHooks(page)
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('apexcrm.session')!).refreshToken as string)

  const refreshes: number[] = []
  page.on('response', (r) => {
    if (r.url().endsWith('/api/auth/refresh')) refreshes.push(r.status())
  })
  await page.evaluate(() => (window as DevWindow).__apexAuth!.expireAccessToken())
  await page.getByRole('link', { name: 'Contacts' }).first().click()
  // The first request with the dead token 401s, one refresh runs, the request is retried.
  await expect.poll(() => refreshes).toEqual([200])
  await expect(page).toHaveURL(/\/crm\/contacts$/)
  await expect(page.locator('#page-error')).toHaveCount(0)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('apexcrm.session')!) as { token: string; refreshToken: string })
  expect(after.token).not.toBe('mock.expired')
  expect(after.refreshToken).not.toBe(before)
})

test('a 500 on a page query shows the friendly error with the request id; the shell stays usable', async ({ page }) => {
  await signInAs(page, 'u3')
  await page.goto('/dashboard')
  await waitForHooks(page)
  await page.evaluate(() => (window as DevWindow).__apexMock!.fail('/customers', 500, { requestId: 'req-e2e-500' }))

  await page.getByRole('link', { name: 'Customers' }).first().click()
  await expect(page).toHaveURL(/\/crm\/customers$/)
  // Retries twice with backoff (~3 s), then the error card.
  const card = page.locator('#page-error')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card).toContainText('Something went wrong on our side. Try again.')
  await expect(card).toContainText('req-e2e-500')
  await expect(card.getByRole('button', { name: 'Reload' })).toBeVisible()

  // The sidebar and header still work: another page opens normally.
  await page.getByRole('link', { name: 'Contacts' }).first().click()
  await expect(page).toHaveURL(/\/crm\/contacts$/)
  await expect(page.locator('#page-error')).toHaveCount(0)
  await expect(page.locator('header')).toBeVisible()

  // Fixed on the server → "Try again" recovers the page without a reload.
  await page.getByRole('link', { name: 'Customers' }).first().click()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => (window as DevWindow).__apexMock!.clear())
  await card.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('#page-error')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Customers' }).first()).toBeVisible()
})

test('the offline banner appears when the network is cut and goes when it is back', async ({ page, context }) => {
  await signInAs(page, 'u3')
  await page.goto('/dashboard')
  await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('#offline-banner')).toHaveCount(0)

  await context.setOffline(true)
  await expect(page.locator('#offline-banner')).toBeVisible()
  await expect(page.locator('#offline-banner')).toContainText('You’re offline — changes will be retried when you’re back')

  await context.setOffline(false)
  await expect(page.locator('#offline-banner')).toHaveCount(0)
})
