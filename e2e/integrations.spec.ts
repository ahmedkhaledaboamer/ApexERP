import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Insights & admin › Integrations end to end (Apex):
 *   - the Company Admin (u1) configures SMTP, sends a test email and finds it in the email log;
 *   - copies a lead form's embed snippet;
 *   - creates an API key (shown once), sees it masked, revokes it (the public API then answers 401);
 *   - sends a WhatsApp template from a lead and sees the WhatsApp activity;
 *   - a sales rep (u5) connects their own calendar from Tasks › Calendar.
 */

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function apiCall(page: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return page.evaluate(
    async ({ m, p, b, h }) => {
      const raw = localStorage.getItem('apexcrm.session')
      const token = raw ? (JSON.parse(raw) as { token?: string }).token : ''
      const r = await fetch(`/api${p}`, { method: m, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...h }, body: b === undefined ? undefined : JSON.stringify(b) })
      return { status: r.status, body: await r.json() }
    },
    { m: method, p: path, b: body, h: headers },
  )
}

async function openConnector(page: Page, key: string, name: string) {
  await page.goto('/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()
  await page.locator(`[data-integration="${key}"]`).getByRole('button', { name: new RegExp(`^(Connect|Configure|View) ${name}$`) }).click()
  const drawer = page.getByRole('dialog', { name })
  await expect(drawer).toBeVisible()
  return drawer
}

test('admin configures SMTP, sends a test email and sees it in the email log', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u1')
  const drawer = await openConnector(page, 'email', 'Email sending')
  await expect(drawer.getByTestId('email-connected-as')).toHaveText('sales@apexaora.ae')
  await drawer.getByRole('radio', { name: 'SMTP server' }).click()
  await drawer.locator('#smtp-host').fill('smtp.apexaora.ae')
  await drawer.locator('#smtp-port').fill('587')
  await drawer.locator('#smtp-user').fill('mailer@apexaora.ae')
  await drawer.locator('#smtp-password').fill('E2E-smtp-password-1')
  await drawer.locator('#smtp-from-name').fill('Apex Aora')
  await drawer.locator('#smtp-from').fill('mailer@apexaora.ae')
  await drawer.getByRole('button', { name: 'Save SMTP' }).click()
  await expect(drawer.getByTestId('email-connected-as')).toHaveText('mailer@apexaora.ae')
  // Write-only: the password is never on the page again, only its hint.
  await expect(drawer).toContainText('•••• rd-1')
  await expect(drawer.locator('#smtp-password')).toHaveValue('')
  await drawer.locator('#test-to').fill('omar@apexaora.ae')
  await drawer.getByRole('button', { name: 'Send test' }).click()
  await expect(page.getByText('Test email sent')).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('tab', { name: 'Email log' }).click()
  const log = page.getByRole('table', { name: 'Email log' })
  await expect(log.getByRole('row').filter({ hasText: 'Test email' }).first()).toContainText('omar@apexaora.ae')
  const sync = await apiCall(page, 'GET', '/integrations/sync-log?integration=email')
  expect(sync.body[0].message).toContain('Test email sent to omar@apexaora.ae')
  expect(JSON.stringify(sync.body)).not.toContain('E2E-smtp-password-1')
})

