/**
 * Password strength for sign-up, shared by the form meter and the mock server so the rule the
 * user sees is the rule that is enforced: at least SIGNUP_PASSWORD_MIN characters and a score of
 * at least SIGNUP_PASSWORD_MIN_SCORE.
 */

export const SIGNUP_PASSWORD_MIN = 10
export const SIGNUP_PASSWORD_MAX = 128
export const SIGNUP_PASSWORD_MIN_SCORE = 2

export type PasswordScore = 0 | 1 | 2 | 3 | 4

export interface PasswordStrength {
  score: PasswordScore
  label: 'Too weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  /** What would make it stronger (empty when it's already strong). */
  hints: string[]
}

const LABELS: PasswordStrength['label'][] = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong']
const COMMON = /^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|abc123|123456|111111)/i
const SEQUENCES = /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/i

export function passwordStrength(password: string): PasswordStrength {
  const pw = String(password ?? '')
  const hints: string[] = []
  if (!pw) return { score: 0, label: LABELS[0], hints: [`Use at least ${SIGNUP_PASSWORD_MIN} characters.`] }

  const lower = /[a-z]/.test(pw)
  const upper = /[A-Z]/.test(pw)
  const digit = /\d/.test(pw)
  const symbol = /[^A-Za-z0-9]/.test(pw)
  const kinds = [lower, upper, digit, symbol].filter(Boolean).length

  let score = 0
  if (pw.length >= SIGNUP_PASSWORD_MIN) score++
  if (pw.length >= SIGNUP_PASSWORD_MIN + 4) score++
  if (kinds >= 2) score++
  if (kinds >= 3) score++
  if (kinds === 4 && pw.length >= SIGNUP_PASSWORD_MIN) score++

  if (pw.length < SIGNUP_PASSWORD_MIN) hints.push(`Use at least ${SIGNUP_PASSWORD_MIN} characters.`)
  if (!(lower && upper)) hints.push('Mix upper and lower case letters.')
  if (!digit) hints.push('Add a number.')
  if (!symbol) hints.push('Add a symbol such as ! or #.')

  // Obvious passwords never rate above weak, whatever their length.
  if (/^(.)\1+$/.test(pw) || COMMON.test(pw)) {
    score = Math.min(score, 1)
    hints.unshift('Avoid common words and repeated characters.')
  } else if (SEQUENCES.test(pw)) {
    score = Math.max(0, score - 1)
    hints.push('Avoid sequences like 1234 or abcd.')
  }
  if (pw.length < SIGNUP_PASSWORD_MIN) score = Math.min(score, 1)

  const s = Math.max(0, Math.min(4, score)) as PasswordScore
  return { score: s, label: LABELS[s], hints: s === 4 ? [] : hints }
}

/** First reason the sign-up password is refused, or null when it's acceptable. */
export function signupPasswordProblem(password: string): string | null {
  const pw = String(password ?? '')
  if (pw.length > SIGNUP_PASSWORD_MAX) return `Use at most ${SIGNUP_PASSWORD_MAX} characters.`
  if (pw.length < SIGNUP_PASSWORD_MIN) return `Use a password of at least ${SIGNUP_PASSWORD_MIN} characters.`
  const s = passwordStrength(pw)
  if (s.score < SIGNUP_PASSWORD_MIN_SCORE) return `This password is too weak. ${s.hints[0] ?? 'Make it longer.'}`
  return null
}
