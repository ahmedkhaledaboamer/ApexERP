import { addMonthsIso, tenureBandOf } from '@/modules/hr/engagement/calc'
import { addDaysIso, daysBetweenIso } from '@/shared/lib/companyDay'
import { now as clockNow } from '@/shared/mocks/clock'
import { employeesOf } from '@/shared/mocks/data/hrEmployees'
import { hrJourneys } from '@/shared/mocks/data/hrJourney'
import { engSettingsOf, hrEngSurveys, hrFbProviders, hrFbRounds, nextEngId, templateByKey, type SurveyRecord } from '@/shared/mocks/data/hrEngagement'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { companyModules, onLifecycleTick } from '@/shared/mocks/services/billing'
import type { Tenant } from '@/shared/mocks/tenant'
import { markOnce, notifyUsers } from './hrPerformanceCore'
import { ENG_LINK, activeUserIdOf, canAnswer, notifyNonRespondents } from './hrEngagementCore'

/**
 * The lazy, idempotent HR › Engagement tick for one company (on the company's lifecycle tick — every authenticated
 * request — and before the engagement reads; only with the plan module `hr`). Days are the company's calendar
 * (regional timezone, mock clock):
 *   1. a scheduled survey opens on its open day (audience frozen, the targets are told once)
 *   2. an open survey closes after its close day; before that, once-only reminders to the people who haven't
 *      answered: mid-way and the day before it closes (`mid`, `last` marks)
 *   3. recurring pulses: the next wave of a monthly / quarterly series opens when its day comes (once per series
 *      and date: `next:<date>` mark on the previous wave)
 *   4. exit surveys: an employee on notice gets the exit survey once (company setting, on by default), linked to
 *      their offboarding journey
 *   5. 360° feedback: due-soon (≤ 2 days) and overdue reminders to the colleagues who haven't answered, once each
 */

/** Who a survey goes to on `day`: active employees with a login matching the audience (or the one subject). */
export function targetsOf(s: SurveyRecord, co: string, day: string): string[] {
  const people = employeesOf(co).filter(canAnswer)
  if (s.subjectEmployeeId) return people.filter((e) => e.id === s.subjectEmployeeId).map((e) => e.id)
  return people
    .filter((e) => e.status !== 'onboarding' || e.hireDate <= day)
    .filter((e) => {
      if (s.audience.type === 'departments') return !!e.departmentId && s.audience.departmentIds.includes(e.departmentId)
      if (s.audience.type === 'tenure') return s.audience.tenureBands.includes(tenureBandOf(e.hireDate, day))
      return true
    })
    .map((e) => e.id)
}

/** Opens a survey now: freezes the audience and tells it (once). */
export function openSurvey(s: Tenant<SurveyRecord>, today: string, stamp: string): number {
  s.status = 'open'
  s.targetEmployeeIds = targetsOf(s, s.companyId, today)
  if (!s.launchedAt) s.launchedAt = stamp
  if (!markOnce(s, 'open')) return 0
  const kind = s.kind === 'exit' ? 'Exit survey' : s.kind === 'enps' ? 'Quick pulse survey' : 'Survey'
  return notifyNonRespondents(s, `${kind}: ${s.name}`, `${s.anonymous ? 'Your answers are anonymous. ' : ''}Please answer by ${s.closesOn}.`, stamp)
}

const STEP: Record<string, number> = { monthly: 1, quarterly: 3 }
const baseName = (name: string) => name.replace(/\s·\s\d{4}-\d{2}$/, '')

/** The next wave of a recurring series, when its day has come (company calendar). Returns the new wave. */
export function createNextWave(latest: Tenant<SurveyRecord>, today: string, stamp: string): Tenant<SurveyRecord> | null {
  const step = STEP[latest.recurrence]
  if (!step || latest.status === 'draft') return null
  const next = addMonthsIso(latest.opensOn, step)
  if (today < next || latest.marks.includes(`next:${next}`)) return null
  latest.marks.push(`next:${next}`)
  const length = Math.max(1, daysBetweenIso(latest.opensOn, latest.closesOn))
  const wave: Tenant<SurveyRecord> = {
    ...structuredClone(latest),
    id: nextEngId('ESV-'),
    name: `${baseName(latest.name)} · ${today.slice(0, 7)}`,
    status: 'open',
    opensOn: today,
    closesOn: addDaysIso(today, length),
    wave: latest.wave + 1,
    targetEmployeeIds: [],
    launchedAt: stamp,
    closedAt: null,
    createdAt: stamp,
    createdBy: null,
    createdByName: 'System (recurring pulse)',
    marks: [],
  }
  hrEngSurveys.push(wave)
  openSurvey(wave, today, stamp)
  return wave
}

