import type { Role, Session, User } from '@/shared/types'
import type { LoginResult } from '@/modules/auth/types'
import type { Company, ImpersonationInfo, PlatformSession, PlatformUser, PublicCompany, TenantSummary } from '@/modules/tenancy/types'
import { canPlatform } from '@/modules/tenancy/types'
import { ApiError } from '@/shared/lib/apiError'
import { leads, users } from '@/shared/mocks/db'
import { passwordMatches } from '@/shared/mocks/data/passwords'
import { loginChallenges } from '@/shared/mocks/data/security'
import { checkSecondFactor } from '@/shared/mocks/services/security'
import type { ImpersonationSessionRecord } from '@/modules/platform/types'
import { recordAudit } from '@/shared/mocks/data/audit'
import { activeMembershipOf, companies, companyById, platformUsers, toPublicCompany } from '@/shared/mocks/data/tenancy'
import { resolveWorkspace } from '@/shared/mocks/data/platform'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { CodedApiError } from '@/shared/mocks/tenant'
import { assertNotDeleted, runLifecycle } from '@/shared/mocks/services/billing'
import { createImpersonationSession, enableWriteMode, infoOf, reasonOk, stopImpersonationSession } from '@/shared/mocks/services/impersonation'
import type { PlatformCtx } from '@/shared/mocks/services/platformAudit'
import { scoped } from '@/shared/mocks/tenant'
import { delay, platformTokenFor, tokenFor } from '@/shared/mocks/server'

const CHALLENGE_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 5
const DEACTIVATED = 'This account is deactivated.'
const BAD_CREDENTIALS = 'That email and password don’t match an account.'

function workspaceNotFound(): never {
  throw new CodedApiError('We couldn’t find that workspace. Check the address.', 404, 'workspace_not_found')
}

/** The company a user may sign in to (their active membership), checked for status. */
function companyFor(user: User): Company {
  const membership = activeMembershipOf(user.id)
  const company = membership && companyById(membership.companyId)
  if (!company) throw new ApiError('This account has no active workspace.', 403)
  if (company.status === 'suspended') throw new CodedApiError('This workspace is suspended. Contact your administrator.', 403, 'workspace_suspended')
  // Billing: runs the subscription lifecycle; a deleted workspace can't be signed in to (410 workspace_deleted).
  assertNotDeleted(company.id)
  user.companyId = company.id
  user.role = membership.role
  return company
}

function startSession(user: User, imp: ImpersonationInfo | null = null): Promise<Session> {
  const tenant = companyFor(user)
  if (!imp) user.lastLoginAt = new Date().toISOString()
  return delay({ token: tokenFor(user, imp), user, tenant, impersonation: imp })
}

/**
 * Finds the account for a sign-in. On a workspace address the email is looked up inside that
 * company only (emails are unique per company, not globally). Without one (bare domain, dev),
 * the email must identify exactly one account.
 */
function accountFor(email: string, workspace?: string | null): User | undefined {
  const e = String(email ?? '').trim().toLowerCase()
  if (workspace) {
    // A still-redirecting old subdomain signs in to its company too.
    const company = resolveWorkspace(workspace)?.company ?? workspaceNotFound()
    return users.find((u) => u.companyId === company.id && u.email.toLowerCase() === e)
  }
  const matches = users.filter((u) => u.email.toLowerCase() === e)
  if (matches.length > 1) {
    throw new CodedApiError('This email is used in more than one workspace. Open your workspace’s address to sign in.', 409, 'workspace_required')
  }
  return matches[0]
}

