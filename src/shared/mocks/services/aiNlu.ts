import type { AiLanguage } from '@/modules/ai-agent/types'

/**
 * The mock assistant's "understanding": deterministic intent detection (keywords / regexes) and entity extraction
 * (record ids, periods, dates, tone, language, stage, quoted text) for English and simple Gulf / Egyptian Arabic.
 * Pure: no data access. Names are resolved later against the records the USER can see (services/ai.ts), so nothing
 * here can reach another company or another user's records. A real backend replaces this with Claude (tool use).
 */

export type AiIntent =
  | 'draft_email'
  | 'create_quotation'
  | 'create_task'
  | 'log_call'
  | 'move_stage'
  | 'sensitive'
  | 'own_pay'
  | 'overdue_invoices'
  | 'kpis'
  | 'leave'
  | 'events'
  | 'quotations'
  | 'suggest_services'
  | 'summary'
  | 'follow_ups'
  | 'pipeline'
  | 'search'
  | 'help'
  | 'unknown'

export type AiPeriod = 'today' | 'tomorrow' | 'overdue' | 'this_week' | 'next_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year'
export type AiTone = 'friendly' | 'formal' | 'short'
export type AiPurpose = 'follow_up' | 'introduction' | 'proposal' | 'thank_you' | 'meeting'

/** A due date as said: an absolute date, or days from the company's today. */
export type AiDueSpec = { kind: 'date'; date: string } | { kind: 'days'; days: number } | { kind: 'weekday'; weekday: number }

export interface AiEntities {
  leadIds: string[]
  customerIds: string[]
  invoiceRefs: string[]
  quotationRefs: string[]
  taskIds: string[]
  eventIds: string[]
  period: AiPeriod | null
  due: AiDueSpec | null
  tone: AiTone | null
  /** Asked for a language explicitly ("in Arabic", "بالعربي"). */
  language: AiLanguage | null
  purpose: AiPurpose | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  /** The stage named after "to" / "إلى" in a move request (resolved against the company's statuses later). */
  stageText: string | null
  /** Text inside quotes, or after "saying" / "that": a task title or call summary. */
  quoted: string | null
  /** Asked about the team ("team", "everyone", "الفريق"). */
  team: boolean
  /** "me", "my", "عندي", "لي". */
  self: boolean
}

export interface AiUnderstanding {
  language: AiLanguage
  intent: AiIntent
  entities: AiEntities
  /** The normalized text (lowercase, Arabic letters unified, Arabic digits → Latin). */
  normalized: string
}

const AR_LETTERS = /[؀-ۿ]/

