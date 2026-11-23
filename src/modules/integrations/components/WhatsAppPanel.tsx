import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, Plus, Send, Trash2, Unplug, UserPlus } from 'lucide-react'
import type { WaCategory, WhatsAppIntegration } from '@/modules/integrations/types'
import { integrationsApi, useConversations, useIntegrationMutation, useWhatsApp } from '@/modules/integrations/api'
import { leadPath } from '@/app/paths'
import { Button } from '@/shared/components/ui/Button'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'
import { ErrorNote, Facts, Section, when } from './shared'

const TPL_TONE: Record<string, Tone> = { approved: 'green', pending: 'amber', rejected: 'red' }

/** WhatsApp Business (Cloud API, simulated): number, message templates, inbound conversations. */
export function WhatsAppPanel({ canEdit }: { canEdit: boolean }) {
  const q = useWhatsApp()
  if (q.isPending) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
  const wa = q.data
  return (
    <div className="space-y-5">
      <Connection wa={wa} canEdit={canEdit} />
      {wa.status !== 'not_connected' && <Templates wa={wa} canEdit={canEdit} />}
      {wa.status !== 'not_connected' && <Conversations canEdit={canEdit} />}
    </div>
  )
}

function Connection({ wa, canEdit }: { wa: WhatsAppIntegration; canEdit: boolean }) {
  const toast = useToast()
  const connect = useIntegrationMutation(integrationsApi.connectWhatsApp)
  const disconnect = useIntegrationMutation(integrationsApi.disconnectWhatsApp)
  const [f, setF] = useState({ phoneNumberId: wa.phoneNumberId ?? '', businessAccountId: wa.businessAccountId ?? '', accessToken: '' })
  return (
    <Section title="Business number" hint="From Meta WhatsApp Manager › API setup. The access token is write-only.">
      {wa.status !== 'not_connected' && (
        <Facts
          rows={[
            ['Number', <span data-testid="wa-number">{wa.displayNumber}</span>],
            ['Verified name', wa.verifiedName ?? '—'],
            ['Phone number id', wa.phoneNumberId ?? '—'],
            ['Access token', wa.tokenHint ?? '—'],
            ['Connected', `${when(wa.connectedAt)}${wa.connectedBy ? ` by ${wa.connectedBy}` : ''}`],
          ]}
        />
      )}
      {wa.lastError && <ErrorNote>{wa.lastError}</ErrorNote>}
      {canEdit && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            connect.mutate(
              { ...f, accessToken: f.accessToken || undefined },
              { onSuccess: (r) => { setF((x) => ({ ...x, accessToken: '' })); toast.success('WhatsApp connected', r.displayNumber ?? '') }, onError: (er) => toast.error('Couldn’t connect', er.message) },
            )
          }}
        >
          <Field id="wa-phone-id" label="Phone number id" required>
            <TextInput id="wa-phone-id" inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF((x) => ({ ...x, phoneNumberId: e.target.value }))} />
          </Field>
          <Field id="wa-waba" label="Business account id" required>
            <TextInput id="wa-waba" inputMode="numeric" value={f.businessAccountId} onChange={(e) => setF((x) => ({ ...x, businessAccountId: e.target.value }))} />
          </Field>
          <Field id="wa-token" label="Access token" className="sm:col-span-2" hint={wa.tokenHint ? `Stored (${wa.tokenHint}). Leave empty to keep it.` : 'Write-only: it’s never shown again.'}>
            <TextInput id="wa-token" type="password" autoComplete="new-password" value={f.accessToken} onChange={(e) => setF((x) => ({ ...x, accessToken: e.target.value }))} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button write type="submit" loading={connect.isPending}>
              {wa.status === 'not_connected' ? 'Connect WhatsApp' : 'Save'}
            </Button>
            {wa.status !== 'not_connected' && (
              <Button write variant="ghost" loading={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => toast.success('WhatsApp disconnected'), onError: (er) => toast.error('Couldn’t disconnect', er.message) })}>
                <Unplug />
                Disconnect
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  )
}

