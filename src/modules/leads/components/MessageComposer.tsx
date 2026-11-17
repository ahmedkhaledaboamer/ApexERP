import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, Info, Send } from 'lucide-react'
import type { User } from '@/shared/types'
import type { LeadDetail } from '@/modules/leads/types'
import type { MessageChannel } from '@/modules/leads/api/messagesApi'
import { useSendMessage } from '@/modules/leads/hooks/useMessages'
import { useQuotationsQuery } from '@/modules/quotations/hooks/useQuotations'
import { useTemplatesQuery } from '@/modules/settings/hooks/useTemplates'
import { buildTemplateContext } from '@/modules/settings/templates/context'
import { renderTemplate, type TemplateContext } from '@/modules/settings/templates/render'
import { SUBJECT_MAX, WHATSAPP_MAX, type MessageTemplate } from '@/modules/settings/templates/types'
import { quotationPath } from '@/app/paths'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { Segmented } from '@/shared/components/ui/Segmented'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import {
  fillForEditing,
  groupByPurpose,
  issueLabel,
  pickTemplate,
  recipientsFor,
  suggestedPurpose,
  variableIssues,
  type Recipient,
} from './composer/compose'
import { EmailPreview, WhatsAppPreview } from './composer/MessagePreview'

interface MessageComposerProps {
  open: boolean
  onClose: () => void
  lead: LeadDetail
  user: User
  /** Channel the drawer opens on; the user can switch inside. */
  channel: MessageChannel
  /** After a successful send (the activity is already logged). */
  onSent?: () => void
}

/**
 * Email / WhatsApp composer on the lead page. Pre-fills from a template with the lead, the chosen
 * contact and the signed-in user; everything stays editable. Sending is mocked and logged as an
 * activity by the server (POST /leads/:id/messages).
 */
export function MessageComposer({ open, ...rest }: MessageComposerProps) {
  // Mounted only while open, so every opening starts from a fresh draft.
  return open ? <Composer {...rest} /> : null
}

const CHANNEL_OPTIONS: { value: MessageChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
]

type View = 'write' | 'preview'

type Pending =
  | { kind: 'template'; templateId: string }
  | { kind: 'channel'; channel: MessageChannel }
  | { kind: 'close' }

