import { describe, expect, it } from 'vitest'
import { leads, users } from '@/shared/mocks/db'
import { companies } from '@/shared/mocks/data/tenancy'
import { lookupsFor } from '@/shared/mocks/data/lookups'
import { nextTaskId, tasks } from '@/shared/mocks/data/tasks'
import { passwordMatches, setPassword } from '@/shared/mocks/data/passwords'
import { pendingTwoFactor } from '@/shared/mocks/data/security'
import '@/shared/mocks/handlers'
import type { SnapshotAdapter } from './idb'
import { registeredStoreNames, restoreSnapshot, schemaVersion, takeSnapshot, type MockSnapshot } from './registry'

/** Stand-in for IndexedDB: keeps a structured clone, like `put` does. */
function memoryAdapter(): SnapshotAdapter {
  let saved: MockSnapshot | null = null
  return {
    load: async () => (saved ? structuredClone(saved) : null),
    save: async (s) => {
      saved = structuredClone(s)
    },
    clear: async () => {
      saved = null
    },
  }
}

const state = () => takeSnapshot(true).stores

describe('mock DB persistence registry', () => {
  it('registers every mutable store (with handlers loaded)', () => {
    expect(registeredStoreNames()).toEqual(
      expect.arrayContaining([
        'users', 'leads', 'customers', 'contacts', 'activities', 'notes',
        'companies', 'memberships', 'auditLog', 'auditLog.seq', 'contracts', 'quotations', 'departments',
        'services', 'packages', 'projectTemplates', 'templates', 'templates.seq', 'agentTargets',
        'reportSchedules', 'reportSchedules.seq', 'tasks', 'projects', 'notifications',
        'tasks.seq', 'projects.seq', 'notifications.seq', 'tasks.eventSeq', 'tasks.commentSeq', 'tasks.attachmentSeq',
        'passwords', 'passwords.changedAt', 'leadWebsites', 'won.usedIdempotencyKeys',
        'security.twoFactorEnabledAt', 'security.pendingTwoFactor', 'security.recoveryCodes', 'security.loginChallenges',
        'security.sessionsByUser', 'security.sessionSeq', 'security.backupSeq', 'security.backupsByCompany',
        'perTenant:lookups', 'perTenant:automationRules', 'perTenant:securityPolicies', 'perTenant:targetDefaults',
      ]),
    )
  })

  it('snapshot → reset to seed → restore gives back the same data, in place', async () => {
    const seed = takeSnapshot(true)
    const adapter = memoryAdapter()
    const leadsRef = leads

    // Mutate several kinds of store: arrays, nested records, perTenant, Map, Set, counter.
    leads.push({ ...structuredClone(leads[0]), id: 'L-TEST' })
    users[0].name = 'Renamed Person'
    companies[0].name = 'Renamed Co'
    lookupsFor('co_apex').sources.push({ key: 'Test source', label: 'Test source', active: true, order: 99 })
    setPassword('u1', 'n3w-Passw0rd!')
    pendingTwoFactor.add('u2')
    const firstId = nextTaskId()
    const mutated = state()
    await adapter.save(takeSnapshot())

    // Back to seed.
    expect(restoreSnapshot(seed)).toBe(true)
    expect(state()).toEqual(seed.stores)
    expect(leads).toBe(leadsRef)
    expect(leads.some((l) => l.id === 'L-TEST')).toBe(false)
    expect(passwordMatches('u1', 'n3w-Passw0rd!')).toBe(false)
    expect(pendingTwoFactor.has('u2')).toBe(false)

    // Restore the saved state.
    expect(restoreSnapshot(await adapter.load())).toBe(true)
    expect(state()).toEqual(mutated)
    expect(leads).toBe(leadsRef)
    expect(users[0].name).toBe('Renamed Person')
    expect(lookupsFor('co_apex').sources.some((s) => s.key === 'Test source')).toBe(true)
    expect(passwordMatches('u1', 'n3w-Passw0rd!')).toBe(true)
    expect(pendingTwoFactor.has('u2')).toBe(true)
    // The id counter continues after the restored value, so new ids never collide.
    const n = Number(firstId.replace('TK-', ''))
    expect(nextTaskId()).toBe(`TK-${n + 1}`)
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('discards a snapshot from another schema version', () => {
    const before = state()
    const snap = takeSnapshot(true)
    ;(snap.stores.leads as unknown[]).length = 0
    expect(restoreSnapshot({ ...snap, version: `${schemaVersion()}-old` })).toBe(false)
    expect(restoreSnapshot(null)).toBe(false)
    expect(state()).toEqual(before)
  })
})
