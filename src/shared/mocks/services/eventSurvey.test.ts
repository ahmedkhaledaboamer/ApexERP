import { describe, expect, it } from 'vitest'
import { eventAttendees } from '@/shared/mocks/data/events'
import { eventSurveyResponses } from '@/shared/mocks/data/eventExtras'
import { moduleOverrides } from '@/shared/mocks/data/platform'
import { npsOf } from '@/shared/mocks/services/eventSurvey'
import { api, userToken, useSeedPerTest } from '@/shared/mocks/isolation/harness'

/** Feedback survey: opens after the event, once per attendee, NPS math, results tab. */

useSeedPerTest()

const as = (userId: string) => (method: string, path: string, body?: unknown) => api(userToken(userId), method, path, { body })
const apexAdmin = as('u1')
let n = 0
const client = () => `survey-client-${++n}`
const get = (token: string) => api(null, 'GET', `/public/surveys/${token}`, { headers: { 'X-Client-Id': client() } })
const post = (token: string, body: unknown) => api(null, 'POST', `/public/surveys/${token}`, { body, headers: { 'X-Client-Id': client() } })

describe('NPS math', () => {
  it('% promoters (9–10) − % detractors (0–6), rounded; null without answers', () => {
    expect(npsOf([10, 9, 8, 7, 6, 0])).toEqual({ nps: 0, promoters: 2, passives: 2, detractors: 2 })
    expect(npsOf([10, 10, 9])).toMatchObject({ nps: 100 })
    expect(npsOf([0, 3])).toMatchObject({ nps: -100 })
    expect(npsOf([10, 8, 2])).toMatchObject({ nps: 0 })
    expect(npsOf([10, 9, 7])).toMatchObject({ nps: 67 })
    expect(npsOf([])).toMatchObject({ nps: null })
  })
})

describe('public survey', () => {
  it('a completed event’s attendee answers once; the results follow', async () => {
    // A late registration added by the team (every seeded GITEX attendee already answered).
    await apexAdmin('POST', '/events/EV-1001/attendees', { name: 'Late Survey', email: 'late-survey@visitor.ae' })
    const a = eventAttendees.find((x) => x.eventId === 'EV-1001' && !eventSurveyResponses.some((r) => r.attendeeId === x.id))!
    const info = await get(a.surveyToken)
    expect(info.status).toBe(200)
    expect(info.body).toMatchObject({ event_name: 'GITEX Global 2026', open: true, submitted: false })
    expect(JSON.stringify(info.body)).not.toMatch(/EV-1001|lead|@/)
    const before = (await apexAdmin('GET', '/events/EV-1001/survey')).body
    expect((await post(a.surveyToken, { rating: 6, nps: 5 })).status).toBe(422)
    expect((await post(a.surveyToken, { rating: 4, nps: 11 })).status).toBe(422)
    const ok = await post(a.surveyToken, { rating: 5, nps: 10, comment: 'Great stand' })
    expect(ok.status).toBe(200)
    const again = await post(a.surveyToken, { rating: 1, nps: 0 })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('already_submitted')
    expect((await get(a.surveyToken)).body).toMatchObject({ open: false, submitted: true })
    const after = (await apexAdmin('GET', '/events/EV-1001/survey')).body
    expect(after.responses).toBe(before.responses + 1)
    expect(after.promoters).toBe(before.promoters + 1)
    expect(after.comments[0]).toMatchObject({ comment: 'Great stand', attendee_name: a.name })
  })

  it('opens only after the event; cancelled event closed; waitlist / unknown / module off → the same 404', async () => {
    const upcoming = eventAttendees.find((x) => x.eventId === 'EV-1004' && x.status === 'registered')!
    const early = await post(upcoming.surveyToken, { rating: 5, nps: 10 })
    expect(early.status).toBe(409)
    expect(early.body.code).toBe('survey_closed')
    expect((await get(upcoming.surveyToken)).body).toMatchObject({ open: false, closed_reason: 'The survey opens after the event.' })
    // Completing the event opens it.
    await apexAdmin('PATCH', '/events/EV-1004', { status: 'completed' })
    expect((await post(upcoming.surveyToken, { rating: 4, nps: 8 })).status).toBe(200)
    const missing = await get('nosuchsurveytoken')
    expect(missing.status).toBe(404)
    const waiting = eventAttendees.find((x) => x.status === 'waitlisted' && x.companyId === 'co_crest')!
    expect((await get(waiting.surveyToken)).text).toBe(missing.text)
    const crest = eventAttendees.find((x) => x.eventId === 'EV-5001')!
    moduleOverrides.push({ companyId: 'co_crest', module: 'events', enabled: false, reason: 'test', by: 'p1', at: new Date().toISOString() })
    expect((await get(crest.surveyToken)).text).toBe(missing.text)
  })

  it('results: averages, NPS, comments; seeded and different per company; another company → 404', async () => {
    const apex = (await apexAdmin('GET', '/events/EV-1001/survey')).body
    expect(apex).toMatchObject({ responses: 3, average_rating: 4, nps: 33, promoters: 2, detractors: 1 })
    expect(apex.comments).toHaveLength(2)
    const crest = (await as('u101')('GET', '/events/EV-5001/survey')).body
    expect(crest).toMatchObject({ responses: 2, average_rating: 4.5, nps: 50 })
    expect((await apexAdmin('GET', '/events/EV-5001/survey')).status).toBe(404)
  })
})
