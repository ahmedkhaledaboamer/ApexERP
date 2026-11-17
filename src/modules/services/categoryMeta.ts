import { BarChart3, Bot, Globe, Package, Plug, ScanText, Workflow, type LucideIcon } from 'lucide-react'

export interface CategoryMeta {
  icon: LucideIcon
  /** Tinted chip classes (light + dark). */
  tone: string
}

/**
 * Visuals for service categories. Categories are a lookup list (Settings > Fixed lists), so
 * new ones get a neutral default; known keys keep their icon and colour.
 */
const KNOWN: Record<string, CategoryMeta> = {
  Chatbot: { icon: Bot, tone: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  'CRM Automation': { icon: Workflow, tone: 'bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-300' },
  OCR: { icon: ScanText, tone: 'bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-500' },
  Dashboards: { icon: BarChart3, tone: 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500' },
  'System Integration': { icon: Plug, tone: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300' },
  'Website & Apps': { icon: Globe, tone: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-500' },
}

const FALLBACK: CategoryMeta = { icon: Package, tone: 'bg-sunken text-muted' }

export function categoryMeta(key: string | null | undefined): CategoryMeta {
  return (key && KNOWN[key]) || FALLBACK
}
