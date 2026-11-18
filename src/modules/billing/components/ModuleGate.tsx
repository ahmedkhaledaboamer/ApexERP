import type { ReactNode } from 'react'
import type { PlanModule } from '@/modules/billing/types'
import { useEntitlements } from '@/modules/billing/hooks'
import { ModuleNotIncluded } from '@/modules/tenancy/components/ModuleNotIncluded'
import { PageBody } from '@/shared/components/layout/PageHeader'
import { Skeleton } from '@/shared/components/ui/Feedback'

/**
 * Renders `children` only when the plan includes `module`; otherwise the upgrade page (or
 * `fallback`, e.g. `null` to hide an inline feature). AI features: `<ModuleGate module="ai">`.
 */
export function ModuleGate({ module, children, fallback }: { module: PlanModule; children: ReactNode; fallback?: ReactNode }) {
  const ent = useEntitlements()
  if (ent.hasModule(module)) return <>{children}</>
  if (ent.loading) return fallback === undefined ? <GateSkeleton /> : <>{fallback}</>
  return fallback === undefined ? <ModuleNotIncluded module={module} /> : <>{fallback}</>
}

export function GateSkeleton() {
  return (
    <PageBody>
      <Skeleton className="h-40 rounded-card" />
    </PageBody>
  )
}
