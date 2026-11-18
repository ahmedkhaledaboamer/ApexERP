import type { LeadStatus, User } from '@/shared/types'
import type {
  ContactInput,
  ImportCheckRow,
  ImportFailure,
  ImportLeadRow,
  ImportRequest,
  ImportResult,
  LeadCreateInput,
} from '@/modules/leads/types'
import { isClosedStatus, isLostStatus, isWonFlowStatus, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import {
  isActiveIndustry,
  isActiveSource,
  isActiveStatus,
  isActiveSubIndustry,
  isImportOnlyLossReason,
} from '@/shared/mocks/lookupChecks'
import { IMPORTED_LOSS_REASON } from '@/modules/leads/lossReason'
import { can, scopeOf } from '@/shared/lib/permissions'
import { MOBILE_RULES, normalizeMobile } from '@/shared/lib/phone'
import type { CountryCode } from '@/modules/tenancy/types'
import { leads } from '@/shared/mocks/db'
import { scoped, tenantOf } from '@/shared/mocks/tenant'
import { limitDetails, noteUsage, remainingCapacity } from '@/shared/mocks/services/billing'
import { services as catalog } from '@/shared/mocks/data/services'
import { matchServiceText } from '@/modules/services/match'
import { delay, fail } from '@/shared/mocks/server'
import {
  autoOwnerFor,
  canOverrideDuplicates,
  countryOf,
  domainOf,
  findDuplicates,
  insertLead,
  normalizeCompany,
  ownerProblem,
} from '@/shared/mocks/services/leads'

/**
 * Excel import (spec: "Excel import with column mapping, value cleanup and duplicate
 * detection"). The wizard maps and cleans values in the browser; the server re-validates every
 * row, checks duplicates within the file and against existing leads, and creates in one call.
 */

const MAX_ROWS = 5000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface RowCheck {
  errors: string[]
  warnings: string[]
  contact: ContactInput | null
  subIndustry: string
  followUp: string | null
  /** ACTIVE catalog id, or null with the file's text kept as unmatched. */
  serviceId: string | null
  serviceText: string | null
}

/**
 * Recommended service: an ACTIVE catalog id from the wizard, else the server matches the text
 * itself (same `matchServiceText`); what still doesn't match is kept as `recommendedServiceText`.
 */
function resolveService(
  companyId: string,
  r: ImportLeadRow,
  warnings: string[],
): { serviceId: string | null; serviceText: string | null } {
  const id = r.recommendedServiceId?.trim() ?? ''
  const text = (r.recommendedServiceText ?? '').trim().slice(0, 120)
  // Only the company's own catalog: another company's service id reads as unknown.
  const own = catalog.filter((x) => x.companyId === companyId)
  if (id) {
    const s = own.find((x) => x.id === id)
    if (s?.active) return { serviceId: id, serviceText: null }
    warnings.push(`Service “${id}” isn’t an active catalog service; kept as unmatched.`)
    return { serviceId: null, serviceText: s?.name ?? (text || id) }
  }
  if (!text) return { serviceId: null, serviceText: null }
  const hit = matchServiceText(text, own)
  if (hit?.active) return { serviceId: hit.id, serviceText: null }
  warnings.push(`Service “${text}” has no catalog match; kept as unmatched.`)
  return { serviceId: null, serviceText: text }
}

/** Field-level rules for one row (no duplicate lookups), against the company's lists and country. */
function checkFields(companyId: string, country: CountryCode, r: ImportLeadRow): RowCheck {
  const errors: string[] = []
  const warnings: string[] = []

  if (!r.company.trim()) errors.push('Company is missing.')
  if (!r.sourceType) errors.push('Source is missing.')
  else if (!isActiveSource(companyId, r.sourceType)) errors.push(`Source “${r.sourceType}” isn’t in the list.`)
  if (!r.industry) errors.push('Industry is missing.')
  else if (!isActiveIndustry(companyId, r.industry)) errors.push(`Industry “${r.industry}” isn’t in the list.`)
  if (r.status && !isActiveStatus(companyId, r.status)) errors.push(`Status “${r.status}” isn’t in the list.`)
  // Won is never imported: only the Won flow creates the customer, contract and projects together.
  else if (r.status && isWonFlowStatus(companyId, r.status)) errors.push(`Status “${r.status}” can’t be imported. Import the lead with an open status, then use the Won flow to win it.`)

  let subIndustry = r.subIndustry.trim()
  if (subIndustry && isActiveIndustry(companyId, r.industry) && !isActiveSubIndustry(companyId, r.industry, subIndustry)) {
    warnings.push(`Sub-industry “${subIndustry}” isn’t under ${r.industry}; left blank.`)
    subIndustry = ''
  }

  let mobile = r.mobile.trim()
  if (mobile) {
    const n = normalizeMobile(mobile, country)
    if (n) mobile = n
    else {
      warnings.push(`Mobile “${mobile}” isn’t a ${MOBILE_RULES[country].countryName} mobile; left blank.`)
      mobile = ''
    }
  }
  let email = r.email.trim().toLowerCase()
  if (email && !EMAIL_RE.test(email)) {
    warnings.push(`Email “${email}” isn’t valid; left blank.`)
    email = ''
  }
  const contact =
    r.contactName.trim() || mobile || email
      ? {
          name: r.contactName.trim() || email.split('@')[0] || 'Main contact',
          title: r.contactTitle.trim(),
          mobile,
          email,
          isDecisionMaker: r.isDecisionMaker,
        }
      : null
  if (!contact) warnings.push('No contact details.')

  const status: LeadStatus = r.status || SYSTEM_STATUS.new
  let followUp: string | null = null
  if (!isClosedStatus(companyId, status)) {
    if (r.nextFollowUpDate && DATE_RE.test(r.nextFollowUpDate)) {
      followUp = new Date(`${r.nextFollowUpDate}T09:00:00`).toISOString()
    } else {
      if (r.nextFollowUpDate) warnings.push(`Follow-up date “${r.nextFollowUpDate}” not understood.`)
      warnings.push('No follow-up date; set to tomorrow.')
    }
  }
  if (r.value !== null && (Number.isNaN(r.value) || r.value < 0)) warnings.push('Value isn’t a positive amount; set to 0.')

  const { serviceId, serviceText } = resolveService(companyId, r, warnings)

  return { errors, warnings, contact, subIndustry, followUp, serviceId, serviceText }
}

function identity(r: ImportLeadRow) {
  return {
    name: normalizeCompany(r.company),
    email: r.email.trim().toLowerCase(),
    domain: domainOf(r.website) || domainOf(r.email),
  }
}

function requireImporter(user: User): Promise<never> | null {
  if (!can(user.role, 'sales', 'create')) return fail('Your role can’t import leads.', 403)
  return null
}

/** POST /leads/import/check — per-row validation plus duplicate matches (file and existing). */
export async function checkImport(user: User, rows: ImportLeadRow[]): Promise<ImportCheckRow[]> {
  const denied = requireImporter(user)
  if (denied) return denied
  if (!Array.isArray(rows) || rows.length === 0) return fail('The file has no rows to check.', 422)
  if (rows.length > MAX_ROWS) return fail(`Import up to ${MAX_ROWS.toLocaleString()} rows at a time.`, 413)

  const co = tenantOf(user)
  const country = countryOf(user)
  const seenName = new Map<string, number>()
  const seenEmail = new Map<string, number>()
  const seenDomain = new Map<string, number>()

  const result = rows.map((r): ImportCheckRow => {
    const { errors, warnings } = checkFields(co, country, r)
    const id = identity(r)
    const fileDuplicateOf =
      (id.name.length > 2 ? seenName.get(id.name) : undefined) ??
      (id.email ? seenEmail.get(id.email) : undefined) ??
      (id.domain ? seenDomain.get(id.domain) : undefined) ??
      null
    if (id.name.length > 2 && !seenName.has(id.name)) seenName.set(id.name, r.row)
    if (id.email && !seenEmail.has(id.email)) seenEmail.set(id.email, r.row)
    if (id.domain && !seenDomain.has(id.domain)) seenDomain.set(id.domain, r.row)

    const matches = r.company.trim() ? findDuplicates(co, { company: r.company, emails: [r.email], website: r.website }) : []
    return { row: r.row, errors, warnings, matches, fileDuplicateOf }
  })
  return delay(result)
}

/**
 * POST /leads/import — creates the rows in order. Duplicates (against existing leads, which by
 * then include earlier rows of this file) are skipped unless the decision is "import", which only
 * managers may choose. Rows with errors fail with their reason. Plan limit (leads + contacts): valid rows
 * are created while they fit; the rest are not created and are reported as `skippedForLimit` with
 * `limitReached` (the 402 LIMIT_REACHED body), never as an error for the whole import.
 */
export async function runImport(user: User, req: ImportRequest): Promise<ImportResult> {
  const denied = requireImporter(user)
  if (denied) return denied
  const rows = req.rows ?? []
  if (rows.length === 0) return fail('Nothing to import.', 422)
  if (rows.length > MAX_ROWS) return fail(`Import up to ${MAX_ROWS.toLocaleString()} rows at a time.`, 413)

  const co = tenantOf(user)
  const country = countryOf(user)
  const override = canOverrideDuplicates(user)
  const ownScope = scopeOf(user.role, 'sales') === 'own'
  const failed: ImportFailure[] = []
  const skippedRows: ImportFailure[] = []
  const createdIds: string[] = []
  let room = remainingCapacity(co, 'leadsContacts')
  let skippedForLimit = 0

  for (const r of rows) {
    const company = r.company.trim() || '(no company)'
    const check = checkFields(co, country, r)
    if (check.errors.length > 0) {
      failed.push({ row: r.row, company, reason: check.errors.join(' ') })
      continue
    }
    const matches = findDuplicates(co, { company: r.company, emails: [r.email], website: r.website })
    const decision = req.decisions?.[r.row] ?? (matches.length > 0 ? 'skip' : 'import')
    if (decision === 'skip') {
      skippedRows.push({
        row: r.row,
        company,
        reason: matches.length > 0 ? `Duplicate of ${matches[0].company} (${matches[0].leadId}).` : 'Skipped.',
      })
      continue
    }
    if (matches.length > 0 && !override) {
      failed.push({ row: r.row, company, reason: `Duplicate of ${matches[0].company}; only a manager can import it anyway.` })
      continue
    }

    let ownerId: string | null = null
    if (ownScope) ownerId = user.id
    else if (req.ownerRule === 'file' && r.ownerId && !ownerProblem(user, r.ownerId)) ownerId = r.ownerId
    else ownerId = autoOwnerFor(user)

    const status: LeadStatus = r.status || SYSTEM_STATUS.new
    const input: LeadCreateInput = {
      company: r.company,
      website: r.website,
      sourceType: r.sourceType,
      sourceDetail: r.sourceDetail,
      industry: r.industry,
      subIndustry: check.subIndustry,
      contacts: check.contact ? [check.contact] : [],
      ownerId,
      value: r.value !== null && r.value >= 0 ? r.value : 0,
      nextFollowUpDate: check.followUp,
      nextStep: r.nextStep,
      companyServices: r.companyServices,
      recommendedServiceId: check.serviceId,
      doNotContact: r.doNotContact,
      note: r.notes,
    }
    // Each lead counts 1, plus its contact.
    const need = 1 + (check.contact ? 1 : 0)
    if (need > room) {
      skippedForLimit++
      continue
    }
    try {
      const lead = insertLead(user, input, { status })
      room -= need
      if (!check.serviceId && check.serviceText) lead.recommendedServiceText = check.serviceText

      // The file carries no loss reason: record the protected system item (import path only).
      if (isLostStatus(co, status) && isImportOnlyLossReason(co, IMPORTED_LOSS_REASON)) lead.lossReason = IMPORTED_LOSS_REASON
      createdIds.push(lead.id)
    } catch (e) {
      failed.push({ row: r.row, company, reason: e instanceof Error ? e.message : 'Couldn’t save this row.' })
    }
  }

  if (createdIds.length > 0) noteUsage(co)
  return delay({
    created: createdIds.length,
    skipped: skippedRows.length,
    failed,
    skippedRows,
    createdIds,
    skippedForLimit,
    limitReached: skippedForLimit > 0 ? limitDetails(co, 'leadsContacts') : null,
  })
}

/** Lead count of the caller's company, for the "N existing leads checked" hint. */
export function existingLeadCount(user: User): number {
  return scoped(leads, user).length
}
