import type { Role, User } from '@/shared/types'
import type {
  AiAction,
  AiBlock,
  AiConfirmResult,
  AiConversation,
  AiConversationDetail,
  AiLanguage,
  AiMe,
  AiMessage,
  AiPostResult,
  AiRecordRef,
  AiSettings,
  AiSettingsInput,
  AiToolCall,
  AiToolResult,
  AiUsage,
  AiUsageReport,
} from '@/modules/ai-agent/types'
import { AI_TOOLS, AI_TOOL_NAMES, AI_WRITE_TOOLS, toolDef, type AiToolName } from '@/modules/ai-agent/toolSchemas'
import { ApiError } from '@/shared/lib/apiError'
import { can, PERMISSION_MATRIX } from '@/shared/lib/permissions'
import { nowIso, nowMs } from '@/shared/mocks/clock'
import { recordAudit } from '@/shared/mocks/data/audit'
import { companyById } from '@/shared/mocks/data/tenancy'
import { subscriptionOf } from '@/shared/mocks/data/subscriptions'
import { aiActions, aiConversations, aiId, aiMessages, aiSettingsStore, aiUsage, type AiActionRecord, type AiConversationRecord, type AiMessageRecord } from '@/shared/mocks/data/ai'
import { delay } from '@/shared/mocks/server'
import { CodedApiError, NOT_FOUND, tenantOf, type Tenant } from '@/shared/mocks/tenant'
import { companyDayOf } from '@/shared/mocks/selectors/company'
import { users } from '@/shared/mocks/db'
import { assertCapacity, assertModule, companyModules, recordUsage, subOf, subPlan, usedOf } from './billing'
import { getCustomer } from './crm'
import { getLead, logActivity, moveLeadStage } from './leads'
import { sendMessage } from './messages'
import { createTask } from './tasks'
import { createQuotation } from './quotations'
import { understand, type AiIntent } from './aiNlu'
import { excerpt, tr } from './aiText'
import * as T from './aiTools'

/**
 * AI assistant (docs/API.md › AI assistant). Plan module `ai` (also enforced for /ai/* by the request policy), turned
 * on / off per role by the company admin, one AI credit (`aiCredits`) per message, rate-limited per user.
 *
 * PRIVACY: conversations, messages and proposed actions belong to one user — any other id (another user's, another
 * company's, a missing one) answers the same 404. Admins see usage COUNTS only (GET /ai/usage).
 * SAFETY: the engine only interprets the user's own message. Tools read through the permission-checked services as
 * the user; record content is data. Writes are proposals until POST /ai/actions/:id/confirm, which runs the normal
 * service (its permission checks apply again) and writes an audit entry "… (via AI assistant)".
 */

export const AI_RATE_LIMIT_PER_MINUTE = 20
const MAX_CONTENT = 2000
const DEFAULT_TITLE = 'New conversation'