/** Exit surveys for employees on notice (once per employee). */
export function sendExitSurveys(co: string, today: string, stamp: string): number {
  if (!engSettingsOf(co).exitSurveyAuto) return 0
  const t = templateByKey('exit')!
  let sent = 0
  for (const e of employeesOf(co)) {
    if (e.status !== 'notice' || !canAnswer(e)) continue
    if (hrEngSurveys.some((s) => s.companyId === co && s.kind === 'exit' && s.subjectEmployeeId === e.id)) continue
    const journey = hrJourneys.find((j) => j.companyId === co && j.employeeId === e.id && j.kind === 'offboarding' && j.status !== 'cancelled')
    const closesOn = e.exitDate && e.exitDate > today ? e.exitDate : addDaysIso(today, 7)
    const s: Tenant<SurveyRecord> = {
      companyId: co,
      id: nextEngId('ESV-'),
      name: `Exit survey · ${e.fullName}`,
      kind: 'exit',
      templateKey: 'exit',
      anonymous: false,
      status: 'draft',
      questions: structuredClone(t.questions),
      audience: { type: 'all', departmentIds: [], tenureBands: [] },
      opensOn: today,
      closesOn,
      recurrence: 'none',
      seriesId: '',
      wave: 1,
      targetEmployeeIds: [],
      subjectEmployeeId: e.id,
      journeyId: journey?.id ?? null,
      launchedAt: null,
      closedAt: null,
      createdAt: stamp,
      createdBy: null,
      createdByName: 'System (notice)',
      marks: [],
    }
    s.seriesId = s.id
    hrEngSurveys.push(s)
    openSurvey(s, today, stamp)
    sent++
  }
  return sent
}

function surveyReminders(s: Tenant<SurveyRecord>, today: string, stamp: string): number {
  const left = daysBetweenIso(today, s.closesOn)
  const length = daysBetweenIso(s.opensOn, s.closesOn)
  const mid = addDaysIso(s.opensOn, Math.floor(length / 2))
  if (left <= 1) {
    const sent = markOnce(s, 'last') ? notifyNonRespondents(s, `Last day to answer: ${s.name}`, `The survey closes ${left <= 0 ? 'today' : 'tomorrow'} (${s.closesOn}).`, stamp) : 0
    if (!s.marks.includes('mid')) s.marks.push('mid')
    return sent
  }
  if (mid > s.opensOn && today >= mid && markOnce(s, 'mid')) return notifyNonRespondents(s, `Reminder: ${s.name}`, `There is still time to answer. The survey closes on ${s.closesOn}.`, stamp)
  return 0
}

function feedbackReminders(co: string, today: string, stamp: string): number {
  let sent = 0
  for (const r of hrFbRounds) {
    if (r.companyId !== co || r.status !== 'open') continue
    const left = daysBetweenIso(today, r.deadline)
    const kind = left < 0 ? 'overdue' : left <= 2 ? 'due' : null
    if (!kind) continue
    for (const p of hrFbProviders) {
      if (p.companyId !== co || p.roundId !== r.id || p.status !== 'pending') continue
      if (!markOnce(p, `${kind}:${r.deadline}`)) continue
      const to = activeUserIdOf(co, p.employeeId)
      if (!to) continue
      sent += notifyUsers(co, [to], kind === 'overdue' ? 'Feedback request overdue' : 'Feedback request due soon', kind === 'overdue' ? `It was due ${r.deadline}. Please answer or decline.` : `Please answer by ${r.deadline}.`, `/hr/feedback?invitation=${encodeURIComponent(p.id)}`, stamp)
    }
  }
  return sent
}

export function runEngagementTick(companyId: string, at: Date = clockNow()): { opened: number; closed: number; waves: number; reminded: number; exit: number } {
  const out = { opened: 0, closed: 0, waves: 0, reminded: 0, exit: 0 }
  if (!companyModules(companyId).includes('hr')) return out
  const today = companyDayOf(companyId, at).today
  const stamp = at.toISOString()
  for (const s of [...hrEngSurveys]) {
    if (s.companyId !== companyId) continue
    if (s.status === 'scheduled' && today >= s.opensOn) {
      openSurvey(s, today, stamp)
      out.opened++
    }
    if (s.status === 'open' && today > s.closesOn) {
      s.status = 'closed'
      s.closedAt = stamp
      out.closed++
    } else if (s.status === 'open') {
      out.reminded += surveyReminders(s, today, stamp)
    }
  }
  // Recurring series: only the latest wave of each series can spawn the next one.
  const latest = new Map<string, Tenant<SurveyRecord>>()
  for (const s of hrEngSurveys) if (s.companyId === companyId && s.status !== 'draft' && (latest.get(s.seriesId)?.wave ?? 0) < s.wave) latest.set(s.seriesId, s)
  for (const s of latest.values()) if (createNextWave(s, today, stamp)) out.waves++
  out.exit = sendExitSurveys(companyId, today, stamp)
  out.reminded += feedbackReminders(companyId, today, stamp)
  return out
}

onLifecycleTick('hr-engagement', (companyId, until) => runEngagementTick(companyId, new Date(until)))

export { ENG_LINK }
