import { expect, test, type Page } from '@playwright/test'
import { card, centerOf, column, mouseDrag, signInAs } from './helpers'

/**
 * Regression: dragging leads across the Sales pipeline (mouse and keyboard), every kind of stage
 * requirement, rollback on a refused move, and each role. The mock's random move failures are
 * switched off (window.__apexMoveFailureRate = 0) unless a test turns them on.
 */

test.use({ viewport: { width: 3800, height: 1100 } }) // all 11 columns on screen: real mouse targets

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 0
  })
})

async function openBoard(page: Page, userId: string) {
  await signInAs(page, userId)
  await page.goto('/leads/pipeline')
  await expect(column(page, 'New')).toBeVisible()
  await page.waitForLoadState('networkidle')
}

async function firstLeadIn(page: Page, stage: string): Promise<string> {
  const texts = await column(page, stage).locator('[aria-roledescription="draggable"]').allInnerTexts()
  const id = texts[0]?.match(/L-\d+/)?.[0]
  if (!id) throw new Error(`no lead in ${stage}`)
  return id
}

async function dragTo(page: Page, leadId: string, stage: string) {
  await mouseDrag(page, await centerOf(card(page, leadId).first()), await centerOf(column(page, stage)))
}

/** Keyboard: focus the card, Space to pick up, → until the target column, Space to drop. */
async function keyboardTo(page: Page, leadId: string, stage: string) {
  await card(page, leadId).first().focus()
  await page.keyboard.press('Space')
  const live = page.locator('[id^="DndLiveRegion"]')
  for (let i = 0; i < 14; i++) {
    const before = (await live.textContent()) ?? ''
    if (before.includes(`over droppable area ${stage}.`)) break
    await page.keyboard.press('ArrowRight')
    // The announcement updates after the move is rendered: wait for it before deciding again.
    await expect.poll(async () => (await live.textContent()) ?? '', { timeout: 2000 }).not.toBe(before)
  }
  await expect(live).toContainText(`over droppable area ${stage}`)
  await page.keyboard.press('Space')
}

const inStage = (page: Page, stage: string, leadId: string) => column(page, stage).getByText(leadId, { exact: true })

test('mouse: New → Interested asks for next step + date, then moves and persists', async ({ page }) => {
  await openBoard(page, 'u1')
  const id = await firstLeadIn(page, 'New')
  await dragTo(page, id, 'Interested')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('to Interested')
  // Empty next step: the error is shown (never a silent failure) and nothing moves.
  await page.locator('#sc-step').fill('')
  await dialog.getByRole('button', { name: 'Move to Interested' }).click()
  await expect(dialog).toContainText('Describe the next step.')
  await expect(inStage(page, 'New', id)).toBeVisible()
  await page.locator('#sc-step').fill('Send the proposal')
  await dialog.getByRole('button', { name: 'Move to Interested' }).click()
  await expect(dialog).toBeHidden()
  await expect(inStage(page, 'Interested', id)).toBeVisible()
  // Saved on the server (not just the optimistic cache).
  const saved = await page.evaluate(async (leadId) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api/leads/${leadId}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return (await r.json()) as { status_id: string; next_step: string; next_follow_up_date: string }
  }, id)
  // The API speaks the leads columns; the follow-up is a calendar date (yyyy-MM-dd).
  expect(saved).toMatchObject({ status_id: 'Interested', next_step: 'Send the proposal' })
  expect(saved.next_follow_up_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('keyboard: Space + → moves across columns (New → Contacted, Contacted → Interested)', async ({ page }) => {
  await openBoard(page, 'u1')
  const id = await firstLeadIn(page, 'New')
  await keyboardTo(page, id, 'Contacted')
  await expect(inStage(page, 'Contacted', id)).toBeVisible()
  await keyboardTo(page, id, 'Interested')
  await page.locator('#sc-step').fill('Call the CFO')
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Interested' }).click()
  await expect(inStage(page, 'Interested', id)).toBeVisible()
})

test('Lost and Not interested need a reason from the list', async ({ page }) => {
  await openBoard(page, 'u1')
  for (const stage of ['Lost', 'Not interested']) {
    const id = await firstLeadIn(page, 'New')
    await dragTo(page, id, stage)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`as ${stage}`)
    await dialog.getByRole('button', { name: `Mark as ${stage}` }).click()
    await expect(dialog).toContainText('Pick the reason this lead closed.')
    const value = await page.locator('#sc-reason option:not([value=""])').first().getAttribute('value')
    await page.locator('#sc-reason').selectOption(value!)
    await dialog.getByRole('button', { name: `Mark as ${stage}` }).click()
    await expect(dialog).toBeHidden()
    await expect(inStage(page, stage, id)).toBeVisible()
  }
})

test('Won opens the Won flow and the card stays until it is confirmed', async ({ page }) => {
  await openBoard(page, 'u1')
  const id = await firstLeadIn(page, 'Proposal')
  await dragTo(page, id, 'Won')
  await expect(page.getByRole('dialog')).toContainText(/won/i)
  await expect(inStage(page, 'Proposal', id)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inStage(page, 'Proposal', id)).toBeVisible()
})

test('direct moves to every stage without requirements', async ({ page }) => {
  await openBoard(page, 'u1')
  const id = await firstLeadIn(page, 'New')
  for (const stage of ['Contacted', 'No response', 'Call later', 'Proposal', 'Cold', 'New']) {
    await dragTo(page, id, stage)
    await expect(inStage(page, stage, id)).toBeVisible()
  }
})

test('a refused move rolls back and says why', async ({ page }) => {
  await openBoard(page, 'u1')
  await page.evaluate(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 1
  })
  const id = await firstLeadIn(page, 'New')
  await dragTo(page, id, 'Contacted')
  await expect(page.getByText('Move not saved')).toBeVisible()
  await expect(inStage(page, 'New', id)).toBeVisible()
  await expect(inStage(page, 'Contacted', id)).toHaveCount(0)
})

