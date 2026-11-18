import { expect, test } from '@playwright/test'

/** The platform console sign-in works on a fresh browser and after a workspace session. */
test('platform console sign-in (Owner) from a fresh browser', async ({ page }) => {
  const failed: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.request().method()} ${r.url()} → ${r.status()}`)
  })
  await page.goto('/platform/login')
  await page.locator('#platform-email').fill('owner@apexcrm.app')
  await page.locator('#platform-password').fill('apex2025')
  await page.locator('#platform-login-submit').click()
  await expect(page.locator('#platform-console')).toBeVisible()
  expect(failed).toEqual([])
})

test('platform console sign-in after using a workspace in the same browser', async ({ page }) => {
  await page.goto('/login?workspace=apexaora')
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    const r = await fetch('/api/auth/dev/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'u1' }) })
    localStorage.setItem('apexcrm.session', JSON.stringify(await r.json()))
  })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.goto('/platform/login')
  await page.locator('#platform-email').fill('owner@apexcrm.app')
  await page.locator('#platform-password').fill('apex2025')
  await page.locator('#platform-login-submit').click()
  await expect(page.locator('#platform-console')).toBeVisible()
})

test('after a hard reload (Ctrl+Shift+R) the mock still answers', async ({ page }) => {
  const failed: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() === 404) failed.push(`${r.request().method()} ${r.url()}`)
  })
  await page.goto('/platform/login')
  await page.waitForLoadState('networkidle')
  // A hard reload: the browser bypasses the service worker for this page load.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.reload', { ignoreCache: true })
  await page.waitForTimeout(3000)
  await page.locator('#platform-email').waitFor()
  // MSW reloads an uncontrolled page once, so the worker controls it again.
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await page.locator('#platform-email').fill('owner@apexcrm.app')
  await page.locator('#platform-password').fill('apex2025')
  await page.locator('#platform-login-submit').click()
  await expect(page.locator('#platform-console')).toBeVisible()
  expect(failed).toEqual([])
})
