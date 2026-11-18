import { z } from 'zod'
import { isMobile, mobileError } from '@/shared/lib/phone'
import { getRegion } from '@/shared/lib/region'
import type { LookupsApi } from '@/shared/hooks/useLookups'
import type { Lead } from '@/shared/types'

/**
 * Status, source, industry and sub-industry are lookup keys (Settings > Fixed lists). The schemas
 * are built from the live lookups: new values must be ACTIVE items; a record's existing value
 * (`original`) stays valid even if it has since been deactivated. The server re-checks the same.
 */
type Original = Partial<Pick<Lead, 'sourceType' | 'industry' | 'subIndustry' | 'status' | 'serviceIds' | 'recommendedServiceId'>>

const isActive = (list: { key: string }[], key: string) => list.some((i) => i.key === key)

function sourceField(lookups: LookupsApi, original?: Original) {
  return z
    .string()
    .min(1, 'Pick a source.')
    .refine((v) => v === original?.sourceType || isActive(lookups.sources, v), 'Pick a source from the list.')
}

function industryField(lookups: LookupsApi, original?: Original) {
  return z
    .string()
    .min(1, 'Pick an industry.')
    .refine((v) => v === original?.industry || isActive(lookups.industries, v), 'Pick an industry from the list.')
}

export const quickAddSchema = (lookups: LookupsApi) =>
  z.object({
  company: z.string().trim().min(1, 'Company is required.').max(120, 'Keep it under 120 characters.'),
  contactName: z.string().trim().max(80, 'Keep it under 80 characters.'),
  mobile: z
    .string()
    .trim()
    .refine((v) => v === '' || isMobile(v, getRegion().country), () => ({ message: mobileError(getRegion().country) })),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address.'),
  sourceType: sourceField(lookups),
  industry: industryField(lookups),
})

export type QuickAddValues = z.infer<ReturnType<typeof quickAddSchema>>

/* ------------------------------------------------------------------------------------------
 * Full lead form (create and edit)
 * ---------------------------------------------------------------------------------------- */

export function isEmail(v: string): boolean {
  return z.string().email().safeParse(v.trim()).success
}

/** Accepts "acme.com", "www.acme.ae", "https://acme.sa/path". */
const WEBSITE_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i

const optionalMobile = z
  .string()
  .trim()
  .refine((v) => v === '' || isMobile(v, getRegion().country), () => ({ message: mobileError(getRegion().country) }))
const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || isEmail(v), 'Enter a valid email address.')

export const contactRowSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required.').max(80, 'Keep it under 80 characters.'),
  title: z.string().trim().max(80, 'Keep it under 80 characters.'),
  mobile: optionalMobile,
  email: optionalEmail,
  isDecisionMaker: z.boolean(),
})

/**
 * `activeServiceIds`: ids of ACTIVE catalog services. Services are picked from the catalog, never
 * typed; a lead's existing (since deactivated) ids stay valid. Omit while the catalog is loading.
 */
export const leadFormSchema = (lookups: LookupsApi, original?: Original, activeServiceIds?: Set<string>) =>
  z
  .object({
    company: z.string().trim().min(1, 'Company is required.').max(120, 'Keep it under 120 characters.'),
    website: z
      .string()
      .trim()
      .refine((v) => v === '' || WEBSITE_RE.test(v), 'Enter a domain like company.com.'),
    /** Lookup key; kept separate from the free-text source detail. */
    sourceType: sourceField(lookups, original),
    sourceDetail: z.string().trim().max(200, 'Keep it under 200 characters.'),
    industry: industryField(lookups, original),
    subIndustry: z.string(),
    contacts: z.array(contactRowSchema).min(1, 'Add at least one contact.'),
    status: z.string().min(1, 'Pick a status.'),
    /** Status when the form opened; a change to Lost needs a reason. */
    initialStatus: z.string(),
    lossReason: z.string().trim(),
    /** '' = auto-assign. */
    ownerId: z.string(),
    value: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+(\.\d+)?$/.test(v.replace(/,/g, '')) && Number(v.replace(/,/g, '')) >= 0), 'Enter an amount.'),
    nextFollowUpDate: z.string(),
    nextStep: z.string().trim().max(200, 'Keep it under 200 characters.'),
    companyServices: z.array(z.string().trim().min(1)).max(20, 'Keep it to 20 tags.'),
    /** Catalog service ids of interest. */
    serviceIds: z.array(z.string().min(1)).max(30, 'Keep it to 30 services.'),
    /** Catalog service id; '' = none. */
    recommendedServiceId: z.string(),
    doNotContact: z.boolean(),
    note: z.string().trim().max(2000, 'Keep it under 2,000 characters.'),
  })
  .superRefine((v, ctx) => {
    if (activeServiceIds) {
      const kept = new Set(original?.serviceIds ?? [])
      if (v.serviceIds.some((id) => !kept.has(id) && !activeServiceIds.has(id))) {
        ctx.addIssue({ code: 'custom', path: ['serviceIds'], message: 'Pick active services from the catalog.' })
      }
      if (v.recommendedServiceId && v.recommendedServiceId !== original?.recommendedServiceId && !activeServiceIds.has(v.recommendedServiceId)) {
        ctx.addIssue({ code: 'custom', path: ['recommendedServiceId'], message: 'Pick an active service from the catalog.' })
      }
    }
    const subUnchanged = v.industry === original?.industry && v.subIndustry === original?.subIndustry
    if (v.subIndustry && !subUnchanged && !isActive(lookups.subIndustriesOf(v.industry), v.subIndustry)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subIndustry'],
        message: `Pick a sub-industry of ${v.industry ? lookups.industryLabel(v.industry) : 'the industry'}.`,
      })
    }
    if (v.status !== v.initialStatus && !isActive(lookups.statuses, v.status)) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Pick a status from the list.' })
    }
    const target = lookups.status(v.status)
    if (!lookups.isClosed(v.status) && !v.nextFollowUpDate) {
      ctx.addIssue({ code: 'custom', path: ['nextFollowUpDate'], message: 'Set the next follow-up date.' })
    }
    if (target.requiresNextStep && !v.nextStep) {
      ctx.addIssue({ code: 'custom', path: ['nextStep'], message: `Record the next step for ${target.label}.` })
    }
    if (target.requiresLossReason && v.status !== v.initialStatus) {
      if (!v.lossReason) ctx.addIssue({ code: 'custom', path: ['lossReason'], message: 'A reason is required to close this lead.' })
      else if (!isActive(lookups.lossReasons, v.lossReason)) {
        ctx.addIssue({ code: 'custom', path: ['lossReason'], message: 'Pick a reason from the list.' })
      }
    }
  })

export type LeadFormValues = z.infer<ReturnType<typeof leadFormSchema>>
