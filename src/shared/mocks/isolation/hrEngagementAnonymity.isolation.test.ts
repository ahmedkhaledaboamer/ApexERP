import { describe, expect, it } from 'vitest'
import { scopeOf } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrEngResponses, hrEngSurveys } from '@/shared/mocks/data/hrEngagement'
import { COMPANIES, ADMIN, api, useSeedPerTest, userToken, type Co } from './harness'
import { fill } from './endpoints'
import { HR_ENGAGEMENT_ENDPOINTS, answersFor } from './hrEngagementEndpoints'
import { withHr } from './hrTalentEndpoints'

/**
 * ANONYMITY SWEEP (HR › Engagement surveys). An anonymous survey answered by 6 people (5+, so results are shown):
 * every engagement GET (options, overview, survey list / detail, results with every filter, the CSV export, the
 * caller's own survey reads), called by one user of EVERY role of the company (and by each respondent), never
 * returns a respondent's employee id, user id, name or e-mail; neither does the stored response row.
 * Seeded anonymous responses are checked the same way in storage.
 */

useSeedPerTest()

const RESPONDENTS: Record<Co, string[]> = {
  co_apex: ['u4', 'u5', 'u11', 'u14', 'u15', 'u16'],
  co_crest: ['u103', 'u104', 'u105', 'u106', 'u107', 'u101'],
}
/** The HR author of the survey (named on it as its author, so not a respondent here). */
const AUTHOR: Record<Co, string> = { co_apex: 'u9', co_crest: 'u102' }

function needlesOf(co: Co): string[] {
  return RESPONDENTS[co].flatMap((uid) => {
    const e = hrEmployees.find((x) => x.companyId === co && x.userId === uid)!
    const u = users.find((x) => x.id === uid)!
    return [e.id, `"${uid}"`, e.fullName, u.email, e.employeeNo]
  })
}

describe('Anonymous survey answers never name or identify the respondent, for any role, in any engagement read', () => {
  for (const co of COMPANIES) {
    it(`${co}: storage, results (all filters), export, overview, lists and own reads`, async () => {
      withHr(co)
      const hr = userToken(AUTHOR[co])
      const created = await api(hr, 'POST', '/hr/engagement/surveys', { body: { name: 'Anonymity sweep', template_key: 'quarterly_engagement', recurrence: 'none' } })
      expect(created.status).toBe(200)
      const sid = created.body.id as string
      expect((await api(hr, 'POST', `/hr/engagement/surveys/${sid}/launch`)).status).toBe(200)
      const survey = hrEngSurveys.find((s) => s.id === sid)!
      for (const uid of RESPONDENTS[co]) {
        const r = await api(userToken(uid), 'PUT', `/hr/engagement/my/${sid}`, { body: { answers: answersFor(survey.questions), language: 'en' } })
        expect(r.status, uid).toBe(200)
      }
      const needles = needlesOf(co)

      // Storage: no respondent id (or anything else of theirs) in the answer rows, seeded ones included.
      const rows = hrEngResponses.filter((r) => r.companyId === co && hrEngSurveys.find((s) => s.id === r.surveyId)?.anonymous)
      expect(rows.filter((r) => r.surveyId === sid)).toHaveLength(RESPONDENTS[co].length)
      for (const r of rows) {
        expect(r.respondentEmployeeId).toBeNull()
        const text = JSON.stringify(r)
        const everyone = hrEmployees.filter((e) => e.companyId === co)
        for (const e of everyone) for (const n of [e.id, e.fullName, ...(e.userId ? [`"${e.userId}"`] : [])]) expect(text, `stored row ${r.id}`).not.toContain(n)
      }

      // Every engagement GET, with the sweep survey in every :id, for one user of every role and every respondent.
      const depts = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[]
      const gets = HR_ENGAGEMENT_ENDPOINTS.filter((e) => e.method === 'GET' && e.path.startsWith('/hr/engagement'))
      const paths = gets.flatMap((e) =>
        e.path.endsWith('/results')
          ? [fill(e.path, { id: sid }), ...depts.map((d) => fill(e.path, { id: sid }, { department_id: d })), ...['lt_6m', '6_12m', '1_2y', '2_5y', '5y_plus'].map((b) => fill(e.path, { id: sid }, { tenure_band: b }))]
          : [fill(e.path, { id: sid })],
      )
      const active = users.filter((x) => x.companyId === co && x.active !== false)
      const viewers = [...new Set([ADMIN[co], AUTHOR[co], ...RESPONDENTS[co], ...active.filter((x, i) => active.findIndex((y) => y.role === x.role) === i).map((x) => x.id)])]
      let shown = 0
      for (const viewer of viewers) {
        for (const path of paths) {
          const res = await api(userToken(viewer), 'GET', path)
          expect(res.status, `${viewer} GET ${path}`).toBeLessThan(500)
          if (res.status !== 200) continue
          // A respondent's own reads (/my, /my/:id) may only hold their own answers: still no ids or names.
          for (const n of needles) expect(res.text, `${viewer} GET ${path}: ${n}`).not.toContain(n)
          if (path.endsWith('/results') && !res.body.suppressed) shown++
        }
      }
      // The sweep really looked at shown (not suppressed) results, as HR full and as a department head.
      expect(shown).toBeGreaterThanOrEqual(active.filter((x) => scopeOf(x.role, 'hr') === 'full').length > 0 ? 1 : 0)
      const full = await api(hr, 'GET', `/hr/engagement/surveys/${sid}/results`)
      expect([full.body.suppressed, full.body.response_count, full.body.individual]).toEqual([false, RESPONDENTS[co].length, null])
      const csv = await api(hr, 'GET', `/hr/engagement/surveys/${sid}/export`)
      expect(csv.body.headers).toEqual(['Section', 'Item', 'Value', 'Responses', 'Score / count'])
      expect(csv.text).not.toContain('Isolation answer') // no free text in an anonymous export
    }, 60_000)
  }
})
