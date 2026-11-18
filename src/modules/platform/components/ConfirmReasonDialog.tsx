import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from '@/shared/components/ui/Modal'
import { Button } from '@/shared/components/ui/Button'
import { Field, TextArea } from '@/shared/components/form/Field'
import { MIN_REASON } from '@/modules/platform/format'

interface ConfirmReasonDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  /** Extra fields (plan select, days…) shown above the reason. */
  children?: ReactNode
  /** False while the extra fields are incomplete. */
  canConfirm?: boolean
  minReason?: number
  reasonHint?: string
  pending?: boolean
  error?: string | null
  onConfirm: (reason: string) => void
  /** Stable id for browser checks; defaults to "confirm-dialog". */
  id?: string
}

/**
 * Every platform write (company action, module override, subdomain change, plan/settings edit) goes
 * through this: a confirm step with a REQUIRED reason, written to the platform audit log.
 */
export function ConfirmReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  children,
  canConfirm = true,
  minReason = MIN_REASON,
  reasonHint,
  pending,
  error,
  onConfirm,
  id = 'confirm-dialog',
}: ConfirmReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])

  const trimmed = reason.trim()
  const reasonOk = trimmed.length >= minReason
  const reasonError = touched && !reasonOk ? `Enter a reason (at least ${minReason} characters).` : undefined

  function submit() {
    setTouched(true)
    if (!reasonOk || !canConfirm || pending) return
    onConfirm(trimmed)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button id="confirm-cancel" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            id="confirm-submit"
            data-dialog={id}
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabled={!reasonOk || !canConfirm}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        id={id}
        data-confirm-dialog
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {children}
        <Field
          id="confirm-reason"
          label="Reason"
          required
          error={reasonError}
          hint={reasonHint ?? 'Required. Saved in the platform audit log with your name.'}
        >
          <TextArea
            id="confirm-reason"
            aria-label="Reason"
            aria-required="true"
            value={reason}
            invalid={!!reasonError}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Why are you making this change?"
            className="min-h-20"
          />
        </Field>
        {error && (
          <p role="alert" id="confirm-error" className="rounded-lg border border-danger-100 bg-danger-50 px-3 py-2 text-[0.8125rem] text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-500">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
