import type { AgingBucket, BudgetStatus, ForecastLine } from '@/modules/finance/planning/types'
import type { Tenant } from '@/shared/mocks/tenant'
import { perTenant } from '@/shared/mocks/tenant'
import { registerArray } from '@/shared/mocks/persist/registry'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { DEFAULT_PROBABILITIES } from '@/modules/finance/planning/calc'

/**
 * Accounts & finance › Budgets & cash-flow forecast stores (docs/API.md › Finance › Budgets, Cash-flow forecast).
 *  - `fin.budgets`: one budget per company and fiscal year; lines per department × income / expense account with 12
 *    monthly amounts (fiscal months); approval locks it; once-only alert marks.
 *  - `perTenant:fin.forecastSettings`: collection probabilities by aging bucket, scenario %, minimum cash, manual lines.
 * Seed: an approved budget of the current year for Apex and Crest (salaries, allowances and a few running costs per
 * department, close to the seeded payroll). Synthetic data only.
 */

export interface BudgetLineRecord {
  id: string
  departmentId: string
  accountId: string
  months: number[]
}

export interface BudgetRecord {
  id: string
  fiscalYear: number
  name: string
  status: BudgetStatus
  lines: BudgetLineRecord[]
  approvedBy: string | null
  approvedAt: string | null
  /** Once-only alert keys (`<department>:<month|ytd>:<90|100>:<yyyy-MM>`). */
  alertMarks: string[]
  history: { at: string; by: string | null; action: string; summary: string }[]
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ForecastSettingsRecord {
  probabilities: Record<AgingBucket, number>
  bouncedPdcPct: number
  inflowAdjustPct: number
  outflowAdjustPct: number
  minimumCash: number
  lines: ForecastLine[]
  updatedAt: string | null
  updatedBy: string | null
}

const YEAR = new Date().getUTCFullYear()
const SEED_AT = `${YEAR}-01-05T08:00:00.000Z`
const even = (monthly: number) => Array(12).fill(monthly) as number[]

type SeedLine = [department: string, account: string, monthly: number]
const APEX_LINES: SeedLine[] = [
  ['d-management', 'ACC-6100', 21000],
  ['d-management', 'ACC-6110', 7250],
  ['d-management', 'ACC-6200', 10000],
  ['d-sales', 'ACC-6100', 74000],
  ['d-sales', 'ACC-6110', 23000],
  ['d-sales', 'ACC-6500', 1500],
  ['d-marketing', 'ACC-6100', 16500],
  ['d-marketing', 'ACC-6110', 5500],
  ['d-marketing', 'ACC-6600', 3000],
  ['d-delivery', 'ACC-6100', 90000],
  ['d-delivery', 'ACC-6110', 30000],
  ['d-delivery', 'ACC-6130', 1800],
  ['d-finance', 'ACC-6100', 18000],
  ['d-finance', 'ACC-6110', 5500],
  ['d-finance', 'ACC-6700', 1500],
  ['d-hr', 'ACC-6100', 27500],
  ['d-hr', 'ACC-6110', 7100],
  ['d-hr', 'ACC-6130', 3200],
  ['d-it', 'ACC-6100', 6000],
  ['d-it', 'ACC-6110', 2800],
  ['d-it', 'ACC-6130', 950],
]
const CREST_LINES: SeedLine[] = [
  ['c2-management', 'ACC-6100', 7500],
  ['c2-management', 'ACC-6110', 2875],
  ['c2-sales', 'ACC-6100', 34500],
  ['c2-sales', 'ACC-6110', 11500],
  ['c2-sales', 'ACC-6500', 1000],
  ['c2-ops', 'ACC-6100', 85000],
  ['c2-ops', 'ACC-6110', 27000],
  ['c2-ops', 'ACC-6130', 4300],
  ['c2-ops', 'ACC-6200', 15000],
  ['c2-it', 'ACC-6100', 6000],
  ['c2-it', 'ACC-6110', 2800],
]

function seedBudget(companyId: string, id: string, approvedBy: string, linePrefix: number, rows: SeedLine[]): Tenant<BudgetRecord> {
  return {
    companyId,
    id,
    fiscalYear: YEAR,
    name: `Operating budget ${YEAR}`,
    status: 'approved',
    lines: rows.map(([departmentId, accountId, monthly], i) => ({ id: `BL-${linePrefix + i}`, departmentId, accountId, months: even(monthly) })),
    approvedBy,
    approvedAt: SEED_AT,
    alertMarks: [],
    history: [
      { at: `${YEAR}-01-03T08:00:00.000Z`, by: null, action: 'created', summary: 'Created' },
      { at: SEED_AT, by: approvedBy, action: 'approved', summary: 'Approved and locked' },
    ],
    createdBy: null,
    createdAt: `${YEAR}-01-03T08:00:00.000Z`,
    updatedAt: SEED_AT,
  }
}

// Seed ids sit below the generated range (nextId('budget') starts at BUD-1001, lines at BL-1001).
export const finBudgets = registerArray<Tenant<BudgetRecord>>('fin.budgets', [seedBudget(APEX_ID, 'BUD-901', 'u2', 90001, APEX_LINES), seedBudget(CREST_ID, 'BUD-951', 'u102', 95001, CREST_LINES)])


function seedForecast(companyId: string): ForecastSettingsRecord {
  const base: ForecastSettingsRecord = { probabilities: { ...DEFAULT_PROBABILITIES }, bouncedPdcPct: 70, inflowAdjustPct: 0, outflowAdjustPct: 0, minimumCash: 0, lines: [], updatedAt: null, updatedBy: null }
  if (companyId !== APEX_ID) return base
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 20)
  return { ...base, minimumCash: 50000, lines: [{ id: 'FCL-901', label: 'Trade licence renewal', date: d.toISOString().slice(0, 10), amount: -15000, recurrence: 'once' }] }
}

export const finForecastSettings = perTenant(seedForecast, 'fin.forecastSettings')
