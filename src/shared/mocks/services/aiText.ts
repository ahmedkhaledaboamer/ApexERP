import type { AiLanguage } from '@/modules/ai-agent/types'
import type { AiPurpose, AiTone } from './aiNlu'
import { looksLikeInjection } from './aiNlu'

/**
 * Templated, deterministic wording of the mock assistant (English and Arabic). No data access: callers pass the
 * values they already read as the user.
 */

export const tr = (lang: AiLanguage, en: string, ar: string) => (lang === 'ar' ? ar : en)

export function money(n: number, currency: string): string {
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 2026-11-21 → "21 Nov 2026". */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** "today", "tomorrow", "in 3 days", "3 days ago" relative to the company's today. */
export function relDay(iso: string, today: string, lang: AiLanguage): string {
  const diff = Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (diff === 0) return tr(lang, 'today', 'اليوم')
  if (diff === 1) return tr(lang, 'tomorrow', 'بكرة')
  if (diff === -1) return tr(lang, 'yesterday', 'أمس')
  if (diff > 1) return tr(lang, `in ${diff} days`, `بعد ${diff} أيام`)
  return tr(lang, `${-diff} days ago`, `قبل ${-diff} أيام`)
}

export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat
}

export const firstName = (name: string) => name.replace(/^(Dr\.|Dr|Chef|Mr\.?|Ms\.?|Mrs\.?|Eng\.?)\s+/i, '').split(' ')[0] || name

/* ---------------- note summaries ---------------- */

const THEMES: { key: string; en: string; ar: string; re: RegExp }[] = [
  { key: 'contact', en: 'How to reach them', ar: 'طريقة التواصل', re: /prefer|best reached|whatsapp|call after|after asr|email|reach|phone/i },
  { key: 'decision', en: 'Decision & budget', ar: 'القرار والميزانية', re: /budget|sign-?off|director|decision|approv|procurement|tender|portal|cfo|owner/i },
  { key: 'competition', en: 'Competition & price', ar: 'المنافسة والسعر', re: /competitor|price|quote|cheaper|discount|provider|reliab/i },
  { key: 'needs', en: 'Needs', ar: 'الاحتياجات', re: /spreadsheet|manual|automat|track|need|want|looking|interest|arabic|ship|consolidat|integrat|report/i },
]

export interface NoteSummary {
  bullets: string[]
  /** A note reads like an instruction to an assistant (treated as data, never acted on). */
  suspicious: boolean
}

/**
 * Groups note sentences by theme (contact preference, decision & budget, competition, needs) and keeps the first
 * sentences of each theme. Note text is DATA: it is quoted, never interpreted as an instruction.
 */
export function summarizeNotes(notes: { body: string }[], lang: AiLanguage): NoteSummary {
  const suspicious = notes.some((n) => looksLikeInjection(n.body))
  const sentences = [...new Set(notes.filter((n) => !looksLikeInjection(n.body)).flatMap((n) => n.body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 3)))]
  const used = new Set<string>()
  const bullets: string[] = []
  for (const theme of THEMES) {
    const hits = sentences.filter((s) => !used.has(s) && theme.re.test(s)).slice(0, 2)
    if (!hits.length) continue
    hits.forEach((s) => used.add(s))
    bullets.push(`${tr(lang, theme.en, theme.ar)}: ${excerpt(hits.join(' '), 180)}`)
  }
  const rest = sentences.filter((s) => !used.has(s)).slice(0, Math.max(0, 3 - bullets.length))
  for (const s of rest) bullets.push(excerpt(s, 180))
  return { bullets, suspicious }
}

/* ---------------- email drafts ---------------- */

export interface DraftFacts {
  contactName: string
  company: string
  senderName: string
  senderCompany: string
  /** Names of catalog services of interest (may be empty). */
  services: string[]
  nextStep: string
  lastTouch: string | null
}