const notFound = (): never => {
  throw new ApiError(NOT_FOUND, 404)
}
const invalid = (message: string, code = 'validation_failed'): never => {
  throw new CodedApiError(message, 422, code)
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/* ---------------- access ---------------- */

function settingsOf(co: string): AiSettings {
  return aiSettingsStore.get(co)
}

/** Why the assistant is off for this user (null = on). Plan first (403 module_not_in_plan), then company / role switches. */
function disabledReason(user: User): string | null {
  const s = settingsOf(tenantOf(user))
  if (!s.enabled) return 'Your company has turned the AI assistant off.'
  if (!s.roles[user.role]?.enabled) return `The AI assistant is turned off for the ${user.role} role in your company.`
  return null
}

function requireAi(user: User): string {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  const reason = disabledReason(user)
  if (reason) throw new CodedApiError(reason, 403, 'ai_disabled')
  return co
}

const canManage = (user: User) => can(user.role, 'settings', 'edit')
const canSeeUsage = (user: User) => can(user.role, 'settings', 'view')

/* ---------------- usage & rate limit ---------------- */

function usageOf(co: string): AiUsage {
  const sub = subOf(co)
  const limit = subPlan(sub).limits.aiCredits
  const used = usedOf(co, 'aiCredits')
  const remaining = limit === null ? null : Math.max(0, limit - used)
  const warning =
    limit !== null && used >= limit
      ? `Your plan’s ${limit.toLocaleString('en-US')} AI requests for this period are used up. The assistant is paused until the next period or an upgrade.`
      : limit !== null && used >= limit * 0.8
        ? `${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} AI requests used this period (${Math.round((used / limit) * 100)}%).`
        : null
  return { used, limit, remaining, warning, periodStart: sub.currentPeriodStart }
}

function assertRate(user: User): void {
  const t = nowMs()
  const recent = aiUsage.filter((u) => u.companyId === user.companyId && u.userId === user.id && t - Date.parse(u.at) < 60_000)
  if (recent.length >= AI_RATE_LIMIT_PER_MINUTE) {
    const oldest = Math.min(...recent.map((u) => Date.parse(u.at)))
    const wait = Math.max(1, Math.ceil((oldest + 60_000 - t) / 1000))
    throw new CodedApiError(`You’re sending messages to the assistant too quickly. Try again in ${wait} seconds.`, 429, 'rate_limited', { retry_after: wait })
  }
}

/* ---------------- serialization ---------------- */

function ownConversation(user: User, id: string): Tenant<AiConversationRecord> {
  const co = tenantOf(user)
  return aiConversations.find((c) => c.id === id && c.companyId === co && c.userId === user.id) ?? notFound()
}

const actionView = (a: Tenant<AiActionRecord>): AiAction => {
  const { companyId: _c, userId: _u, ...rest } = a
  return structuredClone(rest)
}

function messageView(m: Tenant<AiMessageRecord>): AiMessage {
  const { companyId: _c, userId: _u, ...rest } = m
  return { ...structuredClone(rest), actions: aiActions.filter((a) => a.companyId === m.companyId && a.messageId === m.id).map(actionView) }
}

function conversationView(c: Tenant<AiConversationRecord>): AiConversation {
  const msgs = aiMessages.filter((m) => m.companyId === c.companyId && m.conversationId === c.id)
  const last = msgs[msgs.length - 1]
  return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: msgs.length, lastMessage: last ? excerpt(last.content, 120) : '' }
}

/* ---------------- conversations ---------------- */

/** GET /ai/conversations — the caller's own, newest first. */
export async function listConversations(user: User): Promise<AiConversation[]> {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  return delay(
    aiConversations
      .filter((c) => c.companyId === co && c.userId === user.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .map(conversationView),
  )
}

/** POST /ai/conversations { title? } */
export async function createConversation(user: User, input: { title?: unknown } | null): Promise<AiConversationDetail> {
  const co = requireAi(user)
  const at = nowIso()
  const row: Tenant<AiConversationRecord> = { companyId: co, id: aiId('AIC'), userId: user.id, title: str(input?.title, 120) || DEFAULT_TITLE, focus: null, createdAt: at, updatedAt: at }
  aiConversations.push(row)
  return delay({ ...conversationView(row), messages: [] })
}

/** GET /ai/conversations/:id */
export async function getConversation(user: User, id: string): Promise<AiConversationDetail> {
  assertModule(tenantOf(user), 'ai')
  const c = ownConversation(user, id)
  const msgs = aiMessages.filter((m) => m.companyId === c.companyId && m.conversationId === c.id).map(messageView)
  return delay({ ...conversationView(c), messages: msgs })
}

/** PATCH /ai/conversations/:id { title } */
export async function renameConversation(user: User, id: string, input: { title?: unknown } | null): Promise<AiConversation> {
  assertModule(tenantOf(user), 'ai')
  const c = ownConversation(user, id)
  const title = str(input?.title, 120)
  if (!title) invalid('Give the conversation a name.')
  c.title = title
  c.updatedAt = nowIso()
  return delay(conversationView(c))
}

/** DELETE /ai/conversations/:id — the conversation, its messages and its proposals (pending ones can no longer run). */
export async function deleteConversation(user: User, id: string): Promise<{ ok: true }> {
  assertModule(tenantOf(user), 'ai')
  const c = ownConversation(user, id)
  const drop = <R extends { companyId: string; conversationId: string }>(rows: R[]) => {
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i].companyId === c.companyId && rows[i].conversationId === c.id) rows.splice(i, 1)
  }
  drop(aiMessages)
  drop(aiActions)
  aiConversations.splice(aiConversations.indexOf(c), 1)
  return delay({ ok: true as const })
}