function Composer({ onClose, lead, user, channel: initialChannel, onSent }: Omit<MessageComposerProps, 'open'>) {
  const toast = useToast()
  const lookups = useLookups()
  const templatesQuery = useTemplatesQuery()
  const quotationsQuery = useQuotationsQuery(lead.id)
  const send = useSendMessage(lead.id)

  const [channel, setChannel] = useState<MessageChannel>(initialChannel)
  const [recipientId, setRecipientId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  /** Text as last filled from a template; differs from subject/body once the user edits. */
  const [filled, setFilled] = useState({ subject: '', body: '' })
  /** Whether the channel's starting template has been applied (waits for templates to load). */
  const [initialized, setInitialized] = useState(false)
  const [view, setView] = useState<View>('write')
  const [pending, setPending] = useState<Pending | null>(null)

  const recipients = useMemo(() => recipientsFor(lead, channel), [lead, channel])
  const recipient: Recipient | null = recipients.find((r) => r.id === recipientId) ?? recipients[0] ?? null

  const options = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.active && t.channel === channel),
    [templatesQuery.data, channel],
  )
  const groups = useMemo(() => groupByPurpose(options, channel), [options, channel])
  const purpose = suggestedPurpose(lead.status, lookups)
  const template = options.find((t) => t.id === templateId) ?? null

  const quotation = useMemo(
    () => [...(quotationsQuery.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    [quotationsQuery.data],
  )

  const ctxFor = (r: Recipient | null): TemplateContext =>
    buildTemplateContext({
      // The chosen contact is who the message greets.
      lead: r && r.id !== 'lead' ? { ...lead, contactName: r.name } : lead,
      agent: user,
      quotation,
      quotationLink: quotation ? `${window.location.origin}${quotationPath(quotation.id)}` : undefined,
      labels: { status: lookups.statusLabel, industry: lookups.industryLabel, source: lookups.sourceLabel },
    })
  const ctx = ctxFor(recipient)

  const edited = subject !== filled.subject || body !== filled.body
  const ready = !templatesQuery.isPending && !quotationsQuery.isPending && !lookups.isLoading

  function fill(t: MessageTemplate | null, r: Recipient | null = recipient) {
    const c = ctxFor(r)
    const next = {
      subject: t && channel === 'email' ? fillForEditing(t.subject, c) : '',
      body: t ? fillForEditing(t.body, c) : '',
    }
    setTemplateId(t?.id ?? '')
    setSubject(next.subject)
    setBody(next.body)
    setFilled(next)
  }

  // Pre-select the template that fits the lead once templates, quotations and lookups are in.
  useEffect(() => {
    if (initialized || !ready) return
    setInitialized(true)
    fill(pickTemplate(options, purpose))
    // Runs once per channel when data is ready; `fill` reads the latest render's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, ready, options, purpose])

  function switchChannel(next: MessageChannel) {
    if (next === channel) return
    if (edited && (subject.trim() || body.trim())) {
      setPending({ kind: 'channel', channel: next })
      return
    }
    applyChannel(next)
  }

  function applyChannel(next: MessageChannel) {
    setChannel(next)
    setRecipientId('')
    setTemplateId('')
    setSubject('')
    setBody('')
    setFilled({ subject: '', body: '' })
    setInitialized(false)
    send.reset()
  }

  function chooseTemplate(id: string) {
    if (id === templateId) return
    if (edited) {
      setPending({ kind: 'template', templateId: id })
      return
    }
    fill(options.find((t) => t.id === id) ?? null)
  }

  function chooseRecipient(id: string) {
    setRecipientId(id)
    // Re-greet the new contact when the text is still exactly what the template produced.
    const r = recipients.find((x) => x.id === id) ?? null
    if (!edited && template) fill(template, r)
  }

  function requestClose() {
    if (edited && (subject.trim() || body.trim()) && !send.isPending) setPending({ kind: 'close' })
    else onClose()
  }

  function confirmPending() {
    if (!pending) return
    if (pending.kind === 'template') fill(options.find((t) => t.id === pending.templateId) ?? null)
    else if (pending.kind === 'channel') applyChannel(pending.channel)
    else onClose()
    setPending(null)
  }

  /* ---------- Checks ---------- */

  const issues = variableIssues(`${channel === 'email' ? subject : ''}\n${body}`, ctx)
  const finalSubject = channel === 'email' ? renderTemplate(subject, ctx).trim() : ''
  const finalBody = renderTemplate(body, ctx).trim()
  const overLimit = channel === 'whatsapp' && finalBody.length > WHATSAPP_MAX
  const subjectTooLong = channel === 'email' && finalSubject.length > SUBJECT_MAX
  const blocker = lead.doNotContact
    ? 'Do Not Contact is on for this lead.'
    : !recipient
      ? channel === 'email'
        ? 'No contact on this lead has an email address.'
        : 'No contact on this lead has a UAE mobile.'
      : issues.length > 0
        ? 'Fill in or remove the highlighted variables.'
        : channel === 'email' && !finalSubject
          ? 'Add a subject.'
          : !finalBody
            ? 'Write the message.'
            : overLimit
              ? `WhatsApp messages are limited to ${WHATSAPP_MAX} characters.`
              : subjectTooLong
                ? `Keep the subject under ${SUBJECT_MAX} characters.`
                : null

  function submit() {
    if (blocker || !recipient) return
    send.mutate(
      {
        channel,
        to: recipient.address,
        subject: channel === 'email' ? finalSubject : undefined,
        body: finalBody,
        templateId: templateId || undefined,
      },
      {
        onSuccess: (res) => {
          toast.success(channel === 'email' ? 'Email sent · logged as activity' : 'WhatsApp sent · logged as activity', `To ${recipient.name}`)
          // Automation: No response → Cold after `attemptsBeforeCold` unanswered attempts.
          if (res.autoStatus) {
            const { label, attempts } = res.autoStatus
            toast.info(`Moved to ${label} after ${attempts} attempts with no reply`, 'Automatic follow-ups stop while the lead is parked.')
          }
          onSent?.()
          onClose()
        },
      },
    )
  }

  const channelLabel = channel === 'email' ? 'email' : 'WhatsApp'

  // Drawer and Modal re-bind their Escape / focus handling whenever onClose changes, so hand them
  // stable callbacks. Escape while the confirm dialog is up closes only the dialog.
  const latest = useRef({ requestClose, pending })
  latest.current = { requestClose, pending }
  const closeDrawer = useCallback(() => {
    if (!latest.current.pending) latest.current.requestClose()
  }, [])
  const closeConfirm = useCallback(() => setPending(null), [])

  return (
    <>
      <Drawer
        open
        onClose={closeDrawer}
        width="lg"
        title={channel === 'email' ? 'Send email' : 'Send WhatsApp'}
        description={`To ${lead.company}. Sent from your account and logged on the lead’s timeline.`}
        footer={
          <>
            <p className="me-auto hidden min-w-0 self-center truncate text-xs text-muted sm:block" aria-live="polite">
              {blocker ?? `Logged as a ${channelLabel} activity.`}
            </p>
            <Button variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={!!blocker || !ready} loading={send.isPending} title={blocker ?? undefined}>
              <Send />
              Send {channelLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {lead.doNotContact && (
            <Banner tone="danger" icon={<Ban />}>
              {lead.company} is marked Do Not Contact, so emails and WhatsApp are blocked.
            </Banner>
          )}

          <Segmented<MessageChannel> label="Channel" options={CHANNEL_OPTIONS} value={channel} onChange={switchChannel} size="sm" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="msg-to" label="To" required>
              {recipients.length > 0 ? (
                <SelectInput id="msg-to" value={recipient?.id ?? ''} onChange={(e) => chooseRecipient(e.target.value)}>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.address}
                      {r.isDecisionMaker ? ' (decision maker)' : ''}
                    </option>
                  ))}
                </SelectInput>
              ) : (
                <p className="flex h-9 items-center rounded-lg border border-dashed border-line-strong px-3 text-[0.8125rem] text-muted">
                  {channel === 'email' ? 'No contact with an email' : 'No contact with a UAE mobile'}
                </p>
              )}
            </Field>

            <Field
              id="msg-template"
              label="Template"
              hint={`Suggested for ${lookups.statusLabel(lead.status)}: ${purpose}`}
            >
              {templatesQuery.isPending ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <SelectInput id="msg-template" value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                  <option value="">No template (blank)</option>
                  {groups.map((g) => (
                    <optgroup key={g.purpose} label={g.purpose}>
                      {g.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.isDefault ? ' (default)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Segmented<View>
              label="Editor view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'write', label: 'Write' },
                { value: 'preview', label: 'Preview' },
              ]}
            />
            {template && edited && <span className="text-xs text-muted">Edited from “{template.name}”</span>}
          </div>

          {!ready ? (
            <div className="space-y-3" aria-busy="true">
              {channel === 'email' && <Skeleton className="h-9 w-full" />}
              <Skeleton className="h-64 w-full" />
            </div>
          ) : view === 'write' ? (
            <div className="space-y-4">
              {channel === 'email' && (
                <Field id="msg-subject" label="Subject" required>
                  <TextInput
                    id="msg-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={SUBJECT_MAX + 50}
                    invalid={subjectTooLong}
                  />
                </Field>
              )}
              <div>
                <Field id="msg-body" label="Message" required>
                  <TextArea
                    id="msg-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={channel === 'email' ? 14 : 10}
                    invalid={overLimit}
                    className="min-h-56"
                    placeholder={channel === 'email' ? 'Write your email…' : 'Write your message…'}
                  />
                </Field>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>{channel === 'whatsapp' ? 'Formatting: *bold*, _italic_, ~strike~' : 'Plain text email'}</span>
                  {channel === 'whatsapp' && (
                    <span className={cn('num', overLimit && 'font-medium text-danger-600')}>
                      {finalBody.length.toLocaleString()} / {WHATSAPP_MAX.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : channel === 'email' ? (
            <EmailPreview subject={subject} body={body} ctx={ctx} user={user} recipient={recipient} />
          ) : (
            <WhatsAppPreview body={body} ctx={ctx} recipient={recipient} company={lead.company} />
          )}

          {issues.length > 0 && (
            <Banner tone="warning" icon={<AlertTriangle />}>
              <p className="font-medium">Some variables can’t be filled in for this lead</p>
              <p className="mt-0.5">Type the text yourself or remove them before sending.</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {issues.map((i) => (
                  <li
                    key={i.key}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 font-mono text-[0.6875rem]',
                      i.kind === 'unknown'
                        ? 'bg-danger-500/15 text-danger-700 dark:text-danger-500'
                        : 'border border-dashed border-warning-500/70 bg-warning-500/10 text-warning-700 dark:text-warning-500',
                    )}
                    title={i.kind === 'unknown' ? 'Unknown variable' : `${issueLabel(i)} isn’t set on this record`}
                  >
                    {`{{${i.key}}}`}
                    <span className="ms-1 font-sans">{i.kind === 'unknown' ? 'unknown' : 'not set'}</span>
                  </li>
                ))}
              </ul>
            </Banner>
          )}

          {quotation === null && !quotationsQuery.isPending && /\{\{\s*quotation\./.test(subject + body) && (
            <Banner tone="info" icon={<Info />}>
              {lead.company} has no quotation yet, so quotation details can’t be filled in.
            </Banner>
          )}

          {send.isError && (
            <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
              {send.error.message}
            </p>
          )}

          {blocker && (
            <p className="text-xs text-muted sm:hidden">
              {blocker}
            </p>
          )}
        </div>
      </Drawer>

      <Modal
        open={!!pending}
        onClose={closeConfirm}
        size="sm"
        title={pending?.kind === 'close' ? 'Discard this message?' : 'Replace your edits?'}
        description={
          pending?.kind === 'close'
            ? 'What you wrote won’t be kept.'
            : pending?.kind === 'channel'
              ? 'Switching channel starts a new message from that channel’s template.'
              : 'The message will be filled in again from the chosen template.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button variant={pending?.kind === 'close' ? 'danger' : 'primary'} onClick={confirmPending}>
              {pending?.kind === 'close' ? 'Discard' : 'Replace'}
            </Button>
          </>
        }
      >
        <span className="sr-only">Your current text will be lost.</span>
      </Modal>
    </>
  )
}

function Banner({ tone, icon, children }: { tone: 'danger' | 'warning' | 'info'; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'info' ? undefined : 'alert'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[0.8125rem] [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'danger' && 'bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-500',
        tone === 'warning' && 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500',
        tone === 'info' && 'bg-sunken text-muted',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
