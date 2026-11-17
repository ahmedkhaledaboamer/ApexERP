import { format } from 'date-fns'
import type { User } from '@/shared/types'
import type { LeadRow } from '@/modules/leads/types'
import type { Quotation } from '@/modules/quotations/types'
import { COMPANY } from '@/modules/quotations/lib/company'
import { fmtDate, fmtMoney } from '@/shared/lib/utils'
import type { TemplateContext } from './render'

/** Placeholder until Settings > Company profile stores it. */
export const COMPANY_PHONE = '+971 4 000 0000'

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
  today?: Date
}

/** Builds the `{{group.field}}` context from real records. Missing records leave their group empty. */
export function buildTemplateContext(src: ContextSources): TemplateContext {
  const { lead, agent, quotation, labels = {} } = src
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
    company: { name: COMPANY.name, website: COMPANY.website, phone: COMPANY_PHONE },
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
