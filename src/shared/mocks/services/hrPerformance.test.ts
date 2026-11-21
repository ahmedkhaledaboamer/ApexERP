import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID } from '@/shared/mocks/data/tenancy'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import { hrPerfCycles, hrPerfReviews, hrPerfTemplates } from '@/shared/mocks/data/hrPerformance'
import { notifications } from '@/shared/mocks/data/tasks'
import { auditLog } from '@/shared/mocks/data/audit'
import { restoreSnapshot, takeSnapshot } from '@/shared/mocks/persist/registry'
import {
  acknowledgeReview,
  advanceCycle,
  approveGoals,
  calibrateReview,
  closeCycle,
  createCycle,
  createGoal,
  getReview,
  launchCycle,
  saveManager,
  saveSelf,
  shareOne,
} from './hrPerformance'
import { onProbationOutcome, reviewLink } from './hrPerformanceCore'
import { runPerformanceTick } from './hrPerformanceTick'
import { probationReviewItemOf } from './hrJourney'

/**
 * HR › Performance services (the mock API contract): the cycle flow end to end, phase transitions,
 * visibility (employee never sees calibration, results only once shared), once-only notifications, and
 * probation reviews created from the contracts in the company timezone. Time is pinned with fake Date.
 */

vi.useFakeTimers({ toFake: ['Date'] })
const seed = takeSnapshot(true)
afterAll(() => {
  vi.useRealTimers()
  restoreSnapshot(seed)
})

const u = (id: string) => users.find((x) => x.id === id)! as User
const HR = () => u('u9')
const MGR = () => u('u10')
const EMP = () => u('u11')
const annual = () => hrPerfTemplates.find((t) => t.companyId === APEX_ID && t.goalsEnabled && !t.forProbation)!
const notesFor = (userId: string, link: string) => notifications.filter((n) => n.userId === userId && n.link === link)

beforeEach(() => {
  restoreSnapshot(seed)
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z')) // Dubai 10:00
})

async function launched(deadlines = { goalSetting: '2026-11-15', selfReview: '2026-11-20', managerReview: '2026-11-25', calibration: '2026-11-30' }) {
  const c = await createCycle(HR(), {
    name: 'Test cycle',
    type: 'ad_hoc',
    templateId: annual().id,
    periodStart: '2026-01-01',
    periodEnd: '2026-12-31',
    departmentIds: [],
    employeeIds: ['EMP-u11'],
    hiredBefore: null,
    deadlines,
  })
  const l = await launchCycle(HR(), c.id)
  return { cycleId: c.id, reviewId: l.reviews[0].id }
}

const allQuestions = () => annual().sections.flatMap((s) => s.questions)

