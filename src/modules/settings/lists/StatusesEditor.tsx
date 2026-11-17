import { useId } from 'react'
import { Check, ChevronDown, Lock } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Badge, DOT, type Tone } from '@/shared/components/ui/Badge'
import { Menu } from '@/shared/components/ui/Menu'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { SelectInput, Switch } from '@/shared/components/form/Field'
import type { StatusKind, StatusRequirement } from '@/modules/settings/types'
import { KIND_HINT, KIND_LABEL, kindDefaults, newStatus, REQUIRES_LABEL, TONE_HEX, TONES, type DraftStatus } from './draft'
import { AddItem, InlineLabel } from './ListEditor'
import { SortableList } from './SortableList'

const GRID = 'grid grid-cols-[1.5rem_minmax(12rem,1.6fr)_8rem_11rem_9.5rem_3.5rem_3rem] items-center gap-3'

interface StatusesEditorProps {
  items: DraftStatus[]
  onChange: (items: DraftStatus[]) => void
  readOnly: boolean
  errors: Record<string, string>
}

/** Lead statuses: label, kind, what's required to enter, forecast probability, colour, active. */
export function StatusesEditor({ items, onChange, readOnly, errors }: StatusesEditorProps) {
  const errId = useId()
  const patch = (id: string, p: Partial<DraftStatus>) => onChange(items.map((s) => (s._id === id ? { ...s, ...p } : s)))

  return (
    <div className="pb-3">
      <div className="overflow-x-auto">
        <div className="min-w-[56rem]">
          <div className={cn(GRID, 'border-y border-line bg-sunken/50 px-3 py-2 text-xs font-medium text-muted')} aria-hidden>
            <span />
            <span className="ps-2">Status</span>
            <span>Kind</span>
            <span>Requires</span>
            <span>Probability</span>
            <span>Colour</span>
            <span className="text-end">Active</span>
          </div>
          <SortableList
            label="Lead statuses"
            items={items}
            onReorder={onChange}
            disabled={readOnly}
            nameOf={(s) => s.label}
            className="divide-y divide-line"
            renderItem={(s, handle) => {
              const error = errors[s._id]
              return (
                <div className="px-3 py-1.5">
                  <div className={GRID}>
                    {handle}
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden className={cn('ms-1 size-2 shrink-0 rounded-full', DOT[s.tone], !s.active && 'opacity-40')} />
                      <div className="min-w-0 flex-1">
                        <InlineLabel
                          value={s.label}
                          label="Status name"
                          readOnly={readOnly}
                          muted={!s.active}
                          error={error}
                          errorId={`${errId}-${s._id}`}
                          onChange={(v) => patch(s._id, { label: v })}
                        />
                      </div>
                      {s.system && (
                        <Tooltip label="Built in: rename or deactivate, but its kind is fixed">
                          <Badge variant="outline" icon={<Lock aria-hidden />} className="cursor-default">
                            Built-in
                          </Badge>
                        </Tooltip>
                      )}
                      {!s.key && <Badge tone="brand">New</Badge>}
                      {!s.active && <Badge variant="outline">Inactive</Badge>}
                    </div>

                    {readOnly ? (
                      <span className="text-[0.8125rem] text-ink-2">{KIND_LABEL[s.kind]}</span>
                    ) : (
                      <SelectInput
                        aria-label={`Kind of ${s.label}`}
                        title={s.system ? 'Built-in statuses keep their kind' : KIND_HINT[s.kind]}
                        value={s.kind}
                        disabled={s.system}
                        className="h-8"
                        onChange={(e) => {
                          const kind = e.target.value as StatusKind
                          patch(s._id, { kind, ...kindDefaults(kind, s) })
                        }}
                      >
                        {(Object.keys(KIND_LABEL) as StatusKind[]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABEL[k]}
                          </option>
                        ))}
                      </SelectInput>
                    )}

                    {readOnly ? (
                      <span className="text-[0.8125rem] text-ink-2">{REQUIRES_LABEL[s.requires]}</span>
                    ) : (
                      <SelectInput
                        aria-label={`What ${s.label} requires`}
                        value={s.requires}
                        className="h-8"
                        onChange={(e) => patch(s._id, { requires: e.target.value as StatusRequirement })}
                      >
                        {(Object.keys(REQUIRES_LABEL) as StatusRequirement[]).map((r) => (
                          <option key={r} value={r}>
                            {REQUIRES_LABEL[r]}
                          </option>
                        ))}
                      </SelectInput>
                    )}

                    <Probability status={s} readOnly={readOnly} onChange={(probability) => patch(s._id, { probability })} />

                    <TonePicker tone={s.tone} disabled={readOnly} label={s.label} onChange={(tone) => patch(s._id, { tone, color: TONE_HEX[tone] })} />

                    <span className="flex justify-end">
                      <Switch checked={s.active} disabled={readOnly} label={`${s.label || 'Status'} active`} onChange={(v) => patch(s._id, { active: v })} />
                    </span>
                  </div>
                  {error && (
                    <p id={`${errId}-${s._id}`} className="ms-11 mt-0.5 mb-1 text-xs text-danger-600 dark:text-danger-500">
                      {error}
                    </p>
                  )}
                </div>
              )
            }}
          />
        </div>
      </div>
      {!readOnly && <AddItem noun="status" existing={items.map((s) => s.label)} onAdd={(label) => onChange([...items, newStatus(label)])} />}
    </div>
  )
}

