import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ListTodo, Send } from 'lucide-react'
import type { EventDetail, FollowUpResult } from '@/modules/events/types'
import { sendFollowUp } from '@/modules/events/api/eventsAdvancedApi'
import { useMarketingAccess, useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { bulkEmailPath } from '@/modules/marketing/paths'
import { useEntitlements } from '@/modules/billing/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput } from '@/shared/components/form/Field'

/**
 * After the event: completing it creates a follow-up task per lead (once); "Send follow-up" composes two
 * bulk email drafts (checked-in attendees vs no-shows) on two dynamic audiences.
 */
export function AfterEventCard({ event: e }: { event: EventDetail }) {
  const access = useMarketingAccess()
  const ent = useEntitlements()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<FollowUpResult | null>(null)
  const completed = e.status === 'completed'
  return (
    <Card>
      <CardHeader
        title="After the event"
        icon={<ListTodo />}
        description={
          completed
            ? `Each lead from the event got a follow-up task for its owner (due ${e.followUpDays} day${e.followUpDays === 1 ? '' : 's'} after completion).`
            : `When the event is completed, each lead from it gets a follow-up task for its owner, due ${e.followUpDays} day${e.followUpDays === 1 ? '' : 's'} later.`
        }
        action={
          completed &&
          access.canEdit &&
          ent.hasModule('marketing') && (
            <Button write size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Send />
              Send follow-up
            </Button>
          )
        }
      />
      {result && (
        <CardBody className="space-y-1 text-[0.8125rem]">
          <p>Drafts ready in Marketing › Bulk email:</p>
          <p>
            <Link to={bulkEmailPath(result.attended.id)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{result.attended.name}</Link>
            {' · '}
            <Link to={bulkEmailPath(result.noShow.id)} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{result.noShow.name}</Link>
          </p>
        </CardBody>
      )}
      {open && <FollowUpModal event={e} onClose={() => setOpen(false)} onDone={setResult} />}
    </Card>
  )
}

function FollowUpModal({ event: e, onClose, onDone }: { event: EventDetail; onClose: () => void; onDone: (r: FollowUpResult) => void }) {
  const options = useMarketingOptions()
  const qc = useQueryClient()
  const toast = useToast()
  const [attended, setAttended] = useState('')
  const [noShow, setNoShow] = useState('')
  const send = useMutation({
    mutationFn: () => sendFollowUp(e.id, { attendedTemplateId: attended || null, noShowTemplateId: noShow || null }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['marketing'] })
      toast.success('Follow-up drafts created', 'Review and send them from Marketing.')
      onDone(r)
      onClose()
    },
    onError: (err) => toast.error('Not created', err.message),
  })
  const templates = options.data?.templates ?? []
  return (
    <Modal
      open
      onClose={onClose}
      title="Send follow-up"
      description="Two bulk email drafts: checked-in attendees and no-shows (registered, never checked in). {{event.survey_url}} gives each attendee their feedback survey link."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button write loading={send.isPending} onClick={() => send.mutate()}>Create drafts</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field id="fu-attended" label="Attendees">
          <SelectInput id="fu-attended" value={attended} onChange={(ev) => setAttended(ev.target.value)}>
            <option value="">Thank-you email with the survey link</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectInput>
        </Field>
        <Field id="fu-noshow" label="No-shows">
          <SelectInput id="fu-noshow" value={noShow} onChange={(ev) => setNoShow(ev.target.value)}>
            <option value="">“Sorry we missed you” email</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectInput>
        </Field>
      </div>
    </Modal>
  )
}
