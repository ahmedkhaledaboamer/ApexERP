import { forwardRef, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Bold, Braces, Italic, Strikethrough } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { isKnownVariable, VARIABLE_GROUPS } from '../variables'

/* ------------------------------------------------------------------------------------------
 * Variable picker
 * ---------------------------------------------------------------------------------------- */

/** Menu of every variable, grouped; picking one inserts `{{key}}` where the cursor was. */
export function VariablePicker({ onPick, disabled, label = 'Variable' }: { onPick: (key: string) => void; disabled?: boolean; label?: string }) {
  return (
    <Menu
      align="start"
      className="max-h-80 w-72 overflow-y-auto"
      trigger={(props) => (
        <Button {...props} variant="ghost" size="xs" disabled={disabled} className="text-ink-2">
          <Braces aria-hidden />
          {label}
        </Button>
      )}
    >
      {(close) =>
        VARIABLE_GROUPS.map((g, gi) => (
          <div key={g.id}>
            {gi > 0 && <MenuSeparator />}
            <MenuLabel>{g.label}</MenuLabel>
            {g.variables.map((v) => (
              <MenuItem
                key={v.key}
                onSelect={() => {
                  close()
                  onPick(v.key)
                }}
                hint={<span className="font-mono text-[0.6875rem]">{v.key}</span>}
              >
                {v.label}
              </MenuItem>
            ))}
          </div>
        ))
      }
    </Menu>
  )
}

/* ------------------------------------------------------------------------------------------
 * Body editor
 * ---------------------------------------------------------------------------------------- */

interface BodyEditorProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Current text (watched from the form), drawn under the textarea to highlight variables. */
  text: string
  invalid?: boolean
  /** Toolbar content on the left (variable picker, formatting). */
  toolbar?: ReactNode
  /** Toolbar content on the right (character count). */
  meta?: ReactNode
}

const TOKEN = /(\{\{[^{}]*\}\})/g

/**
 * Plain textarea with `{{…}}` tokens highlighted: a backdrop with identical metrics renders the
 * text invisibly with tinted marks, and the transparent textarea sits on top. The textarea grows
 * with its content so the two never scroll apart.
 */
export const BodyEditor = forwardRef<HTMLTextAreaElement, BodyEditorProps>(function BodyEditor(
  { text, invalid, toolbar, meta, className, readOnly, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const metrics = 'px-3 py-2.5 font-sans text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words [tab-size:4]'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-surface shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-brand-500 focus-within:shadow-[var(--shadow-focus)]',
        invalid ? 'border-danger-500' : 'border-line-strong hover:border-subtle',
        readOnly && 'bg-sunken hover:border-line-strong',
        className,
      )}
    >
      {(toolbar || meta) && (
        <div className="flex min-h-9 flex-wrap items-center gap-1 border-b border-line px-1.5 py-1">
          <div className="flex flex-1 flex-wrap items-center gap-0.5">{toolbar}</div>
          {meta && <div className="px-1.5 text-xs text-muted tabular-nums">{meta}</div>}
        </div>
      )}
      <div className="relative">
        <div aria-hidden className={cn(metrics, 'pointer-events-none absolute inset-0 overflow-hidden text-transparent')}>
          {text.split(TOKEN).map((part, i) =>
            i % 2 === 1 ? (
              <mark
                key={i}
                className={cn(
                  'rounded-sm text-transparent',
                  isKnownVariable(part.slice(2, -2).trim())
                    ? 'bg-brand-500/15'
                    : 'bg-danger-500/15 underline decoration-danger-500 decoration-wavy',
                )}
              >
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
          {/* A trailing newline needs a character after it to take up a line. */}
          {'​'}
        </div>
        <textarea
          ref={(el) => {
            inner.current = el
            if (typeof ref === 'function') ref(el)
            else if (ref) ref.current = el
          }}
          readOnly={readOnly}
          aria-invalid={invalid || undefined}
          spellCheck
          className={cn(
            metrics,
            'relative block min-h-56 w-full resize-none overflow-hidden bg-transparent text-ink caret-ink placeholder:text-subtle focus:outline-none',
          )}
          {...rest}
        />
      </div>
    </div>
  )
})

/* ------------------------------------------------------------------------------------------
 * WhatsApp formatting buttons
 * ---------------------------------------------------------------------------------------- */

export type WrapMarker = '*' | '_' | '~'

export function WhatsAppFormatButtons({ onWrap, disabled }: { onWrap: (marker: WrapMarker) => void; disabled?: boolean }) {
  const buttons: { marker: WrapMarker; label: string; icon: ReactNode }[] = [
    { marker: '*', label: 'Bold (*text*)', icon: <Bold aria-hidden /> },
    { marker: '_', label: 'Italic (_text_)', icon: <Italic aria-hidden /> },
    { marker: '~', label: 'Strikethrough (~text~)', icon: <Strikethrough aria-hidden /> },
  ]
  return (
    <>
      <span aria-hidden className="mx-1 h-4 w-[0.0625rem] bg-line" />
      {buttons.map((b) => (
        <Tooltip key={b.marker} label={b.label} side="bottom">
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label={b.label}
            disabled={disabled}
            // Keep the textarea's selection: don't take focus on mousedown.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onWrap(b.marker)}
          >
            {b.icon}
          </Button>
        </Tooltip>
      ))}
    </>
  )
}
