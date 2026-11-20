import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { ExternalLink, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import type { LandingPage } from '@/modules/marketing/growth/types'
import { useCreateLandingPage, useDeleteLandingPage, useFormsQuery, useGrowthAccess, useLandingPagesQuery, useUpdateLandingPage } from '@/modules/marketing/growth/hooks'
import { CopyField, usePublicUrls } from '@/modules/marketing/growth/components/bits'
import { publicLandingPath } from '@/modules/marketing/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, Switch, TextArea, TextInput } from '@/shared/components/form/Field'
import { DataTable, useDataTable } from '@/shared/components/data-table'

const col = createColumnHelper<LandingPage>()

/** Lead generation › Landing pages: simple hosted pages (/p/:slug) with an embedded form. */
export function LandingPagesTab() {
  const { canEdit } = useGrowthAccess()
  const query = useLandingPagesQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [editing, setEditing] = useState<LandingPage | 'new' | null>(null)
  const columns = useMemo(
    () => [
      col.accessor('title', {
        header: 'Page',
        enableHiding: false,
        meta: { width: 320 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.title}</p>
            <p className="truncate font-mono text-xs text-muted">/p/{row.original.slug}</p>
          </div>
        ),
      }),
      col.accessor('published', {
        header: 'Status',
        cell: ({ getValue }) => (
          <Badge tone={getValue() ? 'green' : 'neutral'} variant="dot">
            {getValue() ? 'Published' : 'Draft'}
          </Badge>
        ),
      }),
      col.accessor('formName', { header: 'Form', cell: ({ getValue }) => <span className="text-ink-2">{getValue() ?? '—'}</span> }),
      col.accessor('views', { header: 'Views', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor('submissions', { header: 'Submissions', meta: { align: 'end' }, cell: ({ getValue }) => <span className="num">{getValue().toLocaleString()}</span> }),
      col.accessor('updatedAt', { header: 'Updated', cell: ({ getValue }) => <span className="num whitespace-nowrap text-muted">{fmtDate(getValue())}</span> }),
    ],
    [],
  )
  const table = useDataTable({ id: 'marketing-landing-pages', data, columns, defaultSorting: [{ id: 'updatedAt', desc: true }], getRowId: (r) => r.id })

  return (
    <>
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        onRowClick={(row) => setEditing(row)}
        toolbar={
          canEdit && (
            <Button write size="sm" className="ms-auto" onClick={() => setEditing('new')}>
              <Plus />
              New landing page
            </Button>
          )
        }
        empty={
          <EmptyState
            icon={<LayoutTemplate aria-hidden />}
            title="No landing pages yet"
            body="A landing page is a simple hosted page with a headline, text, an image and one of your forms — ideal as the target of an ad or a UTM link."
          />
        }
      />
      <LandingPageDrawer page={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function LandingPageDrawer({ page, onClose }: { page: LandingPage | 'new' | null; onClose: () => void }) {
  const { canEdit } = useGrowthAccess()
  const forms = useFormsQuery()
  const create = useCreateLandingPage()
  const update = useUpdateLandingPage()
  const remove = useDeleteLandingPage()
  const toast = useToast()
  const urls = usePublicUrls()
  const existing = page && page !== 'new' ? page : null
  const empty = { slug: '', title: '', headline: '', body: '', heroImageUrl: '', formId: '', published: false }
  const [v, setV] = useState(empty)
  useEffect(() => {
    if (!page) return
    setV(existing ? { slug: existing.slug, title: existing.title, headline: existing.headline, body: existing.body, heroImageUrl: existing.heroImageUrl ?? '', formId: existing.formId ?? '', published: existing.published } : empty)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }))
  const input = { ...v, heroImageUrl: v.heroImageUrl.trim() || null, formId: v.formId || null }

  function save(e: FormEvent) {
    e.preventDefault()
    const done = {
      onSuccess: () => {
        toast.success(existing ? 'Landing page saved' : 'Landing page created')
        onClose()
      },
      onError: (err: unknown) => toast.error('Not saved', (err as Error).message),
    }
    if (existing) update.mutate({ id: existing.id, input }, done)
    else create.mutate(input, done)
  }

  const path = v.slug ? publicLandingPath(v.slug) : ''
  return (
    <Drawer
      open={!!page}
      onClose={onClose}
      title={existing ? existing.title : 'New landing page'}
      description="Hosted on your workspace address at /p/your-slug. Slugs are unique within your company."
      footer={
        canEdit && (
          <div className="flex w-full items-center gap-2">
            {existing && (
              <Button
                write
                variant="ghost"
                onClick={() => remove.mutate(existing.id, { onSuccess: () => (toast.info('Landing page deleted'), onClose()), onError: (err) => toast.error('Not deleted', (err as Error).message) })}
              >
                <Trash2 />
                Delete
              </Button>
            )}
            <Button variant="secondary" className="ms-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button write type="submit" form="landing-form" loading={create.isPending || update.isPending}>
              Save page
            </Button>
          </div>
        )
      }
    >
      <form id="landing-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="lp-title" label="Title" required hint="Browser tab and search result title.">
            <TextInput id="lp-title" value={v.title} readOnly={!canEdit} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field id="lp-slug" label="Slug" required hint="Lower-case letters, digits and hyphens.">
            <TextInput id="lp-slug" value={v.slug} readOnly={!canEdit} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
          </Field>
        </div>
        <Field id="lp-headline" label="Headline">
          <TextInput id="lp-headline" value={v.headline} readOnly={!canEdit} onChange={(e) => set('headline', e.target.value)} />
        </Field>
        <Field id="lp-body" label="Body text">
          <TextArea id="lp-body" rows={6} value={v.body} readOnly={!canEdit} onChange={(e) => set('body', e.target.value)} />
        </Field>
        <Field id="lp-hero" label="Hero image URL" hint="Paste an image address from Brand Assets, or leave empty for no image.">
          <TextInput id="lp-hero" value={v.heroImageUrl} readOnly={!canEdit} placeholder="https://…" onChange={(e) => set('heroImageUrl', e.target.value)} />
        </Field>
        <Field id="lp-form" label="Embedded form">
          <SelectInput id="lp-form" value={v.formId} disabled={!canEdit} onChange={(e) => set('formId', e.target.value)}>
            <option value="">No form</option>
            {(forms.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.status === 'paused' ? ' (paused)' : ''}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Switch id="lp-published" checked={v.published} disabled={!canEdit} onChange={(x) => set('published', x)} label="Published (visible at its address)" />
        {existing && path && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <CopyField label="Public address" value={urls.url(publicLandingPath(existing.slug), true)} />
            <a href={urls.url(publicLandingPath(existing.slug), true)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.8125rem] text-brand-600 hover:underline">
              <ExternalLink className="size-3.5" aria-hidden />
              Open the page
            </a>
            {!existing.published && <p className="text-xs text-muted">Unpublished pages answer “not found” to visitors.</p>}
          </div>
        )}
      </form>
    </Drawer>
  )
}
