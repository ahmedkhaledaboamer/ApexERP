import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CheckoutInput,
  CheckoutResult,
  ContactSalesInput,
  ContactSalesResult,
  EmailConnection,
  EmailProvider,
  OnboardingItemId,
  OnboardingState,
  SignupCompleteInput,
  SignupCompleted,
  SignupStartInput,
  SignupStarted,
  SignupVerified,
  SubdomainAvailability,
} from '@/modules/signup/types'
import type { Plan } from '@/modules/billing/types'
import { http } from '@/shared/lib/axios'
import { globalStorage } from '@/shared/lib/storage'

/* ---------------- Public sign-up (no auth) ---------------- */

const CLIENT_ID_KEY = 'client-id'

/** A random id per browser, sent as X-Client-Id so the (mock) rate limiter can count attempts. */
function clientId(): string {
  let id = globalStorage.get(CLIENT_ID_KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    globalStorage.set(CLIENT_ID_KEY, id)
  }
  return id
}

const pub = () => ({ headers: { 'X-Client-Id': clientId() } })
const enc = encodeURIComponent

export async function checkSubdomain(subdomain: string, signal?: AbortSignal): Promise<SubdomainAvailability> {
  return (
    await http.get<SubdomainAvailability>('/public/signup/availability', { ...pub(), params: { subdomain }, signal })
  ).data
}

export async function startSignup(input: SignupStartInput): Promise<SignupStarted> {
  return (await http.post<SignupStarted>('/public/signup', input, pub())).data
}

export async function resendSignupCode(signupId: string): Promise<SignupStarted> {
  return (await http.post<SignupStarted>(`/public/signup/${enc(signupId)}/resend`, {}, pub())).data
}

export async function verifySignup(signupId: string, code: string): Promise<SignupVerified> {
  return (await http.post<SignupVerified>(`/public/signup/${enc(signupId)}/verify`, { code }, pub())).data
}

/** GET /public/plans: the active plan catalog (data, not code). */
export async function getPlans(): Promise<Plan[]> {
  return (await http.get<Plan[]>('/public/plans', pub())).data
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  return (await http.post<CheckoutResult>('/public/checkout', input, pub())).data
}

export async function completeSignup(signupId: string, input: SignupCompleteInput): Promise<SignupCompleted> {
  return (await http.post<SignupCompleted>(`/public/signup/${enc(signupId)}/complete`, input, pub())).data
}

export async function contactSales(input: ContactSalesInput): Promise<ContactSalesResult> {
  return (await http.post<ContactSalesResult>('/public/contact-sales', input, pub())).data
}

/* ---------------- Onboarding (signed in, per company) ---------------- */

export async function getOnboardingState(): Promise<OnboardingState> {
  return (await http.get<OnboardingState>('/onboarding')).data
}

/** Marks a manual item (lists, email) done or not done. */
export async function setOnboardingItem(id: OnboardingItemId, done: boolean): Promise<OnboardingState> {
  return (await http.patch<OnboardingState>(`/onboarding/items/${enc(id)}`, { done })).data
}

/** Hides or restores the checklist for the whole company. */
export async function setOnboardingDismissed(dismissed: boolean): Promise<OnboardingState> {
  return (await http.patch<OnboardingState>('/onboarding', { dismissed })).data
}


export interface EmailConnectionInput {
  provider: EmailProvider
  address: string
}

export async function connectEmail(input: EmailConnectionInput): Promise<EmailConnection> {
  return (await http.post<EmailConnection>('/settings/email-connection', input)).data
}

/* ---------------- Hooks ---------------- */

export const signupKeys = {
  plans: ['public-plans'] as const,
  onboarding: ['onboarding'] as const,
}

export function usePlans() {
  return useQuery({ queryKey: signupKeys.plans, queryFn: getPlans, staleTime: 10 * 60_000 })
}

export function useStartSignup() {
  return useMutation({ mutationFn: startSignup })
}

export function useResendCode() {
  return useMutation({ mutationFn: (signupId: string) => resendSignupCode(signupId) })
}

export function useVerifySignup() {
  return useMutation({ mutationFn: ({ signupId, code }: { signupId: string; code: string }) => verifySignup(signupId, code) })
}

export function useCheckout() {
  return useMutation({ mutationFn: checkout })
}

export function useCompleteSignup() {
  return useMutation({
    mutationFn: ({ signupId, ...input }: SignupCompleteInput & { signupId: string }) => completeSignup(signupId, input),
  })
}

export function useContactSales() {
  return useMutation({ mutationFn: contactSales })
}

export function useOnboarding(enabled = true) {
  return useQuery({ queryKey: signupKeys.onboarding, queryFn: getOnboardingState, enabled })
}

export function useOnboardingMutations() {
  const qc = useQueryClient()
  const put = (state: OnboardingState) => qc.setQueryData(signupKeys.onboarding, state)
  const markItem = useMutation({
    mutationFn: ({ id, done }: { id: OnboardingItemId; done: boolean }) => setOnboardingItem(id, done),
    onSuccess: put,
  })
  const dismiss = useMutation({ mutationFn: setOnboardingDismissed, onSuccess: put })
  return { markItem, dismiss }
}

export function useConnectEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: connectEmail,
    onSuccess: () => qc.invalidateQueries({ queryKey: signupKeys.onboarding }),
  })
}
