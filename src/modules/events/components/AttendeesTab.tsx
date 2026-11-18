import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { CheckCircle2, ExternalLink, FileUp, Link2, Trash2, UserPlus, X } from 'lucide-react'
import type { Attendee, AttendeeImportResult, AttendeeImportRow, EventDetail } from '@/modules/events/types'
import { ATTENDEE_SOURCE_LABEL } from '@/modules/events/types'
import { useAddAttendee, useAttendeesQuery, useCheckIn, useImportAttendees, useRemoveAttendee } from '@/modules/events/hooks/useEvents'
import { readSpreadsheet } from '@/modules/leads/import/importModel'
import { leadPath } from '@/app/paths'
import { useRegion } from '@/modules/tenancy/hooks'
import { isMobile, mobileError, mobileExample } from '@/shared/lib/phone'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SearchInput, TextInput } from '@/shared/components/form/Field'
import { DataTable, useDataTable } from '@/shared/components/data-table'

/** Attendees: table, add one, import a file, check in, open the lead. */
export function AttendeesTab({ event: e }: { event: EventDetail }) {
  const query = useAttendeesQuery(e.id)
  const data = useMemo(() => query.data ?? [], [query.data])
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const checkIn = useCheckIn()
  const remove = useRemoveAttendee()
  const toast = useToast()
  const writable = e.canEdit && e.status !== 'cancelled'

  const columns = useMemo(() => {
    const col = createColumnHelper<Attendee>()
    return [
      col.accessor('name', {
        header: 'Attendee',
        enableHiding: false,
        meta: { width: 260 },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.original.name}</p>
            <p className="truncate text-xs text-muted">{[row.original.title, row.original.companyName].filter(Boolean).join(' · ') || '—'}</p>
          </div>
        ),
      }),
      col.accessor('email', {
        header: 'Contact',
        cell: ({ row }) => (
          <div className="min-w-0 text-[0.8125rem]">
            <p className="truncate text-ink-2">{row.original.email || '—'}</p>
            <p className="num truncate text-xs text-muted">{row.original.mobile}</p>
          </div>
        ),
      }),
      col.accessor('leadOutcome', {
        header: 'Lead',
        cell: ({ row }) => <LeadCell attendee={row.original} />,
      }),
      col.accessor('source', { header: 'Source', cell: ({ row }) => <span className="text-xs text-muted" title={row.original.sourceDetail}>{ATTENDEE_SOURCE_LABEL[row.original.source]}</span> }),
      col.accessor('registeredAt', { header: 'Registered', cell: ({ getValue }) => <span className="num whitespace-nowrap text-xs text-muted">{fmtDate(getValue())}</span> }),
      col.accessor('checkedInAt', {
        header: 'Check-in',
        cell: ({ row }) => {
          const a = row.original
          if (!writable) return a.checkedInAt ? <Badge tone="green">Checked in</Badge> : <span className="text-xs text-subtle">—</span>
          return (
            <Button
              write
              size="xs"
              variant={a.checkedInAt ? 'secondary' : 'primary'}
              aria-label={a.checkedInAt ? `Undo check-in of ${a.name}` : `Check in ${a.name}`}
              onClick={(ev) => {
                ev.stopPropagation()
                checkIn.mutate(
                  { id: e.id, attendeeId: a.id, undo: !!a.checkedInAt },
                  { onError: (err) => toast.error('Check-in not saved', err.message) },
                )
              }}
            >
              {a.checkedInAt ? (
                <>
                  <CheckCircle2 className="text-success-600" />
                  Checked in
                </>
              ) : (
                'Check in'
              )}
            </Button>
          )
        },
      }),
      col.display({
        id: 'actions',
        header: '',
        meta: { align: 'end' },
        cell: ({ row }) =>
          writable ? (
            <Button
              write
              size="xs"
              variant="ghost"
              iconOnly
              aria-label={`Remove ${row.original.name}`}
              onClick={(ev) => {
                ev.stopPropagation()
                remove.mutate(
                  { id: e.id, attendeeId: row.original.id },
                  { onSuccess: () => toast.success('Attendee removed', row.original.leadId ? 'The lead stays in Sales.' : undefined), onError: (err) => toast.error('Not removed', err.message) },
                )
              }}
            >
              <Trash2 />
            </Button>
          ) : null,
      }),
    ]
  }, [writable, e.id, checkIn, remove, toast])

  const table = useDataTable({ id: 'event-attendees', data, columns, globalFilter: search, globalFilterFn: attendeeSearch, getRowId: (r) => r.id })

  return (
    <div className="space-y-4">
      <DataTable
        table={table}
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        toolbar={
          <>
            <SearchInput aria-label="Search attendees" value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder="Search name, company, email…" className="w-full sm:w-64" />
            {search && (
              <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                Reset
                <X />
              </Button>
            )}
            {writable && (
              <div className="ms-auto flex gap-2">
                <Button write variant="secondary" size="sm" onClick={() => setImporting(true)}>
                  <FileUp />
                  Import
                </Button>
                <Button write size="sm" onClick={() => setAdding(true)}>
                  <UserPlus />
                  Add attendee
                </Button>
              </div>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={<UserPlus />}
            title={data.length === 0 ? 'No attendees yet' : 'No attendees match'}
            body={data.length === 0 ? 'Add attendees, import a list, or share the public registration link. Each one becomes a lead with the source Event.' : 'Try another search.'}
          />
        }
      />
      {writable && <AddAttendeeModal open={adding} onClose={() => setAdding(false)} event={e} />}
      {writable && <ImportAttendeesModal open={importing} onClose={() => setImporting(false)} event={e} />}
    </div>
  )
}

function LeadCell({ attendee: a }: { attendee: Attendee }) {
  if (a.leadOutcome === 'none') return <Badge tone="amber">No lead (plan limit)</Badge>
  const label = a.leadOutcome === 'created' ? 'New lead' : 'Existing lead'
  if (!a.leadId) return <span className="text-xs text-subtle">—</span>
  if (!a.canOpenLead) return <Badge tone={a.leadOutcome === 'created' ? 'brand' : 'neutral'}>{label}</Badge>
  return (
    <Link
      to={leadPath(a.leadId)}
      onClick={(ev) => ev.stopPropagation()}
      aria-label={`Open lead ${a.leadCompany ?? a.leadId}`}
      className="inline-flex max-w-48 items-center gap-1 text-[0.8125rem] font-medium text-brand-700 hover:underline dark:text-brand-300"
    >
      {a.leadOutcome === 'linked' ? <Link2 className="size-3.5 shrink-0" aria-hidden /> : <ExternalLink className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{a.leadCompany ?? a.leadId}</span>
      <span className="shrink-0 text-xs font-normal text-muted">· {label.toLowerCase()}</span>
    </Link>
  )
}

const attendeeSearch: FilterFn<Attendee> = (row, _c, value: string) => {
  const q = value.trim().toLowerCase()
  if (!q) return true
  const a = row.original
  return [a.name, a.companyName, a.email, a.mobile, a.title].join(' ').toLowerCase().includes(q)
}

/* ---------------- Add one ---------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AddAttendeeModal({ open, onClose, event: e }: { open: boolean; onClose: () => void; event: EventDetail }) {
  const region = useRegion()
  const add = useAddAttendee()
  const toast = useToast()
  const blank = { name: '', companyName: '', email: '', mobile: '', title: '' }
  const [v, setV] = useState(blank)
  const [touched, setTouched] = useState(false)
  const set = (k: keyof typeof blank, value: string) => setV((x) => ({ ...x, [k]: value }))
  const errs: Partial<Record<keyof typeof blank, string>> = {}
  if (touched) {
    if (v.name.trim().length < 2) errs.name = 'Enter the attendee’s name.'
    if (v.email && !EMAIL_RE.test(v.email.trim())) errs.email = 'Enter a valid email.'
    if (v.mobile && !isMobile(v.mobile, region.country)) errs.mobile = mobileError(region.country)
    if (!v.email.trim() && !v.mobile.trim()) errs.email = 'Add an email or a mobile number.'
  }
  function close() {
    setV(blank)
    setTouched(false)
    add.reset()
    onClose()
  }
  function submit(ev: FormEvent) {
    ev.preventDefault()
    setTouched(true)
    const name = v.name.trim()
    if (name.length < 2 || (!v.email.trim() && !v.mobile.trim()) || (v.email && !EMAIL_RE.test(v.email.trim())) || (v.mobile && !isMobile(v.mobile, region.country))) return
    add.mutate(
      { id: e.id, input: { ...v, name } },
      {
        onSuccess: (r) => {
          if (r.outcome === 'none') toast.error('Registered without a lead', r.message)
          else toast.success(r.outcome === 'created' ? 'Registered · new lead' : 'Registered · linked to the existing lead', r.message)
          close()
        },
      },
    )
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Add attendee"
      description={`Registers at ${e.name}. A new person becomes a lead with the source Event; an existing lead’s email is linked instead.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button write type="submit" form="attendee-form" loading={add.isPending}>
            Register
          </Button>
        </>
      }
    >
      <form id="attendee-form" noValidate onSubmit={submit} className="space-y-4">
        <Field id="att-name" label="Name" required error={errs.name}>
          <TextInput id="att-name" value={v.name} invalid={!!errs.name} onChange={(ev) => set('name', ev.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="att-company" label="Company">
            <TextInput id="att-company" value={v.companyName} onChange={(ev) => set('companyName', ev.target.value)} />
          </Field>
          <Field id="att-title" label="Job title">
            <TextInput id="att-title" value={v.title} onChange={(ev) => set('title', ev.target.value)} />
          </Field>
          <Field id="att-email" label="Email" error={errs.email}>
            <TextInput id="att-email" type="email" inputMode="email" value={v.email} invalid={!!errs.email} onChange={(ev) => set('email', ev.target.value)} />
          </Field>
          <Field id="att-mobile" label="Mobile" error={errs.mobile} hint={errs.mobile ? undefined : mobileExample(region.country)}>
            <TextInput id="att-mobile" type="tel" inputMode="tel" value={v.mobile} invalid={!!errs.mobile} onChange={(ev) => set('mobile', ev.target.value)} />
          </Field>
        </div>
        {add.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {add.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}

/* ---------------- Import ---------------- */

const HEADER_MATCH: Record<keyof Omit<AttendeeImportRow, 'row'>, RegExp> = {
  name: /^(full\s*)?name$|^attendee|^contact\s*name|^visitor/i,
  companyName: /company|organi[sz]ation|employer/i,
  email: /e-?mail/i,
  mobile: /mobile|phone|whatsapp|cell/i,
  title: /title|position|role|designation/i,
}

/** Reads a CSV / .xlsx file and maps its columns by header (name, company, email, mobile, title). */
async function rowsFromFile(file: File): Promise<AttendeeImportRow[]> {
  const sheet = await readSpreadsheet(file)
  const idx = (k: keyof typeof HEADER_MATCH) => sheet.headers.findIndex((h) => HEADER_MATCH[k].test(h.trim()))
  const cols = { name: idx('name'), companyName: idx('companyName'), email: idx('email'), mobile: idx('mobile'), title: idx('title') }
  if (cols.name < 0) throw new Error('No “Name” column found. Use the headers Name, Company, Email, Mobile, Title.')
  return sheet.rows.map((r, i) => ({
    row: sheet.rowNumbers[i] ?? i + 2,
    name: r[cols.name] ?? '',
    companyName: cols.companyName >= 0 ? r[cols.companyName] : '',
    email: cols.email >= 0 ? r[cols.email] : '',
    mobile: cols.mobile >= 0 ? r[cols.mobile] : '',
    title: cols.title >= 0 ? r[cols.title] : '',
  }))
}

function ImportAttendeesModal({ open, onClose, event: e }: { open: boolean; onClose: () => void; event: EventDetail }) {
  const run = useImportAttendees()
  const [file, setFile] = useState<{ name: string; rows: AttendeeImportRow[] } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<AttendeeImportResult | null>(null)
  function close() {
    setFile(null)
    setFileError(null)
    setResult(null)
    run.reset()
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Import attendees"
      description="A CSV or Excel (.xlsx) file with the columns Name, Company, Email, Mobile and Title. Each row registers like a manual add."
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
              disabled={!file}
              loading={run.isPending}
              onClick={() => file && run.mutate({ id: e.id, rows: file.rows, fileName: file.name }, { onSuccess: setResult })}
            >
              Import {file ? `${file.rows.length} rows` : ''}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-[0.8125rem]" role="status">
          <p>
            <span className="font-semibold">{result.added}</span> attendees added: {result.leadsCreated} new leads, {result.leadsLinked} linked to existing leads
            {result.withoutLead > 0 && `, ${result.withoutLead} without a lead`}.
          </p>
          {result.limitReached && (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500">
              Your plan’s leads and contacts limit ({result.limitReached.max.toLocaleString('en-US')}) is reached: later rows were saved as attendees without a lead.
            </p>
          )}
          {result.failed.length > 0 && (
            <div>
              <p className="font-medium">{result.failed.length} rows not imported</p>
              <ul className="mt-1 max-h-40 list-disc space-y-0.5 overflow-y-auto ps-5 text-muted">
                {result.failed.map((f) => (
                  <li key={f.row}>
                    Row {f.row} {f.name && `(${f.name})`}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="file"
            aria-label="Attendee file"
            accept=".csv,.xlsx,text/csv"
            className="block w-full text-[0.8125rem] file:me-3 file:rounded-md file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-ink-2"
            onChange={async (ev) => {
              const f = ev.target.files?.[0]
              setFile(null)
              setFileError(null)
              if (!f) return
              try {
                const rows = await rowsFromFile(f)
                setFile({ name: f.name, rows })
              } catch (err) {
                setFileError((err as Error).message)
              }
            }}
          />
          {file && <p className="text-[0.8125rem] text-muted">{file.rows.length} rows ready from {file.name}.</p>}
          {(fileError || run.error) && (
            <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
              {fileError ?? run.error?.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