/* ---------------- the engine ---------------- */

interface EngineResult {
  intent: AiIntent
  language: AiLanguage
  text: string
  blocks: AiBlock[]
  toolCalls: AiToolCall[]
  toolResults: AiToolResult[]
  proposal: T.Proposal | null
  focus: AiRecordRef | null
}

const ROLE_EXAMPLES: Record<string, { en: string[]; ar: string[] }> = {
  sales: { en: ['What should I follow up today?', 'Summarize L-1016', 'Draft a follow-up email to Al Noor Medical Centre', 'Suggest services for Oasis Pharmacy Chain'], ar: ['وش عندي متابعات اليوم؟', 'لخص L-1016', 'اكتب ايميل متابعة لـ Al Noor Medical Centre'] },
  manager: { en: ['How is the team doing this month?', 'Which quotations are waiting for the client?'], ar: ['كيف أداء الفريق هذا الشهر؟'] },
  finance: { en: ['Which invoices are overdue?', 'What is our revenue this month?'], ar: ['ايش الفواتير المتأخرة؟', 'كم الإيرادات هذا الشهر؟'] },
  hr: { en: ['Who is on leave next week?', 'What is my leave balance?'], ar: ['مين في إجازة الأسبوع الجاي؟', 'كم رصيد إجازاتي؟'] },
}

function examplesFor(role: Role, lang: AiLanguage): string[] {
  const m = PERMISSION_MATRIX[role]
  const out: string[] = []
  const add = (k: keyof typeof ROLE_EXAMPLES) => out.push(...ROLE_EXAMPLES[k][lang])
  if (m.sales !== 'hidden') add('sales')
  if (m.sales === 'full' || m.sales === 'team') add('manager')
  if (m.accounting !== 'hidden') add('finance')
  add('hr')
  return [...new Set(out)].slice(0, 6)
}

/**
 * Runs one turn: understand the USER's message, pick a tool, run it as the user, compose the answer. Record content
 * never reaches `understand`, so text in notes can't trigger anything.
 */
