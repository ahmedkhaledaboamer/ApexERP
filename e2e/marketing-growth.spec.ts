import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Marketing › growth end to end (Apex, Enterprise plan, admin u1):
 *  - build a lead capture form, open its hosted page /f/:key, submit → the lead exists with the form's
 *    source and campaign, and the submission shows "Lead created";
 *  - create an audience and use it in a bulk email (the target list preview changes);
 *  - add a site page and see its SEO checks;
 *  - import keyword positions from a pasted CSV.
 */

async function apiGet(page: Page, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}`, 'X-Workspace': 'apexaora' } })
    return { status: r.status, body: await r.json() }
  }, path)
}

const isoDay = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('form builder → hosted page → submit → lead with the form’s source and campaign', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/marketing/lead-generation')
  await expect(page.getByRole('heading', { name: 'Lead generation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Lead Generation' })).toBeVisible()

  await page.getByRole('button', { name: 'New form' }).first().click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Name').fill('E2E demo form')
  await modal.getByRole('button', { name: 'Create form' }).click()
  await expect(page.getByRole('heading', { name: 'E2E demo form' })).toBeVisible()

  // Routing: LinkedIn source, the Q4 campaign; add a custom question.
  await page.getByLabel('Lead source').selectOption('LinkedIn')
  await page.getByLabel('Campaign', { exact: true }).selectOption({ label: 'Q4 LinkedIn outreach' })
  await page.getByRole('button', { name: 'Add field' }).click()
  await page.getByRole('menuitem', { name: 'Custom question' }).click()
  await page.getByLabel('Label of Custom question').fill('Team size')
  await page.getByRole('button', { name: 'Save form' }).click()
  await expect(page.getByText('Form saved')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save form' })).toBeDisabled()

  const hosted = (await page.getByTestId('form-hosted-url').innerText()).trim()
  expect(hosted).toMatch(/\/f\/[a-z]{20}$/)

  // The visitor's side.
  await page.goto(hosted)
  await expect(page.getByRole('heading', { name: 'E2E demo form' })).toBeVisible()
  await page.getByLabel('Your name').fill('Visitor Person')
  await page.getByLabel('Work email').fill('visitor.person@e2e-growth.example.org')
  await page.getByLabel('Company').fill('E2E Growth Visitor LLC')
  await page.getByLabel('Team size').fill('12')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByText('Thanks! We’ll be in touch soon.')).toBeVisible()

  // The mock DB is saved to IndexedDB 300 ms after a write (debounced); let it land before leaving the page.
  await page.waitForTimeout(1000)
  // Back in the app: the submission created a lead with the form's source and campaign.
  await page.goBack()
  const submissions = page.getByRole('region', { name: 'Submissions' })
  await expect(submissions.getByRole('row').filter({ hasText: 'Visitor Person' })).toContainText('Lead created')
  const leadId = (await submissions.getByRole('row').filter({ hasText: 'Visitor Person' }).getByRole('link').innerText()).trim()
  const lead = await apiGet(page, `/leads/${leadId}`)
  expect(lead.status).toBe(200)
  expect(lead.body).toMatchObject({ source_id: 'LinkedIn', campaign_id: 'CMP-1001', company_name: 'E2E Growth Visitor LLC' })
  await page.getByRole('link', { name: leadId }).click()
  await expect(page.getByText('E2E Growth Visitor LLC').first()).toBeVisible()
})

test('audience → used in a bulk email: the target list preview follows it', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/marketing/audiences')
  await expect(page.getByRole('heading', { name: 'Audiences' })).toBeVisible()
  await page.getByRole('button', { name: 'New audience' }).first().click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('Name').fill('E2E won customers')
  await drawer.getByRole('button', { name: 'Status type' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Won' }).click()
  await drawer.getByLabel('Name').click()
  await expect(drawer.getByTestId('audience-live-count')).toBeVisible()
  await drawer.getByRole('button', { name: 'Save audience' }).click()
  await expect(drawer.getByRole('button', { name: 'Freeze members' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('row').filter({ hasText: 'E2E won customers' })).toBeVisible()

  // A bulk email using it.
  await page.goto('/marketing/email')
  await page.getByRole('button', { name: 'New bulk email' }).first().click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Name').fill('E2E to won customers')
  await modal.getByRole('button', { name: 'Open email builder' }).click()
  await expect(page.getByRole('heading', { name: 'E2E to won customers' })).toBeVisible()
  const eligible = page.getByTestId('audience-eligible')
  await expect(eligible).toBeVisible()
  const everyone = (await eligible.innerText()).trim()
  const audienceValue = await page.locator('#be-saved-audience option', { hasText: 'E2E won customers' }).getAttribute('value')
  await page.getByLabel('Use a saved audience').selectOption(audienceValue!)
  await expect(page.getByText('The audience is resolved again when the email is sent')).toBeVisible()
  await expect(eligible).not.toHaveText(everyone)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Draft saved')).toBeVisible()
  // Back to the list and in again (in-app navigation: the saved draft comes from the API).
  await page.getByRole('link', { name: 'Bulk email' }).first().click()
  await page.getByRole('row').filter({ hasText: 'E2E to won customers' }).click()
  await expect(page.getByRole('heading', { name: 'E2E to won customers' })).toBeVisible()
  await expect(page.getByLabel('Use a saved audience')).toHaveValue(/AUD-/)
})

test('a site page gets SEO checks on save; keyword positions import from a CSV', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/marketing/seo')
  await expect(page.getByRole('heading', { name: 'Website & SEO' })).toBeVisible()
  await expect(page.getByText('Nothing here crawls your website')).toBeVisible()

  await page.getByRole('button', { name: 'Add page' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByLabel('URL').fill('https://apexaora.ae/services/e2e-chatbot')
  await drawer.getByLabel('Title tag').fill('Short title')
  await drawer.getByLabel('H1 heading').fill('E2E chatbot page')
  await drawer.getByLabel('Target keyword').fill('e2e chatbot')
  // Live checks while typing.
  await expect(drawer.locator('[data-check="title_length"]')).toHaveAttribute('data-status', 'warn')
  await expect(drawer.locator('[data-check="meta_length"]')).toHaveAttribute('data-status', 'fail')
  await expect(drawer.locator('[data-check="keyword_in_url"]')).toHaveAttribute('data-status', 'pass')
  await drawer.getByRole('button', { name: 'Save page' }).click()
  const row = page.getByRole('row').filter({ hasText: '/services/e2e-chatbot' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('failing')
  await row.click()
  await expect(page.getByRole('dialog').locator('[data-check="meta_length"]')).toHaveAttribute('data-status', 'fail')
  await page.keyboard.press('Escape')

  // Keyword tracker: paste a Search Console-like CSV.
  await page.getByRole('tab', { name: 'Keyword tracker' }).click()
  await page.getByRole('button', { name: 'Import CSV' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('…or paste it').fill(`keyword,date,position\ne2e growth keyword,${isoDay(-8)},20\ne2e growth keyword,${isoDay(-1)},12\nai chatbot dubai,${isoDay(-1)},7`)
  await modal.getByRole('button', { name: /^Import 3 rows/ }).click()
  await expect(modal.getByTestId('keyword-import-result')).toContainText('3 positions imported, 1 new keywords')
  await modal.getByRole('button', { name: 'Done' }).click()
  const kw = page.getByRole('row').filter({ hasText: 'e2e growth keyword' })
  await expect(kw).toBeVisible()
  await expect(kw.getByLabel('Up 8')).toBeVisible()
})
