import { useMemo, useState, type ReactNode } from 'react'
import { CheckCheck, Info } from 'lucide-react'
import type { User } from '@/shared/types'
import type { LeadRow } from '@/modules/leads/types'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { useQuotationsQuery } from '@/modules/quotations/hooks/useQuotations'
import { issuerFor } from '@/modules/quotations/lib/company'
import { useBranding, useTenant } from '@/modules/tenancy/hooks'
import { quotationPath } from '@/app/paths'
import { useLookups } from '@/shared/hooks/useLookups'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'
import { Field, SelectInput, Switch } from '@/shared/components/form/Field'
import { buildTemplateContext, companyContextFor } from '../context'
import { renderTemplate, sampleContext, type TemplateContext } from '../render'
import { WHATSAPP_MAX, type TemplateChannel, type TemplatePurpose } from '../types'
import { RichText } from './RichText'
import { EmailBrandHeader } from './EmailBrandHeader'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'

export interface PreviewDraft {
  channel: TemplateChannel
  purpose: TemplatePurpose | ''
  subject: string
  body: string
}

interface TemplatePreviewProps {
  draft: PreviewDraft
  user: User
  /** Chosen lead; empty means the first one. Kept by the page so it survives switching templates. */
  leadId: string
  onLeadChange: (id: string) => void
  className?: string
}

