import type { User, Lead } from '@/shared/types'
import type { PlanModule } from '@/modules/billing/types'
import type { AiAction, AiBlock, AiCard, AiLanguage, AiRecordRef, AiToolStatus } from '@/modules/ai-agent/types'
import type { AiToolName } from '@/modules/ai-agent/toolSchemas'
import type { CompanyDay } from '@/shared/lib/companyDay'
import { addDaysIso } from '@/shared/lib/companyDay'
import { can, scopeOf } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { ACTIVITY_LABELS } from '@/shared/lib/constants'
import { QUOTATION_STATUS_LABEL, CUSTOMER_STATUS_LABEL } from '@/shared/domain/enums'
import { TASK_PRIORITY_LABEL } from '@/modules/tasks/types'
import { AGING_BUCKET_LABEL, AGING_BUCKETS } from '@/modules/finance/collections/types'
import { matchServiceText } from '@/modules/services/match'
import type { Service } from '@/modules/services/types'
import { activities, users } from '@/shared/mocks/db'
import { isClosedStatus, isLostStatus, isWonStatus, lookupsFor, probabilityOf, SYSTEM_STATUS } from '@/shared/mocks/data/lookups'
import { statusLabelOf } from '@/shared/mocks/lookupChecks'
import { companyById } from '@/shared/mocks/data/tenancy'
import { scoped } from '@/shared/mocks/tenant'
import { getLead, getLeadActivities, getLeadNotes, visibleLeads } from './leads'
import { getContracts, getCustomer, getCustomers } from './crm'
import { getQuotations } from './quotations'
import { listPackages, listServices } from './services'
import { getTasks } from './tasks'
import { listInvoices } from './financeInvoices'
import { getAging } from './financeReceivables'
import { getFinanceOverview } from './financeLedger'
import { getLeaveCalendar, getMyLeave } from './leave'
import { getEventStats, listEvents } from './events'
import { emailSenderOf } from './messages'
import type { AiEntities, AiPeriod, AiUnderstanding } from './aiNlu'
import { nameScore } from './aiNlu'
import { day, draftEmail, excerpt, money, relDay, summarizeNotes, tr } from './aiText'

/**
 * The mock assistant's TOOLS (schemas: modules/ai-agent/toolSchemas.ts). Every tool runs AS THE SIGNED-IN USER through
 * the existing services, which apply the PERMISSION_MATRIX scopes and the company boundary themselves; a 403 / 404
 * becomes a refusal or "not found among the records you can see". Read tools return blocks (cards, tables, stats);
 * write tools return a PROPOSAL only — services/ai.ts runs it on confirm. Record content (notes, summaries) is data:
 * nothing in it is ever interpreted as an instruction.
 */

export interface ToolCtx {
  user: User
  co: string
  lang: AiLanguage
  day: CompanyDay
  currency: string
  modules: PlanModule[]
  /** Text of the user's message (for name matching against records the user can see). */
  text: string
  und: AiUnderstanding
  /** The record the question is about when no id / name is given (page context or conversation focus). */
  focus: AiRecordRef | null
}

export type Proposal = Pick<AiAction, 'tool' | 'title' | 'summary' | 'record' | 'input' | 'editable' | 'changes' | 'choices'>

export interface ToolOutput {
  status: AiToolStatus
  /** Log line (no record content). */
  summary: string
  /** The answer's first paragraph. */
  text: string
  blocks: AiBlock[]
  focus?: AiRecordRef
  proposal?: Proposal
  /** Tool input as called (for the transcript). */
  input: Record<string, unknown>
}

const L = (ctx: ToolCtx, en: string, ar: string) => tr(ctx.lang, en, ar)

/* ---------------- result helpers ---------------- */

function refused(ctx: ToolCtx, code: string, en: string, ar: string, input: Record<string, unknown> = {}): ToolOutput {
  const text = L(ctx, en, ar)
  return { status: 'refused', summary: code, text, blocks: [{ type: 'refusal', code, text }], input }
}
function notFound(ctx: ToolCtx, what: string, en: string, ar: string, input: Record<string, unknown> = {}): ToolOutput {
  return { status: 'not_found', summary: `${what} not found`, text: L(ctx, en, ar), blocks: [], input }
}

export const FINANCE_REFUSAL = { en: 'You don’t have access to finance data, so I can’t answer that. Ask your Company Admin or the accounts team.', ar: 'ليس لديك صلاحية على البيانات المالية، لذلك لا أستطيع الإجابة. تواصل مع مدير النظام أو فريق الحسابات.' }
export const HR_REFUSAL = { en: 'You don’t have access to HR data for other people. I can only show your own leave.', ar: 'ليس لديك صلاحية على بيانات الموارد البشرية للآخرين. أستطيع عرض إجازاتك فقط.' }
export const SALES_REFUSAL = { en: 'Leads and customers aren’t part of your role, so I can’t look them up.', ar: 'العملاء المحتملون والعملاء ليسوا ضمن صلاحيات دورك.' }

/** Runs a service call; ApiError → the error (permission / not found), anything else is rethrown. */
async function attempt<T>(run: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: ApiError }> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error }
    throw error
  }
}

const hasModule = (ctx: ToolCtx, m: PlanModule) => ctx.modules.includes(m)
function notInPlan(ctx: ToolCtx, what: string, whatAr: string): ToolOutput {
  return refused(ctx, 'module_not_in_plan', `${what} isn’t included in your company’s plan.`, `${whatAr} غير مشمولة في باقة شركتك.`)
}

const leadCard = (ctx: ToolCtx, l: Pick<Lead, 'id' | 'company' | 'contactName' | 'status' | 'value' | 'nextFollowUpDate'> & { ownerName?: string }, extra: { label: string; value: string }[] = []): AiCard => ({
  type: 'lead',
  id: l.id,
  title: l.company,
  subtitle: `${l.contactName}${l.ownerName ? ` · ${l.ownerName}` : ''}`,
  badge: statusLabelOf(ctx.co, l.status),
  link: `/leads/${encodeURIComponent(l.id)}`,
  meta: [
    { label: L(ctx, 'Value', 'القيمة'), value: money(l.value, ctx.currency) },
    ...(l.nextFollowUpDate ? [{ label: L(ctx, 'Follow-up', 'المتابعة'), value: `${day(l.nextFollowUpDate)} (${relDay(l.nextFollowUpDate, ctx.day.today, ctx.lang)})` }] : []),
    ...extra,
  ],
})

/* ---------------- periods ---------------- */

