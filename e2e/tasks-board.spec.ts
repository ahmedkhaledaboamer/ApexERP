import { expect, test, type Page } from '@playwright/test'
import { centerOf, column, mouseDrag, signInAs } from './helpers'

/**
 * Regression: the task board (mouse and keyboard drags, Blocked needs a reason, Done, a refused
 * move, rollback when the server fails), the calendar (drag to reschedule + undo) and the My tasks
 * groups. Every test creates its own tasks through the API, so it never depends on the seed's
 * dates. Server failures are switched off (window.__apexMoveFailureRate = 0) unless a test turns
 * them on.
 */

test.use({ viewport: { width: 1800, height: 1100 } }) // all four board columns on screen

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 0
  })
})

/** Today in the Apex workspace's timezone (Asia/Dubai), as the app computes it. */
function companyToday(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** My tasks, once the app (and the mock API's service worker) is up. */
async function gotoMyTasks(page: Page) {
  await page.goto('/tasks/my')
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible()
  await page.waitForLoadState('networkidle')
}

let seq = 0
const unique = (label: string) => `${label} ${Date.now().toString(36)}-${++seq}`

/** Calls the mock API as the signed-in user. */
async function apiCall<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const s = JSON.parse(localStorage.getItem('apexcrm.session') || '{}')
      const r = await fetch(`/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: r.status, body: await r.json() }
    },
    { method, path, body },
  )
}

async function newTask(page: Page, input: Record<string, unknown>): Promise<{ id: string; title: string }> {
  const r = await apiCall<{ id: string; title: string }>(page, 'POST', '/tasks', input)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body
}

/**
 * The mock DB lives in the page and is saved to IndexedDB 300 ms after a write (persist/browser.ts):
 * wait for that before a full navigation, or the next page starts without the new rows.
 */
async function persisted(page: Page) {
  await page.waitForTimeout(900)
}

const taskCard = (page: Page, title: string) => page.locator('[aria-roledescription="draggable"]').filter({ hasText: title })
const inColumn = (page: Page, status: string, title: string) => column(page, status).getByText(title, { exact: true })

async function openBoard(page: Page) {
  await page.goto('/tasks/board')
  await expect(column(page, 'To do')).toBeVisible()
  await page.waitForLoadState('networkidle')
}

/** Signs in as u1 (Company Admin) and creates one To do task due in a few days. */
async function boardWithTask(page: Page, userId = 'u1'): Promise<string> {
  await signInAs(page, userId)
  await gotoMyTasks(page)
  const t = await newTask(page, { title: unique('Board probe'), dueDate: companyToday(3), priority: 'High' })
  await persisted(page)
  await openBoard(page)
  await expect(inColumn(page, 'To do', t.title)).toBeVisible()
  return t.title
}

async function dragTo(page: Page, title: string, status: string) {
  // The admin's To do column holds dozens of cards and scrolls on its own: bring the card into view.
  // The columns stretch to the tallest one, so drop at the card's height inside the target column.
  await taskCard(page, title).first().scrollIntoViewIfNeeded()
  const from = await centerOf(taskCard(page, title).first())
  const target = await column(page, status).boundingBox()
  if (!target) throw new Error(`no ${status} column`)
  await mouseDrag(page, from, { x: target.x + target.width / 2, y: from.y })
}

/** Keyboard: focus the card, Space to pick up, → until the target column, Space to drop. */
async function keyboardTo(page: Page, title: string, status: string) {
  await taskCard(page, title).first().focus()
  await page.keyboard.press('Space')
  const live = page.locator('[id^="DndLiveRegion"]')
  for (let i = 0; i < 6; i++) {
    const before = (await live.textContent()) ?? ''
    if (before.includes(`over droppable area ${status}.`)) break
    await page.keyboard.press('ArrowRight')
    // The announcement updates after the move is rendered: wait for it before deciding again.
    await expect.poll(async () => (await live.textContent()) ?? '', { timeout: 2000 }).not.toBe(before)
  }
  await expect(live).toContainText(`over droppable area ${status}`)
  await page.keyboard.press('Space')
}

async function savedTask(page: Page, title: string) {
  const r = await apiCall<{ title: string; status: string; dueDate: string | null; comments: { body: string }[] }[]>(page, 'GET', '/tasks?includeDone=true')
  return r.body.find((t) => t.title === title)!
}

test('mouse: To do → In progress moves and is saved', async ({ page }) => {
  const title = await boardWithTask(page)
  await expect(page.locator('#board-hint')).toHaveAttribute('data-can-move', 'true')
  await dragTo(page, title, 'In progress')
  await expect(inColumn(page, 'In progress', title)).toBeVisible()
  await expect(page.getByText('Moved to In progress')).toBeVisible()
  await expect.poll(async () => (await savedTask(page, title)).status).toBe('In progress')
})

test('keyboard: Space + → + Space moves To do → In progress → Done', async ({ page }) => {
  const title = await boardWithTask(page)
  await keyboardTo(page, title, 'In progress')
  await expect(inColumn(page, 'In progress', title)).toBeVisible()
  await expect.poll(async () => (await savedTask(page, title)).status).toBe('In progress')
  await page.waitForLoadState('networkidle')
  await keyboardTo(page, title, 'Done')
  await expect(inColumn(page, 'Done', title)).toBeVisible()
  await expect.poll(async () => (await savedTask(page, title)).status).toBe('Done')
})

test('→ Blocked asks for a reason; the reason is required and saved as a comment', async ({ page }) => {
  const title = await boardWithTask(page)
  await dragTo(page, title, 'Blocked')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Why is it blocked?')
  await dialog.getByRole('button', { name: 'Mark blocked' }).click()
  await expect(dialog).toContainText('Say briefly what it’s waiting on.')
  await expect(inColumn(page, 'To do', title)).toBeVisible()
  await dialog.getByLabel('Reason').fill('Waiting for the trade licence')
  await dialog.getByRole('button', { name: 'Mark blocked' }).click()
  await expect(dialog).toBeHidden()
  await expect(inColumn(page, 'Blocked', title)).toBeVisible()
  await expect.poll(async () => (await savedTask(page, title)).status).toBe('Blocked')
  expect((await savedTask(page, title)).comments.map((c) => c.body)).toContain('Blocked: Waiting for the trade licence')
  // The server refuses Blocked without a reason as well.
  const other = await newTask(page, { title: unique('API blocked probe') })
  const r = await apiCall<{ message?: string }>(page, 'PATCH', `/tasks/${other.id}`, { status: 'Blocked' })
  expect(r.status).toBe(422)
})

test('→ Done moves the card to Done', async ({ page }) => {
  const title = await boardWithTask(page)
  await dragTo(page, title, 'Done')
  await expect(inColumn(page, 'Done', title)).toBeVisible()
  await expect(page.getByText('Task done')).toBeVisible()
  await expect.poll(async () => (await savedTask(page, title)).status).toBe('Done')
})

test('a failed save rolls the card back and shows the server’s message', async ({ page }) => {
  const title = await boardWithTask(page)
  await page.evaluate(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 1
  })
  await dragTo(page, title, 'In progress')
  await expect(page.getByText(`“${title}” wasn’t moved`)).toBeVisible()
  await expect(page.getByText('The server didn’t save the change')).toBeVisible()
  await expect(inColumn(page, 'To do', title)).toBeVisible()
  await expect(inColumn(page, 'In progress', title)).toHaveCount(0)
  expect((await savedTask(page, title)).status).toBe('To do')
})

test('a read-only workspace says why, refuses the drop, and the card stays', async ({ page }) => {
  const title = await boardWithTask(page)
  // Suspend the subscription through the dev billing simulator panel (refreshes entitlements in place).
  if (!(await page.locator('#dev-status').isVisible())) await page.locator('#billing-simulator-toggle').click()
  await page.locator('#dev-status').selectOption('suspended')
  await expect(page.locator('#billing-banner')).toHaveAttribute('data-status', 'suspended')
  await expect(page.locator('#board-hint')).toHaveAttribute('data-can-move', 'false')
  await expect(page.locator('#board-hint')).toContainText('Workspace is read-only')
  await dragTo(page, title, 'In progress')
  await expect(page.getByText(`“${title}” wasn’t moved`)).toBeVisible()
  await expect(inColumn(page, 'To do', title)).toBeVisible()
  await expect(inColumn(page, 'In progress', title)).toHaveCount(0)
  expect((await savedTask(page, title)).status).toBe('To do')
})

test('a Sales Agent moves their own task; tasks outside their scope never reach the board', async ({ page }) => {
  await signInAs(page, 'u4')
  await gotoMyTasks(page)
  const mine = await newTask(page, { title: unique('Agent probe'), dueDate: companyToday(2) })
  await persisted(page)
  await openBoard(page)
  await expect(page.locator('#board-hint')).toHaveAttribute('data-can-move', 'true')
  const tasks = await apiCall<{ ownerId: string; followerIds: string[]; createdBy: string; canEdit: boolean }[]>(page, 'GET', '/tasks?includeDone=true')
  expect(tasks.body.every((t) => t.canEdit)).toBe(true)
  expect(tasks.body.every((t) => t.ownerId === 'u4' || t.followerIds.includes('u4') || t.createdBy === 'u4')).toBe(true)
  await dragTo(page, mine.title, 'In progress')
  await expect(inColumn(page, 'In progress', mine.title)).toBeVisible()
  // Assigning to a colleague is refused by the server's team rule (own scope).
  const r = await apiCall<{ message: string }>(page, 'PATCH', `/tasks/${mine.id}`, { ownerId: 'u5' })
  expect(r.status).toBe(403)
  const assignable = await apiCall<{ id: string }[]>(page, 'GET', '/tasks/assignable')
  expect(assignable.body.map((u) => u.id)).toEqual(['u4'])
})

/** Two days of the same Monday-start week (the week view shows every chip): the 10th and its neighbour. */
function calendarDays(): { from: string; to: string } {
  const from = `${companyToday().slice(0, 7)}-10`
  const sunday = new Date(`${from}T00:00:00Z`).getUTCDay() === 0
  return { from, to: `${companyToday().slice(0, 7)}-${sunday ? '09' : '11'}` }
}

test('calendar: drag a task to another day, then undo', async ({ page }) => {
  await signInAs(page, 'u1')
  await gotoMyTasks(page)
  const { from, to } = calendarDays()
  const t = await newTask(page, { title: unique('Calendar probe'), dueDate: from })
  await persisted(page)
  await page.goto(`/tasks/calendar?view=week&d=${from}`)
  await expect(page.locator('#calendar-hint')).toHaveAttribute('data-can-move', 'true')
  const chip = page.locator(`[data-day="${from}"]`).getByRole('button', { name: new RegExp(`^${t.title}`) })
  await expect(chip).toBeVisible()
  await page.waitForLoadState('networkidle')
  await mouseDrag(page, await centerOf(chip), await centerOf(page.locator(`[data-day="${to}"]`)))
  await expect(page.locator(`[data-day="${to}"]`).getByRole('button', { name: new RegExp(`^${t.title}`) })).toBeVisible()
  await expect.poll(async () => (await savedTask(page, t.title)).dueDate).toBe(to)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Change undone')).toBeVisible()
  await expect(page.locator(`[data-day="${from}"]`).getByRole('button', { name: new RegExp(`^${t.title}`) })).toBeVisible()
  await expect.poll(async () => (await savedTask(page, t.title)).dueDate).toBe(from)
})

test('calendar: a failed reschedule puts the chip back', async ({ page }) => {
  await signInAs(page, 'u1')
  await gotoMyTasks(page)
  const { from, to } = calendarDays()
  const t = await newTask(page, { title: unique('Calendar fail probe'), dueDate: from })
  await persisted(page)
  await page.goto(`/tasks/calendar?view=week&d=${from}`)
  const chipIn = (day: string) => page.locator(`[data-day="${day}"]`).getByRole('button', { name: new RegExp(`^${t.title}`) })
  await expect(chipIn(from)).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => {
    ;(window as unknown as { __apexMoveFailureRate: number }).__apexMoveFailureRate = 1
  })
  await mouseDrag(page, await centerOf(chipIn(from)), await centerOf(page.locator(`[data-day="${to}"]`)))
  await expect(page.getByText(`“${t.title}” wasn’t rescheduled`)).toBeVisible()
  await expect(chipIn(from)).toBeVisible()
  expect((await savedTask(page, t.title)).dueDate).toBe(from)
})

test('My tasks: Overdue, Today, This week / Later and No date groups by the company’s day', async ({ page }) => {
  await signInAs(page, 'u1')
  await gotoMyTasks(page)
  const overdue = await newTask(page, { title: unique('Overdue probe'), dueDate: companyToday(-2) })
  const today = await newTask(page, { title: unique('Today probe'), dueDate: companyToday() })
  const tomorrow = await newTask(page, { title: unique('Tomorrow probe'), dueDate: companyToday(1) })
  const later = await newTask(page, { title: unique('Later probe'), dueDate: companyToday(30) })
  const none = await newTask(page, { title: unique('No date probe') })
  await persisted(page)
  await page.reload()
  await page.waitForLoadState('networkidle')
  // Apex weeks start on Monday (regional weekStartsOn = 1): tomorrow is this week unless today is Sunday.
  const isSunday = new Date(`${companyToday()}T00:00:00Z`).getUTCDay() === 0
  const group = (id: string) => page.locator(`#task-group-${id}`)
  await expect(group('overdue')).toContainText(overdue.title)
  await expect(group('today')).toContainText(today.title)
  await expect(group(isSunday ? 'later' : 'week')).toContainText(tomorrow.title)
  await expect(group('later')).toContainText(later.title)
  await expect(group('none')).toContainText(none.title)
  await expect(page.locator('#task-group-today-h')).toContainText('Today')
})