function Templates({ wa, canEdit }: { wa: WhatsAppIntegration; canEdit: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const create = useIntegrationMutation(integrationsApi.createTemplate)
  const remove = useIntegrationMutation(integrationsApi.deleteTemplate)
  const [f, setF] = useState({ name: '', language: 'en' as 'en' | 'ar', category: 'utility' as WaCategory, body: '' })
  return (
    <Section
      title="Message templates"
      hint="Outside a 24-hour reply window WhatsApp only allows approved templates. Use {{1}}, {{2}}… for the parts you fill in when sending."
      action={
        canEdit && (
          <Button write size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus />
            New template
          </Button>
        )
      }
    >
      <ul className="divide-y divide-line rounded-lg border border-line">
        {wa.templates.map((t) => (
          <li key={t.id} className="space-y-1 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[0.8125rem] text-ink">{t.name}</span>
              <Badge tone="neutral">{t.language === 'ar' ? 'Arabic' : 'English'}</Badge>
              <Badge tone="neutral">{t.category}</Badge>
              <Badge tone={TPL_TONE[t.status]}>{t.status}</Badge>
              {canEdit && (
                <Button write variant="ghost" size="xs" iconOnly className="ms-auto" aria-label={`Delete ${t.name}`} onClick={() => remove.mutate(t.id, { onError: (er) => toast.error('Couldn’t delete', er.message) })}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <p className="text-xs whitespace-pre-wrap text-ink-2" dir={t.language === 'ar' ? 'rtl' : undefined}>
              {t.body}
            </p>
            {t.rejectionReason && <p className="text-xs text-danger-600">{t.rejectionReason}</p>}
          </li>
        ))}
        {wa.templates.length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No templates yet.</li>}
      </ul>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New WhatsApp template"
        description="Submitted to WhatsApp for review (simulated: decided a few seconds later)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              write
              loading={create.isPending}
              onClick={() =>
                create.mutate(f, {
                  onSuccess: () => {
                    toast.success('Template submitted', 'It shows as pending until the review decides.')
                    setOpen(false)
                    setF({ name: '', language: 'en', category: 'utility', body: '' })
                  },
                  onError: (er) => toast.error('Couldn’t submit', er.message),
                })
              }
            >
              Submit for review
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="tpl-name" label="Name" hint="Lowercase letters, digits and underscores.">
            <TextInput id="tpl-name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="tpl-lang" label="Language">
              <SelectInput id="tpl-lang" value={f.language} onChange={(e) => setF((x) => ({ ...x, language: e.target.value as 'en' | 'ar' }))}>
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </SelectInput>
            </Field>
            <Field id="tpl-cat" label="Category">
              <SelectInput id="tpl-cat" value={f.category} onChange={(e) => setF((x) => ({ ...x, category: e.target.value as WaCategory }))}>
                <option value="utility">Utility</option>
                <option value="marketing">Marketing</option>
                <option value="authentication">Authentication</option>
              </SelectInput>
            </Field>
          </div>
          <Field id="tpl-body" label="Body">
            <TextArea id="tpl-body" rows={4} value={f.body} dir={f.language === 'ar' ? 'rtl' : undefined} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))} placeholder="Hi {{1}}, …" />
          </Field>
        </div>
      </Modal>
    </Section>
  )
}

function Conversations({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const q = useConversations()
  const inbound = useIntegrationMutation(integrationsApi.simulateInbound)
  const toLead = useIntegrationMutation((v: { id: string; company: string }) => integrationsApi.leadFromConversation(v.id, v.company), [['leads']])
  const [sim, setSim] = useState({ from: '', name: '', text: '' })
  return (
    <Section title="Conversations" hint="Inbound WhatsApp messages. Messages from a lead’s number are logged on the lead.">
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {(q.data ?? []).map((c) => (
            <li key={c.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <MessageCircle className="size-4 text-success-600" aria-hidden />
                <span className="text-[0.8125rem] font-medium">{c.name}</span>
                <span className="num text-xs text-muted">{c.from}</span>
                <span className="ms-auto text-xs text-muted">{when(c.lastMessageAt)}</span>
              </div>
              {c.messages.slice(-2).map((msg) => (
                <p key={msg.id} className={msg.direction === 'in' ? 'text-xs text-ink-2' : 'text-xs text-muted italic'}>
                  {msg.direction === 'in' ? '← ' : '→ '}
                  {msg.text}
                </p>
              ))}
              {c.leadId ? (
                <Link to={leadPath(c.leadId)} className="text-xs text-brand-700 hover:underline dark:text-brand-300">
                  Lead {c.leadCompany ?? c.leadId}
                </Link>
              ) : (
                <Button write size="xs" variant="secondary" loading={toLead.isPending && toLead.variables?.id === c.id} onClick={() => toLead.mutate({ id: c.id, company: c.name === 'Unknown sender' ? '' : c.name }, { onSuccess: (r) => toast.success('Lead created', r.leadCompany ?? ''), onError: (er) => toast.error('Couldn’t create the lead', er.message) })}>
                  <UserPlus />
                  Create lead
                </Button>
              )}
            </li>
          ))}
          {(q.data ?? []).length === 0 && <li className="px-3 py-4 text-center text-[0.8125rem] text-muted">No conversations yet.</li>}
        </ul>
      )}
      {canEdit && (
        <details className="rounded-lg border border-dashed border-line p-3">
          <summary className="cursor-pointer text-xs text-muted">Simulate an inbound message (demo)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <TextInput aria-label="From number" placeholder="Mobile number" value={sim.from} onChange={(e) => setSim((x) => ({ ...x, from: e.target.value }))} />
            <TextInput aria-label="Sender name" placeholder="Name (optional)" value={sim.name} onChange={(e) => setSim((x) => ({ ...x, name: e.target.value }))} />
            <TextInput aria-label="Message" placeholder="Message" value={sim.text} onChange={(e) => setSim((x) => ({ ...x, text: e.target.value }))} />
          </div>
          <Button write size="xs" variant="secondary" className="mt-2" loading={inbound.isPending} onClick={() => inbound.mutate(sim, { onSuccess: () => setSim({ from: '', name: '', text: '' }), onError: (er) => toast.error('Couldn’t simulate', er.message) })}>
            <Send />
            Receive
          </Button>
        </details>
      )}
    </Section>
  )
}
