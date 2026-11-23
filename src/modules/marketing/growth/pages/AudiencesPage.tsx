import { useEffect, useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Download, Lock, Plus, Snowflake, Trash2, UsersRound } from 'lucide-react'
import {
  EMPTY_RULES,
  STATUS_TYPES,
  STATUS_TYPE_LABEL,
  type Audience,
  type AudienceKind,
  type AudienceRules,
} from '@/modules/marketing/growth/types'
import {
  useAudienceOptions,
  useAudienceQuery,
  useAudiencesQuery,
  useCreateAudience,
  useDeleteAudience,
  useFreezeAudience,
  useGrowthAccess,
  useRulesPreview,
  useUpdateAudience,
} from '@/modules/marketing/growth/hooks'
import { exportAudience } from '@/modules/marketing/growth/api'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { useLookups } from '@/shared/hooks/useLookups'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextInput } from '@/shared/components/form/Field'
import type { EventPresence } from '@/modules/marketing/growth/types'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

export default function AudiencesPage() {
  const { canView } = useGrowthAccess()
  if (!canView) return <NoMarketingAccess what="Audiences" />
  return <AudienceList />
}

const col = createColumnHelper<Audience>()

function AudienceList() {
  const { canEdit } = useGrowthAccess()
  const query = useAudiencesQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [open, setOpen] = useState<string | 'new' | null>(null)
  useNewParam(() => setOpen('new'), { when: canEdit })
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: 'Audience',
        enableHiding: false,
        meta: { width: 320 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            {row.original.description && <p className="truncate text-xs text-muted">{row.original.description}</p>}
          </div>
        ),
      }),
      col.accessor('kind', {
        header: 'Type',
        cell: ({ row }) =>
          row.original.kind === 'static' ? (
            <Badge tone="sky" icon={<Snowflake />}>
              Frozen {row.original.frozenAt ? fmtDate(row.original.frozenAt) : ''}
            </Badge>
          ) : (
            <Badge tone="brand">Dynamic</Badge>
          ),
      }),
      col.accessor((r) => r.counts.leads, { id: 'leads', header: 'Leads', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor((r) => r.counts.emails, { id: 'emails', header: 'Emails', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor((r) => r.counts.excludedDnc, { id: 'dnc', header: 'Do Not Contact (left out)', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num text-muted">{getValue()}</span> }),
      col.accessor('updatedAt', { header: 'Updated', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-audiences', data, columns, defaultSorting: [{ id: 'updatedAt', desc: true }], getRowId: (r) => r.id })

  return (
    <>
      <PageHeader
        title="Audiences"
        description="Saved segments of your leads and their contacts. Use them in bulk emails or export them for ad platforms. Do Not Contact leads are always left out."
        actions={
          canEdit && (
            <Button write onClick={() => setOpen('new')}>
              <Plus />
              New audience
            </Button>
          )
        }
      />
      <PageBody>
        <DataTable
          table={table}
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          onRowClick={(row) => setOpen(row.id)}
          empty={
            <EmptyState
              icon={<UsersRound aria-hidden />}
              title="No audiences yet"
              body="Combine industries, statuses, sources, campaigns, events and dates into a segment you can reuse."
              action={
                canEdit ? (
                  <Button write size="sm" onClick={() => setOpen('new')}>
                    <Plus />
                    New audience
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
      <AudienceDrawer id={open} onClose={() => setOpen(null)} onCreated={(id) => setOpen(id)} />
    </>
  )
}

/** Debounced copy of a value (live counts don't query on every keystroke). */
function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

function download(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AudienceDrawer({ id, onClose, onCreated }: { id: string | 'new' | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { canEdit } = useGrowthAccess()
  const lookups = useLookups()
  const options = useAudienceOptions()
  const existing = useAudienceQuery(id && id !== 'new' ? id : '')
  const create = useCreateAudience()
  const update = useUpdateAudience()
  const freeze = useFreezeAudience()
  const remove = useDeleteAudience()
  const toast = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState<AudienceRules>(EMPTY_RULES)
  const [kind, setKind] = useState<AudienceKind>('dynamic')
  const [exporting, setExporting] = useState(false)
  const a = id && id !== 'new' ? existing.data : undefined

  useEffect(() => {
    if (id === 'new') {
      setName('')
      setDescription('')
      setRules(EMPTY_RULES)
      setKind('dynamic')
    }
  }, [id])
  useEffect(() => {
    if (!a) return
    setName(a.name)
    setDescription(a.description)
    setRules(a.rules)
    setKind(a.kind)
  }, [a])

  const debounced = useDebounced(rules)
  const preview = useRulesPreview(debounced, !!id)
  const facet = (key: 'industries' | 'statuses' | 'statusTypes' | 'sources' | 'campaignIds' | 'eventIds' | 'ownerIds', title: string, opts: { value: string; label: string }[]) => (
    <FacetFilter title={title} options={opts} selected={rules[key] as string[]} onChange={(v) => canEdit && setRules((r) => ({ ...r, [key]: v }))} />
  )
  const date = (key: 'createdFrom' | 'createdTo' | 'lastActivityAfter' | 'lastActivityBefore', label: string) => (
    <Field id={`aud-${key}`} label={label}>
      <TextInput id={`aud-${key}`} type="date" value={rules[key] ?? ''} readOnly={!canEdit} onChange={(e) => setRules((r) => ({ ...r, [key]: e.target.value || null }))} />
    </Field>
  )
  const err = (e: unknown) => toast.error('Not saved', (e as Error).message)

  function save() {
    const input = { name, description, rules, kind }
    if (a) update.mutate({ id: a.id, input }, { onSuccess: () => toast.success('Audience saved'), onError: err })
    else
      create.mutate(input, {
        onSuccess: (x) => {
          toast.success(x.kind === 'static' ? `Audience saved with ${x.counts.leads} frozen members` : 'Audience saved')
          onCreated(x.id)
        },
        onError: err,
      })
  }

  async function doExport(hashed: boolean) {
    if (!a) return
    setExporting(true)
    try {
      const file = await exportAudience(a.id, { hashed, includeContacts: true })
      download(file.fileName, file.content)
      toast.success(`${file.rows} ${hashed ? 'hashed emails' : 'emails'} exported`)
    } catch (e) {
      toast.error('Export failed', (e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const live = preview.data
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width="xl"
      title={a ? a.name : 'New audience'}
      description="Leads matching every rule you set (a lead matches a list rule when it has any of the picked values). Empty rules include everyone."
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {a && canEdit && (
            <Button write variant="ghost" onClick={() => remove.mutate(a.id, { onSuccess: () => (toast.info('Audience deleted'), onClose()), onError: err })}>
              <Trash2 />
              Delete
            </Button>
          )}
          {a && canEdit && (
            <Menu
              side="top"
              trigger={(props) => (
                <Button variant="secondary" loading={exporting} {...props}>
                  <Download />
                  Export CSV
                </Button>
              )}
            >
              <MenuItem onSelect={() => void doExport(false)} hint="email">
                Plain emails
              </MenuItem>
              <MenuItem onSelect={() => void doExport(true)} hint="SHA-256">
                Hashed emails (ads platforms)
              </MenuItem>
            </Menu>
          )}
          {a && canEdit && (
            <Button write variant="secondary" loading={freeze.isPending} onClick={() => freeze.mutate(a.id, { onSuccess: (x) => toast.success(`Frozen: ${x.counts.leads} members`), onError: err })}>
              <Snowflake />
              {a.kind === 'static' ? 'Re-freeze from rules' : 'Freeze members'}
            </Button>
          )}
          <Button variant="secondary" className="ms-auto" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button write loading={create.isPending || update.isPending} disabled={!name.trim()} onClick={save}>
              Save audience
            </Button>
          )}
        </div>
      }
    >
      {id !== 'new' && existing.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="aud-name" label="Name" required>
              <TextInput id="aud-name" value={name} readOnly={!canEdit} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="aud-desc" label="Description">
              <TextInput id="aud-desc" value={description} readOnly={!canEdit} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>

          <section aria-label="Rules" className="space-y-3">
            <h3 className="text-[0.8125rem] font-semibold text-ink">Rules</h3>
            <div className="flex flex-wrap gap-2">
              {facet('industries', 'Industry', lookups.industries.map((i) => ({ value: i.key, label: i.label })))}
              {facet('statuses', 'Status', lookups.statuses.map((s) => ({ value: s.key, label: s.label })))}
              {facet('statusTypes', 'Status type', STATUS_TYPES.map((t) => ({ value: t, label: STATUS_TYPE_LABEL[t] })))}
              {facet('sources', 'Source', lookups.sources.map((s) => ({ value: s.key, label: s.label })))}
              {facet('campaignIds', 'Campaign', (options.data?.campaigns ?? []).map((c) => ({ value: c.id, label: c.name })))}
              {facet('eventIds', 'Event', (options.data?.events ?? []).map((e) => ({ value: e.id, label: e.name })))}
              {rules.eventIds.length > 0 && (
                <SelectInput
                  aria-label="Event presence"
                  className="h-8 w-auto text-xs"
                  disabled={!canEdit}
                  value={rules.eventPresence ?? 'any'}
                  onChange={(e) => setRules((r) => ({ ...r, eventPresence: e.target.value as EventPresence }))}
                >
                  <option value="any">Registered (any)</option>
                  <option value="attended">Attended (checked in)</option>
                  <option value="no_show">Registered, no-show</option>
                </SelectInput>
              )}
              {facet('ownerIds', 'Owner', (options.data?.owners ?? []).map((o) => ({ value: o.id, label: o.name })))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {date('createdFrom', 'Created from')}
              {date('createdTo', 'Created to')}
              {date('lastActivityAfter', 'Last activity on or after')}
              {date('lastActivityBefore', 'Last activity before')}
            </div>
            <Switch id="aud-has-email" checked={rules.hasEmail} disabled={!canEdit} onChange={(v) => setRules((r) => ({ ...r, hasEmail: v }))} label="Only leads with an email address" />
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <Lock className="size-3.5" aria-hidden />
              Do Not Contact leads are always excluded — no rule can include them.
            </p>
          </section>

          <section aria-label="Membership" className="space-y-2">
            <h3 className="text-[0.8125rem] font-semibold text-ink">Membership</h3>
            <Segmented
              label="Audience type"
              value={kind}
              onChange={(k) => canEdit && setKind(k)}
              options={[
                { value: 'dynamic', label: 'Dynamic (rules applied each time)' },
                { value: 'static', label: 'Static (freeze members)' },
              ]}
            />
            {a?.kind === 'static' && (
              <p className="text-xs text-muted">
                Frozen on {fmtDate(a.frozenAt, 'd MMM yyyy, HH:mm')} with <span className="num font-medium text-ink">{a.counts.leads}</span> leads. Changing the rules doesn’t change the members until you re-freeze.
              </p>
            )}
          </section>

          <section aria-label="Live count" className="rounded-lg border border-line p-4" aria-live="polite">
            {live ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <p className="text-[0.8125rem] text-muted">
                    <span data-testid="audience-live-count" className="num text-[1.5rem] font-semibold text-ink">
                      {live.counts.leads.toLocaleString()}
                    </span>{' '}
                    leads match the rules now
                  </p>
                  <p className="text-[0.8125rem] text-muted">
                    <span className="num font-medium text-ink">{live.counts.emails.toLocaleString()}</span> email addresses (with contacts)
                  </p>
                  <p className="text-[0.8125rem] text-muted">
                    <span className="num font-medium text-ink">{live.counts.excludedDnc}</span> Do Not Contact left out
                  </p>
                </div>
                {live.members.length > 0 && (
                  <ul className="mt-3 max-h-64 divide-y divide-line overflow-auto rounded-lg border border-line" aria-label="Preview">
                    {live.members.slice(0, 20).map((m) => (
                      <li key={m.leadId} className="flex items-center gap-3 px-3 py-2 text-[0.8125rem]">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-ink">{m.company}</span>
                          <span className="text-muted"> · {m.name}</span>
                        </span>
                        <span className="hidden truncate text-muted sm:inline">{m.email}</span>
                        <Badge tone="neutral">{lookups.statusLabel(m.status)}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Skeleton className="h-16" />
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
