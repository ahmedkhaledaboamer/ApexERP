import { defineMapper } from './mapping'
import type { BudgetDetail, BudgetRow, BudgetVsActual, CashForecast } from '@/modules/finance/planning/types'

/** Wire names of Accounts & finance › Budgets and Cash-flow forecast: plain snake_case at any depth (fiscal_year, ytd_budget, opening_cash…). */
const deep = <T>() => defineMapper<T>({ deep: true })

export const budgetRowMapper = deep<BudgetRow>()
export const budgetMapper = deep<BudgetDetail>()
export const budgetVsActualMapper = deep<BudgetVsActual>()
export const cashForecastMapper = deep<CashForecast>()
export const planningPlainMapper = deep<Record<string, unknown>>()
