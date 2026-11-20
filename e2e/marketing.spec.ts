import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Marketing end to end (Apex, Enterprise plan): a campaign with a cost, a lead attributed to it, a
 * bulk email built from a Settings template whose target list shows the exclusions, sent now through
 * the fair queue, results with sent / opened, and the campaign's cost per lead in Marketing reports.
 * Opens are forced by the mock's dev hook (window.__apexMarketingEngagement = 'all').
 * Roles: a Sales Agent (Marketing hidden) is sent away; a Sales Manager (Marketing view) reads only.
 */

const CAMPAIGN = 'E2E Expo campaign'

async function apiPost(page: Page, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ([p, b]) => {
      const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
      const r = await fetch(`/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, 'X-Workspace': 'apexaora' }, body: JSON.stringify(b) })
      return { status: r.status, body: await r.json() }
    },
    [path, body] as const,
  )
}

test('campaign → cost → bulk email from a template → exclusions → send now → results → cost per lead', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/marketing/campaigns')
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()

  // Create the campaign.
  await page.getByRole('button', { name: 'New campaign' }).first().click()
  await page.getByLabel('Name').fill(CAMPAIGN)
  await page.getByLabel('Channel').selectOption('event')
  await page.getByLabel(/^Budget/).fill('5000')
  await page.getByRole('button', { name: 'Create campaign' }).click()
  await expect(page.getByRole('heading', { name: CAMPAIGN })).toBeVisible()
  const campaignId = page.url().split('/').pop()!

  // Add a cost.
  await page.getByRole('button', { name: 'Add cost' }).first().click()
  const costDialog = page.getByRole('dialog')
  await costDialog.getByLabel(/^Amount/).fill('1200')
  await costDialog.getByLabel('Note').fill('Stand rental')
  await costDialog.getByRole('button', { name: 'Add cost' }).click()
  await expect(page.getByRole('list', { name: 'Cost entries' })).toContainText('Stand rental')

  // A lead that came from the campaign (lead create accepts campaign_id).
  const lead = await apiPost(page, '/leads', {
    company_name: 'E2E Expo Visitor LLC',
    source_id: 'Event',
    industry_id: 'Healthcare',
    contacts: [{ name: 'Expo Visitor', title: '', mobile: '+971 50 555 0142', email: 'visitor@e2e-expo.example.org', is_decision_maker: false }],
    next_follow_up_date: null,
    campaign_id: campaignId,
  })
  expect(lead.status).toBe(200)
  expect(lead.body.campaign_id).toBe(campaignId)

  // Bulk email from a template, linked to the campaign.
  await page.reload()
  await page.getByRole('button', { name: 'New bulk email' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Name').fill('E2E expo follow-up')
  await modal.getByLabel('Start from template').selectOption({ label: 'Meeting recap and next steps' })
  await modal.getByRole('button', { name: 'Open email builder' }).click()
  await expect(page.getByRole('heading', { name: 'E2E expo follow-up' })).toBeVisible()
  await expect(page.getByLabel('Subject')).not.toHaveValue('')
  await expect(page.locator('#email-brand-header')).toBeVisible()

  // The target list preview shows the exclusions (the seed has Do Not Contact and Not interested leads).
  await expect(page.getByTestId('audience-eligible')).toBeVisible()
  await expect(page.getByTestId('excluded-dnc')).toContainText(/[1-9]/)
  await expect(page.getByTestId('excluded-not-interested')).toContainText(/[1-9]/)

  // Send now (opens forced by the dev hook).
  await page.evaluate(() => {
    ;(window as unknown as { __apexMarketingEngagement: string }).__apexMarketingEngagement = 'all'
  })
  await page.getByRole('button', { name: 'Send now' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^Send to/ }).click()

  const results = page.getByRole('region', { name: 'Email results' })
  await expect(results).toBeVisible()
  // The queue sends in 5-second slots; the page polls while the send is in progress.
  await expect(results).toContainText('Open rate 100%', { timeout: 30_000 })

  // Marketing reports (now Marketing analytics): the campaign's cost per lead (1,200 spend ÷ 1 lead).
  await page.goto('/marketing/reports')
  await expect(page).toHaveURL(/\/marketing\/analytics$/)
  const row = page.getByRole('row').filter({ hasText: CAMPAIGN })
  await expect(row).toBeVisible()
  await expect(row).toContainText('1,200')
})

test('roles: a Sales Agent has no Marketing; a Sales Manager reads campaigns but can’t change them', async ({ page }) => {
  await signInAs(page, 'u4')
  await page.goto('/marketing/campaigns')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Campaigns' })).toHaveCount(0)

  await signInAs(page, 'u3')
  await page.goto('/marketing/campaigns')
  await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible()
  await expect(page.getByText('Q4 LinkedIn outreach')).toBeVisible()
  await expect(page.getByRole('button', { name: 'New campaign' })).toHaveCount(0)
  // The old Marketing reports URL lands on Marketing analytics, with the same access rule.
  await page.goto('/marketing/reports')
  await expect(page).toHaveURL(/\/marketing\/analytics$/)
  await expect(page.getByText('Marketing analytics isn’t part of your role')).toBeVisible()
})
