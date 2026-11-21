import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/shared/types'
import { activities, leads, users } from '@/shared/mocks/db'
import { APEX_ID, companyById, CREST_ID } from '@/shared/mocks/data/tenancy'
import { automationRulesFor, isClosedStatus, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { resetClock } from '@/shared/mocks/clock'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { isIsoDate } from '@/shared/domain/followUp'
import { logActivity, moveLeadStage, updateLead } from '@/shared/mocks/services/leads'
import { getDashboardSummary } from '@/shared/mocks/services/dashboard'
import { alertsFor } from '@/shared/mocks/services/alerts'

/**
 * next_follow_up_date is a company-local calendar date. The server decides "today", "overdue" and
 * "+N days" with the company's timezone (Settings > Company > Regional) and the mock clock.
 */

const u = (id: string): User => users.find((x) => x.id === id)!
const apexAdmin = () => u('u1')
const crestAdmin = () => u('u101')

/** 23:30 in Dubai on 18 Nov. */
const DUBAI_2330 = new Date('2026-11-18T19:30:00Z')
/** 00:30 in Dubai on 19 Nov; 23:30 in Riyadh and 22:30 in Cairo on 18 Nov. */
const DUBAI_0030 = new Date('2026-11-18T20:30:00Z')
/** 00:30 in Riyadh on 19 Nov; still 23:30 on 18 Nov in Cairo. */
const RIYADH_0030 = new Date('2026-11-18T21:30:00Z')

let snap: ReturnType<typeof takeSnapshot>
const zones = new Map<string, string>()
beforeEach(() => {
  snap = takeSnapshot(true)
  for (const id of [APEX_ID, CREST_ID]) zones.set(id, companyById(id)!.regional.timezone)
  resetClock()
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  for (const [id, tz] of zones) companyById(id)!.regional.timezone = tz
  restoreSnapshot(snap)
})

/** One open lead of the company keeps a follow-up on `date`; every other lead has none. */
function onlyFollowUp(co: string, date: string) {
  const company = leads.filter((l) => l.companyId === co)
  for (const l of company) l.nextFollowUpDate = null
  const lead = company.find((l) => !isClosedStatus(co, l.status) && !l.doNotContact)!
  lead.nextFollowUpDate = date
  return lead
}

describe('seed and writes store calendar dates', () => {
  it('every seeded follow-up is a yyyy-MM-dd date (or none)', () => {
    for (const l of leads) expect(l.nextFollowUpDate === null || isIsoDate(l.nextFollowUpDate), `${l.id}: ${l.nextFollowUpDate}`).toBe(true)
  })

  it('PATCH /leads/:id refuses a datetime and stores a date as is', async () => {
    const lead = onlyFollowUp(APEX_ID, '2026-11-18')
    await expect(updateLead(apexAdmin(), lead.id, { nextFollowUpDate: '2026-11-25T09:00:00.000Z' })).rejects.toMatchObject({ status: 422 })
    expect((await updateLead(apexAdmin(), lead.id, { nextFollowUpDate: '2026-11-25' })).nextFollowUpDate).toBe('2026-11-25')
  })
})

describe('No response schedules +N days from the company’s today', () => {
  const moveToNoResponse = async (at: Date) => {
    vi.setSystemTime(at)
    const lead = onlyFollowUp(APEX_ID, '2026-11-10')
    lead.status = SYSTEM_STATUS.contacted
    return moveLeadStage(apexAdmin(), { id: lead.id, status: SYSTEM_STATUS.noResponse })
  }

  it('at 23:30 vs 00:30 Dubai time', async () => {
    const days = automationRulesFor(APEX_ID).noResponseFollowUpDays
    expect(days).toBe(2)
    expect((await moveToNoResponse(DUBAI_2330)).nextFollowUpDate).toBe('2026-11-20')
    expect((await moveToNoResponse(DUBAI_0030)).nextFollowUpDate).toBe('2026-11-21')
  })

  it('an unanswered attempt reschedules from the company’s today', async () => {
    vi.setSystemTime(DUBAI_0030)
    const lead = onlyFollowUp(APEX_ID, '2026-11-10')
    lead.status = SYSTEM_STATUS.noResponse
    lead.stageChangedAt = new Date('2026-11-18T20:00:00Z').toISOString()
    // The seed dates activities from the real clock; drop this lead's ones after the stage change so
    // only the attempt logged here counts (otherwise it can reach the Cold threshold on later days).
    for (let i = activities.length - 1; i >= 0; i--) if (activities[i].leadId === lead.id && activities[i].at > lead.stageChangedAt) activities.splice(i, 1)
    await logActivity(apexAdmin(), { leadId: lead.id, type: 'call', summary: 'No answer' })
    expect(lead.nextFollowUpDate).toBe('2026-11-21')
  })

  it('the same instant in Riyadh gives the day before Dubai’s', async () => {
    vi.setSystemTime(DUBAI_0030)
    const lead = onlyFollowUp(CREST_ID, '2026-11-10')
    lead.status = SYSTEM_STATUS.contacted
    expect((await moveLeadStage(crestAdmin(), { id: lead.id, status: SYSTEM_STATUS.noResponse })).nextFollowUpDate).toBe('2026-11-20')
  })
})

describe('dashboard and alerts: today / overdue in the company’s timezone', () => {
  const figures = async (user: User) => {
    const d = await getDashboardSummary(user, '30d')
    return { today: d.followUpsDueToday, overdue: d.followUpsOverdue }
  }

  it('around midnight in Dubai: due today at 23:30, overdue at 00:30', async () => {
    onlyFollowUp(APEX_ID, '2026-11-18')
    vi.setSystemTime(DUBAI_2330)
    expect(await figures(apexAdmin())).toEqual({ today: 1, overdue: 0 })
    vi.setSystemTime(DUBAI_0030)
    expect(await figures(apexAdmin())).toEqual({ today: 0, overdue: 1 })
  })

  it('the same instant: overdue in Dubai, due today in Riyadh', async () => {
    const apexLead = onlyFollowUp(APEX_ID, '2026-11-18')
    const crestLead = onlyFollowUp(CREST_ID, '2026-11-18')
    vi.setSystemTime(DUBAI_0030)
    expect(await figures(apexAdmin())).toEqual({ today: 0, overdue: 1 })
    expect(await figures(crestAdmin())).toEqual({ today: 1, overdue: 0 })

    const apexAlert = alertsFor(u(apexLead.ownerId), DUBAI_0030).find((a) => a.id === `follow-up:${apexLead.id}`)
    const crestAlert = alertsFor(u(crestLead.ownerId), DUBAI_0030).find((a) => a.id === `follow-up:${crestLead.id}`)
    expect(apexAlert?.body).toMatch(/Follow-up 1 day overdue/)
    expect(crestAlert?.body).toMatch(/Follow-up due today/)
  })

  it('a different offset (Africa/Cairo) is still on the 18th when Riyadh has moved on', async () => {
    onlyFollowUp(CREST_ID, '2026-11-18')
    vi.setSystemTime(RIYADH_0030)
    expect(await figures(crestAdmin())).toEqual({ today: 0, overdue: 1 })
    companyById(CREST_ID)!.regional.timezone = 'Africa/Cairo'
    expect(await figures(crestAdmin())).toEqual({ today: 1, overdue: 0 })
  })
})
