import { useMemo, useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import type { LeadDetail } from '@/modules/leads/types'
import { integrationsApi, useIntegrationMutation, useIntegrationsAccess, useSendOptions } from '@/modules/integrations/api'
import { recipientsFor } from '@/modules/leads/components/composer/compose'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, SelectInput, TextInput } from '@/shared/components/form/Field'
import { Tooltip } from '@/shared/components/ui/Kbd'

const fill = (body: string, params: string[]) => body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] || `{{${n}}}`)

/**
 * Lead detail header: "WhatsApp template" — send an approved WhatsApp Business template with its parameters to one of
 * the lead's mobiles; logged as a WhatsApp activity on the lead. Hidden without the Integrations module or a connected
 * number; disabled for Do Not Contact leads.
 */
export function WhatsAppTemplateButton({ lead, onSent }: { lead: LeadDetail; onSent?: () => void }) {
  const toast = useToast()
  const { inPlan, canContactLeads } = useIntegrationsAccess()
  const q = useSendOptions(inPlan && canContactLeads)
  const [open, setOpen] = useState(false)
  const recipients = useMemo(() => recipientsFor(lead, 'whatsapp'), [lead])
  const [templateId, setTemplateId] = useState('')
  const [to, setTo] = useState('')
  const [params, setParams] = useState<string[]>([])
  const send = useIntegrationMutation(integrationsApi.sendTemplate, [['leads']])
  if (!inPlan || !canContactLeads || !q.data?.connected || q.data.templates.length === 0) return null
  const templates = q.data.templates
  const t = templates.find((x) => x.id === templateId) ?? templates[0]
  const recipient = to || recipients[0]?.address || ''
  const blocked = lead.doNotContact ? 'Do Not Contact is on for this lead' : recipients.length === 0 ? 'No contact on this lead has a valid mobile' : null
  const button = (
    <Button write variant="secondary" size="sm" disabled={!!blocked} aria-label={blocked ? `WhatsApp template: ${blocked}` : undefined} onClick={() => { setTemplateId(templates[0].id); setParams([lead.contactName.split(' ')[0] ?? '']); setOpen(true) }}>
      <MessageSquareText />
      WhatsApp template
    </Button>
  )
  return (
    <>
      {blocked ? (
        <Tooltip label={blocked} side="bottom">
          {button}
        </Tooltip>
      ) : (
        button
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Send a WhatsApp template"
        description={`From ${q.data.displayNumber}. Logged on the lead’s timeline.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              write
              loading={send.isPending}
              onClick={() =>
                send.mutate(
                  { leadId: lead.id, templateId: t.id, to: recipient, params: params.slice(0, t.params) },
                  {
                    onSuccess: () => {
                      toast.success('WhatsApp sent', `Template “${t.name}”.`)
                      setOpen(false)
                      onSent?.()
                    },
                    onError: (e) => toast.error('Not sent', e.message),
                  },
                )
              }
            >
              Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field id="wa-template" label="Template">
            <SelectInput id="wa-template" value={t.id} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.language === 'ar' ? 'Arabic' : 'English'})
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id="wa-to" label="To">
            <SelectInput id="wa-to" value={recipient} onChange={(e) => setTo(e.target.value)}>
              {recipients.map((r) => (
                <option key={`${r.id}-${r.address}`} value={r.address}>
                  {r.name} · {r.address}
                </option>
              ))}
            </SelectInput>
          </Field>
          {Array.from({ length: t.params }, (_, i) => (
            <Field key={i} id={`wa-param-${i + 1}`} label={`Parameter {{${i + 1}}}`}>
              <TextInput id={`wa-param-${i + 1}`} value={params[i] ?? ''} onChange={(e) => setParams((p) => { const n = [...p]; n[i] = e.target.value; return n })} />
            </Field>
          ))}
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Preview</p>
            <p className="rounded-lg bg-success-50 px-3 py-2 text-[0.8125rem] whitespace-pre-wrap text-ink dark:bg-success-500/10" data-testid="wa-preview" dir={t.language === 'ar' ? 'rtl' : undefined}>
              {fill(t.body, params)}
            </p>
          </div>
        </div>
      </Modal>
    </>
  )
}
