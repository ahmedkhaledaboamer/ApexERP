import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Ads integrations and marketing analytics end to end (Apex, Enterprise plan): connect a TikTok ad
 * account through the mock OAuth dialog (masked token), sync now, map an ad campaign to a CRM campaign
 * → the campaign's spend grows by the synced ad spend, Marketing analytics shows the spend and the cost
 * per lead, and the old /marketing/reports URL lands on analytics. Sync errors are switched off with
 * the mock's dev hook (window.__apexAdsSync = 'ok').
 */

const CAMPAIGN_ID = 'CMP-1003'
const CAMPAIGN = 'Year-end nurture emails'
const AD_CAMPAIGN = 'Spark ads – product demo'

async function apiGet(page: Page, path: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}`, 'X-Workspace': 'apexaora' } })
    return r.json()
  }, path)
}

test('connect an ad account → sync now → map to a campaign → campaign spend and analytics', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __apexAdsSync: string }).__apexAdsSync = 'ok'
  })
  await signInAs(page, 'u1')
  await page.goto('/marketing/ads')
  await expect(page.getByRole('heading', { name: 'Ads Integrations' })).toBeVisible()
  // Seeded connections.
  await expect(page.locator('[data-provider="meta"]')).toContainText('Connected')
  await expect(page.locator('[data-provider="google"]')).toContainText('Connected')

  const before = (await apiGet(page, `/marketing/campaigns/${CAMPAIGN_ID}`)).spend as number

  // Connect (mock OAuth): pick an account, consent.
  await page.locator('[data-provider="tiktok"]').getByRole('button', { name: 'Connect', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Connect TikTok Ads' })).toBeVisible()
  await dialog.getByRole('radio').first().check()
  await dialog.getByRole('checkbox', { name: 'Allow access' }).check()
  await dialog.getByRole('button', { name: 'Connect account' }).click()

  // The account's drawer: masked token, imported history.
  await expect(page.getByTestId('token-hint')).toHaveText(/^•••• [0-9a-f]{4}$/)
  await expect(page.getByRole('table', { name: 'Ad campaigns' })).toContainText(AD_CAMPAIGN)

  // Sync now: nothing new for today (complete days only), logged in the sync log.
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText('Sync finished')).toBeVisible()
  await page.getByRole('tab', { name: /Sync log/ }).click()
  await expect(page.getByRole('list', { name: 'Sync log' })).toContainText('manual sync')
  await expect(page.getByRole('list', { name: 'Sync log' })).toContainText('initial sync')

  // Map the ad campaign to a CRM campaign → its synced spend becomes campaign costs.
  await page.getByRole('tab', { name: /Campaigns/ }).click()
  await page.getByLabel(`CRM campaign for ${AD_CAMPAIGN}`).selectOption({ label: CAMPAIGN })
  await expect(page.getByText(`Mapped to ${CAMPAIGN}`)).toBeVisible()
  const after = (await apiGet(page, `/marketing/campaigns/${CAMPAIGN_ID}`)).spend as number
  expect(after).toBeGreaterThan(before)

  await page.goto(`/marketing/campaigns/${CAMPAIGN_ID}`)
  await expect(page.getByRole('list', { name: 'Cost entries' })).toContainText(`TikTok Ads: ${AD_CAMPAIGN}`)

  // Analytics: last 30 days shows the spend (incl. the ads) and the cost per lead; ads per platform.
  await page.goto('/marketing/analytics')
  await expect(page.getByRole('heading', { name: 'Marketing Analytics' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Period' }).selectOption('last_30_days')
  const analytics = await apiGet(page, '/marketing/analytics?preset=last_30_days&compare=true')
  const kpis = analytics.kpis as { spend: number; cost_per_lead: number | null }
  const fmt = (n: number) => `AED ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`
  await expect(page.getByTestId('kpi-spend')).toHaveText(fmt(kpis.spend))
  await expect(page.getByTestId('kpi-cpl')).toHaveText(kpis.cost_per_lead === null ? '—' : fmt(kpis.cost_per_lead))
  await expect(page.getByRole('table', { name: 'Ads by platform' })).toContainText('TikTok Ads')
  await expect(page.getByRole('row').filter({ hasText: CAMPAIGN })).toBeVisible()

  // The old Marketing reports URL lands on analytics.
  await page.goto('/marketing/reports')
  await expect(page).toHaveURL(/\/marketing\/analytics$/)
  await expect(page.getByRole('heading', { name: 'Marketing Analytics' })).toBeVisible()
})

test('a Sales Manager (Marketing view) reads ad connections but can’t connect; no analytics', async ({ page }) => {
  await signInAs(page, 'u3')
  await page.goto('/marketing/ads')
  await expect(page.getByRole('heading', { name: 'Ads Integrations' })).toBeVisible()
  await expect(page.locator('[data-provider="meta"]').getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await page.goto('/marketing/analytics')
  await expect(page.getByText('Marketing analytics isn’t part of your role')).toBeVisible()
})
