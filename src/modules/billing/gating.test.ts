import { describe, expect, it } from 'vitest'
import type { Plan, PlanModule } from '@/modules/billing/types'
import { ALL_NAV_ITEMS } from '@/shared/components/layout/navigation'
import {
  cheapestPlanAbove,
  cheapestPlanWith,
  downgradeBlockMessage,
  meterWidth,
  navItemAccess,
  navItemVisible,
  paletteItems,
  planIncludes,
  routeDecision,
  usagePercent,
  usageTone,
} from '@/modules/billing/gating'
import { toBillingEvent } from '@/shared/lib/billingEvents'

const STARTER_MODULES: PlanModule[] = ['sales', 'services', 'tasks', 'departments', 'reports', 'settings']
const starter = { modules: STARTER_MODULES }
const business = { modules: [...STARTER_MODULES, 'marketing', 'accounting', 'events', 'integrations'] as PlanModule[] }
const enterprise = { modules: [...business.modules, 'hr', 'ai'] as PlanModule[] }

const item = (label: string) => {
  const found = ALL_NAV_ITEMS.find((i) => i.label === label)
  if (!found) throw new Error(`No nav item ${label}`)
  return found
}

function plan(id: string, rank: number, modules: PlanModule[], users: number | null, extra: Partial<Plan> = {}): Plan {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    price: rank * 10,
    currency: 'USD',
    billingPeriod: 'month',
    limits: { users, leadsContacts: 1000, storageMb: 500, emailsPerMonth: 1000, aiCredits: null },
    modules,
    highlights: [],
    checkout: 'payment',
    active: true,
    rank,
    ...extra,
  }
}

const PLANS: Plan[] = [
  plan('enterprise', 3, enterprise.modules, null, { checkout: 'contact' }),
  plan('starter', 1, STARTER_MODULES, 5),
  plan('business', 2, business.modules, 25),
  plan('trial', 0, STARTER_MODULES, 5, { checkout: 'none' }),
  plan('legacy', 1, enterprise.modules, 3, { active: false }),
]

describe('plan includes', () => {
  it('always includes non-gateable modules, even before entitlements load', () => {
    expect(planIncludes(null, 'sales')).toBe(true)
    expect(planIncludes(starter, 'settings')).toBe(true)
  })
  it('includes gateable modules only when the plan lists them', () => {
    expect(planIncludes(null, 'hr')).toBe(false)
    expect(planIncludes(starter, 'marketing')).toBe(false)
    expect(planIncludes(business, 'marketing')).toBe(true)
    expect(planIncludes(business, 'hr')).toBe(false)
    expect(planIncludes(enterprise, 'ai')).toBe(true)
  })
})

describe('nav visibility per plan + role', () => {
  it('locks plan-excluded modules for a role that could use them', () => {
    const ctx = { role: 'Company Admin' as const, entitlements: starter }
    expect(navItemAccess(item('Employees'), ctx)).toBe('locked')
    expect(navItemAccess(item('Campaigns'), ctx)).toBe('locked')
    expect(navItemAccess(item('Invoices'), ctx)).toBe('locked')
    expect(navItemAccess(item('Events'), ctx)).toBe('locked')
    expect(navItemAccess(item('Integrations'), ctx)).toBe('locked')
    expect(navItemAccess(item('AI assistant'), ctx)).toBe('locked')
    expect(navItemAccess(item('Leads'), ctx)).toBe('visible')
    expect(navItemVisible(item('Employees'), ctx)).toBe(true)
  })
  it('hides what the role cannot view, whatever the plan', () => {
    const agent = { role: 'Sales Agent' as const, entitlements: enterprise }
    expect(navItemAccess(item('Employees'), agent)).toBe('hidden')
    expect(navItemAccess(item('Settings'), agent)).toBe('hidden')
    expect(navItemAccess(item('Integrations'), agent)).toBe('hidden')
    expect(navItemAccess(item('AI assistant'), agent)).toBe('visible')
    expect(navItemAccess(item('Leads'), agent)).toBe('visible')
    expect(navItemAccess(item('Leads'), { role: null, entitlements: enterprise })).toBe('hidden')
  })
  it('shows everything the role can view on a plan that includes it', () => {
    const ctx = { role: 'Company Admin' as const, entitlements: enterprise }
    for (const label of ['Employees', 'Campaigns', 'Invoices', 'Events', 'Integrations', 'AI assistant']) {
      expect(navItemAccess(item(label), ctx)).toBe('visible')
    }
  })
  it('keeps gateable items out (not locked) while entitlements load', () => {
    const ctx = { role: 'Company Admin' as const, entitlements: null }
    expect(navItemAccess(item('Employees'), ctx)).toBe('hidden')
    expect(navItemAccess(item('Leads'), ctx)).toBe('visible')
  })
})

