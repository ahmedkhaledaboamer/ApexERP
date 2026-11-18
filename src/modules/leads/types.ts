import type { Activity, Contact, Lead, LeadStatus, LeadTask, Note, SourceType } from '@/shared/types'

/** API shapes for the leads module — the backend returns exactly these. */

export interface LeadRow extends Lead {
  ownerName: string
  /** Lost / Not interested for at least `lostReopenDays` (Settings > Automation): may be reopened. */
  reopenEligible: boolean
}

export interface LeadDetail extends LeadRow {
  contacts: Contact[]
  /** Company website, used for the domain duplicate check. Empty when unknown. */
  website?: string
}

export interface MoveLeadInput {
  id: string
  status: LeadStatus
  lossReason?: string
  nextStep?: string
  nextFollowUpDate?: string
}

export interface ActivityView extends Activity {
  userName: string
  /**
   * Set on the POST /activities response when logging the activity moved the lead automatically
   * (e.g. No response → Cold after `attemptsBeforeCold` unanswered attempts).
   */
  autoStatus?: { from: LeadStatus; to: LeadStatus; label: string; attempts: number }
}

export interface NoteView extends Note {
  authorName: string
}

export interface TaskView extends LeadTask {
  ownerName: string
}

export interface DuplicateMatch {
  leadId: string
  company: string
  ownerName: string
  status: LeadStatus
  /** company: same normalized name · domain: same website/email domain (free mail ignored) · email: same address. */
  reason: 'company' | 'email' | 'domain'
}

/** GET /leads/duplicates query. Matches across every lead, not only the caller's scope. */
export interface DuplicateQuery {
  company: string
  email?: string
  /** Extra emails (e.g. every contact row); comma-separated on the wire. */
  emails?: string[]
  website?: string
  /** Lead being edited, so it doesn't match itself. */
  excludeId?: string
}

export interface QuickAddInput {
  company: string
  contactName: string
  mobile: string
  email: string
  sourceType: SourceType
  industry: string
  /** Managers only: create even though duplicates exist (otherwise the server answers 409). */
  force?: boolean
}

/** One contact row in the full lead form. `id` is kept when editing an existing contact. */
export interface ContactInput {
  id?: string
  name: string
  title: string
  mobile: string
  email: string
  isDecisionMaker: boolean
}

/** POST /leads with the full form. Status is always New; owner is auto-assigned when omitted. */
export interface LeadCreateInput {
  company: string
  website?: string
  sourceType: SourceType
  sourceDetail?: string
  industry: string
  subIndustry?: string
  /** At least one; the first is the primary contact shown on the lead. */
  contacts: ContactInput[]
  /** Team/full scope only; null or omitted = auto-assign. */
  ownerId?: string | null
  value?: number
  nextFollowUpDate: string | null
  nextStep?: string
  companyServices?: string[]
  /** Catalog service ids of interest; new ids must be ACTIVE services. */
  serviceIds?: string[]
  /** ACTIVE catalog service id; null = none. Setting it clears any legacy `recommendedServiceText`. */
  recommendedServiceId?: string | null
  /** leads.campaign_id: a campaign of the company (marketing attribution); null = none. */
  campaignId?: string | null
  doNotContact?: boolean
  /** Optional first note, saved to the lead's notes. */
  note?: string
  /** Managers only: create even though duplicates exist. */
  force?: boolean
}

/** Editable lead fields for PATCH /leads/:id. Stage changes go through /stage instead. */
export type LeadUpdateInput = Partial<
  Pick<
    Lead,
    | 'company'
    | 'contactName'
    | 'contactEmail'
    | 'mobile'
    | 'industry'
    | 'subIndustry'
    | 'sourceType'
    | 'sourceDetail'
    | 'ownerId'
    | 'value'
    | 'nextFollowUpDate'
    | 'nextStep'
    | 'companyServices'
    | 'serviceIds'
    | 'recommendedServiceId'
    | 'campaignId'
  >
> & {
  /** Replaces the lead's contacts; the first becomes the primary contact. */
  contacts?: ContactInput[]
  website?: string
  doNotContact?: boolean
  /** Managers only: save even though the new name/domain/email matches another lead. */
  force?: boolean
}

/** Someone a lead can be assigned to, with their current open-lead load. */
export interface LeadOwnerOption {
  id: string
  name: string
  title: string
  role: string
  openLeads: number
}

/* ------------------------------------------------------------------------------------------
 * Excel import
 * ---------------------------------------------------------------------------------------- */

/** One cleaned spreadsheet row, already mapped to the allowed lists by the wizard. */
export interface ImportLeadRow {
  /** Spreadsheet row number (header = 1), used in reports. */
  row: number
  company: string
  website: string
  contactName: string
  contactTitle: string
  mobile: string
  email: string
  isDecisionMaker: boolean
  sourceType: SourceType | ''
  sourceDetail: string
  industry: string
  subIndustry: string
  status: LeadStatus | ''
  /** Owner resolved from the file; '' when blank or unmatched. */
  ownerId: string
  /** yyyy-mm-dd or ''. */
  nextFollowUpDate: string
  nextStep: string
  value: number | null
  companyServices: string[]
  /** Catalog match for the file's "Recommended service" column ('' = none / unmatched). */
  recommendedServiceId: string
  /** The file's value when it couldn't be matched to the catalog (kept as legacy text). */
  recommendedServiceText: string
  notes: string
  doNotContact: boolean
}

export interface ImportCheckRow {
  row: number
  /** Blocking problems: the row can't be imported until fixed. */
  errors: string[]
  /** Imported, but something is cleared or defaulted. */
  warnings: string[]
  /** Existing leads this row matches. */
  matches: DuplicateMatch[]
  /** Earlier row in the same file with the same company, domain or email. */
  fileDuplicateOf: number | null
}

export type ImportDecision = 'import' | 'skip'

/** file: use the owner column (unmatched → auto) · auto: assign every row automatically. */
export type ImportOwnerRule = 'file' | 'auto'

export interface ImportRequest {
  rows: ImportLeadRow[]
  /** Per row number; rows with duplicates default to skip. */
  decisions: Record<number, ImportDecision>
  ownerRule: ImportOwnerRule
  /** leads.campaign_id for every imported lead (optional; a campaign of the company). */
  campaignId?: string | null
}

export interface ImportFailure {
  row: number
  company: string
  reason: string
}

export interface ImportResult {
  created: number
  skipped: number
  failed: ImportFailure[]
  /** Rows skipped on purpose (duplicates), with why. */
  skippedRows: ImportFailure[]
  createdIds: string[]
  /**
   * Valid rows NOT imported because the plan's leads + contacts limit was reached (the import creates
   * rows up to the limit and reports the rest here; they are not in `failed` or `skippedRows`).
   */
  skippedForLimit: number
  /** Set when `skippedForLimit > 0`: the limit that stopped the import (same shape as the 402 body). */
  limitReached: import('@/modules/billing/types').LimitReachedDetails | null
}
