import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Attendance and Leave end to end (Apex): an employee (u11 Noura, Employee) clocks in / out and
 * requests leave → her manager (u10 Daniel, Department Head) approves → HR (u9 Mariam) approves →
 * her balance shows the days taken and the team calendar shows her off. HR sees the today board.
 * A Sales Agent (u4 Bincy, hr hidden) requests her own leave but can't see anyone else's.
 */

/** Calls the mock API with the signed-in session. */
async function apiCall<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return page.evaluate(
    async ({ method, path, body }) => {
      const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
      const r = await fetch(`/api${path}`, { method, headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      return { status: r.status, body: await r.json() }
    },
    { method, path, body },
  )
}

/** A single working day the signed-in employee can take as annual leave (the preview says 1 day, no problem). */
async function freeWorkingDay(page: Page, fromDays: number): Promise<string> {
  const me = await apiCall(page, 'GET', '/hr/leave/me')
  const annual = me.body.types.find((t: { code: string }) => t.code === 'annual').id
  const today = new Date(`${me.body.today}T00:00:00Z`)
  for (let n = fromDays; n < fromDays + 60; n++) {
    const d = new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10)
    const p = await apiCall(page, 'POST', '/hr/leave/requests/preview', { leave_type_id: annual, start_date: d, end_date: d })
    if (p.status === 200 && p.body.days === 1 && !p.body.problem) return d
  }
  throw new Error('No free working day found')
}

async function requestLeave(page: Page, date: string) {
  await page.goto('/hr/leave?tab=me')
  await page.getByRole('button', { name: 'Request leave' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request leave' })
  await expect(dialog.getByLabel('Leave type')).toHaveValue(/.+/)
  await dialog.getByLabel('From').fill(date)
  await dialog.getByLabel('To').fill(date)
  await expect(dialog.getByTestId('leave-preview')).toContainText('1 working day')
  await dialog.getByRole('button', { name: 'Submit request' }).click()
  await expect(page.getByText('Leave requested')).toBeVisible()
}

async function approveFor(page: Page, name: string) {
  await page.goto('/hr/leave?tab=approvals')
  const row = page.getByRole('row').filter({ hasText: name }).first()
  await row.getByRole('button', { name: 'Approve' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm approval' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('employee clocks in / out, requests leave → manager → HR approve → balance and calendar', async ({ page }) => {
  test.setTimeout(240_000) // four sign-ins (employee, manager, HR, employee again)
  await signInAs(page, 'u11')
  await page.goto('/hr/attendance?tab=me')
  const card = page.getByRole('region', { name: 'Clock in and out' })
  await expect(card).toBeVisible()
  if (await card.getByRole('button', { name: 'Clock out' }).isVisible()) {
    await card.getByRole('button', { name: 'Clock out' }).click()
    await expect(card.getByRole('button', { name: 'Clock in' })).toBeVisible()
  }
  await card.getByRole('button', { name: 'Clock in' }).click()
  await expect(card.getByRole('button', { name: 'Clock out' })).toBeVisible()
  await expect(card).toContainText('Clocked in since')
  await card.getByRole('button', { name: 'Clock out' }).click()
  await expect(page.getByText('Clocked out', { exact: true }).last()).toBeVisible()
  await expect(card.getByRole('button', { name: 'Clock in' })).toBeVisible({ timeout: 15_000 })

  // Leave: the balance before, then a one-day request.
  const date = await freeWorkingDay(page, 21)
  const nowMonth = ((await apiCall(page, 'GET', '/hr/leave/me')).body.today as string).slice(0, 7)
  await page.goto('/hr/leave?tab=me')
  const taken = Number(await page.getByTestId('balance-annual').getByTestId('taken').innerText())
  await requestLeave(page, date)
  await expect(page.getByRole('table', { name: 'Leave requests' })).toContainText('Waiting for manager')

  // Step 1: her manager / department head.
  await signInAs(page, 'u10')
  await approveFor(page, 'Noura Al Ketbi')
  // Step 2: HR.
  await signInAs(page, 'u9')
  await approveFor(page, 'Noura Al Ketbi')
  // HR sees the today board.
  await page.goto('/hr/attendance?tab=today')
  await expect(page.getByRole('table', { name: "Who's in today" })).toContainText('Noura Al Ketbi')

  // Back as the employee: approved, taken +1, on the calendar.
  await signInAs(page, 'u11')
  await page.goto('/hr/leave?tab=me')
  await expect(page.getByTestId('balance-annual').getByTestId('taken')).toHaveText(String(taken + 1))
  await expect(page.getByRole('table', { name: 'Leave requests' })).toContainText('Approved')
  await page.goto('/hr/leave?tab=calendar')
  await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible()
  const month = date.slice(0, 7)
  const now = nowMonth
  const ahead = (Number(month.slice(0, 4)) - Number(now.slice(0, 4))) * 12 + Number(month.slice(5)) - Number(now.slice(5))
  for (let i = 0; i < ahead; i++) {
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText(/^\w+ \d{4}$/).first()).toBeVisible()
  }
  await expect(page.locator(`[data-date="${date}"]`)).toContainText('Noura Al Ketbi')
})

test('a Sales Agent requests their own leave but sees no one else’s', async ({ page }) => {
  await signInAs(page, 'u4')
  // No HR items in the sidebar for a hidden hr scope, but the self-service entry is in the user menu.
  await page.goto('/dashboard')
  await page.getByRole('button', { name: /Bincy Thomas/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Request leave' })).toBeVisible()
  await page.keyboard.press('Escape')

  const date = await freeWorkingDay(page, 21)
  await requestLeave(page, date)
  await expect(page.getByRole('tab', { name: 'All requests' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Balances' })).toHaveCount(0)
  const list = await apiCall(page, 'GET', '/hr/leave/requests')
  expect(list.status).toBe(200)
  expect(list.body.length).toBeGreaterThan(0)
  expect(list.body.every((r: { employee_id: string }) => r.employee_id === 'EMP-u4')).toBe(true)
  expect((await apiCall(page, 'GET', '/hr/attendance/today')).status).toBe(403)
  expect((await apiCall(page, 'GET', '/hr/attendance/employees/EMP-u11')).status).toBe(404)
})
