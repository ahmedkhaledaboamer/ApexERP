import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Onboarding & offboarding end to end (Apex):
 *   - Mariam Saeed (u9, HR) creates an employee in onboarding (with a login, in Delivery, manager Daniel Ortiz u10)
 *     → the onboarding journey appears on the Onboarding & offboarding page;
 *   - the new employee ticks their own items in My tasks, Daniel his manager items, HR the rest → HR marks active;
 *   - an offboarding is blocked by an unreturned asset until it is returned, then completed.
 */

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<Res> {
  return page.evaluate(
    async ({ m, p, b }) => {
      const raw = localStorage.getItem('apexcrm.session')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
      const r = await fetch(`/api${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
      return { status: r.status, body: await r.json() }
    },
    { m: method, p: path, b: body },
  )
}

const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Ticks every open item the page offers to the caller, one at a time (each tick refetches). */
async function tickAll(page: Page, scope = page.locator('main')) {
  const buttons = scope.getByRole('button', { name: /^Mark .* done$/ })
  for (let guard = 0; guard < 60; guard++) {
    const n = await buttons.count()
    if (n === 0) return
    await buttons.first().click()
    await expect(buttons).toHaveCount(n - 1)
  }
}

test('onboarding: HR creates a joiner → employee and manager tick their items → HR marks active', async ({ page }) => {
  test.setTimeout(180_000)
  const tag = Date.now().toString(36)
  const name = `Journey E2E ${tag}`
  await signInAs(page, 'u1')
  const u = await apiCall(page, 'POST', '/settings/users', { name, email: `journey.${tag}@apexaora.ae`, mobile: '+971 50 555 0142', role: 'Employee', title: 'Engineer', department_id: 'd-delivery', manager_id: 'u10' })
  expect(u.status).toBe(200)

  await signInAs(page, 'u9')
  const e = await apiCall(page, 'POST', '/hr/employees', { full_name: name, job_title: 'Engineer', hire_date: isoIn(7), department_id: 'd-delivery', manager_id: 'EMP-u10', nationality: 'IN', status: 'onboarding', user_id: u.body.id })
  expect(e.status).toBe(200)
  await page.goto('/hr/journeys')
  await expect(page.getByRole('heading', { name: 'Onboarding & offboarding' })).toBeVisible()
  const row = page.getByRole('table', { name: 'Journeys' }).getByRole('row').filter({ hasText: name })
  await expect(row).toContainText('Delivery team onboarding')
  await row.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { name: `Onboarding: ${name}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mark active' })).toBeDisabled()
  const url = page.url()

  // The employee: their own items in My tasks.
  await signInAs(page, u.body.id)
  await page.goto('/hr/journeys?tab=mine')
  const mine = page.getByRole('list', { name: 'My tasks' })
  await expect(mine.getByText('Complete personal details and emergency contact')).toBeVisible()
  await tickAll(page, mine)

  // The manager (Department Head): their items.
  await signInAs(page, 'u10')
  await page.goto('/hr/journeys?tab=mine')
  const his = page.getByRole('list', { name: 'My tasks' })
  await expect(his.getByText('Assign a first-week buddy').first()).toBeVisible()
  await tickAll(page, his)

  // HR: everything else, then mark active.
  await signInAs(page, 'u9')
  await page.goto(url)
  await expect(page.getByRole('heading', { name: `Onboarding: ${name}` })).toBeVisible()
  await tickAll(page)
  await page.getByRole('button', { name: 'Mark active' }).click()
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible()
  const after = await apiCall(page, 'GET', `/hr/employees/${e.body.id}`)
  expect(after.body.status).toBe('active')
})

test('offboarding is blocked by an unreturned asset until it is returned', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u9')
  const assets = (await apiCall(page, 'GET', '/hr/assets?status=assigned')).body as { id: string; tag: string; assigned_to_id: string }[]
  const held = assets.find((a) => a.assigned_to_id === 'EMP-u12') ?? assets[0]
  const empId = held.assigned_to_id
  expect((await apiCall(page, 'PATCH', `/hr/employees/${empId}`, { status: 'notice', exit_date: isoIn(14) })).status).toBe(200)
  const list = (await apiCall(page, 'GET', `/hr/journeys?kind=offboarding&status=active&employee_id=${empId}`)).body as { id: string }[]
  expect(list).toHaveLength(1)
  await page.goto(`/hr/journeys/${list[0].id}`)
  const complete = page.getByRole('button', { name: 'Complete offboarding' })
  await expect(complete).toBeDisabled()
  await expect(page.getByRole('status')).toContainText(held.tag)

  for (const a of assets.filter((x) => x.assigned_to_id === empId)) {
    expect((await apiCall(page, 'POST', `/hr/assets/${a.id}/return`, { date: isoIn(0), condition: 'good' })).status).toBe(200)
  }
  await page.reload()
  await expect(complete).toBeEnabled()
  await complete.click()
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible()
})
