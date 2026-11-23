import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge, type Tone } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useAppSelector } from '@/store/hooks'
import { ROOT_DOMAIN } from '@/shared/lib/tenantContext'
import {
  FORM_STATUS_LABEL,
  SUBMISSION_OUTCOME_LABEL,
  type FormStatus,
  type SeoCheckStatus,
  type SubmissionOutcome,
} from '@/modules/marketing/growth/types'

export function FormStatusBadge({ status }: { status: FormStatus }) {
  return (
    <Badge tone={status === 'active' ? 'green' : 'amber'} variant="dot">
      {FORM_STATUS_LABEL[status]}
    </Badge>
  )
}

const OUTCOME_TONE: Record<SubmissionOutcome, Tone> = { created: 'green', linked: 'blue', limit: 'amber', spam: 'neutral' }
export function OutcomeBadge({ outcome }: { outcome: SubmissionOutcome }) {
  return <Badge tone={OUTCOME_TONE[outcome]}>{SUBMISSION_OUTCOME_LABEL[outcome]}</Badge>
}

export const scoreTone = (score: number): Tone => (score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red')
export function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge tone={scoreTone(score)} className="num">
      {score}
    </Badge>
  )
}

export const CHECK_TONE: Record<SeoCheckStatus, Tone> = { pass: 'green', warn: 'amber', fail: 'red' }

/** Copies text; the button shows a tick for a moment. */
export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'xs' | 'sm' }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="secondary"
      size={size}
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          window.setTimeout(() => setDone(false), 1500)
        })
      }
    >
      {done ? <Check /> : <Copy />}
      {done ? 'Copied' : label}
    </Button>
  )
}

/** A read-only value (link or code) with a copy button. */
export function CopyField({ label, value, code, testId }: { label: string; value: string; code?: boolean; testId?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] font-medium text-ink-2">{label}</span>
        <CopyButton text={value} size="xs" />
      </div>
      <pre
        data-testid={testId}
        className={cn('max-h-40 overflow-auto rounded-lg border border-line bg-sunken px-3 py-2 text-xs break-all whitespace-pre-wrap text-ink-2', code && 'font-mono')}
      >
        {value}
      </pre>
    </div>
  )
}

/**
 * Public addresses of the workspace: the canonical one (`https://<subdomain>.apexcrm.app/...`) and the
 * one that opens here in development (`<origin>/...?workspace=<subdomain>`).
 */
export function usePublicUrls() {
  const sub = useAppSelector((s) => s.auth.session?.tenant.subdomain) ?? ''
  const local = typeof window !== 'undefined' && !window.location.hostname.endsWith(ROOT_DOMAIN)
  /** `withWorkspace`: the page needs the company from the address (landing pages); on localhost it goes in ?workspace=. */
  const url = (path: string, withWorkspace = false) =>
    local
      ? `${window.location.origin}${path}${withWorkspace ? `${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(sub)}` : ''}`
      : `https://${sub}.${ROOT_DOMAIN}${path}`
  return { subdomain: sub, url }
}

/**
 * Embed snippets of a lead form (hosted page URL, iframe, auto-height script). Shared by the form's Share & embed panel
 * and Insights & admin › Integrations › Website & forms.
 */
export function embedSnippets(form: { name: string; publicKey: string }, hosted: string): { hosted: string; iframe: string; script: string } {
  const frame = `${hosted}?embed=1`
  const origin = new URL(hosted).origin
  const iframe = `<iframe src="${frame}" title="${form.name.replace(/"/g, '&quot;')}" style="width:100%;min-height:560px;border:0" loading="lazy"></iframe>`
  const box = `apex-form-${form.publicKey}`
  const script = `<div id="${box}"></div>
<script>(function(){var f=document.createElement('iframe');f.src='${frame}';f.title='Form';f.style.cssText='width:100%;min-height:480px;border:0';document.getElementById('${box}').appendChild(f);window.addEventListener('message',function(e){if(e.origin==='${origin}'&&e.data&&e.data.key==='${form.publicKey}'&&e.data.apexFormHeight){f.style.height=e.data.apexFormHeight+'px'}})})();</script>`
  return { hosted, iframe, script }
}
