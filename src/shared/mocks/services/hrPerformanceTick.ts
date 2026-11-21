import { PROBATION_LOOKAHEAD_DAYS } from '@/modules/hr/performance/types'
import { phasesFor } from '@/modules/hr/performance/calc'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { employeeById } from '@/shared/mocks/data/hrEmployees'
import { hrContracts } from '@/shared/mocks/data/hrPeople'
import {
  emptyAssessment,
  emptyManagerAssessment,
  ensurePerfTemplates,
  hrPerfCycles,
  hrPerfReviews,
  nextPerfId,
  snapshotOf,
  type PerfCycleRecord,
} from '@/shared/mocks/data/hrPerformance'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyModules, onLifecycleTick } from '@/shared/mocks/services/billing'
import type { Tenant } from '@/shared/mocks/tenant'
import { announcePhase, remindDue } from './hrPerformanceCore'

/**
 * The lazy, idempotent HR › Performance tick for one company (runs on the company's lifecycle tick, i.e. every
 * authenticated request, and before the performance reads; only with the plan module `hr`):
 *   1. probation reviews: an active contract whose probation ends within PROBATION_LOOKAHEAD_DAYS (30) company
 *      calendar days (regional timezone, mock clock) gets one probation cycle + review (once per contract and
 *      probation end date: an extension creates a new one when its new date comes near). The direct manager is told.
 *   2. due-soon (≤ 3 days) / overdue reminders to whoever must act, once per review, phase and deadline.
 */
export function runPerformanceTick(companyId: string, at: Date = clockNow()): { created: number; reminded: number } {
  if (!companyModules(companyId).includes('hr')) return { created: 0, reminded: 0 }
  const today = companyDayOf(companyId, at).today
  const stamp = at.toISOString()
  const created = createProbationReviews(companyId, today, stamp)
  let reminded = 0
  for (const c of hrPerfCycles) if (c.companyId === companyId && c.launchedAt && c.phase !== 'closed') reminded += remindDue(c, today, stamp)
  return { created, reminded }
}

export function createProbationReviews(companyId: string, today: string, stamp: string): number {
  let created = 0
  for (const contract of hrContracts) {
    if (contract.companyId !== companyId || contract.status !== 'active' || !contract.probationEndDate) continue
    const left = daysBetweenIso(today, contract.probationEndDate)
    if (left < 0 || left > PROBATION_LOOKAHEAD_DAYS) continue
    const emp = employeeById(companyId, contract.employeeId)
    if (!emp || emp.status === 'terminated') continue
    if (hrPerfCycles.some((c) => c.companyId === companyId && c.type === 'probation' && c.probationContractId === contract.id && c.probationEndDate === contract.probationEndDate)) continue
    const template = ensurePerfTemplates(companyId, stamp).find((t) => t.forProbation && t.active)
    if (!template) continue
    const snap = snapshotOf(template)
    // Probation reviews skip goal setting; the first phase is the self-review (when the template has one) or the manager review.
    const phase = phasesFor({ goalsEnabled: false, selfReview: snap.selfReview })[1]
    const end = contract.probationEndDate
    const cycle: Tenant<PerfCycleRecord> = {
      companyId,
      id: nextPerfId('PCY-'),
      name: `Probation review · ${emp.fullName}`,
      type: 'probation',
      phase,
      templateId: template.id,
      template: { ...snap, goalsEnabled: false, goalsWeight: 0, competencyWeight: 100 },
      periodStart: contract.startDate,
      periodEnd: end,
      departmentIds: [],
      employeeIds: [emp.id],
      hiredBefore: null,
      deadlines: {
        goalSetting: null,
        selfReview: snap.selfReview ? (addDaysIso(end, -7) > today ? addDaysIso(end, -7) : today) : null,
        managerReview: end,
        calibration: addDaysIso(end, 7),
      },
      probationContractId: contract.id,
      probationEndDate: end,
      launchedAt: stamp,
      closedAt: null,
      createdAt: stamp,
      createdBy: null,
      createdByName: 'System',
      marks: [],
    }
    hrPerfCycles.push(cycle)
    hrPerfReviews.push({
      companyId,
      id: nextPerfId('PRV-'),
      cycleId: cycle.id,
      employeeId: emp.id,
      managerId: emp.managerId,
      self: emptyAssessment(),
      manager: emptyManagerAssessment(),
      calibrations: [],
      sharedAt: null,
      sharedBy: null,
      acknowledgedAt: null,
      ackComment: '',
      probationOutcome: null,
      outcomeAppliedAt: null,
      marks: [],
      createdAt: stamp,
    })
    announcePhase(cycle, stamp)
    created++
  }
  return created
}

onLifecycleTick('hr-performance', (companyId, until) => runPerformanceTick(companyId, new Date(until)))
