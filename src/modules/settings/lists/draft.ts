import type { Tone } from '@/shared/components/ui/Badge'
import type { IndustryOption, ListOption, LookupList, Lookups, StatusOption, StatusType } from '@/modules/settings/types'
import { LEAD_STATUS_TYPE_LABEL, requirementOf } from '@/shared/domain/leadStatus'

/**
 * Editing model for Settings > Fixed lists. Every row gets a local `_id` (its key, or a temporary
 * id for new rows) so drag-and-drop and React keys stay stable while labels change. New rows have
 * an empty `key`; the server assigns one on save.
 */

export type DraftOption = ListOption & { _id: string }
export type DraftStatus = StatusOption & { _id: string }
export type DraftIndustry = Omit<IndustryOption, 'subIndustries'> & { _id: string; subIndustries: DraftOption[] }

export interface Drafts {
  statuses: DraftStatus[]
  sources: DraftOption[]
  industries: DraftIndustry[]
  lossReasons: DraftOption[]
  tags: DraftOption[]
  serviceCategories: DraftOption[]
}

export const LIST_META: Record<LookupList, { label: string; noun: string; description: string }> = {
  statuses: {
    label: 'Lead statuses',
    noun: 'status',
    description: 'The stages a lead moves through. Order sets the pipeline columns; probability weights the forecast.',
  },
  sources: {
    label: 'Source types',
    noun: 'source type',
    description: 'Where a lead came from. Agents pick one; the free-text source detail is a separate field.',
  },
  industries: {
    label: 'Industries',
    noun: 'industry',
    description: 'Industries and their sub-industries, used on leads, customers and reports.',
  },
  lossReasons: {
    label: 'Loss reasons',
    noun: 'loss reason',
    description: 'Required when a lead is marked Lost or Not interested.',
  },
  tags: {
    label: 'Tags',
    noun: 'tag',
    description: 'Labels agents can add to leads and customers for filtering.',
  },
  serviceCategories: {
    label: 'Service categories',
    noun: 'service category',
    description: 'Groups for the service catalog. Used to filter services, quotations and reports.',
  },
}

export const LIST_ORDER: LookupList[] = ['statuses', 'sources', 'industries', 'lossReasons', 'tags', 'serviceCategories']

let seq = 0
export const tempId = () => `new-${++seq}`

const withId = <T extends ListOption>(item: T): T & { _id: string } => ({ ...item, _id: item.key })

/**
 * Protected system item on a plain list (e.g. "Imported - no reason recorded"): locked, no drag,
 * no rename or toggle, always last. Not used for statuses, where `system` means "built in".
 */
export const isLockedOption = (item: ListOption) => !!item.system

/** Keeps locked system items pinned at the bottom, in their stored order; the rest keep theirs. */
export function pinSystemLast<T extends ListOption>(items: T[]): T[] {
  if (!items.some(isLockedOption)) return items
  return [...items.filter((i) => !isLockedOption(i)), ...items.filter(isLockedOption)]
}

export function toDrafts(all: Lookups): Drafts {
  return {
    statuses: all.statuses.map(withId),
    sources: pinSystemLast(all.sources.map(withId)),
    industries: all.industries.map((i) => ({ ...withId(i), subIndustries: [...i.subIndustries].sort((a, b) => a.order - b.order).map(withId) })),
    lossReasons: pinSystemLast(all.lossReasons.map(withId)),
    tags: pinSystemLast(all.tags.map(withId)),
    serviceCategories: pinSystemLast((all.serviceCategories ?? []).map(withId)),
  }
}

export function newOption(label: string): DraftOption {
  return { _id: tempId(), key: '', label, active: true, order: 0 }
}

export const TONE_HEX: Record<Tone, string> = {
  neutral: '#a1a1ab',
  brand: '#8b5cf6',
  blue: '#3b82f6',
  sky: '#0ea5e9',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  pink: '#ec4899',
  teal: '#14b8a6',
}

export const TONES = Object.keys(TONE_HEX) as Tone[]

/** Sensible requirement flags and probability when an admin changes a custom status's type. */
export function typeDefaults(type: StatusType, current: DraftStatus): Partial<DraftStatus> {
  if (type === 'won') return { requiresNextStep: false, requiresLossReason: false, probability: 100 }
  if (type === 'lost') return { requiresNextStep: false, requiresLossReason: true, probability: 0 }
  // Leaving lost: a loss reason no longer applies; a next-step requirement is kept.
  return { requiresNextStep: requirementOf(current) === 'next-step', requiresLossReason: false }
}

