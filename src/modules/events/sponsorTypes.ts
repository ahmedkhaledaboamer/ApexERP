/* ---------------- Sponsors & exhibitors (docs/API.md › Events › Sponsors & exhibitors) ---------------- */

export type SponsorStage = 'prospect' | 'contacted' | 'proposal_sent' | 'negotiating' | 'signed' | 'paid' | 'lost'

export const SPONSOR_STAGES: SponsorStage[] = ['prospect', 'contacted', 'proposal_sent', 'negotiating', 'signed', 'paid', 'lost']
/** Stages before the contract (free to move between). */
export const OPEN_SPONSOR_STAGES: SponsorStage[] = ['prospect', 'contacted', 'proposal_sent', 'negotiating']
/** Stages that hold one of the package's slots and count as sponsorship income. */
export const WON_SPONSOR_STAGES: SponsorStage[] = ['signed', 'paid']

export const SPONSOR_STAGE_LABEL: Record<SponsorStage, string> = {
  prospect: 'Prospect',
  contacted: 'Contacted',
  proposal_sent: 'Proposal sent',
  negotiating: 'Negotiating',
  signed: 'Signed',
  paid: 'Paid',
  lost: 'Lost',
}

export type DeliverableStatus = 'todo' | 'in_progress' | 'done'
export const DELIVERABLE_STATUSES: DeliverableStatus[] = ['todo', 'in_progress', 'done']
export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }

/** A deliverable of the package template: due `offsetDays` from the event's start (negative = before). */
export interface DeliverableTemplate {
  title: string
  offsetDays: number
}

export interface SponsorPackage {
  id: string
  eventId: string
  eventName: string
  name: string
  price: number
  currency: string
  quantity: number
  /** Deals holding a slot (signed or paid). */
  sold: number
  remaining: number
  benefits: string[]
  deliverables: DeliverableTemplate[]
  /** Deals of any stage on this package (a package with deals can't be deleted). */
  dealCount: number
}

export interface SponsorPackageInput {
  name: string
  price: number
  currency?: string
  quantity: number
  benefits?: string[]
  deliverables?: DeliverableTemplate[]
}

export interface SponsorDeliverable {
  id: string
  title: string
  offsetDays: number
  dueDate: string
  status: DeliverableStatus
  ownerId: string | null
  ownerName: string
  taskId: string | null
  overdue: boolean
}

export interface SponsorDeliverableInput {
  status?: DeliverableStatus
  dueDate?: string
  ownerId?: string | null
}

export interface SponsorDeal {
  id: string
  eventId: string
  eventName: string
  eventStartDate: string
  packageId: string
  packageName: string
  packagePrice: number
  /** packagePrice − amount (≥ 0). */
  discount: number
  organizationName: string
  leadId: string | null
  customerId: string | null
  /** The caller may open the linked lead / customer (their Sales scope reaches it). */
  canOpenOrganization: boolean
  contactName: string
  contactEmail: string
  amount: number
  currency: string
  stage: SponsorStage
  lostReason: string
  ownerId: string | null
  ownerName: string
  expectedPaymentDate: string | null
  actualPaymentDate: string | null
  notes: string
  signedAt: string | null
  deliverables: SponsorDeliverable[]
  /** The caller may change it (marketing full or the event's team). */
  canManage: boolean
  createdAt: string
  updatedAt: string
}

/** New lead for a sponsor organization (source Event, event_id; the normal duplicate rule). */
export interface SponsorNewLead {
  company: string
  contactName?: string
  email?: string
  mobile?: string
}

export interface SponsorDealInput {
  packageId: string
  leadId?: string | null
  customerId?: string | null
  newLead?: SponsorNewLead | null
  /** A manager confirms a new lead that looks like a duplicate. */
  force?: boolean
  contactName?: string
  contactEmail?: string
  amount?: number
  ownerId?: string | null
  stage?: SponsorStage
  expectedPaymentDate?: string | null
  notes?: string
}

export type SponsorDealUpdate = Partial<Pick<SponsorDealInput, 'packageId' | 'contactName' | 'contactEmail' | 'amount' | 'ownerId' | 'expectedPaymentDate' | 'notes'>> & { actualPaymentDate?: string | null }

export interface SponsorStageInput {
  stage: SponsorStage
  lostReason?: string
  actualPaymentDate?: string | null
}

export interface SponsorshipIncome {
  signed: number
  paid: number
  total: number
}

/** GET /events/:id/sponsorship — the event's "Sponsors" tab. */
export interface EventSponsorship {
  eventId: string
  isOrganizer: boolean
  currency: string
  packages: SponsorPackage[]
  deals: SponsorDeal[]
  income: SponsorshipIncome
  canManage: boolean
}

export interface SponsorEventOption {
  id: string
  name: string
  startDate: string
  canManage: boolean
}

/** GET /events/sponsors — the cross-event pipeline. */
export interface SponsorBoard {
  currency: string
  deals: SponsorDeal[]
  packages: SponsorPackage[]
  events: SponsorEventOption[]
}

export interface SponsorFilter {
  eventId?: string
  packageId?: string
  stage?: SponsorStage | ''
  ownerId?: string
}

export interface SponsorOrganization {
  kind: 'lead' | 'customer'
  id: string
  name: string
  contactName: string
  contactEmail: string
}