test('admin copies a lead form embed snippet', async ({ page, context }) => {
  test.setTimeout(90_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signInAs(page, 'u1')
  const drawer = await openConnector(page, 'website', 'Website & forms')
  const modal = page.getByRole('dialog', { name: 'Embed “Website contact form”' })
  // The drawer may still be sliding in: retry the click until the snippet dialog is up.
  await expect(async () => {
    await drawer.getByRole('button', { name: 'Embed Website contact form' }).click()
    await expect(modal).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20_000 })
  await expect(modal.getByTestId('embed-iframe')).toContainText('<iframe src=')
  await modal.getByRole('button', { name: 'Copy' }).nth(1).click()
  await expect(modal.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^<iframe src="[^"]+\/f\/[^"]+\?embed=1"/)
  // Escape closes only the top layer: the snippet dialog, not the drawer under it.
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('admin creates an API key (shown once) and revokes it', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAs(page, 'u1')
  const drawer = await openConnector(page, 'api', 'API keys')
  await drawer.getByRole('button', { name: 'Create key' }).click()
  const create = page.getByRole('dialog', { name: 'Create API key' })
  await create.locator('#key-name').fill('E2E warehouse sync')
  await create.locator('#scope-leads').selectOption('read')
  await create.getByRole('button', { name: 'Create key' }).click()
  const shown = page.getByRole('dialog', { name: 'Copy your API key now' })
  const secret = (await shown.getByTestId('new-api-key').textContent())!.trim()
  expect(secret).toMatch(/^apx_live_[A-Za-z0-9]{32}$/)
  // The key works on the public API.
  expect((await apiCall(page, 'GET', '/public/v1/leads', undefined, { 'X-Api-Key': secret })).status).toBe(200)
  await shown.getByRole('button', { name: 'Done' }).click()
  const row = drawer.getByTestId('api-key-E2E warehouse sync')
  await expect(row).toContainText(secret.slice(-4))
  await expect(row).not.toContainText(secret)
  // Shown once: the list never carries it again.
  expect(JSON.stringify((await apiCall(page, 'GET', '/integrations/api-keys')).body)).not.toContain(secret)
  await row.getByRole('button', { name: 'Revoke' }).click()
  await expect(row).toContainText('Revoked')
  expect((await apiCall(page, 'GET', '/public/v1/leads', undefined, { 'X-Api-Key': secret })).status).toBe(401)
})

test('admin sends a WhatsApp template from a lead and sees the activity', async ({ page }) => {
  test.setTimeout(120_000)
  await signInAs(page, 'u1')
  const leads = (await apiCall(page, 'GET', '/leads')).body as { id: string; status_id: string; phone: string; do_not_contact: boolean }[]
  const lead = leads.find((l) => !l.do_not_contact && /^\+9715/.test((l.phone ?? '').replace(/\s/g, '')) && !['Won', 'Lost', 'Not interested'].includes(l.status_id))!
  await page.goto(`/leads/${lead.id}`)
  await page.getByRole('button', { name: 'WhatsApp template' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send a WhatsApp template' })
  await dialog.locator('#wa-template').selectOption({ label: 'meeting_reminder (English)' })
  await dialog.locator('#wa-param-1').fill('Sara')
  await dialog.locator('#wa-param-2').fill('Tuesday 11:00')
  await expect(dialog.getByTestId('wa-preview')).toHaveText('Hi Sara, a reminder of our meeting on Tuesday 11:00. Reply YES to confirm or call us to reschedule.')
  await dialog.getByRole('button', { name: 'Send' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/WhatsApp template “meeting_reminder” to .*Hi Sara, a reminder/).first()).toBeVisible()
  const acts = (await apiCall(page, 'GET', `/leads/${lead.id}/activities`)).body as { type: string; summary: string }[]
  expect(acts.some((a) => a.type === 'whatsapp' && a.summary.includes('meeting_reminder'))).toBe(true)
})

test('a sales rep connects their own calendar from Tasks › Calendar', async ({ page }) => {
  test.setTimeout(90_000)
  await signInAs(page, 'u5')
  await page.goto('/tasks/calendar')
  await page.getByRole('button', { name: 'Connect calendar' }).click()
  const modal = page.getByRole('dialog', { name: 'Calendar sync' })
  await modal.getByRole('button', { name: 'Connect Google Calendar' }).click()
  const consent = page.getByRole('dialog', { name: 'Sign in with Google' })
  await expect(consent.getByTestId('oauth-account')).toHaveText('ahmed@apexaora.ae')
  await consent.getByRole('button', { name: 'Allow' }).click()
  await expect(page.getByTestId('calendar-connected-as')).toHaveText('ahmed@apexaora.ae')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.locator('[aria-live="polite"]').getByText('Calendar synced')).toBeVisible()
  const me = await apiCall(page, 'GET', '/integrations/calendar/me')
  expect(me.body).toMatchObject({ status: 'connected', provider: 'google', connected_as: 'ahmed@apexaora.ae' })
  expect(JSON.stringify(me.body)).not.toMatch(/ya29\./)
})
