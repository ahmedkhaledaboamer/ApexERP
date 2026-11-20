import type { User } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import type {
  AuditEntry,
  AutomationRules,
  IndustryOption,
  ListOption,
  LookupList,
  Lookups,
  StatusOption,
} from '@/modules/settings/types'
import { DEFAULT_AUTOMATION_RULES } from '@/modules/settings/types'
import { automationRulesFor, lookupsFor } from '@/shared/mocks/data/lookups'
import { auditLog, diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'
import { scoped, tenantOf } from '@/shared/mocks/tenant'
import { leads } from '@/shared/mocks/db'
import { isLeadStatusType } from '@/shared/domain/leadStatus'

const TONES = ['neutral', 'brand', 'blue', 'sky', 'green', 'amber', 'red', 'pink', 'teal'] as const

function canView(user: User) {
  return can(user.role, 'settings', 'view')
}
function canEdit(user: User) {
  return can(user.role, 'settings', 'edit')
}

function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/* ---------------- Lookups ---------------- */

/** The company's lists, including inactive items (pickers filter to active; history shows old labels). Any signed-in user. */
export async function getLookups(user: User): Promise<Lookups> {
  return delay(lookupsFor(tenantOf(user)))
}

type Incoming = Partial<ListOption> & { label: string }

/** Validates a flat list: labels required and unique, keys stable, order taken from the array. */
function normalizeList(list: string, items: Incoming[], existing: ListOption[]): ListOption[] | string {
  if (!Array.isArray(items) || items.length === 0) return `The ${list} list can’t be empty.`
  const seenLabels = new Set<string>()
  const seenKeys = new Set<string>()
  const out: ListOption[] = []
  for (const [i, item] of items.entries()) {
    const label = String(item.label ?? '').trim()
    if (!label) return `Item ${i + 1} needs a label.`
    if (label.length > 60) return `“${label.slice(0, 20)}…” is too long (60 characters max).`
    const lower = label.toLowerCase()
    if (seenLabels.has(lower)) return `“${label}” is listed twice.`
    seenLabels.add(lower)
    let key = item.key && existing.some((e) => e.key === item.key) ? item.key : slug(label)
    if (!key) return `“${label}” needs letters or numbers.`
    while (seenKeys.has(key) || (!item.key && existing.some((e) => e.key === key && e.label.toLowerCase() !== lower))) key = `${key}-2`
    seenKeys.add(key)
    // Protection flags come from the stored item only; a client can't set or clear them.
    const prev = existing.find((e) => e.key === key)
    out.push({
      key,
      label,
      active: item.active !== false,
      order: i,
      ...(prev?.system ? { system: true } : {}),
      ...(prev?.hiddenFromPickers ? { hiddenFromPickers: true } : {}),
    })
  }
  if (!out.some((o) => o.active)) return `Keep at least one active item in ${list}.`
  return out
}

/**
 * Protected system items (ListOption.system, plain lists only) can't be removed, renamed or
 * deactivated (422), and always stay pinned last whatever order the client submitted.
 */
function pinSystemItems(items: Incoming[], existing: ListOption[]): Incoming[] | string {
  const locked = existing.filter((e) => e.system).sort((a, b) => a.order - b.order)
  if (!locked.length) return items
  if (!Array.isArray(items)) return items
  for (const s of locked) {
    const got = items.find((i) => i.key === s.key)
    if (!got) return `“${s.label}” is a system item and can’t be removed.`
    if (String(got.label ?? '').trim() !== s.label) return `“${s.label}” is a system item and can’t be renamed.`
    if (got.active === false) return `“${s.label}” is a system item and can’t be deactivated.`
  }
  const isLocked = (i: Incoming) => locked.some((s) => s.key === i.key)
  return [...items.filter((i) => !isLocked(i)), ...locked.map((s) => ({ ...s }))]
}

/** Items are deactivated, never deleted, so records that use them keep their meaning. */
function missingKeys(before: ListOption[], after: ListOption[]): string[] {
  return before.filter((b) => !after.some((a) => a.key === b.key)).map((b) => b.label)
}

function summarize(before: ListOption[], after: ListOption[]): string {
  const added = after.filter((a) => !before.some((b) => b.key === a.key)).map((a) => a.label)
  const renamed = after.filter((a) => before.some((b) => b.key === a.key && b.label !== a.label)).map((a) => a.label)
  const off = after.filter((a) => !a.active && before.some((b) => b.key === a.key && b.active)).map((a) => a.label)
  const on = after.filter((a) => a.active && before.some((b) => b.key === a.key && !b.active)).map((a) => a.label)
  const parts = [
    added.length && `added ${added.join(', ')}`,
    renamed.length && `renamed ${renamed.join(', ')}`,
    off.length && `deactivated ${off.join(', ')}`,
    on.length && `reactivated ${on.join(', ')}`,
  ].filter(Boolean)
  return parts.length ? parts.join('; ') : 'reordered or edited details'
}

const LIST_LABEL: Record<LookupList, string> = {
  statuses: 'lead statuses',
  sources: 'source types',
  industries: 'industries',
  lossReasons: 'loss reasons',
  tags: 'tags',
  serviceCategories: 'service categories',
}

/** Replaces one list (edit, reorder, activate/deactivate, add). Company Admin only. */
export async function saveLookupList(user: User, list: LookupList, items: unknown): Promise<Lookups> {
  if (!canEdit(user)) return fail('Only a Company Admin can change fixed lists.', 403)
  // Each company has its own lists; keys and labels are unique within the company only.
  const lookups = lookupsFor(tenantOf(user))
  if (!(list in lookups)) return fail('Unknown list.', 404)
  const before = lookups[list] as ListOption[]
  // On statuses `system` means "built in" (renamable); the pinned-item rules are for plain lists.
  const pinned = list === 'statuses' ? (items as Incoming[]) : pinSystemItems(items as Incoming[], before)
  if (typeof pinned === 'string') return fail(pinned, 422)
  const base = normalizeList(LIST_LABEL[list], pinned, before)
  if (typeof base === 'string') return fail(base, 422)
  const removed = missingKeys(before, base)
  if (removed.length) return fail(`Deactivate instead of removing: ${removed.join(', ')}.`, 422)
  if (list !== 'statuses' && !base.some((o) => o.active && !o.hiddenFromPickers)) {
    return fail(`Keep at least one active item in ${LIST_LABEL[list]} that agents can pick.`, 422)
  }

  if (list === 'statuses') {
    const raw = items as Partial<StatusOption>[]
    const next: StatusOption[] = []
    for (const [i, b] of base.entries()) {
      const r = raw[i]
      const prev = lookups.statuses.find((s) => s.key === b.key)
      const probability = Number(r.probability ?? prev?.probability ?? 0)
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
        return fail(`Probability for “${b.label}” must be 0–100.`, 422)
      }
      const type: unknown = r.type ?? prev?.type ?? 'open'
      const tone = (r.tone ?? prev?.tone ?? 'neutral') as StatusOption['tone']
      if (!isLeadStatusType(type)) return fail(`“${b.label}” has an unknown type.`, 422)
      const requiresNextStep: unknown = r.requiresNextStep ?? prev?.requiresNextStep ?? false
      const requiresLossReason: unknown = r.requiresLossReason ?? prev?.requiresLossReason ?? false
      if (typeof requiresNextStep !== 'boolean' || typeof requiresLossReason !== 'boolean') {
        return fail(`“${b.label}”: the requirement flags must be true or false.`, 422)
      }
      if (requiresNextStep && requiresLossReason) return fail(`“${b.label}” can require a next step or a loss reason, not both.`, 422)
      if (type === 'won' && (requiresNextStep || requiresLossReason)) {
        return fail(`“${b.label}” is a Won status: the Won flow records what it needs.`, 422)
      }
      if (!TONES.includes(tone)) return fail(`“${b.label}” has an unknown colour.`, 422)
      // Turning a status that leads sit in into a Won status would make them "won" without a
      // customer or projects (a Won bypass): only the Won flow may put a lead there.
      if (prev && prev.type !== 'won' && type === 'won' && scoped(leads, user).some((l) => l.status === b.key)) {
        return fail(`Leads are in “${b.label}”: move them out before making it a Won status (only the Won flow can win a lead).`, 422)
      }
      if (prev?.system && prev.type !== type) return fail(`“${b.label}” is built in; its type can’t change.`, 422)
      next.push({
        ...b,
        probability: Math.round(probability),
        type,
        requiresNextStep,
        requiresLossReason,
        tone,
        color: /^#[0-9a-f]{6}$/i.test(String(r.color)) ? String(r.color) : (prev?.color ?? '#94a3b8'),
        system: prev?.system ?? false,
      })
    }
    for (const k of ['open', 'won', 'lost'] as const) {
      if (!next.some((s) => s.type === k && s.active)) return fail(`Keep at least one active “${k}” status.`, 422)
    }
    recordAudit(user, {
      action: 'update',
      entity: 'lookup:statuses',
      entityId: 'statuses',
      summary: `Lead statuses: ${summarize(before, next)}`,
      changes: next.flatMap((s) => {
        const p = lookups.statuses.find((o) => o.key === s.key)
        return p ? diff(p, s).map((c) => ({ ...c, field: `${s.label}.${c.field}` })) : []
      }),
    })
    lookups.statuses = next
    return delay(lookups)
  }

  if (list === 'industries') {
    const raw = pinned as Partial<IndustryOption>[]
    const next: IndustryOption[] = []
    for (const [i, b] of base.entries()) {
      const prev = lookups.industries.find((s) => s.key === b.key)
      const subs = normalizeList(`${b.label} sub-industries`, (raw[i].subIndustries ?? []) as Incoming[], prev?.subIndustries ?? [])
      if (typeof subs === 'string') return fail(subs, 422)
      const gone = missingKeys(prev?.subIndustries ?? [], subs)
      if (gone.length) return fail(`Deactivate instead of removing: ${gone.join(', ')}.`, 422)
      next.push({ ...b, subIndustries: subs })
    }
    recordAudit(user, { action: 'update', entity: 'lookup:industries', entityId: 'industries', summary: `Industries: ${summarize(before, next)}` })
    lookups.industries = next
    return delay(lookups)
  }

  recordAudit(user, { action: 'update', entity: `lookup:${list}`, entityId: list, summary: `${LIST_LABEL[list][0].toUpperCase()}${LIST_LABEL[list].slice(1)}: ${summarize(before, base)}` })
  ;(lookups[list] as ListOption[]) = base
  return delay(lookups)
}

