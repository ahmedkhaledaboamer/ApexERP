import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Engagement and 360° feedback end to end (Apex, Enterprise plan with HR):
 *  1. HR (Mariam, u9) launches an eNPS pulse → two employees (Noura u11, Yusuf u14) answer it from My HR → HR sees the
 *     response rate (results hidden under 5 responses) and the eNPS trend with the two seeded waves.
 *  2. The manager (Daniel, u10) requests 360° feedback in Noura's review → three peers answer from My HR → Daniel sees
 *     the aggregated panel (no names) in the review drawer.
 * The dev mock DB saves to IndexedDB on a 300 ms debounce: wait a moment after writes before signing in again.
 */

test.setTimeout(300_000)

const settle = (page: Page) => page.waitForTimeout(1000)

async function answerPulse(page: Page, userId: string, survey: string, score: string) {
  await signInAs(page, userId)
  await page.goto('/hr/me')
  const card = page.getByTestId('my-surveys-card')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole('link', { name: survey }).click()
  const dialog = page.getByRole('dialog', { name: survey })
  await dialog.getByRole('radiogroup', { name: 'How likely are you to recommend working here to a friend?' }).getByRole('radio', { name: score, exact: true }).click()
  await dialog.getByLabel('What is the main reason for your score?').fill('Good team, heavy workload')
  await dialog.getByRole('button', { name: 'Submit answers' }).click()
  await expect(dialog).toBeHidden()
  await settle(page)
}

test('HR launches an eNPS pulse → two employees answer from My HR → HR sees the response rate and the eNPS trend', async ({ page }) => {
  const SURVEY = `eNPS e2e ${Date.now().toString(36)}`
  await signInAs(page, 'u9')
  await page.goto('/hr/engagement?tab=surveys')
  // First visit compiles the lazy page on a cold dev server: allow time.
  await expect(page.getByRole('heading', { name: 'Engagement' })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'New survey' }).click()
  const form = page.getByRole('dialog', { name: 'New survey' })
  await expect(form.getByLabel('Template')).toHaveValue('enps_pulse')
  await form.locator('#sv-name').fill(SURVEY)
  await form.getByRole('button', { name: 'Launch' }).click()
  await expect(form).toBeHidden()
  await expect(page.getByRole('table', { name: 'Surveys' })).toContainText(SURVEY)
  await settle(page)

  await answerPulse(page, 'u11', SURVEY, '9')
  await answerPulse(page, 'u14', SURVEY, '6')

  await signInAs(page, 'u9')
  await page.goto('/hr/engagement?tab=surveys')
  await page.getByRole('button', { name: `Results · ${SURVEY}` }).click()
  const results = page.getByRole('dialog', { name: SURVEY })
  await expect(results.getByTestId('response-rate')).not.toHaveText('—')
  await expect(results.getByText(/2 of \d+/)).toBeVisible()
  // Two answers: under the threshold, nothing but counts.
  await expect(results.getByTestId('not-enough').first()).toBeVisible()
  await expect(results.getByTestId('enps-score')).toHaveText('—')
  // The trend holds the seeded waves (eNPS +21 then +43) and this one (hidden).
  const rows = results.getByTestId('trend-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('+21')
  await expect(rows.nth(1)).toContainText('+43')
  await expect(rows.nth(2)).toContainText('Not enough responses to show')
  // The overview shows the latest eNPS for the company.
  await page.goto('/hr/engagement?tab=overview')
  await expect(page.getByTestId('engagement-overview')).toBeVisible()
})

test('a manager requests 360° feedback → peers answer → the manager sees the aggregated panel in the review drawer', async ({ page }) => {
  const year = new Date().getFullYear()
  const REVIEW = `Annual review ${year} · Noura Al Ketbi`
  const PEERS: [string, string][] = [['u15', 'Leena Joseph'], ['u16', 'Omar Siddiqui'], ['u17', 'Hind Al Mansoori']]

  await signInAs(page, 'u10')
  await page.goto('/hr/performance?tab=team')
  await page.getByRole('button', { name: `Open ${REVIEW}` }).click()
  let drawer = page.getByRole('dialog', { name: REVIEW })
  const panel = drawer.getByTestId('review-feedback-panel')
  await expect(panel).toBeVisible()
  for (const [, name] of PEERS) await panel.getByRole('checkbox', { name, exact: true }).check()
  await panel.getByRole('button', { name: 'Request feedback (3)' }).click()
  await expect(panel.getByRole('table', { name: 'Colleagues asked' })).toContainText('Hind Al Mansoori')
  await settle(page)

  for (const [userId] of PEERS) {
    await signInAs(page, userId)
    await page.goto('/hr/me')
    const card = page.getByTestId('my-feedback-card')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.getByRole('link', { name: 'Feedback for Noura Al Ketbi' }).click()
    const form = page.getByRole('dialog', { name: 'Feedback for Noura Al Ketbi' })
    const groups = form.getByRole('radiogroup')
    await expect(groups.first()).toBeVisible()
    const n = await groups.count()
    for (let i = 0; i < n; i++) await groups.nth(i).getByRole('radio', { name: '4', exact: true }).click()
    await form.getByLabel('Strengths').fill(`Clear communication (${userId})`)
    await form.getByRole('button', { name: 'Submit feedback' }).click()
    await expect(form).toBeHidden()
    await settle(page)
  }

  await signInAs(page, 'u10')
  await page.goto('/hr/performance?tab=team')
  await page.getByRole('button', { name: `Open ${REVIEW}` }).click()
  drawer = page.getByRole('dialog', { name: REVIEW })
  const summary = drawer.getByTestId('feedback-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('3 colleagues answered')
  await expect(summary.getByTestId('feedback-overall').first()).toHaveText('4.00')
  // Aggregated: the comments are there, the names of who wrote them are not.
  await expect(summary).toContainText('Clear communication (u15)')
  await expect(summary).not.toContainText('Leena Joseph')
})
