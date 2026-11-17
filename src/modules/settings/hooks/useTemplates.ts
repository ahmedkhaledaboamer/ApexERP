import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createTemplate,
  duplicateTemplate,
  getTemplate,
  getTemplates,
  makeDefaultTemplate,
  setTemplateActive,
  updateTemplate,
} from '@/modules/settings/api/templatesApi'
import type {
  MessageTemplate,
  TemplateChannel,
  TemplateInput,
  TemplatePurpose,
  TemplateUpdateInput,
} from '@/modules/settings/templates/types'
import { useCurrentUser } from '@/store/hooks'

export const templateKeys = {
  all: ['templates'] as const,
  list: (userId: string) => ['templates', 'list', userId] as const,
  detail: (userId: string, id: string) => ['templates', 'detail', userId, id] as const,
}

function useUserId() {
  return useCurrentUser()?.id ?? 'anon'
}

/**
 * Every template the caller may see (active ones for everybody; inactive ones too for Settings
 * viewers). One list, filtered client-side: there are only a few dozen templates.
 */
export function useTemplatesQuery() {
  const userId = useUserId()
  return useQuery({ queryKey: templateKeys.list(userId), queryFn: () => getTemplates(), staleTime: 60_000 })
}

export function useTemplateQuery(id: string) {
  const userId = useUserId()
  return useQuery({ queryKey: templateKeys.detail(userId, id), queryFn: () => getTemplate(id), enabled: !!id })
}

/**
 * Active templates for a channel (and purpose), default first, plus the default itself.
 * For pickers in the lead page, quotations and the AI agent.
 */
export function useTemplatesFor(channel: TemplateChannel, purpose?: TemplatePurpose) {
  const query = useTemplatesQuery()
  return useMemo(() => {
    const options = (query.data ?? [])
      .filter((t) => t.active && t.channel === channel && (!purpose || t.purpose === purpose))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
    return { ...query, options, defaultTemplate: purpose ? (options.find((t) => t.isDefault) ?? null) : null }
  }, [query, channel, purpose])
}

/** Writes the fresh template into the caches; refetches lists when other rows may have changed. */
function useSync() {
  const userId = useUserId()
  const qc = useQueryClient()
  return (t: MessageTemplate, { refetch = false } = {}) => {
    qc.setQueryData(templateKeys.detail(userId, t.id), t)
    qc.setQueryData<MessageTemplate[]>(templateKeys.list(userId), (rows) => {
      if (!rows) return rows
      return rows.some((r) => r.id === t.id) ? rows.map((r) => (r.id === t.id ? t : r)) : [...rows, t]
    })
    // A default moves between templates, and the audit log grows: refresh both.
    if (refetch) void qc.invalidateQueries({ queryKey: templateKeys.all })
    void qc.invalidateQueries({ queryKey: ['audit'] })
  }
}

export function useCreateTemplate() {
  const sync = useSync()
  return useMutation({ mutationFn: (input: TemplateInput) => createTemplate(input), onSuccess: (t) => sync(t) })
}

export function useUpdateTemplate() {
  const sync = useSync()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TemplateUpdateInput }) => updateTemplate(id, input),
    onSuccess: (t) => sync(t, { refetch: true }),
  })
}

export function useDuplicateTemplate() {
  const sync = useSync()
  return useMutation({ mutationFn: (id: string) => duplicateTemplate(id), onSuccess: (t) => sync(t) })
}

export function useMakeDefaultTemplate() {
  const sync = useSync()
  return useMutation({ mutationFn: (id: string) => makeDefaultTemplate(id), onSuccess: (t) => sync(t, { refetch: true }) })
}

export function useSetTemplateActive() {
  const sync = useSync()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setTemplateActive(id, active),
    onSuccess: (t) => sync(t, { refetch: true }),
  })
}
