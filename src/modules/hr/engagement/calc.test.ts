import { describe, expect, it } from 'vitest'
import { addMonthsIso, commentThemes, driverScores, engagementScore, enpsOf, groupFeedback, isSuppressed, likertStats, suppressBreakdown, tenureBandOf } from './calc'
import type { SurveyQuestion } from './types'

const lk = (id: string, driver: SurveyQuestion['driver']): SurveyQuestion => ({ id, type: 'likert', text: id, textAr: '', driver, options: [], required: true })
const resp = (pairs: [string, number | null][]) => ({ answers: pairs.map(([questionId, value]) => ({ questionId, value })) })

describe('eNPS', () => {
  it('is % promoters (9–10) minus % detractors (0–6), on counts', () => {
    expect(enpsOf([10, 9, 8, 7, 6, 0])).toEqual({ score: 0, promoters: 2, passives: 2, detractors: 2, responses: 6 })
    expect(enpsOf([10, 10, 10])?.score).toBe(100)
    expect(enpsOf([0, 6, 3])?.score).toBe(-100)
    expect(enpsOf([7, 8])?.score).toBe(0)
    // 1 promoter of 3 → 33 (not rounded twice)
    expect(enpsOf([9, 7, 8])?.score).toBe(33)
    // 14 answers: 6 promoters, 3 detractors → 21.4 → 21
    expect(enpsOf([9, 10, 8, 7, 6, 9, 10, 8, 5, 9, 7, 8, 10, 6])?.score).toBe(21)
  })
  it('ignores values outside 0–10 and answers nothing without values', () => {
    expect(enpsOf([])).toBeNull()
    expect(enpsOf([11, -1, 2.5])).toBeNull()
    expect(enpsOf([11, 9])?.responses).toBe(1)
  })
})

describe('Likert driver scores', () => {
  const qs = [lk('m1', 'manager'), lk('m2', 'manager'), lk('w1', 'workload'), { ...lk('t', null), type: 'text' as const }]
  it('pools the answers of the driver’s questions: mean (2 decimals) and favourable share (4–5)', () => {
    const rs = [resp([['m1', 5], ['m2', 4], ['w1', 2]]), resp([['m1', 3], ['m2', null], ['w1', 1]]), resp([['m1', 4], ['m2', 2]])]
    const d = driverScores(qs, rs)
    expect(d.map((x) => x.driver)).toEqual(['manager', 'workload'])
    // manager: 5,4,3,4,2 → mean 3.6, favourable 3/5 = 60%
    expect(d[0]).toMatchObject({ score: 3.6, favorablePct: 60, responses: 3 })
    // workload: 2,1 → 1.5, 0%; answered by 2 responses
    expect(d[1]).toMatchObject({ score: 1.5, favorablePct: 0, responses: 2 })
    expect(engagementScore(qs, rs)).toBe(3)
  })
  it('likertStats skips values outside 1–5', () => {
    expect(likertStats([0, 6, 5, 4])).toEqual({ mean: 4.5, favorablePct: 100, n: 2 })
    expect(likertStats([])).toEqual({ mean: null, favorablePct: null, n: 0 })
  })
})

describe('Threshold suppression (5 for surveys)', () => {
  it('hides a group of 4 and shows a group of 5', () => {
    expect(isSuppressed(4)).toBe(true)
    expect(isSuppressed(5)).toBe(false)
    expect(isSuppressed(0)).toBe(true)
  })
  it('hides the next-smallest groups until the hidden ones hold at least 5 (no differencing)', () => {
    // 4 is hidden; 4 alone could be recomputed from the total → the 6 is hidden too.
    expect(suppressBreakdown([6, 4, 9])).toEqual([true, true, false])
    // 3 + 2 = 5 hidden together: enough.
    expect(suppressBreakdown([3, 2, 7, 8])).toEqual([true, true, false, false])
    // Nothing under the threshold: nothing hidden.
    expect(suppressBreakdown([5, 6])).toEqual([false, false])
    // Everything small: everything hidden.
    expect(suppressBreakdown([1, 2])).toEqual([true, true])
  })
})

describe('Tenure bands and months', () => {
  it('bands a hire date on the company day', () => {
    expect(tenureBandOf('2026-06-01', '2026-11-23')).toBe('lt_6m')
    expect(tenureBandOf('2026-05-23', '2026-11-23')).toBe('6_12m')
    expect(tenureBandOf('2025-11-24', '2026-11-23')).toBe('6_12m')
    expect(tenureBandOf('2025-11-23', '2026-11-23')).toBe('1_2y')
    expect(tenureBandOf('2023-01-01', '2026-11-23')).toBe('2_5y')
    expect(tenureBandOf('2019-01-01', '2026-11-23')).toBe('5y_plus')
  })
  it('adds calendar months, clamped to the month end', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonthsIso('2026-03-10', -3)).toBe('2025-12-10')
  })
})

describe('Comment themes', () => {
  it('groups by keyword (EN and AR), a comment may count in several themes, the rest is Other', () => {
    const t = commentThemes(['Too much overtime and workload', 'My manager is great', 'الراتب منخفض والرواتب متأخرة', 'Nice office', 'Training and career growth please', 'Workload is fine'])
    const by = Object.fromEntries(t.map((x) => [x.theme, x.count]))
    expect(by.workload).toBe(2)
    expect(by.manager).toBe(1)
    expect(by.growth).toBe(1)
    expect(by.pay).toBe(1)
    expect(by.other).toBe(1)
    expect(t[0].theme).toBe('workload')
  })
})

describe('360° grouping and minimums (3)', () => {
  const comps = [{ id: 'c1', text: 'Quality' }, { id: 'c2', text: 'Teamwork' }]
  const set = (relationship: 'peer' | 'direct_report' | 'cross_functional', a: number, b: number | null) => ({ relationship, ratings: [{ competencyId: 'c1', rating: a }, { competencyId: 'c2', rating: b }] })

  it('a group of 3 stands alone; smaller groups pool into Others', () => {
    const g = groupFeedback([set('peer', 4, 5), set('peer', 3, 4), set('peer', 5, 5), set('direct_report', 2, 3), set('cross_functional', 4, 4), set('direct_report', 3, null)], comps)
    expect(g.map((x) => [x.key, x.responses, x.suppressed])).toEqual([['all', 6, false], ['peer', 3, false], ['others', 3, false]])
    expect(g[1].competencies[0].average).toBe(4)
    // Others: c2 has 3, 4 (null skipped) → 3.5
    expect(g[2].competencies[1].average).toBe(3.5)
  })
  it('when the pooled rest is still under 3, only Everyone is shown (no differencing)', () => {
    const g = groupFeedback([set('peer', 4, 4), set('peer', 3, 3), set('peer', 5, 5), set('cross_functional', 1, 1)], comps)
    expect(g.map((x) => x.key)).toEqual(['all'])
    expect(g[0].overall).toBe(3.25)
  })
  it('under 3 in total: suppressed, no averages', () => {
    const g = groupFeedback([set('peer', 4, 4), set('peer', 3, 3)], comps)
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ key: 'all', suppressed: true, overall: null })
    expect(g[0].competencies.every((c) => c.average === null)).toBe(true)
  })
  it('a single group equal to Everyone collapses', () => {
    expect(groupFeedback([set('peer', 4, 4), set('peer', 3, 3), set('peer', 5, 5)], comps).map((x) => x.key)).toEqual(['all'])
  })
})
