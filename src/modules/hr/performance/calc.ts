import type { Answer, CyclePhase, GoalRating, RatingLevel, Scores, TemplateSnapshot } from './types'

/**
 * Pure rules of HR › Performance (shared by the mock API and the screens; unit-tested in calc.test.ts).
 *
 *   competency score = mean of the rated questions (every question counts once)
 *   goals score      = Σ(goal weight × goal rating) / Σ(weights of the rated goals)
 *   overall          = goals on:  goalsWeight % × goals + competencyWeight % × competencies
 *                      goals off: the competency score
 *   final rating     = the HR calibration when there is one, else the overall rounded half up to a scale level
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export function competencyScore(answers: readonly Pick<Answer, 'rating'>[]): number | null {
  const rated = answers.map((a) => a.rating).filter((r): r is number => typeof r === 'number')
  if (!rated.length) return null
  return round2(rated.reduce((s, r) => s + r, 0) / rated.length)
}

export function goalScore(goals: readonly { id: string; weight: number }[], ratings: readonly Pick<GoalRating, 'goalId' | 'rating'>[]): number | null {
  let weighted = 0
  let weights = 0
  for (const g of goals) {
    const r = ratings.find((x) => x.goalId === g.id)?.rating
    if (typeof r !== 'number' || g.weight <= 0) continue
    weighted += g.weight * r
    weights += g.weight
  }
  return weights > 0 ? round2(weighted / weights) : null
}

export function overallScore(template: Pick<TemplateSnapshot, 'goalsEnabled' | 'goalsWeight' | 'competencyWeight'>, competency: number | null, goals: number | null): number | null {
  if (!template.goalsEnabled || template.goalsWeight <= 0) return competency
  if (template.competencyWeight <= 0) return goals
  if (competency === null || goals === null) return null
  return round2((template.goalsWeight * goals + template.competencyWeight * competency) / 100)
}

export function scoresOf(template: TemplateSnapshot, goals: readonly { id: string; weight: number }[], answers: readonly Answer[], goalRatings: readonly GoalRating[]): Scores {
  const competency = competencyScore(answers)
  const g = template.goalsEnabled ? goalScore(goals, goalRatings) : null
  return { competency, goals: g, overall: overallScore(template, competency, g) }
}

/** The nearest scale level, half up (3.5 → 4), clamped to the scale. */
export function ratingFromScore(scale: readonly RatingLevel[], score: number | null): number | null {
  if (score === null || !scale.length) return null
  const values = scale.map((l) => l.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return Math.min(max, Math.max(min, Math.floor(score + 0.5)))
}

export const labelOf = (scale: readonly RatingLevel[], value: number | null): string | null => (value === null ? null : (scale.find((l) => l.value === value)?.label ?? String(value)))

/** Problem with a set of goal weights, or null when they are valid (whole numbers 1–100 totalling 100). */
export function goalWeightProblem(weights: readonly number[]): string | null {
  if (!weights.length) return 'Add at least one goal.'
  if (weights.some((w) => !Number.isInteger(w) || w < 1 || w > 100)) return 'Each goal weight is a whole number from 1 to 100.'
  const total = weights.reduce((s, w) => s + w, 0)
  return total === 100 ? null : `Goal weights total ${total}%; they must total 100%.`
}

/** The phases a cycle goes through with this template, in order (goal setting / self-review only when used). */
export function phasesFor(template: Pick<TemplateSnapshot, 'goalsEnabled' | 'selfReview'>): CyclePhase[] {
  const out: CyclePhase[] = ['draft']
  if (template.goalsEnabled) out.push('goal_setting')
  if (template.selfReview) out.push('self_review')
  out.push('manager_review', 'calibration', 'shared', 'closed')
  return out
}

/** The phase after `phase` (HR "advance"), or null when the cycle can't advance (shared → close instead, closed). */
export function nextPhase(template: Pick<TemplateSnapshot, 'goalsEnabled' | 'selfReview'>, phase: CyclePhase): CyclePhase | null {
  if (phase === 'shared' || phase === 'closed') return null
  const order = phasesFor(template)
  const i = order.indexOf(phase)
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null
}

/** Is `to` a legal move from `from` (launch, advance one step, or close)? */
export function canTransition(template: Pick<TemplateSnapshot, 'goalsEnabled' | 'selfReview'>, from: CyclePhase, to: CyclePhase): boolean {
  if (to === 'closed') return from !== 'draft' && from !== 'closed'
  return nextPhase(template, from) === to
}

/** Weights of a template: goals share (0 when off) and the competencies' complement. */
export function weightsOf(goalsEnabled: boolean, goalsWeight: number): { goalsWeight: number; competencyWeight: number } {
  const g = goalsEnabled ? Math.max(0, Math.min(100, Math.round(goalsWeight))) : 0
  return { goalsWeight: g, competencyWeight: 100 - g }
}
