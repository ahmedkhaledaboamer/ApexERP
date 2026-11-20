import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createColumnHelper, type FilterFn } from '@tanstack/react-table'
import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, FlaskConical, Mail, MailOpen, Reply, Save, Send, Users, XCircle } from 'lucide-react'
import {
  SKIP_REASON_LABEL,
  SKIP_REASONS,
  type AudienceFilter,
  type BulkEmailDetail,
  type BulkEmailRecipient,
  type RecipientStatus,
} from '@/modules/marketing/types'
import {
  useAudiencePreview,
  useBulkEmailQuery,
  useCancelBulkEmail,
  useMarketingAccess,
  useMarketingOptions,
  useScheduleBulkEmail,
  useSendBulkEmailNow,
  useTestBulkEmail,
  useUpdateBulkEmail,
} from '@/modules/marketing/hooks/useMarketing'
import { BulkEmailStatusBadge } from '@/modules/marketing/components/badges'
import { useAudiencesQuery } from '@/modules/marketing/growth/hooks'
import { NoMarketingAccess } from '@/modules/marketing/components/NoAccess'
import { campaignPath, MARKETING_PATHS } from '@/modules/marketing/paths'
import { BodyEditor, VariablePicker } from '@/modules/settings/templates/components/BodyEditor'
import { TemplatePreview } from '@/modules/settings/templates/components/TemplatePreview'
import { SUBJECT_MAX } from '@/modules/settings/templates/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn, fmtDate } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { StatCard } from '@/shared/components/ui/StatCard'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { DataTable, FacetFilter, useDataTable } from '@/shared/components/data-table'

export default function BulkEmailPage() {
  const { canView } = useMarketingAccess()
  if (!canView) return <NoMarketingAccess />
  return <BulkEmailScreen />
}

function BulkEmailScreen() {
  const { id = '' } = useParams()
  const query = useBulkEmailQuery(id)
  if (query.isPending) {
    return (
      <PageBody className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 rounded-card" />
      </PageBody>
    )
  }
  if (query.isError) {
    return (
      <PageBody>
        <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
      </PageBody>
    )
  }
  const e = query.data
  return e.status === 'draft' || e.status === 'scheduled' ? <Builder key={e.id} email={e} /> : <Results email={e} />
}

function Header({ email, actions }: { email: BulkEmailDetail; actions?: ReactNode }) {
  return (
    <PageHeader
      title={email.name}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Link to={MARKETING_PATHS.emails} className="inline-flex items-center gap-1 text-muted hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            Bulk email
          </Link>
          <BulkEmailStatusBadge status={email.status} />
          {email.campaignId && email.campaignName && (
            <Link to={campaignPath(email.campaignId)} className="text-muted underline-offset-2 hover:text-ink hover:underline">
              {email.campaignName}
            </Link>
          )}
        </span>
      }
      actions={actions}
    />
  )
}

/* ---------------- Builder ---------------- */

const sameAudience = (a: AudienceFilter, b: AudienceFilter) => JSON.stringify(a) === JSON.stringify(b)

