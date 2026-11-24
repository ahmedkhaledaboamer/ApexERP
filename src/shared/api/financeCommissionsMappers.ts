import { defineMapper } from './mapping'
import type { CommissionPlan, CommissionPlanInput, CommissionStatement, MyCommissions } from '@/modules/finance/commissions/types'

/** Wire names of Accounts & finance › Commissions: plain snake_case at any depth (cap_per_month, min_achievement, user_ids, base_total…). */
const deep = <T>() => defineMapper<T>({ deep: true })

export const commissionPlanMapper = deep<CommissionPlan>()
export const commissionPlanInputMapper = deep<CommissionPlanInput>()
export const commissionStatementMapper = deep<CommissionStatement>()
export const myCommissionsMapper = deep<MyCommissions>()
export const commissionPlainMapper = deep<Record<string, unknown>>()