/* ---------------- Automation rules ---------------- */

/** Readable by every signed-in user: screens like CRM renewals and follow-ups need the numbers. */
export async function getAutomationRules(user: User): Promise<AutomationRules> {
  return delay(automationRulesFor(tenantOf(user)))
}

const RULE_LIMITS: Record<keyof AutomationRules, [number, number]> = {
  noContactReminderDays: [1, 30],
  noResponseFollowUpDays: [1, 30],
  attemptsBeforeCold: [1, 20],
  stalledInterestedDays: [1, 60],
  lostReopenDays: [7, 730],
  renewalAlertDays: [1, 180],
  taskReminderDaysBefore: [0, 30],
  eventReminderHours: [0, 336],
  eventFollowUpDays: [0, 60],
}

export async function saveAutomationRules(user: User, input: Partial<AutomationRules>): Promise<AutomationRules> {
  if (!canEdit(user)) return fail('Only a Company Admin can change automation rules.', 403)
  const automationRules = automationRulesFor(tenantOf(user))
  const next = { ...automationRules }
  for (const [k, v] of Object.entries(input) as [keyof AutomationRules, unknown][]) {
    if (!(k in RULE_LIMITS)) return fail(`Unknown rule “${k}”.`, 422)
    const n = Number(v)
    const [min, max] = RULE_LIMITS[k]
    if (!Number.isInteger(n) || n < min || n > max) return fail(`${k} must be a whole number from ${min} to ${max}.`, 422)
    next[k] = n
  }
  const changes = diff(automationRules, next)
  if (changes.length) {
    recordAudit(user, { action: 'update', entity: 'automation', entityId: 'rules', summary: 'Changed automation rules', changes })
  }
  Object.assign(automationRules, next)
  return delay(automationRules)
}

export async function resetAutomationRules(user: User): Promise<AutomationRules> {
  return saveAutomationRules(user, DEFAULT_AUTOMATION_RULES)
}

/* ---------------- Audit log ---------------- */

export interface AuditQuery {
  entity?: string
  userId?: string
  action?: string
  from?: string
  to?: string
}

export async function getAuditLog(user: User, q: AuditQuery): Promise<AuditEntry[]> {
  if (!canView(user)) return fail('The audit log is for admins.', 403)
  const fromT = q.from ? new Date(q.from).getTime() : -Infinity
  const toT = q.to ? new Date(q.to).getTime() + 86_400_000 : Infinity
  // Only the company's own entries; another company's audit trail is invisible.
  return delay(
    scoped(auditLog, user).filter((e) => {
      const t = new Date(e.at).getTime()
      return (
        t >= fromT &&
        t < toT &&
        (!q.entity || e.entity === q.entity || e.entity.startsWith(`${q.entity}:`)) &&
        (!q.userId || e.userId === q.userId) &&
        (!q.action || e.action === q.action)
      )
    }),
  )
}
