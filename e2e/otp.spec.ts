import { expect, test, type Page } from '@playwright/test'

/**
 * Two-step verification code boxes: each typed digit moves straight to the next box (it used to bounce
 * back to the first one), Backspace goes back, paste fills all, and the sixth digit signs in.
 * u1 (omar@apexaora.ae) has 2FA on; the mock's demo code is 123456.
 */

async function openTwoStep(page: Page) {
  await page.goto('/login?workspace=apexaora')
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 45_000 })
  await page.getByLabel('Work email').fill('omar@apexaora.ae')
  await page.getByLabel('Password', { exact: true }).fill('apex2025')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible()
  return Array.from({ length: 6 }, (_, i) => page.getByLabel(`Digit ${i + 1} of 6`))
}

test('typing moves to the next box on every digit, and the last digit signs in', async ({ page }) => {
  test.setTimeout(90_000)
  const boxes = await openTwoStep(page)
  await expect(boxes[0]).toBeFocused()
  // Typing one key at a time, like a person: focus follows after each digit.
  await page.keyboard.type('1')
  await expect(boxes[1]).toBeFocused()
  await page.keyboard.type('2')
  await expect(boxes[2]).toBeFocused()
  await page.keyboard.type('3')
  await expect(boxes[3]).toBeFocused()
  // Backspace on an empty box clears the previous one and moves back to it.
  await page.keyboard.press('Backspace')
  await expect(boxes[2]).toBeFocused()
  await expect(boxes[2]).toHaveValue('')
  await page.keyboard.type('3456')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
})

test('a wrong code clears the boxes and puts the cursor back in the first one', async ({ page }) => {
  test.setTimeout(90_000)
  const boxes = await openTwoStep(page)
  await page.keyboard.type('999999')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(boxes[0]).toBeFocused()
  await page.keyboard.type('123456')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
})

test('pasting the whole code fills every box', async ({ page, context }) => {
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const boxes = await openTwoStep(page)
  await page.evaluate(() => navigator.clipboard.writeText('12 34 56'))
  await boxes[0].focus()
  await page.keyboard.press('Control+V')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
})
