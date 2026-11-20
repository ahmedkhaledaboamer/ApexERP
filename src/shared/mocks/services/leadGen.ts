import type { Activity, User } from '@/shared/types'
import type {
  FormField,
  FormStats,
  FormSubmission,
  LandingPage,
  LandingPageInput,
  LandingPageUpdateInput,
  LeadForm,
  LeadFormInput,
  LeadFormUpdateInput,
  PublicForm,
  PublicFormSubmitInput,
  PublicFormSubmitResult,
  PublicLandingPage,
  SubmissionChannel,
  SubmissionOutcome,
  UtmLink,
  UtmLinkInput,
} from '@/modules/marketing/growth/types'
import { FORM_FIELD_LABEL, FORM_FIELD_TYPES, MAX_CUSTOM_FIELDS, buildUtmUrl } from '@/modules/marketing/growth/types'
import type { CountryCode } from '@/modules/tenancy/types'
import { ApiError } from '@/shared/lib/apiError'
import { can, scopeOf } from '@/shared/lib/permissions'
import { isMobile, normalizeMobile } from '@/shared/lib/phone'
import { activities, contacts, leads, users } from '@/shared/mocks/db'
import { campaigns } from '@/shared/mocks/data/marketing'
import {
  formSubmissions,
  formSubmitHits,
  landingPages,
  leadForms,
  newFormKey,
  nextGrowthId,
  utmLinks,
  type LandingPageRecord,
  type LeadFormRecord,
  type UtmLinkRecord,
} from '@/shared/mocks/data/marketingGrowth'
import { isWonStatus, lookupsFor } from '@/shared/mocks/data/lookups'
import { companyById } from '@/shared/mocks/data/tenancy'
import { effectiveModules, resolveWorkspace } from '@/shared/mocks/data/platform'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { planAt } from '@/shared/mocks/data/plans'
import { nowIso } from '@/shared/mocks/clock'
import { delay, fail, ownerName } from '@/shared/mocks/server'
import { CodedApiError, findInTenant, scoped, stamp, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { assertCapacity, isReadOnly, LimitReachedError, noteUsage } from '@/shared/mocks/services/billing'
import { insertLead, mobileHint } from '@/shared/mocks/services/leads'
import { hitRateLimit } from '@/shared/mocks/services/rateLimit'

/* ------------------------------------------------------------------------------------------
 * Marketing › Lead generation (plan module `marketing`; docs/API.md › Marketing › Lead generation):
 * lead capture forms (builder, hosted page /f/:key, embed), their public submit endpoint (no auth,
 * honeypot, rate limit, the lead creation rule of event registration), landing pages (/p/:slug) and
 * UTM links. Role rights: the Marketing column (hidden 403, view reads, full writes). Everything is
 * scoped to the caller's company; another company's id answers exactly like a missing one.
 * ---------------------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,31}$/
const FORM_NOT_FOUND = 'That form doesn’t exist.'
const PAGE_NOT_FOUND = 'That landing page doesn’t exist.'
const LINK_NOT_FOUND = 'That link doesn’t exist.'
const CAMPAIGN_NOT_FOUND = 'That campaign doesn’t exist.'
const DEFAULT_SUCCESS = 'Thanks! We’ll be in touch soon.'

/** Public submit rate limit: per client and per email, per form, in a sliding window. */
export const FORM_SUBMIT_LIMIT = 5
export const FORM_SUBMIT_WINDOW_MINUTES = 10

/* ---------------- Access ---------------- */

export async function requireMarketingView(user: User): Promise<string> {
  if (!can(user.role, 'marketing', 'view')) return fail('Your role has no access to Marketing.', 403)
  return tenantOf(user)
}

export async function requireMarketingEdit(user: User): Promise<string> {
  const co = await requireMarketingView(user)
  if (!can(user.role, 'marketing', 'edit')) return fail('Your role can view marketing but not change it.', 403)
  return co
}

/** The company's plan (± platform overrides) includes Marketing. */
export function marketingEnabledIn(companyId: string): boolean {
  const sub = subscriptionOf(companyId)
  if (!sub) return false
  return effectiveModules(companyId, planAt(sub.planId, sub.planVersion).modules).includes('marketing')
}

/* ---------------- Helpers ---------------- */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
const countryOf = (co: string) => (companyById(co)?.regional.country ?? 'AE') as CountryCode
const userName = (id: string | null | undefined) => (id ? ownerName(id) : '')
const untenant = <T extends { companyId: string }>(row: T): Omit<T, 'companyId'> => {
  const { companyId: _c, ...rest } = row
  return rest
}

/** People who can own leads: active, with a Sales & CRM scope that owns records (not view / hidden). */
const canOwnLeads = (u: User) => u.active !== false && ['full', 'team', 'own'].includes(scopeOf(u.role, 'sales'))
const companyUser = (co: string, id: string) => users.find((u) => u.id === id && u.companyId === co)

/** The lead with this email (the lead's email or one of its contacts'), in the company. */
function leadByEmail(co: string, email: string): string | null {
  if (!email) return null
  const direct = leads.find((l) => l.companyId === co && l.contactEmail.trim().toLowerCase() === email)
  if (direct) return direct.id
  const c = contacts.find((x) => x.companyId === co && x.leadId && x.email.trim().toLowerCase() === email)
  return c?.leadId ?? null
}

/* ---------------- Forms: views ---------------- */

function submissionsOf(f: Pick<Tenant<LeadFormRecord>, 'id' | 'companyId'>): Tenant<FormSubmission>[] {
  return formSubmissions.filter((s) => s.companyId === f.companyId && s.formId === f.id)
}

function statsOf(f: Tenant<LeadFormRecord>): FormStats {
  const subs = submissionsOf(f)
  const count = (o: SubmissionOutcome) => subs.filter((s) => s.outcome === o).length
  const real = subs.length - count('spam')
  const created = subs.filter((s) => s.outcome === 'created' && s.leadId).map((s) => s.leadId!)
  const wonDeals = created.filter((id) => {
    const lead = leads.find((l) => l.id === id && l.companyId === f.companyId)
    return !!lead && isWonStatus(f.companyId, lead.status)
  }).length
  return {
    views: f.views,
    submissions: real,
    conversionRate: rate(real, f.views),
    leadsCreated: count('created'),
    leadsLinked: count('linked'),
    limitReached: count('limit'),
    spam: count('spam'),
    wonDeals,
  }
}

function formView(f: Tenant<LeadFormRecord>): LeadForm {
  const campaign = f.campaignId ? campaigns.find((c) => c.companyId === f.companyId && c.id === f.campaignId) : undefined
  return {
    ...untenant(f),
    fields: f.fields.map((x) => ({ ...x })),
    ownerIds: [...f.ownerIds],
    ownerNames: f.ownerIds.map(userName),
    campaignName: campaign?.name ?? null,
    createdByName: userName(f.createdBy),
    stats: statsOf(f),
  } as LeadForm
}

async function formFor(user: User, id: string): Promise<Tenant<LeadFormRecord>> {
  const f = findInTenant(leadForms, user, (x) => x.id === id)
  if (!f) return fail(FORM_NOT_FOUND, 404)
  return f
}

export async function listForms(user: User): Promise<LeadForm[]> {
  await requireMarketingView(user)
  return delay(scoped(leadForms, user).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(formView))
}

export async function getForm(user: User, id: string): Promise<LeadForm> {
  await requireMarketingView(user)
  return delay(formView(await formFor(user, id)))
}

/* ---------------- Forms: validation ---------------- */

function cleanFields(raw: unknown): FormField[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'Add at least one field to the form.'
  if (raw.length > 20) return 'Keep the form under 20 fields.'
  const out: FormField[] = []
  const ids = new Set<string>()
  const types = new Set<string>()
  for (const item of raw) {
    const v = (item ?? {}) as Partial<FormField>
    if (!FORM_FIELD_TYPES.includes(v.type as never)) return 'Each field must be a lead field: company name, contact name, email, mobile, industry, source detail, message or a custom question.'
    const type = v.type!
    if (type !== 'custom' && types.has(type)) return `The form already has a ${FORM_FIELD_LABEL[type].toLowerCase()} field.`
    types.add(type)
    const id = str(v.key) || type
    if (!FIELD_ID_RE.test(id) || ids.has(id)) return 'Field keys must be unique (letters, digits and _).'
    ids.add(id)
    const label = str(v.label) || FORM_FIELD_LABEL[type]
    if (label.length > 160) return 'Keep field labels under 160 characters.'
    out.push({ key: id, type, label, required: v.required === true })
  }
  if (out.filter((x) => x.type === 'custom').length > MAX_CUSTOM_FIELDS) return `Use at most ${MAX_CUSTOM_FIELDS} custom questions.`
  if (!types.has('contact_name') && !types.has('company_name')) return 'Add a contact name or a company name field.'
  if (!out.some((x) => (x.type === 'email' || x.type === 'mobile') && x.required)) return 'Add an email or mobile field and make it required, so the team can follow up.'
  return out
}

function formFields(co: string, input: LeadFormUpdateInput, existing?: LeadFormRecord): Partial<LeadFormRecord> | string {
  const out: Partial<LeadFormRecord> = {}
  if (input.name !== undefined || !existing) {
    const name = str(input.name)
    if (!name) return 'Give the form a name.'
    if (name.length > 120) return 'Keep the name under 120 characters.'
    out.name = name
  }
  if (input.fields !== undefined || !existing) {
    const fields = cleanFields(input.fields)
    if (typeof fields === 'string') return fields
    out.fields = fields
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'paused') return 'The status is active or paused.'
    out.status = input.status
  }
  if (input.successMessage !== undefined) {
    const m = str(input.successMessage)
    if (m.length > 500) return 'Keep the success message under 500 characters.'
    out.successMessage = m || DEFAULT_SUCCESS
  }
  if (input.redirectUrl !== undefined) {
    const u = str(input.redirectUrl)
    if (u && (!URL_RE.test(u) || u.length > 500)) return 'The redirect URL must start with https:// or http://.'
    out.redirectUrl = u || null
  }
  if (input.ownerIds !== undefined) {
    if (!Array.isArray(input.ownerIds) || input.ownerIds.some((x) => typeof x !== 'string')) return 'Owners must be a list of users.'
    const ids = [...new Set(input.ownerIds)]
    // Another company's user answers exactly like a missing one.
    if (ids.some((id) => { const u = companyUser(co, id); return !u || !canOwnLeads(u) })) return 'Pick owners from your team who can own leads.'
    out.ownerIds = ids
  }
  if (input.campaignId !== undefined) {
    if (input.campaignId && !campaigns.some((c) => c.companyId === co && c.id === input.campaignId)) return CAMPAIGN_NOT_FOUND
    out.campaignId = input.campaignId || null
  }
  if (input.source !== undefined || !existing) {
    const source = str(input.source)
    if (!lookupsFor(co).sources.some((s) => s.active && s.key === source)) return 'Pick a lead source from your list (Settings › Fixed lists).'
    out.source = source
  }
  if (input.consentText !== undefined) {
    const t = str(input.consentText)
    if (t.length > 500) return 'Keep the consent text under 500 characters.'
    out.consentText = t
  }
  return out
}

