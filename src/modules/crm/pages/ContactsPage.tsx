import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn, type Table } from '@tanstack/react-table'
import { Contact as ContactIcon, Plus, ShieldOff, Star, X } from 'lucide-react'
import type { Scope } from '@/shared/types'
import { customerPath, leadPath } from '@/app/paths'
import { useContactsQuery, useUpdateContact } from '@/modules/crm/hooks/useCrm'
import type { ContactRow } from '@/modules/crm/types'
import { ContactDrawer } from '@/modules/crm/components/ContactDrawer'
import { useCurrentUser } from '@/store/hooks'
import { can, SCOPE_LABELS, scopeOf } from '@/shared/lib/permissions'
import { formatMobile } from '@/shared/lib/phone'
import { getRegion } from '@/shared/lib/region'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { SearchInput, Switch } from '@/shared/components/form/Field'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { ColumnPicker, DataTable, FacetFilter, useDataTable, type FacetOption } from '@/shared/components/data-table'
import { useNewParam } from '@/shared/hooks/useNewParam'

export default function ContactsPage() {
  const user = useCurrentUser()
  if (!user) return null
  const scope = scopeOf(user.role, 'sales')
  if (scope === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Contacts aren’t part of your role" body={`${user.role} has no access to Sales & CRM. Ask a Company Admin if you need it.`} />
      </PageBody>
    )
  }
  return <ContactsList scope={scope} canEdit={can(user.role, 'sales', 'edit')} />
}