/** Live preview of the template being edited, filled in with a real lead and the signed-in user. */
export function TemplatePreview({ draft, user, leadId, onLeadChange, className }: TemplatePreviewProps) {
  const leadsQuery = useLeadsQuery()
  const quotationsQuery = useQuotationsQuery()
  const lookups = useLookups()
  const tenant = useTenant()
  const branding = useBranding()
  const [highlight, setHighlight] = useState(true)

  const leads = useMemo(
    () => [...(leadsQuery.data ?? [])].sort((a, b) => a.company.localeCompare(b.company)),
    [leadsQuery.data],
  )
  const lead: LeadRow | null = leads.find((l) => l.id === leadId) ?? leads[0] ?? null

  const quotation = useMemo(() => {
    if (!lead) return null
    return (
      (quotationsQuery.data ?? [])
        .filter((q) => q.leadId === lead.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    )
  }, [quotationsQuery.data, lead])

  const usesQuotation = /\{\{\s*quotation\./.test(draft.subject + draft.body)

  const ctx: TemplateContext = useMemo(() => {
    const sample = sampleContext({ companyName: branding.displayName })
    // Always the tenant's real values (Settings > Company profile via issuerFor), never samples:
    // a field the profile doesn't have yet shows as "not set".
    const company = companyContextFor(tenant)
    if (!lead) return { ...sample, company, agent: buildTemplateContext({ agent: user }).agent }
    const real = buildTemplateContext({
      lead,
      agent: user,
      quotation,
      quotationLink: quotation ? `${window.location.origin}${quotationPath(quotation.id)}` : undefined,
      labels: { status: lookups.statusLabel, industry: lookups.industryLabel, source: lookups.sourceLabel },
    })
    return quotation ? { ...real, company } : { ...real, company, quotation: sample.quotation }
  }, [lead, quotation, user, lookups, tenant, branding])

  const loading = leadsQuery.isPending

  return (
    <Card className={className}>
      <CardHeader
        title="Live preview"
        description={lead ? 'Filled in with a real lead, with you as the agent.' : 'Filled in with sample values.'}
        action={
          <label className="flex items-center gap-2 text-xs text-muted">
            <Switch checked={highlight} onChange={setHighlight} label="Highlight filled-in values" />
            <span className="hidden sm:inline">Highlight values</span>
          </label>
        }
      />
      <CardBody className="space-y-4">
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : leads.length > 0 ? (
          <Field id="tpl-preview-lead" label="Preview with lead">
            <SelectInput id="tpl-preview-lead" value={lead?.id ?? ''} onChange={(e) => onLeadChange(e.target.value)}>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company}
                  {l.contactName ? ` · ${l.contactName}` : ''}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : (
          <Note>No leads to preview with yet, so sample values are shown.</Note>
        )}

        {lead && usesQuotation && !quotation && !quotationsQuery.isPending && (
          <Note>{lead.company} has no quotation yet. Quotation values below are samples.</Note>
        )}

        {loading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : draft.channel === 'email' ? (
          <EmailPreview draft={draft} ctx={ctx} user={user} lead={lead} highlight={highlight} />
        ) : draft.channel === 'whatsapp' ? (
          <WhatsAppPreview draft={draft} ctx={ctx} lead={lead} highlight={highlight} />
        ) : (
          <QuotationPreview draft={draft} ctx={ctx} highlight={highlight} />
        )}
      </CardBody>
    </Card>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-subtle italic">{children}</span>
}

/* ---------------- Email ---------------- */

function EmailPreview({
  draft,
  ctx,
  user,
  lead,
  highlight,
}: {
  draft: PreviewDraft
  ctx: TemplateContext
  user: User
  lead: LeadRow | null
  highlight: boolean
}) {
  const to = lead ? `${lead.contactName || lead.company}` : String(ctx.lead?.contactName ?? '')
  const toEmail = lead?.contactEmail || 'contact@example.com'
  const branding = useBranding()
  return (
    <article aria-label="Email preview" className="overflow-hidden rounded-xl border border-line bg-surface shadow-xs">
      <header className="space-y-3 border-b border-line bg-sunken/50 px-4 py-3.5">
        <h3 className="text-[0.9375rem] leading-snug font-semibold text-ink">
          {draft.subject.trim() ? <RichText text={draft.subject} ctx={ctx} highlight={highlight} /> : <Empty>No subject</Empty>}
        </h3>
        <div className="flex items-start gap-2.5">
          <Avatar name={user.name} size="md" />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="truncate text-ink">
              <span className="font-semibold">{branding.emailSenderName}</span>{' '}
              <span className="text-muted">&lt;{branding.emailSenderAddress}&gt;</span>
            </p>
            <p className="truncate text-muted">
              for {user.name} · replies to {user.email}
            </p>
            <p className="truncate text-muted">
              to {to} &lt;{toEmail}&gt;
            </p>
          </div>
          <span className="shrink-0 text-xs text-subtle">Now</span>
        </div>
      </header>
      <EmailBrandHeader />
      <div className="px-4 py-4 text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap text-ink">
        {draft.body.trim() ? <RichText text={draft.body} ctx={ctx} highlight={highlight} /> : <Empty>Start typing the message…</Empty>}
      </div>
    </article>
  )
}

/* ---------------- WhatsApp ---------------- */

function WhatsAppPreview({
  draft,
  ctx,
  lead,
  highlight,
}: {
  draft: PreviewDraft
  ctx: TemplateContext
  lead: LeadRow | null
  highlight: boolean
}) {
  const name = lead?.contactName || String(ctx.lead?.contactName ?? 'Contact')
  const filledLength = renderTemplate(draft.body, ctx).length
  return (
    <div className="space-y-2">
      <article aria-label="WhatsApp preview" className="overflow-hidden rounded-xl border border-line shadow-xs">
        <header className="flex items-center gap-2.5 bg-[#008069] px-3 py-2.5 text-white">
          <span className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
            {name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0])
              .join('')
              .toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-semibold">{name}</p>
            <p className="truncate text-[0.6875rem] text-white/75">{lead?.company ?? String(ctx.lead?.company ?? '')}</p>
          </div>
        </header>
        <div className="min-h-56 bg-[#efeae2] bg-[radial-gradient(rgb(0_0_0/0.05)_0.0625rem,transparent_0.0625rem)] [background-size:1.125rem_1.125rem] px-3 py-4">
          <p className="mx-auto mb-3 w-fit rounded-md bg-white/90 px-2 py-0.5 text-[0.6875rem] font-medium text-[#54656f] shadow-xs">
            Today
          </p>
          <div className="ms-auto w-fit max-w-[88%] rounded-lg rounded-se-none bg-[#d9fdd3] px-2.5 pt-1.5 pb-1 text-[0.875rem] leading-snug text-[#111b21] shadow-xs">
            <div className="break-words whitespace-pre-wrap">
              {draft.body.trim() ? (
                <RichText text={draft.body} ctx={ctx} highlight={highlight} whatsapp />
              ) : (
                <span className="text-[#667781] italic">Start typing the message…</span>
              )}
            </div>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem] text-[#667781]">
              {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              <CheckCheck className="size-3.5 text-[#53bdeb]" aria-label="Read" />
            </p>
          </div>
        </div>
      </article>
      <p className={cn('text-xs', filledLength > WHATSAPP_MAX ? 'text-danger-600' : 'text-muted')}>
        {filledLength.toLocaleString()} characters once filled in for this lead
        {filledLength > WHATSAPP_MAX && ` — over WhatsApp’s ${WHATSAPP_MAX} limit`}
      </p>
    </div>
  )
}

/* ---------------- Quotation ---------------- */

function QuotationPreview({ draft, ctx, highlight }: { draft: PreviewDraft; ctx: TemplateContext; highlight: boolean }) {
  const issuer = issuerFor(useTenant())
  const terms = draft.purpose === 'Quotation terms'
  const lines = draft.body.split('\n').filter((l) => l.trim())
  const placeholderItems = (
    <div aria-hidden className="my-6 space-y-2 rounded-lg border border-dashed border-zinc-200 p-3">
      <p className="text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">Line items</p>
      {[70, 55, 62].map((w) => (
        <div key={w} className="flex items-center justify-between gap-4">
          <span className="h-2 rounded bg-zinc-100" style={{ width: `${w}%` }} />
          <span className="h-2 w-16 rounded bg-zinc-100" />
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <span className="text-xs font-semibold text-zinc-700">
          Total <RichText text="{{quotation.total}}" ctx={ctx} highlight={highlight} />
        </span>
      </div>
    </div>
  )

  return (
    <article
      aria-label="Quotation preview"
      className="overflow-hidden rounded-xl border border-line bg-white px-5 py-6 text-[0.8125rem] leading-relaxed text-zinc-800 shadow-xs sm:px-7"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div className="flex items-center gap-3">
          <TenantLogo size="md" variant="light" className="object-contain" />
          <div>
            <p className="text-[0.9375rem] font-semibold text-zinc-900">{issuer.name}</p>
            {issuer.website && <p className="text-xs text-zinc-500">{issuer.website}</p>}
          </div>
        </div>
        <div className="text-end">
          <p className="text-base font-semibold text-zinc-900">Quotation</p>
          <p className="font-mono text-xs text-zinc-500">
            <RichText text="{{quotation.number}}" ctx={ctx} />
          </p>
        </div>
      </header>
      <p className="mt-4 text-xs text-zinc-500">
        Prepared for <span className="font-medium text-zinc-800">{String(ctx.lead?.company ?? '')}</span>
      </p>

      {terms && placeholderItems}

      <section className={cn(!terms && 'mt-5')}>
        <h3 className="mb-2 text-[0.6875rem] font-medium tracking-wide text-zinc-400 uppercase">
          {terms ? 'Terms & conditions' : 'Cover note'}
        </h3>
        {lines.length === 0 ? (
          <span className="text-zinc-400 italic">Start typing the {terms ? 'terms' : 'cover note'}…</span>
        ) : terms ? (
          <ol className="list-decimal space-y-1 ps-5 marker:text-zinc-400">
            {lines.map((line, i) => (
              <li key={i}>
                <RichText text={line} ctx={ctx} highlight={highlight} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="break-words whitespace-pre-wrap">
            <RichText text={draft.body} ctx={ctx} highlight={highlight} />
          </div>
        )}
      </section>

      {!terms && placeholderItems}

      <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-zinc-400">
        <Info className="size-3" aria-hidden />
        {terms ? 'Each line prints as a numbered term.' : 'Printed above the line items on the quotation.'}
      </p>
    </article>
  )
}
