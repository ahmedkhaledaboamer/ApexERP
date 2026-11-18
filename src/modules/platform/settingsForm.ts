import type { PlatformSettings } from '@/modules/platform/types'

export type SettingsKey = keyof PlatformSettings
type NumberKey = 'trialDays' | 'graceDays' | 'suspendedDaysBeforeCancel' | 'retentionDays' | 'subdomainRedirectDays' | 'impersonationMinutes'
type ListKey = 'trialReminderDays' | 'pastDueReminderDays' | 'usageWarningThresholds'

export interface SettingSpec {
  key: SettingsKey
  label: string
  hint: string
  kind: 'number' | 'list'
  min: number
  max: number
  unit: string
}

/** Ranges follow docs/API.md (invalid_settings); the server re-validates. */
export const SETTING_SPECS: SettingSpec[] = [
  { key: 'trialDays', label: 'Trial length', hint: 'New sign-ups on the Trial plan.', kind: 'number', min: 1, max: 90, unit: 'days' },
  { key: 'trialReminderDays', label: 'Trial reminders', hint: 'Days before the trial ends, comma-separated (e.g. 7, 3, 1).', kind: 'list', min: 1, max: 90, unit: 'days' },
  { key: 'graceDays', label: 'Grace period', hint: 'Past due: access continues this long after a failed renewal.', kind: 'number', min: 0, max: 60, unit: 'days' },
  { key: 'pastDueReminderDays', label: 'Payment reminders', hint: 'Days after a failed renewal, comma-separated.', kind: 'list', min: 1, max: 60, unit: 'days' },
  { key: 'suspendedDaysBeforeCancel', label: 'Suspended → cancelled', hint: 'Unpaid suspended workspaces are cancelled after this.', kind: 'number', min: 0, max: 365, unit: 'days' },
  { key: 'retentionDays', label: 'Data retention', hint: 'Cancelled data is kept this long (export available), then deleted.', kind: 'number', min: 0, max: 365, unit: 'days' },
  { key: 'usageWarningThresholds', label: 'Usage warnings', hint: 'Percent of a limit that triggers a warning, comma-separated.', kind: 'list', min: 1, max: 100, unit: '%' },
  { key: 'subdomainRedirectDays', label: 'Old subdomain redirect', hint: 'How long an old address keeps redirecting after a change.', kind: 'number', min: 0, max: 365, unit: 'days' },
  { key: 'impersonationMinutes', label: 'Support session length', hint: 'Impersonation sessions end automatically after this.', kind: 'number', min: 5, max: 240, unit: 'minutes' },
]

export type SettingsDraft = Record<SettingsKey, string>

export function settingsDraft(s: PlatformSettings): SettingsDraft {
  return Object.fromEntries(
    SETTING_SPECS.map((spec) => {
      const v = s[spec.key]
      return [spec.key, Array.isArray(v) ? v.join(', ') : String(v ?? '')]
    }),
  ) as SettingsDraft
}

function parseList(s: string): number[] | null {
  const parts = s
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const nums = parts.map(Number)
  return nums.every((n) => Number.isInteger(n)) ? nums : null
}

/** Validates the draft; returns errors per key and the parsed value when everything is valid. */
export function parseSettings(d: SettingsDraft): { errors: Partial<Record<SettingsKey, string>>; value: PlatformSettings | null } {
  const errors: Partial<Record<SettingsKey, string>> = {}
  const out: Record<string, number | number[]> = {}
  for (const spec of SETTING_SPECS) {
    const raw = d[spec.key]?.trim() ?? ''
    if (spec.kind === 'number') {
      const n = Number(raw)
      if (raw === '' || !Number.isInteger(n) || n < spec.min || n > spec.max) errors[spec.key] = `Whole number from ${spec.min} to ${spec.max}.`
      else out[spec.key as NumberKey] = n
    } else {
      const list = parseList(raw)
      if (!list) errors[spec.key] = 'Whole numbers separated by commas.'
      else if (list.length > 10) errors[spec.key] = 'At most 10 values.'
      else if (list.some((n) => n < spec.min || n > spec.max)) errors[spec.key] = `Each value from ${spec.min} to ${spec.max}.`
      else if (new Set(list).size !== list.length) errors[spec.key] = 'No duplicates.'
      else out[spec.key as ListKey] = list
    }
  }
  return { errors, value: Object.keys(errors).length ? null : (out as unknown as PlatformSettings) }
}

/** Lists compare as sets (the server stores them sorted). */
const norm = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].sort((a, b) => a - b) : v)

/** Keys whose value differs (for the PATCH body and the "unsaved" hint). */
export function changedSettings(before: PlatformSettings, after: PlatformSettings): Partial<PlatformSettings> {
  const diff: Record<string, unknown> = {}
  for (const spec of SETTING_SPECS) {
    if (norm(before[spec.key]) !== norm(after[spec.key])) diff[spec.key] = after[spec.key]
  }
  return diff as Partial<PlatformSettings>
}
