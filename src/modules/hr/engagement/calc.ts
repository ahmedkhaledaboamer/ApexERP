import type { CommentTheme, Driver, DriverScore, EnpsResult, FeedbackCompetency, FeedbackGroup, FeedbackRating, Relationship, SurveyQuestion, TenureBand } from './types'
import { DRIVERS, DRIVER_LABEL, MIN_FEEDBACK_GROUP, MIN_SURVEY_GROUP, RELATIONSHIPS, RELATIONSHIP_LABEL } from './types'

/** Pure math of Engagement surveys and 360° feedback (shared by the mock API and the screens; unit-tested). */

const round2 = (n: number) => Math.round(n * 100) / 100
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)

/** A group is shown only with at least `min` responses (5 for surveys). */
export const isSuppressed = (responses: number, min = MIN_SURVEY_GROUP) => responses < min

/** eNPS = % promoters (9–10) − % detractors (0–6), whole number from −100 to 100; null without answers. */
export function enpsOf(values: readonly number[]): EnpsResult | null {
  const v = values.filter((x) => Number.isInteger(x) && x >= 0 && x <= 10)
  if (!v.length) return null
  const promoters = v.filter((x) => x >= 9).length
  const detractors = v.filter((x) => x <= 6).length
  const passives = v.length - promoters - detractors
  // Computed on counts (not on rounded percentages) so 1 promoter of 3 is 33, not 33 − 0 rounding twice.
  const score = Math.round(((promoters - detractors) / v.length) * 100)
  return { score: Object.is(score, -0) ? 0 : score, promoters, passives, detractors, responses: v.length }
}

/** Mean (two decimals) and favourable share (4–5, whole percent) of 1–5 Likert answers. */
export function likertStats(values: readonly number[]): { mean: number | null; favorablePct: number | null; n: number } {
  const v = values.filter((x) => Number.isInteger(x) && x >= 1 && x <= 5)
  if (!v.length) return { mean: null, favorablePct: null, n: 0 }
  return { mean: round2(v.reduce((s, x) => s + x, 0) / v.length), favorablePct: pct(v.filter((x) => x >= 4).length, v.length), n: v.length }
}

/**
 * Driver scores: the Likert answers of every question tagged with the driver, pooled over the responses.
 * `responses` counts the responses that answered at least one question of the driver.
 */
export function driverScores(questions: readonly SurveyQuestion[], responses: readonly { answers: readonly { questionId: string; value: number | null }[] }[]): DriverScore[] {
  const out: DriverScore[] = []
  for (const driver of DRIVERS) {
    const ids = new Set(questions.filter((q) => q.type === 'likert' && q.driver === driver).map((q) => q.id))
    if (!ids.size) continue
    const values: number[] = []
    let n = 0
    for (const r of responses) {
      const mine = r.answers.filter((a) => ids.has(a.questionId) && a.value !== null).map((a) => a.value as number)
      if (mine.length) n++
      values.push(...mine)
    }
    const s = likertStats(values)
    out.push({ driver: driver as Driver, label: DRIVER_LABEL[driver], score: s.mean, favorablePct: s.favorablePct, responses: n })
  }
  return out
}

/** Mean of every Likert answer of the responses (the engagement score), or null. */
export function engagementScore(questions: readonly SurveyQuestion[], responses: readonly { answers: readonly { questionId: string; value: number | null }[] }[]): number | null {
  const ids = new Set(questions.filter((q) => q.type === 'likert').map((q) => q.id))
  return likertStats(responses.flatMap((r) => r.answers.filter((a) => ids.has(a.questionId) && a.value !== null).map((a) => a.value as number))).mean
}

/** Whole months between two ISO days (floor). */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
}

/** Tenure band of a hire date on a company calendar day. */
export function tenureBandOf(hireDate: string, today: string): TenureBand {
  const m = hireDate ? Math.max(0, monthsBetween(hireDate, today)) : 0
  if (m < 6) return 'lt_6m'
  if (m < 12) return '6_12m'
  if (m < 24) return '1_2y'
  if (m < 60) return '2_5y'
  return '5y_plus'
}

/** `iso` + n calendar months (clamped to the month's last day). */
export function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/* ---------------- Comment themes (simple keyword grouping, EN + AR) ---------------- */

