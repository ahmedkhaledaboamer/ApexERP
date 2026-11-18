import axios, { AxiosError } from 'axios'
import { ApiError } from '@/shared/lib/apiError'
import { emitBillingError } from '@/shared/lib/billingEvents'
import { emitImpersonationError } from '@/shared/lib/impersonationEvents'
import { globalStorage } from '@/shared/lib/storage'
import { currentWorkspace, emitTenantError } from '@/shared/lib/tenantContext'
import { SESSION_STORAGE_KEY } from '@/store/authSlice'

/**
 * HTTP client. Requests carry the bearer token and the workspace the app was opened on
 * (X-Workspace, standing in for the Host header). They never carry a company id: the server
 * derives the tenant from the token and refuses a token whose company doesn't match the address.
 */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 20_000,
})

http.interceptors.request.use((config) => {
  try {
    const raw = globalStorage.get(SESSION_STORAGE_KEY)
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined
    if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  } catch {
    // No stored session: send the request unauthenticated.
  }
  const workspace = currentWorkspace()
  if (workspace) config.headers['X-Workspace'] = workspace
  return config
})

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string; code?: string }>) => {
    const status = error.response?.status ?? 0
    const message = error.response?.data?.message ?? error.message
    const code = error.response?.data?.code
    // Workspace problems (not found, mismatch, suspended) switch the app to the matching screen.
    emitTenantError(code, message)
    // Plan / subscription problems (limit reached, module not in plan, read-only) open the one
    // upgrade prompt (UpgradePromptHost); the caller still gets the rejection for its own UI.
    emitBillingError(code, message, error.response?.data)
    // Support-session limits (read-only, blocked) and its end (expired/ended) → ImpersonationBanner.
    emitImpersonationError(code, message)
    // Keep the body's extra fields (e.g. the Won flow's failed `step`) on the error as `details`.
    return Promise.reject(Object.assign(new ApiError(message, status, code), { details: error.response?.data }))
  },
)
