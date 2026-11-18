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
import { emailConnectionMapper, onboardingMapper, signupMapper } from '@/shared/api/mappers'

/** Public sign-up speaks snake_case (signup_id, company_name…); mapped both ways. */
const fromApi = <T,>(data: unknown) => signupMapper.fromApi(data) as T
const toApi = (body: object) => signupMapper.toApi(body as never)
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
  return fromApi<SubdomainAvailability>((await http.get<unknown>('/public/signup/availability', { ...pub(), params: { subdomain }, signal })).data)
}

export async function startSignup(input: SignupStartInput): Promise<SignupStarted> {
  return fromApi<SignupStarted>((await http.post<unknown>('/public/signup', toApi(input), pub())).data)
}

export async function resendSignupCode(signupId: string): Promise<SignupStarted> {
  return fromApi<SignupStarted>((await http.post<unknown>(`/public/signup/${enc(signupId)}/resend`, {}, pub())).data)
}

export async function verifySignup(signupId: string, code: string): Promise<SignupVerified> {
  return fromApi<SignupVerified>((await http.post<unknown>(`/public/signup/${enc(signupId)}/verify`, { code }, pub())).data)
}

/** GET /public/plans: the active plan catalog (data, not code). */
export async function getPlans(): Promise<Plan[]> {
  return fromApi<Plan[]>((await http.get<unknown>('/public/plans', pub())).data)
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  return fromApi<CheckoutResult>((await http.post<unknown>('/public/checkout', toApi(input), pub())).data)
}

export async function completeSignup(signupId: string, input: SignupCompleteInput): Promise<SignupCompleted> {
  return (await http.post<SignupCompleted>(`/public/signup/${enc(signupId)}/complete`, toApi(input), pub())).data
}

export async function contactSales(input: ContactSalesInput): Promise<ContactSalesResult> {
  return fromApi<ContactSalesResult>((await http.post<unknown>('/public/contact-sales', toApi(input), pub())).data)
}

/* ---------------- Onboarding (signed in, per company) ---------------- */

export async function getOnboardingState(): Promise<OnboardingState> {
  return onboardingMapper.fromApi((await http.get<unknown>('/onboarding')).data)
}

/** Marks a manual item (lists, email) done or not done. */
export async function setOnboardingItem(id: OnboardingItemId, done: boolean): Promise<OnboardingState> {
  return onboardingMapper.fromApi((await http.patch<unknown>(`/onboarding/items/${enc(id)}`, { done })).data)
}

/** Hides or restores the checklist for the whole company. */
export async function setOnboardingDismissed(dismissed: boolean): Promise<OnboardingState> {
  return onboardingMapper.fromApi((await http.patch<unknown>('/onboarding', { dismissed })).data)
}


export interface EmailConnectionInput {
  provider: EmailProvider
  address: string
}

export async function connectEmail(input: EmailConnectionInput): Promise<EmailConnection> {
  return emailConnectionMapper.fromApi((await http.post<unknown>('/settings/email-connection', emailConnectionMapper.toApi(input as never))).data)
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
