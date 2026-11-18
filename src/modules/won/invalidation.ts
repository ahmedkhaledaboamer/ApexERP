/**
 * Query-key roots a successful Won invalidates (useWinLead). Kept dependency-free so a unit test can
 * check it against every module's key root: leads (+ alerts, nested under ['leads']), CRM (customers,
 * contacts, contracts), quotations, projects, tasks, alerts/notifications, dashboard, reports, audit
 * (the project / customer / lead history) and the lists the flow reads (services, departments, targets).
 */
export const WON_INVALIDATES: readonly (readonly string[])[] = [
  ['leads'],
  ['crm'],
  ['quotations'],
  ['projects'],
  ['tasks'],
  ['alerts'],
  ['notifications'],
  ['dashboard'],
  ['reports'],
  ['audit'],
  ['services'],
  ['departments'],
  ['targets'],
]
