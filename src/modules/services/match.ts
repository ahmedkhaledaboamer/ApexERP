import type { Service } from '@/modules/services/types'

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Words that say nothing about which service is meant. */
const STOP = new Set(['ai', 'and', 'the', 'for', 'a', 'of', 'with', 'setup', 'service', 'services', 'system'])

/** Category names and the short titles used in the old free-text field. */
const ALIASES: Record<string, string[]> = {
  Chatbot: ['chatbot', 'chat bot', 'bot', 'whatsapp bot', 'ai chatbot', 'virtual assistant'],
  'CRM Automation': ['crm', 'crm automation', 'automation', 'workflow'],
  OCR: ['ocr', 'document ocr', 'data extraction', 'scanning', 'document processing'],
  Dashboards: ['dashboard', 'dashboards', 'bi', 'bi dashboards', 'reporting', 'power bi'],
  'System Integration': ['integration', 'system integration', 'api', 'erp integration'],
  'Website & Apps': ['website', 'web', 'website and apps', 'app', 'booking app', 'mobile app'],
}

/**
 * Matches a legacy free-text "recommended service" to a catalog item.
 * Order: exact name → category name/alias (first active service of that category) → best
 * word overlap with service names. Returns null when nothing is a confident match.
 */
export function matchServiceText(text: string | null | undefined, catalog: Service[]): Service | null {
  if (!text?.trim()) return null
  const q = norm(text)
  const active = catalog.filter((s) => s.active)

  const exact = catalog.find((s) => norm(s.name) === q)
  if (exact) return exact

  for (const [category, aliases] of Object.entries(ALIASES)) {
    if (norm(category) === q || aliases.includes(q)) {
      return active.find((s) => s.category === category) ?? null
    }
  }

  const words = q.split(' ').filter((w) => w.length > 1 && !STOP.has(w))
  if (words.length === 0) return null
  let best: { s: Service; score: number } | null = null
  for (const s of active) {
    const hay = new Set(norm(`${s.name} ${s.category}`).split(' '))
    const hits = words.filter((w) => hay.has(w)).length
    const score = hits / words.length
    if (hits > 0 && (!best || score > best.score)) best = { s, score }
  }
  return best && best.score >= 0.5 ? best.s : null
}