describe('cycle flow: goals → self → manager → calibration → shared → acknowledged', () => {
  it('runs end to end with weights, visibility and once-only notifications', async () => {
    const { cycleId, reviewId } = await launched()
    const link = reviewLink(reviewId)
    expect(hrPerfCycles.find((c) => c.id === cycleId)!.phase).toBe('goal_setting')
    expect(notesFor('u11', link).map((n) => n.title)).toEqual(['Set your goals for Test cycle'])

    // Goals: weights may not exceed 100; the self-review isn't open yet.
    await createGoal(EMP(), reviewId, { title: 'Ship the portal', weight: 60, target: 'Live by Q4' })
    const g = await createGoal(EMP(), reviewId, { title: 'Mentor a junior', weight: 40 })
    expect(g.goalWeightTotal).toBe(100)
    await expect(createGoal(EMP(), reviewId, { title: 'Too much', weight: 10 })).rejects.toMatchObject({ status: 422, code: 'goal_weights' })
    await expect(saveSelf(EMP(), reviewId, { summary: 'x' })).rejects.toMatchObject({ status: 409, code: 'phase_closed' })
    // Only the direct manager approves.
    await expect(approveGoals(EMP(), reviewId)).rejects.toMatchObject({ status: 403 })
    expect((await approveGoals(MGR(), reviewId)).goals.every((x) => x.approved)).toBe(true)

    await advanceCycle(HR(), cycleId)
    expect(notesFor('u11', link).map((n) => n.title)).toContain('Your self-review for Test cycle is open')

    const goals = g.goals
    const answers = allQuestions().map((q) => ({ questionId: q.id, rating: 4, comment: '' }))
    await expect(saveSelf(EMP(), reviewId, { answers: answers.slice(1), submit: true })).rejects.toMatchObject({ status: 422, code: 'incomplete' })
    const self = await saveSelf(EMP(), reviewId, { answers, goalRatings: goals.map((x) => ({ goalId: x.id, rating: 4, comment: '' })), summary: 'Good year', submit: true })
    expect(self.self?.submittedAt).toBeTruthy()
    expect(self.manager).toBeNull()
    expect((await getReview(MGR(), reviewId)).self?.summary).toBe('Good year')

    await advanceCycle(HR(), cycleId)
    const mgr = await saveManager(MGR(), reviewId, {
      answers,
      goalRatings: [
        { goalId: goals[0].id, rating: 5, comment: '' },
        { goalId: goals[1].id, rating: 3, comment: '' },
      ],
      summary: 'Strong delivery',
      submit: true,
    })
    // competencies 4, goals (60×5 + 40×3)/100 = 4.2, overall 0.4 × 4.2 + 0.6 × 4 = 4.08 → 4
    expect(mgr.scores).toEqual({ competency: 4, goals: 4.2, overall: 4.08 })
    expect(mgr.finalRating).toBe(4)
    // The employee sees nothing of it before it is shared.
    const before = await getReview(EMP(), reviewId)
    expect([before.manager, before.scores, before.finalRating, before.overallScore]).toEqual([null, null, null, null])

    await advanceCycle(HR(), cycleId)
    expect(notesFor('u9', `/hr/performance?tab=cycles&cycle=${cycleId}`).length).toBe(1)
    await expect(calibrateReview(HR(), reviewId, { rating: 3, note: '' })).rejects.toMatchObject({ status: 422, code: 'note_required' })
    await expect(calibrateReview(EMP(), reviewId, { rating: 5, note: 'Self-serve' })).rejects.toMatchObject({ status: 403 })
    const NOTE = 'Calibrated against the Delivery peer group'
    const cal = await calibrateReview(HR(), reviewId, { rating: 3, note: NOTE })
    expect(cal.calibration).toMatchObject({ rating: 3, previousRating: 4, note: NOTE })
    expect(cal.finalRating).toBe(3)
    expect(auditLog.some((a) => a.entity === 'performance_review' && a.entityId === reviewId && a.summary.includes(NOTE))).toBe(true)
    // The manager sees the final rating, never the note.
    const asManager = await getReview(MGR(), reviewId)
    expect(asManager.calibration).toBeNull()
    expect(JSON.stringify(asManager)).not.toContain(NOTE)

    await advanceCycle(HR(), cycleId) // → shared (shares every submitted review)
    const shared = await getReview(EMP(), reviewId)
    expect(shared.stage).toBe('shared')
    expect(shared.finalRating).toBe(3)
    expect(shared.manager?.summary).toBe('Strong delivery')
    expect(shared.calibration).toBeNull()
    expect(JSON.stringify(shared)).not.toContain(NOTE)
    expect(notesFor('u11', link).filter((n) => n.title.includes('has been shared'))).toHaveLength(1)

    const ack = await acknowledgeReview(EMP(), reviewId, { comment: 'Thanks' })
    expect(ack.locked).toBe(true)
    expect(notesFor('u10', link).filter((n) => n.title.includes('acknowledged'))).toHaveLength(1)
    expect(notesFor('u9', link).filter((n) => n.title.includes('acknowledged'))).toHaveLength(1)
    await expect(acknowledgeReview(EMP(), reviewId, {})).rejects.toMatchObject({ status: 409, code: 'review_locked' })
    await expect(shareOne(HR(), reviewId)).rejects.toMatchObject({ status: 409, code: 'review_locked' })
    // Re-running the tick sends nothing again.
    const count = notifications.length
    runPerformanceTick(APEX_ID)
    runPerformanceTick(APEX_ID)
    expect(notifications.length).toBe(count)
  })
})

describe('phase transitions', () => {
  it('launch once, advance one step at a time, shared → close only, closed is final', async () => {
    const { cycleId } = await launched()
    await expect(launchCycle(HR(), cycleId)).rejects.toMatchObject({ status: 409, code: 'invalid_transition' })
    const phases = [] as string[]
    for (let i = 0; i < 4; i++) phases.push((await advanceCycle(HR(), cycleId)).phase)
    expect(phases).toEqual(['self_review', 'manager_review', 'calibration', 'shared'])
    await expect(advanceCycle(HR(), cycleId)).rejects.toMatchObject({ status: 409, code: 'invalid_transition' })
    expect((await closeCycle(HR(), cycleId)).phase).toBe('closed')
    await expect(advanceCycle(HR(), cycleId)).rejects.toMatchObject({ status: 409 })
    await expect(closeCycle(HR(), cycleId)).rejects.toMatchObject({ status: 409 })
    // Only HR full manages cycles.
    await expect(advanceCycle(MGR(), cycleId)).rejects.toMatchObject({ status: 403 })
  })

  it('a review left without a manager assessment ends “not completed” when the cycle closes', async () => {
    const { cycleId, reviewId } = await launched()
    await closeCycle(HR(), cycleId)
    expect((await getReview(HR(), reviewId)).stage).toBe('incomplete')
  })
})

