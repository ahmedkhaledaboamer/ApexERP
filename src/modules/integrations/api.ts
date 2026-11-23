import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/shared/lib/axios'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'
import { useEntitlements } from '@/modules/billing/hooks'
import * as m from '@/shared/api/integrationsMappers'
import type {
  ApiKeyInput,
  GatewayInput,
  GatewayProvider,
  InboundWebhookInput,
  IntegrationKey,
  OAuthCompleteInput,
  OAuthProvider,
  CalendarProvider,
  CalendarSettings,
  Sender,
  SenderPurpose,
  SmtpInput,
  SyncLogFilters,
  WaSendInput,
  WaTemplateInput,
  WebhookInput,
  WhatsAppConnectInput,
} from './types'

/** Insights & admin › Integrations (docs/API.md › Integrations). Snake_case on the wire, camelCase here. */

const enc = encodeURIComponent
const I = '/integrations'
const qs = (p: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  const t = s.toString()
  return t ? `?${t}` : ''
}
const toApi = (v: object) => m.integrationInputMapper.toApi(v as Record<string, unknown>)

export const integrationsApi = {
  overview: async () => m.overviewMapper.fromApi((await http.get<unknown>(I)).data),
  setPaused: async (key: IntegrationKey, paused: boolean) => m.overviewMapper.fromApi((await http.patch<unknown>(`${I}/state/${enc(key)}`, { paused })).data),
  oauthStart: async (purpose: 'email' | 'calendar', provider: OAuthProvider | CalendarProvider) => m.oauthConsentMapper.fromApi((await http.post<unknown>(`${I}/oauth/start`, { purpose, provider })).data),

  email: async () => m.emailMapper.fromApi((await http.get<unknown>(`${I}/email`)).data),
  emailLog: async (source?: string, status?: string) => m.emailLogMapper.fromApiList((await http.get<unknown>(`${I}/email/log${qs({ source, status })}`)).data),
  saveSmtp: async (input: SmtpInput) => m.emailMapper.fromApi((await http.put<unknown>(`${I}/email/smtp`, toApi(input))).data),
  connectEmail: async (input: OAuthCompleteInput) => m.emailMapper.fromApi((await http.post<unknown>(`${I}/email/connect`, toApi(input))).data),
  disconnectEmail: async () => m.emailMapper.fromApi((await http.delete<unknown>(`${I}/email`)).data),
  testEmail: async (to: string) => m.emailMapper.fromApi((await http.post<unknown>(`${I}/email/test`, { to })).data),
  verifyDomain: async () => m.emailMapper.fromApi((await http.post<unknown>(`${I}/email/verify-domain`)).data),
  updateSenders: async (senders: Partial<Record<SenderPurpose, Sender>>) => m.emailMapper.fromApi((await http.patch<unknown>(`${I}/email/senders`, toApi(senders))).data),

  website: async () => m.websiteMapper.fromApi((await http.get<unknown>(`${I}/website`)).data),
  updateInboundWebhook: async (input: InboundWebhookInput) => m.websiteMapper.fromApi((await http.put<unknown>(`${I}/website/webhook`, toApi(input))).data),
  rotateToken: async () => m.websiteMapper.fromApi((await http.post<unknown>(`${I}/website/webhook/rotate`)).data),
  previewMapping: async (payload: Record<string, unknown>) => m.mappingPreviewMapper.fromApi((await http.post<unknown>(`${I}/website/webhook/preview`, { payload })).data),

  whatsapp: async () => m.whatsappMapper.fromApi((await http.get<unknown>(`${I}/whatsapp`)).data),
  connectWhatsApp: async (input: WhatsAppConnectInput) => m.whatsappMapper.fromApi((await http.put<unknown>(`${I}/whatsapp`, toApi(input))).data),
  disconnectWhatsApp: async () => m.whatsappMapper.fromApi((await http.delete<unknown>(`${I}/whatsapp`)).data),
  createTemplate: async (input: WaTemplateInput) => m.whatsappMapper.fromApi((await http.post<unknown>(`${I}/whatsapp/templates`, toApi(input))).data),
  deleteTemplate: async (id: string) => m.whatsappMapper.fromApi((await http.delete<unknown>(`${I}/whatsapp/templates/${enc(id)}`)).data),
  sendOptions: async () => m.waSendOptionsMapper.fromApi((await http.get<unknown>(`${I}/whatsapp/send-options`)).data),
  sendTemplate: async (input: WaSendInput) => m.waSendResultMapper.fromApi((await http.post<unknown>(`${I}/whatsapp/messages`, toApi(input))).data),
  conversations: async () => m.waConversationMapper.fromApiList((await http.get<unknown>(`${I}/whatsapp/conversations`)).data),
  simulateInbound: async (input: { from: string; name: string; text: string }) => m.waConversationMapper.fromApi((await http.post<unknown>(`${I}/whatsapp/inbound`, input)).data),
  leadFromConversation: async (id: string, company: string) => m.waConversationMapper.fromApi((await http.post<unknown>(`${I}/whatsapp/conversations/${enc(id)}/lead`, { company })).data),

  myCalendar: async () => m.myCalendarMapper.fromApi((await http.get<unknown>(`${I}/calendar/me`)).data),
  connectCalendar: async (input: OAuthCompleteInput) => m.myCalendarMapper.fromApi((await http.post<unknown>(`${I}/calendar/me/connect`, toApi(input))).data),
  updateCalendar: async (input: Partial<CalendarSettings>) => m.myCalendarMapper.fromApi((await http.patch<unknown>(`${I}/calendar/me`, toApi(input))).data),
  syncCalendar: async () => m.myCalendarMapper.fromApi((await http.post<unknown>(`${I}/calendar/me/sync`)).data),
  disconnectCalendar: async () => m.myCalendarMapper.fromApi((await http.delete<unknown>(`${I}/calendar/me`)).data),
  calendarConnections: async () => m.calendarConnectionMapper.fromApiList((await http.get<unknown>(`${I}/calendar/connections`)).data),

  payments: async () => m.paymentsMapper.fromApi((await http.get<unknown>(`${I}/payments`)).data),
  saveGateway: async (p: GatewayProvider, input: GatewayInput) => m.paymentsMapper.fromApi((await http.put<unknown>(`${I}/payments/${p}`, toApi(input))).data),
  removeGateway: async (p: GatewayProvider) => m.paymentsMapper.fromApi((await http.delete<unknown>(`${I}/payments/${p}`)).data),
  defaultGateway: async (p: GatewayProvider) => m.paymentsMapper.fromApi((await http.post<unknown>(`${I}/payments/${p}/default`)).data),
  testGateway: async (p: GatewayProvider) => m.paymentsMapper.fromApi((await http.post<unknown>(`${I}/payments/${p}/test`)).data),

  apiKeys: async () => m.apiKeyMapper.fromApiList((await http.get<unknown>(`${I}/api-keys`)).data),
  createApiKey: async (input: ApiKeyInput) => m.createdApiKeyMapper.fromApi((await http.post<unknown>(`${I}/api-keys`, toApi(input))).data),
  revokeApiKey: async (id: string) => m.apiKeyMapper.fromApi((await http.delete<unknown>(`${I}/api-keys/${enc(id)}`)).data),
  webhooks: async () => m.webhookMapper.fromApiList((await http.get<unknown>(`${I}/webhooks`)).data),
  createWebhook: async (input: WebhookInput) => m.webhookMapper.fromApi((await http.post<unknown>(`${I}/webhooks`, toApi(input))).data),
  updateWebhook: async (id: string, input: WebhookInput) => m.webhookMapper.fromApi((await http.patch<unknown>(`${I}/webhooks/${enc(id)}`, toApi(input))).data),
  deleteWebhook: async (id: string) => (await http.delete<unknown>(`${I}/webhooks/${enc(id)}`)).data,
  deliveries: async (id: string) => m.deliveryMapper.fromApiList((await http.get<unknown>(`${I}/webhooks/${enc(id)}/deliveries`)).data),
  testWebhook: async (id: string) => m.deliveryMapper.fromApi((await http.post<unknown>(`${I}/webhooks/${enc(id)}/test`)).data),
  retryDelivery: async (id: string) => m.deliveryMapper.fromApi((await http.post<unknown>(`${I}/webhook-deliveries/${enc(id)}/retry`)).data),

  syncLog: async (f: SyncLogFilters = {}) => m.syncLogMapper.fromApiList((await http.get<unknown>(`${I}/sync-log${qs({ integration: f.integration, status: f.status, direction: f.direction })}`)).data),
}

