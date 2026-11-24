import { lazy, type ComponentType } from 'react'

/**
 * SLOTS of the "My HR" portal (/hr/me) for cards owned by other HR sections. The portal renders each slot that is
 * not null, in this order, each in its own Suspense (`data-slot="<id>"`): a card fetches its own data, must only show
 * the caller's own records, and should render nothing (return null) when it has nothing to show.
 *
 *   onboarding  "My onboarding tasks" — HR › Onboarding & offboarding: MyOnboardingTasksCard (GET /hr/journeys/my-tasks).
 *   reviews     "My reviews"          — HR › Performance reviews: MyPerformanceCard (GET /hr/performance/my).
 *   policies    "Policies to acknowledge" — HR › Policies: MyPoliciesCard (GET /hr/policies/my; nothing when none apply).
 *   discipline  "My warnings"         — HR › Discipline: MyDisciplineCard (GET /hr/discipline?mine=1; acknowledge / appeal; nothing when none).
 *   approvals   "Approvals"           — Accounts & finance: MyApprovalsCard (POs / bills / claims awaiting the caller; nothing when none).
 *   purchases   "My purchase requests" — Accounts & finance › Purchases: MyPurchaseRequestsCard ("Request a purchase" + own POs).
 *   surveys     "Surveys to answer"   — HR › Engagement: MySurveysCard (GET /hr/engagement/my; nothing when none open).
 *   feedback    "Feedback requests"   — HR › 360° feedback: MyFeedbackCard (GET /hr/feedback/my; nothing when none).
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

export type PortalSlotId = 'onboarding' | 'reviews' | 'policies' | 'discipline' | 'approvals' | 'purchases' | 'expenses' | 'budget' | 'surveys' | 'feedback'

export const MY_HR_SLOTS: Record<PortalSlotId, PortalSlot> = {
  onboarding: {
    label: 'My onboarding tasks',
    component: lazy(() => import('@/modules/hr/journey/components/MyOnboardingTasksCard').then((m) => ({ default: () => <m.MyOnboardingTasksCard /> }))),
  },
  reviews: {
    label: 'My reviews',
    component: lazy(() => import('@/modules/hr/performance/components/MyPerformanceCard').then((m) => ({ default: () => <m.MyPerformanceCard /> }))),
  },
  policies: {
    label: 'Policies to acknowledge',
    component: lazy(() => import('@/modules/hr/compliance/components/MyComplianceCards').then((m) => ({ default: () => <m.MyPoliciesCard /> }))),
  },
  discipline: {
    label: 'My warnings',
    component: lazy(() => import('@/modules/hr/compliance/components/MyComplianceCards').then((m) => ({ default: () => <m.MyDisciplineCard /> }))),
  },
  approvals: {
    label: 'Approvals',
    component: lazy(() => import('@/modules/finance/purchases/components/MyApprovalsCard').then((m) => ({ default: () => <m.MyApprovalsCard /> }))),
  },
  purchases: {
    label: 'My purchase requests',
    component: lazy(() => import('@/modules/finance/purchases/components/MyPurchaseRequestsCard').then((m) => ({ default: () => <m.MyPurchaseRequestsCard /> }))),
  },
  expenses: {
    label: 'My expense claims',
    component: lazy(() => import('@/modules/finance/expenses/components/MyExpenseClaimsCard').then((m) => ({ default: () => <m.MyExpenseClaimsCard /> }))),
  },
  surveys: {
    label: 'Surveys to answer',
    component: lazy(() => import('@/modules/hr/engagement/components/MyEngagementCards').then((m) => ({ default: () => <m.MySurveysCard /> }))),
  },
  feedback: {
    label: 'Feedback requests',
    component: lazy(() => import('@/modules/hr/engagement/components/MyEngagementCards').then((m) => ({ default: () => <m.MyFeedbackCard /> }))),
  },
  budget: {
    label: 'My department budget',
    component: lazy(() => import('@/modules/finance/planning/components/MyDepartmentBudgetCard').then((m) => ({ default: () => <m.MyDepartmentBudgetCard /> }))),
  },
}

export const PORTAL_SLOT_ORDER: PortalSlotId[] = ['onboarding', 'reviews', 'policies', 'discipline', 'surveys', 'feedback', 'approvals', 'purchases', 'expenses', 'budget']
