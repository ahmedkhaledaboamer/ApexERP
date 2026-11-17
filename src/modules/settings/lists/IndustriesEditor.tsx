import { useState } from 'react'
import { Layers } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { DraftIndustry, DraftOption } from './draft'
import { ListEditor } from './ListEditor'

interface IndustriesEditorProps {
  items: DraftIndustry[]
  onChange: (items: DraftIndustry[]) => void
  readOnly: boolean
  errors: Record<string, string>
}

/** Master-detail: industries on the left, the selected industry's sub-industries on the right. */
export function IndustriesEditor({ items, onChange, readOnly, errors }: IndustriesEditorProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(items[0]?._id)
  const selected = items.find((i) => i._id === selectedId) ?? items[0]

  const subErrorCount = (ind: DraftIndustry) => ind.subIndustries.filter((s) => errors[s._id]).length

  function setIndustries(next: DraftOption[]) {
    // Select an industry as soon as it's added, so its sub-industries can be filled in.
    if (next.length > items.length) setSelectedId(next[next.length - 1]._id)
    // ListEditor works on flat options; keep each industry's sub-industries.
    onChange(
      next.map((n) => {
        const prev = items.find((i) => i._id === n._id)
        return { ...n, subIndustries: prev?.subIndustries ?? [] }
      }),
    )
  }

  function setSubs(subIndustries: DraftOption[]) {
    if (!selected) return
    onChange(items.map((i) => (i._id === selected._id ? { ...i, subIndustries } : i)))
  }

  return (
    <div className="grid grid-cols-1 border-t border-line lg:grid-cols-2">
      <section aria-label="Industries" className="min-w-0 border-line lg:border-e">
        <h3 className="px-5 pt-3 pb-1 text-xs font-medium text-muted">Industries</h3>
        <ListEditor
          items={items}
          onChange={setIndustries}
          noun="industry"
          label="Industries"
          readOnly={readOnly}
          errors={errors}
          selectedId={selected?._id}
          onSelect={setSelectedId}
          meta={(item) => {
            const ind = items.find((i) => i._id === item._id)
            if (!ind) return null
            const active = ind.subIndustries.filter((s) => s.active).length
            const bad = subErrorCount(ind)
            return (
              <span
                className={cn('num hidden shrink-0 rounded px-1.5 text-[0.6875rem] sm:inline', bad ? 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500' : 'bg-sunken text-muted')}
                title={`${active} active of ${ind.subIndustries.length} sub-industries`}
              >
                {active}/{ind.subIndustries.length}
              </span>
            )
          }}
        />
      </section>
      <section aria-label={selected ? `Sub-industries of ${selected.label}` : 'Sub-industries'} className="min-w-0 border-t border-line lg:border-t-0">
        {selected ? (
          <>
            <h3 className="flex items-center gap-1.5 px-5 pt-3 pb-1 text-xs font-medium text-muted">
              <Layers className="size-3.5" aria-hidden />
              Sub-industries of <span className="truncate font-semibold text-ink">{selected.label.trim() || 'new industry'}</span>
            </h3>
            <ListEditor
              key={selected._id}
              items={selected.subIndustries}
              onChange={setSubs}
              noun="sub-industry"
              label={`Sub-industries of ${selected.label}`}
              readOnly={readOnly}
              errors={errors}
              emptyText="No sub-industries yet. Add at least one."
            />
          </>
        ) : (
          <p className="px-5 py-10 text-center text-[0.8125rem] text-muted">Pick an industry to see its sub-industries.</p>
        )}
      </section>
    </div>
  )
}
