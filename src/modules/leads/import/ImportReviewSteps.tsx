import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Copy, Download, ExternalLink, FileWarning, ListChecks, RotateCcw, UserCheck, XCircle } from 'lucide-react'
import type { ImportCheckRow, ImportDecision, ImportOwnerRule, ImportResult } from '@/modules/leads/types'
import { leadPath, PATHS } from '@/app/paths'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import type { CleanRow } from './importModel'
import { Segmented, Tile } from './ImportUi'

const REASON: Record<'company' | 'domain' | 'email', string> = {
  company: 'Same company',
  domain: 'Same domain',
  email: 'Same email',
}

export function isDuplicate(c: ImportCheckRow): boolean {
  return c.matches.length > 0 || c.fileDuplicateOf !== null
}

/** What will happen to each row, from the client cleanup, the server check and the decisions. */
export function planFor(rows: CleanRow[], check: ImportCheckRow[], decisions: Record<number, ImportDecision>) {
  const byRow = new Map(check.map((c) => [c.row, c]))
  let importing = 0
  let skipped = 0
  let failing = 0
  let warned = 0
  for (const r of rows) {
    const c = byRow.get(r.data.row)
    const hasError = r.issues.some((i) => i.level === 'error') || (c?.errors.length ?? 0) > 0
    if (hasError) failing++
    else if (c && isDuplicate(c) && decisions[r.data.row] !== 'import') skipped++
    else {
      importing++
      if (r.issues.length > 0 || (c?.warnings.length ?? 0) > 0) warned++
    }
  }
  return { importing, skipped, failing, warned }
}

/* ------------------------------------------------------------------------------------------
 * 4 · Duplicates
 * ---------------------------------------------------------------------------------------- */

