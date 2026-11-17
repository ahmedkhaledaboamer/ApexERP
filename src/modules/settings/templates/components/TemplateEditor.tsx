import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Copy, Lock, MoreHorizontal, Power, PowerOff, Send, Star, Wand2 } from 'lucide-react'
import type { User } from '@/shared/types'
import { useLeaveGuard } from '@/modules/leads/import/useLeaveGuard'
import {
  useCreateTemplate,
  useDuplicateTemplate,
  useMakeDefaultTemplate,
  useSetTemplateActive,
  useUpdateTemplate,
} from '@/modules/settings/hooks/useTemplates'
import { cn, fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Kbd } from '@/shared/components/ui/Kbd'
import { Menu, MenuItem, MenuSeparator } from '@/shared/components/ui/Menu'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { findVariables, unknownVariables } from '../render'
import { getVariable, isKnownVariable, suggestVariable, token } from '../variables'
import {
  BODY_MAX,
  CHANNEL_LABELS,
  NAME_MAX,
  PURPOSES_BY_CHANNEL,
  SUBJECT_MAX,
  TEMPLATE_CHANNELS,
  WHATSAPP_MAX,
  type MessageTemplate,
  type TemplateChannel,
  type TemplatePurpose,
} from '../types'
import { BodyEditor, VariablePicker, WhatsAppFormatButtons, type WrapMarker } from './BodyEditor'
import { CHANNEL_ICONS } from './TemplateList'
import { TemplatePreview } from './TemplatePreview'

const schema = z
  .object({
    channel: z.enum(['email', 'quotation', 'whatsapp']),
    name: z
      .string()
      .trim()
      .min(1, 'Give the template a name.')
      .max(NAME_MAX, `Keep the name under ${NAME_MAX} characters.`),
    purpose: z.string().min(1, 'Choose what this template is for.'),
    subject: z.string().max(SUBJECT_MAX, `Keep the subject under ${SUBJECT_MAX} characters.`),
    body: z.string().max(BODY_MAX, `Keep the message under ${BODY_MAX} characters.`),
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'email' && !v.subject.trim()) {
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'Email templates need a subject.' })
    }
    if (!v.body.trim()) ctx.addIssue({ code: 'custom', path: ['body'], message: 'The message can’t be empty.' })
    else if (v.channel === 'whatsapp' && v.body.trim().length > WHATSAPP_MAX) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: `WhatsApp messages can be at most ${WHATSAPP_MAX} characters.` })
    }
    const unknown = unknownVariables(`${v.subject}\n${v.body}`)
    if (unknown.length) {
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Replace or remove the unknown variables before saving.' })
    }
  })

type Values = z.infer<typeof schema>

function toValues(t: MessageTemplate | null, channel: TemplateChannel): Values {
  if (!t) return { channel, name: '', purpose: PURPOSES_BY_CHANNEL[channel][0], subject: '', body: '' }
  return { channel: t.channel, name: t.name, purpose: t.purpose, subject: t.subject, body: t.body }
}

const BODY_LABEL: Record<TemplateChannel, string> = { email: 'Body', whatsapp: 'Message', quotation: 'Text' }

function bodyHint(channel: TemplateChannel, purpose: string): string {
  if (channel === 'whatsapp') return 'Keep it short and personal. Supports *bold*, _italic_ and ~strikethrough~.'
  if (channel === 'quotation') {
    return purpose === 'Quotation terms' ? 'One term per line; each line prints as a numbered term.' : 'Printed above the line items.'
  }
  return 'Plain text; line breaks are kept. Sign off with your name using {{agent.name}}.'
}

interface TemplateEditorProps {
  /** The template to edit; null to create one. */
  template: MessageTemplate | null
  /** Channel a new template starts in. */
  newChannel: TemplateChannel
  user: User
  readOnly: boolean
  previewLeadId: string
  onPreviewLeadChange: (id: string) => void
  onDirtyChange: (dirty: boolean) => void
  /** After create or duplicate: open the new template. */
  onOpen: (t: MessageTemplate) => void
  /** Back to the list (small screens) or, for a new template, cancel. */
  onClose: () => void
}

