import { useEffect, useState, type FormEvent } from 'react'
import type { ActivityType } from '@/shared/types'
import { useLogActivity } from '@/modules/leads/hooks/useLeads'
import type { ActivityView } from '@/modules/leads/types'
import { useToast } from '@/shared/components/ui/Toast'
import { ACTIVITY_LABELS, ACTIVITY_TYPES, OUTREACH_TYPES } from '@/shared/lib/constants'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, TextArea } from '@/shared/components/form/Field'

interface LogActivityModalProps {
  open: boolean
  onClose: () => void
  leadId: string
  doNotContact: boolean
  /** Called with the saved activity; `activity.autoStatus` is set when the lead moved automatically. */
  onLogged: (activity: ActivityView) => void
}

export function LogActivityModal({ open, onClose, leadId, doNotContact, onLogged }: LogActivityModalProps) {
  const log = useLogActivity(leadId)
  const toast = useToast()
  const firstAllowed = doNotContact ? 'visit' : 'call'
  const [type, setType] = useState<ActivityType>(firstAllowed)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setType(firstAllowed)
    setSummary('')
    setError('')
    log.reset()
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!summary.trim()) {
      setError('Add a short summary of what happened.')
      return
    }
    setError('')
    log.mutate(
      { type, summary },
      {
        onSuccess: (activity) => {
          onLogged(activity)
          // Automation: No response → Cold after `attemptsBeforeCold` unanswered attempts.
          if (activity.autoStatus) {
            const { label, attempts } = activity.autoStatus
            toast.info(`Moved to ${label} after ${attempts} attempts with no reply`, 'Automatic follow-ups stop while the lead is parked.')
          }
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log activity"
      description="It’s added to the timeline and counts toward this month’s targets."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="log-activity-form" loading={log.isPending}>
            Log {ACTIVITY_LABELS[type].toLowerCase()}
          </Button>
        </>
      }
    >
      <form id="log-activity-form" noValidate onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Type</legend>
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_TYPES.map((t) => {
              const blocked = doNotContact && OUTREACH_TYPES.includes(t)
              return (
                <label
                  key={t}
                  className={cn(
                    'inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500',
                    blocked
                      ? 'cursor-not-allowed border-line text-muted/60 line-through'
                      : type === t
                        ? 'cursor-pointer border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                        : 'cursor-pointer border-line text-muted hover:text-ink',
                  )}
                >
                  <input
                    type="radio"
                    name="activity-type"
                    value={t}
                    checked={type === t}
                    disabled={blocked}
                    onChange={() => setType(t)}
                    className="sr-only"
                  />
                  {ACTIVITY_LABELS[t]}
                </label>
              )
            })}
          </div>
          {doNotContact && (
            <p className="mt-2 text-xs text-muted">Calls, emails and WhatsApp are blocked while Do Not Contact is on.</p>
          )}
        </fieldset>

        <Field id="activity-summary" label="Summary" required error={error}>
          <TextArea
            id="activity-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Spoke with the practice manager; they want a demo next week."
            invalid={!!error}
            aria-describedby={error ? 'activity-summary-error' : undefined}
          />
        </Field>

        {log.isError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-700/20 dark:text-danger-500">
            {log.error.message}
          </p>
        )}
      </form>
    </Modal>
  )
}
