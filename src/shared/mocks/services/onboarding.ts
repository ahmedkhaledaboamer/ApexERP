import type { User } from '@/shared/types'
import type { EmailConnection, EmailProvider, OnboardingItem, OnboardingItemId, OnboardingState } from '@/modules/onboarding/types'
import { isProfileComplete } from '@/modules/settings/companyProfile'
import { canEditCompanyProfile, canViewCompanyProfile } from '@/shared/lib/permissions'
import { leads, users } from '@/shared/mocks/db'
import { services } from '@/shared/mocks/data/services'
import { companyById, memberships } from '@/shared/mocks/data/tenancy'
import { emailConnections, onboardingProgress } from '@/shared/mocks/data/onboarding'
import { recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { tenantOf } from '@/shared/mocks/tenant'

/**
 * Getting-started checklist for a new company (GET /onboarding). Data items are computed from the
 * caller's company; manual items (review lists & rules) are marked done explicitly. Progress and
 * dismissal are stored per company, so every admin of the company sees the same state.
 * Company Admin writes; Management reads; other roles 403.
 */

const MANUAL: OnboardingItemId[] = ['lists']
const ITEM_IDS: OnboardingItemId[] = ['profile', 'team', 'lists', 'services', 'leads', 'email']

function state(companyId: string): OnboardingState {
  const company = companyById(companyId)
  const progress = onboardingProgress.get(companyId)
  const activeUsers = users.filter((u) => u.companyId === companyId && u.active).length
  const pendingInvite = memberships.some((m) => m.companyId === companyId && m.status === 'invited')
  const done = (id: OnboardingItemId) => progress.manualDone.includes(id)

  const items: OnboardingItem[] = [
    {
      id: 'profile',
      title: 'Complete your company profile',
      description: 'Legal name, address, phone, email and tax number print on every quotation.',
      href: '/settings/company-profile',
      done: company ? isProfileComplete(company.profile) : false,
      manual: false,
    },
    {
      id: 'team',
      title: 'Invite your team',
      description: 'Add at least one more person so work can be assigned and followed up.',
      href: '/settings/users',
      done: activeUsers >= 2 || pendingInvite,
      manual: false,
    },
    {
      id: 'lists',
      title: 'Review lists and workflow rules',
      description: 'Check the statuses, sources, industries and automation rules match how you sell.',
      href: '/settings/lists',
      done: done('lists'),
      manual: true,
    },
    {
      id: 'services',
      title: 'Add your services',
      description: 'List what you sell so quotations and projects can use it.',
      href: '/services',
      done: services.some((s) => s.companyId === companyId && s.active),
      manual: false,
    },
    {
      id: 'leads',
      title: 'Add your first lead',
      description: 'Start the pipeline with a company you’re talking to.',
      href: '/leads/new',
      done: leads.some((l) => l.companyId === companyId),
      manual: false,
    },
    {
      id: 'email',
      title: 'Connect email',
      description: 'Connect a mailbox so emails to leads are sent from your address.',
      href: '/settings/email',
      done: emailConnections.get(companyId) !== null,
      manual: true,
    },
  ]
  const count = items.filter((i) => i.done).length
  return { items, done: count, total: items.length, complete: count === items.length, dismissed: progress.dismissed }
}

export async function getOnboarding(user: User): Promise<OnboardingState> {
  if (!canViewCompanyProfile(user.role)) return fail('The setup checklist is for admins.', 403)
  return delay(state(tenantOf(user)))
}

function writer(user: User): Promise<never> | null {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can change the setup checklist.', 403)
  return null
}

/**
 * POST /onboarding/items/:id/complete (done = true) or PATCH /onboarding/items/:id { done }.
 * Manual items only; data items complete themselves and "Connect email" needs a connection.
 */
export async function setOnboardingItem(user: User, id: string, done = true): Promise<OnboardingState> {
  const denied = writer(user)
  if (denied) return denied
  const companyId = tenantOf(user)
  if (!(ITEM_IDS as string[]).includes(id)) return fail('Not found.', 404)
  if (!(MANUAL as string[]).includes(id)) {
    return fail(id === 'email' ? 'Connect a mailbox to finish this step.' : 'This step completes itself when it’s done.', 422)
  }
  const progress = onboardingProgress.get(companyId)
  const item = id as OnboardingItemId
  progress.manualDone = progress.manualDone.filter((x) => x !== item)
  if (done) progress.manualDone.push(item)
  return delay(state(companyId))
}

/** POST /onboarding/dismiss, POST /onboarding/restore, or PATCH /onboarding { dismissed }. */
export async function setOnboardingDismissed(user: User, dismissed: boolean): Promise<OnboardingState> {
  const denied = writer(user)
  if (denied) return denied
  const companyId = tenantOf(user)
  onboardingProgress.get(companyId).dismissed = dismissed
  return delay(state(companyId))
}

/* ---------------- Mocked email connection (Company Admin only) ---------------- */

const PROVIDERS: EmailProvider[] = ['google', 'microsoft', 'smtp']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function getEmailConnection(user: User): Promise<EmailConnection | null> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can manage the email connection.', 403)
  return delay(emailConnections.get(tenantOf(user)))
}

/** POST /settings/email-connection { provider, address } */
export async function connectEmail(user: User, input: { provider?: unknown; address?: unknown } | null): Promise<EmailConnection> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can manage the email connection.', 403)
  const provider = input?.provider as EmailProvider
  if (!PROVIDERS.includes(provider)) return fail('Choose Google, Microsoft or SMTP.', 422)
  const address = String(input?.address ?? '').trim().toLowerCase()
  if (!EMAIL.test(address)) return fail('Enter a valid email address.', 422)
  const companyId = tenantOf(user)
  const connection: EmailConnection = { provider, address, connectedAt: new Date().toISOString(), connectedBy: user.name }
  emailConnections.set(companyId, connection)
  recordAudit(user, { action: 'update', entity: 'email-connection', entityId: provider, summary: `Connected the mailbox ${address} (${provider})` })
  return delay(connection)
}

/** DELETE /settings/email-connection */
export async function disconnectEmail(user: User): Promise<null> {
  if (!canEditCompanyProfile(user.role)) return fail('Only a Company Admin can manage the email connection.', 403)
  const companyId = tenantOf(user)
  const current = emailConnections.get(companyId)
  emailConnections.set(companyId, null)
  if (current) recordAudit(user, { action: 'update', entity: 'email-connection', entityId: current.provider, summary: `Disconnected the mailbox ${current.address}` })
  return delay(null)
}
