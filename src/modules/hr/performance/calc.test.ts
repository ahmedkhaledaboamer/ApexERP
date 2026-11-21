import { describe, expect, it } from 'vitest'
import { canTransition, competencyScore, goalScore, goalWeightProblem, nextPhase, overallScore, phasesFor, ratingFromScore, scoresOf, weightsOf } from './calc'
import { DEFAULT_SCALE, type TemplateSnapshot } from './types'

const template = (over: Partial<TemplateSnapshot> = {}): TemplateSnapshot => ({
  id: 't',
  name: 'T',
  scale: DEFAULT_SCALE,
  sections: [{ id: 's', title: 'S', questions: [{ id: 'q1', text: 'a' }, { id: 'q2', text: 'b' }, { id: 'q3', text: 'c' }] }],
  goalsEnabled: true,
  goalsWeight: 40,
  competencyWeight: 60,
  selfReview: true,
  ...over,
})

describe('weighted score math', () => {
  it('competency score = mean of the rated questions (unrated ones ignored)', () => {
    expect(competencyScore([{ rating: 4 }, { rating: 3 }, { rating: 5 }])).toBe(4)
    expect(competencyScore([{ rating: 4 }, { rating: null }, { rating: 3 }])).toBe(3.5)
    expect(competencyScore([{ rating: null }])).toBeNull()
    expect(competencyScore([{ rating: 1 }, { rating: 2 }, { rating: 2 }])).toBe(1.67)
  })

  it('goals score = Σ weight × rating / Σ weights', () => {
    const goals = [
      { id: 'a', weight: 50 },
      { id: 'b', weight: 30 },
      { id: 'c', weight: 20 },
    ]
    expect(goalScore(goals, [{ goalId: 'a', rating: 5 }, { goalId: 'b', rating: 3 }, { goalId: 'c', rating: 2 }])).toBe(3.8) // (250 + 90 + 40) / 100
    // An unrated goal drops out of the weights.
    expect(goalScore(goals, [{ goalId: 'a', rating: 4 }, { goalId: 'b', rating: 2 }])).toBe(3.25) // (200 + 60) / 80
    expect(goalScore(goals, [])).toBeNull()
  })

  it('overall = goals weight × goals + competency weight × competencies', () => {
    expect(overallScore(template(), 4, 3)).toBe(3.6) // 0.4 × 3 + 0.6 × 4
    expect(overallScore(template({ goalsWeight: 50, competencyWeight: 50 }), 3, 4)).toBe(3.5)
    expect(overallScore(template(), 4, null)).toBeNull()
    // Goals off: the competency score only; goals 100 %: the goals score only.
    expect(overallScore(template({ goalsEnabled: false, goalsWeight: 0, competencyWeight: 100 }), 3.33, null)).toBe(3.33)
    expect(overallScore(template({ goalsWeight: 100, competencyWeight: 0 }), null, 4.2)).toBe(4.2)
  })

  it('scoresOf combines the three', () => {
    const t = template()
    const s = scoresOf(t, [{ id: 'g1', weight: 60 }, { id: 'g2', weight: 40 }], [{ questionId: 'q1', rating: 3, comment: '' }, { questionId: 'q2', rating: 4, comment: '' }, { questionId: 'q3', rating: 5, comment: '' }], [{ goalId: 'g1', rating: 4, comment: '' }, { goalId: 'g2', rating: 2, comment: '' }])
    expect(s).toEqual({ competency: 4, goals: 3.2, overall: 3.68 }) // 0.4 × 3.2 + 0.6 × 4
  })

  it('final rating rounds half up to a level of the scale and clamps', () => {
    expect(ratingFromScore(DEFAULT_SCALE, 3.49)).toBe(3)
    expect(ratingFromScore(DEFAULT_SCALE, 3.5)).toBe(4)
    expect(ratingFromScore(DEFAULT_SCALE, 0.2)).toBe(1)
    expect(ratingFromScore(DEFAULT_SCALE, 7)).toBe(5)
    expect(ratingFromScore(DEFAULT_SCALE, null)).toBeNull()
  })

  it('template weights: goals off → 0 / 100; clamped 0–100', () => {
    expect(weightsOf(true, 40)).toEqual({ goalsWeight: 40, competencyWeight: 60 })
    expect(weightsOf(false, 40)).toEqual({ goalsWeight: 0, competencyWeight: 100 })
    expect(weightsOf(true, 140)).toEqual({ goalsWeight: 100, competencyWeight: 0 })
  })
})

describe('goal weight validation', () => {
  it('whole numbers 1–100 that total exactly 100', () => {
    expect(goalWeightProblem([40, 30, 30])).toBeNull()
    expect(goalWeightProblem([100])).toBeNull()
    expect(goalWeightProblem([40, 30])).toMatch(/total 70%/)
    expect(goalWeightProblem([60, 50])).toMatch(/total 110%/)
    expect(goalWeightProblem([50, 49.5, 0.5])).toMatch(/whole number/)
    expect(goalWeightProblem([100, 0])).toMatch(/whole number/)
    expect(goalWeightProblem([])).toMatch(/at least one goal/)
  })
})

describe('phase transitions', () => {
  it('a template with goals and a self-review uses every phase, in order', () => {
    const t = template()
    expect(phasesFor(t)).toEqual(['draft', 'goal_setting', 'self_review', 'manager_review', 'calibration', 'shared', 'closed'])
    expect(nextPhase(t, 'draft')).toBe('goal_setting')
    expect(nextPhase(t, 'goal_setting')).toBe('self_review')
    expect(nextPhase(t, 'self_review')).toBe('manager_review')
    expect(nextPhase(t, 'manager_review')).toBe('calibration')
    expect(nextPhase(t, 'calibration')).toBe('shared')
    // Shared and closed don't advance (closing is its own action).
    expect(nextPhase(t, 'shared')).toBeNull()
    expect(nextPhase(t, 'closed')).toBeNull()
  })

  it('goal setting and the self-review are skipped when the template has none', () => {
    const t = template({ goalsEnabled: false, selfReview: false })
    expect(phasesFor(t)).toEqual(['draft', 'manager_review', 'calibration', 'shared', 'closed'])
    expect(nextPhase(t, 'draft')).toBe('manager_review')
    expect(nextPhase(template({ goalsEnabled: false }), 'draft')).toBe('self_review')
  })

  it('only one step forward, or close a launched cycle', () => {
    const t = template()
    expect(canTransition(t, 'goal_setting', 'self_review')).toBe(true)
    expect(canTransition(t, 'goal_setting', 'manager_review')).toBe(false)
    expect(canTransition(t, 'manager_review', 'self_review')).toBe(false)
    expect(canTransition(t, 'self_review', 'closed')).toBe(true)
    expect(canTransition(t, 'draft', 'closed')).toBe(false)
    expect(canTransition(t, 'closed', 'closed')).toBe(false)
  })
})
