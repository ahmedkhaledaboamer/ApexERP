import { useMemo } from 'react'
import type { TaskLinkView } from '@/modules/tasks/types'
import { useLeadQuery } from '@/modules/leads/hooks/useLeads'
import { LinkedTasksPanel } from '@/modules/tasks/components/LinkedTasksPanel'

/** Lead page Tasks tab: tasks linked to the lead (unified task store), quick add and the task drawer. */
export function TasksList({ leadId }: { leadId: string }) {
  const lead = useLeadQuery(leadId)
  const link = useMemo<TaskLinkView>(
    () => ({ type: 'lead', id: leadId, label: lead.data?.company ?? leadId, available: true }),
    [leadId, lead.data?.company],
  )
  const filters = useMemo(() => [{ linkType: 'lead' as const, linkId: leadId, includeDone: true }], [leadId])
  return (
    <LinkedTasksPanel
      link={link}
      filters={filters}
      hideLink
      emptyBody="Tasks linked to this lead, like preparing a proposal or a call back, show here."
    />
  )
}
