import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * AI assistant end to end (Apex):
 *   - a Sales Agent (u4) asks what to follow up today, opens a lead card, asks for a follow-up email, edits the subject
 *     and confirms → the email is logged on the lead; asks for overdue invoices → refused;
 *   - the Accountant (u8) gets the overdue invoices table;
 *   - "Ask AI" on a lead page summarizes that lead.
 */

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function apiCall(page: Page, method: string, path: string): Promise<Res> {
  return page.evaluate(
    async ({ m, p }) => {
      const raw = localStorage.getItem('apexcrm.session')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
      const r = await fetch(`/api${p}`, { method: m, headers: { Authorization: `Bearer ${token}` } })
      return { status: r.status, body: await r.json() }
    },
    { m: method, p: path },
  )
}

async function ask(page: Page, text: string) {
  const before = await page.getByTestId('ai-assistant-message').count()
  await page.getByTestId('ai-composer').fill(text)
  await page.getByTestId('ai-send').click()
  const answer = page.getByTestId('ai-assistant-message').nth(before)
  await expect(answer).toBeVisible({ timeout: 20_000 })
  // The streamed text finishes before the blocks render: wait for the copy button of the full answer.
  await expect(answer.getByRole('button', { name: 'Copy', exact: true })).toBeVisible({ timeout: 20_000 })
  return answer
}

test('a sales agent follows up, drafts and sends an edited email, and is refused finance data', async ({ page }) => {
  test.setTimeout(150_000)
  await signInAs(page, 'u4')
  await page.goto('/ai')
  await expect(page.getByRole('heading', { name: 'AI assistant' })).toBeVisible()

  // 1. What should I follow up today? → lead cards; open one.
  await page.getByTestId('ai-suggestions').getByRole('button', { name: 'What should I follow up today?' }).click()
  const first = page.getByTestId('ai-assistant-message').first()
  await expect(first).toContainText(/follow-ups? due today|caught up/, { timeout: 20_000 })
  const leadCard = first.getByTestId('ai-card').first()
  await expect(leadCard).toBeVisible({ timeout: 20_000 })
  await leadCard.click()
  await expect(page).toHaveURL(/\/leads\/L-\d+/)
  await page.goBack()
  await expect(page).toHaveURL(/\/ai\?c=AIC-/)

  // 2. Draft a follow-up email, edit the subject, confirm.
  const draft = await ask(page, 'Draft a follow-up email to Al Noor Medical Centre')
  const action = draft.getByTestId('ai-action')
  await expect(action).toHaveAttribute('data-status', 'pending')
  await expect(action).toContainText('Nothing changes until you confirm.')
  const before = (await apiCall(page, 'GET', '/leads/L-1001/activities')).body as { summary: string }[]
  await action.getByRole('button', { name: 'Edit' }).click()
  await action.getByLabel('Subject').fill('Next steps for Al Noor — chatbot pilot')
  await action.getByRole('button', { name: 'Confirm & send' }).click()
  await expect(action).toHaveAttribute('data-status', 'confirmed', { timeout: 20_000 })
  await expect(page.getByTestId('ai-assistant-message').last()).toContainText('the email was sent')
  const after = (await apiCall(page, 'GET', '/leads/L-1001/activities')).body as { type: string; summary: string }[]
  expect(after.length).toBe(before.length + 1)
  expect(after[0]).toMatchObject({ type: 'email' })
  expect(after[0].summary).toContain('Next steps for Al Noor — chatbot pilot')

  // 3. Finance is refused for a Sales Agent.
  const fin = await ask(page, 'Which invoices are overdue?')
  await expect(fin.getByTestId('ai-refusal')).toContainText('You don’t have access to finance data')
  await expect(fin.getByTestId('ai-table')).toHaveCount(0)
})

test('the accountant gets the overdue invoices table', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u8')
  await page.goto('/ai')
  const fin = await ask(page, 'Which invoices are overdue?')
  const table = fin.getByTestId('ai-table')
  await expect(table).toBeVisible()
  await expect(table.locator('tbody tr').first()).toContainText(/INV-/)
  await expect(fin.getByTestId('ai-refusal')).toHaveCount(0)
})

test('"Ask AI" on a lead page summarizes the lead', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u4')
  await page.goto('/leads/L-1001')
  await page.getByTestId('ask-ai').click()
  const panel = page.getByTestId('ask-ai-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('ai-suggestions').getByRole('button', { name: 'Summarize' }).click()
  const answer = panel.getByTestId('ai-assistant-message').first()
  await expect(answer).toContainText('Al Noor Medical Centre (L-1001)', { timeout: 20_000 })
  await expect(answer.getByTestId('ai-card').first()).toHaveAttribute('data-record', 'lead:L-1001')
})
