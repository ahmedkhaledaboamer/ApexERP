import type { Lead, User } from '@/shared/types'
import type {
  Audience,
  AudienceCounts,
  AudienceDetail,
  AudienceExport,
  AudienceInput,
  AudienceMember,
  AudienceOptions,
  AudiencePreviewResult,
  AudienceRules,
  AudienceUpdateInput,
  StatusType,
} from '@/modules/marketing/growth/types'
import { EMPTY_RULES, EVENT_PRESENCE, STATUS_TYPES, type EventPresence } from '@/modules/marketing/growth/types'
import { isRealIsoDate, zonedParts } from '@/shared/lib/zonedTime'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { campaigns } from '@/shared/mocks/data/marketing'
import { eventAttendees, events } from '@/shared/mocks/data/events'
import { audiences, nextGrowthId, type AudienceRecord } from '@/shared/mocks/data/marketingGrowth'
import { statusOf } from '@/shared/mocks/data/lookups'
import { companyById } from '@/shared/mocks/data/tenancy'
import { nowIso } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { findInTenant, scoped, stamp, type Tenant } from '@/shared/mocks/tenant'
import { requireMarketingEdit, requireMarketingView } from '@/shared/mocks/services/leadGen'

/* ------------------------------------------------------------------------------------------
 * Marketing › Audiences (plan module `marketing`; docs/API.md › Marketing › Audiences): saved lead
 * segments by rules. Dynamic audiences apply their rules every time they are used; static ones keep
 * the members frozen when saved ("freeze members"). Do Not Contact leads are ALWAYS left out, whatever
 * the rules or the frozen list. Bulk emails can target an audience: it is resolved again at send time.
 * ---------------------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOT_FOUND = 'That audience doesn’t exist.'
/** Members returned with a detail / preview. */
export const MEMBER_PREVIEW = 50

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const tzOf = (co: string) => companyById(co)?.regional.timezone ?? 'Asia/Dubai'

/* ---------------- Rules ---------------- */

const strings = (v: unknown): string[] | null =>
  v === undefined || v === null ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...new Set(v as string[])] : null

const dateOrNull = (v: unknown): string | null | false => (v === undefined || v === null || v === '' ? null : isRealIsoDate(v) ? (v as string) : false)

/** Validates rules; ids must belong to the company (another company's id answers like a missing one). */
export function rulesOf(co: string, raw: Partial<AudienceRules> | undefined): AudienceRules | string {
  const r = (raw ?? {}) as Partial<AudienceRules>
  const lists = {
    industries: strings(r.industries),
    statuses: strings(r.statuses),
    statusTypes: strings(r.statusTypes),
    sources: strings(r.sources),
    campaignIds: strings(r.campaignIds),
    eventIds: strings(r.eventIds),
    ownerIds: strings(r.ownerIds),
  }
  if (Object.values(lists).some((x) => x === null)) return 'Rules are lists of industries, statuses, status types, sources, campaigns, events and owners.'
  if (lists.statusTypes!.some((t) => !STATUS_TYPES.includes(t as StatusType))) return 'Status types are open, cold, won and lost.'
  if (lists.ownerIds!.some((id) => !users.some((u) => u.id === id && u.companyId === co))) return 'Pick owners from your team.'
  if (lists.campaignIds!.some((id) => !campaigns.some((c) => c.companyId === co && c.id === id))) return 'That campaign doesn’t exist.'
  if (lists.eventIds!.some((id) => !events.some((e) => e.companyId === co && e.id === id))) return 'That event doesn’t exist.'
  const dates = {
    createdFrom: dateOrNull(r.createdFrom),
    createdTo: dateOrNull(r.createdTo),
    lastActivityBefore: dateOrNull(r.lastActivityBefore),
    lastActivityAfter: dateOrNull(r.lastActivityAfter),
  }
  if (Object.values(dates).some((d) => d === false)) return 'Dates use the format YYYY-MM-DD.'
  if (dates.createdFrom && dates.createdTo && dates.createdTo < dates.createdFrom) return '“Created to” must be on or after “created from”.'
  if (r.hasEmail !== undefined && typeof r.hasEmail !== 'boolean') return 'hasEmail is true or false.'
  const eventPresence = (r.eventPresence ?? 'any') as EventPresence
  if (!EVENT_PRESENCE.includes(eventPresence)) return 'Event presence is any, attended or no_show.'
  if (eventPresence !== 'any' && !lists.eventIds!.length) return 'Pick the event(s) for attended / no-show.'
  return {
    ...EMPTY_RULES,
    ...(lists as Record<string, string[]>),
    statusTypes: lists.statusTypes as StatusType[],
    createdFrom: dates.createdFrom || null,
    createdTo: dates.createdTo || null,
    lastActivityBefore: dates.lastActivityBefore || null,
    lastActivityAfter: dates.lastActivityAfter || null,
    hasEmail: r.hasEmail === true,
    eventPresence,
  }
}

