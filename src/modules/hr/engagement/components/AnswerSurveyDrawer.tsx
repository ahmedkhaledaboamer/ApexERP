import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { Drawer } from '@/shared/components/ui/Drawer'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { useToast } from '@/shared/components/ui/Toast'
import { TextArea } from '@/shared/components/form/Field'
import { ErrorText, FormError } from '@/modules/hr/components/talentBits'
import { fmtDate } from '@/shared/lib/utils'
import { engagementApi, useEngWrite, useMySurvey } from '../api'
import type { Answer, Language, MySurveyForm, SurveyQuestion } from '../types'

const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']
const LIKERT_AR = ['أعارض بشدة', 'أعارض', 'محايد', 'أوافق', 'أوافق بشدة']

/** The caller answers a survey sent to them (or edits their answers until it closes). English or Arabic. */
export function AnswerSurveyDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useMySurvey(id)
  return (
    <Drawer open={!!id} onClose={onClose} width="lg" title={q.data?.name ?? 'Survey'} description={q.data ? `Closes ${fmtDate(q.data.closesOn)}` : undefined}>
      {q.error ? <ErrorText error={q.error} /> : !q.data ? <Skeleton className="h-60" /> : <AnswerForm key={q.data.surveyId} f={q.data} onDone={onClose} />}
    </Drawer>
  )
}

const blank = (q: SurveyQuestion): Answer => ({ questionId: q.id, value: null, choiceIds: [], text: '' })

function AnswerForm({ f, onDone }: { f: MySurveyForm; onDone: () => void }) {
  const toast = useToast()
  const [lang, setLang] = useState<Language>(f.language)
  const [answers, setAnswers] = useState<Answer[]>(() => f.questions.map((q) => f.answers?.find((a) => a.questionId === q.id) ?? blank(q)))
  useEffect(() => setLang(f.language), [f.language])
  const save = useEngWrite(() => engagementApi.answer(f.surveyId, { answers, language: lang }))
  const hasAr = f.questions.some((q) => q.textAr)
  const set = (id: string, patch: Partial<Answer>) => setAnswers((all) => all.map((a) => (a.questionId === id ? { ...a, ...patch } : a)))
  const ar = lang === 'ar'
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(undefined, {
          onSuccess: () => {
            toast.success('Thank you', f.anonymous ? 'Your answers were saved anonymously.' : 'Your answers were saved.')
            onDone()
          },
        })
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {f.anonymous && <Lock className="size-3.5" aria-hidden />}
          {f.anonymous ? 'Anonymous: your name is never stored with your answers, and results are only shown for groups of 5 or more.' : 'Confidential: your answers are seen by HR only.'}
          {f.editable && f.answers ? ' You can change your answers until the survey closes.' : ''}
        </p>
        {hasAr && (
          <div className="flex gap-1" role="group" aria-label="Language">
            <Button type="button" size="xs" variant={ar ? 'secondary' : 'primary'} onClick={() => setLang('en')} aria-pressed={!ar}>
              English
            </Button>
            <Button type="button" size="xs" variant={ar ? 'primary' : 'secondary'} onClick={() => setLang('ar')} aria-pressed={ar}>
              العربية
            </Button>
          </div>
        )}
      </div>
      {f.questions.map((q, i) => {
        const a = answers.find((x) => x.questionId === q.id) ?? blank(q)
        const text = ar && q.textAr ? q.textAr : q.text
        const dir = ar && q.textAr ? 'rtl' : undefined
        const disabled = !f.editable
        return (
          <fieldset key={q.id} className="space-y-2" dir={dir} disabled={disabled}>
            <legend className="text-[0.8125rem] font-medium text-ink">
              {i + 1}. {text}
              {q.required && <span className="text-danger-600"> *</span>}
            </legend>
            {(q.type === 'nps' || q.type === 'likert') && (
              <div role="radiogroup" aria-label={q.text} className="flex flex-wrap gap-1">
                {(q.type === 'nps' ? [...Array(11).keys()] : [1, 2, 3, 4, 5]).map((v) => {
                  const on = a.value === v
                  const label = q.type === 'likert' ? (ar ? LIKERT_AR[v - 1] : LIKERT[v - 1]) : String(v)
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={q.type === 'nps' ? String(v) : label}
                      disabled={disabled}
                      onClick={() => set(q.id, { value: v })}
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-surface text-ink-2 hover:bg-sunken'}`}
                    >
                      {label}
                    </button>
                  )
                })}
                {q.type === 'nps' && <p className="w-full text-xs text-muted">{ar ? '0 = غير محتمل إطلاقًا · 10 = محتمل جدًا' : '0 = not at all likely · 10 = extremely likely'}</p>}
              </div>
            )}
            {(q.type === 'single' || q.type === 'multi') && (
              <div className="space-y-1" role={q.type === 'single' ? 'radiogroup' : 'group'} aria-label={q.text}>
                {q.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                    <input
                      type={q.type === 'single' ? 'radio' : 'checkbox'}
                      name={q.id}
                      checked={a.choiceIds.includes(o.id)}
                      onChange={(e) => set(q.id, { choiceIds: q.type === 'single' ? [o.id] : e.target.checked ? [...a.choiceIds, o.id] : a.choiceIds.filter((x) => x !== o.id) })}
                      className="accent-brand-600"
                    />
                    {ar && o.textAr ? o.textAr : o.text}
                  </label>
                ))}
              </div>
            )}
            {q.type === 'text' && <TextArea aria-label={q.text} rows={3} maxLength={2000} value={a.text} onChange={(e) => set(q.id, { text: e.target.value })} />}
          </fieldset>
        )
      })}
      <FormError error={save.error} />
      {f.editable ? (
        <div className="flex justify-end">
          <Button type="submit" write loading={save.isPending}>
            {f.answers ? 'Update my answers' : 'Submit answers'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted">This survey is closed.</p>
      )}
    </form>
  )
}
