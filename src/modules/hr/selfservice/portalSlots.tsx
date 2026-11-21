import { lazy, type ComponentType } from 'react'

/**
 * SLOTS of the "My HR" portal (/hr/me) for cards owned by other HR sections. The portal renders each slot that is
 * not null, in this order, each in its own Suspense (`data-slot="<id>"`): a card fetches its own data, must only show
 * the caller's own records, and should render nothing (return null) when it has nothing to show.
 *
 *   onboarding  "My onboarding tasks" — HR › Onboarding & offboarding: MyOnboardingTasksCard (GET /hr/journeys/my-tasks).
 *   reviews     "My reviews"          — HR › Performance reviews: MyPerformanceCard (GET /hr/performance/my).
 *   expenses    "My expense claims"   — Accounts & finance › Expenses: MyExpenseClaimsCard (GET /finance/expense-claims).
 *   budget      "My department budget" — Accounts & finance › Budgets: MyDepartmentBudgetCard (department heads; GET /finance/budgets/:id/vs-actual).
 *
 * Plug-in contract: a one-line edit of this object (a lazy component without required props); nothing else changes.
 */
export interface PortalSlot {
  /** Section heading for the slot's area (the card may render its own title too). */
  label: string
  component: ComponentType | null
}

export type PortalSlotId = 'onboarding' | 'reviews' | 'expenses' | 'budget'

export const MY_HR_SLOTS: Record<PortalSlotId, PortalSlot> = {
  onboarding: {
    label: 'My onboarding tasks',
    component: lazy(() => import('@/modules/hr/journey/components/MyOnboardingTasksCard').then((m) => ({ default: () => <m.MyOnboardingTasksCard /> }))),
  },
  reviews: {
    label: 'My reviews',
    component: lazy(() => import('@/modules/hr/performance/components/MyPerformanceCard').then((m) => ({ default: () => <m.MyPerformanceCard /> }))),
  },
  expenses: {
    label: 'My expense claims',
    component: lazy(() => import('@/modules/finance/expenses/components/MyExpenseClaimsCard').then((m) => ({ default: () => <m.MyExpenseClaimsCard /> }))),
  },
  budget: {
    label: 'My department budget',
    component: lazy(() => import('@/modules/finance/planning/components/MyDepartmentBudgetCard').then((m) => ({ default: () => <m.MyDepartmentBudgetCard /> }))),
  },
}

export const PORTAL_SLOT_ORDER: PortalSlotId[] = ['onboarding', 'reviews', 'expenses', 'budget']
