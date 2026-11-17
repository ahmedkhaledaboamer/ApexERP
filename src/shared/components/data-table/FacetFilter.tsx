import type { ReactNode } from 'react'
import { Check, PlusCircle, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Menu } from '@/shared/components/ui/Menu'

export interface FacetOption {
  value: string
  label: string
  icon?: ReactNode
  count?: number
}

interface FacetFilterProps {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (values: string[]) => void
}

/** Linear-style filter chip: dashed "+ Status" until something is picked, then shows the picks. */
export function FacetFilter({ title, options, selected, onChange }: FacetFilterProps) {
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])
  const picked = options.filter((o) => selected.includes(o.value))

  return (
    <Menu
      align="start"
      className="w-60"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[0.8125rem] font-medium transition-colors [&_svg]:size-3.5',
            picked.length
              ? 'border-line-strong bg-surface text-ink shadow-xs hover:bg-hover'
              : 'border-dashed border-line-strong text-muted hover:bg-hover hover:text-ink',
          )}
        >
          <PlusCircle className={cn(picked.length && 'hidden')} aria-hidden />
          {title}
          {picked.length > 0 && (
            <>
              <span className="h-4 w-px bg-line-strong" aria-hidden />
              <span className="max-w-40 truncate font-normal text-ink-2">
                {picked.length > 2 ? `${picked.length} selected` : picked.map((p) => p.label).join(', ')}
              </span>
            </>
          )}
        </button>
      )}
    >
      <div className="max-h-72 overflow-y-auto">
        {options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              onClick={() => toggle(o.value)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[0.8125rem] hover:bg-hover"
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded border',
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong',
                )}
              >
                {on && <Check className="size-3" aria-hidden />}
              </span>
              {o.icon}
              <span className="flex-1 truncate">{o.label}</span>
              {o.count !== undefined && <span className="num text-xs text-subtle">{o.count}</span>}
            </button>
          )
        })}
      </div>
      {selected.length > 0 && (
        <>
          <div className="-mx-1 my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[0.8125rem] text-muted hover:bg-hover hover:text-ink"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        </>
      )}
    </Menu>
  )
}