export function newStatus(label: string): DraftStatus {
  return {
    _id: tempId(),
    key: '',
    label,
    active: true,
    order: 0,
    probability: 10,
    type: 'open',
    requiresNextStep: false,
    requiresLossReason: false,
    tone: 'neutral',
    color: TONE_HEX.neutral,
    system: false,
  }
}

/* ---------------- Payload (what PUT /lookups/:list receives) ---------------- */

function option(item: DraftOption, order: number): ListOption {
  const out: ListOption = { key: item.key, label: item.label.trim(), active: item.active, order }
  // New items go up without a key; the server assigns one.
  if (!item.key) delete (out as Partial<ListOption>).key
  return out
}

export function toPayload(list: LookupList, drafts: Drafts): Lookups[LookupList] {
  switch (list) {
    case 'statuses':
      return drafts.statuses.map((s, i) => ({
        ...option(s, i),
        probability: s.probability,
        type: s.type,
        requiresNextStep: s.requiresNextStep,
        requiresLossReason: s.requiresLossReason,
        tone: s.tone,
        color: s.color,
        system: s.system,
      })) as StatusOption[]
    case 'industries':
      return drafts.industries.map((ind, i) => ({ ...option(ind, i), subIndustries: ind.subIndustries.map(option) })) as IndustryOption[]
    default:
      return drafts[list].map(option)
  }
}

export function sameList(list: LookupList, a: Drafts, b: Drafts): boolean {
  return JSON.stringify(toPayload(list, a)) === JSON.stringify(toPayload(list, b))
}

/* ---------------- Client-side checks (the server checks again) ---------------- */

export interface ListErrors {
  /** Row errors by `_id`. */
  items: Record<string, string>
  /** Rules that apply to the whole list. */
  list: string[]
}

const MAX_LABEL = 60

function checkFlat(items: DraftOption[], noun: string, out: ListErrors) {
  const seen = new Set<string>()
  for (const item of items) {
    const label = item.label.trim()
    if (!label) out.items[item._id] = 'Enter a name.'
    else if (label.length > MAX_LABEL) out.items[item._id] = `Keep it to ${MAX_LABEL} characters.`
    else if (seen.has(label.toLowerCase())) out.items[item._id] = `“${label}” is already in the list.`
    seen.add(label.toLowerCase())
  }
  // System items hidden from pickers don't count: agents need at least one item they can pick.
  if (items.length && !items.some((i) => i.active && !i.hiddenFromPickers)) out.list.push(`Keep at least one active ${noun}.`)
}

export function validate(list: LookupList, drafts: Drafts): ListErrors {
  const out: ListErrors = { items: {}, list: [] }
  if (list === 'statuses') {
    checkFlat(drafts.statuses, 'status', out)
    for (const s of drafts.statuses) {
      if (!out.items[s._id] && (!Number.isInteger(s.probability) || s.probability < 0 || s.probability > 100)) {
        out.items[s._id] = 'Probability must be a whole number from 0 to 100.'
      }
    }
    for (const type of ['open', 'won', 'lost'] as const) {
      if (!drafts.statuses.some((s) => s.type === type && s.active)) out.list.push(`Keep at least one active ${LEAD_STATUS_TYPE_LABEL[type]} status.`)
    }
    return out
  }
  if (list === 'industries') {
    checkFlat(drafts.industries, 'industry', out)
    for (const ind of drafts.industries) {
      const subs: ListErrors = { items: {}, list: [] }
      checkFlat(ind.subIndustries, 'sub-industry', subs)
      Object.assign(out.items, subs.items)
      if (out.items[ind._id]) continue
      if (!ind.subIndustries.length) out.items[ind._id] = 'Add at least one sub-industry.'
      else if (subs.list.length) out.items[ind._id] = 'Keep at least one active sub-industry.'
      else if (Object.keys(subs.items).length) out.items[ind._id] = 'Fix the highlighted sub-industries.'
    }
    return out
  }
  checkFlat(drafts[list], LIST_META[list].noun, out)
  return out
}

export function hasErrors(e: ListErrors): boolean {
  return e.list.length > 0 || Object.keys(e.items).length > 0
}
