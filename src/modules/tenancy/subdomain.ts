/** Workspace address rules (`<subdomain>.apexcrm.app`), shared by the sign-up form and the server. */

/** Addresses that belong to the platform, not to a workspace. */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'app', 'api', 'admin', 'platform', 'apexcrm', 'mail', 'email', 'smtp', 'support', 'help', 'billing',
  'status', 'docs', 'blog', 'login', 'signup', 'register', 'static', 'cdn', 'assets', 'dev', 'staging', 'test',
  'demo', 'root', 'system', 'security', 'account', 'accounts', 'workspace',
])

export const SUBDOMAIN_MIN = 3
export const SUBDOMAIN_MAX = 30

/** 3–30 lowercase letters, digits or hyphens; starts and ends with a letter or digit. */
export const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/

/** Why a subdomain can't be used, or null. */
export function subdomainProblem(raw: string): string | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!SUBDOMAIN_PATTERN.test(s) || s.includes('--')) {
    return 'Use 3–30 lowercase letters, numbers or single hyphens, starting and ending with a letter or number.'
  }
  if (RESERVED_SUBDOMAINS.has(s)) return 'That address is reserved. Choose another.'
  return null
}

/** Suggests an address from a company name: "Gulf Star Trading LLC" → "gulf-star-trading-llc". */
export function suggestSubdomain(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX)
    .replace(/-+$/g, '')
}

/** "Gulf Star Trading" → "GS"; "Nimbus" → "NI". */
export function monogramFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? 'AC').slice(0, 2)
  return letters.toUpperCase()
}
