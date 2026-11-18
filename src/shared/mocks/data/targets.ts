import { format } from 'date-fns'
import { users } from '@/shared/mocks/db'
import { perTenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'
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

/** Seeded company defaults: Apex uses the factory values; Crest runs a smaller, visit-heavy B2B logistics team. */
const DEFAULTS_SEED: Record<string, TargetValues> = {
  co_apex: { ...DEFAULT_TARGETS },
  co_crest: { leads: 300, calls: 600, emails: 400, visits: 12, meetings: 8, proposals: 6, partnerships: 2, events: 1 },
}

const defaultsStore = perTenant<TargetValues>((companyId) => ({ ...(DEFAULTS_SEED[companyId] ?? DEFAULT_TARGETS) }), 'targetDefaults')

/**
 * Mutable company defaults (Settings > Targets, PUT /targets/defaults), per company. Every month
 * without a per-agent row uses the *current* defaults. A value of 0 means "no target" for that kind.
 */
export function targetDefaultsFor(companyId: string): TargetValues {
  return defaultsStore.get(companyId)
}

/** One agent's targets for one month (`month` is `yyyy-MM`). */
export interface AgentTarget {
  userId: string
  month: string
  values: TargetValues
}

/** Overrides seeded for every other sales agent of a company this month, so both cases show up. */
function seedOverrides(companyId: string): AgentTarget[] {
  const base = DEFAULTS_SEED[companyId] ?? DEFAULT_TARGETS
  return users
    .filter((u) => u.companyId === companyId && u.role === 'Sales Agent')
    .filter((_, i) => i % 2 === 0)
    .map((u, i) => ({
      userId: u.id,
      month: format(new Date(), 'yyyy-MM'),
      values: { ...base, calls: base.calls + i * 100, visits: base.visits + i, events: i === 0 ? 2 : 0 },
    }))
}

/**
 * Mutable store of per-agent overrides; agents without a row for a month use their company's
 * defaults. Rows are keyed by the globally unique user id.
 */
export const agentTargets: AgentTarget[] = registerArray('agentTargets', [...seedOverrides('co_apex'), ...seedOverrides('co_crest')])

const companyOf = (userId: string) => users.find((u) => u.id === userId)?.companyId ?? 'co_apex'

export function targetsFor(userId: string, month: string): TargetValues {
  return { ...(agentTargets.find((t) => t.userId === userId && t.month === month)?.values ?? targetDefaultsFor(companyOf(userId))) }
}

export function hasOverride(userId: string, month: string): boolean {
  return agentTargets.some((t) => t.userId === userId && t.month === month)
}
