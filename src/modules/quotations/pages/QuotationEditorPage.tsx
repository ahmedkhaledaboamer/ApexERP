import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  LayoutTemplate,
  Mail,
  PencilLine,
  Printer,
  Save,
  Send,
  Trophy,
  XCircle,
} from 'lucide-react'
import type { User } from '@/shared/types'
import type { LeadRow } from '@/modules/leads/types'
import type { Quotation, QuotationItem, QuotationStatus } from '@/modules/quotations/types'
import { customerPath, leadPath, PATHS, quotationPath } from '@/app/paths'
import { useLeadsQuery } from '@/modules/leads/hooks/useLeads'
import { useServicesQuery } from '@/modules/services/hooks/useServices'
import {
  useCreateQuotation,
  useDuplicateQuotation,
  useQuotationQuery,
  useSendQuotation,
  useSetQuotationStatus,
  useUpdateQuotation,
} from '@/modules/quotations/hooks/useQuotations'
import {
  addDaysIso,
  computeTotals,
  DEFAULT_VALIDITY_DAYS,
  daysUntil,
  fmtAmount,
  todayIso,
} from '@/modules/quotations/lib/totals'
import { defaultNotes, defaultTerms, issuerFor } from '@/modules/quotations/lib/company'
import { useBranding, useRegion, useTenant } from '@/modules/tenancy/hooks'
import { useTemplatesQuery } from '@/modules/settings/hooks/useTemplates'
import { buildTemplateContext } from '@/modules/settings/templates/context'
import { findVariables, renderSegments, renderTemplate, type TemplateContext } from '@/modules/settings/templates/render'
import { getVariable, isKnownVariable } from '@/modules/settings/templates/variables'
import type { MessageTemplate, TemplatePurpose } from '@/modules/settings/templates/types'
import { QuotationStatusBadge } from '@/modules/quotations/components/QuotationStatusBadge'
import { ValidUntil } from '@/modules/quotations/components/ValidUntil'
import { LeadPicker } from '@/modules/quotations/components/Pickers'
import { LineItemsEditor, LineItemsView } from '@/modules/quotations/components/LineItemsEditor'
import {
  QuotationDocument,
  QuotationPrintPortal,
  type QuotationDocumentData,
} from '@/modules/quotations/components/QuotationDocument'
import { can, scopeOf } from '@/shared/lib/permissions'
import { ApiError } from '@/shared/lib/apiError'
import { cn, fmtDate } from '@/shared/lib/utils'
import { useLookups } from '@/shared/hooks/useLookups'
import { movesToProposal, SYSTEM_STATUS } from '@/shared/lib/systemStatus'
import { useCurrentUser } from '@/store/hooks'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, ErrorState, Skeleton } from '@/shared/components/ui/Feedback'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { Modal } from '@/shared/components/ui/Modal'
import { StatusBadge } from '@/shared/components/ui/StatusBadge'
import { Tabs } from '@/shared/components/ui/Tabs'
import { useToast } from '@/shared/components/ui/Toast'
import { Field, TextArea, TextInput } from '@/shared/components/form/Field'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { useOpenWonDialog } from '@/modules/won/hooks'

/** One page for /sales/quotations/new (create) and /sales/quotations/:id (view, edit while Draft). */
export default function QuotationEditorPage() {
  const user = useCurrentUser()
  const { id } = useParams()
  if (!user) return null
  if (scopeOf(user.role, 'sales') === 'hidden') {
    return (
      <PageBody>
        <EmptyState title="Quotations aren’t part of your role" body={`${user.role} has no access to Sales & CRM.`} />
      </PageBody>
    )
  }
  return id ? <ExistingQuotation key={id} id={id} user={user} /> : <NewQuotation user={user} />
}

