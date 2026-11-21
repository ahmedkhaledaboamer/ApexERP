/**
 * Registry of every piece of mutable mock-API state, so the in-memory "database" can be
 * snapshotted and restored as one structured-clone-able object (dev persistence in IndexedDB,
 * see ./browser.ts). Pure in-memory code: no IndexedDB, no DOM. Owning modules register their
 * stores right where they're declared; restore is always in place (same array / object / Map
 * instance), so every module holding a reference sees the restored contents.
 *
 * Bump VERSION whenever the *shape* of a stored record changes in a way old saved data would
 * break (store additions/removals are picked up automatically through the name hash).
 */
export const VERSION = 37 // 37: realistic demo books (a year of paid / open trading invoices INV-1101… / INV-5101…, payroll-bureau summaries before the HR payroll go-live, cost of sales and overheads in fin.journal, past VAT returns filed and paid by the seed with fin.taxMeta; INV-1012 no longer tagged with PRJ-104). 36: profitability & reports (perTenant fin.profitSettings, reports.hubPrefs per user; seeded invoices INV-1001/1002/1003/1005/1008/1009/1012/5005 and bills BILL-1003/5003 tagged with projects, BILL-1002/1005 with the event and a budget line). 35:35: finance tax & planning (fin.vatReturns with frozen snapshots, perTenant fin.taxSettings, fin.budgets seeded per company, perTenant fin.forecastSettings; journal source types vat_return / tax_provision; accounts 2210 / 6960 created on first use). 34: finance statements and year-end close (fin.yearEndCloses; journal source type year_end_close). 33: finance purchases & payables (fin.supplierProfiles with full IBAN served masked, fin.purchaseOrders, fin.bills, fin.debitNotes, fin.billPayments, fin.paymentRuns, perTenant fin.purchasesSettings; seeded per company). 32: finance expenses (fin.expenseCategories, perTenant fin.expensePolicy, fin.expenses, fin.expenseClaims, fin.pettyFunds, fin.pettyExpenses, fin.pettyMovements; payroll adjustment kind reimbursement, pay item type reimbursement). 31: finance banking, payroll posting and commissions (fin.bankAccounts with full account numbers / IBANs served masked, fin.bankTransfers, fin.bankLineFx, fin.bankStatements with lines, fin.bankMatches, fin.bankReconciliations, fin.bankRules, fin.payrollPostings, fin.bankingMeta, fin.commissionPlans, fin.commissionStatements, fin.commissionsMeta; hr.payAdjustments rows gain sourceRef and kind commission). 30: finance phase 2 contract (chart adds 1115 petty cash, 1410 employee advances, 2450 reimbursements payable, 6150 commissions, 6550/6560/6570; perTenant fin.approvalRules). 29: finance collections: fin.creditNoteUses (credit-note excess applied to invoices / refunded). 28: finance invoices (fin.creditNotes, fin.recurring, fin.zatcaChain; invoice rows gain customerVatNumber, paymentTermsDays, billingPct, milestone, sendLog, history, zatca, voidJournalEntryId; seeded invoices per company; notification type finance). 27: finance ledger core (perTenant:fin.settings with exchange rates and lock date; seeded opening balances and manual journal entries in fin.journal; created accounts ACC-N<n>). 26: finance collections (fin.payments, fin.pdcs, fin.paymentLinks, fin.customerCredit, fin.collectionsSettings, fin.dunningLog, fin.invoicePauses, fin.collectionsMeta; notification type finance). 25: finance core (fin.accounts, fin.taxCodes, fin.journal, fin.invoices, fin.seq). 24: HR performance reviews (hrPerfTemplates, hrPerfCycles, hrPerfReviews, hrPerfGoals, hrPerfSeq). 23: HR self-service and letters (hr.profileChanges with the proposed IBAN masked when served and wiped once closed, hr.letterTypes with templates per company, hr.letterRequests with the issued letter, hr.letterSeq; notification type hr-requests). 22: HR onboarding & offboarding (hr.journeyTemplates, hr.journeys with items + alert marks, hr.journeySeq; notification type hr-journey). 21: HR reports settings (hr.reportSettings: nationalisation target, training budget per year). 20: HR salary management (hr.paySettings, hr.payrollProfiles with masked person ids, hr.payAdjustments, hr.payLoans, hr.payrollRuns with lines, hr.finalSettlements; seed joiners EMP-X4 / EMP-X104 with contracts and attendance, an approved unpaid leave per company; notification type hr-payroll). 19: 19: HR attendance and leave (shifts, attendance entries, corrections, leave types, leave requests with approvals, public holidays, leave settings; notification type hr). 18: HR recruitment (openings, candidates, applications, interviews, offers) and training (courses, sessions, enrollments, certificates). 17: HR employees / contracts / assets (hrProfiles, hrDocuments, hrContracts, hrAssets, hrActivity; EMP-X staff without a login in hrEmployees; notification type hr-people); 16: sponsors & exhibitors, travel & logistics (sponsor packages / deals / deliverables, trips with masked visa numbers, shipments, deadlines, logistics budget lines, budget category logistics, seed events EV-1101 / EV-5101); 15: cross-event sections (seed events EV-1005/1006/5003/5004 + their attendees and captures, event_capture_follow_up_notices, event-follow-up notifications); 14: event libraries (speaker directory Ã¢â‚¬â€ event_speakers become roster links, sessions reference directory ids Ã¢â‚¬â€, venues + events.venueId, vendors + budget lines vendorId); 13: events advanced (templates, agenda, tickets / waitlist / questions, check-in codes, captures, survey, budget lines; new event + attendee fields, automation event defaults); 12: "Paid ads" lead source in both seeds (ad lead forms import); 11: marketing creative (content items, design requests + attachments, brand assets, alert types marketing*); 10: marketing ads (ad connections, ad campaigns, daily stats, cost links, sync runs, lead-form submissions, tokens); 9: marketing growth (lead forms, submissions, landing pages, UTM links, audiences, SEO pages, keywords);5: database alignment part B (task enums, blocked flag, sub-tasks, time entries, attachments sizeBytes/mimeType, lead status history); 6: part A (lead status type/flags, follow-up dates, customer/quotation/contract enums, quotation viewedAt); 7: marketing (campaigns, campaign costs, bulk emails, recipients, leads.campaignId); 8: events (events, event team, attendees, history, leads.eventId, Crest Event source)

