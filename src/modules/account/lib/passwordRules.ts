/**
 * Password rules shared by the change-password form and the mock API, so the checklist the
 * user sees is exactly what the server enforces. The minimum length comes from the security policy.
 */

export const PASSWORD_MAX_LENGTH = 128

export interface PasswordRule {
  id: 'length' | 'letter' | 'digit'
  label: string
  ok: boolean
}

const LETTER = /\p{L}/u
const DIGIT = /\d/

export function passwordRules(password: string, minLength: number): PasswordRule[] {
  return [
    { id: 'length', label: `At least ${minLength} characters`, ok: password.length >= minLength },
    { id: 'letter', label: 'Contains a letter', ok: LETTER.test(password) },
    { id: 'digit', label: 'Contains a number', ok: DIGIT.test(password) },
  ]
}

/** First broken rule as a sentence, or null when the password is acceptable. */
export function passwordProblem(password: string, minLength: number): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  if (password.length < minLength) return `Use at least ${minLength} characters.`
  if (!LETTER.test(password) || !DIGIT.test(password)) return 'Use both letters and numbers.'
  return null
}

export type StrengthLevel = 0 | 1 | 2 | 3 | 4

const LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'] as const

/** Rough strength for the meter: length beyond the minimum and character variety. */
export function passwordStrength(password: string, minLength: number): { level: StrengthLevel; label: string } {
  if (!password) return { level: 0, label: '' }
  let score = 0
  if (password.length >= minLength) score++
  if (password.length >= minLength + 4) score++
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  if (kinds >= 3) score++
  if (kinds === 4 || password.length >= minLength + 8) score++
  // Obvious patterns and rule breakers never rate above weak.
  if (/^(.)\1+$/.test(password) || /^(?:0123|1234|abcd|pass|qwer)/i.test(password)) score = Math.min(score, 1)
  if (passwordProblem(password, minLength)) score = Math.min(score, 1)
  const level = Math.max(1, Math.min(4, score)) as StrengthLevel
  return { level, label: LABELS[level] }
}