describe('command palette filter', () => {
  it('lists only items the user can open now', () => {
    const labels = paletteItems(ALL_NAV_ITEMS, { role: 'Company Admin', entitlements: business }).map((i) => i.label)
    expect(labels).toContain('Campaigns')
    expect(labels).toContain('Events')
    expect(labels).not.toContain('Employees')
    expect(labels).not.toContain('AI assistant')
    const agent = paletteItems(ALL_NAV_ITEMS, { role: 'Sales Agent', entitlements: starter }).map((i) => i.label)
    expect(agent).not.toContain('Settings')
    expect(agent).not.toContain('Events')
    expect(agent).toContain('Leads')
  })
})

describe('route decision', () => {
  it('shows the upgrade page for a plan-excluded module (plan before role)', () => {
    expect(routeDecision({ module: 'hr' }, { role: 'Company Admin', entitlements: starter })).toBe('upgrade')
    expect(routeDecision({ module: 'hr' }, { role: 'Sales Agent', entitlements: starter })).toBe('upgrade')
    expect(routeDecision({ planModule: 'ai' }, { role: 'Employee', entitlements: business })).toBe('upgrade')
  })
  it('forbids roles without view access on included modules', () => {
    expect(routeDecision({ module: 'hr' }, { role: 'Sales Agent', entitlements: enterprise })).toBe('forbidden')
    expect(routeDecision({ module: 'settings' }, { role: 'Employee', entitlements: enterprise })).toBe('forbidden')
  })
  it('allows included modules for roles that can view them', () => {
    expect(routeDecision({ module: 'sales' }, { role: 'Sales Agent', entitlements: starter })).toBe('allow')
    expect(routeDecision({ module: 'marketing' }, { role: 'Marketing Manager', entitlements: business })).toBe('allow')
    expect(routeDecision({ module: 'settings', planModule: 'integrations' }, { role: 'Company Admin', entitlements: business })).toBe('allow')
  })
  it('waits for entitlements on gateable modules only', () => {
    expect(routeDecision({ module: 'hr' }, { role: 'Company Admin', entitlements: null, entitlementsLoading: true })).toBe('loading')
    expect(routeDecision({ module: 'sales' }, { role: 'Company Admin', entitlements: null, entitlementsLoading: true })).toBe('allow')
  })
})

describe('cheapest plan', () => {
  it('finds the lowest-ranked active plan with the module', () => {
    expect(cheapestPlanWith('marketing', PLANS, 'starter')?.id).toBe('business')
    expect(cheapestPlanWith('hr', PLANS, 'starter')?.id).toBe('enterprise')
    expect(cheapestPlanWith('hr', PLANS, 'enterprise')).toBeNull()
  })
  it('finds the lowest-ranked plan with room above the current count', () => {
    expect(cheapestPlanAbove('users', 5, PLANS, 'starter')?.id).toBe('business')
    expect(cheapestPlanAbove('users', 30, PLANS, 'business')?.id).toBe('enterprise')
  })
})

describe('usage meter', () => {
  it('computes percent, null when unlimited', () => {
    expect(usagePercent(4, 5)).toBe(80)
    expect(usagePercent(7, 5)).toBe(140)
    expect(usagePercent(3, null)).toBeNull()
    expect(usagePercent(0, 0)).toBe(0)
    expect(usagePercent(1, 0)).toBe(100)
  })
  it('tones: ok below 80, amber from 80, red from 100, unlimited', () => {
    expect(usageTone(0)).toBe('ok')
    expect(usageTone(79)).toBe('ok')
    expect(usageTone(80)).toBe('warning')
    expect(usageTone(99)).toBe('warning')
    expect(usageTone(100)).toBe('danger')
    expect(usageTone(140)).toBe('danger')
    expect(usageTone(null)).toBe('unlimited')
    expect(usageTone(70, [70, 90])).toBe('warning')
    expect(usageTone(90, [90, 70])).toBe('danger')
  })
  it('clamps the bar width', () => {
    expect(meterWidth(140)).toBe(100)
    expect(meterWidth(-5)).toBe(0)
    expect(meterWidth(null)).toBe(0)
    expect(meterWidth(42)).toBe(42)
  })
})

describe('downgrade blocks and billing errors', () => {
  it('explains what to do', () => {
    expect(downgradeBlockMessage({ key: 'users', label: 'Users', used: 7, limit: 5 }, 'Starter')).toBe(
      'You have 7 users; Starter allows 5. Deactivate 2 users first.',
    )
  })
  it('types LIMIT_REACHED, module_not_in_plan and read-only bodies', () => {
    expect(toBillingEvent('LIMIT_REACHED', 'm', { code: 'LIMIT_REACHED', limit: 'users', current: 5, max: 5, planId: 'starter' })).toEqual({
      kind: 'limit',
      message: 'm',
      details: { code: 'LIMIT_REACHED', limit: 'users', current: 5, max: 5, planId: 'starter' },
    })
    expect(toBillingEvent('module_not_in_plan', 'm', { module: 'hr', planId: 'starter' })?.kind).toBe('module')
    expect(toBillingEvent('workspace_read_only', 'm', { status: 'suspended' })?.kind).toBe('read_only')
    expect(toBillingEvent('validation', 'm', {})).toBeNull()
  })
})
