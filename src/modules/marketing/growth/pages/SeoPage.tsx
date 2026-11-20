import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createColumnHelper } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, FileSearch, Gauge, Globe, Info, KeyRound, Minus, Plus, Trash2, Upload, Users, XCircle } from 'lucide-react'
import { addMonths, format, startOfMonth } from 'date-fns'
import {
  PAGE_TYPES,
  PAGE_TYPE_LABEL,
  SITE_PAGE_STATUSES,
  SITE_PAGE_STATUS_LABEL,
  type Keyword,
  type KeywordImportResult,
  type KeywordImportRow,
  type PageType,
  type SeoCheck,
  type SitePage,
  type SitePageStatus,
} from '@/modules/marketing/growth/types'
import { META_MAX, META_MIN, pathOf, seoChecks, seoScore, TITLE_MAX, TITLE_MIN } from '@/modules/marketing/growth/seoChecks'
import { parseKeywordCsv } from '@/modules/marketing/growth/csv'
import {
  useAddKeywordPosition,
  useCreateKeyword,
  useCreateSitePage,
  useDeleteKeyword,
  useDeleteSitePage,
  useGrowthAccess,
  useImportKeywords,
  useKeywordsQuery,
  useSitePagesQuery,
  useUpdateKeyword,
  useUpdateSitePage,
  useWebsiteLeads,
} from '@/modules/marketing/growth/hooks'
import { CHECK_TONE, ScoreBadge } from '@/modules/marketing/growth/components/bits'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { leadPath } from '@/app/paths'
import { AXIS_TICK, C, CURSOR, Legend, LegendRow, TOOLTIP_STYLE } from '@/modules/reports/components/chartKit'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Segmented } from '@/shared/components/ui/Segmented'
import { StatCard } from '@/shared/components/ui/StatCard'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, useDataTable } from '@/shared/components/data-table'

type Tab = 'pages' | 'keywords' | 'leads'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pages', label: 'Site pages' },
  { id: 'keywords', label: 'Keyword tracker' },
  { id: 'leads', label: 'Website leads' },
]

export default function SeoPage() {
  const { canView } = useGrowthAccess()
  if (!canView) return <NoMarketingAccess what="Website & SEO" />
  return <Seo />
}

function Seo() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'pages') as Tab
  return (
    <>
      <PageHeader title="Website & SEO" description="Your site’s pages with automatic on-page checks, the keywords you track and the leads your website brings." />
      <PageBody className="space-y-6">
        <p className="flex items-start gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[0.8125rem] text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          Nothing here crawls your website or connects to Google: you add pages and their tags, enter keyword positions or import a Search Console export. Checks run when you save.
        </p>
        <Tabs label="Website & SEO" items={TABS} value={tab} onChange={(t) => setParams(t === 'pages' ? {} : { tab: t }, { replace: true })} />
        <div role="tabpanel" id={`tab-panel-${tab}`}>
          {tab === 'pages' ? <PagesTab /> : tab === 'keywords' ? <KeywordsTab /> : <LeadsTab />}
        </div>
      </PageBody>
    </>
  )
}

/* ---------------- Site pages ---------------- */

const pageCol = createColumnHelper<SitePage>()
const issues = (p: SitePage) => ({ fail: p.checks.filter((c) => c.status === 'fail').length, warn: p.checks.filter((c) => c.status === 'warn').length })