export function DuplicatesStep({
  rows,
  check,
  loading,
  error,
  onRetry,
  decisions,
  onDecide,
  canOverride,
}: {
  rows: CleanRow[]
  check: ImportCheckRow[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  decisions: Record<number, ImportDecision>
  onDecide: (rows: number[], d: ImportDecision) => void
  canOverride: boolean
}) {
  const [showErrors, setShowErrors] = useState(false)
  const byRow = useMemo(() => new Map(rows.map((r) => [r.data.row, r])), [rows])

  if (error) return <Card><ErrorState message={error} onRetry={onRetry} /></Card>
  if (loading || !check) {
    return (
      <Card>
        <CardBody className="pt-5">
          <p className="flex items-center gap-2 text-[0.8125rem] text-muted">
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            Checking {rows.length.toLocaleString()} rows against each other and existing leads…
          </p>
          <div className="mt-4 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </CardBody>
      </Card>
    )
  }

  const dupes = check.filter((c) => isDuplicate(c) && !hasError(c, byRow.get(c.row)))
  const existing = dupes.filter((c) => c.matches.length > 0).length
  const inFile = dupes.filter((c) => c.matches.length === 0).length
  const errorRows = check.filter((c) => hasError(c, byRow.get(c.row)))
  const plan = planFor(rows, check, decisions)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Match existing leads" value={existing} tone={existing ? 'amber' : 'green'} />
        <Tile label="Repeat a row in this file" value={inFile} tone={inFile ? 'amber' : 'green'} />
        <Tile label="Won’t import (errors)" value={errorRows.length} tone={errorRows.length ? 'red' : 'green'} />
        <Tile label="Ready to import" value={plan.importing} tone="brand" />
      </div>

      <Card>
        <CardHeader
          icon={<Copy />}
          title={`Possible duplicates · ${dupes.length}`}
          description={
            canOverride
              ? 'Duplicates are skipped by default. As a manager you can import a row anyway.'
              : 'Duplicates are skipped. Only a manager can import a duplicate anyway.'
          }
          action={
            dupes.length > 0 && (
              <>
                <Button variant="ghost" size="sm" onClick={() => onDecide(dupes.map((d) => d.row), 'skip')}>
                  Skip all
                </Button>
                {canOverride && (
                  <Button variant="ghost" size="sm" onClick={() => onDecide(dupes.map((d) => d.row), 'import')}>
                    Import all
                  </Button>
                )}
              </>
            )
          }
        />
        {dupes.length === 0 ? (
          <p className="flex items-center gap-2 border-t border-line px-5 py-5 text-[0.8125rem] text-success-700 dark:text-success-500">
            <CheckCircle2 className="size-4" aria-hidden />
            No duplicates found by company name, domain or email.
          </p>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {dupes.map((c) => {
              const r = byRow.get(c.row)
              const decision = decisions[c.row] ?? 'skip'
              return (
                <li key={c.row} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                  <span className="num mt-0.5 w-10 shrink-0 text-xs text-muted">#{c.row}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-medium">{r?.data.company}</p>
                    <p className="text-xs text-muted">
                      {[r?.data.contactName, r?.data.email, r?.data.website].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {c.matches.slice(0, 3).map((m) => (
                        <li key={m.leadId} className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge tone="amber">{REASON[m.reason]}</Badge>
                          <Link
                            to={leadPath(m.leadId)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                          >
                            {m.company}
                            <ExternalLink className="size-3" aria-hidden />
                          </Link>
                          <StatusBadge status={m.status} />
                          <span className="text-muted">{m.ownerName}</span>
                        </li>
                      ))}
                      {c.matches.length > 3 && <li className="text-xs text-muted">+{c.matches.length - 3} more</li>}
                      {c.fileDuplicateOf !== null && (
                        <li className="flex items-center gap-1.5 text-xs">
                          <Badge tone="neutral">In this file</Badge>
                          <span className="text-muted">
                            Same as row {c.fileDuplicateOf} ({byRow.get(c.fileDuplicateOf)?.data.company ?? '—'})
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>
                  <Segmented
                    label={`Decision for row ${c.row}`}
                    value={decision}
                    onChange={(d) => onDecide([c.row], d)}
                    options={[
                      { value: 'skip', label: 'Skip' },
                      {
                        value: 'import',
                        label: 'Import anyway',
                        disabled: !canOverride,
                        title: canOverride ? undefined : 'Managers only',
                      },
                    ]}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {errorRows.length > 0 && (
        <Card>
          <CardHeader
            icon={<FileWarning />}
            title={`Rows that won’t import · ${errorRows.length}`}
            description="Go back to Clean values to map missing values, or fix them in the file and upload again."
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowErrors((v) => !v)}>
                {showErrors ? 'Hide' : 'Show'}
              </Button>
            }
          />
          {showErrors && (
            <ul className="divide-y divide-line border-t border-line">
              {errorRows.map((c) => {
                const r = byRow.get(c.row)
                const messages = [...(r?.issues.filter((i) => i.level === 'error').map((i) => i.message) ?? []), ...c.errors]
                return (
                  <li key={c.row} className="flex gap-4 px-5 py-2.5 text-[0.8125rem]">
                    <span className="num w-10 shrink-0 text-xs text-muted">#{c.row}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r?.data.company || '(no company)'}</span>
                      <span className="block text-xs text-danger-700 dark:text-danger-500">{[...new Set(messages)].join(' · ')}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function hasError(c: ImportCheckRow, r: CleanRow | undefined): boolean {
  return c.errors.length > 0 || !!r?.issues.some((i) => i.level === 'error')
}

/* ------------------------------------------------------------------------------------------
 * 5 · Confirm
 * ---------------------------------------------------------------------------------------- */

export function ConfirmStep({
  rows,
  check,
  decisions,
  ownerRule,
  onOwnerRule,
  ownerMapped,
  scope,
  fileName,
  error,
}: {
  rows: CleanRow[]
  check: ImportCheckRow[]
  decisions: Record<number, ImportDecision>
  ownerRule: ImportOwnerRule
  onOwnerRule: (r: ImportOwnerRule) => void
  ownerMapped: boolean
  scope: 'full' | 'team' | 'own'
  fileName: string
  error: string | null
}) {
  const plan = planFor(rows, check, decisions)
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Will be created" value={plan.importing} tone="brand" hint={`From ${fileName}`} />
        <Tile label="Skipped as duplicates" value={plan.skipped} tone={plan.skipped ? 'amber' : 'neutral'} />
        <Tile label="Won’t import (errors)" value={plan.failing} tone={plan.failing ? 'red' : 'neutral'} />
        <Tile label="Imported with warnings" value={plan.warned} tone={plan.warned ? 'amber' : 'neutral'} hint="Invalid values left blank" />
      </div>

      <Card>
        <CardHeader icon={<UserCheck />} title="Owner assignment" />
        <CardBody>
          {scope === 'own' ? (
            <p className="text-[0.8125rem] text-muted">Every imported lead is assigned to you.</p>
          ) : (
            <fieldset className="space-y-2.5">
              <legend className="sr-only">Owner assignment</legend>
              <OwnerOption
                checked={ownerRule === 'file'}
                disabled={!ownerMapped}
                onSelect={() => onOwnerRule('file')}
                title="Use the owner from the file"
                body={
                  ownerMapped
                    ? 'Owners mapped in step 3 are kept; blank or unmatched owners are auto-assigned.'
                    : 'Your file has no owner column mapped.'
                }
              />
              <OwnerOption
                checked={ownerRule === 'auto'}
                onSelect={() => onOwnerRule('auto')}
                title="Auto-assign every lead"
                body={
                  scope === 'full'
                    ? 'Each lead goes to the sales agent with the fewest open leads at that moment.'
                    : 'Each lead goes to the agent in your team with the fewest open leads.'
                }
              />
            </fieldset>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={<ListChecks />} title="What happens next" />
        <CardBody>
          <ul className="list-disc space-y-1.5 ps-4 text-[0.8125rem] text-muted">
            <li>Statuses come from the file; blank statuses start as New. Closed leads get no follow-up.</li>
            <li>Rows without a follow-up date get one for tomorrow, so nothing falls through.</li>
            <li>Notes from the file are saved to each lead’s notes log.</li>
            <li>Every row is checked again on the server, including duplicates of rows earlier in this file.</li>
          </ul>
        </CardBody>
      </Card>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-50 px-3.5 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  )
}

function OwnerOption({
  checked,
  disabled,
  onSelect,
  title,
  body,
}: {
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: string
  body: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
        checked ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-line hover:bg-hover',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input type="radio" name="owner-rule" className="mt-0.5 accent-brand-600" checked={checked} disabled={disabled} onChange={onSelect} />
      <span>
        <span className="block text-[0.8125rem] font-medium">{title}</span>
        <span className="block text-xs text-muted">{body}</span>
      </span>
    </label>
  )
}

/* ------------------------------------------------------------------------------------------
 * Result
 * ---------------------------------------------------------------------------------------- */

export function ResultView({
  result,
  onReport,
  reporting,
  onRestart,
}: {
  result: ImportResult
  onReport: () => void
  reporting: boolean
  onRestart: () => void
}) {
  const allGood = result.failed.length === 0
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <CardBody className="flex flex-col items-center px-6 pt-10 pb-8 text-center">
          <span
            className={cn(
              'mb-4 flex size-12 items-center justify-center rounded-full',
              allGood ? 'bg-success-50 text-success-600 dark:bg-success-500/15' : 'bg-warning-50 text-warning-600 dark:bg-warning-500/15',
            )}
          >
            {allGood ? <CheckCircle2 className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}
          </span>
          <h2 className="text-lg font-semibold">
            {result.created === 0 ? 'No leads were imported' : `${result.created.toLocaleString()} ${result.created === 1 ? 'lead' : 'leads'} imported`}
          </h2>
          <p className="mt-1 max-w-md text-[0.8125rem] text-muted">
            {allGood
              ? 'Review the new leads with the team, starting with the ones due for follow-up.'
              : 'Some rows didn’t import. Download the report, fix them in the file and import just those rows.'}
          </p>
          <div className="mt-6 grid w-full grid-cols-3 gap-3">
            <Tile label="Created" value={result.created} tone="green" />
            <Tile label="Skipped" value={result.skipped} tone={result.skipped ? 'amber' : 'neutral'} />
            <Tile label="Failed" value={result.failed.length} tone={result.failed.length ? 'red' : 'neutral'} />
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2" data-leave-ok>
            <Link to={PATHS.leads}>
              <Button tabIndex={-1}>View leads</Button>
            </Link>
            {(result.failed.length > 0 || result.skipped > 0) && (
              <Button variant="secondary" onClick={onReport} loading={reporting}>
                <Download />
                Download report
              </Button>
            )}
            <Button variant="ghost" onClick={onRestart}>
              <RotateCcw />
              Import another file
            </Button>
          </div>
        </CardBody>
      </Card>

      {result.failed.length > 0 && (
        <Card>
          <CardHeader icon={<XCircle />} title={`Failed · ${result.failed.length}`} />
          <ul className="max-h-80 divide-y divide-line overflow-y-auto border-t border-line">
            {result.failed.map((f) => (
              <li key={f.row} className="flex gap-4 px-5 py-2.5 text-[0.8125rem]">
                <span className="num w-10 shrink-0 text-xs text-muted">#{f.row}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{f.company}</span>
                  <span className="block text-xs text-danger-700 dark:text-danger-500">{f.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
