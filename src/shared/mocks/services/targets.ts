import { endOfMonth, format, getDaysInMonth, isSameMonth, isValid, parse, startOfMonth } from 'date-fns'
import type { ActivityType, User } from '@/shared/types'
import { MAX_TARGET, type AgentTargetRow, type TargetDefaults, type TargetsMonth, type TargetValues } from '@/modules/targets/types'
import { can, scopeOf, teamIdsFor } from '@/shared/lib/permissions'
import { departments } from '@/shared/mocks/data/departments'
import { activities, leads, users } from '@/shared/mocks/db'
import {
  agentTargets,
  DEFAULT_TARGETS,
  hasOverride,
  TARGET_KEYS,
  TARGET_LABELS,
  targetDefaults,
  targetsFor,
  type TargetKey,
} from '@/shared/mocks/data/targets'
import { isWonStatus, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { isTracked } from '@/modules/targets/lib'

/**
 * Monthly activity targets per sales agent. Actuals are calculated from logged activities
 * and lead records, never typed in (spec: "calculated from logged activities automatically").
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Kinds with no data source yet; their actual stays 0 (events: until EVENTS_ENABLED). Every
 * completion figure leaves them out (see isTracked in modules/targets/lib).
 */
const NOT_TRACKED: TargetKey[] = TARGET_KEYS.filter((k) => !isTracked(k))

const TYPES_FOR: Partial<Record<TargetKey, ActivityType[]>> = {
  calls: ['call'],
  emails: ['email', 'whatsapp'],
  visits: ['visit'],
  meetings: ['meeting'],
}

function parseMonth(month: string | null | undefined): Date | null {
  if (!month) return startOfMonth(new Date())
  if (!MONTH_RE.test(month)) return null
  const d = parse(month, 'yyyy-MM', new Date())
  return isValid(d) ? d : null
}

/** Share of the month already elapsed: 1 for past months, 0 for future ones. */
function elapsedOf(month: Date): number {
  const now = new Date()
  if (isSameMonth(month, now)) return now.getDate() / getDaysInMonth(now)
  return endOfMonth(month) < now ? 1 : 0
}

/** Agents whose targets the user may see: just themselves on `own`, sales agents otherwise. */
function agentsFor(user: User): User[] {
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') return []
  if (scope === 'own') return [user]
  const agents = users.filter((u) => u.role === 'Sales Agent')
  if (scope === 'team') {
    const team = teamIdsFor(user, users, departments)
    return agents.filter((u) => team.includes(u.id))
  }
  return agents
}

/** Sales scope full or team may set targets; agents and read-only roles may not. */
function canEdit(user: User): boolean {
  const scope = scopeOf(user.role, 'sales')
  return scope === 'full' || scope === 'team'
}

/** Stable 0..99 per agent, kind and month, so the synthetic baseline never jumps around. */
function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h % 100
}

/**
 * Real counts from the db. The seed only holds a handful of activities, so the mock adds a
 * stable synthetic baseline paced to the elapsed share of the month (55-115% of pace). The
 * real backend returns the real counts only.
 */
function actualsFor(userId: string, month: Date, values: TargetValues): TargetValues {
  const monthKey = format(month, 'yyyy-MM')
  const elapsed = elapsedOf(month)
  const isCurrent = isSameMonth(month, new Date())
  const acts = activities.filter((a) => a.userId === userId && isSameMonth(new Date(a.at), month))
  const owned = leads.filter((l) => l.ownerId === userId)

  const real = (key: TargetKey): number => {
    const types = TYPES_FOR[key]
    if (types) return acts.filter((a) => types.includes(a.type)).length
    if (key === 'leads') return owned.filter((l) => isSameMonth(new Date(l.createdAt), month)).length
    if (key === 'proposals') {
      // This month: leads sitting in Proposal now. Past months: leads that reached it (or won) then.
      const atProposal = (status: string) => status === SYSTEM_STATUS.proposal
      return isCurrent
        ? owned.filter((l) => atProposal(l.status)).length
        : owned.filter((l) => (atProposal(l.status) || isWonStatus(l.status)) && isSameMonth(new Date(l.stageChangedAt), month)).length
    }
    return 0 // Partnerships and events aren't modelled yet.
  }

  return Object.fromEntries(
    TARGET_KEYS.map((key) => {
      if (NOT_TRACKED.includes(key)) return [key, 0]
      const pace = 0.55 + (hash(`${userId}:${key}:${monthKey}`) % 61) / 100
      const baseline = Math.round(values[key] * elapsed * pace)
      return [key, baseline + real(key)]
    }),
  ) as TargetValues
}

/** One agent's targets and actuals for a month (also used by department figures). */
export function rowFor(agent: User, month: Date): AgentTargetRow {
  const monthKey = format(month, 'yyyy-MM')
  const values = targetsFor(agent.id, monthKey)
  return {
    userId: agent.id,
    name: agent.name,
    title: agent.title,
    values,
    actuals: actualsFor(agent.id, month, values),
    isDefault: !hasOverride(agent.id, monthKey),
  }
}

/**
 * Sum of targets and actuals for every agent in the user's scope (used by the dashboard).
 * A kind counts for an agent only when that agent has a target for it (0 = no target), so a
 * kind nobody has a target for comes back as 0 / 0: callers show "No target" for it.
 */
