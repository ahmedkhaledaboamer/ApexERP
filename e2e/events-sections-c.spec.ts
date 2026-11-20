import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Sponsors & exhibitors and Travel & logistics end to end (Apex), as Sara Khoury (Marketing Manager):
 * a package on the organized Dubai Business Breakfast (EV-1003) → a sponsor signed then paid → the event's
 * ROI includes the sponsorship income; a second sponsor on the sold-out package is refused. On CES 2027
 * (EV-1101, attended) a trip with a visa → a travel line on the budget, the visa number masked; a deadline
 * shows on the cross-event deadlines list.
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

const settle = (page: Page) => page.waitForTimeout(800)

test('sponsors: a package, a sponsor signed then paid → ROI includes the income; sold-out refusal', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Date.now().toString(36)
  const pkgName = `E2E Diamond ${tag}`
  await signInAs(page, 'u7')
  await page.goto('/events/EV-1003?tab=sponsors')
  await expect(page.getByRole('heading', { name: 'Dubai Business Breakfast' })).toBeVisible()

  // A package through the UI (quantity 1).
  await page.getByRole('button', { name: 'New package' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(pkgName)
  await dialog.getByLabel('Price (AED)').fill('5000')
  await dialog.getByLabel('Quantity').fill('1')
  await dialog.getByRole('button', { name: 'Add package' }).click()
  await expect(page.getByRole('list', { name: 'Sponsorship packages' }).getByText(pkgName)).toBeVisible()

  // Two prospects on it (new organizations → leads with source Event).
  const board = await apiCall(page, 'GET', '/events/EV-1003/sponsorship')
  const pkg = board.body.packages.find((p: { name: string }) => p.name === pkgName)
  const first = await apiCall(page, 'POST', '/events/EV-1003/sponsors', { package_id: pkg.id, new_lead: { company: `Falcon Sponsor ${tag}`, email: `ops@falcon-${tag}.ae` } })
  const second = await apiCall(page, 'POST', '/events/EV-1003/sponsors', { package_id: pkg.id, new_lead: { company: `Oryx Sponsor ${tag}`, email: `ops@oryx-${tag}.ae` } })
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  const before = (await apiCall(page, 'GET', '/events/EV-1003/stats')).body.sponsorship_income as number
  // A cost so the ROI is defined.
  await apiCall(page, 'POST', '/events/EV-1003/budget-lines', { category: 'venue', planned: 20000, actual: 20000, note: `E2E ${tag}` })
  await settle(page)
  await page.reload()

  // Signed, then paid, from the sponsor drawer.
  await page.getByRole('button', { name: `Falcon Sponsor ${tag}` }).click()
  const drawer = page.getByRole('dialog')
  const stages = drawer.getByRole('group', { name: 'Move to stage' })
  await stages.getByRole('button', { name: 'Signed' }).click()
  // The current stage has no button: Signed's disappears once the move is saved.
  await expect(stages.getByRole('button', { name: 'Signed' })).toHaveCount(0)
  await stages.getByRole('button', { name: 'Paid' }).click()
  await expect(stages.getByRole('button', { name: 'Paid' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await settle(page)

  const stats = (await apiCall(page, 'GET', '/events/EV-1003/stats')).body
  expect(stats.sponsorship_income).toBe(before + 5000)
  const roi = Math.round(((stats.won_value + stats.sponsorship_income - stats.actual_cost) / stats.actual_cost) * 1000) / 1000
  expect(stats.roi).toBeCloseTo(roi, 3)
  await settle(page)
  await page.goto('/events/EV-1003?tab=leads')
  await expect(page.getByText(/sponsorship − actual cost/)).toBeVisible()
  // What the overview shows is the same stats function (re-read after the navigation).
  const shown = (await apiCall(page, 'GET', '/events/EV-1003/stats')).body
  expect(shown.sponsorship_income).toBe(before + 5000)
  await expect(page.getByRole('region', { name: 'Return on investment' }).getByText(`${Math.round(shown.roi * 100)}%`, { exact: true })).toBeVisible()

  // The package is sold out now: signing the second sponsor is refused (UI message + API 409).
  await page.goto('/events/EV-1003?tab=sponsors')
  await expect(page.getByRole('list', { name: 'Sponsorship packages' }).getByText('Sold out').first()).toBeVisible()
  await page.getByRole('button', { name: `Oryx Sponsor ${tag}` }).click()
  await page.getByRole('dialog').getByRole('group', { name: 'Move to stage' }).getByRole('button', { name: 'Signed' }).click()
  await expect(page.getByText(/is sold out/).first()).toBeVisible()
  const refused = await apiCall(page, 'POST', `/events/EV-1003/sponsors/${second.body.id}/stage`, { stage: 'signed' })
  expect(refused.status).toBe(409)
  expect(refused.body.code).toBe('sold_out')
  await settle(page)
})

test('logistics: a trip with a visa → a travel line on the budget, the number masked; a deadline on the deadlines list', async ({ page }) => {
  test.setTimeout(120_000)
  const tag = Date.now().toString(36)
  await signInAs(page, 'u7')
  await page.goto('/events/EV-1101?tab=logistics')
  await expect(page.getByRole('heading', { name: 'CES 2027' })).toBeVisible()

  await page.getByRole('button', { name: 'Add trip' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Traveller').selectOption({ label: 'Hassan Qureshi' })
  await dialog.getByLabel('From').fill('DXB')
  await dialog.getByLabel('To', { exact: true }).fill('LAS')
  await dialog.getByLabel('Flight cost').fill('4200')
  await dialog.getByLabel('Hotel cost').fill('1800')
  await dialog.getByLabel('Visa required').check()
  await dialog.getByLabel('Visa / document number').fill('X98765432')
  await dialog.getByRole('button', { name: 'Add trip' }).click()
  await expect(dialog).toBeHidden()
  const row = page.getByRole('row').filter({ hasText: 'Hassan Qureshi' })
  await expect(row.getByText('•••• 5432')).toBeVisible()
  await expect(page.getByText('X98765432')).toHaveCount(0)

  // The trip's total is on the budget as a travel line (kept in step by the trip).
  await page.goto('/events/EV-1101?tab=budget')
  const line = page.getByRole('row').filter({ hasText: 'Trip · Hassan Qureshi' })
  await expect(line).toBeVisible()
  await expect(line.getByText('From a trip')).toBeVisible()
  await expect(line.getByText(/6,000/).first()).toBeVisible()
  const logistics = await apiCall(page, 'GET', '/events/EV-1101/logistics')
  expect(JSON.stringify(logistics.body)).not.toContain('98765432')

  // A deadline through the cross-event page shows on the deadlines list.
  await page.goto('/events/logistics?tab=deadlines')
  await expect(page.getByRole('heading', { name: 'Travel & logistics' })).toBeVisible()
  await page.getByRole('button', { name: 'Add deadline' }).click()
  const dl = page.getByRole('dialog')
  await dl.getByLabel('Event').selectOption({ label: 'CES 2027' })
  await dl.getByLabel('Deadline').fill(`Booth power order ${tag}`)
  await dl.getByLabel('Due date').fill('2027-01-02')
  await dl.getByRole('button', { name: 'Add deadline' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: `Booth power order ${tag}` })).toBeVisible()
  await settle(page)
})
