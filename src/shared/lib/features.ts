/**
 * Module switches for features that aren't live yet. Shared by the app and the mock API so both
 * agree on what is counted.
 */

/**
 * The Events module (events attended). Until it's enabled there are no actuals for the
 * "Events attended" target: every target view shows it as "n/a" and leaves it out of completion
 * and pace, even when a target is set. Targets for it can still be set in Settings > Targets.
 */
export const EVENTS_ENABLED = false

/** Text shown wherever an events figure would be. */
export const EVENTS_NA_LABEL = 'n/a until Events is enabled'

/** Tooltip explaining the n/a (kept short: tooltips don't wrap). */
export const EVENTS_NA_HINT = 'No actuals yet: excluded from completion %'

/** Longer explanation for help text and notes. */
export const EVENTS_NA_NOTE =
  'Events attended is counted once the Events module is enabled. Until then it shows “n/a” and is left out of every completion % and pace, even when a target is set.'
