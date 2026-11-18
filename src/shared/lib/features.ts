/**
 * Plan-dependent feature switches shared by the app and the mock API so both agree on what is counted.
 */

/**
 * The Events module (plan module `events`). "Events attended" is tracked only when the company's plan
 * includes it: otherwise every target view shows it as "n/a" and leaves it out of completion and
 * pace, even when a target is set (targets for it can still be set in Settings > Targets). Task links
 * to events are usable only then too. Pass the company's plan modules (entitlements).
 */
export function eventsEnabledFor(modules: readonly string[] | null | undefined): boolean {
  return !!modules && modules.includes('events')
}

/** Text shown wherever an events figure would be. */
export const EVENTS_NA_LABEL = 'n/a without the Events module'

/** Tooltip explaining the n/a (kept short: tooltips don't wrap). */
export const EVENTS_NA_HINT = 'Events isn’t in your plan: excluded from completion %'

/** Longer explanation for help text and notes. */
export const EVENTS_NA_NOTE =
  'Events attended is counted from the Events module, which your plan doesn’t include. It shows “n/a” and is left out of every completion % and pace, even when a target is set.'
