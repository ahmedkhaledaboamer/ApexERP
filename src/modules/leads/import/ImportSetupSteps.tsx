import { useMemo, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FlaskConical, RefreshCw, Sparkles, UploadCloud, Wand2 } from 'lucide-react'
import type { LeadOwnerOption } from '@/modules/leads/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { formatMobile, mobileExample, mobileSample } from '@/shared/lib/phone'
import { getRegion } from '@/shared/lib/region'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { SelectInput, TextInput } from '@/shared/components/form/Field'
import {
  columnLetter,
  distinctValues,
  MAX_FILE_ROWS,
  readSpreadsheet,
  TARGET_FIELDS,
  type CleanRow,
  type Fixes,
  type ListedKey,
  type Mapping,
  type SheetFile,
  type TargetKey,
  type ValueMaps,
} from './importModel'
import { downloadTemplate } from './importFiles'
import { sampleSheet, Segmented, Tile } from './ImportUi'

/* ------------------------------------------------------------------------------------------
 * 1 · Upload
 * ---------------------------------------------------------------------------------------- */

export function UploadStep({ sheet, onLoaded }: { sheet: SheetFile | null; onLoaded: (s: SheetFile) => void }) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templating, setTemplating] = useState(false)
  const lookups = useLookups()

  async function load(file: File | undefined) {
    if (!file) return
    setError(null)
    setReading(true)
    try {
      onLoaded(await readSpreadsheet(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that file.')
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    void load(e.dataTransfer.files[0])
  }

  async function template() {
    setTemplating(true)
    try {
      await downloadTemplate({ sources: lookups.sources, statuses: lookups.statuses, industries: lookups.industries })
    } catch {
      toast.error('Template not downloaded', 'Try again in a moment.')
    } finally {
      setTemplating(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
            dragging ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-line-strong bg-surface',
          )}
        >
          <span className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-sunken text-muted">
            {reading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            ) : (
              <UploadCloud className="size-6" aria-hidden />
            )}
          </span>
          <p className="text-sm font-semibold">{reading ? 'Reading the file…' : 'Drop your Lead Tracker here'}</p>
          <p className="mt-1 max-w-sm text-[0.8125rem] text-muted">
            .xlsx or .csv, first row as headers, up to {MAX_FILE_ROWS.toLocaleString()} rows. Only the first sheet is read.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button write onClick={() => inputRef.current?.click()} disabled={reading}>
              <FileSpreadsheet />
              Choose file
            </Button>
            <Button write variant="secondary" onClick={() => onLoaded(sampleSheet())} disabled={reading}>
              <FlaskConical />
              Try a sample file
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Choose a spreadsheet"
            onChange={(e) => void load(e.target.files?.[0])}
          />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {sheet && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success-500/30 bg-success-50 px-4 py-3 text-[0.8125rem] dark:bg-success-700/15">
            <CheckCircle2 className="size-4 shrink-0 text-success-600" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{sheet.fileName}</span>
              <span className="text-muted">
                {' '}
                · {sheet.rows.length.toLocaleString()} rows · {sheet.headers.length} columns
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              <RefreshCw />
              Replace
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Start from the template" description="Headers match the system, so every column maps itself." />
          <CardBody>
            <Button variant="secondary" size="sm" onClick={template} loading={templating}>
              <Download />
              Download template (.xlsx)
            </Button>
            <p className="mt-3 text-xs text-muted">Includes an “Allowed values” sheet with every source, industry and status.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Migrating the old Lead Tracker?" />
          <CardBody>
            <ul className="list-disc space-y-1.5 ps-4 text-xs text-muted">
              <li>Upload it as is — you’ll map its columns next.</li>
              <li>Free-typed sources, industries, statuses and owners are cleaned up in step 3.</li>
              <li>Local mobiles (with a leading 0) get the country code, e.g. {mobileSample(getRegion().country)}.</li>
              <li>Duplicates are checked by company, domain and email before anything is saved.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------
 * 2 · Map columns
 * ---------------------------------------------------------------------------------------- */

export function MapStep({
  sheet,
  mapping,
  onChange,
  onAuto,
}: {
  sheet: SheetFile
  mapping: Mapping
  onChange: (key: TargetKey, col: number | null) => void
  onAuto: () => void
}) {
  const used = new Map<number, TargetKey>()
  for (const f of TARGET_FIELDS) {
    const c = mapping[f.key]
    if (c !== null) used.set(c, f.key)
  }
  const ignored = sheet.headers.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i))
  const mappedFields = TARGET_FIELDS.filter((f) => mapping[f.key] !== null)
  const preview = sheet.rows.slice(0, 5)

  function samples(col: number | null): string {
    if (col === null) return ''
    const vals: string[] = []
    for (const r of sheet.rows) {
      const v = r[col]?.trim()
      if (v && !vals.includes(v)) vals.push(v)
      if (vals.length === 3) break
    }
    return vals.join(' · ')
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Match your columns to lead fields"
          description={`${mappedFields.length} of ${TARGET_FIELDS.length} fields matched. Columns you don’t map are ignored.`}
          action={
            <Button variant="ghost" size="sm" onClick={onAuto}>
              <Wand2 />
              Auto-match again
            </Button>
          }
        />
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[40rem] text-[0.8125rem]">
            <thead className="bg-sunken text-start text-xs text-muted">
              <tr>
                <th className="px-5 py-2 text-start font-medium">Lead field</th>
                <th className="w-64 px-3 py-2 text-start font-medium">Column in your file</th>
                <th className="px-5 py-2 text-start font-medium">Sample values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {TARGET_FIELDS.map((f) => {
                const col = mapping[f.key]
                const missing = f.key === 'company' && col === null
                return (
                  <tr key={f.key} className={cn(missing && 'bg-danger-50/60 dark:bg-danger-700/10')}>
                    <td className="px-5 py-2 align-middle">
                      <span className="font-medium text-ink">{f.label}</span>
                      {f.required && (
                        <span className="ms-0.5 text-danger-600" aria-label="required">
                          *
                        </span>
                      )}
                      {f.listed && <Badge className="ms-2" tone="neutral">List</Badge>}
                      {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
                      {(f.key === 'sourceType' || f.key === 'industry') && col === null && (
                        <span className="block text-xs text-muted">Not in the file? Pick one value for all rows in the next step.</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <SelectInput
                        aria-label={`Column for ${f.label}`}
                        value={col === null ? '' : String(col)}
                        invalid={missing}
                        onChange={(e) => onChange(f.key, e.target.value === '' ? null : Number(e.target.value))}
                      >
                        <option value="">— Don’t import —</option>
                        {sheet.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {columnLetter(i)} · {h}
                            {used.has(i) && used.get(i) !== f.key ? ' (used)' : ''}
                          </option>
                        ))}
                      </SelectInput>
                    </td>
                    <td className="max-w-0 truncate px-5 py-2 text-muted" title={samples(col)}>
                      {samples(col) || <span className="text-subtle">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {ignored.length > 0 && (
          <p className="border-t border-line px-5 py-3 text-xs text-muted">
            Ignored columns: {ignored.map(({ h, i }) => `${columnLetter(i)} · ${h}`).join(', ')}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Preview" description={`First ${preview.length} of ${sheet.rows.length.toLocaleString()} rows, as mapped.`} />
        <div className="overflow-x-auto border-t border-line">
          {mappedFields.length === 0 ? (
            <p className="px-5 py-6 text-[0.8125rem] text-muted">Map at least the Company column to see a preview.</p>
          ) : (
            <table className="w-full text-[0.8125rem]">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">Row</th>
                  {mappedFields.map((f) => (
                    <th key={f.key} className="px-3 py-2 text-start font-medium whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className="num px-3 py-2 text-muted">{sheet.rowNumbers[i]}</td>
                    {mappedFields.map((f) => (
                      <td key={f.key} className="max-w-56 truncate px-3 py-2 whitespace-nowrap">
                        {r[mapping[f.key]!] || <span className="text-subtle">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------
 * 3 · Clean values
 * ---------------------------------------------------------------------------------------- */

const LISTED: { key: ListedKey; label: string; blankLabel: string }[] = [
  { key: 'sourceType', label: 'Source', blankLabel: 'Leave blank (row fails)' },
  { key: 'industry', label: 'Industry', blankLabel: 'Leave blank (row fails)' },
  { key: 'status', label: 'Status', blankLabel: '' },
  { key: 'owner', label: 'Owner', blankLabel: 'Auto-assign' },
]

export function CleanStep({
  sheet,
  mapping,
  maps,
  onMap,
  rows,
  fixes,
  onFix,
  owners,
  ownersLoading,
}: {
  sheet: SheetFile
  mapping: Mapping
  maps: ValueMaps
  onMap: (kind: ListedKey, key: string, value: string) => void
  rows: CleanRow[]
  fixes: Fixes
  onFix: (row: number, field: 'mobile' | 'email', value: string) => void
  owners: LeadOwnerOption[]
  ownersLoading: boolean
}) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [showAll, setShowAll] = useState(false)

  const stats = useMemo(() => {
    let errors = 0
    let warnings = 0
    let mobiles = 0
    let emails = 0
    for (const r of rows) {
      if (r.issues.some((i) => i.level === 'error')) errors++
      else if (r.issues.length > 0) warnings++
      if (r.data.mobile && r.raw.mobile !== r.data.mobile) mobiles++
      if (r.data.email && r.raw.email !== r.data.email) emails++
    }
    return { errors, warnings, mobiles, emails }
  }, [rows])

  const flagged = rows.filter((r) =>
    filter === 'all' ? r.issues.length > 0 : r.issues.some((i) => i.level === filter),
  )
  const shown = showAll ? flagged : flagged.slice(0, 50)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Rows" value={rows.length.toLocaleString()} />
        <Tile label="Mobiles normalized" value={stats.mobiles} tone="brand" hint={`To ${mobileExample(getRegion().country)}`} />
        <Tile label="Rows with warnings" value={stats.warnings} tone={stats.warnings ? 'amber' : 'neutral'} hint="Imported, value cleared" />
        <Tile label="Rows with errors" value={stats.errors} tone={stats.errors ? 'red' : 'green'} hint={stats.errors ? 'Won’t import until fixed' : 'All good'} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {LISTED.map(({ key, label, blankLabel }) => (
          <ValueMapCard
            key={key}
            kind={key}
            label={label}
            blankLabel={blankLabel}
            sheet={sheet}
            col={mapping[key]}
            map={maps[key]}
            onMap={(k, v) => onMap(key, k, v)}
            owners={owners}
            ownersLoading={ownersLoading}
          />
        ))}
      </div>

      <Card>
        <CardHeader
          title={`Rows needing attention · ${flagged.length}`}
          description="Fix mobiles and emails here, or leave them: invalid values are left blank on import."
          action={
            <Segmented
              label="Filter rows"
              size="xs"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'error', label: 'Errors' },
                { value: 'warning', label: 'Warnings' },
              ]}
            />
          }
        />
        {flagged.length === 0 ? (
          <p className="flex items-center gap-2 border-t border-line px-5 py-5 text-[0.8125rem] text-success-700 dark:text-success-500">
            <CheckCircle2 className="size-4" aria-hidden />
            Nothing to fix{filter !== 'all' ? ' in this view' : ''}.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[40rem] text-[0.8125rem]">
              <thead className="bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 text-start font-medium">Row</th>
                  <th className="px-3 py-2 text-start font-medium">Company</th>
                  <th className="px-3 py-2 text-start font-medium">Problem</th>
                  <th className="w-72 px-5 py-2 text-start font-medium">Fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.data.row} className="align-top">
                    <td className="num px-5 py-2.5 text-muted">{r.data.row}</td>
                    <td className="px-3 py-2.5 font-medium">{r.data.company || <span className="text-danger-600">(blank)</span>}</td>
                    <td className="px-3 py-2.5">
                      <ul className="space-y-1">
                        {r.issues.map((i, n) => (
                          <li key={n} className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={i.level === 'error' ? 'red' : 'amber'}>{i.level === 'error' ? 'Error' : 'Warning'}</Badge>
                            <span>{i.message}</span>
                            {i.raw && i.field !== 'sourceType' && i.field !== 'industry' && (
                              <code className="rounded bg-sunken px-1 text-xs text-muted">{i.raw}</code>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="space-y-1.5 px-5 py-2">
                      {r.issues.some((i) => i.field === 'mobile') || fixes[r.data.row]?.mobile !== undefined ? (
                        <TextInput
                          aria-label={`Mobile for row ${r.data.row}`}
                          placeholder={mobileExample(getRegion().country)}
                          defaultValue={fixes[r.data.row]?.mobile ?? r.raw.mobile}
                          onBlur={(e) => onFix(r.data.row, 'mobile', e.target.value)}
                          className="h-8"
                        />
                      ) : null}
                      {r.issues.some((i) => i.field === 'email') || fixes[r.data.row]?.email !== undefined ? (
                        <TextInput
                          aria-label={`Email for row ${r.data.row}`}
                          placeholder="name@company.com"
                          defaultValue={fixes[r.data.row]?.email ?? r.raw.email}
                          onBlur={(e) => onFix(r.data.row, 'email', e.target.value)}
                          className="h-8"
                        />
                      ) : null}
                      {!r.issues.some((i) => i.field === 'mobile' || i.field === 'email') &&
                        fixes[r.data.row] === undefined && (
                          <span className="text-xs text-muted">
                            {r.issues.some((i) => i.field === 'company')
                              ? 'Add the company in the file and re-upload, or skip it.'
                              : r.issues.some((i) => i.field === 'sourceType' || i.field === 'industry')
                                ? 'Map the value above.'
                                : 'Imported with the value left blank.'}
                          </span>
                        )}
                      {r.data.mobile && fixes[r.data.row]?.mobile !== undefined && (
                        <span className="block text-xs text-success-700 dark:text-success-500">✓ {formatMobile(r.data.mobile, getRegion().country)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {flagged.length > shown.length && (
              <div className="border-t border-line px-5 py-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                  Show all {flagged.length} rows
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function ValueMapCard({
  kind,
  label,
  blankLabel,
  sheet,
  col,
  map,
  onMap,
  owners,
  ownersLoading,
}: {
  kind: ListedKey
  label: string
  blankLabel: string
  sheet: SheetFile
  col: number | null
  map: Record<string, string>
  onMap: (key: string, value: string) => void
  owners: LeadOwnerOption[]
  ownersLoading: boolean
}) {
  const lookups = useLookups()
  const values = col === null ? [] : distinctValues(sheet, col)
  // Only ACTIVE lookup items can be picked; no free typing.
  const toOptions = (list: { key: string; label: string }[]) => list.map((i) => ({ value: i.key, label: i.label }))
  const options: { value: string; label: string }[] =
    kind === 'sourceType'
      ? toOptions(lookups.sources)
      : kind === 'status'
        ? toOptions(lookups.statuses)
        : kind === 'industry'
          ? toOptions(lookups.industries)
          : owners.map((o) => ({ value: o.id, label: o.name }))
  const blank = kind === 'status' ? (lookups.openStatuses[0]?.label ?? 'New') : blankLabel
  const unmapped = values.filter((v) => !map[v.key] && v.key !== '').length

  if (col === null) {
    if (kind === 'owner' || kind === 'status') {
      return (
        <Card>
          <CardHeader title={label} description={
            kind === 'owner'
              ? 'No owner column — every lead is auto-assigned.'
              : `No status column — every lead starts as ${lookups.openStatuses[0]?.label ?? 'New'}.`
          } />
        </Card>
      )
    }
    return (
      <Card>
        <CardHeader title={label} description="Not in the file. Pick one value for every row." />
        <CardBody>
          <SelectInput aria-label={`${label} for all rows`} value={map[''] ?? ''} invalid={!map['']} onChange={(e) => onMap('', e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectInput>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {label}
            <span className="font-normal text-muted">
              · {values.length} distinct {values.length === 1 ? 'value' : 'values'}
            </span>
          </span>
        }
        description={unmapped > 0 ? `${unmapped} not mapped yet` : 'Every value is mapped to the list.'}
        action={unmapped === 0 ? <Badge tone="green">Done</Badge> : <Badge tone="amber">{unmapped} to map</Badge>}
      />
      <div className="max-h-80 overflow-y-auto border-t border-line">
        <table className="w-full text-[0.8125rem]">
          <tbody className="divide-y divide-line">
            {values.map((v) => {
              const current = map[v.key] ?? ''
              const auto = current && kind !== 'owner' && v.key.toLowerCase() !== current.toLowerCase()
              return (
                <tr key={v.key}>
                  <td className="w-1/2 px-5 py-2">
                    <span className={cn('break-words', v.key === '' && 'text-muted italic')}>{v.key === '' ? '(blank)' : v.raw}</span>
                    <span className="num ms-1.5 text-xs text-subtle">×{v.count}</span>
                  </td>
                  <td className="px-5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <SelectInput
                        aria-label={`Map “${v.raw || 'blank'}” to`}
                        value={current}
                        invalid={!current && (kind === 'sourceType' || kind === 'industry')}
                        disabled={kind === 'owner' && ownersLoading}
                        onChange={(e) => onMap(v.key, e.target.value)}
                        className="h-8"
                      >
                        <option value="">{blank}</option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </SelectInput>
                      {auto ? (
                        <span title="Suggested automatically" className="text-brand-600 dark:text-brand-300">
                          <Sparkles className="size-3.5" aria-label="Suggested" />
                        </span>
                      ) : (
                        <span className="w-3.5" />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
