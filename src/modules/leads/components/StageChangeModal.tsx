import { useEffect, useState, type FormEvent } from 'react'
import { addDays, format } from 'date-fns'
import type { LeadStatus } from '@/shared/types'
import type { LeadRow, MoveLeadInput } from '@/modules/leads/types'
import type { StatusOption, StatusRequirement } from '@/modules/settings/types'
import { useLookups } from '@/shared/hooks/useLookups'
import { composeLossReason } from '@/modules/leads/lossReason'
import { useOpenWonDialog } from '@/modules/won/hooks'
import { moveActionFor } from '@/modules/leads/lib/transitions'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, SelectInput, TextArea, TextInput } from '@/shared/components/form/Field'

export type StageRequirement = StatusRequirement

/**
 * What a lead must record before it can enter a stage (spec, section 4), as configured on the
 * status in Settings > Fixed lists (`status.requires`). Pass `useLookups().status(key)`.
 */
export function requirementFor(status: Pick<StatusOption, 'requires'>): StageRequirement {
  return status.requires
}

export interface PendingMove {
  lead: LeadRow
  to: LeadStatus
}

interface StageChangeModalProps {
  pending: PendingMove | null
  onCancel: () => void
  onConfirm: (input: MoveLeadInput) => void
}

export function StageChangeModal({ pending, onCancel, onConfirm }: StageChangeModalProps) {
  const lookups = useLookups()
  const requirement = pending ? requirementFor(lookups.status(pending.to)) : 'none'
  const [reason, setReason] = useState('')
  const [reasonDetail, setReasonDetail] = useState('')
  const [nextStep, setNextStep] = useState('')
  const [date, setDate] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const openWon = useOpenWonDialog()
  // Won (the 'convert' requirement) is never a plain stage move: hand over to the Won dialog.
  const isWonMove = !!pending && moveActionFor(lookups.status(pending.to)) === 'won'

  useEffect(() => {
    if (!pending || !isWonMove) return
    onCancel()
    openWon(pending.lead.id)
  }, [pending, isWonMove, onCancel, openWon])

  // Each new pending move starts from a clean form.
  useEffect(() => {
    if (!pending) return
    setReason('')
    setReasonDetail('')
    setNextStep(pending.lead.nextStep)
    setDate(format(addDays(new Date(), 2), 'yyyy-MM-dd'))
    setErrors({})
  }, [pending])

  if (!pending || isWonMove) return null
  const { lead, to: target } = pending
  const to = lookups.statusLabel(target)

  function submit(e: FormEvent) {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (requirement === 'loss-reason' && !reason) next.reason = 'Pick the reason this lead closed.'
    if (requirement === 'next-step') {
      if (!nextStep.trim()) next.nextStep = 'Describe the next step.'
      if (!date) next.date = 'Pick a date.'
      else if (date < format(new Date(), 'yyyy-MM-dd')) next.date = 'The date can’t be in the past.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const input: MoveLeadInput = { id: lead.id, status: target }
    if (requirement === 'loss-reason') input.lossReason = composeLossReason(reason, reasonDetail)
    if (requirement === 'next-step') {
      input.nextStep = nextStep.trim()
      input.nextFollowUpDate = new Date(`${date}T09:00:00`).toISOString()
    }
    onConfirm(input)
  }

  const copy = COPY[requirement]

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={copy.title(lead.company, to)}
      description={copy.description}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button write type="submit" form="stage-change-form">
            {copy.confirm(to)}
          </Button>
        </>
      }
    >
      <form id="stage-change-form" noValidate onSubmit={submit} className="space-y-4">
        {requirement === 'loss-reason' && (
          <>
            <Field id="sc-reason" label="Reason" required error={errors.reason}>
              <SelectInput id="sc-reason" value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.reason}>
                <option value="">Choose a reason…</option>
                {lookups.lossReasons.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field id="sc-detail" label="Details" hint="Optional — what would change their mind?">
              <TextArea id="sc-detail" value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} className="min-h-20" />
            </Field>
          </>
        )}

        {requirement === 'next-step' && (
          <>
            <Field id="sc-step" label="Next step" required error={errors.nextStep}>
              <TextInput
                id="sc-step"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                placeholder="e.g. Demo the booking chatbot to the clinic manager"
                invalid={!!errors.nextStep}
              />
            </Field>
            <Field id="sc-date" label="Date" required error={errors.date}>
              <TextInput id="sc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />
            </Field>
          </>
        )}

      </form>
    </Modal>
  )
}

const COPY: Record<
  StageRequirement,
  { title: (company: string, to: string) => string; description?: string; confirm: (to: string) => string }
> = {
  'loss-reason': {
    title: (company, to) => `Mark ${company} as ${to}`,
    description: 'A reason is required. No further automatic contact will be scheduled.',
    confirm: (to) => `Mark as ${to}`,
  },
  'next-step': {
    title: (company, to) => `Move ${company} to ${to}`,
    description: 'Record what happens next and when, so the follow-up lands on the right day.',
    confirm: (to) => `Move to ${to}`,
  },
  convert: {
    title: (company) => `Convert ${company} to a customer?`,
    confirm: (to) => `Mark as ${to} and convert`,
  },
  none: {
    title: (company, to) => `Move ${company} to ${to}`,
    confirm: (to) => `Move to ${to}`,
  },
}