const validEmail = (e: string | undefined | null) => EMAIL_RE.test((e ?? '').trim())

/** Leads of the company matching the rules (Do Not Contact included; callers decide), in lead-id order. */
export function matchRules(co: string, rules: AudienceRules): Tenant<Lead>[] {
  const tz = tzOf(co)
  const dayOf = (iso: string) => zonedParts(iso, tz).date
  const eventLeads = new Set<string>()
  if (rules.eventIds.length) {
    const presence = rules.eventPresence ?? 'any'
    const rows = eventAttendees.filter((a) => a.companyId === co && a.leadId && rules.eventIds.includes(a.eventId))
    const attended = new Set(rows.filter((a) => a.status === 'registered' && a.checkedInAt).map((a) => a.leadId!))
    for (const a of rows) {
      if (presence === 'any') eventLeads.add(a.leadId!)
      else if (presence === 'attended' && attended.has(a.leadId!)) eventLeads.add(a.leadId!)
      else if (presence === 'no_show' && a.status === 'registered' && !a.checkedInAt && !attended.has(a.leadId!)) eventLeads.add(a.leadId!)
    }
  }
  let lastActivity: Map<string, string> | null = null
  if (rules.lastActivityAfter || rules.lastActivityBefore) {
    lastActivity = new Map()
    for (const a of activities) {
      if (a.companyId !== co) continue
      const prev = lastActivity.get(a.leadId)
      if (!prev || a.at > prev) lastActivity.set(a.leadId, a.at)
    }
  }
  return leads
    .filter((l) => {
      if (l.companyId !== co) return false
      if (rules.industries.length && !rules.industries.includes(l.industry)) return false
      if (rules.statuses.length || rules.statusTypes.length) {
        const type = statusOf(co, l.status)?.type as StatusType | undefined
        const byStatus = rules.statuses.includes(l.status)
        const byType = !!type && rules.statusTypes.includes(type)
        if (!byStatus && !byType) return false
      }
      if (rules.sources.length && !rules.sources.includes(l.sourceType)) return false
      if (rules.campaignIds.length && !rules.campaignIds.includes(l.campaignId ?? '')) return false
      // Attended / no-show are decided by the attendee rows only (a lead's event_id alone says neither).
      if (rules.eventIds.length && (rules.eventPresence ?? 'any') === 'any' && !rules.eventIds.includes(l.eventId ?? '') && !eventLeads.has(l.id)) return false
      if (rules.eventIds.length && (rules.eventPresence ?? 'any') !== 'any' && !eventLeads.has(l.id)) return false
      if (rules.ownerIds.length && !rules.ownerIds.includes(l.ownerId)) return false
      const created = dayOf(l.createdAt)
      if (rules.createdFrom && created < rules.createdFrom) return false
      if (rules.createdTo && created > rules.createdTo) return false
      if (lastActivity) {
        const iso = [lastActivity.get(l.id), l.createdAt].filter((x): x is string => !!x).sort().pop()!
        const last = dayOf(iso)
        if (rules.lastActivityAfter && last < rules.lastActivityAfter) return false
        if (rules.lastActivityBefore && last >= rules.lastActivityBefore) return false
      }
      if (rules.hasEmail && !validEmail(l.contactEmail) && !contacts.some((c) => c.companyId === co && c.leadId === l.id && validEmail(c.email))) return false
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

/** Every lead of the audience, Do Not Contact still in (the bulk email counts them as excluded). */
export function audienceLeadsWithDnc(a: Tenant<AudienceRecord>): Tenant<Lead>[] {
  if (a.kind === 'static') {
    const ids = new Set(a.memberLeadIds)
    return leads.filter((l) => l.companyId === a.companyId && ids.has(l.id)).sort((x, y) => x.id.localeCompare(y.id, 'en', { numeric: true }))
  }
  return matchRules(a.companyId, a.rules)
}

/** The leads a bulk email using this audience starts from (resolved now; null = no such audience in the company). */
export function audienceLeadIds(co: string, id: string): Set<string> | null {
  const a = audiences.find((x) => x.companyId === co && x.id === id)
  return a ? new Set(audienceLeadsWithDnc(a).map((l) => l.id)) : null
}

/** Emails of a lead: its own, then its contacts' (valid, lower case, unique). */
function emailsOf(co: string, l: Lead): string[] {
  const list = [l.contactEmail, ...contacts.filter((c) => c.companyId === co && c.leadId === l.id).map((c) => c.email)]
  return [...new Set(list.filter(validEmail).map((e) => e.trim().toLowerCase()))]
}

function countsOf(co: string, list: Tenant<Lead>[]): AudienceCounts {
  const members = list.filter((l) => !l.doNotContact)
  const emails = new Set(members.flatMap((l) => emailsOf(co, l)))
  return { leads: members.length, emails: emails.size, excludedDnc: list.length - members.length }
}

function membersOf(co: string, list: Tenant<Lead>[]): AudienceMember[] {
  return list
    .filter((l) => !l.doNotContact)
    .slice(0, MEMBER_PREVIEW)
    .map((l) => {
      const emails = emailsOf(co, l)
      return {
        leadId: l.id,
        company: l.company,
        name: l.contactName,
        email: l.contactEmail,
        status: l.status,
        ownerName: ownerName(l.ownerId),
        contacts: Math.max(0, emails.length - (validEmail(l.contactEmail) ? 1 : 0)),
      }
    })
}

/* ---------------- Views ---------------- */

function view(a: Tenant<AudienceRecord>): Audience {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    rules: { ...a.rules },
    kind: a.kind,
    frozenAt: a.frozenAt,
    counts: countsOf(a.companyId, audienceLeadsWithDnc(a)),
    createdBy: a.createdBy,
    createdByName: ownerName(a.createdBy),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

function detail(a: Tenant<AudienceRecord>): AudienceDetail {
  return { ...view(a), members: membersOf(a.companyId, audienceLeadsWithDnc(a)) }
}

async function audienceFor(user: User, id: string): Promise<Tenant<AudienceRecord>> {
  const a = findInTenant(audiences, user, (x) => x.id === id)
  if (!a) return fail(NOT_FOUND, 404)
  return a
}

/* ---------------- Endpoints ---------------- */

export async function listAudiences(user: User): Promise<Audience[]> {
  await requireMarketingView(user)
  return delay(scoped(audiences, user).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(view))
}

export async function getAudience(user: User, id: string): Promise<AudienceDetail> {
  await requireMarketingView(user)
  return delay(detail(await audienceFor(user, id)))
}

export async function getAudienceOptions(user: User): Promise<AudienceOptions> {
  const co = await requireMarketingView(user)
  return delay({
    owners: users.filter((u) => u.companyId === co && u.active !== false).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
    campaigns: scoped(campaigns, user).map((c) => ({ id: c.id, name: c.name })),
    events: events.filter((e) => e.companyId === co).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map((e) => ({ id: e.id, name: e.name })),
  })
}

/** POST /marketing/audiences/preview { rules } — live count and the first members of unsaved rules. */
export async function previewRules(user: User, raw: Partial<AudienceRules> | undefined): Promise<AudiencePreviewResult> {
  const co = await requireMarketingView(user)
  const rules = rulesOf(co, raw)
  if (typeof rules === 'string') return fail(rules, 422)
  const list = matchRules(co, rules)
  return delay({ counts: countsOf(co, list), members: membersOf(co, list) })
}

function fieldsOf(co: string, input: AudienceUpdateInput, existing?: AudienceRecord): Partial<AudienceRecord> | string {
  const out: Partial<AudienceRecord> = {}
  if (input.name !== undefined || !existing) {
    const name = str(input.name)
    if (!name) return 'Give the audience a name.'
    if (name.length > 120) return 'Keep the name under 120 characters.'
    if (audiences.some((a) => a.companyId === co && a.id !== existing?.id && a.name.toLowerCase() === name.toLowerCase())) return `An audience called “${name}” already exists.`
    out.name = name
  }
  if (input.description !== undefined) out.description = str(input.description).slice(0, 500)
  if (input.rules !== undefined || !existing) {
    const rules = rulesOf(co, input.rules)
    if (typeof rules === 'string') return rules
    out.rules = rules
  }
  if (input.kind !== undefined) {
    if (input.kind !== 'dynamic' && input.kind !== 'static') return 'The audience is dynamic or static.'
    out.kind = input.kind
  }
  return out
}

/** Freezes the current matches of the rules (Do Not Contact included in the list: it is removed whenever the audience is used). */
function freeze(a: Tenant<AudienceRecord>): void {
  a.memberLeadIds = matchRules(a.companyId, a.rules).map((l) => l.id)
  a.frozenAt = nowIso()
}

export async function createAudience(user: User, input: AudienceInput): Promise<AudienceDetail> {
  const co = await requireMarketingEdit(user)
  const fields = fieldsOf(co, input ?? ({} as AudienceInput))
  if (typeof fields === 'string') return fail(fields, 422)
  const at = nowIso()
  const row: Tenant<AudienceRecord> = stamp(
    {
      id: nextGrowthId('AUD'),
      name: fields.name!,
      description: fields.description ?? '',
      rules: fields.rules!,
      kind: fields.kind ?? 'dynamic',
      frozenAt: null,
      memberLeadIds: [],
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  if (row.kind === 'static') freeze(row)
  audiences.push(row)
  return delay(detail(row))
}

/**
 * PATCH: name, description, rules, kind. A static audience keeps its frozen members when its rules
 * change (use POST /:id/freeze to take the new matches); switching dynamic → static freezes now.
 */
export async function updateAudience(user: User, id: string, input: AudienceUpdateInput): Promise<AudienceDetail> {
  const co = await requireMarketingView(user)
  const a = await audienceFor(user, id)
  await requireMarketingEdit(user)
  const fields = fieldsOf(co, input ?? {}, a)
  if (typeof fields === 'string') return fail(fields, 422)
  const becameStatic = fields.kind === 'static' && a.kind !== 'static'
  Object.assign(a, fields, { updatedAt: nowIso() })
  if (becameStatic) freeze(a)
  if (a.kind === 'dynamic') {
    a.memberLeadIds = []
    a.frozenAt = null
  }
  return delay(detail(a))
}

/** POST /:id/freeze — (re)freeze the members from the current rules; the audience becomes static. */
export async function freezeAudience(user: User, id: string): Promise<AudienceDetail> {
  await requireMarketingView(user)
  const a = await audienceFor(user, id)
  await requireMarketingEdit(user)
  a.kind = 'static'
  freeze(a)
  a.updatedAt = a.frozenAt!
  return delay(detail(a))
}

export async function deleteAudience(user: User, id: string): Promise<{ deleted: true }> {
  await requireMarketingView(user)
  const a = await audienceFor(user, id)
  await requireMarketingEdit(user)
  audiences.splice(audiences.indexOf(a), 1)
  return delay({ deleted: true as const })
}

/** SHA-256 hex of the trimmed, lower-cased address (the custom-audience upload format of ads platforms). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text.trim().toLowerCase())
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * GET /marketing/audiences/:id/export?hashed=&include_contacts= — the audience's emails as a CSV for
 * ads platforms (Do Not Contact never included). Plain: `email`; hashed: `email_sha256`. Marketing full only
 * (it takes personal data out of the CRM).
 */
export async function exportAudience(user: User, id: string, q: { hashed?: boolean; includeContacts?: boolean }): Promise<AudienceExport> {
  await requireMarketingView(user)
  const a = await audienceFor(user, id)
  await requireMarketingEdit(user)
  const includeContacts = q.includeContacts !== false
  const list = audienceLeadsWithDnc(a).filter((l) => !l.doNotContact)
  const emails = [...new Set(list.flatMap((l) => (includeContacts ? emailsOf(a.companyId, l) : validEmail(l.contactEmail) ? [l.contactEmail.trim().toLowerCase()] : [])))]
  const hashed = q.hashed === true
  const values = hashed ? await Promise.all(emails.map(sha256Hex)) : emails
  const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'audience'
  return delay({
    fileName: `${slug}${hashed ? '-sha256' : ''}.csv`,
    content: [hashed ? 'email_sha256' : 'email', ...values].join('\n') + '\n',
    rows: values.length,
    hashed,
  })
}
