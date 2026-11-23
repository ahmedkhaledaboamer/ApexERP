import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrPerfReviews } from '@/shared/mocks/data/hrPerformance'
import { notifications } from '@/shared/mocks/data/tasks'
import { hrEngParticipants, hrEngResponses, hrEngSurveys, hrFbRounds, nextEngId, sealKey, templateByKey, type SurveyRecord } from '@/shared/mocks/data/hrEngagement'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import { addDaysIso } from '@/shared/lib/companyDay'
import { now } from '@/shared/mocks/clock'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import type { Tenant } from '@/shared/mocks/tenant'
import { answerSurvey, closeSurvey, createSurvey, getResults, launchSurvey, updateSettings } from './hrEngagement'
import { ENG_LINK } from './hrEngagementCore'
import { runEngagementTick } from './hrEngagementTick'
import { getReviewFeedback, getSummary } from './hrFeedback'

/**
 * HR › Engagement services (the mock API contract): anonymity in storage, the 5-response threshold, once-only
 * reminders, recurring pulses created on the company's calendar day, exit surveys on notice, 360° visibility.
 */

const seed = takeSnapshot(true)
afterAll(() => {
  restoreSnapshot(seed)
})
beforeEach(() => {
  restoreSnapshot(seed)
})

const u = (id: string) => users.find((x) => x.id === id)! as User
const HR = () => u('u9')
const today = () => companyDayOf(APEX_ID, now()).today
const enps = templateByKey('enps_pulse')!

async function launchedPulse(extra: Record<string, unknown> = {}) {
  const s = await createSurvey(HR(), { name: 'Test pulse', templateKey: 'enps_pulse', opensOn: today(), closesOn: addDaysIso(today(), 10), recurrence: 'none', ...extra })
  return launchSurvey(HR(), s.id)
}
const answer = (userId: string, surveyId: string, score: number, why = '') =>
  answerSurvey(u(userId), surveyId, { answers: [{ questionId: 'enps', value: score, choiceIds: [], text: '' }, { questionId: 'enps-why', value: null, choiceIds: [], text: why }], language: 'en' })

describe('anonymity in storage', () => {
  it('an anonymous answer stores no respondent id; the marker holds who answered; edits replace the same row', async () => {
    const s = await launchedPulse()
    await answer('u11', s.id, 9, 'Great team')
    const rows = hrEngResponses.filter((r) => r.surveyId === s.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].respondentEmployeeId).toBeNull()
    const text = JSON.stringify(rows[0])
    for (const needle of ['EMP-u11', '"u11"', 'Noura Al Ketbi', 'noura@apexaora.ae']) expect(text).not.toContain(needle)
    expect(rows[0].submittedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rows[0].id).toMatch(/^ERS-[a-z0-9]{8,}$/)
    expect(hrEngParticipants.filter((p) => p.surveyId === s.id)).toEqual([{ companyId: APEX_ID, surveyId: s.id, employeeId: 'EMP-u11' }])
    // Edit until close: same row, new value.
    await answer('u11', s.id, 3)
    const after = hrEngResponses.filter((r) => r.surveyId === s.id)
    expect(after).toHaveLength(1)
    expect(after[0].answers[0].value).toBe(3)
    expect(after[0].sealedKey).toBe(sealKey(APEX_ID, s.id, 'EMP-u11'))
    expect(hrEngParticipants.filter((p) => p.surveyId === s.id)).toHaveLength(1)
    await closeSurvey(HR(), s.id)
    await expect(answer('u11', s.id, 10)).rejects.toMatchObject({ status: 409 })
  })

  it('a non-anonymous survey keeps the respondent (HR sees individuals)', async () => {
    const s = await launchedPulse({ anonymous: false })
    await answer('u11', s.id, 8)
    expect(hrEngResponses.find((r) => r.surveyId === s.id)!.respondentEmployeeId).toBe('EMP-u11')
    const res = await getResults(HR(), s.id)
    expect(res.individual?.map((i) => i.employeeName)).toEqual(['Noura Al Ketbi'])
  })

  it('anonymous results carry no names or ids, and HR can’t drill down to people', async () => {
    const s = await launchedPulse()
    const who = ['u11', 'u14', 'u15', 'u16', 'u17']
    for (const [i, id] of who.entries()) await answer(id, s.id, 5 + i, `Comment ${i}`)
    const res = await getResults(HR(), s.id)
    expect(res.individual).toBeNull()
    const text = JSON.stringify(res)
    for (const id of who) {
      const e = hrEmployees.find((x) => x.id === `EMP-${id}`)!
      for (const needle of [e.id, `"${id}"`, e.fullName]) expect(text).not.toContain(needle)
    }
  })
})

