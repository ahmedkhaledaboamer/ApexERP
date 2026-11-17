import type { User } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import type {
  MessageTemplate,
  TemplateChannel,
  TemplateFilter,
  TemplateInput,
  TemplatePurpose,
  TemplateUpdateInput,
} from '@/modules/settings/templates/types'
import {
  BODY_MAX,
  CHANNEL_LABELS,
  NAME_MAX,
  PURPOSES_BY_CHANNEL,
  SUBJECT_MAX,
  TEMPLATE_CHANNELS,
  WHATSAPP_MAX,
} from '@/modules/settings/templates/types'
import { unknownVariables } from '@/modules/settings/templates/render'
import { nextTemplateId, templates } from '@/shared/mocks/data/templates'
import { diff, recordAudit } from '@/shared/mocks/data/audit'
import { delay, fail } from '@/shared/mocks/server'

/**
 * Message templates. Any signed-in user can read active ones (agents and the AI agent pick
 * from them); Settings viewers (System Admin, Management) also see inactive ones. Only a
 * System Admin edits. Templates are deactivated, never deleted. Every write is audited.
 */

const ENTITY = 'template'

function canEdit(user: User) {
  return can(user.role, 'settings', 'edit')
}

function seesInactive(user: User) {
  return can(user.role, 'settings', 'view')
}

function find(id: string): MessageTemplate | undefined {
  return templates.find((t) => t.id === id)
}

function touch(user: User, t: MessageTemplate) {
  t.updatedAt = new Date().toISOString()
  t.updatedBy = user.name
}

/** Fields compared in audit diffs (not timestamps). */
function auditable(t: MessageTemplate) {
  return { name: t.name, purpose: t.purpose, subject: t.subject, body: t.body, active: t.active, isDefault: t.isDefault }
}