for (const { id: userId, role } of [
  { id: 'u2', role: 'Management' },
  { id: 'u3', role: 'Sales Manager' },
  { id: 'u4', role: 'Sales Agent' },
]) {
  test(`${role} can move a lead in scope`, async ({ page }) => {
    await openBoard(page, userId)
    await expect(page.locator('#pipeline-hint')).toHaveAttribute('data-can-move', 'true')
    const id = await firstLeadIn(page, 'New')
    await dragTo(page, id, 'Contacted')
    await expect(inStage(page, 'Contacted', id)).toBeVisible()
  })
}

test('a role without edit access gets a clear message and nothing moves', async ({ page }) => {
  await openBoard(page, 'u7') // Marketing Manager: sales = view
  await expect(page.locator('#pipeline-hint')).toHaveAttribute('data-can-move', 'false')
  await expect(page.locator('#pipeline-hint')).toContainText('can view the pipeline but not move leads')
  const id = await firstLeadIn(page, 'New')
  await dragTo(page, id, 'Contacted')
  await expect(page.getByText('wasn’t moved')).toBeVisible()
  await expect(inStage(page, 'New', id)).toBeVisible()
})

test('a read-only workspace names the real reason (not "edit access") and nothing moves', async ({ page }) => {
  await openBoard(page, 'u1')
  // Suspend the subscription through the dev billing simulator panel (refreshes entitlements in place).
  if (!(await page.locator('#dev-status').isVisible())) await page.locator('#billing-simulator-toggle').click()
  await page.locator('#dev-status').selectOption('suspended')
  await expect(page.locator('#billing-banner')).toHaveAttribute('data-status', 'suspended')
  await expect(page.locator('#pipeline-hint')).toHaveAttribute('data-can-move', 'false')
  await expect(page.locator('#pipeline-hint')).toContainText('Workspace is read-only')
  await expect(page.locator('#pipeline-hint')).not.toContainText('edit access')
  const id = await firstLeadIn(page, 'New')
  await dragTo(page, id, 'Contacted')
  await expect(page.getByText('wasn’t moved')).toBeVisible()
  await expect(inStage(page, 'New', id)).toBeVisible()
})
