import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Send } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import { EVENT_EMAIL_KIND_LABEL } from '@/modules/events/types'
import { useEventEmailsQuery, useInviteAudience } from '@/modules/events/hooks/useEventsAdvanced'
import { useMarketingAccess, useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { useAudiencesQuery } from '@/modules/marketing/growth/hooks'
import { bulkEmailPath } from '@/modules/marketing/paths'
import { useEntitlements } from '@/modules/billing/hooks'
import { fmtDate } from '@/shared/lib/utils'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput } from '@/shared/components/form/Field'

/** Invitations & reminders: "Invite an audience" (a Marketing bulk email linked to the event) and the event's email log. */
export function EventCommsCard({ event: e }: { event: EventDetail }) {
  const access = useMarketingAccess()
  const ent = useEntitlements()
  const emails = useEventEmailsQuery(e.id)
  const [inviting, setInviting] = useState(false)
  const canInvite = access.canEdit && ent.hasModule('marketing') && e.status !== 'cancelled' && e.status !== 'completed'
  const log = emails.data ?? []
  return (
    <Card>
      <CardHeader
        title="Invitations & reminders"
        icon={<Mail />}
        description={e.reminderHours > 0 ? `Registered attendees get a reminder ${e.reminderHours} h before the start (once each, counted in your monthly emails).` : 'No reminder email for this event.'}
        action={
          canInvite && (
            <Button write size="sm" variant="secondary" onClick={() => setInviting(true)}>
              <Send />
              Invite an audience
            </Button>
          )
        }
      />
      <CardBody>
        {log.length === 0 ? (
          <p className="text-[0.8125rem] text-muted">No emails yet: confirmations, waitlist moves and reminders show here.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Event emails">
            {log.slice(0, 8).map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-[0.8125rem]">
                <Badge tone={m.status === 'sent' ? 'green' : 'neutral'}>{EVENT_EMAIL_KIND_LABEL[m.kind]}</Badge>
                <span className="min-w-0 flex-1 truncate">{m.attendeeName || m.to}</span>
                {m.status === 'skipped' && <span className="text-xs text-warning-700">{m.skipReason === 'limit' ? 'Skipped: email limit' : 'Skipped: no email'}</span>}
                <span className="num text-xs text-muted">{fmtDate(m.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {inviting && <InviteModal event={e} onClose={() => setInviting(false)} />}
    </Card>
  )
}

function InviteModal({ event: e, onClose }: { event: EventDetail; onClose: () => void }) {
  const options = useMarketingOptions()
  const audiences = useAudiencesQuery()
  const invite = useInviteAudience()
  const toast = useToast()
  const navigate = useNavigate()
  const [audienceId, setAudienceId] = useState('')
  const [templateId, setTemplateId] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite an audience"
      description="Creates a bulk email draft linked to this event. Finish it in the bulk email builder: exclusions, your monthly email limit and the send queue apply as usual. {{event.registration_url}} links to the registration page."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={invite.isPending}
            onClick={() =>
              invite.mutate(
                { id: e.id, input: { audienceId: audienceId || null, templateId: templateId || null } },
                {
                  onSuccess: (b) => {
                    toast.success('Invitation draft created', b.name)
                    onClose()
                    navigate(bulkEmailPath(b.id))
                  },
                  onError: (err) => toast.error('Not created', err.message),
                },
              )
            }
          >
            Create the email
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="inv-audience" label="Audience" hint="A saved audience (Marketing › Audiences); empty = every mailable lead, narrowed in the builder.">
          <SelectInput id="inv-audience" value={audienceId} onChange={(ev) => setAudienceId(ev.target.value)}>
            <option value="">All leads (narrow it in the builder)</option>
            {(audiences.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id="inv-template" label="Template" hint="Empty = a ready invitation with the registration link.">
          <SelectInput id="inv-template" value={templateId} onChange={(ev) => setTemplateId(ev.target.value)}>
            <option value="">Standard invitation</option>
            {(options.data?.templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </Modal>
  )
}