/** The current default for a channel + purpose, other than `exceptId`. */
function defaultOf(channel: TemplateChannel, purpose: TemplatePurpose, exceptId?: string) {
  return templates.find((t) => t.channel === channel && t.purpose === purpose && t.isDefault && t.id !== exceptId)
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Validates and normalizes a full template; returns an error message or the clean fields. */
function validate(
  channel: TemplateChannel,
  raw: { name?: unknown; purpose?: unknown; subject?: unknown; body?: unknown },
  selfId?: string,
): string | { name: string; purpose: TemplatePurpose; subject: string; body: string } {
  const name = clean(raw.name)
  const subject = channel === 'email' ? clean(raw.subject) : ''
  // Keep the body's inner whitespace (line breaks matter); trim only the ends.
  const body = typeof raw.body === 'string' ? raw.body.replace(/^\s+|\s+$/g, '') : ''
  const purpose = raw.purpose as TemplatePurpose

  if (!name) return 'Give the template a name.'
  if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
  if (templates.some((t) => t.id !== selfId && t.channel === channel && t.name.toLowerCase() === name.toLowerCase())) {
    return `There's already a ${CHANNEL_LABELS[channel]} template called “${name}”.`
  }
  if (!PURPOSES_BY_CHANNEL[channel].includes(purpose)) return `Choose what this ${CHANNEL_LABELS[channel]} template is for.`
  if (channel === 'email' && !subject) return 'Email templates need a subject.'
  if (subject.length > SUBJECT_MAX) return `Keep the subject under ${SUBJECT_MAX} characters.`
  if (!body) return 'The message can’t be empty.'
  if (channel === 'whatsapp' && body.length > WHATSAPP_MAX) {
    return `WhatsApp messages can be at most ${WHATSAPP_MAX} characters (this one has ${body.length}).`
  }
  if (body.length > BODY_MAX) return `Keep the message under ${BODY_MAX} characters.`
  const unknown = [...new Set([...unknownVariables(subject), ...unknownVariables(body)])]
  if (unknown.length) {
    return `Unknown ${unknown.length === 1 ? 'variable' : 'variables'}: ${unknown.map((k) => `{{${k}}}`).join(', ')}.`
  }
  return { name, purpose, subject, body }
}

/* ---------------- Reads ---------------- */

export async function getTemplates(user: User, filter: TemplateFilter = {}): Promise<MessageTemplate[]> {
  const rows = templates.filter(
    (t) =>
      (!filter.channel || t.channel === filter.channel) &&
      (!filter.purpose || t.purpose === filter.purpose) &&
      (filter.active === undefined || t.active === filter.active) &&
      (t.active || seesInactive(user)),
  )
  return delay(rows)
}

export async function getTemplate(user: User, id: string): Promise<MessageTemplate> {
  const t = find(id)
  if (!t || (!t.active && !seesInactive(user))) return fail('Template not found.', 404)
  return delay(t)
}

/* ---------------- Writes (System Admin) ---------------- */

export async function createTemplate(user: User, input: TemplateInput): Promise<MessageTemplate> {
  if (!canEdit(user)) return fail('Only a System Admin can create templates.', 403)
  const channel = input?.channel
  if (!TEMPLATE_CHANNELS.includes(channel)) return fail('Choose Email, Quotation or WhatsApp.', 422)
  const v = validate(channel, input)
  if (typeof v === 'string') return fail(v, 422)

  const t: MessageTemplate = {
    id: nextTemplateId(),
    channel,
    ...v,
    active: true,
    // The first template for a channel + purpose becomes its default.
    isDefault: !defaultOf(channel, v.purpose),
    updatedAt: new Date().toISOString(),
    updatedBy: user.name,
  }
  templates.push(t)
  recordAudit(user, {
    action: 'create',
    entity: ENTITY,
    entityId: t.id,
    summary: `Created ${CHANNEL_LABELS[channel]} template “${t.name}”`,
  })
  return delay(t)
}

export async function updateTemplate(user: User, id: string, input: TemplateUpdateInput): Promise<MessageTemplate> {
  if (!canEdit(user)) return fail('Only a System Admin can edit templates.', 403)
  const t = find(id)
  if (!t) return fail('Template not found.', 404)
  const v = validate(t.channel, { ...auditable(t), ...input }, t.id)
  if (typeof v === 'string') return fail(v, 422)

  const before = auditable(t)
  const purposeChanged = v.purpose !== t.purpose
  Object.assign(t, v)
  // Moving a default into a purpose that already has one: the existing default wins.
  if (purposeChanged && t.isDefault && defaultOf(t.channel, t.purpose, t.id)) t.isDefault = false
  // Moving into a purpose with no default (and the template is active): it becomes the default.
  if (purposeChanged && !t.isDefault && t.active && !defaultOf(t.channel, t.purpose, t.id)) t.isDefault = true

  const changes = diff(before, auditable(t))
  if (changes.length === 0) return delay(t)
  touch(user, t)
  recordAudit(user, {
    action: 'update',
    entity: ENTITY,
    entityId: t.id,
    summary: `Edited ${CHANNEL_LABELS[t.channel]} template “${t.name}”`,
    changes,
  })
  return delay(t)
}

/** Copies a template as an active, non-default template named “… (copy)”. */
export async function duplicateTemplate(user: User, id: string): Promise<MessageTemplate> {
  if (!canEdit(user)) return fail('Only a System Admin can duplicate templates.', 403)
  const src = find(id)
  if (!src) return fail('Template not found.', 404)

  const taken = (name: string) => templates.some((t) => t.channel === src.channel && t.name.toLowerCase() === name.toLowerCase())
  const base = `${src.name.replace(/ \(copy(?: \d+)?\)$/, '')} (copy)`.slice(0, NAME_MAX)
  let name = base
  for (let n = 2; taken(name); n++) name = `${base.replace(/\)$/, '')} ${n})`

  const t: MessageTemplate = {
    ...src,
    id: nextTemplateId(),
    name,
    active: true,
    isDefault: false,
    updatedAt: new Date().toISOString(),
    updatedBy: user.name,
  }
  templates.push(t)
  recordAudit(user, {
    action: 'create',
    entity: ENTITY,
    entityId: t.id,
    summary: `Duplicated template “${src.name}” as “${t.name}”`,
  })
  return delay(t)
}

/** Makes this the default for its channel + purpose; the previous default loses the flag. */
export async function makeDefaultTemplate(user: User, id: string): Promise<MessageTemplate> {
  if (!canEdit(user)) return fail('Only a System Admin can change default templates.', 403)
  const t = find(id)
  if (!t) return fail('Template not found.', 404)
  if (!t.active) return fail('Reactivate this template before making it the default.', 422)
  if (t.isDefault) return delay(t)

  const previous = defaultOf(t.channel, t.purpose, t.id)
  if (previous) {
    previous.isDefault = false
    touch(user, previous)
  }
  t.isDefault = true
  touch(user, t)
  recordAudit(user, {
    action: 'update',
    entity: ENTITY,
    entityId: t.id,
    summary: `Made “${t.name}” the default ${CHANNEL_LABELS[t.channel]} template for ${t.purpose}`,
    changes: [{ field: 'default', from: previous?.name ?? '—', to: t.name }],
  })
  return delay(t)
}

export async function setTemplateActive(user: User, id: string, active: boolean): Promise<MessageTemplate> {
  if (!canEdit(user)) return fail('Only a System Admin can deactivate templates.', 403)
  const t = find(id)
  if (!t) return fail('Template not found.', 404)
  if (t.active === active) return delay(t)

  const wasDefault = t.isDefault
  t.active = active
  // An inactive template can't stay the default; the channel + purpose is left without one.
  if (!active) t.isDefault = false
  // Reactivating into a purpose with no default restores it as the default.
  if (active && !defaultOf(t.channel, t.purpose, t.id)) t.isDefault = true
  touch(user, t)
  recordAudit(user, {
    action: active ? 'reactivate' : 'deactivate',
    entity: ENTITY,
    entityId: t.id,
    summary: `${active ? 'Reactivated' : 'Deactivated'} ${CHANNEL_LABELS[t.channel]} template “${t.name}”${
      wasDefault && !active ? ` (no default left for ${t.purpose})` : ''
    }`,
    changes: [{ field: 'active', from: String(!active), to: String(active) }],
  })
  return delay(t)
}
