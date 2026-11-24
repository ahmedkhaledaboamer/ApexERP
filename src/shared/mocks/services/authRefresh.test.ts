import { describe, expect, it } from 'vitest'
import { users } from '@/shared/mocks/db'
import { devSignInAs, refreshSession } from '@/shared/mocks/services/auth'
import { ACCESS_TOKEN_TTL_MS, readToken } from '@/shared/mocks/server'
import { userFrom } from '@/shared/mocks/handlers/utils'
import { ApiError } from '@/shared/lib/apiError'

/** Mock contract for POST /auth/refresh and access-token expiry (docs/API.md › Auth › Refresh). */
const req = (token: string) => new Request('http://mock.local/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })

function errorOf(run: () => unknown): ApiError {
  try {
    run()
  } catch (e) {
    return e as ApiError
  }
  throw new Error('expected an error')
}

describe('mock session tokens', () => {
  it('a session carries a refresh token and an access-token expiry', async () => {
    const s = await devSignInAs('u1')
    expect(typeof s.refreshToken).toBe('string')
    const left = Date.parse(s.expiresAt!) - Date.now()
    expect(left).toBeGreaterThan(ACCESS_TOKEN_TTL_MS - 60_000)
    expect(left).toBeLessThanOrEqual(ACCESS_TOKEN_TTL_MS)
    expect(userFrom(req(s.token)).id).toBe('u1')
  })

  it('refresh issues new tokens for the same user and company', async () => {
    const s = await devSignInAs('u1')
    const r = await refreshSession(s.refreshToken)
    expect(r.user.id).toBe('u1')
    expect(r.tenant.id).toBe(s.tenant.id)
    expect(r.refreshToken).toBeTruthy()
    expect(userFrom(req(r.token)).id).toBe('u1')
  })

  it('a refresh token is never accepted as an access token, nor an access token as a refresh token', async () => {
    const s = await devSignInAs('u1')
    expect(readToken(`Bearer ${s.refreshToken}`)).toBeNull()
    expect(errorOf(() => userFrom(req(s.refreshToken!))).status).toBe(401)
    await expect(refreshSession(s.token)).rejects.toMatchObject({ status: 401, code: 'session_expired' })
    await expect(refreshSession('garbage')).rejects.toMatchObject({ status: 401 })
    await expect(refreshSession(undefined)).rejects.toMatchObject({ status: 401 })
  })

  it('an expired access token answers 401 session_expired', async () => {
    const s = await devSignInAs('u1')
    const claims = readToken(`Bearer ${s.token}`)!
    const expired = `mock.${btoa(JSON.stringify({ ...claims, exp: Date.now() - 1 }))}`
    expect(errorOf(() => userFrom(req(expired)))).toMatchObject({ status: 401, code: 'session_expired' })
  })

  it('a deactivated user cannot refresh', async () => {
    const s = await devSignInAs('u2')
    const u = users.find((x) => x.id === 'u2')!
    u.active = false
    try {
      await expect(refreshSession(s.refreshToken)).rejects.toMatchObject({ status: 401 })
    } finally {
      u.active = true
    }
  })
})