/** Lowercase; Arabic-Indic digits → 0-9; alef / ya / ta marbuta unified; tatweel and diacritics dropped. */
export function normalize(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Arabic when most letters are Arabic. */
export function detectLanguage(text: string): AiLanguage {
  const letters = text.match(/\p{L}/gu) ?? []
  if (!letters.length) return 'en'
  const ar = letters.filter((c) => AR_LETTERS.test(c)).length
  return ar / letters.length >= 0.4 ? 'ar' : 'en'
}

/** Patterns are written plainly and normalized once, so Arabic spelling variants match. */
const P = (...parts: string[]) => parts.map(normalize)
const has = (t: string, words: readonly string[]) => words.some((w) => (w.startsWith('/') ? new RegExp(w.slice(1, -1)).test(t) : t.includes(w)))

const W = {
  draft: P('draft', 'write an email', 'write a email', 'write email', 'compose', 'email to', 'an email', 'e-mail', 'write to', 'اكتب ايميل', 'اكتب إيميل', 'ايميل', 'إيميل', 'بريد', 'اكتب رساله', 'اكتب لي رساله', 'صيغ رساله', 'مسوده'),
  quotationCreate: P('create a quotation', 'create quotation', 'draft a quotation', 'draft quotation', 'make a quotation', 'prepare a quotation', 'create a quote', 'draft a quote', 'new quotation', 'quotation from', 'quote from', 'اعمل عرض سعر', 'سوي عرض سعر', 'جهز عرض سعر', 'انشئ عرض سعر', 'عرض سعر جديد'),
  task: P('create a task', 'create task', 'add a task', 'add task', 'new task', 'remind me', 'reminder', 'set a follow-up', 'schedule a follow-up', 'schedule a follow up', 'follow-up task', 'follow up task', 'ذكرني', 'فكرني', 'اضف مهمه', 'أضف مهمة', 'انشئ مهمه', 'مهمه جديده', 'سوي مهمه', 'اعمل مهمه'),
  logCall: P('log a call', 'log call', 'log the call', 'i called', 'i just called', 'call note', 'note the call', 'record a call', 'سجل مكالمه', 'سجل اتصال', 'كلمته', 'اتصلت'),
  move: P('/\\bmove\\b/', '/\\bmark\\b.*\\bas\\b/','change stage', 'change status', 'change the stage', 'set stage', 'set status', 'set the stage', 'انقل', 'غير الحاله', 'غير المرحله'),
  sensitiveOther: P("'s salary", 'salary of', 'salaries', 'pay of', 'iban', 'bank account of', 'passport', 'emirates id', 'national id', 'iqama', 'document number', 'راتب', 'رواتب', 'ايبان', 'جواز', 'هويه', 'اقامه'),
  ownPay: P('my salary', 'my payslip', 'my pay slip', 'my pay', 'راتبي', 'كشف راتبي', 'قسيمه راتبي'),
  invoices: P('overdue invoice', 'invoices overdue', 'invoices are overdue', 'unpaid invoice', 'outstanding invoice', 'receivable', 'aging', 'ageing', 'who owes', 'owes us', 'late payment', 'invoice', 'فواتير', 'فاتوره', 'الفواتير', 'مستحقات', 'ذمم', 'متاخرات'),
  kpis: P('revenue', 'income this', 'cash position', 'cash balance', 'how much cash', 'profit', 'turnover', 'kpi', 'vat', 'ايرادات', 'الايرادات', 'الدخل', 'المبيعات هذا الشهر', 'ارباح', 'الارباح', 'السيوله', 'الكاش'),
  leave: P('on leave', 'leave balance', 'my leave', 'annual leave', 'vacation', 'holiday balance', 'days off', 'day off', 'sick leave', 'time off', 'off next week', 'off this week', 'attendance', 'اجازه', 'اجازات', 'إجازة', 'رصيد الاجازات', 'غياب', 'الحضور', 'مين في اجازه', 'منو في اجازه', 'مين واخد اجازه'),
  events: P('event', 'registration', 'registrations', 'attendee', 'webinar', 'conference', 'exhibition', 'فعاليه', 'فعاليات', 'الفعاليه', 'التسجيلات', 'المسجلين', 'الحضور في', 'معرض', 'مؤتمر'),
  quotations: P('quotation', 'quote', 'proposal status', 'contract', 'renewal', 'renewing', 'عرض سعر', 'عروض الاسعار', 'العرض', 'عقد', 'العقود', 'تجديد'),
  suggest: P('suggest', 'recommend', 'which service', 'what service', 'what to offer', 'what can we offer', 'what should we offer', 'upsell', 'cross-sell', 'package', 'اقترح', 'ترشح', 'خدمات تناسب', 'ايش نعرض', 'وش نعرض', 'نعرض عليه', 'باقه', 'الخدمات المناسبه'),
  summary: P('summarize', 'summarise', 'summary', 'tell me about', 'what do we know', 'status of', 'details of', 'brief me', 'overview of', 'what happened with', 'update on', 'لخص', 'ملخص', 'لخصلي', 'تفاصيل', 'وش صار مع', 'ايش صار مع', 'ايه الاخبار مع', 'معلومات عن', 'حاله'),
  followUps: P('follow up', 'follow-up', 'followup', 'follow ups', 'to do today', 'todo', 'my tasks', 'tasks today', 'due today', 'what should i do', 'what do i have', 'my day', 'overdue task', 'what’s due', "what's due", 'agenda', 'plan my day', 'متابع', 'المتابعات', 'مهامي', 'مهام اليوم', 'وش عندي', 'ايش عندي', 'عندي ايه', 'اعمل ايه النهارده', 'شو عندي'),
  pipeline: P('pipeline', 'how is the team', "how's the team", 'how are we doing', 'team doing', 'team performance', 'performance', 'how am i doing', 'my numbers', 'win rate', 'won this', 'deals', 'forecast', 'sales this', 'leaderboard', 'الفريق', 'اداء', 'الاداء', 'المبيعات', 'الصفقات', 'كيف ماشي', 'ازاي ماشيين', 'وضعنا'),
  search: P('find', 'search', 'look up', 'lookup', 'show me', 'where is', 'which lead', 'list', 'ابحث', 'دور', 'دورلي', 'وريني', 'اعرض', 'فين'),
  help: P('help', 'what can you do', 'hello', 'hi ', 'hey', 'good morning', 'مرحبا', 'السلام', 'هلا', 'اهلا', 'ساعدني', 'ايش تقدر', 'وش تقدر'),
  team: P('team', 'everyone', 'my reps', 'my agents', 'the reps', 'الفريق', 'فريقي', 'الكل', 'الموظفين'),
  self: P(' me', 'my ', 'mine', ' i ', "i'm", 'عندي', 'لي', 'مهامي', 'اجازتي', 'رصيدي'),
} as const

/** The intent of a message. Write intents win over read ones ("draft a follow-up email" is a draft, not a follow-up list). */
export function detectIntent(raw: string): AiIntent {
  const t = ` ${normalize(raw)} `
  const ids = /\bl-\d{3,}\b|\bc-\d{3,}\b/.test(t)
  if (has(t, W.quotationCreate)) return 'create_quotation'
  if (has(t, W.logCall)) return 'log_call'
  if (has(t, W.draft) && !/\b(invoice|statement)s?\b/.test(t)) return 'draft_email'
  if (has(t, W.task)) return 'create_task'
  if (has(t, W.move) && / (to|as|into|الي|لـ?) /.test(t)) return 'move_stage'
  if (has(t, W.ownPay)) return 'own_pay'
  if (has(t, W.sensitiveOther)) return 'sensitive'
  if (has(t, W.leave)) return 'leave'
  if (has(t, W.invoices)) return 'overdue_invoices'
  if (has(t, W.kpis)) return 'kpis'
  if (has(t, W.events) && !ids) return 'events'
  if (has(t, W.suggest)) return 'suggest_services'
  if (has(t, W.quotations)) return 'quotations'
  if (has(t, W.summary) || (ids && t.trim().split(' ').length <= 3)) return 'summary'
  if (has(t, W.followUps)) return 'follow_ups'
  if (has(t, W.pipeline)) return 'pipeline'
  if (has(t, W.search)) return 'search'
  if (has(t, W.help)) return 'help'
  return 'unknown'
}

const uniq = (xs: string[]) => [...new Set(xs)]
const allMatches = (t: string, re: RegExp) => uniq([...t.matchAll(re)].map((m) => m[0].toUpperCase()))

const PERIODS: [AiPeriod, readonly string[]][] = [
  ['next_week', P('next week', 'coming week', 'الاسبوع الجاي', 'الاسبوع القادم', 'الاسبوع اللي جاي', 'الاسبوع المقبل')],
  ['this_week', P('this week', 'هذا الاسبوع', 'هالاسبوع', 'الاسبوع ده', 'الاسبوع هذا')],
  ['last_month', P('last month', 'previous month', 'الشهر الماضي', 'الشهر اللي فات', 'الشهر السابق')],
  ['this_month', P('this month', 'month to date', 'هذا الشهر', 'هالشهر', 'الشهر ده', 'الشهر الحالي')],
  ['this_quarter', P('this quarter', 'هذا الربع')],
  ['this_year', P('this year', 'year to date', 'ytd', 'هذه السنه', 'هالسنه', 'السنه دي')],
  ['overdue', P('overdue', 'late', 'past due', 'متاخر', 'فات موعد')],
  ['tomorrow', P('tomorrow', 'بكره', 'بكرا', 'غدا', 'باكر')],
  ['today', P('today', 'tonight', 'اليوم', 'النهارده', 'النهارد')],
]

const WEEKDAYS: [number, readonly string[]][] = [
  [0, P('sunday', 'الاحد')],
  [1, P('monday', 'الاثنين', 'الاتنين')],
  [2, P('tuesday', 'الثلاثاء', 'التلات')],
  [3, P('wednesday', 'الاربعاء', 'الاربع')],
  [4, P('thursday', 'الخميس')],
  [5, P('friday', 'الجمعه')],
  [6, P('saturday', 'السبت')],
]

function dueOf(t: string): AiDueSpec | null {
  const iso = t.match(/\b(20\d\d-\d\d-\d\d)\b/)
  if (iso) return { kind: 'date', date: iso[1] }
  const inDays = t.match(/\bin (\d{1,3}) days?\b/) ?? t.match(/بعد (\d{1,3}) (?:ايام|يوم)/)
  if (inDays) return { kind: 'days', days: Number(inDays[1]) }
  if (has(t, P('day after tomorrow', 'بعد بكره', 'بعد بكرا'))) return { kind: 'days', days: 2 }
  if (has(t, P('tomorrow', 'بكره', 'بكرا', 'غدا', 'باكر'))) return { kind: 'days', days: 1 }
  if (has(t, P('today', 'اليوم', 'النهارده'))) return { kind: 'days', days: 0 }
  if (has(t, P('next week', 'الاسبوع الجاي', 'الاسبوع القادم'))) return { kind: 'days', days: 7 }
  for (const [day, words] of WEEKDAYS) if (has(t, words)) return { kind: 'weekday', weekday: day }
  return null
}

/** The text after "to" in a move request: "move L-1016 to Meeting" → "meeting"; Arabic "إلى" / "لـ". */
function stageTextOf(t: string): string | null {
  const m = t.match(/\b(?:to|as|into)\s+(?:the\s+)?(?:stage\s+|status\s+)?["“]?([a-z][a-z \-]{1,30}?)["”]?(?:\s+(?:stage|status|with|and|because|since|next|by|on|tomorrow)\b|[.,!?]|$)/)
  if (m) return m[1].trim()
  const ar = t.match(/(?:الي|لـ|لمرحله|لحاله)\s*([؀-ۿa-z ]{2,25})$/)
  return ar ? ar[1].trim() : null
}

function quotedOf(raw: string): string | null {
  const q = raw.match(/["“«]([^"”»]{2,300})["”»]/)
  if (q) return q[1].trim()
  const said = raw.match(/\b(?:saying|that says|about|titled|called|summary:|note:)\s+(.{3,300})$/i)
  if (said) return said[1].trim().replace(/[.]+$/, '')
  const colon = raw.match(/:\s*(.{3,300})$/)
  return colon ? colon[1].trim() : null
}

export function extractEntities(raw: string): AiEntities {
  const t = ` ${normalize(raw)} `
  const period = PERIODS.find(([, words]) => has(t, words))?.[0] ?? null
  const tone: AiTone | null = has(t, P('formal', 'professional', 'رسمي', 'رسميه'))
    ? 'formal'
    : has(t, P('short', 'brief', 'quick', 'concise', 'قصير', 'مختصر'))
      ? 'short'
      : has(t, P('friendly', 'warm', 'casual', 'ودي', 'لطيف'))
        ? 'friendly'
        : null
  const language: AiLanguage | null = has(t, P('in arabic', 'arabic version', 'بالعربي', 'بالعربيه', 'باللغه العربيه', 'عربي'))
    ? 'ar'
    : has(t, P('in english', 'بالانجليزي', 'بالانجليزيه', 'انجليزي'))
      ? 'en'
      : null
  const purpose: AiPurpose | null = has(t, P('thank', 'شكر'))
    ? 'thank_you'
    : has(t, P('introduc', 'first email', 'تعريف', 'تعريفي'))
      ? 'introduction'
      : has(t, P('proposal', 'quotation', 'quote', 'عرض'))
        ? 'proposal'
        : has(t, P('meeting', 'demo', 'call', 'اجتماع', 'موعد', 'ديمو'))
          ? 'meeting'
          : has(t, P('follow', 'check in', 'check-in', 'متابعه', 'تابع'))
            ? 'follow_up'
            : null
  const priority = has(t, P('urgent', 'asap', 'عاجل', 'ضروري')) ? 'urgent' : has(t, P('high priority', 'important', 'مهم')) ? 'high' : has(t, P('low priority')) ? 'low' : null
  return {
    leadIds: allMatches(t, /\bl-\d{3,}\b/g),
    customerIds: allMatches(t, /\bc-\d{3,}\b/g),
    invoiceRefs: allMatches(t, /\b(?:[a-z]{2,5}-)?inv-[\w-]*\d\b/g),
    quotationRefs: allMatches(t, /\bq(?:t|uo)?-[\w-]*\d\b/g),
    taskIds: allMatches(t, /\btsk?-[\w-]*\d\b/g),
    eventIds: allMatches(t, /\bev-\d+\b/g),
    period,
    due: dueOf(t),
    tone,
    language,
    purpose,
    priority,
    stageText: stageTextOf(t.trim()),
    quoted: quotedOf(raw),
    team: has(t, W.team),
    self: has(t, W.self),
  }
}

export function understand(raw: string): AiUnderstanding {
  return { language: detectLanguage(raw), intent: detectIntent(raw), entities: extractEntities(raw), normalized: normalize(raw) }
}

/**
 * Text in a RECORD (lead notes, activity summaries, email bodies) that reads like an instruction to the assistant.
 * The engine never acts on record content; this only adds a caution line so the user sees it was ignored.
 */
export function looksLikeInjection(text: string): boolean {
  const t = normalize(text)
  return /ignore (all |the )?(previous|prior|above) (instructions|prompts?)|disregard (the |all )?(previous|above)|you are now|system prompt|act as (an? )?(admin|assistant)|assistant[:,] (please )?(send|delete|move|email|transfer)|تجاهل (كل )?التعليمات/.test(t)
}

/** Significant words of a company / person name (for name matching): no "al", "the", legal suffixes. */
const NAME_STOP = new Set(['al', 'el', 'the', 'and', 'of', 'llc', 'fze', 'fzco', 'co', 'group', 'trading', 'services', 'company', 'dr', 'dr.', 'mr', 'ms', 'chef', 'partners', 'centre', 'center', 'est'])
export function nameTokens(name: string): string[] {
  return normalize(name)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !NAME_STOP.has(w))
}

/**
 * How strongly a message names a record: 100 = the full name, 60 + = all significant words, 35 = one distinctive word
 * (≥ 5 letters). 0 = not named. Used on records the user can already see.
 */
export function nameScore(message: string, name: string): number {
  const t = ` ${normalize(message).replace(/[^\p{L}\p{N} ]/gu, ' ')} `
  const full = normalize(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim()
  if (full.length >= 4 && t.includes(` ${full} `)) return 100
  const words = nameTokens(name)
  if (!words.length) return 0
  const hits = words.filter((w) => t.includes(` ${w} `) || t.includes(` ${w}'s `) || t.includes(` ${w}s `))
  if (hits.length === words.length) return 60 + Math.min(30, words.length * 10)
  const strong = hits.filter((w) => w.length >= 5)
  return strong.length ? 35 + strong.length * 5 : 0
}
