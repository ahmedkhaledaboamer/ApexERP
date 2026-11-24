import type { User } from '@/shared/types'
import type { Employee } from '@/modules/hr/types'
import { departmentSubtree } from '@/shared/lib/permissions'
import { users } from '@/shared/mocks/db'
import { departments } from '@/shared/mocks/data/departments'
import { hrEmployees } from '@/shared/mocks/data/hrEmployees'
import { hrEngParticipants, hrEngResponses, hrEngSurveys, type SurveyRecord } from '@/shared/mocks/data/hrEngagement'
import { CodedApiError, NOT_FOUND, type Tenant } from '@/shared/mocks/tenant'
import { notifyUsers, perfCtx, type PerfCtx } from './hrPerformanceCore'

/**
 * Shared rules of HR › Engagement surveys (docs/API.md › HR › Engagement surveys).
 *
 * WHO (matrix `hr` column; the company always comes from the session):
 *   full    Company Admin, Management, HR Manager: create / launch / close surveys, every result (company-wide,
 *           breakdowns, export), settings; individual answers of NON-anonymous surveys only
 *   team    Department Head: the aggregated results of the departments they head (+ sub-departments), with the
 *           5-response threshold; never exit / onboarding surveys, never individuals, no export
 *   anyone  (self-service, even with `hr` hidden) answers the surveys sent to them and edits their own answers
 *           until the survey closes
 */

export const ENG_LINK = (surveyId: string) => `/hr/engagement?answer=${encodeURIComponent(surveyId)}`

export const notFound = () => new CodedApiError(NOT_FOUND, 404, 'not_found')
export const forbidden = (message = 'Your role can’t do this in Engagement.') => new CodedApiError(message, 403, 'forbidden')
export const invalid = (message: string, code = 'validation_failed', details: Record<string, unknown> = {}) => new CodedApiError(message, 422, code, details)
export const conflict = (message: string, code: string) => new CodedApiError(message, 409, code)

export type EngCtx = PerfCtx

export const engCtx = (user: User, at?: Date): EngCtx => perfCtx(user, at)
export const isFull = (ctx: EngCtx) => ctx.scope === 'full'

export function requireFull(ctx: EngCtx): void {
  if (!isFull(ctx)) throw forbidden('Only HR (Company Admin, Management or HR Manager) can manage surveys.')
}

/** Departments a Department Head heads (with sub-departments); empty for everyone else. */
export function headedDepartmentIds(ctx: EngCtx): Set<string> {
  if (ctx.scope !== 'team') return new Set()
  const coDepts = departments.filter((d) => d.companyId === ctx.co)
  return new Set(coDepts.filter((d) => d.active && d.headId === ctx.user.id).flatMap((d) => departmentSubtree(d.id, coDepts)))
}

/** company (HR full), the headed departments (Department Head), or null (no results). */
export function resultsScope(ctx: EngCtx): 'company' | Set<string> | null {
  if (isFull(ctx)) return 'company'
  const headed = headedDepartmentIds(ctx)
  return headed.size ? headed : null
}

/** Surveys whose results a Department Head may see: launched, not one-person (exit / onboarding), reaching their departments. */
export function teamMaySee(s: SurveyRecord, headed: Set<string>): boolean {
  if (s.status === 'draft' || s.status === 'scheduled' || s.kind === 'exit' || s.kind === 'onboarding' || s.subjectEmployeeId) return false
  if (s.audience.type !== 'departments') return true
  return s.audience.departmentIds.some((id) => headed.has(id))
}

export const surveyOf = (co: string, id: string) => hrEngSurveys.find((s) => s.companyId === co && s.id === id)
export const responsesOf = (co: string, surveyId: string) => hrEngResponses.filter((r) => r.companyId === co && r.surveyId === surveyId)
export const participantsOf = (co: string, surveyId: string) => hrEngParticipants.filter((p) => p.companyId === co && p.surveyId === surveyId)
export const hasResponded = (co: string, surveyId: string, employeeId: string) => hrEngParticipants.some((p) => p.companyId === co && p.surveyId === surveyId && p.employeeId === employeeId)

/** Employees who can answer (active login, not terminated). */
export function canAnswer(e: Tenant<Employee>): boolean {
  return !!e.userId && e.status !== 'terminated' && users.some((u) => u.id === e.userId && u.companyId === e.companyId && u.active !== false)
}

export const activeUserIdOf = (co: string, employeeId: string): string | null => {
  const e = hrEmployees.find((x) => x.companyId === co && x.id === employeeId)
  return e && canAnswer(e) ? e.userId : null
}

/** Tells the targets who haven't answered yet (type `hr`); returns how many were told. */
export function notifyNonRespondents(s: Tenant<SurveyRecord>, title: string, body: string, at: string): number {
  const ids = s.targetEmployeeIds.filter((id) => !hasResponded(s.companyId, s.id, id)).map((id) => activeUserIdOf(s.companyId, id) ?? '')
  return notifyUsers(s.companyId, ids, title, body, ENG_LINK(s.id), at)
}