/* ---------------- hooks ---------------- */

export const integrationKeys = {
  all: ['integrations'] as const,
  of: (uid: string, ...rest: string[]) => ['integrations', uid, ...rest] as const,
}

/** Who may do what here (settings column) and whether the plan includes the module. */
export function useIntegrationsAccess() {
  const user = useCurrentUser()
  const ent = useEntitlements()
  const role = user?.role
  return {
    uid: user?.id ?? '',
    inPlan: ent.hasModule('integrations'),
    planLoading: ent.loading,
    canView: !!role && can(role, 'settings', 'view'),
    canEdit: !!role && can(role, 'settings', 'edit'),
    canContactLeads: !!role && can(role, 'sales', 'edit'),
  }
}

type Gate = 'view' | 'edit' | 'sales' | 'any'
function useQ<T>(key: string[], fn: () => Promise<T>, gate: Gate, enabled = true) {
  const a = useIntegrationsAccess()
  const allowed = gate === 'any' ? true : gate === 'sales' ? a.canContactLeads : gate === 'edit' ? a.canEdit : a.canView
  return useQuery({ queryKey: integrationKeys.of(a.uid, ...key), queryFn: fn, enabled: enabled && allowed && a.inPlan && !!a.uid })
}

export const useOverview = () => useQ(['overview'], integrationsApi.overview, 'view')
export const useEmail = (enabled = true) => useQ(['email'], integrationsApi.email, 'view', enabled)
export const useEmailLog = (source?: string, status?: string) => useQ(['email-log', source ?? '', status ?? ''], () => integrationsApi.emailLog(source, status), 'view')
export const useWebsite = (enabled = true) => useQ(['website'], integrationsApi.website, 'view', enabled)
export function useWhatsApp(enabled = true) {
  const a = useIntegrationsAccess()
  return useQuery({
    queryKey: integrationKeys.of(a.uid, 'whatsapp'),
    queryFn: integrationsApi.whatsapp,
    enabled: enabled && a.canView && a.inPlan && !!a.uid,
    // A submitted template is reviewed after a few seconds: poll while one is pending.
    refetchInterval: (q) => (q.state.data?.templates.some((t) => t.status === 'pending') ? 4000 : false),
  })
}
export const useConversations = (enabled = true) => useQ(['wa-conversations'], integrationsApi.conversations, 'any', enabled)
export const useSendOptions = (enabled = true) => useQ(['wa-send-options'], integrationsApi.sendOptions, 'sales', enabled)
export const useMyCalendar = (enabled = true) => useQ(['calendar-me'], integrationsApi.myCalendar, 'any', enabled)
export const useCalendarConnections = (enabled = true) => useQ(['calendar-connections'], integrationsApi.calendarConnections, 'view', enabled)
export const usePayments = (enabled = true) => useQ(['payments'], integrationsApi.payments, 'view', enabled)
export const useApiKeys = (enabled = true) => useQ(['api-keys'], integrationsApi.apiKeys, 'view', enabled)
export const useWebhooks = (enabled = true) => useQ(['webhooks'], integrationsApi.webhooks, 'view', enabled)
export const useDeliveries = (id: string | null) => useQ(['deliveries', id ?? ''], () => integrationsApi.deliveries(id!), 'view', !!id)
export const useSyncLog = (f: SyncLogFilters) => useQ(['sync-log', f.integration ?? '', f.status ?? '', f.direction ?? ''], () => integrationsApi.syncLog(f), 'view')

/**
 * A mutation that refreshes every integrations query afterwards (status cards, sync log…), plus `also` roots
 * (leads after a WhatsApp send or a lead created from a conversation).
 */
export function useIntegrationMutation<V, R>(fn: (v: V) => Promise<R>, also: string[][] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: integrationKeys.all })
      for (const k of also) void qc.invalidateQueries({ queryKey: k })
    },
  })
}
