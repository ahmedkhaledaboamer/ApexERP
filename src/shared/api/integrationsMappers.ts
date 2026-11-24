import { defineMapper } from './mapping'
import type {
  ApiKey,
  CalendarConnectionRow,
  CreatedApiKey,
  EmailIntegration,
  EmailLogRow,
  IntegrationsOverview,
  MappingPreview,
  MyCalendar,
  OAuthConsent,
  PaymentsIntegration,
  SyncLogRow,
  WaConversation,
  WaSendOptions,
  WaSendResult,
  WebhookDelivery,
  WebhookEndpoint,
  WebsiteIntegration,
  WhatsAppIntegration,
} from '@/modules/integrations/types'

/**
 * Wire names of Insights & admin › Integrations (docs/API.md › Integrations): plain snake_case at any depth
 * (connected_as, password_hint, token_hint, last_test_status, phone_number_id, secret_key_hint, events_from…).
 * `field_map` (external field names → lead fields) and webhook `payload`s are data-keyed: their keys pass untouched.
 * Write-only credentials travel only in request bodies (password, access_token, secret_key, secret) and never come back.
 */
const deep = <T>() => defineMapper<T>({ deep: true, opaque: ['fieldMap', 'payload'] })

export const overviewMapper = deep<IntegrationsOverview>()
export const oauthConsentMapper = deep<OAuthConsent>()
export const emailMapper = deep<EmailIntegration>()
export const emailLogMapper = deep<EmailLogRow>()
export const websiteMapper = deep<WebsiteIntegration>()
export const mappingPreviewMapper = deep<MappingPreview>()
export const whatsappMapper = deep<WhatsAppIntegration>()
export const waSendOptionsMapper = deep<WaSendOptions>()
export const waSendResultMapper = deep<WaSendResult>()
export const waConversationMapper = deep<WaConversation>()
export const myCalendarMapper = deep<MyCalendar>()
export const calendarConnectionMapper = deep<CalendarConnectionRow>()
export const paymentsMapper = deep<PaymentsIntegration>()
export const apiKeyMapper = deep<ApiKey>()
export const createdApiKeyMapper = deep<CreatedApiKey>()
export const webhookMapper = deep<WebhookEndpoint>()
export const deliveryMapper = deep<WebhookDelivery>()
export const syncLogMapper = deep<SyncLogRow>()
/** Request bodies and plain answers. */
export const integrationInputMapper = deep<Record<string, unknown>>()