export async function createForm(user: User, input: LeadFormInput): Promise<LeadForm> {
  const co = await requireMarketingEdit(user)
  const fields = formFields(co, input ?? ({} as LeadFormInput))
  if (typeof fields === 'string') return fail(fields, 422)
  const at = nowIso()
  const row: Tenant<LeadFormRecord> = stamp(
    {
      id: nextGrowthId('LF'),
      name: fields.name!,
      publicKey: newFormKey(),
      status: fields.status ?? 'active',
      fields: fields.fields!,
      successMessage: fields.successMessage ?? DEFAULT_SUCCESS,
      redirectUrl: fields.redirectUrl ?? null,
      ownerIds: fields.ownerIds ?? [],
      campaignId: fields.campaignId ?? null,
      source: fields.source!,
      consentText: fields.consentText ?? '',
      views: 0,
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  leadForms.push(row)
  return delay(formView(row))
}

export async function updateForm(user: User, id: string, input: LeadFormUpdateInput): Promise<LeadForm> {
  const co = await requireMarketingView(user)
  const f = await formFor(user, id)
  await requireMarketingEdit(user)
  const fields = formFields(co, input ?? {}, f)
  if (typeof fields === 'string') return fail(fields, 422)
  Object.assign(f, fields, { updatedAt: nowIso() })
  return delay(formView(f))
}

/** DELETE: only a form nobody submitted (else pause it, so its stats and leads keep their history). */
export async function deleteForm(user: User, id: string): Promise<{ deleted: true }> {
  await requireMarketingView(user)
  const f = await formFor(user, id)
  await requireMarketingEdit(user)
  if (submissionsOf(f).length) return fail('This form has submissions; pause it instead of deleting it.', 409)
  leadForms.splice(leadForms.indexOf(f), 1)
  for (const p of landingPages) if (p.companyId === f.companyId && p.formId === f.id) p.formId = null
  return delay({ deleted: true as const })
}

export async function listSubmissions(user: User, id: string): Promise<FormSubmission[]> {
  await requireMarketingView(user)
  const f = await formFor(user, id)
  return delay(submissionsOf(f).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).map((s) => untenant(s) as FormSubmission))
}

/* ---------------- Public form (no auth) ---------------- */

/**
 * The form behind a public key. Unknown key, a company without the Marketing module (plan or platform
 * override), a deleted workspace or a suspended company → 404, the same answer, so keys can't be probed.
 */
function publicFormOf(key: string): Tenant<LeadFormRecord> {
  const f = key ? leadForms.find((x) => x.publicKey === key) : undefined
  const sub = f ? subscriptionOf(f.companyId) : undefined
  if (!f || !marketingEnabledIn(f.companyId) || !sub || sub.status === 'deleted' || companyById(f.companyId)?.status === 'suspended') {
    throw new CodedApiError('This form isn’t available.', 404, 'form_not_found')
  }
  return f
}

function closedReason(f: Tenant<LeadFormRecord>): string | null {
  if (f.status === 'paused') return 'This form isn’t accepting responses right now.'
  const sub = subscriptionOf(f.companyId)
  if (sub && isReadOnly(sub.status)) return 'This form isn’t accepting responses right now.'
  return null
}

function publicView(f: Tenant<LeadFormRecord>): PublicForm {
  const c = companyById(f.companyId)
  const industries = lookupsFor(f.companyId).industries.filter((i) => i.active).map((i) => ({ value: i.key, label: i.label }))
  const reason = closedReason(f)
  return {
    publicKey: f.publicKey,
    name: f.name,
    fields: f.fields.map((x) => (x.type === 'industry' ? { ...x, options: industries } : { ...x })),
    successMessage: f.successMessage,
    redirectUrl: f.redirectUrl,
    consentText: f.consentText,
    accepting: reason === null,
    closedReason: reason,
    organizerName: c?.branding.displayName ?? c?.name ?? '',
    country: countryOf(f.companyId),
  }
}

/** GET /public/forms/:key — the hosted page and the embed load it; each load counts one view. */
export async function getPublicForm(key: string): Promise<PublicForm> {
  const f = publicFormOf(key)
  f.views++
  return delay(publicView(f))
}

interface CleanSubmission {
  name: string
  companyName: string
  email: string
  mobile: string
  industry: string
  sourceDetail: string
  answers: { label: string; value: string }[]
  noteLines: string[]
}

function cleanSubmission(f: Tenant<LeadFormRecord>, values: Record<string, unknown>): CleanSubmission | string {
  const country = countryOf(f.companyId)
  const out: CleanSubmission = { name: '', companyName: '', email: '', mobile: '', industry: '', sourceDetail: '', answers: [], noteLines: [] }
  for (const field of f.fields) {
    const raw = values[field.key]
    const value = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
    const max = field.type === 'message' || field.type === 'custom' ? 2000 : 255
    if (field.required && !value) return `Fill in “${field.label}”.`
    if (value.length > max) return `“${field.label}” is too long.`
    if (!value) continue
    switch (field.type) {
      case 'contact_name':
        out.name = value
        break
      case 'company_name':
        out.companyName = value
        break
      case 'email':
        if (!EMAIL_RE.test(value) || value.length > 190) return `${value} isn’t a valid email address.`
        out.email = value.toLowerCase()
        break
      case 'mobile':
        if (!isMobile(value, country)) return `${value} isn’t a ${mobileHint(country)}.`
        out.mobile = normalizeMobile(value, country) ?? value
        break
      case 'industry':
        if (!lookupsFor(f.companyId).industries.some((i) => i.active && i.key === value)) return 'Pick an industry from the list.'
        out.industry = value
        break
      case 'source_detail':
        out.sourceDetail = value
        break
      case 'message':
        out.noteLines.push(`${field.label}: ${value}`)
        break
      case 'custom':
        out.noteLines.push(`${field.label}: ${value}`)
        break
    }
    out.answers.push({ label: field.label, value })
  }
  if (!out.email && !out.mobile) return 'Add an email or a mobile number so the team can follow up.'
  if (!out.name && !out.companyName) return 'Enter your name.'
  return out
}

/**
 * Owner of a new lead from a form: the form's owners in turn (round-robin by the number of leads the
 * form already created), keeping only people who can own leads. None → the company's first active
 * Sales Agent, then the form's creator, then a Company Admin.
 */
function formLeadOwner(f: Tenant<LeadFormRecord>): User {
  const co = f.companyId
  const pool = f.ownerIds.map((id) => companyUser(co, id)).filter((u): u is User => !!u && canOwnLeads(u))
  if (pool.length) return pool[submissionsOf(f).filter((s) => s.outcome === 'created').length % pool.length]
  const agent = users.filter((u) => u.companyId === co && u.active !== false && u.role === 'Sales Agent').sort((a, b) => a.id.localeCompare(b.id))[0]
  const fallback = agent ?? companyUser(co, f.createdBy) ?? users.find((u) => u.companyId === co && u.role === 'Company Admin')
  if (!fallback) throw new CodedApiError('This form can’t take responses right now.', 409, 'form_closed')
  return fallback
}

let seq = 0
const nextSeq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`

const CHANNELS: SubmissionChannel[] = ['hosted', 'embed', 'landing']

/**
 * POST /public/forms/:key/submit — no auth. Honeypot (`website` filled) → stored as spam, a fake
 * success, no lead. Rate limited per client (X-Client-Id) and per email. Paused form → 409 form_paused.
 * The lead rule (same as event registration):
 *  - an existing lead of the company with the same email (lead or contact) → linked, an activity on
 *    it, no duplicate; a Do Not Contact lead stays Do Not Contact (flagged on the submission);
 *  - otherwise a new lead: the form's source, campaign, source detail (answer or form name), owner
 *    round-robin among the form's owners, the message / custom answers as its first note;
 *  - the plan's leads + contacts limit → the submission is stored with outcome `limit`, no lead.
 * The answer never says which of these happened.
 */
export async function submitPublicForm(key: string, input: PublicFormSubmitInput | null, clientKey = 'anonymous'): Promise<PublicFormSubmitResult> {
  await delay(null)
  const body = (input ?? {}) as Partial<PublicFormSubmitInput>
  const f = publicFormOf(key)
  const co = f.companyId
  const done: PublicFormSubmitResult = { ok: true, message: f.successMessage, redirectUrl: f.redirectUrl }
  const client = `client:${f.id}:${clientKey || 'anonymous'}`
  const values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? (body.values as Record<string, unknown>) : {}
  const page = typeof body.landingPage === 'string' ? landingPages.find((p) => p.companyId === co && p.slug === body.landingPage && p.formId === f.id) : undefined
  const channel: SubmissionChannel = page ? 'landing' : CHANNELS.includes(body.channel as never) && body.channel !== 'landing' ? body.channel! : 'hosted'
  const now = nowIso()

  if (str(body.website)) {
    hitRateLimit(formSubmitHits, [client], { limit: FORM_SUBMIT_LIMIT, windowMs: FORM_SUBMIT_WINDOW_MINUTES * 60_000, what: 'submission' })
    const pick = (t: FormField['type']) => str(values[f.fields.find((x) => x.type === t)?.key ?? ''])
    formSubmissions.push({
      companyId: co, id: `FS-${nextSeq()}`, formId: f.id, landingPageId: page?.id ?? null, channel, submittedAt: now,
      name: pick('contact_name').slice(0, 255), email: pick('email').toLowerCase().slice(0, 190), mobile: pick('mobile').slice(0, 40), companyName: pick('company_name').slice(0, 255),
      answers: [], consent: body.consent === true, outcome: 'spam', leadId: null, doNotContact: false,
    })
    return done
  }

  const emailKey = (() => {
    const id = f.fields.find((x) => x.type === 'email')?.key
    const e = id ? str(values[id]).toLowerCase() : ''
    return EMAIL_RE.test(e) ? [`email:${f.id}:${e}`] : []
  })()
  hitRateLimit(formSubmitHits, [client, ...emailKey], { limit: FORM_SUBMIT_LIMIT, windowMs: FORM_SUBMIT_WINDOW_MINUTES * 60_000, what: 'submission' })
  if (f.status === 'paused') throw new CodedApiError('This form isn’t accepting responses right now.', 409, 'form_paused')
  const reason = closedReason(f)
  if (reason) throw new CodedApiError(reason, 409, 'form_closed')
  const s = cleanSubmission(f, values)
  if (typeof s === 'string') throw new CodedApiError(s, 422, 'invalid_submission')
  if (f.consentText && body.consent !== true) throw new CodedApiError('Tick the consent box to continue.', 422, 'consent_required')

  let leadId = leadByEmail(co, s.email)
  let outcome: SubmissionOutcome = leadId ? 'linked' : 'created'
  let dnc = false
  const via = page ? `landing page /p/${page.slug}` : channel === 'embed' ? 'embedded form' : 'hosted form page'
  if (leadId) {
    const lead = leads.find((l) => l.id === leadId && l.companyId === co)!
    dnc = lead.doNotContact
    const activity: Tenant<Activity> = {
      companyId: co,
      id: `A-LF-${nextSeq()}`,
      leadId: lead.id,
      type: 'system',
      summary: `${s.name || s.companyName} submitted the form “${f.name}” (${via}).${dnc ? ' The lead is Do Not Contact: no outreach.' : ''}`,
      userId: lead.ownerId,
      at: now,
    }
    activities.push(activity)
  } else {
    const owner = formLeadOwner(f)
    try {
      // The lead plus its one contact count toward leads + contacts.
      assertCapacity(co, 'leadsContacts', 2)
      const lead = insertLead(owner, {
        company: s.companyName || s.name,
        sourceType: f.source,
        sourceDetail: (s.sourceDetail || f.name).slice(0, 255),
        industry: s.industry,
        contacts: [{ name: s.name || s.companyName, title: '', mobile: s.mobile, email: s.email, isDecisionMaker: false }],
        ownerId: owner.id,
        nextFollowUpDate: null,
        campaignId: f.campaignId && campaigns.some((c) => c.companyId === co && c.id === f.campaignId) ? f.campaignId : null,
        note: [`Submitted the form “${f.name}” (${via}).`, ...s.noteLines].join('\n'),
      })
      leadId = lead.id
      noteUsage(co)
    } catch (err) {
      if (!(err instanceof LimitReachedError)) throw err
      outcome = 'limit'
      leadId = null
    }
  }
  formSubmissions.push({
    companyId: co,
    id: `FS-${nextSeq()}`,
    formId: f.id,
    landingPageId: page?.id ?? null,
    channel,
    submittedAt: now,
    name: s.name,
    email: s.email,
    mobile: s.mobile,
    companyName: s.companyName,
    answers: s.answers,
    consent: body.consent === true,
    outcome,
    leadId,
    doNotContact: dnc,
  })
  return done
}

/* ---------------- Landing pages ---------------- */

function pageView(p: Tenant<LandingPageRecord>): LandingPage {
  const form = p.formId ? leadForms.find((f) => f.companyId === p.companyId && f.id === p.formId) : undefined
  return {
    ...untenant(p),
    formName: form?.name ?? null,
    submissions: formSubmissions.filter((s) => s.companyId === p.companyId && s.landingPageId === p.id && s.outcome !== 'spam').length,
  }
}

async function pageFor(user: User, id: string): Promise<Tenant<LandingPageRecord>> {
  const p = findInTenant(landingPages, user, (x) => x.id === id)
  if (!p) return fail(PAGE_NOT_FOUND, 404)
  return p
}

function pageFields(co: string, input: LandingPageUpdateInput, existing?: LandingPageRecord): Partial<LandingPageRecord> | ApiError {
  const bad = (m: string) => new ApiError(m, 422)
  const out: Partial<LandingPageRecord> = {}
  if (input.slug !== undefined || !existing) {
    const slug = str(input.slug).toLowerCase()
    if (!SLUG_RE.test(slug) || slug.length > 80) return bad('Use a short slug of lower-case letters, digits and hyphens (e.g. spring-offer).')
    // Unique per company (the public address is the company's own workspace).
    if (landingPages.some((p) => p.companyId === co && p.id !== existing?.id && p.slug === slug)) {
      return new CodedApiError(`Another landing page already uses /p/${slug}.`, 409, 'slug_taken')
    }
    out.slug = slug
  }
  if (input.title !== undefined || !existing) {
    const title = str(input.title)
    if (!title) return bad('Give the page a title.')
    if (title.length > 120) return bad('Keep the title under 120 characters.')
    out.title = title
  }
  if (input.headline !== undefined) {
    const h = str(input.headline)
    if (h.length > 200) return bad('Keep the headline under 200 characters.')
    out.headline = h
  }
  if (input.body !== undefined) {
    const b = typeof input.body === 'string' ? input.body : ''
    if (b.length > 10_000) return bad('Keep the body under 10,000 characters.')
    out.body = b
  }
  if (input.heroImageUrl !== undefined) {
    const u = str(input.heroImageUrl)
    if (u && (!URL_RE.test(u) || u.length > 1000)) return bad('The hero image must be an image URL (https://…), e.g. from Brand Assets.')
    out.heroImageUrl = u || null
  }
  if (input.formId !== undefined) {
    if (input.formId && !leadForms.some((f) => f.companyId === co && f.id === input.formId)) return bad(FORM_NOT_FOUND)
    out.formId = input.formId || null
  }
  if (input.published !== undefined) out.published = input.published === true
  return out
}

export async function listLandingPages(user: User): Promise<LandingPage[]> {
  await requireMarketingView(user)
  return delay(scoped(landingPages, user).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(pageView))
}

export async function createLandingPage(user: User, input: LandingPageInput): Promise<LandingPage> {
  const co = await requireMarketingEdit(user)
  const fields = pageFields(co, input ?? ({} as LandingPageInput))
  if (fields instanceof ApiError) throw fields
  const at = nowIso()
  const row: Tenant<LandingPageRecord> = stamp(
    {
      id: nextGrowthId('LP'),
      slug: fields.slug!,
      title: fields.title!,
      headline: fields.headline ?? '',
      body: fields.body ?? '',
      heroImageUrl: fields.heroImageUrl ?? null,
      formId: fields.formId ?? null,
      published: fields.published ?? false,
      views: 0,
      createdAt: at,
      updatedAt: at,
    },
    user,
  )
  landingPages.push(row)
  return delay(pageView(row))
}

export async function updateLandingPage(user: User, id: string, input: LandingPageUpdateInput): Promise<LandingPage> {
  const co = await requireMarketingView(user)
  const p = await pageFor(user, id)
  await requireMarketingEdit(user)
  const fields = pageFields(co, input ?? {}, p)
  if (fields instanceof ApiError) throw fields
  Object.assign(p, fields, { updatedAt: nowIso() })
  return delay(pageView(p))
}

export async function deleteLandingPage(user: User, id: string): Promise<{ deleted: true }> {
  await requireMarketingView(user)
  const p = await pageFor(user, id)
  await requireMarketingEdit(user)
  landingPages.splice(landingPages.indexOf(p), 1)
  return delay({ deleted: true as const })
}

/** The company of a public request: the workspace it was opened on (Host header; X-Workspace in the mock), or a live old alias. */
function companyOfWorkspace(workspace: string | null): string | null {
  const host = (workspace ?? '').trim().toLowerCase()
  return host ? (resolveWorkspace(host)?.company.id ?? null) : null
}

/**
 * GET /public/pages/:slug — a published landing page of the workspace's company (slugs are unique per
 * company; the host names the company). Unknown workspace / slug, unpublished, no Marketing module,
 * deleted or suspended workspace → 404. Each load counts a page view and a view of its form.
 */
export async function getPublicLandingPage(workspace: string | null, slug: string): Promise<PublicLandingPage> {
  const co = companyOfWorkspace(workspace)
  const sub = co ? subscriptionOf(co) : undefined
  const p = co ? landingPages.find((x) => x.companyId === co && x.slug === slug.toLowerCase() && x.published) : undefined
  if (!co || !p || !marketingEnabledIn(co) || !sub || sub.status === 'deleted' || companyById(co)?.status === 'suspended') {
    throw new CodedApiError('This page isn’t available.', 404, 'page_not_found')
  }
  p.views++
  const form = p.formId ? leadForms.find((f) => f.companyId === co && f.id === p.formId) : undefined
  if (form) form.views++
  const c = companyById(co)
  return delay({
    title: p.title,
    headline: p.headline,
    body: p.body,
    heroImageUrl: p.heroImageUrl,
    organizerName: c?.branding.displayName ?? c?.name ?? '',
    form: form ? publicView(form) : null,
  })
}

/* ---------------- UTM links ---------------- */

function linkView(l: Tenant<UtmLinkRecord>): UtmLink {
  const campaign = l.campaignId ? campaigns.find((c) => c.companyId === l.companyId && c.id === l.campaignId) : undefined
  return { ...untenant(l), campaignName: campaign?.name ?? null, createdByName: userName(l.createdBy) }
}

export async function listUtmLinks(user: User): Promise<UtmLink[]> {
  await requireMarketingView(user)
  return delay(scoped(utmLinks, user).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(linkView))
}

const UTM_VALUE = /^[\w.~+-]{1,100}$/

export async function createUtmLink(user: User, input: UtmLinkInput): Promise<UtmLink> {
  const co = await requireMarketingEdit(user)
  const v = (input ?? {}) as Partial<UtmLinkInput>
  const baseUrl = str(v.baseUrl)
  if (!URL_RE.test(baseUrl) || baseUrl.length > 1000) return fail('Enter the page address, starting with https://.', 422)
  const campaignId = typeof v.campaignId === 'string' && v.campaignId ? v.campaignId : null
  const campaign = campaignId ? campaigns.find((c) => c.companyId === co && c.id === campaignId) : undefined
  if (campaignId && !campaign) return fail(CAMPAIGN_NOT_FOUND, 422)
  const p = {
    utmSource: str(v.utmSource),
    utmMedium: str(v.utmMedium),
    utmCampaign: str(v.utmCampaign),
    utmTerm: str(v.utmTerm),
    utmContent: str(v.utmContent),
  }
  if (!p.utmSource || !p.utmMedium) return fail('utm_source and utm_medium are required.', 422)
  for (const [k, value] of Object.entries(p)) {
    if (value && !UTM_VALUE.test(value)) return fail(`Use letters, digits, - _ . + or ~ in ${k.replace(/^utm/, 'utm_').toLowerCase()} (no spaces).`, 422)
  }
  const name = str(v.name).slice(0, 120) || `${p.utmSource} / ${p.utmMedium}${p.utmCampaign ? ` / ${p.utmCampaign}` : ''}`
  const row: Tenant<UtmLinkRecord> = stamp(
    { id: nextGrowthId('UTM'), name, baseUrl, ...p, campaignId: campaign?.id ?? null, url: buildUtmUrl(baseUrl, p), createdBy: user.id, createdAt: nowIso() },
    user,
  )
  utmLinks.push(row)
  return delay(linkView(row))
}

export async function deleteUtmLink(user: User, id: string): Promise<{ deleted: true }> {
  await requireMarketingView(user)
  const l = findInTenant(utmLinks, user, (x) => x.id === id)
  if (!l) return fail(LINK_NOT_FOUND, 404)
  await requireMarketingEdit(user)
  utmLinks.splice(utmLinks.indexOf(l), 1)
  return delay({ deleted: true as const })
}

/* ---------------- Shared with Website & SEO ---------------- */

/** Leads created through the company's forms: lead id → the form and landing page it came from. */
export function formLeadOrigins(co: string): Map<string, { formId: string; landingPageId: string | null }> {
  const out = new Map<string, { formId: string; landingPageId: string | null }>()
  for (const s of formSubmissions) {
    if (s.companyId === co && s.outcome === 'created' && s.leadId && !out.has(s.leadId)) out.set(s.leadId, { formId: s.formId, landingPageId: s.landingPageId })
  }
  return out
}
