import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, Hammer } from 'lucide-react'
import { PATHS } from '@/app/paths'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { PageBody, PageHeader } from './PageHeader'
import { navMatch } from './navigation'

const PHASE_TEXT = {
  1: 'Phase 1 (core): being built now',
  2: 'Phase 2: after the core is live',
  3: 'Phase 3: full financial cycle and deeper integrations',
} as const

/** Placeholder for screens in the spec that aren't built yet; shows what they will do. */
export function ComingSoonPage() {
  const { pathname } = useLocation()
  const match = navMatch(pathname)
  const item = match?.item
  const Icon = item?.icon ?? Hammer

  return (
    <>
      <PageHeader title={item?.label ?? 'Not found'} description={match?.section?.label} />
      <PageBody>
        <div className="flex flex-col items-center rounded-card border border-line bg-surface px-6 py-16 text-center shadow-xs">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <Icon className="size-7" aria-hidden />
          </span>
          {item?.phase && (
            <Badge tone={item.phase === 1 ? 'brand' : 'neutral'} className="mt-5">
              {PHASE_TEXT[item.phase]}
            </Badge>
          )}
          <h2 className="mt-3 text-lg font-semibold">{item ? `${item.label} is on its way` : 'This page doesn’t exist'}</h2>
          <p className="mt-2 max-w-lg text-[0.875rem] text-muted">
            {item?.description ?? 'Check the link or use the sidebar to find what you need.'}
          </p>
          <Link to={PATHS.dashboard} className="mt-6">
            <Button variant="secondary" tabIndex={-1}>
              <ArrowLeft />
              Back to dashboard
            </Button>
          </Link>
        </div>
      </PageBody>
    </>
  )
}
