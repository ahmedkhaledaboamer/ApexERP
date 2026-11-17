/** Demo shortcuts (role picker, OTP hint) only make sense against the mock API. */
export const MOCK_API = import.meta.env.VITE_API_MOCK !== 'false'

/**
 * There is no real authenticator app behind the mock API, so every one-time code is this.
 * The sign-in and 2FA setup screens show it as a hint when the mock is on.
 */
export const DEMO_OTP = '123456'
