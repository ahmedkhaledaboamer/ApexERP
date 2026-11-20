/* ---------------- Travel & logistics (docs/API.md › Events › Travel & logistics) ---------------- */

export type TripStatus = 'planned' | 'booked' | 'completed' | 'cancelled'
export const TRIP_STATUSES: TripStatus[] = ['planned', 'booked', 'completed', 'cancelled']
export const TRIP_STATUS_LABEL: Record<TripStatus, string> = { planned: 'Planned', booked: 'Booked', completed: 'Completed', cancelled: 'Cancelled' }

export type VisaStatus = 'not_needed' | 'applied' | 'approved' | 'rejected'
export const VISA_STATUSES: VisaStatus[] = ['not_needed', 'applied', 'approved', 'rejected']
export const VISA_STATUS_LABEL: Record<VisaStatus, string> = { not_needed: 'Not needed', applied: 'Applied', approved: 'Approved', rejected: 'Rejected' }

export type ShipmentStatus = 'preparing' | 'in_transit' | 'delivered' | 'returned' | 'cancelled'
export const SHIPMENT_STATUSES: ShipmentStatus[] = ['preparing', 'in_transit', 'delivered', 'returned', 'cancelled']
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  preparing: 'Preparing',
  in_transit: 'In transit',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

export interface Trip {
  id: string
  eventId: string
  eventName: string
  eventStartDate: string
  userId: string
  userName: string
  flightFrom: string
  flightTo: string
  departDate: string | null
  returnDate: string | null
  airline: string
  bookingRef: string
  flightCost: number
  hotelName: string
  checkIn: string | null
  checkOut: string | null
  hotelCost: number
  visaRequired: boolean
  visaStatus: VisaStatus
  visaExpiry: string | null
  /** Only the last 4 characters are kept ("•••• 4821"); the full number is never stored or returned. */
  visaNumberMasked: string | null
  perDiem: number
  otherCosts: number
  total: number
  status: TripStatus
  notes: string
  /** The budget line this trip posts its cost to (category travel). */
  budgetLineId: string | null
  canManage: boolean
}

export interface TripInput {
  userId: string
  flightFrom?: string
  flightTo?: string
  departDate?: string | null
  returnDate?: string | null
  airline?: string
  bookingRef?: string
  flightCost?: number
  hotelName?: string
  checkIn?: string | null
  checkOut?: string | null
  hotelCost?: number
  visaRequired?: boolean
  visaStatus?: VisaStatus
  visaExpiry?: string | null
  /** Write-only: the server keeps the last 4 characters. '' clears it; omitted keeps it. */
  visaNumber?: string
  perDiem?: number
  otherCosts?: number
  status?: TripStatus
  notes?: string
}

export interface Shipment {
  id: string
  eventId: string
  eventName: string
  vendorId: string | null
  vendorName: string
  trackingNumber: string
  items: string
  shipDate: string | null
  arrivalDate: string | null
  status: ShipmentStatus
  cost: number
  notes: string
  budgetLineId: string | null
  canManage: boolean
}

export interface ShipmentInput {
  vendorId?: string | null
  vendorName?: string
  trackingNumber?: string
  items: string
  shipDate?: string | null
  arrivalDate?: string | null
  status?: ShipmentStatus
  cost?: number
  notes?: string
}

export interface LogisticsDeadline {
  id: string
  eventId: string
  eventName: string
  title: string
  dueDate: string
  ownerId: string | null
  ownerName: string
  done: boolean
  doneAt: string | null
  notes: string
  overdue: boolean
  /** Days from today (company calendar) to the due date; negative = overdue. */
  daysLeft: number
  canManage: boolean
}

export interface DeadlineInput {
  title: string
  dueDate: string
  ownerId?: string | null
  done?: boolean
  notes?: string
}

export interface LogisticsEventOption {
  id: string
  name: string
  startDate: string
  isOrganizer: boolean
  canManage: boolean
}

/** GET /events/logistics and GET /events/:id/logistics. */
export interface LogisticsBundle {
  currency: string
  trips: Trip[]
  shipments: Shipment[]
  deadlines: LogisticsDeadline[]
  events: LogisticsEventOption[]
  /** The caller sees every trip of the listed events (marketing view / full or team); else only their own trips. */
  seesAll: boolean
  /** The company's vendor library (not blacklisted), for the shipment picker; free text works too. */
  vendors: { id: string; name: string }[]
}