/** Password check. Users with 2FA get a challenge instead of a session (finish with `loginTwoFactor`). */
export async function login(email: string, password: string, workspace?: string | null): Promise<LoginResult> {
  const user = accountFor(email, workspace)
  if (!user || !passwordMatches(user.id, password)) {
    await delay(null)
    throw new ApiError(BAD_CREDENTIALS, 401)
  }
  if (!user.active) {
    await delay(null)
    throw new ApiError(DEACTIVATED, 403)
  }
  companyFor(user)
  if (user.twoFactorEnabled) {
    const challengeId = `ch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    loginChallenges.set(challengeId, { userId: user.id, expiresAt: Date.now() + CHALLENGE_TTL_MS, attempts: 0 })
    return delay({ twoFactorRequired: true as const, challengeId })
  }
  return startSession(user)
}

/** Second step: a 6-digit code (or an unused recovery code) for a challenge from `login`. */
export async function loginTwoFactor(challengeId: string, code: string): Promise<Session> {
  const challenge = loginChallenges.get(String(challengeId ?? ''))
  if (!challenge || challenge.expiresAt < Date.now()) {
    loginChallenges.delete(String(challengeId ?? ''))
    await delay(null)
    throw new ApiError('This sign-in has expired. Enter your password again.', 410)
  }
  const user = users.find((u) => u.id === challenge.userId)
  if (!user) throw new ApiError('Account not found.', 404)
  if (!user.active) {
    loginChallenges.delete(challengeId)
    await delay(null)
    throw new ApiError(DEACTIVATED, 403)
  }
  const kind = checkSecondFactor(user.id, code)
  if (!kind) {
    challenge.attempts += 1
    await delay(null)
    if (challenge.attempts >= MAX_ATTEMPTS) {
      loginChallenges.delete(challengeId)
      throw new ApiError('Too many wrong codes. Enter your password again.', 429)
    }
    throw new ApiError('That code didn’t match. Try the newest code from your app.', 401)
  }
  loginChallenges.delete(challengeId)
  if (kind === 'recovery') {
    recordAudit(user, {
      action: 'security',
      entity: 'security',
      entityId: '2fa',
      summary: `${user.name} signed in with a recovery code`,
      changes: [],
    })
  }
  return startSession(user)
}

/** The signed-in user's tenant (GET /tenant). */
export async function getTenant(user: User): Promise<Company> {
  return delay(companyFor(user))
}

/**
 * Public branding for a workspace address, shown on its login page (GET /public/workspaces/:subdomain).
 * An old subdomain that is still redirecting (changed by the platform) answers the company with
 * `redirectTo: <current subdomain>`; after the redirect period it is 404 like any unknown address.
 */
export async function getPublicWorkspace(subdomain: string): Promise<PublicCompany> {
  const found = resolveWorkspace(String(subdomain ?? ''))
  if (!found) {
    await delay(null)
    workspaceNotFound()
  }
  const pub = toPublicCompany(found.company)
  return delay(found.alias ? { ...pub, redirectTo: found.company.subdomain } : pub)
}

/* ---------------- Dev-only helpers (the mock only; a real backend has no such endpoints) ---------------- */

/** The seeded user who represents a role in the caller's company (role switcher). */
function demoUserFor(companyId: string, role: Role): User | undefined {
  return users.find((u) => u.companyId === companyId && u.role === role && u.active)
}

/** Role switcher: signs in as the seeded user for a role in the same company (skips 2FA). */
export async function switchRole(current: User, role: Role): Promise<Session> {
  const user = demoUserFor(current.companyId, role)
  if (!user) throw new ApiError(`No demo user with the ${role} role in this workspace.`, 404)
  return startSession(user)
}

/** Dev tenant switcher: every seeded account, grouped by company, to sign in as (skips password and 2FA). */
export async function getDevAccounts(): Promise<{ company: PublicCompany; users: Pick<User, 'id' | 'name' | 'role' | 'email'>[] }[]> {
  return delay(
    companies.map((c) => ({
      company: toPublicCompany(c),
      users: users.filter((u) => u.companyId === c.id && u.active).map(({ id, name, role, email }) => ({ id, name, role, email })),
    })),
  )
}

export async function devSignInAs(userId: string): Promise<Session> {
  const user = users.find((u) => u.id === userId)
  if (!user) throw new ApiError('Account not found.', 404)
  if (!user.active) throw new ApiError(DEACTIVATED, 403)
  return startSession(user)
}

/** Synchronous session for a role in Apex Aora, used to start a screen already signed in. */
export function demoSessionFor(role: Role): Session {
  const user = demoUserFor('co_apex', role) ?? users[0]
  const tenant = companyFor(user)
  return { token: tokenFor(user), user: { ...user }, tenant, impersonation: null }
}

/** Users of the caller's company only. */
export async function getUsers(user: User): Promise<User[]> {
  return delay(scoped(users, user))
}

/* ---------------- Platform console (separate permission set; no tenant data except by impersonation) ---------------- */

/** Legacy helper: the platform user of a platform token (401 otherwise). New handlers use requirePlatform (handlers/utils.ts). */
export function platformUserFrom(authorization: string | null, readClaims: (h: string | null) => { kind: string; sub: string } | null): PlatformUser {
  const claims = readClaims(authorization)
  const pu = claims?.kind === 'platform' ? platformUsers.find((p) => p.id === claims.sub) : undefined
  if (!pu) throw new ApiError('Sign in to the platform console.', 401)
  return pu
}

export async function platformLogin(email: string, password: string): Promise<PlatformSession> {
  const pu = platformUsers.find((p) => p.email === String(email ?? '').trim().toLowerCase())
  if (!pu || !passwordMatches(pu.id, password)) {
    await delay(null)
    throw new ApiError(BAD_CREDENTIALS, 401)
  }
  return delay({ kind: 'platform' as const, token: platformTokenFor(pu.id), platformUser: pu })
}

export async function listTenants(pu: PlatformUser): Promise<TenantSummary[]> {
  if (!canPlatform(pu.platformRole, 'tenants:view')) throw new ApiError('Not allowed for your platform role.', 403)
  return delay(
    companies.map((c) => ({
      ...c,
      users: users.filter((u) => u.companyId === c.id).length,
      leads: leads.filter((l) => (l as { companyId?: string }).companyId === c.id).length,
    })),
  )
}

/** Legacy PATCH /platform/tenants/:id (operator lock). The console uses POST /platform/companies/:id/actions. */
export async function setTenantStatus(pu: PlatformUser, companyId: string, status: Company['status']): Promise<Company> {
  if (!canPlatform(pu.platformRole, 'tenants:manage')) throw new ApiError('Only the Platform Owner can change a workspace’s status.', 403)
  const company = companyById(companyId)
  if (!company) throw new ApiError('Workspace not found.', 404)
  if (!['active', 'trial', 'suspended'].includes(status)) throw new ApiError('Unknown status.', 422)
  company.status = status
  return delay(company)
}

/** Users of one tenant, for picking whom to impersonate (no secrets). */
export async function tenantUsersForPlatform(pu: PlatformUser, companyId: string): Promise<Pick<User, 'id' | 'name' | 'role' | 'email' | 'active'>[]> {
  if (!canPlatform(pu.platformRole, 'support:impersonate')) throw new ApiError('Not allowed for your platform role.', 403)
  if (!companyById(companyId)) throw new ApiError('Workspace not found.', 404)
  return delay(users.filter((u) => u.companyId === companyId).map(({ id, name, role, email, active }) => ({ id, name, role, email, active })))
}

/**
 * POST /platform/impersonations { userId, reason } — starts a support session as a company user.
 * Reason ≥ 10 characters (422 reason_required); a deactivated user, a locked (operator-suspended) or
 * deleted company → 409. Read-only until write mode is confirmed; expires after impersonationMinutes.
 * Audited in the platform log and the company's audit log.
 */
export async function startImpersonation(ctx: PlatformCtx, userId: string, reason: unknown): Promise<Session> {
  if (!canPlatform(ctx.user.platformRole, 'support:impersonate')) throw new ApiError('Only Platform Owner and Platform Support can impersonate.', 403)
  if (!reasonOk(reason, 10)) {
    throw new CodedApiError('Give a reason of at least 10 characters. The company admin sees it in their audit log.', 422, 'reason_required', { min: 10 })
  }
  const user = users.find((u) => u.id === String(userId ?? ''))
  if (!user) throw new ApiError('Account not found.', 404)
  if (!user.active) throw new CodedApiError('This user is deactivated and can’t be impersonated.', 409, 'user_deactivated')
  const membership = activeMembershipOf(user.id)
  const company = membership && companyById(membership.companyId)
  if (!company) throw new ApiError('This account has no active workspace.', 409)
  if (company.status === 'suspended') throw new CodedApiError('This workspace is locked. Reactivate it before opening a support session.', 409, 'company_locked')
  runLifecycle(company.id)
  if (subscriptionOf(company.id)?.status === 'deleted') throw new CodedApiError('This workspace has been deleted.', 409, 'company_deleted')
  user.companyId = company.id
  const rec = createImpersonationSession(ctx, user, reason)
  return startSession(user, infoOf(rec))
}

/** POST /auth/impersonation/stop — ends the session (audited in both logs). */
export async function stopImpersonation(rec: ImpersonationSessionRecord | null): Promise<{ ok: true }> {
  if (rec) stopImpersonationSession(rec)
  return delay({ ok: true as const })
}

/** POST /auth/impersonation/write-mode { confirm: true } — impersonation token only. Returns the refreshed Session. */
export async function impersonationWriteMode(user: User, rec: ImpersonationSessionRecord | null, input: { confirm?: unknown } | null): Promise<Session> {
  if (!rec) throw new CodedApiError('This is not a support session.', 403, 'not_impersonating')
  enableWriteMode(rec, input)
  const tenant = companyById(user.companyId)!
  const imp = infoOf(rec)
  return delay({ token: tokenFor(user, imp), user, tenant, impersonation: imp })
}