function NewQuotation({ user }: { user: User }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const leadsQuery = useLeadsQuery()
  const leadIdParam = params.get('leadId')
  const customerId = params.get('customerId')

  if (!can(user.role, 'sales', 'create')) {
    return (
      <PageBody>
        <EmptyState
          title="You can view quotations but not create them"
          body={`${user.role} has read-only access to Sales & CRM.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.quotations)}>
              Back to quotations
            </Button>
          }
        />
      </PageBody>
    )
  }
  // A customer link needs the leads list to find the customer's lead.
  if (!leadIdParam && customerId && leadsQuery.isPending) return <EditorSkeleton />
  const initialLeadId = leadIdParam ?? leadsQuery.data?.find((l) => l.customerId === customerId)?.id ?? ''

  return <QuotationEditor quotation={null} initialLeadId={initialLeadId} user={user} />
}

function ExistingQuotation({ id, user }: { id: string; user: User }) {
  const navigate = useNavigate()
  const query = useQuotationQuery(id)

  if (query.isPending) return <EditorSkeleton />
  if (query.isError) {
    const missing = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403)
    return (
      <PageBody>
        {missing ? (
          <EmptyState
            icon={<FileText aria-hidden />}
            title={query.error.message}
            body="Check the link, or find the quotation from the list."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate(PATHS.quotations)}>
                Back to quotations
              </Button>
            }
          />
        ) : (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
        )}
      </PageBody>
    )
  }
  return <QuotationEditor quotation={query.data} initialLeadId={query.data.leadId} user={user} />
}

/* ---------------- Form state ---------------- */

interface FormState {
  leadId: string
  title: string
  validUntil: string
  items: QuotationItem[]
  notes: string
  terms: string
}

function fromQuotation(q: Quotation): FormState {
  return { leadId: q.leadId, title: q.title, validUntil: q.validUntil, items: q.items, notes: q.notes, terms: q.terms }
}

function emptyForm(leadId: string, fallback: Record<TextField, string>): FormState {
  return {
    leadId,
    title: '',
    validUntil: addDaysIso(DEFAULT_VALIDITY_DAYS),
    items: [],
    notes: fallback.notes,
    terms: fallback.terms,
  }
}

interface FormErrors {
  leadId?: string
  title?: string
  validUntil?: string
  items?: string
  lines: Record<string, string>
}

/** Mirrors the server rules so problems show before a round trip. */
function validate(f: FormState): { errors: FormErrors; ok: boolean } {
  const errors: FormErrors = { lines: {} }
  if (!f.leadId) errors.leadId = 'Pick the lead this quotation is for.'
  if (!f.title.trim()) errors.title = 'Give the quotation a title.'
  if (!f.validUntil) errors.validUntil = 'Set the date the quotation is valid until.'
  else if (f.validUntil < todayIso()) errors.validUntil = 'The validity date can’t be in the past.'
  if (f.items.length === 0) errors.items = 'Add at least one line item.'
  for (const it of f.items) {
    if (!it.description.trim()) errors.lines[it.id] = 'Add a description.'
    else if (!(it.quantity > 0)) errors.lines[it.id] = 'Quantity must be more than 0.'
    else if (!(it.unitPrice >= 0)) errors.lines[it.id] = 'Price can’t be negative.'
    else if (!(it.discountPct >= 0 && it.discountPct <= 100)) errors.lines[it.id] = 'Discount must be between 0 and 100%.'
  }
  const ok = !errors.leadId && !errors.title && !errors.validUntil && !errors.items && Object.keys(errors.lines).length === 0
  return { errors, ok }
}

const NO_ERRORS: FormErrors = { lines: {} }

/* ---------------- Quotation templates ---------------- */

type TextField = 'notes' | 'terms'

const FIELD_PURPOSE: Record<TextField, TemplatePurpose> = { notes: 'Quotation cover', terms: 'Quotation terms' }

/**
 * Fills a quotation template for the Notes / Terms box: lead, agent, company and date values are
 * written in; `{{quotation.*}}` (title, total, validity and number still change while editing) and
 * variables with no value yet stay as tokens, resolved on preview and save (`renderTemplate`).
 */
function fillQuotationText(text: string, ctx: TemplateContext): string {
  return renderSegments(text, ctx)
    .map((s) => (s.kind === 'text' ? s.text : s.kind === 'value' && !s.key.startsWith('quotation.') ? s.text : `{{${s.key}}}`))
    .join('')
}

const NUMBER_TOKEN = /\{\{\s*quotation\.number\s*\}\}/


type Tab = 'details' | 'preview'

/* ---------------- Editor ---------------- */

interface EditorProps {
  quotation: Quotation | null
  initialLeadId: string
  user: User
}

function QuotationEditor({ quotation, initialLeadId, user }: EditorProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const leadsQuery = useLeadsQuery()
  const servicesQuery = useServicesQuery()
  const lookups = useLookups()
  const create = useCreateQuotation()
  const update = useUpdateQuotation()
  const send = useSendQuotation()
  const decide = useSetQuotationStatus()
  const duplicate = useDuplicateQuotation()
  const region = useRegion()
  const tenant = useTenant()
  const branding = useBranding()
  /** Standard Notes / Terms (tenant name, currency and VAT) when no default template applies. */
  const FIELD_FALLBACK: Record<TextField, string> = { notes: defaultNotes(branding.displayName), terms: defaultTerms(region) }
  const vatPct = quotation?.vatPct ?? region.vatPct
  const currency = quotation?.currency ?? region.currency
  const fmtAed = (v: number) => fmtAmount(v, currency)

  const canEdit = can(user.role, 'sales', 'edit')
  const canCreate = can(user.role, 'sales', 'create')
  const status: QuotationStatus = quotation?.status ?? 'Draft'
  const editable = quotation ? status === 'Draft' && canEdit : canCreate

  const [form, setForm] = useState<FormState>(() => (quotation ? fromQuotation(quotation) : emptyForm(initialLeadId, FIELD_FALLBACK)))
  const [baseline, setBaseline] = useState(() => JSON.stringify(form))
  const [attempted, setAttempted] = useState(false)
  const [tab, setTab] = useState<Tab>(editable ? 'details' : 'preview')
  const [confirmSend, setConfirmSend] = useState(false)
  /** After "Accepted": ask whether to win the deal now (opens the Won dialog). */
  const [winPrompt, setWinPrompt] = useState<Quotation | null>(null)
  const openWon = useOpenWonDialog()

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data])
  const lead: LeadRow | undefined = leads.find((l) => l.id === form.leadId)
  const dirty = !quotation || JSON.stringify(form) !== baseline
  const { errors: liveErrors, ok } = validate(form)
  const errors = attempted ? liveErrors : NO_ERRORS
  const totals = computeTotals(form.items, vatPct)
  const busy = create.isPending || update.isPending || send.isPending

  /* Quotation templates (Settings > Templates): "Quotation cover" fills Notes, "Quotation terms" fills Terms. */
  const templatesQuery = useTemplatesQuery()
  const quoteTemplates = useMemo(
    () => (templatesQuery.data ?? []).filter((t) => t.active && t.channel === 'quotation'),
    [templatesQuery.data],
  )
  const tplCtx = buildTemplateContext({
    lead: lead ?? null,
    agent: user,
    quotation: { number: quotation?.number ?? '', title: form.title, validUntil: form.validUntil, totals },
    quotationLink: quotation ? `${window.location.origin}${quotationPath(quotation.id)}` : undefined,
    labels: { status: lookups.statusLabel, industry: lookups.industryLabel, source: lookups.sourceLabel },
    company: issuerFor(tenant),
  })
  /** Final text for the document and the API: every variable filled in. */
  function resolveText(text: string, number?: string): string {
    if (number === undefined) return renderTemplate(text, tplCtx)
    return renderTemplate(text, { ...tplCtx, quotation: { ...tplCtx.quotation, number } })
  }
  /** What the last insert put in each box (template id, or null for the standard text). */
  const [inserted, setInserted] = useState<Record<TextField, { id: string | null; text: string }>>(() => ({
    notes: { id: null, text: form.notes },
    terms: { id: null, text: form.terms },
  }))
  const [pendingInsert, setPendingInsert] = useState<{ field: TextField; template: MessageTemplate | null } | null>(null)
  // Existing quotations keep their own text; only a new one is pre-filled.
  const [prefilled, setPrefilled] = useState(!!quotation)

  function insert(field: TextField, t: MessageTemplate | null) {
    const text = t ? fillQuotationText(t.body, tplCtx) : FIELD_FALLBACK[field]
    set(field, text)
    setInserted((prev) => ({ ...prev, [field]: { id: t?.id ?? null, text } }))
  }

  function requestInsert(field: TextField, t: MessageTemplate | null) {
    const current = form[field]
    if (current.trim() && current !== inserted[field].text) setPendingInsert({ field, template: t })
    else insert(field, t)
  }

  useEffect(() => {
    if (prefilled || templatesQuery.isPending || leadsQuery.isPending) return
    setPrefilled(true)
    for (const field of ['notes', 'terms'] as const) {
      const t = quoteTemplates.find((x) => x.purpose === FIELD_PURPOSE[field] && x.isDefault)
      // Falls back to the standard Notes / Terms (already in the form) when there's no default.
      if (t && form[field] === inserted[field].text) insert(field, t)
    }
    // Runs once, when templates and leads are in; `insert` reads the current render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled, templatesQuery.isPending, leadsQuery.isPending, quoteTemplates])

  // Picking another lead on a new quotation refills untouched template text for that lead.
  const lastLeadId = useRef(form.leadId)
  useEffect(() => {
    if (lastLeadId.current === form.leadId) return
    lastLeadId.current = form.leadId
    if (quotation || !prefilled) return
    for (const field of ['notes', 'terms'] as const) {
      const { id: tplId, text } = inserted[field]
      const t = tplId ? quoteTemplates.find((x) => x.id === tplId) : undefined
      if (t && form[field] === text) insert(field, t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.leadId])

  const recipient = {
    company: quotation?.company ?? lead?.company ?? '',
    contactName: quotation?.contactName ?? lead?.contactName ?? '',
    contactEmail: quotation?.contactEmail ?? lead?.contactEmail ?? '',
  }

  const doc: QuotationDocumentData = {
    number: quotation?.number ?? null,
    title: form.title,
    status,
    ...recipient,
    issuedAt: quotation?.sentAt ?? quotation?.createdAt ?? new Date().toISOString(),
    validUntil: form.validUntil,
    items: form.items,
    vatPct,
    currency,
    notes: resolveText(form.notes),
    terms: resolveText(form.terms),
    preparedBy: quotation?.createdByName ?? user.name,
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  /** Saves the form if needed and returns the stored quotation. */
  async function persist(): Promise<Quotation> {
    const body = {
      title: form.title,
      validUntil: form.validUntil,
      items: form.items,
      notes: resolveText(form.notes),
      terms: resolveText(form.terms),
    }
    let saved: Quotation
    if (!quotation) {
      saved = await create.mutateAsync({ ...body, leadId: form.leadId })
      // The number is assigned on create: fill {{quotation.number}} in a second step.
      if (NUMBER_TOKEN.test(form.notes) || NUMBER_TOKEN.test(form.terms)) {
        saved = await update.mutateAsync({
          id: saved.id,
          input: { notes: resolveText(form.notes, saved.number), terms: resolveText(form.terms, saved.number) },
        })
      }
    } else if (dirty) saved = await update.mutateAsync({ id: quotation.id, input: body })
    else return quotation
    const next = fromQuotation(saved)
    setForm(next)
    setBaseline(JSON.stringify(next))
    return saved
  }

  function check(): boolean {
    setAttempted(true)
    if (!ok) {
      setTab('details')
      toast.error('Check the highlighted fields', liveErrors.items ?? liveErrors.leadId ?? liveErrors.title ?? liveErrors.validUntil)
    }
    return ok
  }

  async function saveDraft() {
    if (!check()) return
    try {
      const saved = await persist()
      toast.success(quotation ? 'Draft saved' : `${saved.number} created`, quotation ? undefined : 'Saved as a draft.')
      if (!quotation) navigate(quotationPath(saved.id), { replace: true })
    } catch (e) {
      toast.error('Not saved', (e as Error).message)
    }
  }

  function askToSend() {
    if (check()) setConfirmSend(true)
  }

  async function confirmAndSend() {
    const movesLead = !!lead && movesToProposal(lookups.status, lead.status)
    let saved: Quotation
    try {
      saved = await persist()
    } catch (e) {
      toast.error('Quotation not sent', (e as Error).message)
      return
    }
    try {
      const sent = await send.mutateAsync(saved.id)
      setConfirmSend(false)
      toast.success(`${sent.number} sent to ${sent.contactEmail}`, movesLead ? `${sent.company} moved to ${lookups.statusLabel(SYSTEM_STATUS.proposal)}.` : undefined)
      if (!quotation) navigate(quotationPath(sent.id), { replace: true })
      else setTab('preview')
    } catch (e) {
      setConfirmSend(false)
      toast.error('Saved as a draft, but not sent', (e as Error).message)
      // The draft exists now; open it so a retry doesn't create a second one.
      if (!quotation) navigate(quotationPath(saved.id), { replace: true })
    }
  }

  function markAs(next: 'Accepted' | 'Rejected') {
    if (!quotation) return
    decide.mutate(
      { id: quotation.id, status: next },
      {
        onSuccess: (q) => {
          toast.success(`${q.number} marked ${next.toLowerCase()}`)
          if (next === 'Accepted' && !(lead && lookups.isWon(lead.status) && q.customerId)) setWinPrompt(q)
        },
        onError: (e) => toast.error('Status not changed', e.message),
      },
    )
  }

  function duplicateIt() {
    if (!quotation) return
    duplicate.mutate(quotation.id, {
      onSuccess: (q) => {
        toast.success(`Duplicated as ${q.number}`, 'The copy is a draft you can edit.')
        navigate(quotationPath(q.id))
      },
      onError: (e) => toast.error('Not duplicated', e.message),
    })
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Record header */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 sm:px-6 lg:px-10">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted">
            <Link to={PATHS.quotations} className="hover:text-ink">
              Quotations
            </Link>
            <span className="text-subtle">/</span>
            <span className="text-ink-2">{quotation?.number ?? 'New quotation'}</span>
          </nav>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
              <FileText className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">
                  {quotation ? form.title || quotation.title : form.title || 'New quotation'}
                </h1>
                <QuotationStatusBadge status={status} soft />
                {quotation && dirty && editable && <Badge variant="outline">Unsaved changes</Badge>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted">
                {quotation && <span className="font-mono text-xs">{quotation.number}</span>}
                {recipient.company ? (
                  <Link to={leadPath(form.leadId)} className="text-ink-2 hover:text-ink hover:underline">
                    {recipient.company}
                  </Link>
                ) : (
                  <span>No lead selected</span>
                )}
                {quotation?.customerId && (
                  <Link to={customerPath(quotation.customerId)} className="hover:text-ink hover:underline">
                    Customer {quotation.customerId}
                  </Link>
                )}
                {quotation && (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={quotation.ownerName} size="xs" />
                    {quotation.ownerName}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Tabs<Tab>
            label="Quotation views"
            value={tab}
            onChange={setTab}
            className="mt-4 border-b-0"
            items={[
              { id: 'details', label: editable ? 'Edit' : 'Details', icon: <PencilLine /> },
              { id: 'preview', label: 'Preview', icon: <Eye /> },
            ]}
          />
        </div>
      </div>

      <PageBody className="w-full flex-1">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div role="tabpanel" id={`tab-panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0 space-y-6">
            {tab === 'preview' ? (
              <div className="overflow-hidden rounded-card border border-line bg-sunken p-2 sm:p-6">
                <QuotationDocument data={doc} className="rounded-sm shadow-pop" />
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader title="Client" description="Company and contact come from the lead." />
                  <CardBody>
                    {!quotation ? (
                      <Field id="q-lead" label="Lead" required error={errors.leadId}>
                        <LeadPicker
                          id="q-lead"
                          leads={leads}
                          loading={leadsQuery.isPending}
                          value={form.leadId}
                          onChange={(v) => set('leadId', v)}
                          invalid={!!errors.leadId}
                        />
                      </Field>
                    ) : null}
                    {(quotation || lead) && (
                      <ClientBlock
                        className={quotation ? '' : 'mt-3'}
                        company={recipient.company}
                        contactName={recipient.contactName}
                        contactEmail={recipient.contactEmail}
                        leadId={form.leadId}
                        lead={lead}
                      />
                    )}
                    {!quotation && form.leadId && !leadsQuery.isPending && !lead && (
                      <p className="mt-2 text-xs text-warning-700 dark:text-warning-500">
                        That lead isn’t in your access. Pick another one.
                      </p>
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Quotation" />
                  <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_13.75rem]">
                    <Field id="q-title" label="Title" required error={errors.title} hint="Shown at the top of the document.">
                      <TextInput
                        id="q-title"
                        value={form.title}
                        onChange={(e) => set('title', e.target.value)}
                        placeholder="e.g. Patient booking chatbot"
                        invalid={!!errors.title}
                        disabled={!editable}
                      />
                    </Field>
                    <Field id="q-valid" label="Valid until" required error={errors.validUntil}>
                      <TextInput
                        id="q-valid"
                        type="date"
                        min={editable ? todayIso() : undefined}
                        value={form.validUntil}
                        onChange={(e) => set('validUntil', e.target.value)}
                        invalid={!!errors.validUntil}
                        disabled={!editable}
                        className="num"
                      />
                      {editable && (
                        <div className="mt-1.5 flex gap-1">
                          {[14, 30, 60].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => set('validUntil', addDaysIso(d))}
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[0.6875rem] text-muted ring-1 ring-line ring-inset hover:bg-hover hover:text-ink',
                                form.validUntil === addDaysIso(d) && 'bg-sunken text-ink',
                              )}
                            >
                              {d} days
                            </button>
                          ))}
                        </div>
                      )}
                    </Field>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader
                    title="Line items"
                    description={editable ? `Add services or packages from the catalog, or a custom line. Prices are in ${currency}, before VAT.` : undefined}
                  />
                  <CardBody>
                    {editable ? (
                      <LineItemsEditor
                        items={form.items}
                        onChange={(items) => set('items', items)}
                        services={servicesQuery.data ?? []}
                        servicesLoading={servicesQuery.isPending}
                        errors={errors.lines}
                        listError={errors.items}
                        currency={currency}
                      />
                    ) : (
                      <LineItemsView items={form.items} services={servicesQuery.data ?? []} currency={currency} />
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Notes and terms" description="Printed at the bottom of the document." />
                  <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {(['notes', 'terms'] as const).map((field) => (
                      <div key={field} className="min-w-0">
                        <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2">
                          <label htmlFor={`q-${field}`} className="text-[0.8125rem] font-medium text-ink-2">
                            {field === 'notes' ? 'Notes' : 'Terms'}
                          </label>
                          {editable && (
                            <InsertTemplateMenu
                              templates={quoteTemplates}
                              prefer={FIELD_PURPOSE[field]}
                              loading={templatesQuery.isPending}
                              currentId={form[field] === inserted[field].text ? inserted[field].id : undefined}
                              onPick={(t) => requestInsert(field, t)}
                            />
                          )}
                        </div>
                        <TextArea
                          id={`q-${field}`}
                          value={form[field]}
                          onChange={(e) => set(field, e.target.value)}
                          disabled={!editable}
                          className="min-h-32"
                          aria-describedby={editable && findVariables(form[field]).length > 0 ? `q-${field}-vars` : undefined}
                        />
                        {editable && <VariablesHint id={`q-${field}-vars`} text={form[field]} />}
                      </div>
                    ))}
                  </CardBody>
                </Card>
              </>
            )}
          </div>

          <aside className="min-w-0">
            <div className="space-y-4 lg:sticky lg:top-6">
              <Card>
                <CardHeader title="Summary" action={<QuotationStatusBadge status={status} />} />
                <CardBody>
                  <dl className="num space-y-2 text-[0.8125rem]">
                    <SummaryRow label="Subtotal" value={fmtAed(totals.subtotal)} />
                    <SummaryRow label="Discount" value={totals.discount > 0 ? `−${fmtAed(totals.discount)}` : fmtAed(0)} muted={!totals.discount} />
                    <SummaryRow label={`VAT ${vatPct}%`} value={fmtAed(totals.vat)} />
                  </dl>
                  <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
                    <span className="text-[0.8125rem] font-medium text-ink-2">Total</span>
                    <span className="num text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">{fmtAed(totals.total)}</span>
                  </div>
                  <p className="mt-1 text-end text-xs text-muted">
                    {form.items.length} {form.items.length === 1 ? 'line' : 'lines'} · {currency}, VAT inclusive
                  </p>

                  <div className="mt-5 space-y-2">
                    {editable && (
                      <>
                        <Button write className="w-full" onClick={askToSend} disabled={busy || lead?.doNotContact}>
                          <Send />
                          Send quotation
                        </Button>
                        <Button write variant="secondary" className="w-full" onClick={saveDraft} loading={create.isPending || update.isPending} disabled={!dirty || busy}>
                          <Save />
                          {quotation ? (dirty ? 'Save draft' : 'Draft saved') : 'Save draft'}
                        </Button>
                        {lead?.doNotContact && (
                          <p className="flex items-start gap-1.5 text-xs text-danger-600 dark:text-danger-500">
                            <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {lead.company} is marked Do Not Contact, so the quotation can’t be emailed.
                          </p>
                        )}
                      </>
                    )}
                    {quotation && canEdit && (status === 'Sent' || status === 'Viewed') && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button write onClick={() => markAs('Accepted')} loading={decide.isPending && decide.variables?.status === 'Accepted'} disabled={decide.isPending}>
                          <CheckCircle2 />
                          Accepted
                        </Button>
                        <Button write variant="secondary" onClick={() => markAs('Rejected')} loading={decide.isPending && decide.variables?.status === 'Rejected'} disabled={decide.isPending}>
                          <XCircle />
                          Rejected
                        </Button>
                      </div>
                    )}
                    {quotation && canEdit && status === 'Accepted' && !(lead && lookups.isWon(lead.status) && quotation.customerId) && (
                      <Button write className="w-full" onClick={() => openWon(quotation.leadId, quotation.id)}>
                        <Trophy />
                        Win deal
                      </Button>
                    )}
                    {quotation && status === 'Expired' && (
                      <p className="flex items-start gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        This quotation lapsed on {fmtDate(quotation.validUntil)}. Duplicate it to send a fresh one.
                      </p>
                    )}
                    <div className="flex gap-2">
                      {quotation && canCreate && (
                        <Button write variant="secondary" className="flex-1" onClick={duplicateIt} loading={duplicate.isPending}>
                          <Copy />
                          Duplicate
                        </Button>
                      )}
                      <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
                        <Printer />
                        Print / PDF
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {quotation && <TimelineCard quotation={quotation} />}
            </div>
          </aside>
        </div>
      </PageBody>

      <QuotationPrintPortal data={doc} />

      <Modal
        open={!!pendingInsert}
        onClose={() => setPendingInsert(null)}
        size="sm"
        title={`Replace the ${pendingInsert?.field === 'terms' ? 'terms' : 'notes'}?`}
        description="Your edits to this box will be replaced by the template text."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingInsert(null)}>
              Keep my text
            </Button>
            <Button
              onClick={() => {
                if (pendingInsert) insert(pendingInsert.field, pendingInsert.template)
                setPendingInsert(null)
              }}
            >
              Replace
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">Inserting “{pendingInsert?.template?.name ?? 'Standard text'}”.</p>
      </Modal>

      <Modal
        open={!!winPrompt}
        onClose={() => setWinPrompt(null)}
        size="sm"
        title={`Win ${winPrompt?.company ?? 'this deal'} now?`}
        description="The quotation is accepted. Winning converts the lead into a customer and creates its projects; you’ll review everything before it’s saved."
        footer={
          <>
            <Button variant="secondary" onClick={() => setWinPrompt(null)}>
              Not now
            </Button>
            <Button write
              onClick={() => {
                if (winPrompt) openWon(winPrompt.leadId, winPrompt.id)
                setWinPrompt(null)
              }}
            >
              <Trophy />
              Review and win
            </Button>
          </>
        }
      >
        <p className="text-[0.8125rem] text-muted">You can also do this later with “Win deal” on this quotation or the lead.</p>
      </Modal>

      <Modal
        open={confirmSend}
        onClose={() => !busy && setConfirmSend(false)}
        title="Send this quotation?"
        description="It’s emailed from the system and can’t be edited afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmSend(false)} disabled={busy}>
              Cancel
            </Button>
            <Button write onClick={confirmAndSend} loading={busy}>
              <Send />
              Send to {recipient.contactName.split(' ')[0] || 'client'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-[0.8125rem]">
          <div className="flex items-center gap-3 rounded-lg border border-line bg-sunken/60 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-line">
              <Mail className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">
                {recipient.contactName || recipient.company} <span className="font-normal text-muted">&lt;{recipient.contactEmail || 'no email'}&gt;</span>
              </p>
              <p className="truncate text-xs text-muted">{recipient.company}</p>
            </div>
          </div>
          <dl className="num space-y-1.5">
            <SummaryRow
              label="From"
              value={
                <span className="truncate">
                  {branding.emailSenderName} <span className="text-muted">&lt;{branding.emailSenderAddress}&gt;</span>
                </span>
              }
            />
            <SummaryRow label="Quotation" value={quotation?.number ?? 'New (numbered on save)'} />
            <SummaryRow label="Title" value={form.title} />
            <SummaryRow label="Valid until" value={fmtDate(form.validUntil)} />
            <SummaryRow label="Total incl. VAT" value={<span className="font-semibold text-ink">{fmtAed(totals.total)}</span>} />
          </dl>
          {lead && movesToProposal(lookups.status, lead.status) && (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <StatusBadge status={lead.status} /> → <StatusBadge status={SYSTEM_STATUS.proposal} />
              <span>The lead moves to {lookups.statusLabel(SYSTEM_STATUS.proposal)}.</span>
            </p>
          )}
          {dirty && <p className="text-xs text-muted">Your changes are saved before sending.</p>}
        </div>
      </Modal>
    </div>
  )
}