function PagesTab() {
  const { canEdit } = useGrowthAccess()
  const query = useSitePagesQuery()
  const pages = useMemo(() => query.data?.pages ?? [], [query.data])
  const summary = query.data?.summary
  const [open, setOpen] = useState<SitePage | 'new' | null>(null)
  const columns = useMemo(
    () => [
      pageCol.accessor((p) => pathOf(p.url), {
        id: 'url',
        header: 'Page',
        enableHiding: false,
        meta: { width: 340 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-mono text-[0.8125rem] text-ink">{pathOf(row.original.url)}</p>
            <p className="truncate text-xs text-muted">{row.original.title || 'No title'}</p>
          </div>
        ),
      }),
      pageCol.accessor('pageType', { header: 'Type', cell: ({ getValue }) => <span className="text-ink-2">{PAGE_TYPE_LABEL[getValue()]}</span> }),
      pageCol.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge tone={getValue() === 'published' ? 'green' : getValue() === 'draft' ? 'neutral' : 'amber'} variant="dot">
            {SITE_PAGE_STATUS_LABEL[getValue()]}
          </Badge>
        ),
      }),
      pageCol.accessor('score', { header: 'SEO score', meta: { align: 'end' }, cell: ({ getValue }) => <ScoreBadge score={getValue()} /> }),
      pageCol.accessor((p) => issues(p).fail * 100 + issues(p).warn, {
        id: 'issues',
        header: 'Issues',
        cell: ({ row }) => {
          const n = issues(row.original)
          return (
            <span className="flex gap-1.5 whitespace-nowrap">
              {n.fail > 0 && <Badge tone="red">{n.fail} failing</Badge>}
              {n.warn > 0 && <Badge tone="amber">{n.warn} warnings</Badge>}
              {!n.fail && !n.warn && <Badge tone="green">All good</Badge>}
            </span>
          )
        },
      }),
      pageCol.accessor('updatedAt', { header: 'Last updated', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-seo-pages', data: pages, columns, defaultSorting: [{ id: 'score', desc: false }], getRowId: (r) => r.id })

  return (
    <div className="space-y-6">
      {!summary ? (
        <Skeleton className="h-[7.75rem] rounded-card" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Pages" value={summary.pages} hint="Added by your team" icon={<Globe aria-hidden />} />
          <StatCard label="Average SEO score" value={summary.averageScore ?? '—'} hint="Pass 1, warning ½, fail 0" icon={<Gauge aria-hidden />} />
          <StatCard label="Pages with failing checks" value={summary.pagesWithIssues} hint={`${summary.failing} failing checks`} alert={summary.pagesWithIssues > 0} icon={<XCircle aria-hidden />} />
          <StatCard label="Warnings" value={summary.warnings} hint="Worth fixing" icon={<AlertTriangle aria-hidden />} />
        </div>
      )}
      {summary && summary.byCheck.length > 0 && (
        <Card>
          <CardHeader title="Site summary" description="How many pages fail or warn on each check." />
          <CardBody>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Checks across the site">
              {summary.byCheck.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[0.8125rem]">
                  <span className="truncate text-ink-2">{c.label}</span>
                  <span className="flex shrink-0 gap-1.5">
                    {c.fail > 0 && <Badge tone="red">{c.fail} fail</Badge>}
                    {c.warn > 0 && <Badge tone="amber">{c.warn} warn</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(row) => setOpen(row)}
        toolbar={
          canEdit && (
            <Button write size="sm" className="ms-auto" onClick={() => setOpen('new')}>
              <Plus />
              Add page
            </Button>
          )
        }
        empty={<EmptyState icon={<FileSearch aria-hidden />} title="No pages yet" body="Add your website’s pages with their title, meta description, H1 and target keyword. We check them on every save — we don’t crawl your site." />}
      />
      <SitePageDrawer page={open} pages={pages} onClose={() => setOpen(null)} />
    </div>
  )
}

const CHECK_ICON = { pass: CheckCircle2, warn: AlertTriangle, fail: XCircle }

function CheckList({ checks }: { checks: SeoCheck[] }) {
  return (
    <ul className="space-y-1.5" aria-label="SEO checks">
      {checks.map((c) => {
        const Icon = CHECK_ICON[c.status]
        return (
          <li key={c.key} data-check={c.key} data-status={c.status} className="flex items-start gap-2 text-[0.8125rem]">
            <Icon className={cn('mt-0.5 size-4 shrink-0', c.status === 'pass' ? 'text-success-600' : c.status === 'warn' ? 'text-warning-600' : 'text-danger-600')} aria-hidden />
            <span className="min-w-0">
              <span className="font-medium text-ink">{c.label}</span>
              <span className="text-muted"> — {c.detail}</span>
            </span>
            <Badge tone={CHECK_TONE[c.status]} className="ms-auto shrink-0">
              {c.status === 'pass' ? 'Pass' : c.status === 'warn' ? 'Warning' : 'Fail'}
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}

function SitePageDrawer({ page, pages, onClose }: { page: SitePage | 'new' | null; pages: SitePage[]; onClose: () => void }) {
  const { canEdit } = useGrowthAccess()
  const create = useCreateSitePage()
  const update = useUpdateSitePage()
  const remove = useDeleteSitePage()
  const toast = useToast()
  const existing = page && page !== 'new' ? page : null
  const blank = { url: '', title: '', metaDescription: '', h1: '', targetKeyword: '', pageType: 'other' as PageType, status: 'published' as SitePageStatus }
  const [v, setV] = useState(blank)
  useEffect(() => {
    if (!page) return
    setV(existing ? { url: existing.url, title: existing.title, metaDescription: existing.metaDescription, h1: existing.h1, targetKeyword: existing.targetKeyword, pageType: existing.pageType, status: existing.status } : blank)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }))
  // Live hint: the same checks the server runs on save, against the other pages.
  const checks = useMemo(() => seoChecks({ ...v, id: existing?.id }, pages), [v, pages, existing?.id])
  const err = (e: unknown) => toast.error('Not saved', (e as Error).message)

  function save(e: FormEvent) {
    e.preventDefault()
    const done = { onSuccess: () => (toast.success('Page saved — SEO checks updated'), onClose()), onError: err }
    if (existing) update.mutate({ id: existing.id, input: v }, done)
    else create.mutate(v, done)
  }
  const counter = (n: number, min: number, max: number) => (
    <span className={cn('num', n === 0 ? 'text-muted' : n < min || n > max ? 'text-warning-600' : 'text-success-600')}>
      {n} / {min}–{max}
    </span>
  )

  return (
    <Drawer
      open={!!page}
      onClose={onClose}
      width="xl"
      title={existing ? pathOf(existing.url) : 'Add page'}
      description="Copy the tags from your page’s HTML. The checks below update as you type and are stored when you save."
      footer={
        canEdit && (
          <div className="flex w-full items-center gap-2">
            {existing && (
              <Button write variant="ghost" onClick={() => remove.mutate(existing.id, { onSuccess: () => (toast.info('Page removed'), onClose()), onError: err })}>
                <Trash2 />
                Remove
              </Button>
            )}
            <Button variant="secondary" className="ms-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button write type="submit" form="seo-page-form" loading={create.isPending || update.isPending}>
              Save page
            </Button>
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <form id="seo-page-form" onSubmit={save} className="space-y-4">
          <Field id="sp-url" label="URL" required hint="Full address or a path starting with /.">
            <TextInput id="sp-url" value={v.url} readOnly={!canEdit} placeholder="https://yourcompany.com/services/…" onChange={(e) => set('url', e.target.value)} />
          </Field>
          <Field id="sp-title" label="Title tag">
            <TextInput id="sp-title" value={v.title} readOnly={!canEdit} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <p className="-mt-3 text-end text-xs">{counter(v.title.trim().length, TITLE_MIN, TITLE_MAX)}</p>
          <Field id="sp-meta" label="Meta description">
            <TextArea id="sp-meta" rows={3} value={v.metaDescription} readOnly={!canEdit} onChange={(e) => set('metaDescription', e.target.value)} />
          </Field>
          <p className="-mt-3 text-end text-xs">{counter(v.metaDescription.trim().length, META_MIN, META_MAX)}</p>
          <Field id="sp-h1" label="H1 heading">
            <TextInput id="sp-h1" value={v.h1} readOnly={!canEdit} onChange={(e) => set('h1', e.target.value)} />
          </Field>
          <Field id="sp-keyword" label="Target keyword">
            <TextInput id="sp-keyword" value={v.targetKeyword} readOnly={!canEdit} onChange={(e) => set('targetKeyword', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="sp-type" label="Page type">
              <SelectInput id="sp-type" value={v.pageType} disabled={!canEdit} onChange={(e) => set('pageType', e.target.value as PageType)}>
                {PAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PAGE_TYPE_LABEL[t]}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field id="sp-status" label="Status">
              <SelectInput id="sp-status" value={v.status} disabled={!canEdit} onChange={(e) => set('status', e.target.value as SitePageStatus)}>
                {SITE_PAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SITE_PAGE_STATUS_LABEL[s]}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        </form>
        <aside className="h-fit space-y-3 rounded-lg border border-line p-4" aria-label="SEO checks preview">
          <div className="flex items-center justify-between">
            <h3 className="text-[0.8125rem] font-semibold text-ink">SEO checks</h3>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              Score <ScoreBadge score={seoScore(checks)} />
            </span>
          </div>
          <CheckList checks={checks} />
        </aside>
      </div>
    </Drawer>
  )
}

/* ---------------- Keywords ---------------- */

const kwCol = createColumnHelper<Keyword>()

function Change({ k }: { k: Keyword }) {
  if (k.change === null) return <span className="text-muted">—</span>
  if (k.change === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-muted">
        <Minus className="size-3.5" aria-hidden />0
      </span>
    )
  const up = k.change > 0
  return (
    <span className={cn('num inline-flex items-center gap-0.5 font-medium', up ? 'text-success-600' : 'text-danger-600')} aria-label={up ? `Up ${k.change}` : `Down ${-k.change}`}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
      {Math.abs(k.change)}
    </span>
  )
}

function Spark({ k }: { k: Keyword }) {
  const data = k.positions.slice(-12).map((p) => ({ date: p.date, position: p.position }))
  if (data.length < 2) return <span className="text-xs text-muted">—</span>
  return (
    <div className="h-8 w-28" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <YAxis hide reversed domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="position" stroke={C.brand} strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function KeywordsTab() {
  const { canEdit } = useGrowthAccess()
  const query = useKeywordsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const columns = useMemo(
    () => [
      kwCol.accessor('keyword', {
        header: 'Keyword',
        enableHiding: false,
        meta: { width: 280 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.keyword}</p>
            <p className="truncate font-mono text-xs text-muted">{row.original.targetUrl ? pathOf(row.original.targetUrl) : 'No target URL'}</p>
          </div>
        ),
      }),
      kwCol.accessor('country', { header: 'Country' }),
      kwCol.accessor('searchVolume', { header: 'Volume', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue()?.toLocaleString() ?? '—'}</span> }),
      kwCol.accessor('difficulty', { header: 'Difficulty', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue() ?? '—'}</span> }),
      kwCol.accessor((k) => k.currentPosition ?? 9999, {
        id: 'current',
        header: 'Position',
        meta: { align: 'end' },
        cell: ({ row }) => <span className="num font-medium text-ink">{row.original.currentPosition ?? (row.original.positions.length ? 'Not ranking' : '—')}</span>,
      }),
      kwCol.accessor((k) => k.previousPosition ?? 9999, { id: 'previous', header: 'Previous', meta: { align: 'end' }, cell: ({ row }) => <span className="num text-muted">{row.original.previousPosition ?? '—'}</span> }),
      kwCol.accessor((k) => k.change ?? 0, { id: 'change', header: 'Change', meta: { align: 'end' }, cell: ({ row }) => <Change k={row.original} /> }),
      kwCol.display({ id: 'trend', header: 'Trend', cell: ({ row }) => <Spark k={row.original} /> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-seo-keywords', data, columns, defaultSorting: [{ id: 'current', desc: false }], getRowId: (r) => r.id })

  return (
    <>
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(row) => setOpen(row.id)}
        toolbar={
          canEdit && (
            <div className="ms-auto flex gap-2">
              <Button write size="sm" variant="secondary" onClick={() => setImporting(true)}>
                <Upload />
                Import CSV
              </Button>
              <Button write size="sm" onClick={() => setAdding(true)}>
                <Plus />
                Add keyword
              </Button>
            </div>
          )
        }
        empty={<EmptyState icon={<KeyRound aria-hidden />} title="No keywords tracked" body="Add the keywords you want to rank for, then enter positions by hand or import a Search Console export (keyword, date, position)." />}
      />
      <KeywordModal open={adding} onClose={() => setAdding(false)} />
      <ImportModal open={importing} onClose={() => setImporting(false)} />
      <KeywordDrawer keyword={data.find((k) => k.id === open) ?? null} onClose={() => setOpen(null)} />
    </>
  )
}

function KeywordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateKeyword()
  const toast = useToast()
  const [v, setV] = useState({ keyword: '', targetUrl: '', searchVolume: '', difficulty: '', country: '' })
  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        keyword: v.keyword,
        targetUrl: v.targetUrl,
        searchVolume: v.searchVolume ? Number(v.searchVolume) : null,
        difficulty: v.difficulty ? Number(v.difficulty) : null,
        ...(v.country.trim() ? { country: v.country.trim().toUpperCase() } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Keyword added')
          setV({ keyword: '', targetUrl: '', searchVolume: '', difficulty: '', country: '' })
          onClose()
        },
        onError: (err) => toast.error('Not added', (err as Error).message),
      },
    )
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Track a keyword"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="kw-form" loading={create.isPending} disabled={!v.keyword.trim()}>
            Add keyword
          </Button>
        </>
      }
    >
      <form id="kw-form" onSubmit={submit} className="space-y-4">
        <Field id="kw-keyword" label="Keyword" required>
          <TextInput id="kw-keyword" value={v.keyword} onChange={(e) => setV({ ...v, keyword: e.target.value })} autoFocus />
        </Field>
        <Field id="kw-url" label="Target URL">
          <TextInput id="kw-url" value={v.targetUrl} placeholder="https://… or /path" onChange={(e) => setV({ ...v, targetUrl: e.target.value })} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field id="kw-volume" label="Search volume">
            <TextInput id="kw-volume" inputMode="numeric" value={v.searchVolume} onChange={(e) => setV({ ...v, searchVolume: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field id="kw-difficulty" label="Difficulty (0–100)">
            <TextInput id="kw-difficulty" inputMode="numeric" value={v.difficulty} onChange={(e) => setV({ ...v, difficulty: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
          </Field>
          <Field id="kw-country" label="Country" hint="Default: yours">
            <TextInput id="kw-country" maxLength={2} value={v.country} placeholder="AE" onChange={(e) => setV({ ...v, country: e.target.value })} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const imp = useImportKeywords()
  const toast = useToast()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('pasted.csv')
  const [result, setResult] = useState<KeywordImportResult | null>(null)
  const rows: KeywordImportRow[] = useMemo(() => (text.trim() ? parseKeywordCsv(text) : []), [text])
  const close = () => {
    setText('')
    setResult(null)
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Import keyword positions"
      description="A CSV with keyword, date and position columns — e.g. a Google Search Console export. Unknown keywords are added; a date already stored is replaced."
      size="md"
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              write
              disabled={!rows.length}
              loading={imp.isPending}
              onClick={() => imp.mutate({ rows, fileName }, { onSuccess: setResult, onError: (err) => toast.error('Import failed', (err as Error).message) })}
            >
              <Upload />
              Import {rows.length ? `${rows.length} rows` : ''}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3" role="status">
          <p className="text-[0.875rem] text-ink" data-testid="keyword-import-result">
            {result.imported} positions imported{result.keywordsCreated ? `, ${result.keywordsCreated} new keywords` : ''}
            {result.failed.length ? `, ${result.failed.length} rows skipped` : ''}.
          </p>
          {result.failed.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-auto text-xs text-danger-600">
              {result.failed.map((f) => (
                <li key={f.row}>
                  Row {f.row} {f.keyword ? `(${f.keyword})` : ''}: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field id="kw-file" label="CSV file">
            <input
              id="kw-file"
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-[0.8125rem] text-ink-2 file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setFileName(f.name)
                setText(await f.text())
              }}
            />
          </Field>
          <Field id="kw-paste" label="…or paste it" hint="keyword,date,position — one row per line; empty position = not ranking.">
            <TextArea id="kw-paste" rows={6} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'keyword,date,position\nai chatbot dubai,2026-11-01,7.4'} />
          </Field>
          {rows.length > 0 && <p className="text-xs text-muted">{rows.length} rows ready.</p>}
        </div>
      )}
    </Modal>
  )
}

function KeywordDrawer({ keyword, onClose }: { keyword: Keyword | null; onClose: () => void }) {
  const { canEdit } = useGrowthAccess()
  const add = useAddKeywordPosition()
  const update = useUpdateKeyword()
  const remove = useDeleteKeyword()
  const toast = useToast()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [position, setPosition] = useState('')
  const [url, setUrl] = useState('')
  useEffect(() => setUrl(keyword?.targetUrl ?? ''), [keyword?.id, keyword?.targetUrl])
  const data = (keyword?.positions ?? []).map((p) => ({ date: fmtDate(p.date, 'd MMM'), position: p.position }))
  return (
    <Drawer
      open={!!keyword}
      onClose={onClose}
      width="lg"
      title={keyword?.keyword ?? ''}
      description={keyword ? `${keyword.country} · volume ${keyword.searchVolume?.toLocaleString() ?? '—'} · difficulty ${keyword.difficulty ?? '—'}` : undefined}
      footer={
        canEdit &&
        keyword && (
          <Button write variant="ghost" onClick={() => remove.mutate(keyword.id, { onSuccess: () => (toast.info('Keyword removed'), onClose()) })}>
            <Trash2 />
            Stop tracking
          </Button>
        )
      }
    >
      {keyword && (
        <div className="space-y-6">
          <section aria-label="Position trend">
            <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">Position trend</h3>
            {data.length < 2 ? (
              <p className="text-[0.8125rem] text-muted">Add at least two positions to see a trend.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                    <YAxis reversed allowDecimals={false} tickLine={false} axisLine={false} width={32} tick={AXIS_TICK} domain={[1, 'dataMax']} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [v ?? 'Not ranking', 'Position']} />
                    <Line type="monotone" dataKey="position" name="Position" stroke={C.brand} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-1 text-xs text-muted">Lower is better (1 = top result). Positions come from your entries and imports.</p>
          </section>
          {canEdit && (
            <form
              className="flex flex-wrap items-end gap-3"
              aria-label="Add a position"
              onSubmit={(e) => {
                e.preventDefault()
                add.mutate(
                  { id: keyword.id, date, position: position.trim() ? Number(position) : null },
                  { onSuccess: () => (setPosition(''), toast.success('Position saved')), onError: (err) => toast.error('Not saved', (err as Error).message) },
                )
              }}
            >
              <Field id="kp-date" label="Date">
                <TextInput id="kp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field id="kp-position" label="Position">
                <TextInput id="kp-position" inputMode="decimal" value={position} placeholder="Empty = not ranking" onChange={(e) => setPosition(e.target.value)} className="w-40" />
              </Field>
              <Button write type="submit" variant="secondary" loading={add.isPending}>
                Add position
              </Button>
            </form>
          )}
          {canEdit && (
            <div className="flex items-end gap-3">
              <Field id="kp-url" label="Target URL" className="flex-1">
                <TextInput id="kp-url" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
              <Button
                write
                variant="ghost"
                disabled={url === keyword.targetUrl}
                onClick={() => update.mutate({ id: keyword.id, input: { targetUrl: url } }, { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error('Not saved', (err as Error).message) })}
              >
                Save
              </Button>
            </div>
          )}
          <section aria-label="History">
            <h3 className="mb-2 text-[0.8125rem] font-semibold text-ink">History</h3>
            <ul className="divide-y divide-line rounded-lg border border-line text-[0.8125rem]">
              {[...keyword.positions].reverse().map((p) => (
                <li key={p.date} className="flex justify-between px-3 py-1.5">
                  <span className="num text-muted">{fmtDate(p.date)}</span>
                  <span className="num font-medium text-ink">{p.position ?? 'Not ranking'}</span>
                </li>
              ))}
              {!keyword.positions.length && <li className="px-3 py-2 text-muted">No positions yet.</li>}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  )
}

/* ---------------- Website leads ---------------- */

type Range = '3' | '6' | '12'

function LeadsTab() {
  const [range, setRange] = useState<Range>('12')
  const lookups = useLookups()
  const to = format(new Date(), 'yyyy-MM-dd')
  const from = format(startOfMonth(addMonths(new Date(), -(Number(range) - 1))), 'yyyy-MM-dd')
  const q = useWebsiteLeads(from, to)
  const d = q.data
  const by = (via: 'form' | 'landing' | 'website_source') => d?.bySource.filter((s) => s.kind === via).reduce((s, x) => s + x.leads, 0) ?? 0
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-muted">Leads that came through your forms or landing pages, or with the Website lead source. Each lead counts once.</p>
        <Segmented
          label="Period"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: '3', label: '3 months' },
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
          ]}
        />
      </div>
      {!d ? (
        <Skeleton className="h-64 rounded-card" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Website leads" value={d.total} hint={`${fmtDate(d.from)} – ${fmtDate(d.to)}`} icon={<Users aria-hidden />} />
            <StatCard label="From forms" value={by('form')} hint="Hosted page and embeds" icon={<FileSearch aria-hidden />} />
            <StatCard label="From landing pages" value={by('landing')} hint="/p/ pages" icon={<Globe aria-hidden />} />
            <StatCard label="Website source" value={by('website_source')} hint="Added with the Website source" icon={<KeyRound aria-hidden />} />
          </div>
          <Card>
            <CardHeader title="Per month" />
            <CardBody>
              <LegendRow className="mb-2">
                <Legend color={C.brand} label="Forms" />
                <Legend color={C.blue} label="Landing pages" />
                <Legend color={C.grey} label="Website source" />
              </LegendRow>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.months.map((m) => ({ ...m, label: format(new Date(`${m.month}-01T00:00:00`), 'MMM yy') }))} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--color-line)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                    <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={AXIS_TICK} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="forms" name="Forms" stackId="a" fill={C.brand} maxBarSize={28} />
                    <Bar dataKey="landing" name="Landing pages" stackId="a" fill={C.blue} maxBarSize={28} />
                    <Bar dataKey="websiteSource" name="Website source" stackId="a" fill={C.grey} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="By form and page" />
              <CardBody className="p-0">
                {d.bySource.length === 0 ? (
                  <EmptyState icon={<Globe aria-hidden />} title="No website leads in this period" body="Share a form or a landing page to start counting." />
                ) : (
                  <ul className="divide-y divide-line text-[0.8125rem]" aria-label="Website leads by form and page">
                    {d.bySource.map((s) => (
                      <li key={`${s.kind}:${s.id}`} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                        <Badge tone={s.kind === 'form' ? 'brand' : s.kind === 'landing' ? 'blue' : 'neutral'}>{s.kind === 'form' ? 'Form' : s.kind === 'landing' ? 'Landing page' : 'Source'}</Badge>
                        <span className="num w-16 text-end font-medium text-ink">{s.leads}</span>
                        <span className="num w-16 text-end text-muted">{s.won} won</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Latest website leads" />
              <CardBody className="p-0">
                <ul className="max-h-96 divide-y divide-line overflow-auto text-[0.8125rem]" aria-label="Latest website leads">
                  {d.leads.slice(0, 30).map((l) => (
                    <li key={l.leadId} className="flex items-center gap-3 px-4 py-2.5">
                      <Link to={leadPath(l.leadId)} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                        {l.company}
                        <span className="font-normal text-muted"> · {l.viaName}</span>
                      </Link>
                      <Badge tone={l.won ? 'green' : 'neutral'}>{lookups.statusLabel(l.status)}</Badge>
                      <span className="num w-20 text-end text-muted">{fmtDate(l.createdAt)}</span>
                    </li>
                  ))}
                  {!d.leads.length && <li className="px-4 py-3 text-muted">No leads in this period.</li>}
                </ul>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