describe('due-soon and overdue reminders are sent once', () => {
  it('to the one who must act, once per phase and deadline', async () => {
    const { cycleId, reviewId } = await launched({ goalSetting: '2026-11-11', selfReview: '2026-11-12', managerReview: '2026-11-25', calibration: '2026-11-30' })
    await createGoal(EMP(), reviewId, { title: 'One', weight: 100 })
    await approveGoals(MGR(), reviewId)
    await advanceCycle(HR(), cycleId) // self-review, due 12 Nov (2 days)
    const link = reviewLink(reviewId)
    const due = () => notesFor('u11', link).filter((n) => /self-review for Test cycle (is due|was due)/.test(n.title))
    runPerformanceTick(APEX_ID)
    runPerformanceTick(APEX_ID)
    expect(due().map((n) => n.title)).toEqual(['Your self-review for Test cycle is due in 2 days (2026-11-12)'])
    vi.setSystemTime(new Date('2026-11-13T06:00:00Z'))
    runPerformanceTick(APEX_ID)
    runPerformanceTick(APEX_ID)
    expect(due()).toHaveLength(2)
    expect(due()[0].title).toContain('was due 2026-11-12')
    // Nobody else got them.
    expect(notesFor('u10', link).filter((n) => n.title.includes('due'))).toHaveLength(0)
  })
})

describe('probation reviews from the contracts (company timezone)', () => {
  const contract = () => hrContracts.find((c) => c.companyId === APEX_ID && c.employeeId === 'EMP-X3' && c.status === 'active')!
  const probationCycles = () => hrPerfCycles.filter((c) => c.type === 'probation' && c.probationContractId === contract().id)

  beforeEach(() => {
    for (let i = hrPerfCycles.length - 1; i >= 0; i--) if (hrPerfCycles[i].type === 'probation') hrPerfCycles.splice(i, 1)
    contract().probationEndDate = '2026-12-21'
  })

  it('is created when the probation ends within 30 company-calendar days, once', () => {
    // 19:30 UTC on 20 Nov = 23:30 in Dubai: 31 days to go → nothing yet.
    vi.setSystemTime(new Date('2026-11-20T19:30:00Z'))
    runPerformanceTick(APEX_ID)
    expect(probationCycles()).toHaveLength(0)
    // 20:30 UTC (still 20 Nov in UTC) = 00:30 on 21 Nov in Dubai: 30 days → created.
    vi.setSystemTime(new Date('2026-11-20T20:30:00Z'))
    runPerformanceTick(APEX_ID)
    runPerformanceTick(APEX_ID)
    expect(probationCycles()).toHaveLength(1)
    const c = probationCycles()[0]
    expect(c.phase).toBe('manager_review') // the probation template has no self-review
    expect(c.deadlines.managerReview).toBe('2026-12-21')
    const r = hrPerfReviews.find((x) => x.cycleId === c.id)!
    expect(r.employeeId).toBe('EMP-X3')
    expect(r.managerId).toBe('EMP-u10')
    expect(notesFor('u10', reviewLink(r.id))).toHaveLength(1)
  })

  it('extend: HR shares the manager’s recommendation and the probation end moves', async () => {
    vi.setSystemTime(new Date('2026-11-25T06:00:00Z'))
    expect(probationReviewItemOf(APEX_ID, 'EMP-X3')).toMatchObject({ status: 'open' })
    runPerformanceTick(APEX_ID)
    const c = probationCycles()[0]
    const r = hrPerfReviews.find((x) => x.cycleId === c.id)!
    const events: string[] = []
    onProbationOutcome('test', (e) => events.push(`${e.employeeId}:${e.outcome}:${e.newProbationEndDate}`))
    const answers = c.template.sections.flatMap((s) => s.questions).map((q) => ({ questionId: q.id, rating: 3, comment: '' }))
    await expect(saveManager(MGR(), r.id, { answers, submit: true })).rejects.toMatchObject({ status: 422 })
    await expect(saveManager(MGR(), r.id, { answers, recommendation: 'extend', extendMonths: 9, submit: true })).rejects.toMatchObject({ status: 422 })
    await saveManager(MGR(), r.id, { answers, recommendation: 'extend', extendMonths: 2, submit: true })
    expect(c.phase).toBe('calibration')
    // The employee doesn't see the recommendation before HR shares.
    const own = await getReview(u('u10'), r.id)
    expect(own.viewer).toBe('manager')
    await shareOne(HR(), r.id)
    expect(contract().probationEndDate).toBe('2027-02-21')
    expect(events).toEqual(['EMP-X3:extend:2027-02-21'])
    expect(c.phase).toBe('shared')
    // The onboarding journey's probation review item is ticked by the share.
    expect(probationReviewItemOf(APEX_ID, 'EMP-X3')).toMatchObject({ status: 'done' })
  })
})
