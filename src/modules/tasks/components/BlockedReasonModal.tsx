import { useEffect, useId, useState } from 'react'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { Field, TextArea } from '@/shared/components/form/Field'
import { BLOCKED_REASON_MAX, blockedReasonSchema as reasonSchema } from '@/modules/tasks/schemas'

/** Asks why a task is blocked; the API requires the reason (blockedReason) and posts it as a comment. */
export function BlockedReasonModal({
  open,
  taskTitle,
  onClose,
  onConfirm,
}: {
  open: boolean
  taskTitle: string
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (open) {
      setValue('')
      setError(undefined)
    }
  }, [open])

  function submit() {
    const r = reasonSchema.safeParse(value)
    if (!r.success) {
      setError(r.error.issues[0]?.message)
      return
    }
    onConfirm(r.data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Why is it blocked?"
      description={taskTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write onClick={submit}>Mark blocked</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field id={id} label="Reason" required error={error} hint="Posted as a comment so followers know what it’s waiting on.">
          <TextArea
            id={id}
            value={value}
            invalid={!!error}
            maxLength={BLOCKED_REASON_MAX}
            className="min-h-20"
            placeholder="e.g. Waiting for the customer’s trade licence"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </Field>
      </form>
    </Modal>
  )
}
