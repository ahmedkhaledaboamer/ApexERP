import { expect, test, type Page } from '@playwright/test'
import { card, centerOf, column, mouseDrag, signInAs } from './helpers'

/**
 * The Won flow end to end: every trigger (board drag, accepting a quotation, "Win deal") opens the one
 * Won dialog; it shows what will happen, blocks on missing requirements, and either lands on the new
 * project or (failpoint) says which step failed with nothing changed.
 *
 * Seed: L-1028 "Zayed University Partners Office" (Apex, Proposal, owner u5, 2 contacts, service S-101
 * with an 8-task template) and its Sent quotation Q-1012 (S-101, S-601, S-102 × 12 months).
 * Failpoints (mock only): window.__apexWonFailAt = step, window.__apexWonFailWith = 'limit' | …
 */

test.use({ viewport: { width: 3800, height: 1100 } }) // every board column on screen: real mouse targets

const LEAD = 'L-1028'
const COMPANY = 'Zayed University Partners Office'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 0
  })
})

/** GET through the mock API with the signed-in session. */
async function apiGet<T = any>(page: Page, path: string): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(async (p) => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch(`/api${p}`, { headers: { Authorization: `Bearer ${s.token}` } })
    return { status: r.status, body: await r.json() }
  }, path)
}

const wonDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: 'Review what will happen' })

/** The lead fields these tests check (the API speaks the leads columns: status_id, customer_id, won_at). */
function leadFields(body: Record<string, unknown>) {
  return { status: body.status_id, customerId: body.customer_id ?? null, wonAt: body.won_at ?? null }
}

async function openLead(page: Page, id: string) {
  await page.goto(`/leads/${id}`)
  await page.getByRole('button', { name: 'Win deal' }).click()
  await expect(wonDialog(page)).toBeVisible()
}

test('drag a Proposal lead to Won → the dialog shows what will happen → confirm → the new project', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/leads/pipeline')
  await expect(column(page, 'Proposal').getByText(LEAD, { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await mouseDrag(page, await centerOf(card(page, LEAD).first()), await centerOf(column(page, 'Won')))

  const dialog = wonDialog(page)
  await expect(dialog).toContainText(`Win ${COMPANY}`)
  await expect(dialog).toContainText(`Creates the CRM customer ${COMPANY}`)
  await expect(dialog).toContainText('2 contacts')
  await expect(dialog).toContainText('Creates 1 project with 8 tasks')
  await expect(dialog).toContainText('Projects (1)')
  // The project manager is editable.
  const pm = page.locator('#won-pm')
  await expect(pm).toBeEnabled()
  await pm.selectOption('u10')
  await expect(dialog).toContainText('Creates 1 project with 8 tasks')
  await dialog.getByRole('button', { name: 'Confirm Won' }).click()

  await expect(page).toHaveURL(/\/projects\/[^/]+$/)
  await expect(page.locator('h1')).toContainText(COMPANY)
  const projectId = page.url().split('/').pop()!

  const lead = leadFields((await apiGet(page, `/leads/${LEAD}`)).body)
  expect(lead.status).toBe('Won')
  const customerId = lead.customerId as string
  expect(customerId).toBeTruthy()
  // leads.won_at is set by the Won flow.
  expect(lead.wonAt).toBeTruthy()
  const customer = await apiGet(page, `/customers/${customerId}`)
  expect(customer.body.name).toBe(COMPANY)
  expect(customer.body.contacts).toHaveLength(2)
  // contacts.customer_id: the lead's contacts now belong to the customer too (still on the lead, nothing copied).
  for (const c of customer.body.contacts as Record<string, unknown>[]) {
    expect(c.lead_id).toBe(LEAD)
    expect(c.customer_id).toBe(customerId)
  }
  expect(customer.body.recent_activities[0].summary).toMatch(/^Won by/)
  const project = await apiGet(page, `/projects/${projectId}`)
  expect(project.body).toMatchObject({ manager_id: 'u10', customer_id: customerId, status: 'planned', lead_id: LEAD })
  expect(project.body.tasks).toHaveLength(8)
  // Template tasks: design statuses / priorities, the project as its own column (no project link).
  for (const t of project.body.tasks as { status: string; priority: string; link: unknown; project_id: string }[]) {
    expect(t).toMatchObject({ status: 'todo', link: null, project_id: projectId })
    expect(['low', 'medium', 'high', 'urgent']).toContain(t.priority)
  }
  expect(project.body.audit).toHaveLength(1)

  // The customer 360 shows the carried-over contacts and history.
  await page.goto(`/crm/customers/${customerId}`)
  await expect(page.getByRole('tab', { name: /Contacts/ })).toContainText('2')
  await page.getByRole('tab', { name: /Activity/ }).click()
  await expect(page.getByText(/Won by/).first()).toBeVisible()
})

test('accepting a quotation → Win now → the same dialog with the contract', async ({ page }) => {
  await signInAs(page, 'u1')
  await page.goto('/sales/quotations/Q-1012')
  await page.getByRole('button', { name: 'Accepted', exact: true }).click()
  const prompt = page.getByRole('dialog').filter({ hasText: 'The quotation is accepted' })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Review and win' }).click()

  const dialog = wonDialog(page)
  await expect(dialog).toContainText(`Win ${COMPANY}`)
  await expect(page.locator('#won-quotation')).toHaveValue('Q-1012')
  await expect(dialog).toContainText('and a contract')
  await expect(dialog).toContainText('Projects (3)')
  await dialog.getByRole('button', { name: 'Confirm Won' }).click()
  await expect(page).toHaveURL(/\/projects\/[^/]+$/)
  const lead = leadFields((await apiGet(page, `/leads/${LEAD}`)).body)
  expect(lead.status).toBe('Won')
  const contracts = await apiGet<Record<string, unknown>[]>(page, '/contracts')
  const customerId = lead.customerId
  expect(contracts.body.some((c) => c.customer_id === customerId && c.quotation_id === 'Q-1012')).toBe(true)
  // The accepted quotation gets customer_id and accepted_at.
  const quote = await apiGet(page, '/quotations/Q-1012')
  expect(quote.body.customer_id).toBe(customerId)
  expect(quote.body.accepted_at).toBeTruthy()
})

test('a lead without a contact: the dialog shows the blocking requirement', async ({ page }) => {
  await signInAs(page, 'u1')
  const created = await page.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
    const r = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ company_name: 'No Contact Trading E2E', contact_name: '', phone: '', email: '', source_id: 'Website', industry_id: 'Logistics' }),
    })
    return { status: r.status, body: await r.json() }
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await openLead(page, created.body.id)
  const dialog = wonDialog(page)
  await expect(dialog).toContainText('Fix these before winning')
  await expect(dialog).toContainText('Add at least one contact (a name with a mobile or an email)')
  await expect(dialog.getByRole('button', { name: 'Confirm Won' })).toBeDisabled()
})

