import { SelectInput, TextInput } from '@/shared/components/form/Field'
import { PERIOD_LABEL, PERIOD_PRESETS, presetPeriod, type PeriodPreset, type Range } from '@/modules/reports/performance/calc'

export type PeriodChoice = PeriodPreset | 'custom'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The period of a preset (or a valid custom range) as of the company's today. */
export function resolvePeriod(choice: PeriodChoice, today: string, custom: { from: string | null; to: string | null }): Range {
  if (choice === 'custom' && custom.from && custom.to && DAY.test(custom.from) && DAY.test(custom.to) && custom.from <= custom.to) return { from: custom.from, to: custom.to }
  return presetPeriod(choice === 'custom' ? 'ytd' : choice, today)
}

export const isPeriodChoice = (v: string | null): v is PeriodChoice => v === 'custom' || (PERIOD_PRESETS as string[]).includes(v ?? '')

/** Period preset + custom dates (company-local yyyy-MM-dd). */
export function PeriodFilter({
  choice,
  range,
  onChoice,
  onCustom,
}: {
  choice: PeriodChoice
  range: Range
  onChoice: (c: PeriodChoice) => void
  onCustom: (r: Range) => void
}) {
  return (
    <>
      <label className="text-[0.8125rem]">
        <span className="mb-1 block text-xs text-muted">Period</span>
        <SelectInput aria-label="Period" value={choice} onChange={(e) => onChoice(e.target.value as PeriodChoice)} className="w-44">
          {PERIOD_PRESETS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL[p]}
            </option>
          ))}
          <option value="custom">Custom</option>
        </SelectInput>
      </label>
      {choice === 'custom' && (
        <>
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">From</span>
            <TextInput type="date" aria-label="From" value={range.from} onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: range.to })} />
          </label>
          <label className="text-[0.8125rem]">
            <span className="mb-1 block text-xs text-muted">To</span>
            <TextInput type="date" aria-label="To" value={range.to} onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })} />
          </label>
        </>
      )}
    </>
  )
}
