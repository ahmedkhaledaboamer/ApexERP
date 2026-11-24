import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Segmented } from '@/shared/components/ui/Segmented'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { PrintStyles } from '@/shared/components/layout/PrintStyles'
import { errorMessage, useHrScope } from '@/modules/hr/time/components/shared'
import { LetterSheet } from '@/modules/hr/selfservice/components/LetterSheet'
import { DIGIT_STYLE_LABEL, LETTER_LANGUAGES, LETTER_LANGUAGE_LABEL, type DigitStyle, type LetterLanguage } from '@/modules/hr/selfservice/types'
import { useWarningLetter } from '../api'
import { DISCIPLINE_PATH } from '../components/bits'

/**
 * `/hr/discipline/:id/letter?language=en|ar|bilingual&digits=`: the warning letter generated from a disciplinary record,
 * printable on A4 (English, Arabic RTL, or bilingual side by side). HR full or the employee (the API answers 404 to
 * anyone else). Missing Arabic values (name / job title in Arabic) are listed instead of a letter.
 */
export default function WarningLetterPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { full } = useHrScope()
  const language = (LETTER_LANGUAGES.includes(params.get('language') as LetterLanguage) ? params.get('language') : 'en') as LetterLanguage
  const digits: DigitStyle = params.get('digits') === 'arabic' ? 'arabic' : 'western'
  const q = useWarningLetter(id, language, digits)
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        p.set(k, v)
        return p
      },
      { replace: true },
    )
  const l = q.data
  return (
    <PageBody className="max-w-5xl">
      <PrintStyles orientation="portrait" margin="18mm" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={full ? `${DISCIPLINE_PATH}?record=${encodeURIComponent(id)}` : '/hr/me'} className="inline-flex items-center gap-1 text-[0.8125rem] text-muted hover:text-ink">
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
          {full ? 'Discipline' : 'My HR'}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Letter language" size="sm" value={language} onChange={(v) => set('language', v)} options={LETTER_LANGUAGES.map((x) => ({ value: x, label: LETTER_LANGUAGE_LABEL[x].replace(' (English + Arabic)', '') }))} />
          {language !== 'en' && <Segmented label="Digits" size="sm" value={digits} onChange={(v) => set('digits', v)} options={(['western', 'arabic'] as const).map((x) => ({ value: x, label: DIGIT_STYLE_LABEL[x] }))} />}
          <Button variant="secondary" onClick={() => window.print()} disabled={!l}>
            <Printer />
            Print
          </Button>
        </div>
      </div>
      {q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !l ? (
        <Skeleton className="h-[40rem]" />
      ) : (
        <LetterSheet
          label={`${l.title} ${l.caseNo}`}
          letterhead={l.letterhead}
          language={l.language}
          layout={l.language === 'bilingual' ? 'side_by_side' : null}
          title={l.title}
          titleAr={l.titleAr}
          body={l.body}
          bodyAr={l.bodyAr}
          referenceNo={l.caseNo}
          issueDate={l.issueDate}
          issueDateAr={l.issueDateAr}
          signatoryName={l.signatoryName}
          signatoryTitle={l.signatoryTitle}
        />
      )}
    </PageBody>
  )
}