describe('the 5-response threshold', () => {
  it('4 responses: suppressed (counts only); 5: shown; a department of 4 is hidden in the breakdown', async () => {
    const s = await launchedPulse()
    // Delivery (u10 head): u11, u14, u15, u16 (4); Sales: u4.
    for (const id of ['u11', 'u14', 'u15', 'u16']) await answer(id, s.id, 9)
    let r = await getResults(HR(), s.id)
    expect([r.responseCount, r.suppressed, r.enps, r.drivers, r.themes]).toEqual([4, true, null, [], []])
    expect(r.questions.every((q) => q.suppressed && q.distribution.length === 0 && q.comments.length === 0)).toBe(true)
    await answer('u4', s.id, 2)
    r = await getResults(HR(), s.id)
    expect(r.suppressed).toBe(false)
    expect(r.enps?.score).toBe(60) // 4 promoters, 1 detractor of 5
    const delivery = r.byDepartment.find((g) => g.key === 'd-delivery')!
    expect([delivery.responses, delivery.suppressed, delivery.enps]).toEqual([4, true, null])
    // Filtering on a department of 4 is suppressed too; the department head sees nothing either.
    expect((await getResults(HR(), s.id, { departmentId: 'd-delivery' })).suppressed).toBe(true)
    const head = await getResults(u('u10'), s.id)
    expect([head.scope, head.responseCount, head.suppressed, head.individual]).toEqual(['departments', 4, true, null])
    await expect(getResults(HR(), s.id, { departmentId: 'd-delivery', tenureBand: '1_2y' })).rejects.toMatchObject({ status: 422 })
  })
})

describe('reminders are once-only, to people who haven’t answered', () => {
  it('open → mid-way → the day before close; never twice; respondents are skipped', async () => {
    const s = await launchedPulse()
    const link = ENG_LINK(s.id)
    const told = (userId: string) => notifications.filter((n) => n.userId === userId && n.link === link).map((n) => n.title)
    expect(told('u14')).toEqual(['Quick pulse survey: Test pulse'])
    await answer('u11', s.id, 9)
    const at = (days: number) => new Date(now().getTime() + days * 86_400_000)
    runEngagementTick(APEX_ID, at(5))
    runEngagementTick(APEX_ID, at(5))
    expect(told('u14')).toEqual(['Reminder: Test pulse', 'Quick pulse survey: Test pulse'])
    expect(told('u11')).toEqual(['Quick pulse survey: Test pulse'])
    runEngagementTick(APEX_ID, at(9))
    runEngagementTick(APEX_ID, at(9))
    expect(told('u14')[0]).toBe('Last day to answer: Test pulse')
    expect(told('u14')).toHaveLength(3)
    runEngagementTick(APEX_ID, at(11))
    expect(hrEngSurveys.find((x) => x.id === s.id)!.status).toBe('closed')
    expect(told('u14')).toHaveLength(3)
  })
})

