import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Hourglass, Users } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Card, CardBody, CardHeader } from '@/shared/components/ui/Card'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { fmtHours, ProgressBar, TaskStatusBadge, useOpenTask, type ProjectDetail } from './projectUi'

/** Chart colours (SVG can't read Tailwind classes): estimate recessive, logged in the brand hue. */
const EST = '#a1a1aa'
const LOGGED = 'var(--color-brand-600)'
const AXIS_TICK = { fill: '#8e8e99', fontSize: '0.75rem' }
const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-line)',
  borderRadius: 10,
  color: 'var(--color-ink)',
  fontSize: '0.75rem',
  boxShadow: 'var(--shadow-pop)',
}

interface PersonRow {
  name: string
  tasks: number
  estimated: number
  logged: number
}

/** Project › Hours: estimated vs logged, per person (chart + table) and per task. */
export function ProjectHours({ project: p }: { project: ProjectDetail }) {
  const openTask = useOpenTask()
  const people = useMemo(() => {
    const map = new Map<string, PersonRow>()
    for (const t of p.tasks) {
      const row = map.get(t.ownerId) ?? { name: t.ownerName, tasks: 0, estimated: 0, logged: 0 }
      row.tasks += 1
      row.estimated += t.estimatedHours
      row.logged += t.loggedHours
      map.set(t.ownerId, row)
    }
    return [...map.values()].sort((a, b) => b.estimated - a.estimated)
  }, [p.tasks])

  const taskEstimate = p.tasks.reduce((s, t) => s + t.estimatedHours, 0)
  const budget = p.estimatedHours || taskEstimate
  const pct = budget ? Math.round((p.loggedHours / budget) * 100) : 0

  if (!p.tasks.length) {
    return (
      <Card>
        <EmptyState icon={<Hourglass aria-hidden />} title="No hours yet" body="Hours are logged on the project’s tasks." />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <section aria-label="Hour totals" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Total label="Project estimate" value={fmtHours(p.estimatedHours)} hint={`Tasks add up to ${fmtHours(taskEstimate)}`} />
        <Total label="Logged" value={fmtHours(p.loggedHours)} hint={`${pct}% of the estimate`} alert={pct > 100} />
        <Total label="Remaining" value={fmtHours(Math.max(0, budget - p.loggedHours))} hint={pct > 100 ? `${fmtHours(p.loggedHours - budget)} over` : 'to the estimate'} />
      </section>

      <Card>
        <CardHeader
          title="By person"
          icon={<Users />}
          description="Estimated vs logged hours on their tasks"
          action={
            <span className="flex items-center gap-3 text-xs text-ink-2">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: EST }} aria-hidden />
                Estimated
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: LOGGED }} aria-hidden />
                Logged
              </span>
            </span>
          }
        />
        <CardBody className="space-y-4">
          <div dir="ltr" style={{ height: `${Math.max(8, people.length * 3.25 + 2)}rem` }} className="text-ink">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={people} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 4" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(v: number) => `${v} h`} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ ...AXIS_TICK, fill: 'var(--color-ink-2)' }} />
                <Tooltip cursor={{ fill: 'currentColor', fillOpacity: 0.04 }} contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmtHours(v), name]} />
                <Bar dataKey="estimated" name="Estimated" fill={EST} radius={[0, 4, 4, 0]} maxBarSize={12} />
                <Bar dataKey="logged" name="Logged" fill={LOGGED} radius={[0, 4, 4, 0]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[0.8125rem]">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-2 pe-3 text-start font-medium">Person</th>
                  <th className="px-3 py-2 text-end font-medium">Tasks</th>
                  <th className="px-3 py-2 text-end font-medium">Estimated</th>
                  <th className="px-3 py-2 text-end font-medium">Logged</th>
                  <th className="py-2 ps-3 text-start font-medium">Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {people.map((r) => (
                  <tr key={r.name}>
                    <td className="py-2 pe-3">
                      <span className="flex items-center gap-2 text-ink">
                        <Avatar name={r.name} size="xs" />
                        {r.name}
                      </span>
                    </td>
                    <td className="num px-3 py-2 text-end text-ink-2">{r.tasks}</td>
                    <td className="num px-3 py-2 text-end text-ink-2">{fmtHours(r.estimated)}</td>
                    <td className={cn('num px-3 py-2 text-end', r.estimated && r.logged > r.estimated ? 'text-danger-600' : 'text-ink')}>{fmtHours(r.logged)}</td>
                    <td className="w-40 py-2 ps-3">
                      <ProgressBar value={r.estimated ? (r.logged / r.estimated) * 100 : 0} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="By task" icon={<Hourglass />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[0.8125rem]">
            <thead>
              <tr className="border-y border-line text-xs text-muted">
                <th className="px-5 py-2 text-start font-medium">Task</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-end font-medium">Estimated</th>
                <th className="px-3 py-2 text-end font-medium">Logged</th>
                <th className="px-5 py-2 text-start font-medium">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {p.tasks.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-hover/60" onClick={() => openTask(t.id)}>
                  <td className="max-w-[20rem] px-5 py-2">
                    <p className="truncate text-ink">{t.title}</p>
                    <p className="truncate text-xs text-muted">{t.ownerName}</p>
                  </td>
                  <td className="px-3 py-2">
                    <TaskStatusBadge status={t.status} />
                  </td>
                  <td className="num px-3 py-2 text-end text-ink-2">{fmtHours(t.estimatedHours)}</td>
                  <td className={cn('num px-3 py-2 text-end', t.estimatedHours && t.loggedHours > t.estimatedHours ? 'text-danger-600' : 'text-ink')}>{fmtHours(t.loggedHours)}</td>
                  <td className="w-40 px-5 py-2">
                    <ProgressBar value={t.estimatedHours ? (t.loggedHours / t.estimatedHours) * 100 : 0} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-medium">
                <td className="px-5 py-2 text-ink" colSpan={2}>
                  Total
                </td>
                <td className="num px-3 py-2 text-end text-ink">{fmtHours(taskEstimate)}</td>
                <td className="num px-3 py-2 text-end text-ink">{fmtHours(p.loggedHours)}</td>
                <td className="px-5 py-2">
                  <ProgressBar value={taskEstimate ? (p.loggedHours / taskEstimate) * 100 : 0} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Total({ label, value, hint, alert }: { label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[0.8125rem] text-ink-2">{label}</p>
      <p className={cn('num mt-2 text-2xl leading-none font-bold tracking-[-0.02em]', alert ? 'text-danger-600' : 'text-ink')}>{value}</p>
      <p className="mt-2 text-xs text-muted">{hint}</p>
    </Card>
  )
}