export function periodRange(p: AiPeriod | null, d: CompanyDay): { from: string; to: string; label: string } {
  const today = d.today
  const [y, m] = today.split('-').map(Number)
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`
  const lastOf = (yy: number, mm: number) => addDaysIso(mm === 12 ? first(yy + 1, 1) : first(yy, mm + 1), -1)
  switch (p) {
    case 'today':
    case 'overdue':
      return { from: today, to: today, label: 'today' }
    case 'tomorrow':
      return { from: d.tomorrow, to: d.tomorrow, label: 'tomorrow' }
    case 'this_week':
      return { from: d.weekStart, to: d.weekEnd, label: 'this week' }
    case 'next_week':
      return { from: addDaysIso(d.weekStart, 7), to: addDaysIso(d.weekEnd, 7), label: 'next week' }
    case 'last_month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1]
      return { from: first(py, pm), to: lastOf(py, pm), label: 'last month' }
    }
    case 'this_quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1
      return { from: first(y, qm), to: today, label: 'this quarter' }
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today, label: 'this year' }
    case 'this_month':
    default:
      return { from: first(y, m), to: today, label: 'this month' }
  }
}
const PERIOD_AR: Record<string, string> = { today: 'اليوم', tomorrow: 'بكرة', 'this week': 'هذا الأسبوع', 'next week': 'الأسبوع القادم', 'last month': 'الشهر الماضي', 'this month': 'هذا الشهر', 'this quarter': 'هذا الربع', 'this year': 'هذه السنة' }

/* ---------------- record resolution (only records the user can see) ---------------- */

export type Resolved<T> = { kind: 'one'; value: T } | { kind: 'many'; values: T[] } | { kind: 'none' }

/** A lead the message names (id, company or contact name), else the focus. Only the user's visible leads are searched. */
export function resolveLeadId(ctx: ToolCtx): Resolved<string> {
  const ids = ctx.und.entities.leadIds
  if (ids.length) return { kind: 'one', value: ids[0] }
  const visible = scopeOf(ctx.user.role, 'sales') === 'hidden' ? [] : visibleLeads(ctx.user)
  const scored = visible
    .map((l) => ({ id: l.id, score: Math.max(nameScore(ctx.text, l.company), nameScore(ctx.text, l.contactName) - 5) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length) {
    const top = scored.filter((s) => s.score === scored[0].score)
    return top.length === 1 ? { kind: 'one', value: top[0].id } : { kind: 'many', values: top.slice(0, 5).map((s) => s.id) }
  }
  // "my most overdue lead" / "my next follow-up": the caller's own open lead with the oldest follow-up date.
  if (/most overdue|oldest follow|next follow-?up lead|متاخر/.test(ctx.und.normalized)) {
    const next = visible
      .filter((l) => l.ownerId === ctx.user.id && !isClosedStatus(ctx.co, l.status) && !l.doNotContact && l.nextFollowUpDate)
      .sort((a, b) => (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? ''))[0]
    if (next) return { kind: 'one', value: next.id }
  }
  if (ctx.focus?.type === 'lead') return { kind: 'one', value: ctx.focus.id }
  return { kind: 'none' }
}

export async function resolveCustomerId(ctx: ToolCtx): Promise<Resolved<string>> {
  const ids = ctx.und.entities.customerIds
  if (ids.length) return { kind: 'one', value: ids[0] }
  const list = await attempt(() => getCustomers(ctx.user))
  if (list.ok) {
    const scored = list.value
      .map((c) => ({ id: c.id, score: nameScore(ctx.text, c.name) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored.length) {
      const top = scored.filter((s) => s.score === scored[0].score)
      return top.length === 1 ? { kind: 'one', value: top[0].id } : { kind: 'many', values: top.slice(0, 5).map((s) => s.id) }
    }
  }
  if (ctx.focus?.type === 'customer') return { kind: 'one', value: ctx.focus.id }
  return { kind: 'none' }
}

/** Which lead? — cards of the candidates (all visible to the user). */
export function whichLead(ctx: ToolCtx, ids: string[]): ToolOutput {
  const rows = visibleLeads(ctx.user).filter((l) => ids.includes(l.id))
  return {
    status: 'ok',
    summary: 'ambiguous lead',
    text: L(ctx, 'More than one lead matches. Which one do you mean?', 'أكثر من عميل محتمل يطابق الاسم. أيهم تقصد؟'),
    blocks: [{ type: 'cards', cards: rows.map((l) => leadCard(ctx, { ...l, ownerName: users.find((u) => u.id === l.ownerId)?.name })) }],
    input: {},
  }
}

function leadMissing(ctx: ToolCtx, id: string): ToolOutput {
  return notFound(ctx, 'lead', `I couldn’t find ${id} among the leads you can see.`, `لم أجد ${id} ضمن العملاء المحتملين المتاحين لك.`, { lead_id: id })
}

/* =====================================================================================
 * READ TOOLS
 * =================================================================================== */

/** get_lead_summary */
export async function leadSummary(ctx: ToolCtx, leadId: string): Promise<ToolOutput> {
  const input = { lead_id: leadId }
  if (scopeOf(ctx.user.role, 'sales') === 'hidden') return refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input)
  const got = await attempt(() => getLead(ctx.user, leadId))
  if (!got.ok) return leadMissing(ctx, leadId)
  const lead = got.value
  const [acts, notes, tasks, quotes] = await Promise.all([
    attempt(() => getLeadActivities(ctx.user, leadId)),
    attempt(() => getLeadNotes(ctx.user, leadId)),
    attempt(() => getTasks(ctx.user, { linkType: 'lead', linkId: leadId })),
    attempt(() => getQuotations(ctx.user, { leadId })),
  ])
  const activityList = acts.ok ? acts.value : []
  const noteList = notes.ok ? notes.value : []
  const summary = summarizeNotes(noteList, ctx.lang)
  const stage = statusLabelOf(ctx.co, lead.status)
  const last = activityList[0]
  const blocks: AiBlock[] = [{ type: 'cards', cards: [leadCard(ctx, lead, [{ label: L(ctx, 'Owner', 'المسؤول'), value: lead.ownerName }])] }]
  blocks.push({
    type: 'stats',
    items: [
      { label: L(ctx, 'Stage', 'المرحلة'), value: stage },
      { label: L(ctx, 'Owner', 'المسؤول'), value: lead.ownerName },
      { label: L(ctx, 'Value', 'القيمة'), value: money(lead.value, ctx.currency) },
      { label: L(ctx, 'Next follow-up', 'المتابعة القادمة'), value: lead.nextFollowUpDate ? `${day(lead.nextFollowUpDate)} (${relDay(lead.nextFollowUpDate, ctx.day.today, ctx.lang)})` : '—' },
      { label: L(ctx, 'Score', 'التقييم'), value: `${lead.score}/100` },
    ],
  })
  if (summary.bullets.length) blocks.push({ type: 'bullets', title: L(ctx, 'What the notes say', 'ملخص الملاحظات'), items: summary.bullets })
  if (activityList.length) {
    blocks.push({
      type: 'bullets',
      title: L(ctx, 'Recent activity', 'آخر الأنشطة'),
      items: activityList.slice(0, 3).map((a) => `${day(a.at)} · ${ACTIVITY_LABELS[a.type] ?? a.type} · ${excerpt(a.summary, 120)} (${a.userName})`),
    })
  }
  const openTasks = tasks.ok ? tasks.value.filter((t) => t.status !== 'done' && t.status !== 'cancelled') : []
  if (openTasks.length) blocks.push({ type: 'bullets', title: L(ctx, 'Open tasks', 'المهام المفتوحة'), items: openTasks.slice(0, 3).map((t) => `${t.title}${t.dueDate ? ` — ${day(t.dueDate)}` : ''}${t.overdue ? L(ctx, ' (overdue)', ' (متأخرة)') : ''}`) })
  const quoteList = quotes.ok ? quotes.value : []
  if (quoteList.length) blocks.push({ type: 'bullets', title: L(ctx, 'Quotations', 'عروض الأسعار'), items: quoteList.slice(0, 3).map((q) => `${q.number} · ${QUOTATION_STATUS_LABEL[q.status as keyof typeof QUOTATION_STATUS_LABEL] ?? q.status} · ${money(q.totals.total, q.currency ?? ctx.currency)}`) })
  if (summary.suspicious) {
    blocks.push({ type: 'notice', text: L(ctx, 'One note contains text that reads like instructions to an assistant. I treated it as data and didn’t act on it.', 'إحدى الملاحظات تحتوي على نص يشبه أوامر للمساعد. تعاملت معه كبيانات فقط ولم أنفذ شيئاً.') })
  }
  if (lead.doNotContact) blocks.push({ type: 'notice', text: L(ctx, 'This lead is marked Do Not Contact: calls, emails and WhatsApp are blocked.', 'هذا العميل مُعلّم "عدم التواصل": المكالمات والبريد وواتساب محظورة.') })
  const followUp = lead.nextFollowUpDate ? L(ctx, ` Next follow-up is ${relDay(lead.nextFollowUpDate, ctx.day.today, 'en')} (${day(lead.nextFollowUpDate)}).`, ` المتابعة القادمة ${relDay(lead.nextFollowUpDate, ctx.day.today, 'ar')} (${day(lead.nextFollowUpDate)}).`) : ''
  const lastTxt = last ? L(ctx, ` Last contact: ${ACTIVITY_LABELS[last.type] ?? last.type}, ${relDay(last.at, ctx.day.today, 'en')}.`, ` آخر تواصل: ${relDay(last.at, ctx.day.today, 'ar')}.`) : L(ctx, ' No activity logged yet.', ' لا يوجد نشاط مسجل بعد.')
  const text = L(
    ctx,
    `${lead.company} (${lead.id}) is at ${stage}, owned by ${lead.ownerName}, worth ${money(lead.value, ctx.currency)}.${followUp}${lastTxt}${lead.nextStep ? ` Next step: ${lead.nextStep}.` : ''}`,
    `${lead.company} (${lead.id}) في مرحلة ${stage}، المسؤول ${lead.ownerName}، بقيمة ${money(lead.value, ctx.currency)}.${followUp}${lastTxt}${lead.nextStep ? ` الخطوة التالية: ${lead.nextStep}.` : ''}`,
  )
  return { status: 'ok', summary: `lead ${lead.id}`, text, blocks, focus: { type: 'lead', id: lead.id }, input }
}

/** get_customer_summary */
export async function customerSummary(ctx: ToolCtx, customerId: string): Promise<ToolOutput> {
  const input = { customer_id: customerId }
  if (scopeOf(ctx.user.role, 'sales') === 'hidden') return refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input)
  const got = await attempt(() => getCustomer(ctx.user, customerId))
  if (!got.ok) return notFound(ctx, 'customer', `I couldn’t find ${customerId} among the customers you can see.`, `لم أجد ${customerId} ضمن العملاء المتاحين لك.`, input)
  const c = got.value
  const notes = summarizeNotes(c.notes, ctx.lang)
  const blocks: AiBlock[] = [
    {
      type: 'cards',
      cards: [
        {
          type: 'customer',
          id: c.id,
          title: c.name,
          subtitle: `${c.ownerName}`,
          badge: CUSTOMER_STATUS_LABEL[c.status] ?? c.status,
          link: `/crm/customers/${encodeURIComponent(c.id)}`,
          meta: [
            { label: L(ctx, 'Active contracts', 'العقود السارية'), value: String(c.activeContracts) },
            { label: L(ctx, 'Annual value', 'القيمة السنوية'), value: money(c.activeContractValue, ctx.currency) },
            ...(c.nextRenewal ? [{ label: L(ctx, 'Next renewal', 'التجديد القادم'), value: day(c.nextRenewal) }] : []),
          ],
        },
      ],
    },
  ]
  if (c.contracts.length) {
    blocks.push({
      type: 'table',
      title: L(ctx, 'Contracts', 'العقود'),
      columns: [
        { key: 'title', label: L(ctx, 'Contract', 'العقد') },
        { key: 'status', label: L(ctx, 'Status', 'الحالة') },
        { key: 'renewal', label: L(ctx, 'Renewal', 'التجديد') },
        { key: 'value', label: L(ctx, 'Annual value', 'القيمة السنوية'), align: 'end' },
      ],
      rows: c.contracts.map((k) => ({ title: k.title, status: k.renewalDue ? 'Expiring' : k.status, renewal: day(k.renewalDate), value: money(k.annualValue, ctx.currency) })),
      links: c.contracts.map(() => null),
    })
  }
  if (c.recentActivities.length) blocks.push({ type: 'bullets', title: L(ctx, 'Recent activity', 'آخر الأنشطة'), items: c.recentActivities.slice(0, 3).map((a) => `${day(a.at)} · ${excerpt(a.summary, 120)}`) })
  if (notes.bullets.length) blocks.push({ type: 'bullets', title: L(ctx, 'What the notes say', 'ملخص الملاحظات'), items: notes.bullets })
  if (notes.suspicious) blocks.push({ type: 'notice', text: L(ctx, 'One note contains text that reads like instructions to an assistant. I treated it as data and didn’t act on it.', 'إحدى الملاحظات تحتوي على نص يشبه أوامر للمساعد. تعاملت معه كبيانات فقط.') })
  const text = L(
    ctx,
    `${c.name} is a ${CUSTOMER_STATUS_LABEL[c.status]?.toLowerCase() ?? c.status} customer owned by ${c.ownerName}, with ${c.activeContracts} active contract${c.activeContracts === 1 ? '' : 's'} worth ${money(c.activeContractValue, ctx.currency)} a year.${c.nextRenewal ? ` Next renewal: ${day(c.nextRenewal)}.` : ''}`,
    `${c.name} عميل ${CUSTOMER_STATUS_LABEL[c.status] ?? c.status}، المسؤول ${c.ownerName}، لديه ${c.activeContracts} عقد سارٍ بقيمة ${money(c.activeContractValue, ctx.currency)} سنوياً.${c.nextRenewal ? ` التجديد القادم: ${day(c.nextRenewal)}.` : ''}`,
  )
  return { status: 'ok', summary: `customer ${c.id}`, text, blocks, focus: { type: 'customer', id: c.id }, input }
}

/** get_my_follow_ups */
export async function myFollowUps(ctx: ToolCtx): Promise<ToolOutput> {
  const range = ctx.und.entities.period === 'overdue' ? 'overdue' : ctx.und.entities.period === 'this_week' || ctx.und.entities.period === 'next_week' ? 'this_week' : 'today'
  const input = { range }
  const today = ctx.day.today
  const end = range === 'this_week' ? ctx.day.weekEnd : today
  const salesScope = scopeOf(ctx.user.role, 'sales')
  const team = ctx.und.entities.team && (salesScope === 'team' || salesScope === 'full')
  const leads = salesScope === 'hidden' ? [] : visibleLeads(ctx.user).filter((l) => (team ? true : l.ownerId === ctx.user.id))
  const due = leads
    .filter((l) => !isClosedStatus(ctx.co, l.status) && l.nextFollowUpDate && l.nextFollowUpDate <= end && (range !== 'overdue' || l.nextFollowUpDate < today))
    .sort((a, b) => (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? '') || b.value - a.value)
  const overdue = due.filter((l) => (l.nextFollowUpDate ?? '') < today)
  const dueToday = due.filter((l) => l.nextFollowUpDate === today)
  const tasksRes = await attempt(() => getTasks(ctx.user, { mine: true }))
  const tasks = (tasksRes.ok ? tasksRes.value : []).filter((t) => t.dueDate && t.dueDate <= end && (range !== 'overdue' || t.overdue)).slice(0, 10)
  const blocks: AiBlock[] = []
  if (due.length) {
    blocks.push({
      type: 'cards',
      cards: due.slice(0, 6).map((l) => leadCard(ctx, { ...l, ownerName: team ? users.find((u) => u.id === l.ownerId)?.name : undefined }, l.nextStep ? [{ label: L(ctx, 'Next step', 'الخطوة التالية'), value: l.nextStep }] : [])),
    })
  }
  if (tasks.length) {
    blocks.push({
      type: 'table',
      title: L(ctx, 'Tasks', 'المهام'),
      columns: [
        { key: 'task', label: L(ctx, 'Task', 'المهمة') },
        { key: 'due', label: L(ctx, 'Due', 'الاستحقاق') },
        { key: 'priority', label: L(ctx, 'Priority', 'الأولوية') },
        { key: 'link', label: L(ctx, 'For', 'مرتبطة بـ') },
      ],
      rows: tasks.map((t) => ({ task: t.title, due: `${day(t.dueDate)}${t.overdue ? L(ctx, ' (overdue)', ' (متأخرة)') : ''}`, priority: TASK_PRIORITY_LABEL[t.priority] ?? t.priority, link: t.linkView?.label ?? t.projectName ?? '—' })),
      links: tasks.map((t) => `/tasks/my?task=${encodeURIComponent(t.id)}`),
    })
  }
  const who = team ? L(ctx, 'Your team has', 'فريقك لديه') : L(ctx, 'You have', 'لديك')
  let text: string
  if (!due.length && !tasks.length) {
    text = L(ctx, `Nothing is due ${range === 'this_week' ? 'this week' : range === 'overdue' ? 'and overdue' : 'today'} — you’re all caught up.`, 'لا يوجد شيء مستحق — كل شيء على ما يرام.')
  } else {
    const first = overdue[0] ?? dueToday[0] ?? due[0]
    text = L(
      ctx,
      `${who} ${dueToday.length} follow-up${dueToday.length === 1 ? '' : 's'} due today${overdue.length ? ` and ${overdue.length} overdue` : ''}${range === 'this_week' ? `, ${due.length} in total this week` : ''}, plus ${tasks.length} task${tasks.length === 1 ? '' : 's'}.${first ? ` Start with ${first.company}${(first.nextFollowUpDate ?? '') < today ? ` (overdue since ${day(first.nextFollowUpDate)})` : ''}.` : ''}`,
      `${who} ${dueToday.length} متابعة مستحقة اليوم${overdue.length ? ` و${overdue.length} متأخرة` : ''}، و${tasks.length} مهمة.${first ? ` ابدأ بـ ${first.company}.` : ''}`,
    )
  }
  return { status: 'ok', summary: `${due.length} follow-ups, ${tasks.length} tasks`, text, blocks, input }
}

/** get_pipeline_summary */
export async function pipelineSummary(ctx: ToolCtx): Promise<ToolOutput> {
  const scope = scopeOf(ctx.user.role, 'sales')
  const period = periodRange(ctx.und.entities.period ?? 'this_month', ctx.day)
  const input = { period: ctx.und.entities.period ?? 'this_month', by_owner: scope === 'team' || scope === 'full' }
  if (scope === 'hidden') return refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input)
  const leads = visibleLeads(ctx.user)
  const inP = (iso: string | null | undefined) => !!iso && iso.slice(0, 10) >= period.from && iso.slice(0, 10) <= period.to
  const open = leads.filter((l) => !isClosedStatus(ctx.co, l.status))
  const won = leads.filter((l) => isWonStatus(ctx.co, l.status) && inP(l.wonAt ?? l.stageChangedAt))
  const lost = leads.filter((l) => isLostStatus(ctx.co, l.status) && inP(l.stageChangedAt))
  const created = leads.filter((l) => inP(l.createdAt))
  const openValue = open.reduce((s, l) => s + l.value, 0)
  const weighted = open.reduce((s, l) => s + (l.value * probabilityOf(ctx.co, l.status)) / 100, 0)
  const winRate = won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null
  const ids = new Set(leads.map((l) => l.id))
  const acts = scoped(activities, ctx.user).filter((a) => ids.has(a.leadId) && inP(a.at))
  const blocks: AiBlock[] = [
    {
      type: 'stats',
      items: [
        { label: L(ctx, 'Open pipeline', 'الفرص المفتوحة'), value: `${money(openValue, ctx.currency)} · ${open.length}` },
        { label: L(ctx, 'Weighted forecast', 'التوقع المرجّح'), value: money(weighted, ctx.currency) },
        { label: L(ctx, `Won ${period.label}`, `المكتسب ${PERIOD_AR[period.label]}`), value: `${won.length} · ${money(won.reduce((s, l) => s + l.value, 0), ctx.currency)}` },
        { label: L(ctx, `New leads ${period.label}`, `عملاء جدد ${PERIOD_AR[period.label]}`), value: String(created.length) },
        { label: L(ctx, 'Activities', 'الأنشطة'), value: String(acts.length) },
        { label: L(ctx, 'Win rate', 'نسبة الفوز'), value: winRate === null ? '—' : `${winRate}%` },
      ],
    },
  ]
  const byStage = lookupsFor(ctx.co)
    .statuses.filter((s) => s.active && s.type === 'open')
    .map((s) => ({ stage: s.label, leads: open.filter((l) => l.status === s.key) }))
    .filter((r) => r.leads.length)
  blocks.push({
    type: 'table',
    title: L(ctx, 'Open pipeline by stage', 'الفرص حسب المرحلة'),
    columns: [
      { key: 'stage', label: L(ctx, 'Stage', 'المرحلة') },
      { key: 'leads', label: L(ctx, 'Leads', 'العدد'), align: 'end' },
      { key: 'value', label: L(ctx, 'Value', 'القيمة'), align: 'end' },
    ],
    rows: byStage.map((r) => ({ stage: r.stage, leads: r.leads.length, value: money(r.leads.reduce((s, l) => s + l.value, 0), ctx.currency) })),
    links: byStage.map(() => '/leads/pipeline'),
  })
  const byOwner = scope === 'team' || scope === 'full'
  if (byOwner) {
    const owners = [...new Set(leads.map((l) => l.ownerId))]
    const rows = owners
      .map((id) => {
        const mine = (xs: typeof leads) => xs.filter((l) => l.ownerId === id)
        return {
          owner: users.find((u) => u.id === id)?.name ?? id,
          open: mine(open).length,
          pipeline: mine(open).reduce((s, l) => s + l.value, 0),
          won: mine(won).length,
          wonValue: mine(won).reduce((s, l) => s + l.value, 0),
          created: mine(created).length,
          activities: acts.filter((a) => a.userId === id).length,
        }
      })
      .sort((a, b) => b.wonValue - a.wonValue || b.pipeline - a.pipeline)
    blocks.push({
      type: 'table',
      title: L(ctx, `By owner — ${period.label}`, `حسب المسؤول — ${PERIOD_AR[period.label]}`),
      columns: [
        { key: 'owner', label: L(ctx, 'Owner', 'المسؤول') },
        { key: 'open', label: L(ctx, 'Open', 'مفتوحة'), align: 'end' },
        { key: 'pipeline', label: L(ctx, 'Pipeline', 'القيمة'), align: 'end' },
        { key: 'won', label: L(ctx, 'Won', 'مكتسبة'), align: 'end' },
        { key: 'wonValue', label: L(ctx, 'Won value', 'قيمة المكتسب'), align: 'end' },
        { key: 'created', label: L(ctx, 'New', 'جديدة'), align: 'end' },
        { key: 'activities', label: L(ctx, 'Activities', 'الأنشطة'), align: 'end' },
      ],
      rows: rows.map((r) => ({ ...r, pipeline: money(r.pipeline, ctx.currency), wonValue: money(r.wonValue, ctx.currency) })),
      links: rows.map(() => null),
    })
  } else if (ctx.und.entities.team) {
    blocks.push({ type: 'notice', text: L(ctx, 'Your role sees your own leads only, so these are your numbers.', 'دورك يرى عملاءه فقط، لذلك هذه أرقامك أنت.') })
  }
  const whose = byOwner ? (scope === 'full' ? L(ctx, 'The company', 'الشركة') : L(ctx, 'Your team', 'فريقك')) : L(ctx, 'You', 'أنت')
  const text = L(
    ctx,
    `${whose} ${byOwner ? 'has' : 'have'} ${open.length} open leads worth ${money(openValue, ctx.currency)} (weighted ${money(weighted, ctx.currency)}). ${period.label[0].toUpperCase()}${period.label.slice(1)}: ${won.length} won, ${created.length} new leads, ${acts.length} activities${winRate === null ? '' : `, win rate ${winRate}%`}.`,
    `${whose}: ${open.length} فرصة مفتوحة بقيمة ${money(openValue, ctx.currency)}. ${PERIOD_AR[period.label]}: ${won.length} مكتسبة، ${created.length} عملاء جدد، ${acts.length} نشاط${winRate === null ? '' : `، نسبة الفوز ${winRate}%`}.`,
  )
  return { status: 'ok', summary: `pipeline ${input.period}`, text, blocks, input }
}

/* ---------------- service suggestions ---------------- */

const KEYWORDS: Record<string, RegExp> = {
  Chatbot: /chat|whatsapp|bot|faq|booking|appointment|customer service|arabic/i,
  'CRM Automation': /crm|spreadsheet|follow-?up|lead|automat|pipeline|sales team/i,
  OCR: /ocr|document|invoice|scan|paper|forms?|extraction|id card|passport/i,
  Dashboards: /dashboard|report|kpi|bi\b|visibility|analytics/i,
  'System Integration': /integrat|erp|pos|pms|api|sync|systems/i,
  'Website & Apps': /website|app|online|e-?commerce|booking/i,
  Freight: /freight|ship|sea|air|port|consolidat/i,
  Warehousing: /warehouse|storage|pallet|stock|inventory/i,
  'Customs Clearance': /customs|clearance|import|export|fasah|saber/i,
  'Fleet & Tracking': /fleet|gps|truck|driver|tracking|cold-?chain|temperature/i,
  'Supply Chain Consulting': /supply chain|cost|network|consult|savings/i,
}

export interface Suggestion {
  service: Service
  score: number
  reasons: string[]
}

/** Scores the user's visible active catalog against the lead (services of interest, recommendation, industry, notes). */
export function scoreServices(ctx: ToolCtx, lead: Lead, catalog: Service[], notes: string[]): Suggestion[] {
  const text = [...notes, ...(lead.companyServices ?? []), lead.recommendedServiceText ?? '', lead.nextStep ?? ''].join(' \n ')
  const legacy = matchServiceText(lead.recommendedServiceText, catalog)
  return catalog
    .filter((s) => s.active)
    .map((s) => {
      let score = 0
      const reasons: string[] = []
      if (lead.serviceIds.includes(s.id)) {
        score += 40
        reasons.push(L(ctx, 'listed as a service of interest on the lead', 'مذكورة كخدمة مهتم بها'))
      }
      if (lead.recommendedServiceId === s.id || legacy?.id === s.id) {
        score += 30
        reasons.push(L(ctx, 'the lead’s recommended service', 'الخدمة الموصى بها للعميل'))
      }
      if (s.industries.includes(lead.industry)) {
        score += 25
        reasons.push(L(ctx, `fits the ${lead.industry} industry`, `تناسب قطاع ${lead.industry}`))
      }
      const re = KEYWORDS[s.category]
      const hit = re ? text.match(re) : null
      if (hit) {
        score += 15
        reasons.push(L(ctx, `the notes mention “${hit[0].toLowerCase()}”`, `الملاحظات تذكر "${hit[0].toLowerCase()}"`))
      }
      return { service: s, score, reasons }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.service.name.localeCompare(b.service.name))
}

/** suggest_services */
export async function suggestServices(ctx: ToolCtx, leadId: string): Promise<ToolOutput> {
  const input = { lead_id: leadId }
  const lead = await attempt(() => getLead(ctx.user, leadId))
  if (!lead.ok) return lead.error.status === 403 && scopeOf(ctx.user.role, 'sales') === 'hidden' ? refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input) : leadMissing(ctx, leadId)
  const catalog = await attempt(() => listServices(ctx.user))
  if (!catalog.ok) return refused(ctx, 'forbidden', 'You don’t have access to the services catalog.', 'ليس لديك صلاحية على كتالوج الخدمات.', input)
  const notes = await attempt(() => getLeadNotes(ctx.user, leadId))
  const top = scoreServices(ctx, lead.value as unknown as Lead, catalog.value, notes.ok ? notes.value.map((n) => n.body) : []).slice(0, 3)
  if (!top.length) {
    return { status: 'ok', summary: 'no suggestion', text: L(ctx, `I couldn’t match ${lead.value.company} to a service in your catalog. Add services of interest on the lead, or tell me what they need.`, `لم أجد خدمة مناسبة لـ ${lead.value.company} في الكتالوج.`), blocks: [], focus: { type: 'lead', id: leadId }, input }
  }
  const pk = await attempt(() => listPackages(ctx.user))
  const topIds = new Set(top.map((t) => t.service.id))
  const packs = (pk.ok ? pk.value : []).filter((p) => p.active && p.items.some((i) => topIds.has(i.serviceId))).slice(0, 2)
  const blocks: AiBlock[] = [
    {
      type: 'cards',
      cards: top.map((t) => ({
        type: 'service',
        id: t.service.id,
        title: t.service.name,
        subtitle: t.service.category,
        badge: `${t.service.pricingType} · ${money(t.service.price, t.service.currency)}`,
        link: `/services/${encodeURIComponent(t.service.id)}`,
        meta: [{ label: L(ctx, 'Why', 'السبب'), value: t.reasons.join('; ') }],
      })),
    },
  ]
  if (packs.length) {
    blocks.push({
      type: 'cards',
      cards: packs.map((p) => ({
        type: 'package',
        id: p.id,
        title: p.name,
        subtitle: p.lines.map((x) => x.name).join(' + '),
        badge: money(p.packagePrice, p.currency),
        link: '/services/packages',
        meta: p.saving > 0 ? [{ label: L(ctx, 'Saving', 'التوفير'), value: `${money(p.saving, p.currency)} (${p.savingPct}%)` }] : [],
      })),
    })
  }
  const text = L(
    ctx,
    `For ${lead.value.company} (${lead.value.industry}) I’d suggest ${top.map((t) => t.service.name).join(', ')}. ${top[0].service.name}: ${top[0].reasons.join('; ')}. Want me to create a draft quotation with these?`,
    `أقترح لـ ${lead.value.company}: ${top.map((t) => t.service.name).join('، ')}. هل تريد أن أجهز مسودة عرض سعر بهذه الخدمات؟`,
  )
  return { status: 'ok', summary: `suggested ${top.length}`, text, blocks, focus: { type: 'lead', id: leadId }, input }
}

/** get_quotations */
export async function quotationStatus(ctx: ToolCtx, leadId: string | null, customerId: string | null): Promise<ToolOutput> {
  const input = { lead_id: leadId, customer_id: customerId, include_contracts: true }
  if (scopeOf(ctx.user.role, 'sales') === 'hidden') return refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input)
  const q = await attempt(() => getQuotations(ctx.user, leadId ? { leadId } : {}))
  if (!q.ok) return leadId ? leadMissing(ctx, leadId) : refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input)
  const quotes = q.value.filter((x) => !customerId || x.customerId === customerId).slice(0, 10)
  const k = await attempt(() => getContracts(ctx.user))
  const contracts = (k.ok ? k.value : []).filter((c) => (customerId ? c.customerId === customerId : !leadId && (c.renewalDue || c.daysToRenewal <= 60) && c.status === 'active')).slice(0, 8)
  const blocks: AiBlock[] = []
  if (quotes.length) {
    blocks.push({
      type: 'table',
      title: L(ctx, 'Quotations', 'عروض الأسعار'),
      columns: [
        { key: 'number', label: L(ctx, 'Number', 'الرقم') },
        { key: 'company', label: L(ctx, 'Company', 'الشركة') },
        { key: 'status', label: L(ctx, 'Status', 'الحالة') },
        { key: 'total', label: L(ctx, 'Total', 'الإجمالي'), align: 'end' },
        { key: 'validUntil', label: L(ctx, 'Valid until', 'صالح حتى') },
      ],
      rows: quotes.map((x) => ({ number: x.number, company: x.company, status: QUOTATION_STATUS_LABEL[x.status as keyof typeof QUOTATION_STATUS_LABEL] ?? x.status, total: money(x.totals.total, x.currency ?? ctx.currency), validUntil: day(x.validUntil) })),
      links: quotes.map((x) => `/sales/quotations/${encodeURIComponent(x.id)}`),
    })
  }
  if (contracts.length) {
    blocks.push({
      type: 'table',
      title: customerId ? L(ctx, 'Contracts', 'العقود') : L(ctx, 'Contracts renewing soon', 'عقود قريبة التجديد'),
      columns: [
        { key: 'title', label: L(ctx, 'Contract', 'العقد') },
        { key: 'customer', label: L(ctx, 'Customer', 'العميل') },
        { key: 'renewal', label: L(ctx, 'Renewal', 'التجديد') },
        { key: 'value', label: L(ctx, 'Annual value', 'القيمة السنوية'), align: 'end' },
      ],
      rows: contracts.map((c) => ({ title: c.title, customer: c.customerName, renewal: `${day(c.renewalDate)} (${relDay(c.renewalDate, ctx.day.today, ctx.lang)})`, value: money(c.annualValue, ctx.currency) })),
      links: contracts.map((c) => `/crm/customers/${encodeURIComponent(c.customerId)}`),
    })
  }
  const counts = (s: string) => quotes.filter((x) => x.status === s).length
  const text = quotes.length || contracts.length
    ? L(ctx, `${quotes.length} quotation${quotes.length === 1 ? '' : 's'}: ${counts('draft')} draft, ${counts('sent') + counts('viewed')} awaiting the client, ${counts('accepted')} accepted.${contracts.length ? ` ${contracts.length} contract${contracts.length === 1 ? '' : 's'} listed.` : ''}`, `${quotes.length} عرض سعر: ${counts('draft')} مسودة، ${counts('sent') + counts('viewed')} بانتظار العميل، ${counts('accepted')} مقبول.`)
    : L(ctx, 'No quotations or contracts match.', 'لا توجد عروض أسعار أو عقود مطابقة.')
  return { status: 'ok', summary: `${quotes.length} quotations`, text, blocks, focus: leadId ? { type: 'lead', id: leadId } : customerId ? { type: 'customer', id: customerId } : undefined, input }
}

/** get_overdue_invoices (accounting only) */
export async function overdueInvoices(ctx: ToolCtx): Promise<ToolOutput> {
  const input = {}
  if (!hasModule(ctx, 'accounting')) return notInPlan(ctx, 'Accounts & finance', 'الحسابات والمالية')
  if (scopeOf(ctx.user.role, 'accounting') === 'hidden') return refused(ctx, 'forbidden', FINANCE_REFUSAL.en, FINANCE_REFUSAL.ar, input)
  const list = await attempt(() => listInvoices(ctx.user, { status: 'overdue' }))
  if (!list.ok) return refused(ctx, 'forbidden', FINANCE_REFUSAL.en, FINANCE_REFUSAL.ar, input)
  const rows = [...list.value].sort((a, b) => b.daysOverdue - a.daysOverdue || b.baseBalanceDue - a.baseBalanceDue)
  const aging = await attempt(() => getAging(ctx.user))
  const total = rows.reduce((s, r) => s + r.baseBalanceDue, 0)
  const blocks: AiBlock[] = [
    {
      type: 'table',
      title: L(ctx, 'Overdue invoices', 'الفواتير المتأخرة'),
      columns: [
        { key: 'number', label: L(ctx, 'Invoice', 'الفاتورة') },
        { key: 'customer', label: L(ctx, 'Customer', 'العميل') },
        { key: 'due', label: L(ctx, 'Due', 'تاريخ الاستحقاق') },
        { key: 'daysOverdue', label: L(ctx, 'Days overdue', 'أيام التأخير'), align: 'end' },
        { key: 'balance', label: L(ctx, 'Balance', 'المتبقي'), align: 'end' },
      ],
      rows: rows.slice(0, 15).map((r) => ({ number: r.number, customer: r.customerName, due: day(r.dueDate), daysOverdue: r.daysOverdue, balance: money(r.balanceDue, r.currency) })),
      links: rows.slice(0, 15).map((r) => `/finance/invoices/${encodeURIComponent(r.id)}`),
    },
  ]
  if (aging.ok) {
    blocks.push({ type: 'stats', items: AGING_BUCKETS.map((b) => ({ label: `${AGING_BUCKET_LABEL[b]}${b === 'current' ? '' : L(ctx, ' days', ' يوم')}`, value: money(aging.value.totals[b], aging.value.baseCurrency) })) })
  }
  const worst = rows[0]
  const text = rows.length
    ? L(ctx, `${rows.length} invoice${rows.length === 1 ? ' is' : 's are'} overdue, ${money(total, ctx.currency)} in total.${worst ? ` The oldest is ${worst.number} for ${worst.customerName}, ${worst.daysOverdue} days late.` : ''}`, `${rows.length} فاتورة متأخرة بإجمالي ${money(total, ctx.currency)}.${worst ? ` الأقدم ${worst.number} لـ ${worst.customerName} متأخرة ${worst.daysOverdue} يوم.` : ''}`)
    : L(ctx, 'No invoices are overdue right now.', 'لا توجد فواتير متأخرة حالياً.')
  return { status: 'ok', summary: `${rows.length} overdue invoices`, text, blocks, input }
}

/** get_kpis (accounting only) */
export async function financeKpis(ctx: ToolCtx): Promise<ToolOutput> {
  const input = { metric: 'all', period: 'this_month' }
  if (!hasModule(ctx, 'accounting')) return notInPlan(ctx, 'Accounts & finance', 'الحسابات والمالية')
  if (scopeOf(ctx.user.role, 'accounting') === 'hidden') return refused(ctx, 'forbidden', FINANCE_REFUSAL.en, FINANCE_REFUSAL.ar, input)
  const o = await attempt(() => getFinanceOverview(ctx.user))
  if (!o.ok) return refused(ctx, 'forbidden', FINANCE_REFUSAL.en, FINANCE_REFUSAL.ar, input)
  const v = o.value
  const change = v.revenue.lastMonth ? Math.round(((v.revenue.thisMonth - v.revenue.lastMonth) / Math.abs(v.revenue.lastMonth)) * 100) : null
  const blocks: AiBlock[] = [
    {
      type: 'stats',
      items: [
        { label: L(ctx, 'Revenue this month', 'إيرادات هذا الشهر'), value: money(v.revenue.thisMonth, v.currency) },
        { label: L(ctx, 'Revenue last month', 'إيرادات الشهر الماضي'), value: money(v.revenue.lastMonth, v.currency) },
        { label: L(ctx, 'Cash and bank', 'النقد والبنوك'), value: money(v.cashTotal, v.currency) },
        { label: L(ctx, 'Receivables', 'الذمم المدينة'), value: `${money(v.receivables.total, v.currency)} · ${v.receivables.openCount}` },
        { label: L(ctx, 'Overdue', 'المتأخر'), value: `${money(v.receivables.overdue, v.currency)} · ${v.receivables.overdueCount}` },
        { label: L(ctx, 'VAT payable', 'ضريبة مستحقة'), value: money(v.vat.payable, v.currency) },
      ],
    },
  ]
  const text = L(
    ctx,
    `Revenue this month is ${money(v.revenue.thisMonth, v.currency)}${change === null ? '' : ` (${change >= 0 ? '+' : ''}${change}% vs last month)`}. Cash and bank: ${money(v.cashTotal, v.currency)}; receivables ${money(v.receivables.total, v.currency)}, of which ${money(v.receivables.overdue, v.currency)} overdue.`,
    `إيرادات هذا الشهر ${money(v.revenue.thisMonth, v.currency)}${change === null ? '' : ` (${change >= 0 ? '+' : ''}${change}% عن الشهر الماضي)`}. النقد: ${money(v.cashTotal, v.currency)}؛ الذمم المدينة ${money(v.receivables.total, v.currency)} منها ${money(v.receivables.overdue, v.currency)} متأخرة.`,
  )
  return { status: 'ok', summary: 'finance kpis', text, blocks, input }
}

/** get_leave (HR plan module) */
export async function leaveInfo(ctx: ToolCtx): Promise<ToolOutput> {
  const e = ctx.und.entities
  const askTeam = e.team || /who|مين|منو|مين في|anyone|people/i.test(ctx.und.normalized) || (!!e.period && !e.self)
  const input = { who: askTeam ? 'team' : 'me', period: e.period ?? (askTeam ? 'next_week' : null) }
  if (!hasModule(ctx, 'hr')) return notInPlan(ctx, 'HR', 'الموارد البشرية')
  const hrScope = scopeOf(ctx.user.role, 'hr')
  if (!askTeam) {
    const mine = await attempt(() => getMyLeave(ctx.user))
    if (!mine.ok) return refused(ctx, 'no_employee_record', mine.error.message, 'ليس لديك سجل موظف نشط في هذه الشركة. تواصل مع الموارد البشرية.', input)
    const m = mine.value
    const upcoming = m.requests.filter((r) => r.endDate >= ctx.day.today && (r.status === 'approved' || r.status.startsWith('pending'))).slice(0, 5)
    const blocks: AiBlock[] = [
      {
        type: 'table',
        title: L(ctx, `Your leave balances ${m.year}`, `أرصدة إجازاتك ${m.year}`),
        columns: [
          { key: 'type', label: L(ctx, 'Type', 'النوع') },
          { key: 'entitled', label: L(ctx, 'Entitled', 'المستحق'), align: 'end' },
          { key: 'used', label: L(ctx, 'Used', 'المستخدم'), align: 'end' },
          { key: 'pending', label: L(ctx, 'Pending', 'قيد الموافقة'), align: 'end' },
          { key: 'remaining', label: L(ctx, 'Remaining', 'المتبقي'), align: 'end' },
        ],
        rows: m.balances.map((b) => ({ type: b.leaveTypeName, entitled: b.entitledDays, used: b.usedDays, pending: b.pendingDays, remaining: b.remainingDays })),
        links: m.balances.map(() => '/hr/leave'),
      },
    ]
    if (upcoming.length) blocks.push({ type: 'bullets', title: L(ctx, 'Your upcoming leave', 'إجازاتك القادمة'), items: upcoming.map((r) => `${r.leaveTypeName ?? ''} ${day(r.startDate)} – ${day(r.endDate)} (${r.status})`) })
    const annual = m.balances.find((b) => b.code === 'annual') ?? m.balances[0]
    const text = annual
      ? L(ctx, `You have ${annual.remainingDays} days of ${annual.leaveTypeName.toLowerCase()} left this year${annual.pendingDays ? ` (${annual.pendingDays} pending approval)` : ''}.`, `متبقي لك ${annual.remainingDays} يوم من ${annual.leaveTypeName} هذه السنة.`)
      : L(ctx, 'You have no leave balances set up yet.', 'لا توجد أرصدة إجازات بعد.')
    return { status: 'ok', summary: 'own leave', text, blocks, input }
  }
  const range = periodRange(e.period ?? 'next_week', ctx.day)
  const months = [...new Set([range.from.slice(0, 7), range.to.slice(0, 7)])]
  const entries: { name: string; type: string; from: string; to: string; status: string; employeeId: string }[] = []
  for (const month of months) {
    const cal = await attempt(() => getLeaveCalendar(ctx.user, month))
    if (!cal.ok) return refused(ctx, 'forbidden', HR_REFUSAL.en, HR_REFUSAL.ar, input)
    for (const x of cal.value.entries) {
      if (x.startDate <= range.to && x.endDate >= range.from && !entries.some((y) => y.employeeId === x.employeeId && y.from === x.startDate)) {
        entries.push({ name: x.employeeName, type: x.leaveTypeName, from: x.startDate, to: x.endDate, status: x.status, employeeId: x.employeeId })
      }
    }
  }
  const blocks: AiBlock[] = []
  if (hrScope === 'own' || hrScope === 'hidden') blocks.push({ type: 'notice', text: L(ctx, HR_REFUSAL.en, HR_REFUSAL.ar) })
  if (entries.length) {
    blocks.push({
      type: 'table',
      title: L(ctx, `On leave ${range.label} (${day(range.from)} – ${day(range.to)})`, `في إجازة ${PERIOD_AR[range.label]} (${day(range.from)} – ${day(range.to)})`),
      columns: [
        { key: 'name', label: L(ctx, 'Employee', 'الموظف') },
        { key: 'type', label: L(ctx, 'Leave', 'الإجازة') },
        { key: 'from', label: L(ctx, 'From', 'من') },
        { key: 'to', label: L(ctx, 'To', 'إلى') },
        { key: 'status', label: L(ctx, 'Status', 'الحالة') },
      ],
      rows: entries.map((x) => ({ name: x.name, type: x.type, from: day(x.from), to: day(x.to), status: x.status === 'approved' ? L(ctx, 'Approved', 'موافق عليها') : L(ctx, 'Pending', 'قيد الموافقة') })),
      links: entries.map(() => '/hr/leave'),
    })
  }
  const text = entries.length
    ? L(ctx, `${entries.length} ${entries.length === 1 ? 'person is' : 'people are'} on leave ${range.label}: ${entries.map((x) => x.name).slice(0, 4).join(', ')}${entries.length > 4 ? '…' : ''}.`, `${entries.length} في إجازة ${PERIOD_AR[range.label]}: ${entries.map((x) => x.name).slice(0, 4).join('، ')}.`)
    : L(ctx, `Nobody ${hrScope === 'own' || hrScope === 'hidden' ? '(that you can see) ' : ''}is on leave ${range.label}.`, `لا أحد في إجازة ${PERIOD_AR[range.label]}.`)
  return { status: 'ok', summary: `${entries.length} on leave`, text, blocks, input }
}

/** get_event_registrations (events plan module) */
export async function eventRegistrations(ctx: ToolCtx): Promise<ToolOutput> {
  const input = { event_id: ctx.und.entities.eventIds[0] ?? null }
  if (!hasModule(ctx, 'events')) return notInPlan(ctx, 'Events', 'الفعاليات')
  const from = addDaysIso(ctx.day.today, -30)
  const to = addDaysIso(ctx.day.today, 120)
  const list = await attempt(() => listEvents(ctx.user, { from, to }))
  if (!list.ok) return refused(ctx, 'forbidden', 'Events aren’t part of your role.', 'الفعاليات ليست ضمن صلاحيات دورك.', input)
  const rows = list.value
    .filter((r) => r.status !== 'cancelled' && (!input.event_id || r.id === input.event_id))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 10)
  const stats = input.event_id && rows[0] ? await attempt(() => getEventStats(ctx.user, rows[0].id)) : null
  const blocks: AiBlock[] = []
  if (rows.length) {
    blocks.push({
      type: 'table',
      title: L(ctx, 'Events', 'الفعاليات'),
      columns: [
        { key: 'name', label: L(ctx, 'Event', 'الفعالية') },
        { key: 'date', label: L(ctx, 'Date', 'التاريخ') },
        { key: 'registered', label: L(ctx, 'Registered', 'المسجلون'), align: 'end' },
        { key: 'capacity', label: L(ctx, 'Capacity', 'السعة'), align: 'end' },
        { key: 'status', label: L(ctx, 'Status', 'الحالة') },
      ],
      rows: rows.map((r) => ({ name: r.name, date: day(r.startDate), registered: r.attendeeCount, capacity: r.capacity ?? '—', status: r.status })),
      links: rows.map((r) => `/events/${encodeURIComponent(r.id)}`),
    })
  }
  if (stats?.ok) {
    const s = stats.value
    blocks.push({ type: 'stats', items: [{ label: L(ctx, 'Attendees', 'الحضور'), value: String(s.attendees) }, { label: L(ctx, 'Checked in', 'سجلوا الحضور'), value: String(s.checkedIn) }, { label: L(ctx, 'Leads', 'العملاء'), value: String(s.leads) }, { label: L(ctx, 'Won', 'المكتسب'), value: money(s.wonValue, s.currency) }] })
  }
  const upcoming = rows.filter((r) => r.startDate >= ctx.day.today)
  const total = rows.reduce((s, r) => s + r.attendeeCount, 0)
  const text = rows.length
    ? L(ctx, `${rows.length} event${rows.length === 1 ? '' : 's'} in view (${upcoming.length} upcoming) with ${total} registrations.${upcoming[0] ? ` Next: ${upcoming[0].name} on ${day(upcoming[0].startDate)} — ${upcoming[0].attendeeCount}${upcoming[0].capacity ? ` of ${upcoming[0].capacity}` : ''} registered.` : ''}`, `${rows.length} فعالية بإجمالي ${total} تسجيل.${upcoming[0] ? ` القادمة: ${upcoming[0].name} في ${day(upcoming[0].startDate)}.` : ''}`)
    : L(ctx, 'No events in the last 30 days or the next 4 months that you can see.', 'لا توجد فعاليات متاحة لك في هذه الفترة.')
  return { status: 'ok', summary: `${rows.length} events`, text, blocks, input }
}

/** search_records */
export async function searchRecords(ctx: ToolCtx): Promise<ToolOutput> {
  const q = ctx.und.normalized.replace(/^(please )?(find|search( for)?|look ?up|show me|where is|ابحث عن|ابحث|دور على|دورلي|وريني)\s*/, '').trim()
  const input = { query: q }
  const cards: AiCard[] = []
  if (scopeOf(ctx.user.role, 'sales') !== 'hidden') {
    const leads = visibleLeads(ctx.user)
      .map((l) => ({ l, s: Math.max(nameScore(ctx.text, l.company), nameScore(ctx.text, l.contactName), ctx.und.entities.leadIds.includes(l.id) ? 100 : 0, q && l.industry.toLowerCase() === q ? 30 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
    cards.push(...leads.map(({ l }) => leadCard(ctx, { ...l, ownerName: users.find((u) => u.id === l.ownerId)?.name })))
    const cs = await attempt(() => getCustomers(ctx.user))
    if (cs.ok) {
      for (const c of cs.value.filter((c) => nameScore(ctx.text, c.name) > 0 || ctx.und.entities.customerIds.includes(c.id)).slice(0, 3)) {
        cards.push({ type: 'customer', id: c.id, title: c.name, subtitle: c.ownerName, badge: CUSTOMER_STATUS_LABEL[c.status] ?? c.status, link: `/crm/customers/${encodeURIComponent(c.id)}`, meta: [] })
      }
    }
  }
  const ts = await attempt(() => getTasks(ctx.user, {}))
  if (ts.ok && q.length >= 3) {
    for (const t of ts.value.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 3)) {
      cards.push({ type: 'task', id: t.id, title: t.title, subtitle: t.ownerName, badge: t.overdue ? 'Overdue' : t.status, link: `/tasks/my?task=${encodeURIComponent(t.id)}`, meta: t.dueDate ? [{ label: L(ctx, 'Due', 'الاستحقاق'), value: day(t.dueDate) }] : [] })
    }
  }
  const text = cards.length ? L(ctx, `I found ${cards.length} matching record${cards.length === 1 ? '' : 's'} you can see.`, `وجدت ${cards.length} سجل مطابق.`) : L(ctx, 'Nothing you can see matches that. Try a company name or an id like L-1016.', 'لا يوجد ما يطابق بحثك ضمن ما يمكنك رؤيته.')
  return { status: 'ok', summary: `${cards.length} results`, text, blocks: cards.length ? [{ type: 'cards', cards }] : [], input }
}

/* =====================================================================================
 * WRITE TOOLS — proposals only (nothing changes here)
 * =================================================================================== */

const salesWriteRefusal = (ctx: ToolCtx, input: Record<string, unknown>) =>
  refused(ctx, 'forbidden', 'Your role can view leads but not change them, so I can’t prepare that change.', 'دورك يسمح بعرض العملاء فقط دون تعديلهم، لذلك لا أستطيع تجهيز هذا التغيير.', input)

async function writableLead(ctx: ToolCtx, leadId: string, input: Record<string, unknown>): Promise<{ lead: Awaited<ReturnType<typeof getLead>> } | { out: ToolOutput }> {
  if (scopeOf(ctx.user.role, 'sales') === 'hidden') return { out: refused(ctx, 'forbidden', SALES_REFUSAL.en, SALES_REFUSAL.ar, input) }
  const got = await attempt(() => getLead(ctx.user, leadId))
  if (!got.ok) return { out: leadMissing(ctx, leadId) }
  if (!can(ctx.user.role, 'sales', 'edit')) return { out: salesWriteRefusal(ctx, input) }
  return { lead: got.value }
}

/** draft_email — a lead: a send proposal (sent and logged through POST /leads/:id/messages on confirm); a customer: a draft to copy. */
export async function proposeEmail(ctx: ToolCtx, target: { leadId?: string; customerId?: string }): Promise<ToolOutput> {
  const e = ctx.und.entities
  const tone = e.tone ?? 'friendly'
  const lang = e.language ?? ctx.lang
  const purpose = e.purpose ?? 'follow_up'
  const company = companyById(ctx.co)
  const sender = emailSenderOf(ctx.user)
  if (target.customerId) {
    const input = { customer_id: target.customerId, purpose, tone, language: lang }
    const c = await attempt(() => getCustomer(ctx.user, target.customerId!))
    if (!c.ok) return notFound(ctx, 'customer', `I couldn’t find ${target.customerId} among the customers you can see.`, `لم أجد ${target.customerId}.`, input)
    const contact = c.value.contacts.find((x) => x.isDecisionMaker) ?? c.value.contacts[0]
    const d = draftEmail({ contactName: contact?.name ?? c.value.name, company: c.value.name, senderName: ctx.user.name, senderCompany: company?.name ?? '', services: [], nextStep: '', lastTouch: null }, purpose, tone, lang)
    return {
      status: 'ok',
      summary: 'customer draft',
      text: L(ctx, `Here’s a draft for ${c.value.name}${contact?.email ? ` (${contact.email})` : ''}. Customers don’t have an email log here yet, so copy it into your mail app.`, `هذه مسودة لـ ${c.value.name}. انسخها إلى بريدك.`),
      blocks: [{ type: 'draft', subject: d.subject, body: d.body, language: lang }],
      focus: { type: 'customer', id: c.value.id },
      input,
    }
  }
  const leadId = target.leadId!
  const input = { lead_id: leadId, purpose, tone, language: lang }
  const w = await writableLead(ctx, leadId, input)
  if ('out' in w) return w.out
  const lead = w.lead
  if (lead.doNotContact) return refused(ctx, 'do_not_contact', `${lead.company} is marked Do Not Contact, so I won’t draft an email to them.`, `${lead.company} مُعلّم "عدم التواصل"، لذلك لن أكتب له بريداً.`, input)
  const contact = lead.contacts.find((x) => x.isDecisionMaker && x.email) ?? lead.contacts.find((x) => x.email)
  const to = lead.contactEmail || contact?.email || ''
  const catalog = await attempt(() => listServices(ctx.user))
  const names = catalog.ok ? catalog.value.filter((s) => lead.serviceIds.includes(s.id)).map((s) => s.name) : []
  const acts = await attempt(() => getLeadActivities(ctx.user, leadId))
  const d = draftEmail(
    { contactName: lead.contactName || contact?.name || lead.company, company: lead.company, senderName: ctx.user.name, senderCompany: sender.name || company?.name || '', services: names, nextStep: lead.nextStep, lastTouch: acts.ok && acts.value[0] ? acts.value[0].at : null },
    purpose,
    tone,
    lang,
  )
  const summaryLine = `Email sent to ${lead.contactName || to}: ${d.subject}`
  return {
    status: 'proposed',
    summary: 'email proposal',
    text: L(ctx, `Here’s a ${tone} ${purpose.replace('_', '-')} email to ${lead.contactName || to} at ${lead.company}. Review it, edit anything, then confirm to send — nothing is sent until you do.`, `هذه مسودة بريد إلى ${lead.contactName || to} في ${lead.company}. راجعها وعدّل ما تريد ثم أكّد للإرسال — لن يُرسل شيء قبل تأكيدك.`),
    blocks: [],
    focus: { type: 'lead', id: lead.id },
    input,
    proposal: {
      tool: 'draft_email',
      title: L(ctx, `Send email to ${lead.contactName || to}`, `إرسال بريد إلى ${lead.contactName || to}`),
      summary: L(ctx, `Sends this email from ${sender.address || 'the company sender'} and logs it on ${lead.company}’s timeline.`, `يرسل هذا البريد ويسجله في سجل ${lead.company}.`),
      record: { type: 'lead', id: lead.id, label: lead.company },
      input: { leadId: lead.id, channel: 'email', to, subject: d.subject, body: d.body, language: lang, tone },
      editable: ['to', 'subject', 'body'],
      changes: [
        { field: 'email', label: L(ctx, 'Email', 'البريد'), from: '—', to: `${to} · ${d.subject}` },
        { field: 'activity', label: L(ctx, 'Lead timeline', 'سجل العميل'), from: '—', to: summaryLine },
        ...(lead.status === SYSTEM_STATUS.new ? [{ field: 'status', label: L(ctx, 'Stage (automatic)', 'المرحلة (تلقائي)'), from: statusLabelOf(ctx.co, SYSTEM_STATUS.new), to: statusLabelOf(ctx.co, SYSTEM_STATUS.contacted) }] : []),
      ],
      choices: {},
    },
  }
}

/** The task due date said in the message, on the company's calendar (default: tomorrow). */
export function dueDateOf(ctx: ToolCtx, e: AiEntities): string {
  const d = e.due
  if (!d) return ctx.day.tomorrow
  if (d.kind === 'date') return d.date
  if (d.kind === 'days') return addDaysIso(ctx.day.today, d.days)
  const wd = new Date(`${ctx.day.today}T00:00:00Z`).getUTCDay()
  const ahead = (d.weekday - wd + 7) % 7 || 7
  return addDaysIso(ctx.day.today, ahead)
}

const WHEN = /\s+(?:tomorrow|today|tonight|next week|on (?:mon|tues|wednes|thurs|fri|satur|sun)day|on \d{4}-\d\d-\d\d|in \d{1,3} days?|by \w+)\b/gi

/** "remind me tomorrow to call Crescent" → "Call Crescent"; "add a task to send the deck" → "Send the deck". */
export function taskTitleOf(text: string): string | null {
  const m = text.match(/\bremind me\b(?:\s+(?:tomorrow|today|next week|on \w+|in \d{1,3} days?))?\s+to\s+(.+)$/i) ?? text.match(/\b(?:task|reminder|follow-?up)\s+to\s+(.+)$/i)
  if (!m) return null
  const t = m[1].replace(WHEN, '').replace(/[.!?]+$/, '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null
}

/** create_task */
export async function proposeTask(ctx: ToolCtx, leadId: string | null): Promise<ToolOutput> {
  const e = ctx.und.entities
  const dueDate = dueDateOf(ctx, e)
  const input: Record<string, unknown> = { title: null, due_date: dueDate, lead_id: leadId, priority: e.priority ?? 'medium' }
  if (!can(ctx.user.role, 'tasks', 'create')) return refused(ctx, 'forbidden', 'Your role can’t create tasks.', 'دورك لا يسمح بإنشاء مهام.', input)
  let lead: { id: string; company: string } | null = null
  if (leadId) {
    const got = await attempt(() => getLead(ctx.user, leadId))
    if (!got.ok) return leadMissing(ctx, leadId)
    lead = got.value
  }
  const said = e.quoted ?? taskTitleOf(ctx.text)
  const title = (said?.trim() ||(lead ? L(ctx, `Follow up with ${lead.company}`, `متابعة ${lead.company}`) : L(ctx, 'Follow up', 'متابعة'))).slice(0, 200)
  input.title = title
  return {
    status: 'proposed',
    summary: 'task proposal',
    text: L(ctx, `I’ll create this task for you${lead ? ` on ${lead.company}` : ''}, due ${day(dueDate)}. Confirm to create it.`, `سأنشئ هذه المهمة${lead ? ` لـ ${lead.company}` : ''} بتاريخ ${day(dueDate)}. أكّد للإنشاء.`),
    blocks: [],
    focus: lead ? { type: 'lead', id: lead.id } : undefined,
    input,
    proposal: {
      tool: 'create_task',
      title: L(ctx, 'Create a task', 'إنشاء مهمة'),
      summary: L(ctx, `Adds a task for ${ctx.user.name}${lead ? `, linked to ${lead.company}` : ''}.`, `يضيف مهمة لـ ${ctx.user.name}.`),
      record: lead ? { type: 'lead', id: lead.id, label: lead.company } : null,
      input: { title, dueDate, priority: e.priority ?? 'medium', ownerId: ctx.user.id, link: lead ? { type: 'lead', id: lead.id } : null },
      editable: ['title', 'dueDate', 'priority'],
      changes: [
        { field: 'title', label: L(ctx, 'Task', 'المهمة'), from: '—', to: title },
        { field: 'dueDate', label: L(ctx, 'Due', 'الاستحقاق'), from: '—', to: dueDate },
        { field: 'priority', label: L(ctx, 'Priority', 'الأولوية'), from: '—', to: e.priority ?? 'medium' },
        ...(lead ? [{ field: 'link', label: L(ctx, 'Linked to', 'مرتبطة بـ'), from: '—', to: `${lead.company} (${lead.id})` }] : []),
      ],
      choices: { priority: ['low', 'medium', 'high', 'urgent'].map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p as keyof typeof TASK_PRIORITY_LABEL] ?? p })) },
    },
  }
}

/** log_call */
export async function proposeCallLog(ctx: ToolCtx, leadId: string): Promise<ToolOutput> {
  const input: Record<string, unknown> = { lead_id: leadId, summary: null }
  const w = await writableLead(ctx, leadId, input)
  if ('out' in w) return w.out
  const lead = w.lead
  if (lead.doNotContact) return refused(ctx, 'do_not_contact', `${lead.company} is marked Do Not Contact, so calls can’t be logged.`, `${lead.company} مُعلّم "عدم التواصل".`, input)
  const summary = (ctx.und.entities.quoted ?? L(ctx, `Call with ${lead.contactName || lead.company}`, `مكالمة مع ${lead.contactName || lead.company}`)).slice(0, 500)
  input.summary = summary
  return {
    status: 'proposed',
    summary: 'call proposal',
    text: L(ctx, `I’ll log this call on ${lead.company}. Edit the note if needed, then confirm.`, `سأسجل هذه المكالمة على ${lead.company}. عدّل الملاحظة ثم أكّد.`),
    blocks: [],
    focus: { type: 'lead', id: lead.id },
    input,
    proposal: {
      tool: 'log_call',
      title: L(ctx, `Log a call on ${lead.company}`, `تسجيل مكالمة على ${lead.company}`),
      summary: L(ctx, 'Adds a call to the lead’s activity timeline.', 'يضيف مكالمة إلى سجل نشاط العميل.'),
      record: { type: 'lead', id: lead.id, label: lead.company },
      input: { leadId: lead.id, type: 'call', summary },
      editable: ['summary'],
      changes: [
        { field: 'activity', label: L(ctx, 'Lead timeline', 'سجل العميل'), from: '—', to: `Call: ${summary}` },
        ...(lead.status === SYSTEM_STATUS.new ? [{ field: 'status', label: L(ctx, 'Stage (automatic)', 'المرحلة (تلقائي)'), from: statusLabelOf(ctx.co, SYSTEM_STATUS.new), to: statusLabelOf(ctx.co, SYSTEM_STATUS.contacted) }] : []),
      ],
      choices: {},
    },
  }
}

/** move_lead_stage — the company's own stage list; Won only through the Won flow. */
export async function proposeMove(ctx: ToolCtx, leadId: string): Promise<ToolOutput> {
  const e = ctx.und.entities
  const input: Record<string, unknown> = { lead_id: leadId, status: e.stageText }
  const w = await writableLead(ctx, leadId, input)
  if ('out' in w) return w.out
  const lead = w.lead
  const lk = lookupsFor(ctx.co)
  const active = lk.statuses.filter((s) => s.active)
  const said = (e.stageText ?? '').toLowerCase()
  const target = said ? (active.find((s) => s.label.toLowerCase() === said || s.key.toLowerCase() === said) ?? active.find((s) => said.includes(s.label.toLowerCase()) || s.label.toLowerCase().includes(said))) : undefined
  if (!target) {
    return {
      status: 'ok',
      summary: 'stage unknown',
      text: L(ctx, `Which stage should ${lead.company} move to? Your stages: ${active.map((s) => s.label).join(', ')}.`, `إلى أي مرحلة تريد نقل ${lead.company}؟ المراحل: ${active.map((s) => s.label).join('، ')}.`),
      blocks: [],
      focus: { type: 'lead', id: lead.id },
      input,
    }
  }
  input.status = target.key
  if (target.type === 'won') {
    return refused(ctx, 'use_won_flow', 'Winning a lead runs the Won flow (customer, contract, projects and tasks together). Open the lead and use “Mark as won”.', 'كسب العميل يتم عبر مسار "تم الفوز" (عميل وعقد ومشاريع معاً). افتح العميل واستخدم "تم الفوز".', input)
  }
  if (target.key === lead.status) {
    return { status: 'ok', summary: 'same stage', text: L(ctx, `${lead.company} is already at ${target.label}.`, `${lead.company} بالفعل في مرحلة ${target.label}.`), blocks: [], focus: { type: 'lead', id: lead.id }, input }
  }
  const proposalInput: Record<string, unknown> = { id: lead.id, status: target.key }
  const editable: string[] = []
  const changes = [{ field: 'status', label: L(ctx, 'Stage', 'المرحلة'), from: statusLabelOf(ctx.co, lead.status), to: target.label }]
  const choices: Record<string, { value: string; label: string }[]> = {}
  if (target.requiresNextStep) {
    const nextStep = (e.quoted ?? lead.nextStep ?? '') || L(ctx, `Follow up on ${target.label.toLowerCase()}`, `متابعة ${target.label}`)
    const date = e.due ? dueDateOf(ctx, e) : addDaysIso(ctx.day.today, 2)
    Object.assign(proposalInput, { nextStep, nextFollowUpDate: date })
    editable.push('nextStep', 'nextFollowUpDate')
    changes.push({ field: 'nextStep', label: L(ctx, 'Next step', 'الخطوة التالية'), from: lead.nextStep || '—', to: nextStep }, { field: 'nextFollowUpDate', label: L(ctx, 'Next follow-up', 'المتابعة القادمة'), from: lead.nextFollowUpDate ?? '—', to: date })
  }
  if (target.requiresLossReason) {
    const reasons = lk.lossReasons.filter((r) => r.active)
    const reason = reasons.find((r) => ctx.und.normalized.includes(r.label.toLowerCase())) ?? reasons[0]
    proposalInput.lossReason = reason?.key ?? ''
    editable.push('lossReason')
    choices.lossReason = reasons.map((r) => ({ value: r.key, label: r.label }))
    changes.push({ field: 'lossReason', label: L(ctx, 'Loss reason', 'سبب الخسارة'), from: '—', to: reason?.label ?? '—' })
  }
  if (target.type !== 'open' && lead.nextFollowUpDate) changes.push({ field: 'nextFollowUpDate', label: L(ctx, 'Next follow-up', 'المتابعة القادمة'), from: lead.nextFollowUpDate, to: '—' })
  return {
    status: 'proposed',
    summary: 'move proposal',
    text: L(ctx, `I’ll move ${lead.company} from ${statusLabelOf(ctx.co, lead.status)} to ${target.label}${target.requiresLossReason ? ' — check the loss reason' : ''}. Confirm to apply.`, `سأنقل ${lead.company} من ${statusLabelOf(ctx.co, lead.status)} إلى ${target.label}. أكّد للتطبيق.`),
    blocks: [],
    focus: { type: 'lead', id: lead.id },
    input,
    proposal: {
      tool: 'move_lead_stage',
      title: L(ctx, `Move ${lead.company} to ${target.label}`, `نقل ${lead.company} إلى ${target.label}`),
      summary: L(ctx, 'Changes the lead’s pipeline stage (the pipeline rules apply).', 'يغير مرحلة العميل (تطبق قواعد المراحل).'),
      record: { type: 'lead', id: lead.id, label: lead.company },
      input: proposalInput,
      editable,
      changes,
      choices,
    },
  }
}

/** create_quotation_draft — lines from the given services or the top suggestions. */
export async function proposeQuotation(ctx: ToolCtx, leadId: string): Promise<ToolOutput> {
  const input: Record<string, unknown> = { lead_id: leadId, service_ids: [] }
  const w = await writableLead(ctx, leadId, input)
  if ('out' in w) return w.out
  if (!can(ctx.user.role, 'sales', 'create')) return salesWriteRefusal(ctx, input)
  const lead = w.lead
  const catalog = await attempt(() => listServices(ctx.user))
  if (!catalog.ok) return refused(ctx, 'forbidden', 'You don’t have access to the services catalog.', 'ليس لديك صلاحية على كتالوج الخدمات.', input)
  const notes = await attempt(() => getLeadNotes(ctx.user, leadId))
  const picked = scoreServices(ctx, lead as unknown as Lead, catalog.value, notes.ok ? notes.value.map((n) => n.body) : []).slice(0, 2).map((s) => s.service)
  if (!picked.length) return { status: 'ok', summary: 'no services', text: L(ctx, `I couldn’t pick services for ${lead.company}. Add services of interest on the lead first.`, `لم أجد خدمات مناسبة لـ ${lead.company}.`), blocks: [], input }
  input.service_ids = picked.map((s) => s.id)
  const currency = picked[0].currency || ctx.currency
  const unit = (s: Service) => (s.pricingType === 'Monthly' ? 'month' : s.pricingType === 'Hourly' ? 'hour' : 'project')
  const qty = (s: Service) => (s.pricingType === 'Monthly' ? 12 : s.pricingType === 'Hourly' ? 10 : 1)
  const items = picked.map((s) => ({ serviceId: s.id, description: s.name, quantity: qty(s), unit: unit(s), unitPrice: s.price, discountPct: 0, currency: s.currency }))
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const title = `${picked[0].name}${picked.length > 1 ? ` + ${picked.length - 1} more` : ''} — ${lead.company}`.slice(0, 160)
  const validUntil = addDaysIso(ctx.day.today, 30)
  return {
    status: 'proposed',
    summary: 'quotation proposal',
    text: L(ctx, `I’ll create a DRAFT quotation for ${lead.company} with ${picked.map((s) => s.name).join(' and ')} (${money(subtotal, currency)} before VAT). It stays a draft — nothing is sent. Confirm to create it.`, `سأنشئ مسودة عرض سعر لـ ${lead.company} (${money(subtotal, currency)} قبل الضريبة). تبقى مسودة ولن تُرسل. أكّد للإنشاء.`),
    blocks: [],
    focus: { type: 'lead', id: lead.id },
    input,
    proposal: {
      tool: 'create_quotation_draft',
      title: L(ctx, `Draft quotation for ${lead.company}`, `مسودة عرض سعر لـ ${lead.company}`),
      summary: L(ctx, 'Creates a draft quotation on the lead (not sent).', 'ينشئ مسودة عرض سعر (لا تُرسل).'),
      record: { type: 'lead', id: lead.id, label: lead.company },
      input: { leadId: lead.id, title, validUntil, items, notes: '', terms: '', currency },
      editable: ['title', 'validUntil'],
      changes: [
        { field: 'quotation', label: L(ctx, 'New quotation', 'عرض سعر جديد'), from: '—', to: `${title} (draft)` },
        ...items.map((i) => ({ field: `line:${i.serviceId}`, label: L(ctx, 'Line', 'بند'), from: '—', to: `${i.description} · ${i.quantity} × ${money(i.unitPrice, i.currency)}` })),
        { field: 'subtotal', label: L(ctx, 'Subtotal (before VAT)', 'المجموع قبل الضريبة'), from: '—', to: money(subtotal, currency) },
        { field: 'validUntil', label: L(ctx, 'Valid until', 'صالح حتى'), from: '—', to: validUntil },
      ],
      choices: {},
    },
  }
}

/** Which tool a write intent / read intent maps to (for settings checks and the transcript). */
export const INTENT_TOOL: Partial<Record<string, AiToolName>> = {
  draft_email: 'draft_email',
  create_quotation: 'create_quotation_draft',
  create_task: 'create_task',
  log_call: 'log_call',
  move_stage: 'move_lead_stage',
  overdue_invoices: 'get_overdue_invoices',
  kpis: 'get_kpis',
  leave: 'get_leave',
  events: 'get_event_registrations',
  quotations: 'get_quotations',
  suggest_services: 'suggest_services',
  follow_ups: 'get_my_follow_ups',
  pipeline: 'get_pipeline_summary',
  search: 'search_records',
}

