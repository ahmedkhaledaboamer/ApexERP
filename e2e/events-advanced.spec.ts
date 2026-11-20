import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Advanced Events features end to end (Apex, Enterprise plan), as Sara Khoury (Marketing Manager):
 * apply a template → checklist; public registration with a ticket type + custom question → waitlist when
 * full → cancelling promotes; check-in by code; booth capture → hot lead; completing the event → follow-up
 * tasks; a feedback survey → NPS on the Feedback tab.
 */

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** A call through the app's own session (the mock API is the contract). */
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

/** The mock DB saves to IndexedDB on a debounce: let it settle before a full navigation. */
const settle = (page: Page) => page.waitForTimeout(800)

test('templates, tickets + waitlist, check-in, booth capture, follow-up tasks and the survey', async ({ page }) => {
  test.setTimeout(120_000)
  const name = `E2E Summit ${Date.now().toString(36)}`
  await signInAs(page, 'u7')
  await page.goto('/events')
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible()

  // An all-day event today (company time) with one seat, a ticket type and a required question.
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date()))
  const created = await apiCall(page, 'POST', '/events', {
    name,
    type: 'meeting',
    start_date: today,
    registration_open: true,
    capacity: 1,
    team_ids: ['u5'],
    questions: [{ label: 'Dietary requirements', type: 'single', options: ['None', 'Vegetarian'], required: true }],
  })
  expect(created.status).toBe(200)
  const id = created.body.id as string
  expect((await apiCall(page, 'POST', `/events/${id}/ticket-types`, { name: 'Standard', capacity: 1 })).status).toBe(200)
  const token = (await apiCall(page, 'GET', `/events/${id}`)).body.registration_token as string
  await settle(page)

  // 1. Apply a template → checklist tasks.
  await page.goto(`/events/${id}?tab=checklist`)
  await page.getByLabel('Event template').selectOption({ label: 'Breakfast briefing (4 tasks)' })
  await page.getByRole('button', { name: 'Apply template' }).click()
  await expect(page.getByRole('list', { name: 'Checklist' }).getByRole('listitem')).toHaveCount(4)
  await expect(page.getByText('0 of 4 done')).toBeVisible()
  await page.getByRole('button', { name: /Mark Confirm venue, menu and AV done/ }).click()
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  await settle(page)

  // 2. Public registration with a ticket and the custom question; the second visitor is waitlisted.
  const register = async (person: string, mail: string) => {
    await page.goto(`/e/${token}`)
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
    await page.getByLabel('Full name').fill(person)
    await page.getByLabel('Work email').fill(mail)
    await page.getByRole('radio', { name: /Standard/ }).check()
    await page.getByRole('radio', { name: 'Vegetarian' }).check()
    await page.getByRole('button', { name: 'Register' }).click()
  }
  const stamp = Date.now().toString(36)
  await register('Lina Haddad', `lina-${stamp}@guests.ae`)
  await expect(page.getByRole('status')).toContainText('You’re registered')
  await expect(page.getByTestId('ticket-code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  await settle(page)
  await register('Omar Saleh', `omar-${stamp}@guests.ae`)
  await expect(page.getByRole('status')).toContainText('waitlist')
  await expect(page.getByRole('status')).toContainText('number 1 on the waitlist')
  await settle(page)

  // Cancelling Lina's registration promotes Omar.
  await page.goto(`/events/${id}?tab=attendees`)
  const omarRow = page.getByRole('row').filter({ hasText: 'Omar Saleh' })
  await expect(omarRow.getByText('Waitlist #1')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Dietary requirements' })).toBeVisible()
  await page.getByRole('row').filter({ hasText: 'Lina Haddad' }).getByRole('button', { name: 'Cancel the registration of Lina Haddad' }).click()
  await expect(page.getByText('From the waitlist: Omar Saleh')).toBeVisible()
  await expect(omarRow.getByText('Waitlist #1')).toHaveCount(0)
  const attendees = (await apiCall(page, 'GET', `/events/${id}/attendees`)).body as { name: string; status: string; ticket_code: string; survey_token: string; answers: Record<string, string> }[]
  const omar = attendees.find((a) => a.name === 'Omar Saleh')!
  expect(omar.status).toBe('registered')
  expect(Object.values(omar.answers)).toContain('Vegetarian')
  await settle(page)

  // 3. Check-in by code (typed / scanned); a second scan says when.
  await page.goto(`/events/${id}/check-in`)
  await page.getByRole('textbox', { name: 'Ticket code' }).fill(omar.ticket_code.toLowerCase())
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Omar Saleh')
  await expect(page.getByRole('status')).toContainText('Checked in.')
  await page.getByRole('textbox', { name: 'Ticket code' }).fill(omar.ticket_code)
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Already checked in at')
  await expect(page.getByRole('region', { name: 'Check-in counters' })).toContainText('100% of registered')
  await settle(page)

  // 4. Booth capture → a hot lead (source Event) right away.
  await page.goto(`/events/${id}/capture`)
  const visitor = `booth-${stamp}@prospects.ae`
  await page.getByLabel('Name').fill('Rami Nassar')
  await page.getByLabel('Company').fill('Nassar Hotels')
  await page.getByLabel('Email').fill(visitor)
  await page.getByRole('radio', { name: 'Hot' }).click()
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page.getByRole('list', { name: 'My captures' })).toContainText('Rami Nassar')
  const captures = (await apiCall(page, 'GET', `/events/${id}/captures`)).body as { email: string; rating: string; lead_id: string; lead_outcome: string }[]
  const cap = captures.find((c) => c.email === visitor)!
  expect(cap).toMatchObject({ rating: 'hot', lead_outcome: 'created' })
  const lead = await apiCall(page, 'GET', `/leads/${cap.lead_id}`)
  expect(lead.body).toMatchObject({ source_id: 'Event', event_id: id, company_name: 'Nassar Hotels' })
  await settle(page)

  // 5. Complete the event → one follow-up task per lead with a seat (Omar + the booth capture).
  await page.goto(`/events/${id}`)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Status').selectOption('completed')
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await page.getByRole('tab', { name: 'Activity' }).click()
  await expect(page.getByText(/Event completed: 2 follow-up tasks created/)).toBeVisible()
  await settle(page)

  // 6. The attendee's survey → NPS on the Feedback tab.
  await page.goto(`/s/${omar.survey_token}`)
  await expect(page.getByRole('heading', { name: `How was ${name}?` })).toBeVisible()
  await page.getByRole('radio', { name: '5 stars' }).click()
  await page.getByRole('radio', { name: '10 out of 10' }).click()
  await page.getByLabel('Anything else?').fill('Great breakfast')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByRole('status')).toContainText('Thank you for your feedback')
  await settle(page)
  await page.goto(`/events/${id}?tab=feedback`)
  const results = page.getByRole('region', { name: 'Survey results' })
  await expect(results.getByText('+100')).toBeVisible()
  await expect(page.getByText('Great breakfast')).toBeVisible()
})