/** Editor and live preview for one template. Keyed by template id by the page, so it starts fresh. */
export function TemplateEditor({
  template,
  newChannel,
  user,
  readOnly,
  previewLeadId,
  onPreviewLeadChange,
  onDirtyChange,
  onOpen,
  onClose,
}: TemplateEditorProps) {
  const toast = useToast()
  const create = useCreateTemplate()
  const update = useUpdateTemplate()
  const duplicate = useDuplicateTemplate()
  const makeDefault = useMakeDefaultTemplate()
  const setActive = useSetTemplateActive()
  const isNew = !template
  const editable = !readOnly
  const [confirm, setConfirm] = useState<'deactivate' | 'reactivate' | null>(null)
  const [sendingTest, setSendingTest] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors, isDirty, isSubmitted },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(template, newChannel), mode: 'onTouched' })

  const values = watch()
  const channel = values.channel
  const purposes = PURPOSES_BY_CHANNEL[channel]
  const dirty = editable && (isNew || isDirty)
  const saving = create.isPending || update.isPending
  const busy = saving || duplicate.isPending || makeDefault.isPending || setActive.isPending

  useEffect(() => onDirtyChange(editable && isDirty), [editable, isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useLeaveGuard(editable && isDirty, 'You have unsaved template changes. Leave anyway?')

  // A new template switching channel: keep the purpose valid for that channel.
  useEffect(() => {
    if (!purposes.includes(getValues('purpose') as TemplatePurpose)) setValue('purpose', purposes[0], { shouldDirty: true })
  }, [purposes, getValues, setValue])

  /* ---------- Cursor-aware editing ---------- */

  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastField = useRef<'subject' | 'body'>('body')

  function edit(field: 'subject' | 'body', fn: (v: string, s: number, e: number) => { value: string; start: number; end: number }) {
    const el = field === 'subject' ? subjectRef.current : bodyRef.current
    const current = getValues(field)
    const s = el?.selectionStart ?? current.length
    const e = el?.selectionEnd ?? s
    const next = fn(current, s, e)
    setValue(field, next.value, { shouldDirty: true, shouldValidate: isSubmitted })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.start, next.end)
    })
  }

  function insertVariable(key: string) {
    const field = channel === 'email' ? lastField.current : 'body'
    const t = token(key)
    edit(field, (v, s, e) => ({ value: v.slice(0, s) + t + v.slice(e), start: s + t.length, end: s + t.length }))
  }

  function wrap(marker: WrapMarker) {
    edit('body', (v, s, e) => {
      const sel = v.slice(s, e) || 'text'
      return { value: `${v.slice(0, s)}${marker}${sel}${marker}${v.slice(e)}`, start: s + 1, end: s + 1 + sel.length }
    })
  }

  function replaceVariable(from: string, to: string) {
    const re = new RegExp(`\\{\\{\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g')
    for (const f of ['subject', 'body'] as const) {
      const v = getValues(f)
      if (re.test(v)) setValue(f, v.replace(re, token(to)), { shouldDirty: true, shouldValidate: isSubmitted })
      re.lastIndex = 0
    }
  }

  /* ---------- Actions ---------- */

  const onSave = handleSubmit((v) => {
    const input = { name: v.name.trim(), purpose: v.purpose as TemplatePurpose, subject: v.channel === 'email' ? v.subject : '', body: v.body }
    if (isNew) {
      create.mutate(
        { channel: v.channel, ...input },
        {
          onSuccess: (t) => {
            reset(toValues(t, t.channel))
            toast.success('Template created', t.isDefault ? `It’s the default for ${t.purpose}.` : undefined)
            onOpen(t)
          },
          onError: (err) => toast.error('Couldn’t create the template', err.message),
        },
      )
      return
    }
    update.mutate(
      { id: template.id, input },
      {
        onSuccess: (t) => {
          reset(toValues(t, t.channel))
          toast.success('Template saved', 'The change is recorded in the audit log.')
        },
        onError: (err) => toast.error('Couldn’t save the template', err.message),
      },
    )
  })

  // Ctrl/Cmd + S saves.
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  useEffect(() => {
    if (!editable) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable])

  function needsSave(): boolean {
    if (!isDirty) return false
    toast.info('Save or discard your changes first')
    return true
  }

  function onDuplicate() {
    if (!template || needsSave()) return
    duplicate.mutate(template.id, {
      onSuccess: (t) => {
        toast.success(`Duplicated as “${t.name}”`)
        onOpen(t)
      },
      onError: (err) => toast.error('Couldn’t duplicate', err.message),
    })
  }

  function onMakeDefault() {
    if (!template || needsSave()) return
    makeDefault.mutate(template.id, {
      onSuccess: (t) => toast.success('Default updated', `“${t.name}” is now the default ${CHANNEL_LABELS[t.channel]} template for ${t.purpose}.`),
      onError: (err) => toast.error('Couldn’t change the default', err.message),
    })
  }

  function onConfirmActive() {
    if (!template || !confirm) return
    const active = confirm === 'reactivate'
    setActive.mutate(
      { id: template.id, active },
      {
        onSuccess: (t) => {
          setConfirm(null)
          toast.success(active ? 'Template reactivated' : 'Template deactivated', active ? undefined : 'Agents won’t see it in pickers any more.')
          if (active && t.isDefault) toast.info(`It’s the default for ${t.purpose} again.`)
        },
        onError: (err) => toast.error('Couldn’t update the template', err.message),
      },
    )
  }

  function sendTest() {
    const v = getValues()
    if (!v.body.trim()) return toast.error('Nothing to send yet', 'Write the message first.')
    const unknown = unknownVariables(`${v.subject}\n${v.body}`)
    if (unknown.length) return toast.error('Fix the unknown variables first', unknown.map((k) => `{{${k}}}`).join(', '))
    setSendingTest(true)
    window.setTimeout(() => {
      setSendingTest(false)
      const where = channel === 'whatsapp' ? 'your WhatsApp' : user.email
      const what = channel === 'quotation' ? 'quotation PDF' : CHANNEL_LABELS[channel]
      toast.success(
        `Test ${what} sent to ${where}`,
        `Filled in with the preview lead${isDirty ? ', including your unsaved changes' : ''}. Demo: nothing was actually sent.`,
      )
    }, 600)
  }

  /* ---------- Render ---------- */

  const usedText = `${channel === 'email' ? values.subject : ''}\n${values.body}`
  const bodyLength = values.body.trim().length
  const Icon = CHANNEL_ICONS[channel]
  const errorCount = Object.keys(errors).length

  const subjectReg = register('subject')
  const bodyReg = register('body')

  const draft = useMemo(
    () => ({ channel, purpose: values.purpose as TemplatePurpose, subject: channel === 'email' ? values.subject : '', body: values.body }),
    [channel, values.purpose, values.subject, values.body],
  )

  return (
    <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <Button variant="ghost" size="sm" iconOnly aria-label="Back to templates" className="-ms-1.5 xl:hidden" onClick={onClose}>
            <ArrowLeft aria-hidden />
          </Button>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-sunken text-muted">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="truncate text-[0.9375rem] font-semibold text-ink">
                {isNew ? 'New template' : template.name}
              </h2>
              {template?.isDefault && (
                <Badge tone="amber" icon={<Star className="fill-current" />}>
                  Default
                </Badge>
              )}
              {template && !template.active && <Badge variant="outline">Inactive</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">
              {isNew
                ? `${CHANNEL_LABELS[channel]} template`
                : `${CHANNEL_LABELS[template.channel]} · ${template.purpose} · Updated ${fmtDate(template.updatedAt)} by ${template.updatedBy}`}
            </p>
          </div>
          {!isNew && (
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={sendTest} loading={sendingTest}>
                <Send aria-hidden />
                <span className="hidden sm:inline">Send test to me</span>
                <span className="sm:hidden">Test</span>
              </Button>
              {editable && (
                <Menu
                  trigger={(props) => (
                    <Button {...props} variant="secondary" size="sm" iconOnly aria-label="More actions" disabled={busy}>
                      <MoreHorizontal aria-hidden />
                    </Button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem icon={<Copy />} onSelect={() => (close(), onDuplicate())}>
                        Duplicate
                      </MenuItem>
                      {template.active && !template.isDefault && (
                        <MenuItem icon={<Star />} onSelect={() => (close(), onMakeDefault())}>
                          Make default for {template.purpose}
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      {template.active ? (
                        <MenuItem icon={<PowerOff />} danger onSelect={() => (close(), !needsSave() && setConfirm('deactivate'))}>
                          Deactivate
                        </MenuItem>
                      ) : (
                        <MenuItem icon={<Power />} onSelect={() => (close(), !needsSave() && setConfirm('reactivate'))}>
                          Reactivate
                        </MenuItem>
                      )}
                    </>
                  )}
                </Menu>
              )}
            </div>
          )}
        </div>

        {/* Form */}
        <form id="template-form" onSubmit={onSave} noValidate className="space-y-5 px-4 py-5 sm:px-5">
          {readOnly && (
            <p className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2.5 text-xs text-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>You have view-only access. Only a System Admin can edit templates.</span>
            </p>
          )}
          {template && !template.active && (
            <p className="rounded-lg border border-line bg-sunken px-3 py-2.5 text-xs text-muted">
              This template is inactive: agents and the AI agent don’t see it.
              {editable && ' Reactivate it from the menu to use it again.'}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="tpl-name" label="Name" required error={errors.name?.message} className="sm:col-span-2">
              <TextInput
                id="tpl-name"
                placeholder="e.g. Website enquiry – first follow-up"
                readOnly={readOnly}
                invalid={!!errors.name}
                maxLength={NAME_MAX + 20}
                {...register('name')}
              />
            </Field>
            {isNew && (
              <Field id="tpl-channel" label="Channel" required>
                <SelectInput id="tpl-channel" {...register('channel')}>
                  {TEMPLATE_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}
            <Field
              id="tpl-purpose"
              label="Used for"
              required
              error={errors.purpose?.message}
              hint={template?.isDefault ? `The default for ${template.purpose}.` : undefined}
              className={cn(!isNew && 'sm:col-span-2 md:col-span-1')}
            >
              <SelectInput id="tpl-purpose" disabled={readOnly} invalid={!!errors.purpose} {...register('purpose')}>
                {purposes.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          {channel === 'email' && (
            <Field id="tpl-subject" label="Subject" required error={errors.subject?.message}>
              <TextInput
                id="tpl-subject"
                placeholder="e.g. Your enquiry with {{company.name}}"
                readOnly={readOnly}
                invalid={!!errors.subject}
                {...subjectReg}
                ref={(el) => {
                  subjectReg.ref(el)
                  subjectRef.current = el
                }}
                onFocus={() => (lastField.current = 'subject')}
              />
            </Field>
          )}

          <Field id="tpl-body" label={BODY_LABEL[channel]} required error={errors.body?.message} hint={bodyHint(channel, values.purpose)}>
            <BodyEditor
              id="tpl-body"
              text={values.body}
              invalid={!!errors.body}
              readOnly={readOnly}
              placeholder={
                channel === 'whatsapp'
                  ? 'Hi {{lead.firstName}}, this is {{agent.firstName}} from {{company.name}}…'
                  : 'Dear {{lead.firstName}},'
              }
              toolbar={
                editable && (
                  <>
                    <VariablePicker onPick={insertVariable} label="Insert variable" />
                    {channel === 'whatsapp' && <WhatsAppFormatButtons onWrap={wrap} />}
                  </>
                )
              }
              meta={
                channel === 'whatsapp' ? (
                  <span
                    className={cn(
                      bodyLength > WHATSAPP_MAX
                        ? 'font-medium text-danger-600'
                        : bodyLength > WHATSAPP_MAX * 0.9 && 'text-warning-700 dark:text-warning-500',
                    )}
                  >
                    {bodyLength.toLocaleString()} / {WHATSAPP_MAX.toLocaleString()}
                  </span>
                ) : (
                  `${bodyLength.toLocaleString()} characters`
                )
              }
              {...bodyReg}
              ref={(el) => {
                bodyReg.ref(el)
                bodyRef.current = el
              }}
              onFocus={() => (lastField.current = 'body')}
            />
          </Field>

          <VariablesSummary text={usedText} editable={editable} onReplace={replaceVariable} />
        </form>

        {/* Save bar */}
        {editable && (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-b-card border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
            <p className="min-w-0 flex-1 text-xs text-muted" aria-live="polite">
              {errorCount > 0 ? (
                <span className="text-danger-600 dark:text-danger-500">
                  {errorCount} {errorCount === 1 ? 'field needs' : 'fields need'} attention.
                </span>
              ) : isNew ? (
                'Fields marked * are required'
              ) : dirty ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-warning-700 dark:text-warning-500">
                  <span aria-hidden className="size-1.5 rounded-full bg-warning-500" />
                  Unsaved changes
                </span>
              ) : (
                'All changes saved'
              )}
            </p>
            {isNew ? (
              <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
            ) : (
              dirty && (
                <Button variant="ghost" size="sm" onClick={() => reset()} disabled={saving}>
                  Discard
                </Button>
              )
            )}
            <Button type="submit" form="template-form" size="sm" loading={saving} disabled={!dirty}>
              {isNew ? 'Create template' : 'Save changes'}
              <Kbd className="ms-1 hidden border-white/30 bg-white/15 text-white/90 sm:inline-flex">Ctrl S</Kbd>
            </Button>
          </div>
        )}
      </Card>

      <TemplatePreview
        draft={draft}
        user={user}
        leadId={previewLeadId}
        onLeadChange={onPreviewLeadChange}
        className="2xl:sticky 2xl:top-4"
      />

      {template && (
        <Modal
          open={confirm !== null}
          onClose={() => setConfirm(null)}
          size="sm"
          title={confirm === 'deactivate' ? `Deactivate “${template.name}”?` : `Reactivate “${template.name}”?`}
          description={
            confirm === 'deactivate'
              ? 'Agents and the AI agent will no longer see it. Messages already sent keep it, and you can reactivate it any time.'
              : 'It will be available to agents and the AI agent again.'
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)} disabled={setActive.isPending}>
                Cancel
              </Button>
              <Button variant={confirm === 'deactivate' ? 'danger' : 'primary'} loading={setActive.isPending} onClick={onConfirmActive}>
                {confirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </>
          }
        >
          {confirm === 'deactivate' && template.isDefault ? (
            <p className="text-[0.8125rem] text-ink-2">
              It’s the default for <strong className="font-semibold">{template.purpose}</strong>. That purpose will have no default
              until you make another template the default.
            </p>
          ) : confirm === 'reactivate' ? (
            <p className="text-[0.8125rem] text-ink-2">If {template.purpose} has no default, this becomes its default.</p>
          ) : (
            <p className="text-[0.8125rem] text-ink-2">The change is recorded in the audit log.</p>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------
 * Variables used, with unknown-variable warnings and one-click fixes
 * ---------------------------------------------------------------------------------------- */

function VariablesSummary({ text, editable, onReplace }: { text: string; editable: boolean; onReplace: (from: string, to: string) => void }) {
  const keys = findVariables(text)
  if (keys.length === 0) {
    return (
      <p className="text-xs text-muted">
        No variables yet. Insert one to fill in the lead’s company, the contact’s name or your details automatically.
      </p>
    )
  }
  const unknown = keys.filter((k) => !isKnownVariable(k))
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="me-0.5 text-xs text-muted">Uses</span>
        {keys.map((k) => {
          const v = getVariable(k)
          return (
            <span
              key={k}
              title={v ? `${v.label}: ${v.description}` : 'Unknown variable'}
              className={cn(
                'inline-flex h-[1.375rem] items-center rounded-md px-1.5 font-mono text-[0.6875rem]',
                v ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-danger-500/15 text-danger-700 dark:text-danger-500',
              )}
            >
              {k || '(empty)'}
            </span>
          )
        })}
      </div>
      {unknown.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2.5 text-xs">
          <p className="font-medium text-danger-700 dark:text-danger-500">
            {unknown.length === 1 ? '1 unknown variable' : `${unknown.length} unknown variables`}. They can’t be filled in, so the
            template can’t be saved yet.
          </p>
          <ul className="mt-2 space-y-1.5">
            {unknown.map((k) => {
              const s = suggestVariable(k)
              return (
                <li key={k} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-2">
                  <code className="font-mono text-danger-700 dark:text-danger-500">{`{{${k}}}`}</code>
                  {s ? (
                    <>
                      <span className="text-muted">Did you mean</span>
                      <code className="font-mono text-ink">{token(s.key)}</code>
                      {editable && (
                        <Button variant="secondary" size="xs" onClick={() => onReplace(k, s.key)}>
                          <Wand2 aria-hidden />
                          Replace
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-muted">Not a known variable. Pick one from Insert variable.</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