export function targetTotalsFor(user: User, month = new Date()): { values: TargetValues; actuals: TargetValues } {
  const zero = () => Object.fromEntries(TARGET_KEYS.map((k) => [k, 0])) as TargetValues
  const values = zero()
  const actuals = zero()
  for (const agent of agentsFor(user)) {
    const row = rowFor(agent, startOfMonth(month))
    for (const k of TARGET_KEYS) {
      if (row.values[k] <= 0) continue
      values[k] += row.values[k]
      actuals[k] += row.actuals[k]
    }
  }
  return { values, actuals }
}

export async function getTargets(user: User, monthParam: string | null): Promise<TargetsMonth> {
  if (scopeOf(user.role, 'sales') === 'hidden') return fail('Your role has no access to sales targets.', 403)
  const month = parseMonth(monthParam)
  if (!month) return fail('Use the month format yyyy-MM.', 422)
  const rows = agentsFor(user)
    .map((a) => rowFor(a, month))
    .sort((a, b) => a.name.localeCompare(b.name))
  return delay({ month: format(month, 'yyyy-MM'), elapsed: elapsedOf(month), canEdit: canEdit(user), rows })
}

export async function updateTargets(
  user: User,
  userId: string,
  monthParam: string | null,
  input: { values?: Partial<TargetValues> },
): Promise<AgentTargetRow> {
  if (!canEdit(user)) return fail('Only sales managers can change targets.', 403)
  const month = parseMonth(monthParam)
  if (!month) return fail('Use the month format yyyy-MM.', 422)
  const agent = agentsFor(user).find((u) => u.id === userId)
  if (!agent) {
    return users.some((u) => u.id === userId)
      ? fail('That agent is outside your team.', 403)
      : fail('That agent doesn’t exist.', 404)
  }
  const values = readValues(input.values)
  if (typeof values === 'string') return fail(values, 422)
  const monthKey = format(month, 'yyyy-MM')
  const before = targetsFor(userId, monthKey)
  const existing = agentTargets.find((t) => t.userId === userId && t.month === monthKey)
  if (existing) existing.values = values
  else agentTargets.push({ userId, month: monthKey, values })
  recordAudit(user, {
    action: 'update',
    entity: 'targets',
    entityId: `${userId}:${monthKey}`,
    summary: `Set ${agent.name}’s targets for ${format(month, 'MMMM yyyy')}`,
    changes: labelled(diff(before, values)),
  })
  return delay(rowFor(agent, month))
}

/** Drops an agent's override for a month, so the company defaults apply again. */
export async function resetTargets(user: User, userId: string, monthParam: string | null): Promise<AgentTargetRow> {
  if (!canEdit(user)) return fail('Only sales managers can change targets.', 403)
  const month = parseMonth(monthParam)
  if (!month) return fail('Use the month format yyyy-MM.', 422)
  const agent = agentsFor(user).find((u) => u.id === userId)
  if (!agent) {
    return users.some((u) => u.id === userId)
      ? fail('That agent is outside your team.', 403)
      : fail('That agent doesn’t exist.', 404)
  }
  const monthKey = format(month, 'yyyy-MM')
  const index = agentTargets.findIndex((t) => t.userId === userId && t.month === monthKey)
  if (index >= 0) {
    const [removed] = agentTargets.splice(index, 1)
    recordAudit(user, {
      action: 'update',
      entity: 'targets',
      entityId: `${userId}:${monthKey}`,
      summary: `Reset ${agent.name}’s targets for ${format(month, 'MMMM yyyy')} to the defaults`,
      changes: labelled(diff(removed.values, targetDefaults)),
    })
  }
  return delay(rowFor(agent, month))
}

/* ---------------- Company defaults ---------------- */

/** Validates a full set of target values: every kind present, whole numbers 0..MAX (0 = no target). */
function readValues(input: Partial<Record<TargetKey, unknown>> | undefined): TargetValues | string {
  const values = { ...DEFAULT_TARGETS }
  for (const key of TARGET_KEYS) {
    const v = input?.[key]
    if (v === undefined || v === null) return `Set a target for every activity kind (${TARGET_LABELS[key]} is missing; use 0 for none).`
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_TARGET) {
      return `${TARGET_LABELS[key]}: targets must be whole numbers from 0 to ${MAX_TARGET.toLocaleString('en-US')}.`
    }
    values[key] = v
  }
  return values
}

function labelled(changes: ReturnType<typeof diff>) {
  return changes.map((c) => ({ ...c, field: TARGET_LABELS[c.field as TargetKey] ?? c.field }))
}

/** Readable by anyone who can see settings or sales targets. */
export async function getTargetDefaults(user: User): Promise<TargetDefaults> {
  if (!can(user.role, 'settings', 'view') && scopeOf(user.role, 'sales') === 'hidden') {
    return fail('Your role has no access to targets.', 403)
  }
  return delay({ values: targetDefaults, canEdit: can(user.role, 'settings', 'edit') })
}

/** System Admin only. Months without a per-agent row pick the new defaults up straight away. */
export async function saveTargetDefaults(user: User, input: { values?: Partial<TargetValues> }): Promise<TargetDefaults> {
  if (!can(user.role, 'settings', 'edit')) return fail('Only a System Admin can change the default targets.', 403)
  const values = readValues(input?.values)
  if (typeof values === 'string') return fail(values, 422)
  const changes = labelled(diff(targetDefaults, values))
  if (changes.length) {
    recordAudit(user, { action: 'update', entity: 'targets', entityId: 'defaults', summary: 'Changed the default monthly targets', changes })
  }
  Object.assign(targetDefaults, values)
  return delay({ values: targetDefaults, canEdit: true })
}
