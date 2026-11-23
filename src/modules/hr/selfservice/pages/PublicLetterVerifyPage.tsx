import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { Button } from '@/shared/components/ui/Button'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, TextInput } from '@/shared/components/form/Field'
import { letterDate, normalizeCode } from '../letters'
import { selfServiceApi } from '../api'

/**
 * `/verify/letter` (public, no sign-in, outside the app shell): anyone holding an HR letter checks it — by typing the
 * verification code or opening the QR code's link (`?code=`). The company is the workspace the page is opened on
 * (subdomain; `?workspace=` in development), so a code only resolves in its own company. Shows only the company name /
 * logo, the letter type, reference, issue date, a masked employee name and valid / revoked — never pay or personal data.
 */
export default function PublicLetterVerifyPage() {
  const [params, setParams] = useSearchParams()
  const code = params.get('code') ?? ''
  const workspace = params.get('workspace')
  const [typed, setTyped] = useState(code)
  const normalized = normalizeCode(code)
  const q = useQuery({
    queryKey: ['public-letter-verify', code, workspace ?? ''],
    queryFn: () => selfServiceApi.publicVerify(code, workspace),
    enabled: !!normalized,
    retry: false,
  })
  const v = q.data
  const submit = () => {
    setParams(
      (p) => {
        p.set('code', typed.trim())
        return p
      },
      { replace: true },
    )
  }
  return (
    <main className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-md space-y-4">
        <header className="text-center">
          <ShieldCheck className="mx-auto size-8 text-accent-600" aria-hidden />
          <h1 className="mt-2 text-lg font-semibold text-ink">Verify an HR letter</h1>
          <p className="text-[0.8125rem] text-muted">Enter the verification code printed at the bottom of the letter, or scan its QR code.</p>
        </header>
        <form
          className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-4 shadow-xs"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex-1">
            <Field id="verify-code" label="Verification code">
              <TextInput id="verify-code" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="ABCD-EFGH-JKMN" autoComplete="off" />
            </Field>
          </div>
          <Button type="submit" disabled={!typed.trim()}>
            Check
          </Button>
        </form>

        {code && !normalized && (
          <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[0.8125rem] text-danger-700 dark:text-danger-400">
            That doesn’t look like a verification code: it has 12 letters and digits, e.g. ABCD-EFGH-JKMN.
          </p>
        )}
        {normalized && (
          <section aria-label="Verification result" className="rounded-2xl border border-line bg-surface p-6 shadow-xs">
            {q.isPending ? (
              <Skeleton className="h-40" />
            ) : q.error || !v ? (
              <div className="space-y-2 text-center" role="status" data-testid="verify-status" data-status="not_found">
                <ShieldAlert className="mx-auto size-10 text-warning-600" aria-hidden />
                <h2 className="text-lg font-semibold text-ink">Letter not found</h2>
                <p className="text-[0.8125rem] text-muted">{q.error?.message ?? 'No letter with this code was issued here.'}</p>
              </div>
            ) : (
              <div className="space-y-4" role="status" data-testid="verify-status" data-status={v.status}>
                <div className="flex items-center gap-3">
                  {v.logoUrl ? (
                    <img src={v.logoUrl} alt="" className="h-10 w-auto max-w-32 object-contain" />
                  ) : (
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-600 text-sm font-semibold text-white">{v.monogram}</span>
                  )}
                  <p className="font-semibold text-ink">{v.companyName}</p>
                </div>
                {v.status === 'valid' ? (
                  <p className="flex items-center gap-2 rounded-lg bg-success-50 px-3 py-2 font-semibold text-success-800 dark:bg-success-950 dark:text-success-200">
                    <BadgeCheck className="size-5" aria-hidden /> Valid letter
                  </p>
                ) : (
                  <p className="flex items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 font-semibold text-danger-800 dark:bg-danger-950 dark:text-danger-200">
                    <ShieldX className="size-5" aria-hidden /> Revoked{v.revokedAt ? ` on ${letterDate(v.revokedAt.slice(0, 10))}` : ''}: this letter is no longer valid
                  </p>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
                  <dt className="text-muted">Letter</dt>
                  <dd className="text-ink">{v.typeName}</dd>
                  <dt className="text-muted">Reference</dt>
                  <dd className="num text-ink" data-testid="verify-ref">
                    {v.referenceNo}
                  </dd>
                  <dt className="text-muted">Issued</dt>
                  <dd className="text-ink">{letterDate(v.issueDate)}</dd>
                  <dt className="text-muted">Employee</dt>
                  <dd className="text-ink">{v.employeeNameMasked}</dd>
                </dl>
                <p className="text-xs text-muted">Only these details are shown. For anything else, contact {v.companyName}’s HR.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