async function runEngine(user: User, conv: Tenant<AiConversationRecord>, content: string, context: AiRecordRef | null): Promise<EngineResult> {
  const co = tenantOf(user)
  const und = understand(content)
  const lang = und.language
  const settings = settingsOf(co)
  const roleSet = settings.roles[user.role] ?? { enabled: true, writeTools: false }
  const ctx: T.ToolCtx = {
    user,
    co,
    lang,
    day: companyDayOf(co),
    currency: companyById(co)?.regional.currency ?? 'AED',
    modules: companyModules(co),
    text: content,
    und,
    focus: context ?? conv.focus,
  }
  const toolCalls: AiToolCall[] = []
  const toolResults: AiToolResult[] = []
  const say = (text: string, blocks: AiBlock[] = [], extra: Partial<EngineResult> = {}): EngineResult => ({ intent: und.intent, language: lang, text, blocks, toolCalls, toolResults, proposal: null, focus: null, ...extra })

  /** Settings gate + run + transcript. */
  const call = async (name: AiToolName, run: () => Promise<T.ToolOutput>): Promise<EngineResult> => {
    if (!settings.tools[name]) {
      const text = tr(lang, `The “${toolDef(name).label}” tool is turned off for your company.`, `أداة "${toolDef(name).label}" متوقفة في شركتك.`)
      return say(text, [{ type: 'refusal', code: 'tool_disabled', text }])
    }
    if (AI_WRITE_TOOLS.includes(name) && !roleSet.writeTools) {
      const text = tr(lang, 'Your company has turned off changes through the assistant for your role. I can still look things up for you.', 'شركتك أوقفت التعديلات عبر المساعد لدورك. ما زلت أستطيع البحث لك.')
      return say(text, [{ type: 'refusal', code: 'write_tools_disabled', text }])
    }
    const out = await run()
    const id = aiId('AIT')
    toolCalls.push({ id, name, input: out.input })
    toolResults.push({ toolCallId: id, name, status: out.status, summary: out.summary })
    return say(out.text, out.blocks, { proposal: out.proposal ?? null, focus: out.focus ?? null })
  }

  /** The lead the message is about, or a question back. */
  const withLead = async (name: AiToolName, run: (leadId: string) => Promise<T.ToolOutput>, fallback?: () => Promise<EngineResult | null>): Promise<EngineResult> => {
    const r = T.resolveLeadId(ctx)
    if (r.kind === 'one') return call(name, () => run(r.value))
    if (r.kind === 'many') return say(T.whichLead(ctx, r.values).text, T.whichLead(ctx, r.values).blocks)
    const fb = fallback ? await fallback() : null
    if (fb) return fb
    return say(tr(lang, 'Which lead do you mean? Give me its id (e.g. L-1016) or company name.', 'أي عميل محتمل تقصد؟ اكتب الرقم (مثل L-1016) أو اسم الشركة.'))
  }

  const customerFallback = (name: AiToolName, run: (customerId: string) => Promise<T.ToolOutput>) => async () => {
    const r = await T.resolveCustomerId(ctx)
    return r.kind === 'one' ? call(name, () => run(r.value)) : null
  }

  switch (und.intent) {
    case 'sensitive': {
      const text = tr(lang, 'I can’t share other people’s salaries, bank details (IBAN) or ID / document numbers. If your role allows it, they are in the HR screens.', 'لا أستطيع مشاركة رواتب الآخرين أو بياناتهم البنكية أو أرقام هوياتهم ووثائقهم. إن كانت صلاحيتك تسمح فهي في شاشات الموارد البشرية.')
      return say(text, [{ type: 'refusal', code: 'sensitive_data', text }])
    }
    case 'own_pay':
      return say(tr(lang, 'Your payslips are in My HR › Payslips — I don’t read pay figures in chat.', 'كشوف رواتبك في "بياناتي" › كشوف الرواتب — لا أعرض أرقام الرواتب في المحادثة.'), [
        { type: 'cards', cards: [{ type: 'leave', id: 'my-hr', title: tr(lang, 'My HR', 'بياناتي'), subtitle: tr(lang, 'Payslips, leave, documents', 'كشوف الرواتب والإجازات والوثائق'), badge: null, link: '/hr/me', meta: [] }] },
      ])
    case 'overdue_invoices':
      return call('get_overdue_invoices', () => T.overdueInvoices(ctx))
    case 'kpis':
      return call('get_kpis', () => T.financeKpis(ctx))
    case 'leave':
      return call('get_leave', () => T.leaveInfo(ctx))
    case 'events':
      return call('get_event_registrations', () => T.eventRegistrations(ctx))
    case 'follow_ups':
      return call('get_my_follow_ups', () => T.myFollowUps(ctx))
    case 'pipeline':
      return call('get_pipeline_summary', () => T.pipelineSummary(ctx))
    case 'search':
      return call('search_records', () => T.searchRecords(ctx))
    case 'suggest_services':
      return withLead('suggest_services', (id) => T.suggestServices(ctx, id))
    case 'quotations': {
      const r = T.resolveLeadId(ctx)
      if (r.kind === 'one') return call('get_quotations', () => T.quotationStatus(ctx, r.value, null))
      const c = await T.resolveCustomerId(ctx)
      return call('get_quotations', () => T.quotationStatus(ctx, null, c.kind === 'one' ? c.value : null))
    }
    case 'summary':
      if (und.entities.customerIds.length || (ctx.focus?.type === 'customer' && !und.entities.leadIds.length && T.resolveLeadId({ ...ctx, focus: null }).kind === 'none')) {
        const c = await T.resolveCustomerId(ctx)
        if (c.kind === 'one') return call('get_customer_summary', () => T.customerSummary(ctx, c.value))
      }
      return withLead('get_lead_summary', (id) => T.leadSummary(ctx, id), customerFallback('get_customer_summary', (id) => T.customerSummary(ctx, id)))
    case 'draft_email':
      if (und.entities.customerIds.length || (ctx.focus?.type === 'customer' && T.resolveLeadId({ ...ctx, focus: null }).kind === 'none')) {
        const c = await T.resolveCustomerId(ctx)
        if (c.kind === 'one') return call('draft_email', () => T.proposeEmail(ctx, { customerId: c.value }))
      }
      return withLead('draft_email', (id) => T.proposeEmail(ctx, { leadId: id }), customerFallback('draft_email', (id) => T.proposeEmail(ctx, { customerId: id })))
    case 'log_call':
      return withLead('log_call', (id) => T.proposeCallLog(ctx, id))
    case 'move_stage':
      return withLead('move_lead_stage', (id) => T.proposeMove(ctx, id))
    case 'create_quotation':
      return withLead('create_quotation_draft', (id) => T.proposeQuotation(ctx, id))
    case 'create_task': {
      const r = T.resolveLeadId(ctx)
      if (r.kind === 'many') return say(T.whichLead(ctx, r.values).text, T.whichLead(ctx, r.values).blocks)
      return call('create_task', () => T.proposeTask(ctx, r.kind === 'one' ? r.value : null))
    }
    case 'help':
      return say(tr(lang, `Hi ${user.name.split(' ')[0]} — I can look up your records, summarize leads, suggest services, draft emails and prepare changes for you to confirm. Try:`, `أهلاً ${user.name.split(' ')[0]} — أستطيع البحث في سجلاتك وتلخيص العملاء واقتراح الخدمات وكتابة الرسائل وتجهيز التعديلات لتأكيدك. جرّب:`), [
        { type: 'bullets', title: '', items: examplesFor(user.role, lang) },
      ])
    case 'unknown':
    default: {
      // A bare record name or id: summarize it.
      const r = T.resolveLeadId({ ...ctx, focus: null })
      if (r.kind === 'one') return call('get_lead_summary', () => T.leadSummary(ctx, r.value))
      return say(tr(lang, 'I’m not sure what you need. I can help with things like:', 'لم أفهم طلبك تماماً. أستطيع المساعدة في أشياء مثل:'), [{ type: 'bullets', title: '', items: examplesFor(user.role, lang) }])
    }
  }
}