/* ---------------- Pieces ---------------- */

/** "Insert template" for the Notes / Terms box: the matching purpose first, then the other one. */
function InsertTemplateMenu({
  templates,
  prefer,
  loading,
  currentId,
  onPick,
}: {
  templates: MessageTemplate[]
  prefer: TemplatePurpose
  loading: boolean
  /** Template the box currently holds unchanged (null: standard text); undefined once edited. */
  currentId: string | null | undefined
  onPick: (t: MessageTemplate | null) => void
}) {
  const purposes: TemplatePurpose[] =
    prefer === 'Quotation cover' ? ['Quotation cover', 'Quotation terms'] : ['Quotation terms', 'Quotation cover']
  const groups = purposes
    .map((purpose) => ({
      purpose,
      list: templates
        .filter((t) => t.purpose === purpose)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.list.length > 0)
  return (
    <Menu
      className="w-64"
      trigger={(props) => (
        <Button variant="ghost" size="xs" {...props} disabled={loading}>
          <LayoutTemplate />
          Insert template
          <ChevronDown />
        </Button>
      )}
    >
      {(close) => (
        <>
          {groups.length === 0 && <MenuLabel>No active quotation templates</MenuLabel>}
          {groups.map((g) => (
            <div key={g.purpose}>
              <MenuLabel>{g.purpose}</MenuLabel>
              {g.list.map((t) => (
                <MenuItem
                  key={t.id}
                  active={currentId === t.id}
                  hint={t.isDefault ? 'Default' : undefined}
                  onSelect={() => {
                    close()
                    onPick(t)
                  }}
                >
                  {t.name}
                </MenuItem>
              ))}
            </div>
          ))}
          <MenuSeparator />
          <MenuItem
            active={currentId === null}
            onSelect={() => {
              close()
              onPick(null)
            }}
          >
            Standard text
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/** Variables still in a Notes / Terms box: filled in on preview and save, or flagged when unknown. */
function VariablesHint({ id, text }: { id: string; text: string }) {
  const keys = findVariables(text)
  if (keys.length === 0) return null
  const unknown = keys.filter((k) => !isKnownVariable(k))
  const known = keys
    .map((k) => getVariable(k))
    .filter((v) => v !== undefined)
    .map((v) => `${v.group.charAt(0).toUpperCase()}${v.group.slice(1)} ${v.label.toLowerCase()}`)
  return (
    <div id={id} className="mt-1.5 space-y-1 text-xs">
      {known.length > 0 && <p className="text-muted">Filled in on preview and save: {known.join(', ')}.</p>}
      {unknown.length > 0 && (
        <p className="flex items-start gap-1 text-danger-600 dark:text-danger-500">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            Unknown {unknown.length === 1 ? 'variable' : 'variables'} {unknown.map((k) => `{{${k}}}`).join(', ')}: fix or remove it, or it prints as
            “[unknown: …]”.
          </span>
        </p>
      )}
    </div>
  )
}

function SummaryRow({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('min-w-0 truncate text-end', muted ? 'text-subtle' : 'text-ink-2')}>{value}</dd>
    </div>
  )
}

function ClientBlock({
  company,
  contactName,
  contactEmail,
  leadId,
  lead,
  className,
}: {
  company: string
  contactName: string
  contactEmail: string
  leadId: string
  lead: LeadRow | undefined
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sunken/40 px-3 py-2.5', className)}>
      <Avatar name={company || '?'} size="lg" square />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[0.8125rem] font-medium text-ink">{company}</span>
          {lead && <StatusBadge status={lead.status} />}
          {lead?.doNotContact && (
            <Badge tone="red" icon={<Ban />}>
              Do not contact
            </Badge>
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs text-muted">
          <span className="text-ink-2">{contactName || 'No contact name'}</span>
          <span aria-hidden>·</span>
          <span>{contactEmail || 'No email on the lead'}</span>
        </p>
      </div>
      <Link to={leadPath(leadId)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
        Open lead
      </Link>
    </div>
  )
}

function TimelineCard({ quotation: q }: { quotation: Quotation }) {
  const events: { label: string; at: string | null; tone: string }[] = [
    { label: `Created by ${q.createdByName}`, at: q.createdAt, tone: 'bg-subtle' },
    { label: `Sent to ${q.contactEmail}`, at: q.sentAt, tone: 'bg-accent-500' },
  ]
  if (q.status === 'Viewed') events.push({ label: 'Viewed by the client', at: null, tone: 'bg-brand-500' })
  if (q.decidedAt) {
    events.push({
      label: q.status === 'Accepted' ? 'Accepted' : 'Rejected',
      at: q.decidedAt,
      tone: q.status === 'Accepted' ? 'bg-success-500' : 'bg-danger-500',
    })
  }
  const days = daysUntil(q.validUntil)

  return (
    <Card>
      <CardHeader title="History" />
      <CardBody>
        <ol className="space-y-3">
          {events
            .filter((e) => e.at !== null || e.label.startsWith('Viewed'))
            .map((e) => (
              <li key={e.label} className="flex gap-2.5 text-[0.8125rem]">
                <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', e.tone)} aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-ink-2">{e.label}</p>
                  {e.at && <p className="num text-xs text-muted">{fmtDate(e.at, 'd MMM yyyy, HH:mm')}</p>}
                </div>
              </li>
            ))}
        </ol>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[0.8125rem]">
          <span className="text-muted">Valid until</span>
          <ValidUntil date={q.validUntil} status={q.status} />
        </div>
        {q.status === 'Draft' && days < 0 && (
          <p className="mt-2 text-xs text-danger-600 dark:text-danger-500">Move the validity date forward before sending.</p>
        )}
      </CardBody>
    </Card>
  )
}

function EditorSkeleton() {
  return (
    <div aria-busy className="flex min-h-full flex-col">
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[100rem] px-4 pt-6 pb-4 sm:px-6 lg:px-10">
          <Skeleton className="h-3 w-32" />
          <div className="mt-3 flex items-center gap-4">
            <Skeleton className="size-14 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="mt-5 h-6 w-40" />
        </div>
      </div>
      <PageBody className="w-full">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="space-y-6">
            <Skeleton className="h-28 rounded-card" />
            <Skeleton className="h-28 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </div>
          <Skeleton className="h-80 rounded-card" />
        </div>
      </PageBody>
    </div>
  )
}