function ContactsList({ scope, canEdit }: { scope: Scope; canEdit: boolean }) {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const query = useContactsQuery()
  const data = useMemo(() => query.data ?? [], [query.data])
  const [drawer, setDrawer] = useState<{ contact: ContactRow | null } | null>(null)
  useNewParam(() => setDrawer({ contact: null }), { when: canEdit })
  const columns = useMemo(() => buildColumns(canEdit), [canEdit])

  const table = useDataTable({
    id: 'crm-contacts',
    data,
    columns,
    globalFilter: search,
    globalFilterFn: contactSearch,
    defaultHidden: ['ownerName'],
    getRowId: (r) => r.id,
  })

  function setSearch(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value)
    else next.delete('q')
    setParams(next, { replace: true })
  }

  const filtered = table.getState().columnFilters.length > 0 || !!search
  const companies = new Set(data.map((c) => c.recordId)).size

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <ContactIcon />
          </IconTile>
        }
        title="Contacts"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{query.data ? `${data.length} people at ${companies} companies` : 'Loading…'}</span>
            <span aria-hidden>·</span>
            <span>{SCOPE_LABELS[scope]}</span>
            {scope === 'view' && (
              <Badge tone="amber" icon={<ShieldOff />}>
                Read only
              </Badge>
            )}
          </span>
        }
        actions={
          canEdit && (
            <Button write size="sm" onClick={() => setDrawer({ contact: null })}>
              <Plus />
              Add contact
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
          onRowClick={canEdit ? (row) => setDrawer({ contact: row }) : undefined}
          minWidth={960}
          toolbar={
            <>
              <SearchInput
                aria-label="Search contacts"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, company, email, mobile…"
                className="w-full sm:w-64"
              />
              <Facets table={table} data={data} />
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    table.resetColumnFilters()
                    setSearch('')
                  }}
                >
                  Reset
                  <X />
                </Button>
              )}
              <div className="ms-auto">
                <ColumnPicker table={table} />
              </div>
            </>
          }
          empty={
            <EmptyState
              title={data.length === 0 ? 'No contacts yet' : 'No contacts match'}
              body={data.length === 0 ? 'People you add to leads and customers will show up here.' : 'Try another search or clear the filters.'}
              action={
                data.length === 0 && canEdit ? (
                  <Button write size="sm" onClick={() => setDrawer({ contact: null })}>
                    <Plus />
                    Add contact
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </PageBody>
      {canEdit && <ContactDrawer open={!!drawer} onClose={() => setDrawer(null)} contact={drawer?.contact} />}
    </>
  )
}

/* ---------------- Filters ---------------- */

function Facets({ table, data }: { table: Table<ContactRow>; data: ContactRow[] }) {
  const count = (fn: (r: ContactRow) => boolean) => data.filter(fn).length
  const facet = (id: string, title: string, options: FacetOption[]) => {
    const column = table.getColumn(id)
    if (!column) return null
    return (
      <FacetFilter
        title={title}
        options={options}
        selected={(column.getFilterValue() as string[] | undefined) ?? []}
        onChange={(v) => column.setFilterValue(v.length ? v : undefined)}
      />
    )
  }
  return (
    <>
      {facet('recordType', 'Linked to', [
        { value: 'Customer', label: 'Customer', count: count((r) => r.recordType === 'Customer') },
        { value: 'Lead', label: 'Lead', count: count((r) => r.recordType === 'Lead') },
      ])}
      {facet('isDecisionMaker', 'Decision maker', [
        { value: 'true', label: 'Decision makers', count: count((r) => r.isDecisionMaker) },
        { value: 'false', label: 'Others', count: count((r) => !r.isDecisionMaker) },
      ])}
    </>
  )
}

/* ---------------- Columns ---------------- */

const inSet: FilterFn<ContactRow> = (row, id, values: string[] | undefined) =>
  !values?.length || values.includes(String(row.getValue(id)))

const col = createColumnHelper<ContactRow>()

function buildColumns(canEdit: boolean) {
  return [
    col.accessor('name', {
      header: 'Name',
      enableHiding: false,
      meta: { width: 260 },
      cell: ({ row }) => {
        const c = row.original
        return (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={c.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{c.name}</p>
              <p className="truncate text-xs text-muted">{c.title || 'No title'}</p>
            </div>
          </div>
        )
      },
    }),
    col.accessor('company', {
      header: 'Company',
      cell: ({ row }) => {
        const c = row.original
        return (
          <Link
            to={c.recordType === 'Customer' ? customerPath(c.recordId) : leadPath(c.recordId)}
            onClick={(e) => e.stopPropagation()}
            className="flex min-w-0 items-center gap-2 text-ink-2 hover:text-ink hover:underline"
          >
            <Avatar name={c.company} size="xs" square />
            <span className="truncate">{c.company}</span>
          </Link>
        )
      },
    }),
    col.accessor('recordType', {
      header: 'Linked to',
      filterFn: inSet,
      cell: ({ getValue }) => (
        <Badge tone={getValue() === 'Customer' ? 'green' : 'blue'} variant="dot">
          {getValue()}
        </Badge>
      ),
    }),
    col.accessor('mobile', {
      header: 'Mobile',
      enableSorting: false,
      cell: ({ getValue }) =>
        getValue() ? (
          <a href={`tel:${getValue().replace(/\s/g, '')}`} onClick={(e) => e.stopPropagation()} className="num whitespace-nowrap text-ink-2 hover:text-ink">
            {formatMobile(getValue(), getRegion().country)}
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('email', {
      header: 'Email',
      cell: ({ getValue }) =>
        getValue() ? (
          <a
            href={`mailto:${getValue()}`}
            onClick={(e) => e.stopPropagation()}
            className="block max-w-60 truncate text-accent-700 hover:underline dark:text-accent-300"
          >
            {getValue()}
          </a>
        ) : (
          <span className="text-muted">—</span>
        ),
    }),
    col.accessor('isDecisionMaker', {
      header: 'Decision maker',
      filterFn: inSet,
      cell: ({ row }) => <DecisionMakerCell contact={row.original} canEdit={canEdit} />,
    }),
    col.accessor('ownerName', {
      header: 'Owner',
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          <Avatar name={getValue()} size="xs" />
          {getValue()}
        </span>
      ),
    }),
  ]
}

/** Toggle in place for editors; a star for everyone else. */
function DecisionMakerCell({ contact, canEdit }: { contact: ContactRow; canEdit: boolean }) {
  const update = useUpdateContact()
  const toast = useToast()
  const checked = update.isPending && update.variables ? !!update.variables.input.isDecisionMaker : contact.isDecisionMaker
  if (!canEdit) {
    return contact.isDecisionMaker ? (
      <Badge tone="amber" icon={<Star />}>
        Yes
      </Badge>
    ) : (
      <span className="text-muted">—</span>
    )
  }
  return (
    <span onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Switch
        label={`${contact.name} is a decision maker`}
        checked={checked}
        disabled={update.isPending}
        onChange={(v) =>
          update.mutate(
            { id: contact.id, input: { isDecisionMaker: v } },
            {
              onSuccess: () => toast.success(v ? 'Marked as decision maker' : 'No longer a decision maker', contact.name),
              onError: (e) => toast.error('Not saved', e.message),
            },
          )
        }
      />
    </span>
  )
}

const contactSearch: FilterFn<ContactRow> = (row, _columnId, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const c = row.original
  const digits = q.replace(/\D/g, '')
  return (
    [c.name, c.title, c.company, c.email, c.ownerName].join(' ').toLowerCase().includes(q) ||
    (digits.length >= 3 && c.mobile.replace(/\D/g, '').includes(digits))
  )
}
