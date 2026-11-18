import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import type { PlatformAuditEntry } from '@/modules/platform/types'
import { usePlatformAudit } from '@/modules/platform/hooks'
import { EMPTY_AUDIT_FILTERS, auditFacets, auditQuery, changedKeys, filterAudit, prettyJson, type AuditFilterState } from '@/modules/platform/filters'
import { buildCsv, csvFileName, downloadCsv, type CsvColumn } from '@/modules/platform/csv'
import { fmtDateTime } from '@/modules/platform/format'
import { platformCompanyPath } from '@/modules/platform/permissions'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { SearchInput, SelectInput, TextInput } from '@/shared/components/form/Field'

export const AUDIT_CSV: CsvColumn<PlatformAuditEntry>[] = [
  { header: 'When', value: (e) => e.at },
  { header: 'Actor', value: (e) => e.actorName },
  { header: 'Role', value: (e) => e.actorRole },
  { header: 'Action', value: (e) => e.action },
  { header: 'Company', value: (e) => e.companyName ?? '' },
  { header: 'Company id', value: (e) => e.companyId ?? '' },
  { header: 'Summary', value: (e) => e.summary },
  { header: 'Reason', value: (e) => e.reason ?? '' },
  { header: 'IP', value: (e) => e.ip },
  { header: 'Before', value: (e) => (e.before === null || e.before === undefined ? '' : JSON.stringify(e.before)) },
  { header: 'After', value: (e) => (e.after === null || e.after === undefined ? '' : JSON.stringify(e.after)) },
]

/** Everything platform staff did (including reads of company data), with before/after. */
export default function PlatformAuditPage() {
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_AUDIT_FILTERS)
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const query = useMemo(() => auditQuery(filters), [filters])
  const all = usePlatformAudit({})
  const result = usePlatformAudit(query)
  const facets = useMemo(() => auditFacets(all.data ?? []), [all.data])
  const rows = useMemo(() => filterAudit(result.data ?? [], query).sort((a, b) => b.at.localeCompare(a.at)), [result.data, query])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const set = (k: keyof AuditFilterState, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const active = Object.values({ ...filters, q: search }).some(Boolean)

  return (
    <>
      <PageHeader title="Audit log" description="Every action by platform staff, with the reason they gave. Company reads are logged too." />
      <PageBody>
        <Card className="overflow-hidden">
          <div id="audit-filters" className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <SearchInput id="audit-search" aria-label="Search the audit log" placeholder="Search summary, reason…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-60" />
            <SelectInput id="audit-filter-actor" aria-label="Filter by staff member" value={filters.actor} onChange={(e) => set('actor', e.target.value)} className="h-8 w-48">
              <option value="">Everyone</option>
              {facets.actors.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </SelectInput>
            <SelectInput id="audit-filter-action" aria-label="Filter by action" value={filters.action} onChange={(e) => set('action', e.target.value)} className="h-8 w-48">
              <option value="">All actions</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </SelectInput>
            <SelectInput id="audit-filter-company" aria-label="Filter by company" value={filters.companyId} onChange={(e) => set('companyId', e.target.value)} className="h-8 w-44">
              <option value="">All companies</option>
              {facets.companies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectInput>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              From
              <TextInput id="audit-filter-from" type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} className="h-8 w-36" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              To
              <TextInput id="audit-filter-to" type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} className="h-8 w-36" />
            </label>
            {active && (
              <Button
                size="sm"
                variant="ghost"
                id="audit-clear"
                onClick={() => {
                  setFilters(EMPTY_AUDIT_FILTERS)
                  setSearch('')
                }}
              >
                Clear
              </Button>
            )}
            <span className="num ms-auto text-xs text-muted" id="audit-count">
              {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </span>
            <Button id="audit-export" size="sm" variant="secondary" disabled={rows.length === 0} onClick={() => downloadCsv(csvFileName('platform-audit'), buildCsv(rows, AUDIT_CSV))}>
              <Download />
              Export CSV
            </Button>
          </div>

          {result.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : result.isError ? (
            <ErrorState message={result.error.message} onRetry={() => result.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title="No entries" body={active ? 'Nothing matches these filters.' : 'Platform actions will show up here.'} />
          ) : (
            <div className="overflow-x-auto">
              <table id="audit-table" className="w-full min-w-[64rem] text-[0.8125rem]">
                <thead className="bg-sunken/70 text-xs text-muted">
                  <tr>
                    <th className="w-8 px-2 py-2.5" aria-label="Details" />
                    <th className="px-3 py-2.5 text-start font-medium">When</th>
                    <th className="px-3 py-2.5 text-start font-medium">Who</th>
                    <th className="px-3 py-2.5 text-start font-medium">Action</th>
                    <th className="px-3 py-2.5 text-start font-medium">Company</th>
                    <th className="px-3 py-2.5 text-start font-medium">Summary</th>
                    <th className="px-3 py-2.5 text-start font-medium">Reason</th>
                    <th className="px-3 py-2.5 text-start font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const expanded = open.has(e.id)
                    const toggle = () =>
                      setOpen((s) => {
                        const n = new Set(s)
                        if (n.has(e.id)) n.delete(e.id)
                        else n.add(e.id)
                        return n
                      })
                    return (
                      <Fragment key={e.id}>
                        <tr data-audit-id={e.id} data-action={e.action} className="border-t border-line align-top hover:bg-hover/50">
                          <td className="px-2 py-2">
                            <Button size="xs" variant="ghost" iconOnly aria-label={expanded ? 'Hide changes' : 'Show changes'} aria-expanded={expanded} data-expand={e.id} onClick={toggle}>
                              {expanded ? <ChevronDown /> : <ChevronRight className="rtl:-scale-x-100" />}
                            </Button>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-muted" title={e.at}>
                            {fmtDateTime(e.at)}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-medium whitespace-nowrap text-ink">{e.actorName}</p>
                            <p className="text-xs whitespace-nowrap text-muted">{e.actorRole}</p>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge variant="outline">
                              <span className="font-mono">{e.action}</span>
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            {e.companyId ? (
                              <Link to={platformCompanyPath(e.companyId)} className="text-ink hover:underline">
                                {e.companyName ?? e.companyId}
                              </Link>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="max-w-[20rem] px-3 py-2.5 text-ink-2">{e.summary}</td>
                          <td className="max-w-[16rem] px-3 py-2.5 text-ink-2">{e.reason ?? <span className="text-muted">—</span>}</td>
                          <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted">{e.ip}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-canvas">
                            <td />
                            <td colSpan={7} className="px-3 pb-3">
                              <AuditDiff entry={e} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  )
}

function AuditDiff({ entry }: { entry: PlatformAuditEntry }) {
  const changed = changedKeys(entry.before, entry.after)
  return (
    <div id={`audit-diff-${entry.id}`} className="space-y-2 pt-1">
      {changed.length > 0 && (
        <p className="text-xs text-muted">
          Changed: <span className="font-mono text-ink-2">{changed.join(', ')}</span>
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Before</p>
          <pre dir="ltr" data-diff="before" className="max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink-2">
            {prettyJson(entry.before)}
          </pre>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">After</p>
          <pre dir="ltr" data-diff="after" className="max-h-72 overflow-auto rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink-2">
            {prettyJson(entry.after)}
          </pre>
        </div>
      </div>
    </div>
  )
}
