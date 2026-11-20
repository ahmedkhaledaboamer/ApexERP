import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useContentQuery, useCreativeAccess } from '@/modules/marketing/creative/hooks'
import { contentItemPath } from '@/modules/marketing/paths'
import { fmtDate } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState, Skeleton } from '@/shared/components/ui/Feedback'
import { ChannelChips, ContentStatusBadge } from './badges'
import { ContentForm } from './ContentForm'

/** Campaign page › Content: the campaign's content items (GET /marketing/content?campaign_id=). */
export function CampaignContentPanel({ campaignId }: { campaignId: string }) {
  const { canEdit, user } = useCreativeAccess()
  const navigate = useNavigate()
  const query = useContentQuery({ campaignId })
  const [creating, setCreating] = useState(false)
  const items = query.data ?? []
  return (
    <Card>
      <CardHeader
        title="Content"
        description="Posts, articles and newsletters planned for this campaign."
        action={
          canEdit && (
            <Button write size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus />
              New content
            </Button>
          )
        }
      />
      <CardBody>
        {query.isPending ? (
          <Skeleton className="h-24" />
        ) : items.length === 0 ? (
          <EmptyState title="No content yet" body="Plan content for this campaign in the content calendar." />
        ) : (
          <ul aria-label="Campaign content" className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => navigate(contentItemPath(c.id))} className="flex w-full items-center justify-between gap-3 py-2.5 text-start text-[0.8125rem] hover:bg-hover">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-medium text-ink">{c.title}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {c.publishLocal ? fmtDate(c.publishLocal, 'd MMM, HH:mm') : 'Not planned'}
                      <ChannelChips channels={c.channels} />
                    </p>
                  </div>
                  <ContentStatusBadge status={c.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ContentForm open={creating} onClose={() => setCreating(false)} item={null} currentUserId={user.id} defaultCampaignId={campaignId} />
    </Card>
  )
}
