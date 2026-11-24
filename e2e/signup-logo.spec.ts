import { expect, test } from '@playwright/test'

/** Sign-up step 1: the optional company logo is uploaded, previewed, and can be removed again. */

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60"><rect width="200" height="60" fill="#0f766e"/></svg>'

test('the create-workspace form takes an optional logo with a preview', async ({ page }) => {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible({ timeout: 45_000 }) // cold dev server
  const field = page.locator('#branding-logoLight')
  await expect(field).toHaveAttribute('data-has-image', 'false')
  await expect(field.getByText('Company logo (optional)')).toBeVisible()

  await page.setInputFiles('#branding-logoLight-input', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SVG) })
  await page.getByRole('dialog').getByRole('button', { name: 'Use SVG' }).click()
  await expect(field).toHaveAttribute('data-has-image', 'true')
  await expect(page.locator('#branding-logoLight-preview img')).toBeVisible()

  await page.locator('#branding-logoLight-remove').click()
  await page.locator('#branding-remove-confirm').click()
  await expect(field).toHaveAttribute('data-has-image', 'false')

  // A file that isn't an image is refused on the spot.
  await page.setInputFiles('#branding-logoLight-input', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.locator('#branding-logoLight-error')).toBeVisible()
})
