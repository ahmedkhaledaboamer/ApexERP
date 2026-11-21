import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * HR › Recruitment and Training end to end (Apex, Enterprise plan with HR, timezone Asia/Dubai):
 *  - the HR Manager (u9) opens a job, adds a candidate, moves them to interview, schedules an interview
 *    with herself on the panel and scores it, makes an offer, records it accepted → the new employee
 *    shows in Employees;
 *  - a course with a session today → an employee enrolled → marked completed → the certificate shows
 *    with its expiry (issue + 12 months);
 *  - an Employee (u11) sees only their own training.
 */

const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
const dubaiDay = (days = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() + days * 86_400_000))

test('recruitment: opening → candidate → interview → scorecard → offer accepted → employee', async ({ page }) => {
  const stamp = Date.now().toString(36)
  const TITLE = `Platform Engineer ${stamp}`
  const NAME = `Zara Okafor ${stamp}`
  await signInAs(page, 'u9')
  await page.goto('/hr/recruitment')
  await expect(page.getByRole('heading', { name: 'Recruitment' })).toBeVisible()

  await page.getByRole('button', { name: 'New opening' }).click()
  const op = dialog(page, 'New job opening')
  await op.getByLabel('Job title').fill(TITLE)
  await op.getByLabel('Department').selectOption({ label: 'Delivery' })
  await op.getByLabel('Salary from (monthly)').fill('18000')
  await op.getByLabel('Salary to').fill('22000')
  await op.getByRole('button', { name: 'Open position' }).click()
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()

  await page.getByRole('button', { name: 'Add candidate' }).click()
  const cd = dialog(page, 'Add candidate')
  await cd.getByLabel('Full name').fill(NAME)
  await cd.getByLabel('Email').fill(`zara.${stamp}@mailbox.test`)
  await cd.getByLabel('Mobile').fill('+44 7700 900777')
  await cd.getByRole('button', { name: 'Add candidate' }).click()
  await expect(cd).toBeHidden()

  await page.locator('button', { hasText: NAME }).first().click()
  const ap = page.getByRole('dialog', { name: NAME, exact: true })
  await ap.getByLabel('Stage').selectOption('interview')
  await ap.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(ap.getByText('Interview', { exact: true }).first()).toBeVisible()

  await ap.getByLabel('Interviewer').selectOption({ label: 'Mariam Saeed' })
  await ap.getByRole('button', { name: 'Schedule interview' }).click()
  await ap.getByRole('button', { name: 'Score interview' }).click()
  const sc = dialog(page, new RegExp(`Scorecard · ${NAME}`))
  for (const c of ['Skills', 'Experience', 'Communication', 'Culture fit']) await sc.getByRole('radio', { name: `${c} 5` }).click()
  await sc.getByRole('button', { name: 'Submit scorecard' }).click()
  await expect(sc).toBeHidden()
  await expect(ap.getByText(/Mariam Saeed: 5\.0/)).toBeVisible()

  await ap.getByLabel(/Monthly salary/).fill('21000')
  await ap.getByLabel('Start date').fill(dubaiDay(30))
  await ap.getByLabel('Offer expires').fill(dubaiDay(7))
  await ap.getByRole('button', { name: 'Create offer' }).click()
  await ap.getByRole('button', { name: 'Mark sent' }).click()
  await ap.getByRole('button', { name: 'Accepted' }).click()
  await expect(ap.getByText(/Employee EMP-/)).toBeVisible()

  await ap.getByRole('button', { name: 'Close' }).click()
  // In-app navigation (a full reload would restart the mock from its persisted copy).
  await page.getByRole('link', { name: 'Employees', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible()
  await expect(page.getByText(NAME).first()).toBeVisible()
})

test('training: course → session → enroll → completed → certificate with expiry', async ({ page }) => {
  const COURSE = `First aid at work ${Date.now().toString(36)}`
  await signInAs(page, 'u9')
  await page.goto('/hr/training')
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible()
  await page.getByRole('button', { name: 'New course' }).click()
  const form = dialog(page, 'New course')
  await form.getByLabel('Course title').fill(COURSE)
  await form.getByLabel('Certificate validity (months)').fill('12')
  await form.getByRole('button', { name: 'Create course' }).click()

  const course = dialog(page, COURSE)
  await expect(course).toBeVisible()
  await course.getByLabel('Location').fill('Dubai office, room 4')
  await course.getByRole('button', { name: 'Add session' }).click()
  await course.getByLabel('Enroll employee').selectOption({ label: 'Noura Al Ketbi' })
  await course.getByRole('button', { name: 'Enroll', exact: true }).click()
  await course.getByLabel('Status of Noura Al Ketbi').selectOption('completed')
  await expect(course.getByText('Completed', { exact: true }).first()).toBeVisible()
  await course.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('tab', { name: 'Certificates' }).click()
  const row = page.getByRole('table', { name: 'Certificates' }).getByRole('row').filter({ hasText: COURSE })
  await expect(row).toContainText('Noura Al Ketbi')
  const [y, m, d] = dubaiDay(0).split('-').map(Number)
  const expiry = new Date(Date.UTC(y + 1, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  await expect(row).toContainText(expiry)
  await expect(row).toContainText('Valid')
})

test('an employee sees only their own training', async ({ page }) => {
  await signInAs(page, 'u11')
  await page.goto('/hr/training')
  await expect(page.getByRole('heading', { name: 'Training' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'My training' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Courses' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Training matrix' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New course' })).toHaveCount(0)
  const certs = page.getByRole('table', { name: 'My certificates' })
  await expect(certs).toContainText('Fire safety & evacuation')
  await expect(page.getByText('Yusuf Rahman')).toHaveCount(0)
  // Recruitment: only the interviews she was invited to.
  await page.goto('/hr/recruitment')
  await expect(page.getByRole('tab', { name: 'My interviews' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Openings' })).toHaveCount(0)
  await expect(page.getByText('Ritika Menon')).toBeVisible()
})