function Probability({ status, readOnly, onChange }: { status: DraftStatus; readOnly: boolean; onChange: (n: number) => void }) {
  const pct = Number.isFinite(status.probability) ? Math.max(0, Math.min(100, status.probability)) : 0
  return (
    <div className="flex items-center gap-2">
      {readOnly ? (
        <span className="num w-10 text-[0.8125rem] font-medium">{status.probability}%</span>
      ) : (
        <span className="relative">
          <input
            type="text"
            inputMode="numeric"
            aria-label={`Win probability for ${status.label}, percent`}
            value={Number.isFinite(status.probability) ? String(status.probability) : ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 3)
              onChange(raw === '' ? Number.NaN : Number(raw))
            }}
            className="num h-8 w-14 rounded-md border border-line-strong bg-surface ps-2 pe-5 text-end text-[0.8125rem] shadow-xs outline-none hover:border-subtle focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)]"
          />
          <span aria-hidden className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-xs text-subtle">
            %
          </span>
        </span>
      )}
      <span aria-hidden className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-sunken">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: status.color }} />
      </span>
    </div>
  )
}

const TONE_NAME: Record<Tone, string> = {
  neutral: 'Grey',
  brand: 'Violet',
  blue: 'Blue',
  sky: 'Sky',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  pink: 'Pink',
  teal: 'Teal',
}

function TonePicker({ tone, onChange, disabled, label }: { tone: Tone; onChange: (t: Tone) => void; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden className={cn('size-3 rounded-full', DOT[tone])} />
        <span className="sr-only">{TONE_NAME[tone]}</span>
      </span>
    )
  }
  return (
    <Menu
      align="end"
      className="min-w-0 p-2"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`Colour of ${label}: ${TONE_NAME[tone]}`}
          className="flex h-8 items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 shadow-xs hover:border-subtle focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none"
        >
          <span aria-hidden className={cn('size-3.5 rounded-full', DOT[tone])} />
          <ChevronDown className="size-3 text-subtle" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-3 gap-1">
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={t === tone}
              title={TONE_NAME[t]}
              onClick={() => {
                onChange(t)
                close()
              }}
              className={cn('flex rounded-md p-1 hover:bg-hover', t === tone && 'bg-hover')}
            >
              <Badge tone={t} icon={t === tone ? <Check aria-hidden /> : undefined} className="pointer-events-none w-full justify-center">
                {TONE_NAME[t]}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}
