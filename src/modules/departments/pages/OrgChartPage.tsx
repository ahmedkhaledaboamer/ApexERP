import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, ChevronUp, Download, ImageDown, List, Network, Printer, SearchX } from 'lucide-react'
import type { OrgNode } from '@/modules/departments/types'
import { useOrgChartQuery } from '@/modules/departments/hooks/useDepartments'
import { buildTree, filterFlat, pathTo, walk, type TreeNode } from '@/modules/departments/lib/tree'
import { OrgChartCanvas, type OrgChartHandle } from '@/modules/departments/components/OrgChartCanvas'
import { PATHS } from '@/app/paths'
import { scopeOf } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuLabel } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, Switch } from '@/shared/components/form/Field'

/** Large charts open with deeper levels folded so the first view stays readable. */
const AUTO_COLLAPSE_OVER = 40
const byName = (a: OrgNode, b: OrgNode) => a.name.localeCompare(b.name)

export default function OrgChartPage() {
  const user = useCurrentUser()
  const toast = useToast()
  const chart = useOrgChartQuery()
  const canvas = useRef<OrgChartHandle>(null)

  const [showInactive, setShowInactive] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null)
  const [exporting, setExporting] = useState(false)

  const all = useMemo(() => chart.data ?? [], [chart.data])
  const nodes = useMemo(() => (showInactive ? all : filterFlat(all, (n) => n.active)), [all, showInactive])
  const forest = useMemo(() => buildTree(nodes, byName), [nodes])
  const inactiveCount = all.filter((n) => !n.active).length
  const people = nodes.reduce((s, n) => s + n.memberCount, 0)

  // Fold levels below the second on first load of a large chart.
  const folded = useRef(false)
  useEffect(() => {
    if (folded.current || !chart.data) return
    folded.current = true
    if (chart.data.length > AUTO_COLLAPSE_OVER) setCollapsed(new Set(parentsAtDepth(buildTree(chart.data, byName), 1)))
  }, [chart.data])

  /* ---- Search ---- */
  const q = query.trim().toLowerCase()
  const matchList = useMemo(() => {
    if (!q) return []
    const out: string[] = []
    walk(forest, (t) => {
      if (t.node.name.toLowerCase().includes(q) || t.node.head?.name.toLowerCase().includes(q)) out.push(t.node.id)
    })
    return out
  }, [forest, q])
  const matches = useMemo(() => new Set(matchList), [matchList])
  const currentMatch = matchList.length ? matchList[Math.min(matchIndex, matchList.length - 1)] : null

  function focusNode(id: string) {
    // Unfold the ancestors so the card is rendered, then centre it after the next paint.
    const ancestors = pathTo(id, nodes).slice(0, -1).map((n) => n.id)
    setCollapsed((prev) => {
      if (!ancestors.some((a) => prev.has(a))) return prev
      const next = new Set(prev)
      ancestors.forEach((a) => next.delete(a))
      return next
    })
    setFocusRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }))
  }

  useEffect(() => {
    if (!focusRequest) return
    const raf = requestAnimationFrame(() => canvas.current?.centerOn(focusRequest.id))
    return () => cancelAnimationFrame(raf)
  }, [focusRequest])

  function onQuery(value: string) {
    setQuery(value)
    setMatchIndex(0)
  }

  // Centre the first result as the query changes.
  useEffect(() => {
    if (matchList.length) focusNode(matchList[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function step(delta: number) {
    if (!matchList.length) return
    const next = (Math.min(matchIndex, matchList.length - 1) + delta + matchList.length) % matchList.length
    setMatchIndex(next)
    focusNode(matchList[next])
  }

  /* ---- Expand / collapse ---- */
  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function expandAll() {
    setCollapsed(new Set())
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()))
  }
  function collapseAll() {
    setCollapsed(new Set(parentsAtDepth(forest, 1)))
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.current?.fit()))
  }

  /* ---- Export ---- */
  async function exportPng() {
    const content = canvas.current?.contentEl()
    const viewport = canvas.current?.viewportEl()
    if (!content || !viewport) return
    setExporting(true)
    try {
      const { toPng } = await import('html-to-image')
      const backgroundColor = getComputedStyle(viewport).backgroundColor || getComputedStyle(document.body).backgroundColor
      const largest = Math.max(content.offsetWidth, content.offsetHeight)
      const options = {
        backgroundColor,
        pixelRatio: Math.max(1, Math.min(2, 16000 / Math.max(1, largest))),
        cacheBust: true,
        // Open-branch toggles are screen-only chrome; folded ones (“+3”) tell the reader something is hidden.
        filter: (el: HTMLElement) => !(el.classList?.contains('oc-toggle') && el.getAttribute('aria-expanded') === 'true'),
      }
      let url: string
      try {
        url = await toPng(content, options)
      } catch {
        // Web fonts can fail to embed (offline, blocked CDN): retry with system fonts.
        url = await toPng(content, { ...options, skipFonts: true })
      }
      const a = document.createElement('a')
      a.href = url
      a.download = 'company-structure.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast.success('Image downloaded', collapsed.size ? 'Folded branches are shown folded. Expand all first to include everything.' : 'company-structure.png')
    } catch {
      toast.error('Couldn’t create the image', 'Try again, or use Print instead.')
    } finally {
      setExporting(false)
    }
  }

  function print() {
    toast.info('Choose “Save as PDF” in the print dialog to keep a copy')
    window.setTimeout(() => window.print(), 150)
  }

  if (!user) return null
  const scope = scopeOf(user.role, 'departments')

  return (
    <>
      <PrintStyles />
      <PageHeader
        className="print:hidden"
        title="Company structure"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {scope !== 'full' && (
              <Badge tone={scope === 'team' ? 'blue' : 'neutral'}>{scope === 'team' ? 'Your departments' : 'Your department'}</Badge>
            )}
            <span className="text-[0.875rem]">
              {scope === 'full'
                ? 'Every department, who heads it and how many people it has. Click a department to open it.'
                : 'Your part of the company, with the departments above it for context. Click a department to open it.'}
            </span>
          </span>
        }
        actions={
          <>
            <Link
              to={PATHS.departments}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-[0.8125rem] font-medium text-ink shadow-xs transition-colors hover:bg-hover focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none [&_svg]:size-4"
            >
              <List aria-hidden />
              List view
            </Link>
            <Menu
              className="w-60"
              trigger={(props) => (
                <Button {...props} loading={exporting} disabled={!forest.length}>
                  <Download />
                  Export
                  <ChevronDown />
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Print / export as image</MenuLabel>
                  <MenuItem
                    icon={<ImageDown />}
                    hint="PNG"
                    onSelect={() => {
                      close()
                      void exportPng()
                    }}
                  >
                    Download image
                  </MenuItem>
                  <MenuItem
                    icon={<Printer />}
                    hint="Fits one page"
                    onSelect={() => {
                      close()
                      print()
                    }}
                  >
                    Print
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      />

      <PageBody className="space-y-4 print:p-0">
        {/* Print-only title block */}
        <div className="hidden border-b border-line pb-3 print:block">
          <p className="text-xs text-muted">Apex Aora · Company structure</p>
          <p className="mt-1 text-[0.8125rem] text-ink-2">
            {nodes.length} departments · {people} people · Generated {format(new Date(), 'd MMM yyyy, HH:mm')} by {user.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-sm">
            <SearchInput
              className="min-w-0 flex-1"
              placeholder="Find a department or head…"
              aria-label="Find a department"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  step(e.shiftKey ? -1 : 1)
                } else if (e.key === 'Escape' && query) {
                  e.preventDefault()
                  onQuery('')
                }
              }}
            />
            {q && (
              <>
                <span className="num shrink-0 text-xs text-muted" role="status" aria-live="polite">
                  {matchList.length ? `${Math.min(matchIndex, matchList.length - 1) + 1} of ${matchList.length}` : 'No match'}
                </span>
                <Button variant="ghost" size="sm" iconOnly aria-label="Previous match" disabled={matchList.length < 2} onClick={() => step(-1)}>
                  <ChevronUp />
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label="Next match" disabled={matchList.length < 2} onClick={() => step(1)}>
                  <ChevronDown />
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
            <label className={cn('flex h-8 items-center gap-2 rounded-md px-1.5 text-[0.8125rem] text-ink-2', !inactiveCount && 'opacity-60')}>
              <Switch checked={showInactive} onChange={setShowInactive} label="Show inactive departments" disabled={!inactiveCount} />
              Show inactive
              {inactiveCount > 0 && <span className="num text-xs text-muted">({inactiveCount})</span>}
            </label>
            <Button variant="secondary" size="sm" onClick={expandAll} disabled={!collapsed.size}>
              <ChevronsUpDown />
              Expand all
            </Button>
            <Button variant="secondary" size="sm" onClick={collapseAll} disabled={!forest.some((r) => r.children.some((c) => c.children.length))}>
              <ChevronsDownUp />
              Collapse all
            </Button>
          </div>
        </div>

        {chart.isPending ? (
          <ChartSkeleton />
        ) : chart.isError ? (
          <Card>
            <ErrorState message={chart.error.message} onRetry={() => chart.refetch()} />
          </Card>
        ) : !forest.length ? (
          <Card>
            <EmptyState
              icon={<Network aria-hidden />}
              title={all.length ? 'Only inactive departments' : 'No departments yet'}
              body={
                all.length
                  ? 'Every department you can see is inactive. Turn on “Show inactive” to see them.'
                  : scope === 'full'
                    ? 'Create the first department to start building the company structure.'
                    : 'You’re not in a department yet. Ask HR or an administrator to add you to one.'
              }
              action={
                all.length ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowInactive(true)}>
                    Show inactive
                  </Button>
                ) : scope === 'full' ? (
                  <Link to={PATHS.departments} className="text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300">
                    Go to Departments
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <OrgChartCanvas
            ref={canvas}
            forest={forest}
            collapsed={collapsed}
            onToggle={toggle}
            matches={matches}
            currentMatch={currentMatch}
            className="h-[calc(100dvh-17rem)] min-h-[24rem] print:h-auto print:min-h-0"
            overlay={
              <span className="rounded-md bg-surface/90 px-2 py-1 text-xs text-muted shadow-xs ring-1 ring-line backdrop-blur-sm">
                <span className="num font-medium text-ink-2">{nodes.length}</span> departments ·{' '}
                <span className="num font-medium text-ink-2">{people}</span> people
              </span>
            }
          />
        )}
        {q && !matchList.length && forest.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-muted print:hidden">
            <SearchX aria-hidden className="size-3.5" />
            No department or head matches “{query.trim()}”{!showInactive && inactiveCount ? ' (inactive departments are hidden)' : ''}.
          </p>
        )}
      </PageBody>
    </>
  )
}

/** Ids of nodes at `depth` or deeper that have children. */
function parentsAtDepth(forest: TreeNode<OrgNode>[], depth: number): string[] {
  const out: string[] = []
  walk(forest, (t) => {
    if (t.depth >= depth && t.children.length) out.push(t.node.id)
  })
  return out
}

function ChartSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading company structure" className="flex h-[calc(100dvh-17rem)] min-h-[24rem] flex-col items-center gap-10 rounded-card border border-line bg-canvas p-8">
      <Skeleton className="h-28 w-60 rounded-xl" />
      <div className="flex gap-5">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className={cn('h-28 w-60 rounded-xl', i === 2 && 'hidden sm:block', i === 1 && 'hidden min-[36rem]:block')} />
        ))}
      </div>
    </div>
  )
}
