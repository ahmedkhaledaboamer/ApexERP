import { format } from 'date-fns'
import { users } from '@/shared/mocks/db'
import {
  RECOMMENDED_TARGETS,
  TARGET_KEYS,
  TARGET_LABELS,
  type TargetKey,
  type TargetValues,
} from '@/modules/targets/types'

/** Activity kinds with a monthly target (spec: Settings > Targets). One list, owned by the targets module. */
export { TARGET_KEYS, TARGET_LABELS, type TargetKey }

/** Factory defaults; "Reset" in Settings > Targets goes back to these. Events attended has none (0). */
export const DEFAULT_TARGETS: TargetValues = { ...RECOMMENDED_TARGETS }

/**
 * Mutable company defaults (Settings > Targets, PUT /targets/defaults). Every month without a
 * per-agent row uses the *current* defaults. A value of 0 means "no target" for that kind.
 */
export const targetDefaults: TargetValues = { ...DEFAULT_TARGETS }

/** One agent's targets for one month (`month` is `yyyy-MM`). */
export interface AgentTarget {
  userId: string
  month: string
  values: TargetValues
}

/**
 * Mutable store of per-agent overrides; agents without a row for a month use the defaults.
 * The seed overrides every other agent this month so both cases show up.
 */
export const agentTargets: AgentTarget[] = users
  .filter((u) => u.role === 'Sales Agent')
  .filter((_, i) => i % 2 === 0)
  .map((u, i) => ({
    userId: u.id,
    month: format(new Date(), 'yyyy-MM'),
    values: { ...DEFAULT_TARGETS, calls: DEFAULT_TARGETS.calls + i * 100, visits: DEFAULT_TARGETS.visits + i, events: i === 0 ? 2 : 0 },
  }))

export function targetsFor(userId: string, month: string): TargetValues {
  return { ...(agentTargets.find((t) => t.userId === userId && t.month === month)?.values ?? targetDefaults) }
}

export function hasOverride(userId: string, month: string): boolean {
  return agentTargets.some((t) => t.userId === userId && t.month === month)
}
