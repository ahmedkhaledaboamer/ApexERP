import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Eye, Rocket, Upload, X } from 'lucide-react'
import type { OnboardingItem } from '@/modules/signup/types'
import { signupKeys, useOnboarding, useOnboardingMutations } from '@/modules/signup/api'
import { canEditCompanyProfile, canViewCompanyProfile } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { PATHS } from '@/app/paths'
import { useCurrentUser } from '@/store/hooks'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { useToast } from '@/shared/components/ui/Toast'
import { ConnectEmailDialog } from '@/modules/onboarding/ConnectEmailDialog'

/** Query key of GET /onboarding; invalidate it after anything that can complete a step. */
export const onboardingKeys = { status: signupKeys.onboarding }

const LINK = 'inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-medium text-brand-600 hover:underline dark:text-brand-300'

/**
 * Getting-started checklist on the Dashboard for a new company. Progress and dismissal are stored
 * per company on the server, so every admin sees the same state. Company Admin works through it
 * (and can hide or restore it); Management sees it read-only; other roles don't see it.
 */
export function OnboardingChecklist({ className }: { className?: string }) {
  const user = useCurrentUser()
  const allowed = !!user && canViewCompanyProfile(user.role)
  const canAct = !!user && canEditCompanyProfile(user.role)
  const query = useOnboarding(allowed)
  const { markItem, dismiss } = useOnboardingMutations()
  const toast = useToast()
  const [emailOpen, setEmailOpen] = useState(false)
  const closeEmail = useCallback(() => setEmailOpen(false), [])

  if (!allowed || !query.data || query.data.complete) return null
  const { items, done, total, dismissed } = query.data
  const pct = total ? Math.round((done / total) * 100) : 0

  function setDismissed(value: boolean) {
    dismiss.mutate(value, { onError: (e) => toast.error('Couldn’t update the checklist', e.message) })
  }

  if (dismissed) {
    if (!canAct) return null
    return (
      <div className={cn('flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted print:hidden', className)}>
        <Rocket className="size-4" aria-hidden />
        <span>
          Setup checklist hidden · {done} of {total} done
        </span>
        <button type="button" onClick={() => setDismissed(false)} disabled={dismiss.isPending} className={LINK}>
          Show it
        </button>
      </div>
    )
  }

  function actionsFor(item: OnboardingItem): ReactNode {
    if (!canAct) {
      // Connect email is a dialog (no page of its own yet).
      return item.done || item.id === 'email' ? null : (
        <Link to={item.href} className={LINK}>
          <Eye className="size-3.5" aria-hidden />
          View
        </Link>
      )
    }
    if (item.done) {
      return item.manual && item.id !== 'email' ? (
        <button
          type="button"
          className="text-xs text-muted hover:text-ink hover:underline"
          disabled={markItem.isPending}
          onClick={() => markItem.mutate({ id: item.id, done: false })}
        >
          Undo
        </button>
      ) : null
    }
    switch (item.id) {
      case 'email':
        return (
          <Button write size="xs" variant="secondary" onClick={() => setEmailOpen(true)}>
            Connect email
          </Button>
        )
      case 'lists':
        return (
          <>
            <Link to={item.href} className={LINK}>
              Lists
            </Link>
            <Link to="/settings/automation" className={LINK}>
              Automation
            </Link>
            <Button write
              size="xs"
              variant="secondary"
              loading={markItem.isPending && markItem.variables?.id === item.id}
              onClick={() =>
                markItem.mutate({ id: item.id, done: true }, { onError: (e) => toast.error('Couldn’t mark it done', e.message) })
              }
            >
              <Check aria-hidden />
              Mark as done
            </Button>
          </>
        )
      case 'leads':
        return (
          <>
            <Link to={PATHS.leadImport} className={LINK}>
              <Upload className="size-3.5" aria-hidden />
              Import
            </Link>
            <Link to={item.href} className={LINK}>
              Add a lead
              <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
            </Link>
          </>
        )
      default:
        return (
          <Link to={item.href} className={LINK}>
            Start
            <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        )
    }
  }

  return (
    <Card className={cn('print:hidden', className)}>
      <CardHeader
        icon={<Rocket />}
        title="Get your workspace ready"
        description={
          canAct ? `${done} of ${total} steps done.` : `${done} of ${total} steps done. Your Company Admin completes these steps.`
        }
        action={
          canAct && (
            <Button write
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Hide the setup checklist"
              title="Hide for everyone in the company (you can show it again)"
              loading={dismiss.isPending}
              onClick={() => setDismissed(true)}
            >
              <X />
            </Button>
          )
        }
      />
      <CardBody>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <ul className="mt-4 divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5 sm:flex-nowrap">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  item.done ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong',
                )}
              >
                {item.done && <Check className="size-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-[0.8125rem] font-medium', item.done ? 'text-muted line-through' : 'text-ink')}>
                  {item.title}
                  <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
                </p>
                <p className="text-xs text-muted">{item.description}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 ps-8 sm:ps-0">{actionsFor(item)}</div>
            </li>
          ))}
        </ul>
      </CardBody>
      {canAct && <ConnectEmailDialog open={emailOpen} onClose={closeEmail} />}
    </Card>
  )
}
