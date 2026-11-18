import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { BrandScale } from '@/modules/tenancy/types'
import { SCALE_STEPS, normalizeHex, primaryContrast } from '@/modules/tenancy/palette'
import { TextInput } from '@/shared/components/form/Field'
import { cn } from '@/shared/lib/utils'

interface Props {
  value: string
  scale: BrandScale
  disabled: boolean
  onChange: (hex: string) => void
}

/**
 * Primary colour: native colour picker + hex input, a contrast hint for white text on it (buttons,
 * the active nav item) and the generated 50–900 scale.
 */
export function ColorField({ value, scale, disabled, onChange }: Props) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const typed = normalizeHex(text)
  const contrast = primaryContrast(value)
  const ratio = contrast.ratio.toFixed(1)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <label className="relative block size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-line-strong shadow-xs">
          <span className="sr-only">Pick the primary colour</span>
          <input
            id="branding-color-picker"
            type="color"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 p-0 disabled:cursor-not-allowed"
          />
        </label>
        <div className="w-36">
          <TextInput
            id="branding-color-hex"
            aria-label="Primary colour (hex)"
            value={text}
            disabled={disabled}
            invalid={!typed}
            maxLength={7}
            spellCheck={false}
            className="font-mono uppercase"
            onChange={(e) => {
              setText(e.target.value)
              const hex = normalizeHex(e.target.value)
              if (hex && /^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) onChange(hex)
            }}
            onBlur={() => {
              if (typed) onChange(typed)
              else setText(value)
            }}
          />
          {!typed && <p className="mt-1 text-xs text-danger-600 dark:text-danger-500">Use a hex value like #7C3AED.</p>}
        </div>
        <p
          id="branding-contrast"
          data-level={contrast.level}
          className={cn(
            'flex min-w-0 flex-1 items-start gap-1.5 pt-2 text-xs',
            contrast.level === 'good' ? 'text-success-700 dark:text-success-500' : contrast.level === 'large-only' ? 'text-warning-700 dark:text-warning-500' : 'text-danger-600 dark:text-danger-500',
          )}
        >
          {contrast.level === 'good' ? (
            <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : contrast.level === 'large-only' ? (
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          ) : (
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          <span>
            {contrast.level === 'good'
              ? `White text on it: ${ratio}:1, readable (WCAG AA).`
              : contrast.level === 'large-only'
                ? `White text on it: ${ratio}:1, fine for large text and icons but below AA for button labels. A darker shade reads better.`
                : `White text on it: ${ratio}:1, hard to read. Pick a darker colour.`}
          </span>
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-xs text-muted">Generated scale (buttons use 600, tints and hovers the others)</p>
        <ol id="branding-scale" className="grid grid-cols-10 overflow-hidden rounded-lg border border-line">
          {SCALE_STEPS.map((step) => (
            <li key={step} data-step={step} data-hex={scale[step]} title={`${step} ${scale[step]}`} className="h-9" style={{ backgroundColor: scale[step] }}>
              <span className={cn('block pt-1 text-center text-[0.5625rem] font-medium', Number(step) >= 500 ? 'text-white/85' : 'text-zinc-700')}>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
