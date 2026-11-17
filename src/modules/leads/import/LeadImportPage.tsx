import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileUp, ShieldAlert } from 'lucide-react'
import type { ImportCheckRow, ImportDecision, ImportOwnerRule, ImportResult } from '@/modules/leads/types'
import { PATHS } from '@/app/paths'
import { useImportCheck, useImportLeads, useLeadOwnersQuery } from '@/modules/leads/hooks/useLeads'
import { can, scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { useLookups } from '@/shared/hooks/useLookups'
import { useServicesQuery } from '@/modules/services/hooks/useServices'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import {
  autoMatch,
  buildRows,
  emptyMapping,
  emptyValueMaps,
  suggestValueMaps,
  type Fixes,
  type ListedKey,
  type Mapping,
  type SheetFile,
  type TargetKey,
  type ValueMaps,
} from './importModel'
import { downloadReport, type ReportLine } from './importFiles'
import { ImportStepper, STEPS } from './ImportUi'
import { CleanStep, MapStep, UploadStep } from './ImportSetupSteps'
import { ConfirmStep, DuplicatesStep, isDuplicate, planFor, ResultView } from './ImportReviewSteps'
import { useLeaveGuard } from './useLeaveGuard'

/**
 * Excel import wizard (spec: "Excel import with column mapping, value cleanup and duplicate
 * detection"; used to migrate the team's Lead Tracker before Phase 1). Wizard state lives in
 * this component on purpose: it's one-off work, not app state.
 */
export default function LeadImportPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden' || !can(user.role, 'sales', 'create') || (scope !== 'full' && scope !== 'team' && scope !== 'own')) {
    return (
      <PageBody>
        <EmptyState
          icon={<ShieldAlert aria-hidden />}
          title="You can’t import leads"
          body={`${user.role} doesn’t have permission to add leads. Ask a Sales Manager to run the import.`}
          action={
            <Link to={PATHS.leads}>
              <Button tabIndex={-1} variant="secondary" size="sm">
                Back to leads
              </Button>
            </Link>
          }
        />
      </PageBody>
    )
  }
  return <ImportWizard scope={scope} />
}

