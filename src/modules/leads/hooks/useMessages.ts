import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendLeadMessage, type SendMessageInput } from '@/modules/leads/api/messagesApi'
import { leadKeys } from '@/modules/leads/queryKeys'

/** Sends an email / WhatsApp from the lead page. The server logs it as an activity. */
export function useSendMessage(leadId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendMessageInput) => sendLeadMessage(leadId, input),
    // The activity can move the lead (New → Contacted, No response → Cold): refresh what shows it.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadKeys.all })
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
