import { Trophy } from 'lucide-react'
import type { EventDetail } from '@/modules/events/types'
import { useLeaderboardQuery } from '@/modules/events/hooks/useEventsAdvanced'
import { moneyIn } from '@/modules/events/components/eventMeta'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Card, CardHeader } from '@/shared/components/ui/Card'
import { Skeleton } from '@/shared/components/ui/Feedback'

/** Booth capture leaderboard: captures, hot leads and deals later won, per team member. */
export function LeaderboardCard({ event: e }: { event: EventDetail }) {
  const q = useLeaderboardQuery(e.id)
  return (
    <Card>
      <CardHeader title="Booth leaderboard" icon={<Trophy />} description="Leads captured at the stand per team member, and the deals they later won." />
      {q.isPending ? (
        <div className="p-5"><Skeleton className="h-20" /></div>
      ) : (
        <table className="w-full text-[0.8125rem]" aria-label="Leaderboard">
          <thead className="border-y border-line bg-sunken/50 text-xs text-muted">
            <tr>
              <th className="px-5 py-2 text-start font-medium">Team member</th>
              <th className="px-3 py-2 text-end font-medium">Captures</th>
              <th className="px-3 py-2 text-end font-medium">Hot</th>
              <th className="px-3 py-2 text-end font-medium">Deals won</th>
              <th className="px-5 py-2 text-end font-medium">Won value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(q.data ?? []).map((r, i) => (
              <tr key={r.userId}>
                <td className="px-5 py-2">
                  <span className="flex items-center gap-2">
                    <span className="num w-4 text-xs text-muted">{i + 1}</span>
                    <Avatar name={r.name} size="xs" />
                    {r.name}
                  </span>
                </td>
                <td className="num px-3 py-2 text-end">{r.captures}</td>
                <td className="num px-3 py-2 text-end">{r.hotLeads}</td>
                <td className="num px-3 py-2 text-end">{r.dealsWon}</td>
                <td className="num px-5 py-2 text-end">{moneyIn(r.wonValue, e.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
