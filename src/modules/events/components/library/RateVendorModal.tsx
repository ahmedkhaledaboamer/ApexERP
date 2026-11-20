import { useState } from 'react'
import { useReviewVendor } from '@/modules/events/hooks/useEventLibrary'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextArea } from '@/shared/components/form/Field'
import { RatingInput } from './LibraryBits'

/** "Rate after the event": a 1–5 rating and review notes for a vendor's work on one completed event. */
export function RateVendorModal({ vendorId, vendorName, eventId, eventName, onClose }: { vendorId: string; vendorName: string; eventId: string; eventName: string; onClose: () => void }) {
  const review = useReviewVendor()
  const toast = useToast()
  const [value, setValue] = useState(4)
  const [notes, setNotes] = useState('')
  return (
    <Modal
      open
      onClose={onClose}
      title={`Rate ${vendorName}`}
      description={`Their work on ${eventName}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            write
            loading={review.isPending}
            onClick={() =>
              review.mutate(
                { id: vendorId, input: { eventId, rating: value, notes } },
                { onSuccess: () => { toast.success('Review saved', vendorName); onClose() }, onError: (err) => toast.error('Not saved', err.message) },
              )
            }
          >
            Save review
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <RatingInput value={value} onChange={setValue} label="Vendor rating" />
        <Field id="vendor-review-notes" label="Review notes">
          <TextArea id="vendor-review-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quality, timing, communication…" />
        </Field>
      </div>
    </Modal>
  )
}
