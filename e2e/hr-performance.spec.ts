import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Performance end to end (Apex, Enterprise plan with HR):
 * HR (Mariam, u9) creates and launches a check-in cycle for Delivery → the employee (Noura, u11) submits her
 * self-review → HR moves to the manager review → her manager (Daniel, u10) submits his → HR moves to
 * calibration, calibrates with a note and shares → Noura sees her final rating (never the note) and acknowledges.
 */

const QUESTIONS = ['Progress on the priorities agreed for the period', 'Teamwork and communication', 'Initiative and problem solving']
const EMP = 'Noura Al Ketbi'

async function openCycle(page: Page, cycle: string) {
  await page.goto('/hr/performance?tab=cycles')
  await page.getByRole('button', { name: `Open cycle ${cycle}` }).click()
  return page.getByRole('dialog', { name: cycle })
}

test.setTimeout(240_000)

test('HR launches a cycle → self-review → manager review → calibration and share → employee acknowledges', async ({ page }) => {
  const CYCLE = `Q4 check-in ${Date.now().toString(36)}`
  const NOTE = 'Aligned with the Delivery peer group'
  const review = () => page.getByRole('dialog', { name: `${CYCLE} · ${EMP}` })

  // HR creates and launches.
  await signInAs(page, 'u9')
  await page.goto('/hr/performance?tab=cycles')
  await expect(page.getByRole('heading', { name: 'Performance' })).toBeVisible()
  await page.getByRole('button', { name: 'New cycle' }).click()
  const form = page.getByRole('dialog', { name: 'New review cycle' })
  await form.getByLabel('Cycle name').fill(CYCLE)
  await form.getByLabel('Type').selectOption('ad_hoc')
  await form.getByLabel('Template').selectOption({ label: 'Quick check-in' })
  await form.getByLabel('Delivery', { exact: true }).check()
  await form.getByRole('button', { name: 'Create cycle' }).click()
  const cycle = page.getByRole('dialog', { name: CYCLE })
  await cycle.getByRole('button', { name: 'Launch' }).click()
  await expect(cycle.getByRole('button', { name: 'Move to Manager review' })).toBeVisible()
  await expect(cycle.getByRole('table', { name: 'Cycle reviews' })).toContainText(EMP)

  // The employee self-reviews.
  await signInAs(page, 'u11')
  await page.goto('/hr/performance')
  await page.getByRole('button', { name: `Open ${CYCLE} · ${EMP}` }).click()
  for (const q of QUESTIONS) await review().getByLabel(`Self: ${q}`).selectOption('4')
  await review().getByRole('button', { name: 'Submit self-review' }).click()
  await expect(review().getByText(/Self-assessment · submitted/)).toBeVisible()

  // HR opens the manager review.
  await signInAs(page, 'u9')
  await (await openCycle(page, CYCLE)).getByRole('button', { name: 'Move to Manager review' }).click()
  await expect(page.getByRole('dialog', { name: CYCLE }).getByRole('button', { name: 'Move to Calibration' })).toBeVisible()

  // The direct manager reviews.
  await signInAs(page, 'u10')
  await page.goto('/hr/performance?tab=team')
  await page.getByRole('button', { name: `Open ${CYCLE} · ${EMP}` }).click()
  await expect(review().getByText(/Self-assessment · submitted/)).toBeVisible()
  for (const q of QUESTIONS) await review().getByLabel(`Manager: ${q}`).selectOption('4')
  await review().getByLabel('Comments').fill('A strong quarter; keep owning the client hand-overs.')
  await review().getByRole('button', { name: 'Submit manager review' }).click()
  await expect(review().getByText(/Manager assessment · submitted/)).toBeVisible()
  await expect(review().getByTestId('final-rating')).toContainText('4')

  // HR calibrates (with a note) and shares.
  await signInAs(page, 'u9')
  const c2 = await openCycle(page, CYCLE)
  await c2.getByRole('button', { name: 'Move to Calibration' }).click()
  await expect(c2.getByRole('button', { name: 'Move to Shared' })).toBeVisible()
  await c2.getByRole('button', { name: `Open ${CYCLE} · ${EMP}` }).click()
  await review().getByLabel('Calibrated rating').selectOption('3')
  await review().getByLabel('Calibration note').fill(NOTE)
  await review().getByRole('button', { name: 'Save calibration' }).click()
  await expect(review().getByRole('list', { name: 'Calibration history' })).toContainText(NOTE)
  await review().getByRole('button', { name: 'Share with employee' }).click()
  await expect(review().getByText('Shared', { exact: true }).first()).toBeVisible()

  // The employee sees the result (never the note) and acknowledges.
  await signInAs(page, 'u11')
  await page.goto('/hr/performance')
  await page.getByRole('button', { name: `Open ${CYCLE} · ${EMP}` }).click()
  await expect(review().getByTestId('final-rating')).toContainText('Meets expectations')
  await expect(review().getByText('A strong quarter; keep owning the client hand-overs.')).toBeVisible()
  await expect(review()).not.toContainText(NOTE)
  await review().getByLabel('Your comment (optional)').fill('Thank you, agreed.')
  await review().getByRole('button', { name: 'Acknowledge' }).click()
  await expect(review().getByText(/Acknowledged .*Thank you, agreed\./)).toBeVisible()
})
