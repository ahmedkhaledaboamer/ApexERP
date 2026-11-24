import type { CommissionLine, CommissionTier } from './types'

/** Pure commission math (shared by the mock server and tests). */

export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** The rate (%) for an achievement: the highest tier reached, else the base rate. */
export function rateForAchievement(baseRate: number, tiers: readonly CommissionTier[], achievement: number): number {
  const hit = [...tiers].sort((a, b) => b.minAchievement - a.minAchievement).find((t) => achievement >= t.minAchievement)
  return hit ? hit.rate : baseRate
}

/** Commission still earned on an invoice: its net × (1 − credited / total); 0 once it's no longer paid (refund / void). */
export function eligibleNet(inv: { status: string; total: number; amountCredited: number; net: number }): number {
  if (inv.status !== 'paid' || inv.total <= 0) return 0
  return r2(inv.net * Math.max(0, 1 - inv.amountCredited / inv.total))
}

/**
 * Clawback of an earlier commissioned invoice: what was paid minus what is still earned at the same rate, minus
 * what was already clawed back (never negative).
 */
export function clawbackOf(commissionPaid: number, rate: number, eligibleNow: number, alreadyClawed: number): number {
  return r2(Math.max(0, commissionPaid - r2((eligibleNow * rate) / 100) - alreadyClawed))
}

/** Statement totals: gross = base × rate (capped), total = gross − clawbacks. */
export function statementTotals(lines: readonly Pick<CommissionLine, 'kind' | 'baseAmount' | 'commission'>[], rate: number, cap: number | null) {
  const earning = lines.filter((l) => l.kind !== 'clawback')
  const baseTotal = r2(earning.reduce((s, l) => s + l.baseAmount, 0))
  const raw = r2((baseTotal * rate) / 100)
  const gross = cap !== null && cap >= 0 ? Math.min(raw, cap) : raw
  const clawback = r2(lines.filter((l) => l.kind === 'clawback').reduce((s, l) => s + l.commission, 0))
  return { baseTotal, gross: r2(gross), capped: gross < raw, clawback, total: r2(gross - clawback) }
}