function Builder({ email }: { email: BulkEmailDetail }) {
  const user = useCurrentUser()!
  const { canEdit } = useMarketingAccess()
  const toast = useToast()
  const options = useMarketingOptions()
  const lookups = useLookups()
  const update = useUpdateBulkEmail()
  const cancel = useCancelBulkEmail()
  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState(email.body)
  const [audience, setAudience] = useState<AudienceFilter>(email.audience)
  const [previewLead, setPreviewLead] = useState('')
  const [modal, setModal] = useState<null | 'test' | 'schedule' | 'send'>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const preview = useAudiencePreview(email.id, audience)
  const savedAudiences = useAudiencesQuery()
  const dirty = subject !== email.subject || body !== email.body || !sameAudience(audience, email.audience)
  const editable = canEdit

  async function save(): Promise<boolean> {
    if (!dirty) return true
    try {
      await update.mutateAsync({ id: email.id, input: { subject, body, audience } })
      return true
    } catch (err) {
      toast.error('Not saved', (err as Error).message)
      return false
    }
  }

  function applyTemplate(templateId: string) {
    const t = options.data?.templates.find((x) => x.id === templateId)
    if (!t) return
    setSubject(t.subject)
    setBody(t.body)
    update.mutate({ id: email.id, input: { templateId: t.id, subject: t.subject, body: t.body, audience } })
  }

  function insertVariable(key: string) {
    const token = `{{${key}}}`
    const el = bodyRef.current
    if (!el) return setBody((b) => b + token)
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    setBody(body.slice(0, start) + token + body.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const pickAudience = (id: string) =>
    setAudience(({ audienceId: _old, ...rest }) => (id ? { ...rest, audienceId: id } : rest))
  const facet = (key: Exclude<keyof AudienceFilter, 'audienceId'>, title: string, opts: { value: string; label: string }[]) => (
    <FacetFilter title={title} options={opts} selected={audience[key]} onChange={(v) => setAudience((a) => ({ ...a, [key]: v }))} />
  )

  return (
    <>
      <Header
        email={email}
        actions={
          editable && (
            <div className="flex flex-wrap gap-2">
              {email.status === 'scheduled' && (
                <Button write variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(email.id, { onSuccess: () => toast.info('Send cancelled') })}>
                  <XCircle />
                  Cancel send
                </Button>
              )}
              <Button write variant="secondary" disabled={!dirty} loading={update.isPending} onClick={() => save().then((ok) => ok && toast.success('Draft saved'))}>
                <Save />
                Save
              </Button>
              <Button write variant="secondary" onClick={() => save().then((ok) => ok && setModal('test'))}>
                <FlaskConical />
                Test send
              </Button>
              <Button write variant="secondary" onClick={() => save().then((ok) => ok && setModal('schedule'))}>
                <CalendarClock />
                {email.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </Button>
              <Button write onClick={() => save().then((ok) => ok && setModal('send'))}>
                <Send />
                Send now
              </Button>
            </div>
          )
        }
      />
      <PageBody className="space-y-6">
        {email.status === 'scheduled' && email.scheduledLocal && (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[0.8125rem] text-ink-2">
            <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
            Scheduled for {fmtDate(email.scheduledLocal, 'EEE d MMM yyyy, HH:mm')} ({email.timezone}). The target list is resolved and checked again at that time.
          </p>
        )}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Email" description="Variables are filled in for every recipient from their lead, you and your company." />
              <CardBody className="space-y-4">
                <Field id="be-template-pick" label="Template" hint="From Settings › Templates; replaces the subject and message.">
                  <SelectInput id="be-template-pick" value={email.templateId ?? ''} disabled={!editable} onChange={(e) => applyTemplate(e.target.value)}>
                    <option value="">Custom email</option>
                    {(options.data?.templates ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field id="be-subject" label="Subject" required>
                  <div className="flex items-center gap-2">
                    <TextInput id="be-subject" value={subject} maxLength={SUBJECT_MAX} readOnly={!editable} onChange={(e) => setSubject(e.target.value)} className="flex-1" />
                    {editable && <VariablePicker onPick={(k) => setSubject((s) => `${s}{{${k}}}`)} label="Variable" />}
                  </div>
                </Field>
                <div>
                  <label htmlFor="be-body" className="mb-1.5 block text-[0.8125rem] font-medium text-ink-2">
                    Message
                  </label>
                  <BodyEditor
                    id="be-body"
                    ref={bodyRef}
                    text={body}
                    value={body}
                    readOnly={!editable}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Dear {{lead.firstName}},"
                    toolbar={editable && <VariablePicker onPick={insertVariable} label="Insert variable" />}
                    meta={<span>{body.length.toLocaleString()}</span>}
                  />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Target list" description="Leads matching every filter you set. Empty filters include everyone." />
              <CardBody className="space-y-4">
                <Field
                  id="be-saved-audience"
                  label="Use a saved audience"
                  hint={
                    audience.audienceId
                      ? 'The audience is resolved again when the email is sent; the filters below narrow it, and every exclusion still applies.'
                      : 'Optional: start from a segment saved in Marketing › Audiences.'
                  }
                >
                  <SelectInput id="be-saved-audience" value={audience.audienceId ?? ''} disabled={!editable} onChange={(e) => pickAudience(e.target.value)}>
                    <option value="">No saved audience (filters only)</option>
                    {(savedAudiences.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.counts.leads.toLocaleString()} leads{a.kind === 'static' ? ', frozen' : ''})
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <div className="flex flex-wrap gap-2" aria-label="Audience filters">
                  {facet('industries', 'Industry', lookups.industries.map((i) => ({ value: i.key, label: i.label })))}
                  {facet('statuses', 'Status', lookups.statuses.map((s) => ({ value: s.key, label: s.label })))}
                  {facet('sources', 'Source', lookups.sources.map((s) => ({ value: s.key, label: s.label })))}
                  {facet('ownerIds', 'Owner', (options.data?.owners ?? []).map((o) => ({ value: o.id, label: o.name })))}
                </div>
                <AudienceSummary preview={preview.data} loading={preview.isPending} error={preview.error} excludedLabels={(options.data?.excludedStatuses ?? []).map(lookups.statusLabel)} />
              </CardBody>
            </Card>
          </div>
          <TemplatePreview draft={{ channel: 'email', purpose: '', subject, body }} user={user} leadId={previewLead} onLeadChange={setPreviewLead} className="h-fit" />
        </div>
      </PageBody>
      <TestModal open={modal === 'test'} onClose={() => setModal(null)} emailId={email.id} defaultTo={user.email} />
      <ScheduleModal open={modal === 'schedule'} onClose={() => setModal(null)} email={email} eligible={preview.data?.eligible ?? null} />
      <SendNowModal open={modal === 'send'} onClose={() => setModal(null)} email={email} eligible={preview.data?.eligible ?? null} />
    </>
  )
}

function AudienceSummary({
  preview,
  loading,
  error,
  excludedLabels,
}: {
  preview: import('@/modules/marketing/types').AudiencePreview | undefined
  loading: boolean
  error: Error | null
  excludedLabels: string[]
}) {
  if (loading && !preview) return <Skeleton className="h-24 w-full" />
  if (error && !preview) return <p className="text-[0.8125rem] text-danger-600">{error.message}</p>
  if (!preview) return null
  const overLimit = preview.available !== null && preview.eligible > preview.available
  const rows: [string, number, string][] = [
    ['Do Not Contact', preview.excluded.dnc, 'excluded-dnc'],
    [excludedLabels.length ? excludedLabels.join(', ') : 'Not interested', preview.excluded.notInterested, 'excluded-not-interested'],
    ['No email address', preview.excluded.noEmail, 'excluded-no-email'],
    ['Duplicate email', preview.excluded.duplicate, 'excluded-duplicate'],
  ]
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-[0.8125rem] text-muted">
          <span data-testid="audience-eligible" className="num text-[1.5rem] font-semibold text-ink">
            {preview.eligible.toLocaleString()}
          </span>{' '}
          will receive it
        </p>
        <p className="text-[0.8125rem] text-muted">
          <span className="num font-medium text-ink">{preview.matched.toLocaleString()}</span> leads match the filters
        </p>
        <p className="text-[0.8125rem] text-muted">
          Emails left this period: <span className="num font-medium text-ink">{preview.available === null ? 'Unlimited' : preview.available.toLocaleString()}</span>
        </p>
      </div>
      <ul aria-label="Excluded" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(([label, n, testId]) => (
          <li key={testId} data-testid={testId} className={cn('flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[0.8125rem]', n > 0 ? 'text-ink' : 'text-muted')}>
            <span className="truncate">Excluded: {label}</span>
            <span className="num font-medium">{n}</span>
          </li>
        ))}
      </ul>
      {overLimit && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-[0.8125rem] text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          More recipients than emails left on your plan this period. Narrow the list or upgrade before sending.
        </p>
      )}
    </div>
  )
}

function TestModal({ open, onClose, emailId, defaultTo }: { open: boolean; onClose: () => void; emailId: string; defaultTo: string }) {
  const test = useTestBulkEmail()
  const [to, setTo] = useState(defaultTo)
  useEffect(() => {
    if (open) {
      setTo(defaultTo)
      test.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultTo])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a test"
      description="One email, filled in for the first person on the list. It counts toward your monthly emails."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button write loading={test.isPending} onClick={() => test.mutate({ id: emailId, to })}>
            Send test
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field id="be-test-to" label="Send to" error={test.error?.message}>
          <TextInput id="be-test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {test.data && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-success-50 px-3 py-2 text-[0.8125rem] text-success-700 dark:bg-success-500/10 dark:text-success-500">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            Test sent to {test.data.to}: “{test.data.subject}”
          </p>
        )}
      </div>
    </Modal>
  )
}

