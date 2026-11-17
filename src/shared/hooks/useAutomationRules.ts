import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAutomationRules, resetAutomationRules, saveAutomationRules } from '@/modules/settings/api/settingsApi'
import { DEFAULT_AUTOMATION_RULES, type AutomationRules } from '@/modules/settings/types'

export const automationKeys = {
  all: ['automation-rules'] as const,
}

/** The lead-journey automation numbers (Settings > Automation). Readable by every signed-in user. */
export function useAutomationRules() {
  const query = useQuery({ queryKey: automationKeys.all, queryFn: getAutomationRules, staleTime: 5 * 60_000 })
  return { ...query, rules: query.data ?? DEFAULT_AUTOMATION_RULES }
}

export function useSaveAutomationRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<AutomationRules>) => saveAutomationRules(input),
    onSuccess: (rules) => {
      qc.setQueryData(automationKeys.all, rules)
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}

export function useResetAutomationRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resetAutomationRules,
    onSuccess: (rules) => {
      qc.setQueryData(automationKeys.all, rules)
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
