import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { aiInputMapper, aiMapper, aiSettingsMapper } from '@/shared/api/aiMappers'
import { useEntitlements } from '@/modules/billing/hooks'
import { useCurrentUser } from '@/store/hooks'
import type {
  AiConfirmResult,
  AiConversation,
  AiConversationDetail,
  AiMe,
  AiPostResult,
  AiRecordRef,
  AiSettings,
  AiSettingsInput,
  AiUsageReport,
} from './types'

/** AI assistant (docs/API.md › AI assistant). Plan module `ai`. */

const enc = encodeURIComponent

export const aiApi = {
  me: async () => aiMapper.fromApi<AiMe>((await http.get<unknown>('/ai/me')).data),
  conversations: async () => aiMapper.fromApiList<AiConversation>((await http.get<unknown>('/ai/conversations')).data),
  conversation: async (id: string) => aiMapper.fromApi<AiConversationDetail>((await http.get<unknown>(`/ai/conversations/${enc(id)}`)).data),
  create: async (title?: string) => aiMapper.fromApi<AiConversationDetail>((await http.post<unknown>('/ai/conversations', title ? { title } : {})).data),
  rename: async (id: string, title: string) => aiMapper.fromApi<AiConversation>((await http.patch<unknown>(`/ai/conversations/${enc(id)}`, { title })).data),
  remove: async (id: string) => (await http.delete<unknown>(`/ai/conversations/${enc(id)}`)).data,
  post: async (id: string, content: string, context: AiRecordRef | null) =>
    aiMapper.fromApi<AiPostResult>((await http.post<unknown>(`/ai/conversations/${enc(id)}/messages`, aiInputMapper.toApi({ content, ...(context ? { context } : {}) }))).data),
  confirm: async (id: string, input: Record<string, unknown>) => aiMapper.fromApi<AiConfirmResult>((await http.post<unknown>(`/ai/actions/${enc(id)}/confirm`, aiInputMapper.toApi({ input }))).data),
  cancel: async (id: string) => aiMapper.fromApi<AiConfirmResult>((await http.post<unknown>(`/ai/actions/${enc(id)}/cancel`)).data),
  settings: async () => aiSettingsMapper.fromApi<AiSettings>((await http.get<unknown>('/ai/settings')).data),
  saveSettings: async (input: AiSettingsInput) => aiSettingsMapper.fromApi<AiSettings>((await http.put<unknown>('/ai/settings', aiSettingsMapper.toApi(input as never))).data),
  usage: async () => aiMapper.fromApi<AiUsageReport>((await http.get<unknown>('/ai/usage')).data),
}

/** Query keys per user: conversations are private, never shared across sign-ins in one tab. */
export function useAiKey() {
  const uid = useCurrentUser()?.id ?? 'anonymous'
  return (...rest: (string | number | undefined)[]) => ['ai', uid, ...rest] as const
}

/** The plan includes `ai`. */
export function useAiOn(): boolean {
  const ent = useEntitlements()
  return !!useCurrentUser() && ent.hasModule('ai')
}

export function useAiMe() {
  const key = useAiKey()
  return useQuery({ queryKey: key('me'), queryFn: aiApi.me, enabled: useAiOn(), retry: false })
}

export function useAiConversations() {
  const key = useAiKey()
  return useQuery({ queryKey: key('conversations'), queryFn: aiApi.conversations, enabled: useAiOn(), retry: false })
}

export function useAiConversation(id: string | null) {
  const key = useAiKey()
  return useQuery({ queryKey: key('conversation', id ?? ''), queryFn: () => aiApi.conversation(id!), enabled: useAiOn() && !!id, retry: false })
}

export function useAiSettings(enabled: boolean) {
  const key = useAiKey()
  return useQuery({ queryKey: key('settings'), queryFn: aiApi.settings, enabled: useAiOn() && enabled, retry: false })
}

export function useAiUsage(enabled: boolean) {
  const key = useAiKey()
  return useQuery({ queryKey: key('usage'), queryFn: aiApi.usage, enabled: useAiOn() && enabled, retry: false })
}

export function useInvalidateAi() {
  const qc = useQueryClient()
  const key = useAiKey()
  return (what: 'conversations' | 'me' | 'settings' | 'usage' | 'all' = 'all') => qc.invalidateQueries({ queryKey: what === 'all' ? key() : key(what) })
}

export function useSaveAiSettings() {
  const invalidate = useInvalidateAi()
  return useMutation({ mutationFn: aiApi.saveSettings, onSuccess: () => void invalidate('all') })
}
