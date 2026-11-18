import { Lock } from 'lucide-react'
import { useCurrentUser } from '@/store/hooks'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { PageBody } from '@/shared/components/layout/PageHeader'

/** A role whose Marketing column is "hidden" (the route guard normally redirects before this shows). */
export function NoMarketingAccess({ what = 'Marketing' }: { what?: string }) {
  const user = useCurrentUser()
  return (
    <PageBody>
      <EmptyState
        icon={<Lock aria-hidden />}
        title={`${what} isn’t part of your role`}
        body={`${user?.role ?? 'Your role'} has no access to ${what}. Ask a Company Admin if you need it.`}
      />
    </PageBody>
  )
}
