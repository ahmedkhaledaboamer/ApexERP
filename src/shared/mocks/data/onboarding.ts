import type { EmailConnection, OnboardingItemId } from '@/modules/signup/types'
import { perTenant } from '@/shared/mocks/tenant'

/** Per-company onboarding progress: manual items marked done, and whether the checklist was dismissed. */
export interface OnboardingProgress {
  manualDone: OnboardingItemId[]
  dismissed: boolean
}

export const onboardingProgress = perTenant<OnboardingProgress>(() => ({ manualDone: [], dismissed: false }), 'onboarding')

/** Mocked mailbox connection per company (Connect email); null until connected. */
export const emailConnections = perTenant<EmailConnection | null>(() => null, 'emailConnection')
