import { describe, expect, it } from 'vitest'
import type { Plan } from '@/modules/billing/types'
import type { PlatformSettings } from '@/modules/platform/types'
import { draftFromPlan, planEditInput, validateDraft, versionedChange } from '@/modules/platform/planEdit'
import { changedSettings, parseSettings, settingsDraft } from '@/modules/platform/settingsForm'
import { announcementStatus, validateAnnouncement } from '@/modules/platform/announcements'
import { toImpersonationEvent } from '@/shared/lib/impersonationEvents'

const plan: Plan = {
  id: 'business',
  name: 'Business',
  price: 79,
  currency: 'USD',
  billingPeriod: 'month',
  limits: { users: 25, leadsContacts: 10000, storageMb: 10240, emailsPerMonth: 5000, aiCredits: 500 },
  modules: ['sales', 'services', 'reports', 'settings', 'departments', 'tasks', 'hr', 'marketing'],
  highlights: ['Everything in Starter'],
  checkout: 'payment',
  active: true,
  rank: 2,
}

describe('plan edit', () => {
  it('no change → no new version, migration forced to keep', () => {
    const d = draftFromPlan(plan)
    expect(versionedChange(plan, d).any).toBe(false)
    expect(planEditInput(plan, d, 'now', 'tidy')).toEqual({ migration: 'keep', reason: 'tidy' })
  })
  it('name / highlights / active only → no new version', () => {
    const d = { ...draftFromPlan(plan), name: 'Business+', highlights: 'A\nB', active: false }
    expect(versionedChange(plan, d).any).toBe(false)
    expect(planEditInput(plan, d, 'keep', 'r')).toEqual({ name: 'Business+', highlights: ['A', 'B'], active: false, migration: 'keep', reason: 'r' })
  })
  it('price, limits and modules are versioned changes and only changed limits are sent', () => {
    const d = draftFromPlan(plan)
    d.price = '99'
    d.limits = { ...d.limits, users: '', aiCredits: '1000' }
    d.modules = [...d.modules, 'ai']
    const ch = versionedChange(plan, d)
    expect(ch).toEqual({ price: true, limits: true, modules: true, any: true })
    const input = planEditInput(plan, d, 'at_renewal', 'Price rise')
    expect(input.price).toBe(99)
    expect(input.limits).toEqual({ users: null, aiCredits: 1000 })
    expect(input.modules).toContain('ai')
    expect(input.migration).toBe('at_renewal')
  })
  it('validates', () => {
    const d = { ...draftFromPlan(null), id: 'X', name: '', price: '-1', currency: 'us' }
    d.limits = { ...d.limits, users: '2.5' }
    const e = validateDraft(d, true)
    expect(Object.keys(e).sort()).toEqual(['currency', 'id', 'limit-users', 'name', 'price'])
    expect(validateDraft(draftFromPlan(plan), false)).toEqual({})
  })
})

const settings: PlatformSettings = {
  trialDays: 14,
  trialReminderDays: [7, 3, 1],
  graceDays: 7,
  pastDueReminderDays: [1, 3, 6],
  suspendedDaysBeforeCancel: 30,
  retentionDays: 60,
  usageWarningThresholds: [80, 100],
  subdomainRedirectDays: 30,
  impersonationMinutes: 30,
}

describe('platform settings form', () => {
  it('round-trips without changes', () => {
    const { errors, value } = parseSettings(settingsDraft(settings))
    expect(errors).toEqual({})
    expect(changedSettings(settings, value!)).toEqual({})
  })
  it('reports range and list errors', () => {
    const d = { ...settingsDraft(settings), trialDays: '0', trialReminderDays: '7, x', usageWarningThresholds: '80, 120', impersonationMinutes: '2', graceDays: '3, 3' }
    const { errors, value } = parseSettings(d)
    expect(value).toBeNull()
    expect(Object.keys(errors).sort()).toEqual(['graceDays', 'impersonationMinutes', 'trialDays', 'trialReminderDays', 'usageWarningThresholds'])
    expect(parseSettings({ ...settingsDraft(settings), pastDueReminderDays: '1, 1' }).errors.pastDueReminderDays).toBe('No duplicates.')
  })
  it('lists only changed keys', () => {
    const { value } = parseSettings({ ...settingsDraft(settings), impersonationMinutes: '45', trialReminderDays: '1 3 7' })
    expect(changedSettings(settings, value!)).toEqual({ impersonationMinutes: 45 })
  })
})

describe('announcements', () => {
  const now = Date.parse('2026-11-18T12:00:00Z')
  it('computes status', () => {
    expect(announcementStatus({ startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-20T00:00:00Z' }, now)).toBe('scheduled')
    expect(announcementStatus({ startsAt: '2026-11-18T00:00:00Z', endsAt: '2026-11-20T00:00:00Z' }, now)).toBe('live')
    expect(announcementStatus({ startsAt: '2026-11-10T00:00:00Z', endsAt: '2026-11-18T12:00:00Z' }, now)).toBe('ended')
  })
  it('validates the form', () => {
    expect(validateAnnouncement({ title: 'T', body: 'B', startsAt: '2026-11-18T00:00:00Z', endsAt: '2026-11-19T00:00:00Z' })).toEqual({})
    expect(Object.keys(validateAnnouncement({ title: ' ', body: '', startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-18T00:00:00Z' })).sort()).toEqual([
      'body',
      'endsAt',
      'title',
    ])
  })
})

describe('impersonation API errors', () => {
  it('maps codes to events', () => {
    expect(toImpersonationEvent('impersonation_read_only', 'm')).toEqual({ kind: 'read_only', message: 'm' })
    expect(toImpersonationEvent('impersonation_blocked', 'm')?.kind).toBe('blocked')
    expect(toImpersonationEvent('impersonation_expired', 'm')?.kind).toBe('expired')
    expect(toImpersonationEvent('impersonation_ended', 'm')?.kind).toBe('ended')
    expect(toImpersonationEvent('LIMIT_REACHED', 'm')).toBeNull()
    expect(toImpersonationEvent(undefined, 'm')).toBeNull()
  })
})