function ScheduleModal({ open, onClose, email, eligible }: { open: boolean; onClose: () => void; email: BulkEmailDetail; eligible: number | null }) {
  const schedule = useScheduleBulkEmail()
  const toast = useToast()
  const [when, setWhen] = useState(email.scheduledLocal ?? '')
  useEffect(() => {
    if (open) {
      setWhen(email.scheduledLocal ?? '')
      schedule.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule the send"
      description={`In your company’s timezone (${email.timezone}).`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            write
            loading={schedule.isPending}
            disabled={!when}
            onClick={() =>
              schedule.mutate(
                { id: email.id, local: when },
                {
                  onSuccess: () => {
                    toast.success('Send scheduled', `${fmtDate(when, 'd MMM yyyy, HH:mm')} (${email.timezone})`)
                    onClose()
                  },
                },
              )
            }
          >
            Schedule
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field id="be-when" label="Send at" error={schedule.error?.message} hint={eligible !== null ? `${eligible.toLocaleString()} recipients right now; the list is resolved again at send time.` : undefined}>
          <TextInput id="be-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

function SendNowModal({ open, onClose, email, eligible }: { open: boolean; onClose: () => void; email: BulkEmailDetail; eligible: number | null }) {
  const send = useSendBulkEmailNow()
  const toast = useToast()
  useEffect(() => {
    if (open) send.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send now?"
      description="Emails go out in batches through the sending queue. This can’t be undone, but the rest of a send can be cancelled."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            write
            loading={send.isPending}
            onClick={() =>
              send.mutate(email.id, {
                onSuccess: () => {
                  toast.success('Sending started', email.name)
                  onClose()
                },
              })
            }
          >
            <Send />
            Send to {eligible === null ? 'the list' : `${eligible.toLocaleString()} ${eligible === 1 ? 'recipient' : 'recipients'}`}
          </Button>
        </div>
      }
    >
      {send.error ? (
        <p role="alert" className="text-[0.8125rem] text-danger-600 dark:text-danger-500">
          {send.error.message}
        </p>
      ) : (
        <p className="text-[0.8125rem] text-ink-2">
          “{email.subject || 'No subject'}” goes to everyone on the target list except Do Not Contact, Not interested, missing and duplicate addresses.
        </p>
      )}
    </Modal>
  )
}

/* ---------------- Results ---------------- */

const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = { queued: 'Queued', sent: 'Sent', skipped: 'Skipped', failed: 'Failed' }
const RECIPIENT_TONE = { queued: 'amber', sent: 'green', skipped: 'neutral', failed: 'red' } as const

function Results({ email }: { email: BulkEmailDetail }) {
  const { canEdit } = useMarketingAccess()
  const cancel = useCancelBulkEmail()
  const toast = useToast()
  const c = email.counts
  const columns = useMemo(() => recipientColumns(), [])
  const table = useDataTable({ id: 'marketing-recipients', data: email.recipients, columns, defaultPageSize: 25, getRowId: (r) => r.id })
  const statusCol = table.getColumn('status')
  const skippedReasons = SKIP_REASONS.filter((k) => c.skippedBy[k] > 0)

  return (
    <>
      <Header
        email={email}
        actions={
          canEdit &&
          email.status === 'sending' && (
            <Button write variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(email.id, { onSuccess: () => toast.info('Rest of the send cancelled') })}>
              <XCircle />
              Cancel the rest
            </Button>
          )
        }
      />
      <PageBody className="space-y-6">
        <section aria-label="Email results" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Recipients" value={c.recipients} hint={c.queued ? `${c.queued} still queued` : `${c.skipped} skipped`} icon={<Users aria-hidden />} />
          <StatCard label="Sent" value={c.sent} hint={email.sentAt ? fmtDate(email.sentAt, 'd MMM yyyy, HH:mm') : 'Sending…'} icon={<Mail aria-hidden />} />
          <StatCard label="Opened" value={c.opened} hint={`Open rate ${c.openRate === null ? '—' : `${c.openRate}%`}`} icon={<MailOpen aria-hidden />} />
          <StatCard label="Replied" value={c.replied} hint={`Reply rate ${c.replyRate === null ? '—' : `${c.replyRate}%`}`} icon={<Reply aria-hidden />} />
        </section>
        {skippedReasons.length > 0 && (
          <Card>
            <CardHeader title="Skipped" description="Checked again when each email went out." />
            <CardBody className="flex flex-wrap gap-2">
              {skippedReasons.map((k) => (
                <Badge key={k} tone={k === 'limit' ? 'red' : 'neutral'}>
                  {SKIP_REASON_LABEL[k]}: {c.skippedBy[k]}
                </Badge>
              ))}
            </CardBody>
          </Card>
        )}
        <DataTable
          table={table}
          toolbar={
            statusCol && (
              <FacetFilter
                title="Status"
                options={(['sent', 'queued', 'skipped', 'failed'] as const).map((s) => ({ value: s, label: RECIPIENT_STATUS_LABEL[s], count: email.recipients.filter((r) => r.status === s).length }))}
                selected={(statusCol.getFilterValue() as string[] | undefined) ?? []}
                onChange={(v) => statusCol.setFilterValue(v.length ? v : undefined)}
              />
            )
          }
          empty={<EmptyState title="No recipients" body="Nobody matched the target list when the send started." />}
        />
      </PageBody>
    </>
  )
}

const inSet: FilterFn<BulkEmailRecipient> = (row, id, values: string[] | undefined) => !values?.length || values.includes(String(row.getValue(id)))
const rcol = createColumnHelper<BulkEmailRecipient>()

function recipientColumns() {
  const time = (iso: string | null) => <span className="num whitespace-nowrap text-muted">{iso ? fmtDate(iso, 'd MMM, HH:mm') : '—'}</span>
  return [
    rcol.accessor('company', {
      header: 'Recipient',
      enableHiding: false,
      meta: { width: 280 },
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.original.name || row.original.company || row.original.email}</p>
          <p className="truncate text-xs text-muted">
            {row.original.company} · {row.original.email || 'no email'}
          </p>
        </div>
      ),
    }),
    rcol.accessor('status', {
      header: 'Status',
      filterFn: inSet,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={RECIPIENT_TONE[row.original.status]} variant="dot">
            {RECIPIENT_STATUS_LABEL[row.original.status]}
          </Badge>
          {row.original.skipReason && <span className="text-xs text-muted">{SKIP_REASON_LABEL[row.original.skipReason]}</span>}
        </span>
      ),
    }),
    rcol.accessor('sentAt', { header: 'Sent', cell: ({ getValue }) => time(getValue()) }),
    rcol.accessor('openedAt', { header: 'Opened', cell: ({ getValue }) => time(getValue()) }),
    rcol.accessor('repliedAt', { header: 'Replied', cell: ({ getValue }) => time(getValue()) }),
  ]
}