const THEMES: { theme: string; label: string; words: string[] }[] = [
  { theme: 'workload', label: 'Workload & hours', words: ['workload', 'overtime', 'hours', 'busy', 'stress', 'deadline', 'pressure', 'ضغط', 'ساعات'] },
  { theme: 'manager', label: 'Management', words: ['manager', 'management', 'boss', 'leadership', 'supervisor', 'المدير', 'الإدارة'] },
  { theme: 'growth', label: 'Growth & learning', words: ['growth', 'career', 'promotion', 'learn', 'training', 'develop', 'تطوير', 'تدريب', 'ترقية'] },
  { theme: 'pay', label: 'Pay & benefits', words: ['salary', 'pay', 'bonus', 'compensation', 'benefit', 'allowance', 'راتب', 'رواتب', 'مكافأة'] },
  { theme: 'recognition', label: 'Recognition', words: ['recognition', 'recognise', 'recognize', 'appreciat', 'thank', 'valued', 'تقدير'] },
  { theme: 'communication', label: 'Communication', words: ['communication', 'communicate', 'information', 'transparen', 'meeting', 'update', 'تواصل'] },
  { theme: 'wellbeing', label: 'Wellbeing & flexibility', words: ['balance', 'wellbeing', 'well-being', 'health', 'flexib', 'remote', 'توازن', 'مرونة'] },
  { theme: 'team', label: 'Team & culture', words: ['team', 'colleague', 'culture', 'people', 'friendly', 'الفريق', 'زملاء'] },
  { theme: 'tools', label: 'Tools & processes', words: ['tool', 'system', 'process', 'laptop', 'software', 'equipment', 'أدوات', 'نظام'] },
]

/** Groups comments by keyword theme (a comment may fall in several); unmatched ones go to "Other". */
export function commentThemes(comments: readonly string[], examples = 3): CommentTheme[] {
  const out: CommentTheme[] = []
  const matched = new Set<number>()
  for (const t of THEMES) {
    const hits = comments
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => {
        const low = c.toLowerCase()
        return t.words.some((w) => low.includes(w))
      })
    if (!hits.length) continue
    hits.forEach((h) => matched.add(h.i))
    out.push({ theme: t.theme, label: t.label, count: hits.length, examples: hits.slice(0, examples).map((h) => h.c) })
  }
  const other = comments.filter((_c, i) => !matched.has(i))
  if (other.length) out.push({ theme: 'other', label: 'Other', count: other.length, examples: other.slice(0, examples) })
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/* ---------------- 360° grouping ---------------- */

export interface FeedbackAnswerSet {
  relationship: Relationship
  ratings: readonly FeedbackRating[]
}

function groupOf(key: FeedbackGroup['key'], sets: readonly FeedbackAnswerSet[], competencies: readonly FeedbackCompetency[], min: number): FeedbackGroup {
  const suppressed = sets.length < min
  const comp = competencies.map((c) => {
    const s = likertStats(sets.flatMap((x) => x.ratings.filter((r) => r.competencyId === c.id && r.rating !== null).map((r) => r.rating as number)))
    return { competencyId: c.id, text: c.text, average: suppressed ? null : s.mean }
  })
  const all = likertStats(sets.flatMap((x) => x.ratings.filter((r) => r.rating !== null).map((r) => r.rating as number)))
  return { key, label: key === 'all' ? 'Everyone' : RELATIONSHIP_LABEL[key], responses: sets.length, suppressed, competencies: comp, overall: suppressed ? null : all.mean }
}

/**
 * 360° answers aggregated by relationship group: a group with at least `min` (3) answers stands on its own, the
 * rest are pooled into "Others" (suppressed when still under `min`). "Everyone" leads when the total reaches `min`.
 */
export function groupFeedback(sets: readonly FeedbackAnswerSet[], competencies: readonly FeedbackCompetency[], min = MIN_FEEDBACK_GROUP): FeedbackGroup[] {
  if (!sets.length) return []
  const out: FeedbackGroup[] = [groupOf('all', sets, competencies, min)]
  const pooled: FeedbackAnswerSet[] = []
  for (const rel of RELATIONSHIPS) {
    const mine = sets.filter((s) => s.relationship === rel)
    if (!mine.length) continue
    if (mine.length >= min) out.push(groupOf(rel, mine, competencies, min))
    else pooled.push(...mine)
  }
  if (pooled.length) {
    // "Everyone" minus the shown groups would give away a pooled group of 1–2: then only "Everyone" is shown.
    if (pooled.length < min) return [out[0]]
    out.push(groupOf('others', pooled, competencies, min))
  }
  // A single group equal to "Everyone" adds nothing.
  return out.length === 2 && out[1].responses === out[0].responses ? [out[0]] : out
}

/* ---------------- Breakdown suppression ---------------- */

/**
 * Which groups of a breakdown are hidden: every group under `min`, plus (complementary suppression) the smallest
 * shown groups until the hidden ones hold at least `min` responses together, so the total minus the shown groups
 * can never isolate fewer than `min` people. Returns one flag per group, in order.
 */
export function suppressBreakdown(counts: readonly number[], min = MIN_SURVEY_GROUP): boolean[] {
  const hidden = counts.map((n) => n < min)
  const hiddenTotal = () => counts.reduce((s, n, i) => s + (hidden[i] ? n : 0), 0)
  while (hiddenTotal() > 0 && hiddenTotal() < min) {
    let pick = -1
    counts.forEach((n, i) => {
      if (!hidden[i] && (pick < 0 || n < counts[pick])) pick = i
    })
    if (pick < 0) break
    hidden[pick] = true
  }
  return hidden
}
