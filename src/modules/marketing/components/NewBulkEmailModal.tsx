import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/shared/components/ui/Modal'
import { Button } from '@/shared/components/ui/Button'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { useCreateBulkEmail, useMarketingOptions } from '@/modules/marketing/hooks/useMarketing'
import { bulkEmailPath } from '@/modules/marketing/paths'

/** Starts a bulk email: a name, an optional campaign and an optional Settings › Templates email template. */
export function NewBulkEmailModal({ open, onClose, campaignId }: { open: boolean; onClose: () => void; campaignId?: string }) {
  const navigate = useNavigate()
  const options = useMarketingOptions()
  const create = useCreateBulkEmail()
  const [name, setName] = useState('')
  const [campaign, setCampaign] = useState(campaignId ?? '')
  const [template, setTemplate] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setCampaign(campaignId ?? '')
      setTemplate('')
      setError('')
    }
  }, [open, campaignId])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give the bulk email a name.')
    create.mutate(
      { name: name.trim(), campaignId: campaign || null, templateId: template || null },
      {
        onSuccess: (created) => {
          onClose()
          navigate(bulkEmailPath(created.id))
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New bulk email"
      description="Pick a template to start from, or write it from scratch in the email builder."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button write type="submit" form="new-bulk-email" loading={create.isPending}>
            Open email builder
          </Button>
        </div>
      }
    >
      <form id="new-bulk-email" onSubmit={submit} className="space-y-4" noValidate>
        <Field id="be-name" label="Name" required error={error || undefined}>
          <TextInput id="be-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. December newsletter" autoFocus />
        </Field>
        <Field id="be-campaign" label="Campaign" hint="Opens and replies count toward this campaign’s results.">
          <SelectInput id="be-campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">No campaign</option>
            {(options.data?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field id="be-template" label="Start from template">
          <SelectInput id="be-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">Blank email</option>
            {(options.data?.templates ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </Modal>
  )
}
