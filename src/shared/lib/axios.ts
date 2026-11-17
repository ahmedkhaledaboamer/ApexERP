import axios, { AxiosError } from 'axios'
import { ApiError } from '@/shared/lib/apiError'
import { SESSION_STORAGE_KEY } from '@/store/authSlice'

/**
 * HTTP client for the real backend. Module api files currently call the in-memory mock
 * (shared/mocks); swap their bodies to `http.get/post(...)` once endpoints exist.
 */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  timeout: 20_000,
})

http.interceptors.request.use((config) => {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : undefined
    if (token) config.headers.Authorization = `Bearer ${token}`
  } catch {
    // No stored session: send the request unauthenticated.
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status ?? 0
    const message = error.response?.data?.message ?? error.message
    return Promise.reject(new ApiError(message, status))
  },
)
