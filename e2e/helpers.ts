import type { Page } from '@playwright/test'

/** Signs in as a seeded user through the mock's dev sign-in (no password), on that workspace. */
export async function signInAs(page: Page, userId: string, workspace = 'apexaora'): Promise<void> {
  await page.goto(`/login?workspace=${workspace}`)
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (id) => {
    const r = await fetch('/api/auth/dev/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) })
    if (!r.ok) throw new Error(`dev sign-in failed: ${r.status}`)
    localStorage.setItem('apexcrm.session', JSON.stringify(await r.json()))
  }, userId)
}

/** The board column (section) for a stage label, e.g. "Interested". */
export function column(page: Page, label: string) {
  return page.locator(`section[aria-label^="${label}, "]`)
}

/** A lead card on the board by its id (the card shows the id, e.g. "L-1016"). */
export function card(page: Page, leadId: string) {
  return page.locator('[aria-roledescription="draggable"]').filter({ hasText: leadId })
}

/** Mouse drag with intermediate moves (dnd-kit needs pointer moves past its 6px activation distance). */
export async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 20 })
  await page.mouse.move(to.x + 2, to.y + 2, { steps: 2 })
  await page.mouse.up()
}

export async function centerOf(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element not visible')
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 60) }
}