/** The record the question was asked from, only when the user can see it (else no context, nothing echoed). */
async function visibleContext(user: User, raw: unknown): Promise<AiRecordRef | null> {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { type?: unknown; id?: unknown }
  const id = str(r.id, 64)
  if (!id) return null
  try {
    if (r.type === 'lead') {
      await getLead(user, id)
      return { type: 'lead', id }
    }
    if (r.type === 'customer') {
      await getCustomer(user, id)
      return { type: 'customer', id }
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
  }
  return null
}

/** POST /ai/conversations/:id/messages { content, context? } — one credit; answers with the user's and the assistant's messages. */
export async function postMessage(user: User, conversationId: string, input: { content?: unknown; context?: unknown } | null): Promise<AiPostResult> {
  const co = requireAi(user)
  const conv = ownConversation(user, conversationId)
  const content = str(input?.content, MAX_CONTENT + 1)
  if (!content) invalid('Type a message for the assistant.')
  if (content.length > MAX_CONTENT) invalid(`Keep messages under ${MAX_CONTENT} characters.`)
  assertRate(user)
  // Soft limit: the plan's AI credits per period (402 LIMIT_REACHED with a clear message once used up).
  assertCapacity(co, 'aiCredits', 1)
  const askedContext = input?.context !== undefined && input?.context !== null
  const context = await visibleContext(user, input?.context)
  const at = nowIso()
  const userMsg: Tenant<AiMessageRecord> = { companyId: co, userId: user.id, id: aiId('AIM'), conversationId: conv.id, role: 'user', content, language: understand(content).language, blocks: [], toolCalls: [], toolResults: [], actions: [], context, intent: null, createdAt: at }
  aiMessages.push(userMsg)

  const result = askedContext && !context
    ? { intent: 'unknown' as AiIntent, language: userMsg.language, text: tr(userMsg.language, 'I can’t open the record this was asked from — it isn’t among the records you can see.', 'لا أستطيع فتح السجل المطلوب — ليس ضمن السجلات المتاحة لك.'), blocks: [] as AiBlock[], toolCalls: [], toolResults: [], proposal: null, focus: null }
    : await runEngine(user, conv, content, context)

  const assistant: Tenant<AiMessageRecord> = {
    companyId: co,
    userId: user.id,
    id: aiId('AIM'),
    conversationId: conv.id,
    role: 'assistant',
    content: result.text,
    language: result.language,
    blocks: [{ type: 'text', text: result.text }, ...result.blocks],
    toolCalls: result.toolCalls,
    toolResults: result.toolResults,
    actions: [],
    context: null,
    intent: result.intent,
    createdAt: nowIso(),
  }
  aiMessages.push(assistant)
  if (result.proposal) {
    aiActions.push({ companyId: co, userId: user.id, id: aiId('AIA'), conversationId: conv.id, messageId: assistant.id, status: 'pending', result: null, error: null, createdAt: assistant.createdAt, decidedAt: null, ...result.proposal })
  }
  recordUsage(co, 'aiCredits', 1)
  aiUsage.push({ companyId: co, userId: user.id, at, periodStart: subscriptionOf(co)?.currentPeriodStart ?? '', tools: result.toolCalls.map((c) => c.name) })
  if (conv.title === DEFAULT_TITLE) conv.title = excerpt(content, 60)
  if (result.focus ?? context) conv.focus = result.focus ?? context
  conv.updatedAt = assistant.createdAt
  return delay({ conversation: conversationView(conv), messages: [messageView(userMsg), messageView(assistant)], usage: usageOf(co) })
}

/* ---------------- actions: confirm / cancel ---------------- */

function ownAction(user: User, id: string): Tenant<AiActionRecord> {
  const co = tenantOf(user)
  return aiActions.find((a) => a.id === id && a.companyId === co && a.userId === user.id) ?? notFound()
}

const EDIT_MAX: Record<string, number> = { to: 200, subject: 200, body: 5000, title: 200, summary: 1000, nextStep: 300, nextFollowUpDate: 10, dueDate: 10, validUntil: 10, priority: 10, lossReason: 80 }

function followUpMessage(user: User, a: Tenant<AiActionRecord>, text: string): Tenant<AiMessageRecord> {
  const m: Tenant<AiMessageRecord> = {
    companyId: a.companyId,
    userId: user.id,
    id: aiId('AIM'),
    conversationId: a.conversationId,
    role: 'assistant',
    content: text,
    language: 'en',
    blocks: [{ type: 'text', text }, ...(a.result?.link ? [{ type: 'cards' as const, cards: [{ type: a.record?.type ?? 'lead', id: a.result.id, title: a.result.label, subtitle: a.record?.label ?? '', badge: null, link: a.result.link, meta: [] }] }] : [])],
    toolCalls: [],
    toolResults: [],
    actions: [],
    context: null,
    intent: null,
    createdAt: nowIso(),
  }
  aiMessages.push(m)
  const conv = aiConversations.find((c) => c.companyId === a.companyId && c.id === a.conversationId)
  if (conv) conv.updatedAt = m.createdAt
  return m
}

/** Runs the confirmed proposal through the normal service, as the user. */
async function execute(user: User, a: Tenant<AiActionRecord>): Promise<{ result: NonNullable<AiAction['result']>; done: string; auditAction: 'create' | 'update' }> {
  const i = a.input as Record<string, unknown>
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  switch (a.tool) {
    case 'draft_email': {
      const r = await sendMessage(user, s('leadId'), { channel: 'email', to: s('to'), subject: s('subject'), body: s('body') })
      return { result: { type: 'activity', id: r.activity.id, label: r.activity.summary, link: `/leads/${encodeURIComponent(s('leadId'))}` }, done: `Done — the email was sent to ${s('to')} and logged on ${a.record?.label ?? 'the lead'}.`, auditAction: 'create' }
    }
    case 'log_call': {
      const r = await logActivity(user, { leadId: s('leadId'), type: 'call', summary: s('summary') })
      return { result: { type: 'activity', id: r.id, label: r.summary, link: `/leads/${encodeURIComponent(s('leadId'))}` }, done: `Done — the call is logged on ${a.record?.label ?? 'the lead'}.`, auditAction: 'create' }
    }
    case 'create_task': {
      const link = i.link && typeof i.link === 'object' ? (i.link as { type: 'lead'; id: string }) : null
      const t = await createTask(user, { title: s('title'), dueDate: s('dueDate') || null, priority: (s('priority') || 'medium') as never, link })
      return { result: { type: 'task', id: t.id, label: t.title, link: `/tasks/my?task=${encodeURIComponent(t.id)}` }, done: `Done — “${t.title}” is on your task list, due ${t.dueDate ?? 'with no date'}.`, auditAction: 'create' }
    }
    case 'move_lead_stage': {
      const r = await moveLeadStage(user, { id: s('id'), status: s('status'), nextStep: s('nextStep') || undefined, nextFollowUpDate: s('nextFollowUpDate') || undefined, lossReason: s('lossReason') || undefined } as never)
      return { result: { type: 'lead', id: r.id, label: `${r.company} → ${a.changes[0]?.to ?? r.status}`, link: `/leads/${encodeURIComponent(r.id)}` }, done: `Done — ${r.company} is now at ${a.changes[0]?.to ?? r.status}.`, auditAction: 'update' }
    }
    case 'create_quotation_draft': {
      const q = await createQuotation(user, { leadId: s('leadId'), title: s('title'), validUntil: s('validUntil'), items: (i.items as never) ?? [], notes: s('notes'), terms: s('terms'), currency: s('currency') || undefined })
      return { result: { type: 'quotation', id: q.id, label: `${q.number} · ${q.title}`, link: `/sales/quotations/${encodeURIComponent(q.id)}` }, done: `Done — draft quotation ${q.number} is ready to review. It hasn’t been sent.`, auditAction: 'create' }
    }
    default:
      throw new CodedApiError('This action can’t be run.', 422, 'invalid_action')
  }
}

/** POST /ai/actions/:id/confirm { input? } — the only way an assistant proposal changes data. */
export async function confirmAction(user: User, id: string, body: { input?: unknown } | null): Promise<AiConfirmResult> {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  const a = ownAction(user, id)
  if (a.status !== 'pending') throw new CodedApiError('This proposal was already handled.', 409, 'action_not_pending', { status: a.status })
  requireAi(user)
  const settings = settingsOf(co)
  if (!settings.tools[a.tool]) throw new CodedApiError(`The “${toolDef(a.tool).label}” tool is turned off for your company.`, 403, 'tool_disabled')
  if (!settings.roles[user.role]?.writeTools) throw new CodedApiError('Changes through the assistant are turned off for your role.', 403, 'write_tools_disabled')
  // Edits: only the proposal's editable fields, as trimmed strings.
  const edits = body?.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {}
  for (const key of a.editable) {
    if (key in edits) {
      const v = str(edits[key], EDIT_MAX[key] ?? 500)
      if (!v && key !== 'nextStep') invalid(`${key} can’t be empty.`)
      ;(a.input as Record<string, unknown>)[key] = v
      const change = a.changes.find((c) => c.field === key)
      if (change) change.to = v
    }
  }
  try {
    const { result, done, auditAction } = await execute(user, a)
    a.status = 'confirmed'
    a.result = result
    a.decidedAt = nowIso()
    recordAudit(user, {
      action: auditAction,
      entity: `ai:${a.tool}`,
      entityId: result.id,
      summary: `${a.title} (via AI assistant)`,
      changes: a.changes.map((c) => ({ field: c.label, from: c.from, to: c.to })),
    })
    const msg = followUpMessage(user, a, done)
    return delay({ action: actionView(a), message: messageView(msg) })
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    a.status = 'failed'
    a.error = error.message
    a.decidedAt = nowIso()
    const msg = followUpMessage(user, a, `I couldn’t do that: ${error.message}`)
    return delay({ action: actionView(a), message: messageView(msg) })
  }
}

/** POST /ai/actions/:id/cancel — nothing changes. */
export async function cancelAction(user: User, id: string): Promise<AiConfirmResult> {
  assertModule(tenantOf(user), 'ai')
  const a = ownAction(user, id)
  if (a.status !== 'pending') throw new CodedApiError('This proposal was already handled.', 409, 'action_not_pending', { status: a.status })
  a.status = 'cancelled'
  a.decidedAt = nowIso()
  const msg = followUpMessage(user, a, 'Cancelled — nothing was changed.')
  return delay({ action: actionView(a), message: messageView(msg) })
}

/* ---------------- me, settings, usage ---------------- */

/** GET /ai/me */
export async function getAiMe(user: User): Promise<AiMe> {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  const s = settingsOf(co)
  const reason = disabledReason(user)
  const writeTools = !!s.roles[user.role]?.writeTools
  return delay({
    enabled: !reason,
    disabledReason: reason,
    role: user.role,
    tools: AI_TOOLS.map((t) => ({ name: t.name, kind: t.kind, enabled: s.tools[t.name] && (t.kind === 'read' || writeTools) })),
    writeTools,
    canManage: canManage(user),
    usage: canSeeUsage(user) ? usageOf(co) : null,
    rateLimit: { perMinute: AI_RATE_LIMIT_PER_MINUTE },
  })
}

function requireManage(user: User): string {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  if (!canManage(user)) throw new CodedApiError('Only a Company Admin can change the AI assistant settings.', 403, 'forbidden')
  return co
}

/** GET /ai/settings — Company Admin. */
export async function getAiSettings(user: User): Promise<AiSettings> {
  const co = requireManage(user)
  return delay(settingsOf(co))
}

/** PUT /ai/settings { enabled?, roles?, tools? } — Company Admin; audited. */
export async function updateAiSettings(user: User, input: AiSettingsInput | null): Promise<AiSettings> {
  const co = requireManage(user)
  const s = settingsOf(co)
  const changes: { field: string; from: string; to: string }[] = []
  if (input?.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') invalid('enabled must be true or false.')
    if (s.enabled !== input.enabled) changes.push({ field: 'Assistant', from: s.enabled ? 'on' : 'off', to: input.enabled ? 'on' : 'off' })
    s.enabled = input.enabled
  }
  if (input?.roles !== undefined) {
    if (!input.roles || typeof input.roles !== 'object') invalid('roles must be an object.')
    for (const [role, v] of Object.entries(input.roles)) {
      if (!(role in PERMISSION_MATRIX)) invalid(`Unknown role “${role}”.`)
      const cur = s.roles[role as Role]
      const next = v as { enabled?: unknown; writeTools?: unknown }
      for (const k of ['enabled', 'writeTools'] as const) {
        if (next?.[k] === undefined) continue
        if (typeof next[k] !== 'boolean') invalid(`${role}.${k} must be true or false.`)
        if (cur[k] !== next[k]) changes.push({ field: `${role} · ${k === 'enabled' ? 'assistant' : 'changes'}`, from: cur[k] ? 'on' : 'off', to: next[k] ? 'on' : 'off' })
        cur[k] = next[k] as boolean
      }
    }
  }
  if (input?.tools !== undefined) {
    if (!input.tools || typeof input.tools !== 'object') invalid('tools must be an object.')
    for (const [name, v] of Object.entries(input.tools)) {
      if (!AI_TOOL_NAMES.includes(name as AiToolName)) invalid(`Unknown tool “${name}”.`)
      if (typeof v !== 'boolean') invalid(`${name} must be true or false.`)
      if (s.tools[name as AiToolName] !== v) changes.push({ field: toolDef(name as AiToolName).label, from: s.tools[name as AiToolName] ? 'on' : 'off', to: v ? 'on' : 'off' })
      s.tools[name as AiToolName] = v
    }
  }
  s.updatedAt = nowIso()
  s.updatedByName = user.name
  if (changes.length) recordAudit(user, { action: 'update', entity: 'ai_settings', entityId: 'ai', summary: 'Changed the AI assistant settings', changes })
  return delay(s)
}

/** GET /ai/usage — Company Admin, Management: counts per user and per tool this period (never content). */
export async function getAiUsage(user: User): Promise<AiUsageReport> {
  const co = tenantOf(user)
  assertModule(co, 'ai')
  if (!canSeeUsage(user)) throw new CodedApiError('Only Company Admins and Management can see AI usage.', 403, 'forbidden')
  const u = usageOf(co)
  const rows = aiUsage.filter((r) => r.companyId === co && r.periodStart === u.periodStart)
  const byUser = [...new Set(rows.map((r) => r.userId))]
    .map((id) => {
      const person = users.find((x) => x.id === id && x.companyId === co)
      return { userId: id, name: person?.name ?? 'Former user', role: (person?.role ?? 'Employee') as Role, requests: rows.filter((r) => r.userId === id).length }
    })
    .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name))
  const byTool = AI_TOOL_NAMES.map((tool) => ({ tool, calls: rows.reduce((n, r) => n + r.tools.filter((t) => t === tool).length, 0) })).filter((t) => t.calls > 0)
  return delay({ ...u, byUser, byTool })
}