/** Subject + body of a draft email, by purpose, tone and language. Placeholders are already filled. */
export function draftEmail(f: DraftFacts, purpose: AiPurpose, tone: AiTone, lang: AiLanguage): { subject: string; body: string } {
  const first = firstName(f.contactName)
  const svc = f.services.slice(0, 2).join(lang === 'ar' ? ' و' : ' and ')
  if (lang === 'ar') {
    const hello = tone === 'formal' ? `السيد/ة ${f.contactName} المحترم/ة،` : `مرحباً ${first}،`
    const bye = tone === 'formal' ? `مع خالص التحية،\n${f.senderName}\n${f.senderCompany}` : `تحياتي،\n${f.senderName}\n${f.senderCompany}`
    const subjects: Record<AiPurpose, string> = {
      follow_up: `متابعة: ${f.company}`,
      introduction: `تعريف بـ ${f.senderCompany}`,
      proposal: `عرضنا لـ ${f.company}`,
      thank_you: 'شكراً على وقتك',
      meeting: `موعد اجتماع مع ${f.company}`,
    }
    const lines: Record<AiPurpose, string> = {
      follow_up: `أتواصل معك لمتابعة حديثنا الأخير${svc ? ` بخصوص ${svc}` : ''}. ${f.nextStep ? `الخطوة التالية كما اتفقنا: ${f.nextStep}.` : 'هل لديك أي أسئلة يمكنني مساعدتك فيها؟'}`,
      introduction: `يسعدني التعريف بـ ${f.senderCompany}. نساعد شركات مثل ${f.company}${svc ? ` في ${svc}` : ''} لتوفير الوقت وتحسين خدمة العملاء.`,
      proposal: `أرفقت لك ملخص عرضنا${svc ? ` لـ ${svc}` : ''}. يسعدني أن أشرح التفاصيل وأجيب على أي استفسار.`,
      thank_you: `شكراً جزيلاً على وقتك${svc ? ` ونقاشنا حول ${svc}` : ''}. سأرسل لك الخطوات التالية قريباً.`,
      meeting: `هل يناسبك اجتماع قصير هذا الأسبوع لمناقشة${svc ? ` ${svc}` : ' احتياجاتكم'}؟ أخبرني بالوقت المناسب لك.`,
    }
    const body = tone === 'short' ? `${hello}\n\n${lines[purpose]}\n\n${bye}` : `${hello}\n\n${lines[purpose]}\n\nأتطلع لسماع ردك.\n\n${bye}`
    return { subject: subjects[purpose], body }
  }
  const hello = tone === 'formal' ? `Dear ${f.contactName},` : `Hi ${first},`
  const bye = tone === 'formal' ? `Kind regards,\n${f.senderName}\n${f.senderCompany}` : `Best,\n${f.senderName}\n${f.senderCompany}`
  const subjects: Record<AiPurpose, string> = {
    follow_up: `Following up — ${f.company}`,
    introduction: `${f.senderCompany} × ${f.company}`,
    proposal: `Our proposal for ${f.company}`,
    thank_you: 'Thank you for your time',
    meeting: `Quick meeting about ${svc || 'next steps'}?`,
  }
  const lines: Record<AiPurpose, string> = {
    follow_up: `I wanted to follow up on our last conversation${svc ? ` about ${svc}` : ''}. ${f.nextStep ? `As agreed, the next step is: ${f.nextStep.charAt(0).toLowerCase()}${f.nextStep.slice(1)}.` : 'Is there anything I can help clarify on your side?'}`,
    introduction: `I’m reaching out from ${f.senderCompany}. We help companies like ${f.company}${svc ? ` with ${svc}` : ''}, saving their teams time and improving customer response.`,
    proposal: `Please find a summary of our proposal${svc ? ` for ${svc}` : ''}. I’d be glad to walk you through it and answer any questions.`,
    thank_you: `Thank you for your time${svc ? ` and the conversation about ${svc}` : ''}. I’ll send over the next steps shortly.`,
    meeting: `Would a short call this week work to go through ${svc || 'your requirements'}? Let me know a time that suits you.`,
  }
  const body =
    tone === 'short'
      ? `${hello}\n\n${lines[purpose]}\n\n${bye}`
      : `${hello}\n\n${lines[purpose]}${tone === 'friendly' ? ' Happy to adapt to whatever works best for your team.' : ''}\n\nLooking forward to hearing from you.\n\n${bye}`
  return { subject: subjects[purpose], body }
}