function ImportWizard({ scope }: { scope: 'full' | 'team' | 'own' }) {
  const navigate = useNavigate()
  const toast = useToast()
  const canOverride = scope === 'full' || scope === 'team'
  const owners = useLeadOwnersQuery()
  const checkMutation = useImportCheck()
  const importMutation = useImportLeads()
  // Free text in the file is mapped onto the ACTIVE lookup items only.
  const lookups = useLookups()
  const catalog = useServicesQuery()
  const lists = useMemo(
    () => ({ sources: lookups.sources, statuses: lookups.statuses, industries: lookups.industries, services: catalog.data ?? [] }),
    [lookups.sources, lookups.statuses, lookups.industries, catalog.data],
  )

  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)
  const [sheet, setSheet] = useState<SheetFile | null>(null)
  const [mapping, setMapping] = useState<Mapping>(emptyMapping)
  const [maps, setMaps] = useState<ValueMaps>(emptyValueMaps)
  const [fixes, setFixes] = useState<Fixes>({})
  const [check, setCheck] = useState<ImportCheckRow[] | null>(null)
  const [decisions, setDecisions] = useState<Record<number, ImportDecision>>({})
  const [ownerRule, setOwnerRule] = useState<ImportOwnerRule>('file')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [reporting, setReporting] = useState(false)

  useLeaveGuard(!!sheet && !result, 'Leave the import? Your mapping and cleanup will be lost.')

  const rows = useMemo(() => (sheet ? buildRows(sheet, mapping, maps, fixes, lists) : []), [sheet, mapping, maps, fixes, lists])

  // Keep value-map suggestions in step with the mapping and the owner list.
  useEffect(() => {
    if (!sheet || lookups.isLoading) return
    setMaps((m) => suggestValueMaps(sheet, mapping, m, owners.data ?? [], lists))
  }, [sheet, mapping, owners.data, lists, lookups.isLoading])

  useEffect(() => {
    setOwnerRule(mapping.owner === null ? 'auto' : 'file')
  }, [mapping.owner])

  function go(next: number) {
    setStep(next)
    setMaxReached((m) => Math.max(m, next))
    window.scrollTo({ top: 0, behavior: 'smooth' })
    if (next === 3) runCheck()
  }

  function runCheck() {
    setCheck(null)
    checkMutation.mutate(
      rows.map((r) => r.data),
      {
        onSuccess: (res) => {
          setCheck(res)
          setDecisions((prev) => {
            const next: Record<number, ImportDecision> = {}
            for (const c of res) if (isDuplicate(c)) next[c.row] = prev[c.row] === 'import' && canOverride ? 'import' : 'skip'
            return next
          })
        },
      },
    )
  }

  function loaded(s: SheetFile) {
    setSheet(s)
    setMapping(autoMatch(s.headers))
    setMaps(emptyValueMaps())
    setFixes({})
    setCheck(null)
    setDecisions({})
    setMaxReached(0)
    toast.success('File read', `${s.rows.length.toLocaleString()} rows from ${s.fileName}`)
  }

  function restart() {
    setSheet(null)
    setMapping(emptyMapping())
    setMaps(emptyValueMaps())
    setFixes({})
    setCheck(null)
    setDecisions({})
    setResult(null)
    setStep(0)
    setMaxReached(0)
    importMutation.reset()
  }

  function setColumn(key: TargetKey, col: number | null) {
    setMapping((m) => {
      const next = { ...m }
      // A column feeds one field: move it rather than duplicate it.
      if (col !== null) for (const k of Object.keys(next) as TargetKey[]) if (next[k] === col) next[k] = null
      next[key] = col
      return next
    })
    setMaxReached(1)
  }

  function setValueMap(kind: ListedKey, key: string, value: string) {
    setMaps((m) => ({ ...m, [kind]: { ...m[kind], [key]: value } }))
    setMaxReached(2)
  }

  function setFix(row: number, field: 'mobile' | 'email', value: string) {
    setFixes((f) => ({ ...f, [row]: { ...f[row], [field]: value.trim() } }))
    setMaxReached(2)
  }

  function startImport() {
    if (!sheet) return
    importMutation.mutate(
      { rows: rows.map((r) => r.data), decisions, ownerRule: scope === 'own' ? 'auto' : ownerRule },
      {
        onSuccess: (res) => {
          setResult(res)
          toast.success('Import finished', `${res.created} created · ${res.skipped} skipped · ${res.failed.length} failed`)
        },
      },
    )
  }

  async function report() {
    if (!result || !sheet) return
    setReporting(true)
    const lines: ReportLine[] = [
      ...result.failed.map((f) => ({ ...f, outcome: 'Failed' as const })),
      ...result.skippedRows.map((f) => ({ ...f, outcome: 'Skipped' as const })),
    ]
    const notCreated = new Set(lines.map((l) => l.row))
    for (const r of rows) {
      if (notCreated.has(r.data.row) || r.issues.length === 0) continue
      lines.push({
        row: r.data.row,
        company: r.data.company,
        outcome: 'Imported with warnings',
        reason: r.issues.map((i) => `${i.message}${i.raw ? ` (${i.raw})` : ''}`).join('; '),
      })
    }
    try {
      await downloadReport(lines, rows, sheet.fileName)
    } catch {
      toast.error('Report not downloaded', 'Try again in a moment.')
    } finally {
      setReporting(false)
    }
  }

  const plan = check ? planFor(rows, check, decisions) : null
  const missingDefaults = (['sourceType', 'industry'] as const).filter((k) => mapping[k] === null && !maps[k][''])

  let nextDisabled = false
  let nextHint = ''
  if (step === 0 && !sheet) {
    nextDisabled = true
    nextHint = 'Upload a file to continue.'
  } else if (step === 1 && mapping.company === null) {
    nextDisabled = true
    nextHint = 'Map the Company column to continue.'
  } else if (step === 2 && missingDefaults.length > 0) {
    nextDisabled = true
    nextHint = `Pick a ${missingDefaults.map((k) => (k === 'sourceType' ? 'source' : 'industry')).join(' and ')} for all rows.`
  } else if (step === 3 && !check) {
    nextDisabled = true
    nextHint = checkMutation.isError ? 'The check failed — try again.' : 'Checking…'
  } else if (step === 4 && plan && plan.importing === 0) {
    nextDisabled = true
    nextHint = 'Nothing to import.'
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        icon={
          <IconTile>
            <FileUp />
          </IconTile>
        }
        title="Import leads"
        description="Bring in the Excel Lead Tracker: map columns, clean values, catch duplicates."
        actions={
          <Link to={PATHS.leads}>
            <Button tabIndex={-1} variant="secondary" size="sm">
              Back to leads
            </Button>
          </Link>
        }
      >
        <div className="pb-4">
          {!result && <ImportStepper step={step} maxReached={maxReached} onJump={go} />}
        </div>
      </PageHeader>

      <PageBody className="w-full flex-1">
        {result ? (
          <ResultView result={result} onReport={report} reporting={reporting} onRestart={restart} />
        ) : step === 0 ? (
          <UploadStep sheet={sheet} onLoaded={loaded} />
        ) : !sheet ? null : step === 1 ? (
          <MapStep sheet={sheet} mapping={mapping} onChange={setColumn} onAuto={() => setMapping(autoMatch(sheet.headers))} />
        ) : step === 2 ? (
          <CleanStep
            sheet={sheet}
            mapping={mapping}
            maps={maps}
            onMap={setValueMap}
            rows={rows}
            fixes={fixes}
            onFix={setFix}
            owners={owners.data ?? []}
            ownersLoading={owners.isPending}
          />
        ) : step === 3 ? (
          <DuplicatesStep
            rows={rows}
            check={check}
            loading={checkMutation.isPending}
            error={checkMutation.isError ? checkMutation.error.message : null}
            onRetry={runCheck}
            decisions={decisions}
            onDecide={(list, d) => setDecisions((prev) => ({ ...prev, ...Object.fromEntries(list.map((r) => [r, d])) }))}
            canOverride={canOverride}
          />
        ) : check ? (
          <ConfirmStep
            rows={rows}
            check={check}
            decisions={decisions}
            ownerRule={ownerRule}
            onOwnerRule={setOwnerRule}
            ownerMapped={mapping.owner !== null}
            scope={scope}
            fileName={sheet.fileName}
            error={importMutation.isError ? importMutation.error.message : null}
          />
        ) : null}
      </PageBody>

      {!result && (
        <div className="sticky bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-10">
            <p className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
              {nextHint || (sheet ? `${sheet.fileName} · ${sheet.rows.length.toLocaleString()} rows` : `Step 1 of ${STEPS.length}`)}
            </p>
            {step === 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (!sheet || window.confirm('Leave the import? Your file will be discarded.')) navigate(PATHS.leads)
                }}
              >
                Cancel
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => go(step - 1)} disabled={importMutation.isPending}>
                <ArrowLeft />
                Back
              </Button>
            )}
            {step < 4 ? (
              <Button onClick={() => go(step + 1)} disabled={nextDisabled}>
                Next: {STEPS[step + 1]}
                <ArrowRight />
              </Button>
            ) : (
              <Button onClick={startImport} disabled={nextDisabled} loading={importMutation.isPending}>
                Import {plan ? plan.importing.toLocaleString() : ''} {plan?.importing === 1 ? 'lead' : 'leads'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
