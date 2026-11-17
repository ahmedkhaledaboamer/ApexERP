import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Pencil, RotateCcw, Users } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { EditTargetsDrawer } from '@/modules/targets/components/EditTargetsDrawer'
import { MonthSwitcher } from '@/modules/targets/components/MonthSwitcher'
import { useResetTargets, useTargetDefaults, useTargetsQuery } from '@/modules/targets/hooks/useTargets'
import { TargetNotTracked } from '@/modules/targets/components/TargetProgress'
import { currentMonth, isTracked, monthLabel, shiftMonth } from '@/modules/targets/lib'
import { TARGET_KEYS, TARGET_LABELS, TARGET_SOURCES, type AgentTargetRow, type TargetValues } from '@/modules/targets/types'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

/** How far ahead admins may plan targets (matches Sales › Sales targets). */
const MAX_MONTHS_AHEAD = 3

/** Per-agent targets for a month: which agents follow the defaults and which have their own. */
export function AgentOverridesCard({ canEdit: canEditSettings }: { canEdit: boolean }) {
  const thisMonth = currentMonth()
  const [month, setMonth] = useState(thisMonth)
  const query = useTargetsQuery(month)
  const defaults = useTargetDefaults()
  const reset = useResetTargets(month)
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [resetting, setResetting] = useState<AgentTargetRow | null>(null)

  const data = query.data
  const canEdit = canEditSettings && !!data?.canEdit
  const own = data?.rows.filter((r) => !r.isDefault).length ?? 0

  function confirmReset() {
    if (!resetting) return
    reset.mutate(resetting.userId, {
      onSuccess: () => {
        toast.success('Targets reset', `${resetting.name} follows the defaults for ${monthLabel(month)}.`)
        setResetting(null)
      },
      onError: (err) => toast.error('Couldn’t reset targets', err.message),
    })
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-[0.8125rem] font-semibold text-ink">Targets per agent</h2>
          <p className="mt-0.5 text-xs text-muted">
            {data
              ? `${monthLabel(data.month)} · ${own} of ${data.rows.length} ${data.rows.length === 1 ? 'agent has' : 'agents have'} their own targets; the rest use the defaults.`
              : 'Agents follow the defaults unless they have targets of their own for the month.'}
          </p>
        </div>
        <MonthSwitcher month={month} thisMonth={thisMonth} lastAllowed={shiftMonth(thisMonth, MAX_MONTHS_AHEAD)} onChange={setMonth} />
      </div>

      {query.isPending ? (
        <div aria-busy="true" aria-label="Loading agent targets" className="space-y-4 border-t border-line px-5 py-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3.5 w-36" />
              {Array.from({ length: 6 }, (_, j) => (
                <Skeleton key={j} className="hidden h-4 flex-1 md:block" />
              ))}
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      ) : data!.rows.length === 0 ? (
        <EmptyState icon={<Users aria-hidden />} title="No sales agents yet" body="Targets are set per sales agent. Add users with the Sales Agent role to see them here." />
      ) : (
        <div className={cn('overflow-x-auto border-t border-line transition-opacity', query.isPlaceholderData && 'opacity-60')} aria-busy={query.isFetching || undefined}>
          <table className="w-full min-w-[62rem] border-collapse text-[0.8125rem]">
            <thead>
              <tr className="border-b border-line bg-sunken/50 text-left text-xs font-medium text-muted">
                <th scope="col" className="sticky start-0 z-10 w-[13rem] bg-sunken px-5 py-2.5 font-medium">
                  Agent
                </th>
                {TARGET_KEYS.map((k) => (
                  <th key={k} scope="col" className="px-3 py-2.5 text-end align-top font-medium" title={isTracked(k) ? TARGET_SOURCES[k] : undefined}>
                    {TARGET_LABELS[k]}
                    {!isTracked(k) && (
                      <span className="mt-0.5 block font-normal">
                        <TargetNotTracked />
                      </span>
                    )}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Uses
                </th>
                {canEdit && (
                  <th scope="col" className="w-20 px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data!.rows.map((row) => (
                <tr key={row.userId} className="group transition-colors hover:bg-hover/50">
                  <th scope="row" className="sticky start-0 z-10 bg-surface px-5 py-2.5 text-left font-normal group-hover:bg-hover">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={row.name} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{row.name}</span>
                        <span className="block truncate text-xs text-muted">{row.title}</span>
                      </span>
                    </span>
                  </th>
                  {TARGET_KEYS.map((k) => (
                    <ValueCell key={k} value={row.values[k]} isDefault={row.isDefault} defaultValue={defaults.data?.values[k]} />
                  ))}
                  <td className="px-3 py-2.5">
                    {row.isDefault ? <Badge variant="outline">Defaults</Badge> : <Badge tone="brand">Own targets</Badge>}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2.5">
                      <span className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="sm" iconOnly aria-label={`Edit targets for ${row.name}`} title="Edit targets" onClick={() => setEditing(row.userId)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          iconOnly
                          aria-label={`Reset ${row.name} to the defaults`}
                          title={row.isDefault ? 'Already using the defaults' : 'Reset agent to defaults'}
                          disabled={row.isDefault}
                          onClick={() => setResetting(row)}
                        >
                          <RotateCcw />
                        </Button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-xs text-muted">
        <span>
          <span className="font-medium text-ink-2">—</span> means no target: the kind is left out of completion and shows “No target”.
          {TARGET_KEYS.some((k) => !isTracked(k)) && ' Events attended targets can be set now; they show n/a and aren’t counted until Events is enabled.'}
        </span>
        <Link
          to={month === thisMonth ? PATHS.salesTargets : `${PATHS.salesTargets}?month=${month}`}
          className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300"
        >
          Progress in Sales › Sales targets
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {canEdit && data && (
        <EditTargetsDrawer
          open={editing !== null}
          onClose={() => setEditing(null)}
          month={data.month}
          rows={data.rows}
          userId={editing ?? data.rows[0]?.userId ?? ''}
          onUserChange={setEditing}
        />
      )}

      <Modal
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Reset agent to defaults?"
        description={resetting ? `${resetting.name}’s own targets for ${monthLabel(month)} are removed; the company defaults apply instead.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetting(null)}>
              Cancel
            </Button>
            <Button onClick={confirmReset} loading={reset.isPending}>
              Reset to defaults
            </Button>
          </>
        }
      >
        {resetting && defaults.data && <Comparison own={resetting.values} defaults={defaults.data.values} />}
      </Modal>
    </Card>
  )
}

function ValueCell({ value, isDefault, defaultValue }: { value: number; isDefault: boolean; defaultValue?: number }) {
  const differs = !isDefault && defaultValue !== undefined && value !== defaultValue
  return (
    <td className="num px-3 py-2.5 text-end whitespace-nowrap" title={value === 0 ? 'No target' : differs ? `Default: ${defaultValue?.toLocaleString('en-US') || 'none'}` : undefined}>
      {value === 0 ? (
        <span className="text-subtle">—</span>
      ) : (
        <span className={cn(isDefault ? 'text-muted' : differs ? 'font-semibold text-ink' : 'text-ink-2')}>{value.toLocaleString('en-US')}</span>
      )}
    </td>
  )
}

function Comparison({ own, defaults }: { own: TargetValues; defaults: TargetValues }) {
  const changed = TARGET_KEYS.filter((k) => own[k] !== defaults[k])
  if (!changed.length) return <p className="text-[0.8125rem] text-muted">Their targets already match the defaults.</p>
  const show = (n: number) => (n === 0 ? 'No target' : n.toLocaleString('en-US'))
  return (
    <ul className="divide-y divide-line rounded-lg border border-line text-[0.8125rem]">
      {changed.map((k) => (
        <li key={k} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-ink-2">{TARGET_LABELS[k]}</span>
          <span className="num whitespace-nowrap">
            <span className="text-muted line-through">{show(own[k])}</span> → <span className="font-semibold text-ink">{show(defaults[k])}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
