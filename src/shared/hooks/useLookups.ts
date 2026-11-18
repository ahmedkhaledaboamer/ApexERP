import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getLookups, saveLookupList } from '@/modules/settings/api/settingsApi'
import type { IndustryOption, ListOption, LookupList, Lookups, StatusOption } from '@/modules/settings/types'
import { isClosedType, isParkedType } from '@/shared/domain/leadStatus'

export const lookupKeys = {
  all: ['lookups'] as const,
}

const EMPTY: Lookups = { statuses: [], sources: [], industries: [], lossReasons: [], tags: [], serviceCategories: [] }

const byOrder = <T extends ListOption>(list: T[]) => [...list].sort((a, b) => a.order - b.order)
/** Picker items: active and not a protected system item hidden from pickers. */
const activeOnly = <T extends ListOption>(list: T[]) => byOrder(list).filter((i) => i.active && !i.hiddenFromPickers)

const FALLBACK_STATUS: Omit<StatusOption, 'key' | 'label'> = {
  active: false,
  order: 999,
  probability: 0,
  type: 'open',
  requiresNextStep: false,
  requiresLossReason: false,
  tone: 'neutral',
  color: '#a1a1ab',
  system: false,
}

/**
 * The single source for every fixed list (Settings > Fixed lists): statuses, sources,
 * industries with sub-industries, loss reasons and tags. Pickers use the `active` lists;
 * display code uses the lookups by key so records with deactivated values still render.
 */
export function useLookups() {
  const query = useQuery({ queryKey: lookupKeys.all, queryFn: getLookups, staleTime: 5 * 60_000 })
  const data = query.data ?? EMPTY

  return useMemo(() => {
    const statusMap = new Map(data.statuses.map((s) => [s.key, s]))
    const industryMap = new Map(data.industries.map((i) => [i.key, i]))
    const label = (list: ListOption[], key: string | null | undefined) =>
      (key && list.find((i) => i.key === key)?.label) || key || '—'

    function status(key: string): StatusOption {
      return statusMap.get(key) ?? { ...FALLBACK_STATUS, key, label: key }
    }

    return {
      isLoading: query.isPending,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
      /** Raw lists (all items, sorted), for admin screens. */
      all: {
        statuses: byOrder(data.statuses),
        sources: byOrder(data.sources),
        industries: byOrder(data.industries),
        lossReasons: byOrder(data.lossReasons),
        tags: byOrder(data.tags),
        serviceCategories: byOrder(data.serviceCategories ?? []),
      },
      /** Active items only, sorted: use these in pickers. */
      statuses: activeOnly(data.statuses),
      sources: activeOnly(data.sources),
      industries: activeOnly(data.industries) as IndustryOption[],
      lossReasons: activeOnly(data.lossReasons),
      tags: activeOnly(data.tags),
      serviceCategories: activeOnly(data.serviceCategories ?? []),

      status,
      statusLabel: (key: string) => status(key).label,
      probability: (key: string) => status(key).probability,
      /** Out of the active pipeline: won, lost, cold or parked. */
      isClosed: (key: string) => isClosedType(status(key).type),
      isWon: (key: string) => status(key).type === 'won',
      isLost: (key: string) => status(key).type === 'lost',
      /** Cold or another parked status. */
      isParked: (key: string) => isParkedType(status(key).type),
      /** Active statuses of the open pipeline, in order (kanban columns, funnels). */
      openStatuses: activeOnly(data.statuses).filter((s) => s.type === 'open'),
      closedStatusKeys: data.statuses.filter((s) => isClosedType(s.type)).map((s) => s.key),

      sourceLabel: (key: string | null | undefined) => label(data.sources, key),
      industryLabel: (key: string | null | undefined) => label(data.industries, key),
      subIndustryLabel: (industryKey: string, key: string | null | undefined) =>
        label(industryMap.get(industryKey)?.subIndustries ?? [], key),
      lossReasonLabel: (key: string | null | undefined) => label(data.lossReasons, key),
      tagLabel: (key: string | null | undefined) => label(data.tags, key),
      serviceCategoryLabel: (key: string | null | undefined) => label(data.serviceCategories ?? [], key),
      /** Active sub-industries of an industry, for pickers. */
      subIndustriesOf: (industryKey: string) => activeOnly(industryMap.get(industryKey)?.subIndustries ?? []),
    }
  }, [data, query.isPending, query.isError, query.error, query.refetch])
}

export type LookupsApi = ReturnType<typeof useLookups>

/** Saves one list from the admin screen and refreshes every picker. */
export function useSaveLookupList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ list, items }: { list: LookupList; items: Lookups[LookupList] }) => saveLookupList(list, items),
    onSuccess: (lookups) => {
      qc.setQueryData(lookupKeys.all, lookups)
      qc.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}