export interface StoreAdapter {
  /** A structured-clone-able value (it is cloned on save and on restore). */
  save(): unknown
  /** Replace the store's contents with `value` (already a private copy). */
  load(value: unknown): void
}

export interface MockSnapshot {
  version: string
  savedAt: number
  stores: Record<string, unknown>
}

const stores = new Map<string, StoreAdapter>()

export function register(name: string, adapter: StoreAdapter): void {
  // A re-executed module (HMR) re-registers its stores: the newest instance wins.
  if (stores.has(name) && import.meta.env.MODE === 'test') throw new Error(`Mock store "${name}" is registered twice.`)
  stores.set(name, adapter)
}

/** An array restored in place (same array object, contents replaced). */
export function registerArray<T>(name: string, arr: T[]): T[] {
  register(name, {
    save: () => arr,
    load: (v) => {
      arr.splice(0, arr.length, ...(v as T[]))
    },
  })
  return arr
}

/** A plain object map (Record), restored in place: keys removed, then assigned. */
export function registerObject<T extends object>(name: string, obj: T): T {
  register(name, {
    save: () => obj,
    load: (v) => {
      for (const k of Object.keys(obj)) delete (obj as Record<string, unknown>)[k]
      Object.assign(obj, v as object)
    },
  })
  return obj
}

export function registerMap<K, V>(name: string, map: Map<K, V>): Map<K, V> {
  register(name, {
    save: () => [...map.entries()],
    load: (v) => {
      map.clear()
      for (const [k, val] of v as [K, V][]) map.set(k, val)
    },
  })
  return map
}

export function registerSet<T>(name: string, set: Set<T>): Set<T> {
  register(name, {
    save: () => [...set],
    load: (v) => {
      set.clear()
      for (const x of v as T[]) set.add(x)
    },
  })
  return set
}

/** A module-level scalar (`let seq = Ã¢â‚¬Â¦`) exposed through accessors. */
export function registerValue<T>(name: string, get: () => T, set: (value: T) => void): void {
  register(name, { save: get, load: (v) => set(v as T) })
}

export function registeredStoreNames(): string[] {
  return [...stores.keys()].sort()
}

/** FNV-1a over the sorted store names, plus the manual VERSION. */
export function schemaVersion(): string {
  let h = 2166136261
  for (const ch of registeredStoreNames().join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return `v${VERSION}-${h.toString(36)}`
}

/**
 * The whole mock DB. Values reference live state: the caller must clone it before mutating
 * anything (IndexedDB `put` clones synchronously; `takeSnapshot(true)` clones here).
 */
export function takeSnapshot(clone = false): MockSnapshot {
  const out: Record<string, unknown> = {}
  for (const [name, s] of stores) out[name] = s.save()
  return { version: schemaVersion(), savedAt: Date.now(), stores: clone ? structuredClone(out) : out }
}

/**
 * Restores a snapshot. Returns false (and touches nothing) when it was made for another schema:
 * different VERSION or a different set of stores. Missing stores keep their seed.
 */
export function restoreSnapshot(snap: MockSnapshot | null | undefined): boolean {
  if (!snap || snap.version !== schemaVersion() || !snap.stores) return false
  const data = structuredClone(snap.stores)
  for (const [name, s] of stores) {
    if (name in data) s.load(data[name])
  }
  return true
}
