import { format } from 'date-fns'
import type { User } from '@/shared/types'
import type { LeadRow } from '@/modules/leads/types'
import type { Quotation } from '@/modules/quotations/types'
import type { Company } from '@/modules/tenancy/types'
import { issuerAddress, issuerFor, type Issuer } from '@/modules/quotations/lib/company'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import type { TemplateContext } from './render'

const HONORIFICS = /^(mr|mrs|ms|miss|dr|eng|sheikh|sheikha|prof)\.?$/i

/** "Dr. Fatima Al Mansoori" → "Fatima". */
export function firstNameOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.find((p) => !HONORIFICS.test(p)) ?? parts[0] ?? ''
}

export interface ContextSources {
  lead?: Pick<LeadRow, 'company' | 'contactName' | 'status' | 'industry' | 'sourceType' | 'nextFollowUpDate' | 'nextStep'> | null
  agent?: Pick<User, 'name' | 'email' | 'title'> & { mobile?: string }
  quotation?: Pick<Quotation, 'number' | 'title' | 'validUntil' | 'totals'> | null
  /** Absolute link to the quotation, when there is one. */
  quotationLink?: string
  /** Lookup label resolvers (Settings > Fixed lists); keys are shown as-is when omitted. */
  labels?: {
    status?: (key: string) => string
    industry?: (key: string) => string
    source?: (key: string) => string
  }
  /**
   * The tenant as issuer (`issuerFor(useTenant())`, i.e. Settings > Company profile); the
   * company group stays empty without it. Email signatures use these values.
   */
  company?: CompanySource | null
  today?: Date
}

/** The issuer fields a `{{company.*}}` variable reads. */
export type CompanySource = Partial<Issuer> & Pick<Issuer, 'name'>

/**
 * THE `{{company.*}}` values, keyed by canonical field (`legal_name`, `tax_number`…). Every
 * renderer goes through here with `issuerFor(tenant)` (the client) or
 * `issuerFor(companyById(tenantOf(user)))` (the server), so a variable reads the same everywhere.
 * Empty values are left out, so they show as "not set" like any other missing variable.
 */
export function companyContext(company: CompanySource): Record<string, string> {
  const values: Record<string, string | undefined> = {
    name: company.name,
    legal_name: company.legalName,
    phone: company.phone,
    email: company.email,
    website: company.website,
    address: company.addressLines ? issuerAddress({ addressLines: company.addressLines }) : '',
    // A label without a number would print "TRN" alone.
    tax_label: company.taxNumber ? company.taxLabel : '',
    tax_number: company.taxNumber,
  }
  return Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => !!e[1]))
}

/** `{{company.*}}` values of a tenant (null before it has loaded: neutral placeholders). */
export function companyContextFor(tenant: Company | null): Record<string, string> {
  return companyContext(issuerFor(tenant))
}

/** Builds the `{{group.field}}` context from real records. Missing records leave their group empty. */
export function buildTemplateContext(src: ContextSources): TemplateContext {
  const { lead, agent, quotation, company, labels = {} } = src
  return {
    lead: lead
      ? {
          company: lead.company,
          contactName: lead.contactName,
          firstName: firstNameOf(lead.contactName),
          status: labels.status ? labels.status(lead.status) : lead.status,
          industry: labels.industry ? labels.industry(lead.industry) : lead.industry,
          source: labels.source ? labels.source(lead.sourceType) : lead.sourceType,
          nextFollowUpDate: lead.nextFollowUpDate ? fmtDate(lead.nextFollowUpDate) : '',
          nextStep: lead.nextStep,
        }
      : {},
    agent: agent
      ? { name: agent.name, firstName: firstNameOf(agent.name), email: agent.email, mobile: agent.mobile ?? '', title: agent.title }
      : {},
    // Empty values stay as "not set" chips, like any other missing variable.
    company: company ? companyContext(company) : {},
    quotation: quotation
      ? {
          number: quotation.number,
          title: quotation.title,
          total: fmtMoney(quotation.totals.total),
          validUntil: fmtDate(quotation.validUntil),
          link: src.quotationLink ?? '',
        }
      : {},
    date: { today: format(src.today ?? new Date(), 'd MMM yyyy') },
  }
}