test('a failure at a step: the dialog names the step and nothing changed', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __apexWonFailAt: string }).__apexWonFailAt = 'projects'
  })
  await signInAs(page, 'u1')
  const before = await apiGet<unknown[]>(page, '/projects')
  await openLead(page, LEAD)
  const dialog = wonDialog(page)
  await dialog.getByRole('button', { name: 'Confirm Won' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Failed at: projects. Nothing was saved.')
  await expect(dialog.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(leadFields((await apiGet(page, `/leads/${LEAD}`)).body)).toMatchObject({ status: 'Proposal', customerId: null, wonAt: null })
  const after = await apiGet<unknown[]>(page, '/projects')
  expect(after.body).toHaveLength(before.body.length)
  const customers = await apiGet<{ name: string }[]>(page, '/customers')
  expect(customers.body.some((c) => c.name === COMPANY)).toBe(false)
})

test('a plan limit inside the flow: the dialog says which limit with Upgrade, the upgrade prompt opens, nothing saved', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __apexWonFailAt: string; __apexWonFailWith: string }
    w.__apexWonFailAt = 'customer'
    w.__apexWonFailWith = 'limit'
  })
  await signInAs(page, 'u1')
  await openLead(page, LEAD)
  await wonDialog(page).getByRole('button', { name: 'Confirm Won' }).click()
  await expect(page.locator('#upgrade-prompt')).toHaveAttribute('data-limit', 'leadsContacts')
  await page.locator('#upgrade-prompt-dismiss').click()
  const problem = page.locator('#won-plan-problem')
  await expect(problem).toHaveAttribute('data-limit', 'leadsContacts')
  await expect(problem).toContainText('Plan limit reached: Leads & contacts')
  await expect(problem).toContainText('Everything was rolled back')
  await expect(problem.getByRole('button', { name: 'Upgrade' })).toBeVisible()
  await expect(wonDialog(page).getByRole('alert').first()).toContainText('Failed at: customer')
  expect(leadFields((await apiGet(page, `/leads/${LEAD}`)).body)).toMatchObject({ status: 'Proposal', customerId: null, wonAt: null })
})