describe('recurring pulses open on the company’s calendar day', () => {
  function series(co: string, opensOn: string): Tenant<SurveyRecord> {
    const id = nextEngId('ESV-')
    const s: Tenant<SurveyRecord> = {
      companyId: co, id, name: 'Monthly pulse · 2026-12', kind: 'enps', templateKey: 'enps_pulse', anonymous: true, status: 'closed',
      questions: structuredClone(enps.questions), audience: { type: 'all', departmentIds: [], tenureBands: [] }, opensOn, closesOn: addDaysIso(opensOn, 7),
      recurrence: 'monthly', seriesId: id, wave: 1, targetEmployeeIds: [], subjectEmployeeId: null, journeyId: null, launchedAt: `${opensOn}T05:00:00.000Z`,
      closedAt: null, createdAt: `${opensOn}T05:00:00.000Z`, createdBy: null, createdByName: 'Test', marks: ['open', 'mid', 'last'],
    }
    hrEngSurveys.push(s)
    return s
  }
  const waves = (seriesId: string) => hrEngSurveys.filter((x) => x.seriesId === seriesId).sort((a, b) => a.wave - b.wave)

  it('Dubai (UTC+4) is on the next month’s day at 20:30 UTC; Riyadh (UTC+3) only from 21:00 UTC; once each', () => {
    moduleOverrides.push({ companyId: CREST_ID, module: 'hr', enabled: true, reason: 'test', by: 'p1', at: new Date().toISOString() })
    const apex = series(APEX_ID, '2026-12-15')
    const crest = series(CREST_ID, '2026-12-15')
    runEngagementTick(APEX_ID, new Date('2027-01-14T19:30:00Z')) // Dubai 23:30 on the 14th
    expect(waves(apex.seriesId)).toHaveLength(1)
    const at = new Date('2027-01-14T20:30:00Z') // Dubai 00:30 on the 15th, Riyadh 23:30 on the 14th
    runEngagementTick(APEX_ID, at)
    runEngagementTick(CREST_ID, at)
    expect(waves(apex.seriesId).map((w) => [w.wave, w.opensOn, w.status, w.closesOn])).toEqual([[1, '2026-12-15', 'closed', '2026-12-22'], [2, '2027-01-15', 'open', '2027-01-22']])
    expect(waves(apex.seriesId)[1].name).toBe('Monthly pulse · 2027-01')
    expect(waves(apex.seriesId)[1].targetEmployeeIds.length).toBeGreaterThan(5)
    expect(waves(crest.seriesId)).toHaveLength(1)
    runEngagementTick(CREST_ID, new Date('2027-01-14T21:30:00Z')) // Riyadh 00:30 on the 15th
    expect(waves(crest.seriesId).map((w) => w.opensOn)).toEqual(['2026-12-15', '2027-01-15'])
    // Idempotent: another tick the same day creates nothing.
    runEngagementTick(APEX_ID, new Date('2027-01-15T10:00:00Z'))
    runEngagementTick(CREST_ID, new Date('2027-01-15T10:00:00Z'))
    expect([waves(apex.seriesId).length, waves(crest.seriesId).length]).toEqual([2, 2])
    // Stopping the series (recurrence none on the latest wave) stops it.
    waves(apex.seriesId)[1].recurrence = 'none'
    runEngagementTick(APEX_ID, new Date('2027-02-16T10:00:00Z'))
    expect(waves(apex.seriesId)).toHaveLength(2)
  })
})

describe('exit survey on notice', () => {
  it('is sent once to an employee on notice, non-anonymous, closing on the exit date', () => {
    const e = hrEmployees.find((x) => x.id === 'EMP-u17')!
    e.status = 'notice'
    e.exitDate = addDaysIso(today(), 20)
    runEngagementTick(APEX_ID)
    runEngagementTick(APEX_ID)
    const exits = hrEngSurveys.filter((s) => s.kind === 'exit' && s.subjectEmployeeId === e.id)
    expect(exits).toHaveLength(1)
    expect([exits[0].status, exits[0].anonymous, exits[0].closesOn, exits[0].targetEmployeeIds]).toEqual(['open', false, e.exitDate, ['EMP-u17']])
    expect(notifications.filter((n) => n.userId === 'u17' && n.link === ENG_LINK(exits[0].id))).toHaveLength(1)
  })
})

describe('360° feedback visibility', () => {
  it('the manager sees the aggregate (no names); the employee only once the review is shared; HR names only with the setting', async () => {
    const round = hrFbRounds.find((r) => r.companyId === APEX_ID && r.reviewId)!
    const mgr = await getReviewFeedback(u('u10'), round.reviewId!)
    expect(mgr.summary?.available).toBe(true)
    expect(mgr.summary?.responses).toBe(3)
    expect(mgr.summary?.named).toBeNull()
    expect(mgr.round?.providers.map((p) => p.status).sort()).toEqual(['declined', 'pending', 'submitted', 'submitted', 'submitted'])
    const mgrText = JSON.stringify(mgr.summary)
    for (const name of ['Noura Al Ketbi', 'Leena Joseph', 'Omar Siddiqui']) expect(mgrText).not.toContain(name)

    const before = await getReviewFeedback(u('u14'), round.reviewId!)
    expect([before.summary?.available, before.summary?.groups, before.summary?.strengths, before.round?.providers, before.round?.counts.submitted]).toEqual([false, [], [], [], 0])
    hrPerfReviews.find((r) => r.id === round.reviewId)!.sharedAt = new Date().toISOString()
    const after = await getReviewFeedback(u('u14'), round.reviewId!)
    expect(after.summary?.available).toBe(true)
    expect(after.summary?.strengths.length).toBe(3)
    expect(JSON.stringify(after)).not.toContain('Noura Al Ketbi')

    expect((await getSummary(HR(), round.id)).named).toBeNull()
    await updateSettings(HR(), { feedbackNamesVisibleToHr: true })
    expect((await getSummary(HR(), round.id)).named?.map((n) => n.providerName)).toEqual(['Leena Joseph', 'Noura Al Ketbi', 'Omar Siddiqui'])
    // The manager still sees no names.
    expect((await getSummary(u('u10'), round.id)).named).toBeNull()
  })
})
