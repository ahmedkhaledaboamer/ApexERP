import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Gauge, Lock } from 'lucide-react'
import type { LimitReachedDetails, ModuleLockedDetails } from '@/modules/billing/types'
import { LIMIT_LABEL, PLAN_MODULE_LABEL, cheapestPlanAbove, cheapestPlanWith, formatLimitValue, planIdLabel } from '@/modules/billing/gating'
import { billingKeys, useBillingAccess, useEntitlements } from '@/modules/billing/hooks'
import { alertKeys } from '@/modules/alerts/hooks/useAlerts'
import { usePlans } from '@/modules/signup/api'
import { SETTINGS_PATHS } from '@/modules/settings/components/SettingsLayout'
import { onBillingEvent } from '@/shared/lib/billingEvents'
import { Button } from '@/shared/components/ui/Button'
import { Modal } from '@/shared/components/ui/Modal'
import { useToast } from '@/shared/components/ui/Toast'

type Prompt = { kind: 'limit'; details: LimitReachedDetails } | { kind: 'module'; details: ModuleLockedDetails }

const READ_ONLY_TOAST_GAP_MS = 5_000

/**
 * The one upgrade prompt. Listens to billing errors from the API (axios → billingEvents):
 * LIMIT_REACHED and module_not_in_plan open this dialog; workspace_read_only shows a short toast.
 * Every event refreshes the entitlements so buttons and banners catch up. Mounted once in AppLayout.
 */
export function UpgradePromptHost() {
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const lastReadOnlyToast = useRef(0)

  useEffect(
    () =>
      onBillingEvent((event) => {
        void qc.invalidateQueries({ queryKey: billingKeys.all })
        void qc.invalidateQueries({ queryKey: alertKeys.all })
        if (event.kind === 'read_only') {
          const now = Date.now()
          if (now - lastReadOnlyToast.current > READ_ONLY_TOAST_GAP_MS) {
            lastReadOnlyToast.current = now
            toast.info('Workspace is read-only', 'Changes are paused until the subscription is paid.')
          }
          return
        }
        setPrompt(event.kind === 'limit' ? { kind: 'limit', details: event.details } : { kind: 'module', details: event.details })
      }),
    [qc, toast],
  )

  const close = useCallback(() => setPrompt(null), [])
  // Portaled to <body> so the prompt stacks above an open drawer (e.g. a plan error inside the Won
  // dialog): drawers are portaled too, and the later node wins at the same z-index.
  return createPortal(<UpgradeDialog prompt={prompt} onClose={close} />, document.body)
}

function UpgradeDialog({ prompt, onClose }: { prompt: Prompt | null; onClose: () => void }) {
  const navigate = useNavigate()
  const ent = useEntitlements()
  const { canManage } = useBillingAccess()
  const plans = usePlans()
  const planName = ent.planName ?? (prompt ? planIdLabel(prompt.details.planId) : '')

  let title = ''
  let body = ''
  let suggestion: string | null = null
  if (prompt?.kind === 'limit') {
    const d = prompt.details
    const label = LIMIT_LABEL[d.limit] ?? d.limit
    title = 'You’ve reached your plan’s limit'
    body = `${formatLimitValue(d.limit, d.current)} of ${formatLimitValue(d.limit, d.max)} ${label.toLowerCase()} used on the ${planName} plan.`
    const next = plans.data ? cheapestPlanAbove(d.limit, d.current, plans.data, ent.planId ?? d.planId) : null
    if (next) suggestion = `${next.name} allows ${next.limits[d.limit] === null ? 'unlimited' : formatLimitValue(d.limit, next.limits[d.limit])} ${label.toLowerCase()}.`
  } else if (prompt?.kind === 'module') {
    const label = PLAN_MODULE_LABEL[prompt.details.module] ?? prompt.details.module
    title = `${label} isn’t in your plan`
    body = `The ${planName} plan doesn’t include ${label}.`
    const next = plans.data ? cheapestPlanWith(prompt.details.module, plans.data, ent.planId ?? prompt.details.planId) : null
    if (next) suggestion = `It’s included from ${next.name}.`
  }

  return (
    <Modal
      open={!!prompt}
      onClose={onClose}
      size="sm"
      title={title}
      description={body}
      footer={
        canManage ? (
          <>
            <Button id="upgrade-prompt-dismiss" variant="secondary" onClick={onClose}>
              Not now
            </Button>
            <Button
              id="upgrade-prompt-upgrade"
              onClick={() => {
                onClose()
                navigate(SETTINGS_PATHS.billing)
              }}
            >
              Upgrade
              <ArrowRight className="rtl:rotate-180" aria-hidden />
            </Button>
          </>
        ) : (
          <Button id="upgrade-prompt-dismiss" onClick={onClose}>
            OK
          </Button>
        )
      }
    >
      <div
        id="upgrade-prompt"
        data-kind={prompt?.kind}
        data-limit={prompt?.kind === 'limit' ? prompt.details.limit : undefined}
        data-module={prompt?.kind === 'module' ? prompt.details.module : undefined}
        className="space-y-3"
      >
        {prompt?.kind === 'limit' && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3">
            <Gauge className="size-4 shrink-0 text-danger-600 dark:text-danger-500" aria-hidden />
            <p className="text-[0.8125rem] text-ink" id="upgrade-prompt-usage">
              <span className="num font-semibold">{formatLimitValue(prompt.details.limit, prompt.details.current)}</span>
              {' of '}
              <span className="num font-semibold">{formatLimitValue(prompt.details.limit, prompt.details.max)}</span>{' '}
              {(LIMIT_LABEL[prompt.details.limit] ?? prompt.details.limit).toLowerCase()}
            </p>
          </div>
        )}
        {prompt?.kind === 'module' && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3">
            <Lock className="size-4 shrink-0 text-muted" aria-hidden />
            <p className="text-[0.8125rem] text-ink">{PLAN_MODULE_LABEL[prompt.details.module] ?? prompt.details.module}</p>
          </div>
        )}
        {suggestion && <p className="text-[0.8125rem] text-muted">{suggestion}</p>}
        {!canManage && (
          <p className="text-[0.8125rem] text-muted" id="upgrade-prompt-ask-admin">
            Ask your company administrator to upgrade the plan.
          </p>
        )}
      </div>
    </Modal>
  )
}
