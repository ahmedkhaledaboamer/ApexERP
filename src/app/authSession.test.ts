import { afterEach, describe, expect, it } from 'vitest'
import type { Session } from '@/shared/types'
import { makeStore } from '@/app/store'
import { acceptRotatedTokens, bindAuthSession } from '@/app/authSession'
import { tokensRefreshed } from '@/store/authSlice'
import { configureSession, sessionGuard } from '@/shared/lib/axios'
import type { SessionTokens } from '@/shared/lib/httpSession'

const session = (token: string, refreshToken: string, userId = 'u3', tenantId = 'co_apex') =>
  ({ token, refreshToken, user: { id: userId, companyId: tenantId, role: 'Sales Manager' }, tenant: { id: tenantId } }) as unknown as Session

describe('acceptRotatedTokens (by session identity, not token equality)', () => {
  const rotated = { token: 'T2', refreshToken: 'R2', userId: 'u3', tenantId: 'co_apex' }
  it('keeps rotated tokens when the access token changed meanwhile (same user and tenant)', () => {
    expect(acceptRotatedTokens(session('T1', 'R1'), 'dead', rotated)).toBe(true)
  })
  it('drops them after sign-out or when another user / workspace is signed in', () => {
    expect(acceptRotatedTokens(null, 'dead', rotated)).toBe(false)
    expect(acceptRotatedTokens(session('X', 'Y', 'u4'), 'dead', rotated)).toBe(false)
    expect(acceptRotatedTokens(session('X', 'Y', 'u3', 'co_crest'), 'dead', rotated)).toBe(false)
  })
  it('without identity info, falls back to the token the refresh started from', () => {
    expect(acceptRotatedTokens(session('dead', 'R1'), 'dead', { token: 'T2' })).toBe(true)
    expect(acceptRotatedTokens(session('T1', 'R1'), 'dead', { token: 'T2' }, 'dead')).toBe(true)
    expect(acceptRotatedTokens(session('T1', 'R1'), 'dead', { token: 'T2' })).toBe(false)
  })
})

describe('bindAuthSession: a rotated refresh token is never lost to a concurrent token write', () => {
  let undo: (() => void)[] = []
  afterEach(() => {
    undo.reverse().forEach((u) => u())
    undo = []
  })

  it('stale access token written back while the refresh is in flight → the rotated tokens still win', async () => {
    const store = makeStore({ auth: { session: session('T1', 'R1') } })
    undo.push(bindAuthSession(store))
    let release!: (t: SessionTokens & { userId: string; tenantId: string }) => void
    undo.push(
      configureSession({
        readSession: () => store.getState().auth.session,
        refresh: () => new Promise((r) => (release = r)),
      }),
    )
    store.dispatch(tokensRefreshed({ token: 'dead' })) // access token stops working
    const refreshing = sessionGuard.refreshNow() // starts from 'dead' / R1
    store.dispatch(tokensRefreshed({ token: 'T1' })) // the race: a valid (old) access token is written back
    release({ token: 'T2', refreshToken: 'R2', expiresAt: '2030-01-01T00:00:00.000Z', userId: 'u3', tenantId: 'co_apex' })
    expect(await refreshing).toBe(true)
    expect(store.getState().auth.session).toMatchObject({ token: 'T2', refreshToken: 'R2', expiresAt: '2030-01-01T00:00:00.000Z' })
  })

  it('a refresh that finishes after sign-out stores nothing', async () => {
    const store = makeStore({ auth: { session: session('T1', 'R1') } })
    undo.push(bindAuthSession(store))
    let release!: (t: SessionTokens & { userId: string; tenantId: string }) => void
    undo.push(configureSession({ readSession: () => store.getState().auth.session, refresh: () => new Promise((r) => (release = r)) }))
    const refreshing = sessionGuard.refreshNow()
    store.dispatch({ type: 'auth/signedOut' })
    release({ token: 'T2', refreshToken: 'R2', userId: 'u3', tenantId: 'co_apex' })
    await refreshing
    expect(store.getState().auth.session).toBeNull()
  })
})
