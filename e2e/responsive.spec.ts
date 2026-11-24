import { expect, test, type Page } from '@playwright/test'
import { signInAs } from './helpers'

/**
 * Phone-width regression (375Ã—812): the main pages of Finance, HR, Reports, Integrations and the AI agent
 * must not scroll the page sideways, and no toolbar control may sit outside the screen. Wide content
 * (tables, tab strips, charts) is expected to scroll inside its own container (overflow-x auto/scroll).
 *
 * Signed in as Ahmed (u1, admin) for most pages and Mariam (u9, HR Manager) for HR, both in Apex.
 */

const ROUTES: { user: string; path: string }[] = [
  // Finance
  { user: 'u1', path: '/finance' },
  { user: 'u1', path: '/finance/accounts' },
  { user: 'u1', path: '/finance/journal' },
  { user: 'u1', path: '/finance/invoices' },
  { user: 'u1', path: '/finance/payments' },
  { user: 'u1', path: '/finance/receivables' },
  { user: 'u1', path: '/finance/suppliers' },
  { user: 'u1', path: '/finance/purchase-orders' },
  { user: 'u1', path: '/finance/bills' },
  { user: 'u1', path: '/finance/approvals' },
  { user: 'u1', path: '/finance/expenses' },
  { user: 'u1', path: '/finance/banking' },
  { user: 'u1', path: '/finance/commissions' },
  { user: 'u1', path: '/finance/statements' },
  { user: 'u1', path: '/finance/tax' },
  { user: 'u1', path: '/finance/planning' },
  { user: 'u1', path: '/finance/profitability' },
  { user: 'u1', path: '/finance/settings' },
  // Reports, integrations, AI agent
  { user: 'u1', path: '/reports' },
  { user: 'u1', path: '/reports/performance' },
  { user: 'u1', path: '/sales/reports' },
  { user: 'u1', path: '/integrations' },
  { user: 'u1', path: '/ai' },
  // HR
  { user: 'u9', path: '/hr/employees' },
  { user: 'u9', path: '/hr/journeys' },
  { user: 'u9', path: '/hr/performance' },
  { user: 'u9', path: '/hr/engagement' },
  { user: 'u9', path: '/hr/feedback' },
  { user: 'u9', path: '/hr/salary' },
  { user: 'u9', path: '/hr/reports' },
  { user: 'u9', path: '/hr/me' },
  { user: 'u9', path: '/hr/requests' },
  { user: 'u9', path: '/hr/discipline' },
  { user: 'u9', path: '/hr/policies' },
  { user: 'u9', path: '/hr/me/policies' },
  { user: 'u9', path: '/hr/attendance' },
  { user: 'u9', path: '/hr/leave' },
]

/** `RESPONSIVE_ONLY=/finance/banking,/hr/leave` narrows the run while fixing a page. */
const ONLY = process.env.RESPONSIVE_ONLY?.split(',').map((p) => p.trim()).filter(Boolean)
const routes = ONLY?.length ? ROUTES.filter((r) => ONLY.includes(r.path)) : ROUTES

type Offender = { tag: string; label: string; left: number; right: number }

/** Page-level horizontal overflow, and visible controls that end up outside the screen (not inside a scroller). */
async function measure(page: Page): Promise<{ scrollWidth: number; clientWidth: number; mainOverflow: number; offenders: Offender[]; culprits: string[] }> {
  return page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement
    const vw = se.clientWidth
    // The app shell scrolls <main> (overflow-y auto, which makes overflow-x auto too): it counts as the page.
    const main = document.querySelector('main')
    const scrolls = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX)
    const hiddenAway = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.visibility === 'hidden' || cs.display === 'none' || n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true') return true
        if (n !== el && n !== main && n !== document.body && n !== document.documentElement && scrolls(n)) return true // its own scroller
      }
      return false
    }
    const offenders: Offender[] = []
    for (const el of document.querySelectorAll('main button, main a[href], main input, main select, main [role="tab"], header button, header a[href]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= vw + 1 && r.left >= -1) continue
      if (hiddenAway(el)) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('name') || '').trim().slice(0, 40),
        left: Math.round(r.left),
        right: Math.round(r.right),
      })
    }
    // For diagnosis: the outermost elements that stick out past the screen's end (their parent does not).
    const culprits: string[] = []
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue
      const pr = el.parentElement?.getBoundingClientRect()
      if (pr && pr.right > vw + 1) continue
      const cls = typeof el.className === 'string' ? el.className.slice(0, 90) : ''
      culprits.push(`<${el.tagName.toLowerCase()} class="${cls}"> ${Math.round(r.left)}..${Math.round(r.right)}${hiddenAway(el) ? ' (hidden or in a scroller)' : ''}`)
      if (culprits.length >= 8) break
    }
    return { scrollWidth: se.scrollWidth, clientWidth: vw, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0, offenders, culprits }
  })
}

test.use({ viewport: { width: 375, height: 812 } })

for (const user of [...new Set(routes.map((r) => r.user))]) {
  test(`no horizontal page overflow at 375px (${user})`, async ({ page }) => {
    test.setTimeout(60_000 + routes.length * 50_000)
    await signInAs(page, user)
    const problems: string[] = []
    for (const { path } of routes.filter((r) => r.user === user)) {
      await page.goto(path)
      // A cold dev server compiles each lazy route on first visit: allow it time.
      const loaded = await page.locator('main h1').first().waitFor({ timeout: 45_000 }).then(() => true, () => false)
      if (!loaded) {
        problems.push(`${path}: page heading did not appear`)
        continue
      }
      // Let lists and charts load (skeletons replaced) before measuring.
      await page.waitForTimeout(1000)
      const m = await measure(page)
      if (m.scrollWidth > m.clientWidth) problems.push(`${path}: page scrolls sideways (scrollWidth ${m.scrollWidth} > ${m.clientWidth})`)
      if (m.mainOverflow > 0) problems.push(`${path}: <main> scrolls sideways by ${m.mainOverflow}px`)
      if (m.scrollWidth > m.clientWidth || m.mainOverflow > 0) for (const c of m.culprits) problems.push(`${path}:   sticking out: ${c}`)
      for (const o of m.offenders) problems.push(`${path}: <${o.tag}> "${o.label}" outside the screen (${o.left}..${o.right})`)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
}
