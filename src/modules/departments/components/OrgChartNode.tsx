import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Crown, Users } from 'lucide-react'
import type { OrgNode } from '@/modules/departments/types'
import { departmentPath } from '@/app/paths'
import { cn } from '@/shared/lib/utils'
import { Avatar } from '@/shared/components/ui/Avatar'
import { Badge } from '@/shared/components/ui/Badge'

interface OrgChartNodeProps {
  node: OrgNode
  /** Direct children (in the current view). */
  childCount: number
  /** All levels under this node (shown on the toggle when collapsed). */
  descendantCount: number
  collapsed: boolean
  onToggle: () => void
  /** Matches the search query. */
  matched: boolean
  /** The search result currently centred. */
  current: boolean
}

/**
 * One department card: name, head (highlighted), member count, and a branch toggle under it.
 * The card is a link (click / Enter opens the department); the toggle is a separate button so
 * both are reachable with Tab.
 */
export function OrgChartNode({ node, childCount, descendantCount, collapsed, onToggle, matched, current }: OrgChartNodeProps) {
  return (
    <div className="flex flex-col items-center">
      <CardShell
        node={node}
        label={`${node.name}${node.active ? '' : ' (inactive)'}${node.context ? ' (outside your team)' : ''}. Head: ${node.head?.name ?? 'none'}. ${node.memberCount} ${node.memberCount === 1 ? 'member' : 'members'}.`}
        className={cn(
          'oc-card group relative block w-60 rounded-xl border bg-surface p-3 text-start shadow-xs transition-[box-shadow,border-color,opacity] duration-150',
          'hover:border-brand-300 hover:shadow-pop focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none dark:hover:border-brand-500/50',
          node.active ? 'border-line-strong' : 'border-dashed border-line-strong opacity-70',
          matched && 'ring-2 ring-warning-500/60',
          current && 'ring-[0.1875rem] ring-warning-500',
        )}
      >
        <span aria-hidden className={cn('absolute inset-x-3 top-0 h-[0.1875rem] rounded-b-full', node.active ? 'bg-brand-500' : 'bg-line-strong')} />
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.875rem] leading-snug font-semibold text-ink group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {node.name}
          </span>
          {!node.active && (
            <Badge tone="neutral" variant="outline" className="shrink-0">
              Inactive
            </Badge>
          )}
        </span>

        {node.head ? (
          <span className="mt-2.5 flex items-center gap-2.5 rounded-lg bg-brand-50/70 p-1.5 dark:bg-brand-500/10">
            <span className="relative shrink-0">
              <Avatar name={node.head.name} size="md" className="ring-2 ring-brand-500 ring-offset-1 ring-offset-surface" />
              <Crown aria-hidden className="absolute -end-1 -top-1.5 size-3.5 rounded-full bg-surface p-0.5 text-warning-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[0.8125rem] font-medium text-ink">{node.head.name}</span>
                <span className="shrink-0 rounded px-1 text-[0.625rem] font-semibold tracking-wide text-brand-700 uppercase ring-1 ring-brand-200 ring-inset dark:text-brand-300 dark:ring-brand-500/30">
                  Head
                </span>
              </span>
              <span className="block truncate text-xs text-muted">{node.head.title || '—'}</span>
            </span>
          </span>
        ) : (
          <span className="mt-2.5 flex items-center gap-2.5 rounded-lg border border-dashed border-line p-1.5">
            <span aria-hidden className="size-8 shrink-0 rounded-full border border-dashed border-line-strong" />
            <span className="text-[0.8125rem] text-muted">No head assigned</span>
          </span>
        )}

        <span className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
          <Users aria-hidden className="size-3.5" />
          <span className="num font-medium text-ink-2">{node.memberCount}</span>
          {node.memberCount === 1 ? 'member' : 'members'}
          {childCount > 0 && (
            <span className="ms-auto">
              {childCount} {childCount === 1 ? 'sub-dept' : 'sub-depts'}
            </span>
          )}
        </span>
      </CardShell>

      {childCount > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${node.name} (${descendantCount} ${descendantCount === 1 ? 'sub-department' : 'sub-departments'})`}
          className={cn(
            'oc-toggle relative z-10 -mt-[0.0625rem] flex h-6 items-center gap-1 rounded-full border border-line-strong bg-surface px-2 text-[0.6875rem] font-medium text-muted shadow-xs transition-colors',
            'hover:bg-hover hover:text-ink focus-visible:border-brand-500 focus-visible:shadow-[var(--shadow-focus)] focus-visible:outline-none',
            'print:hidden',
          )}
        >
          {collapsed ? (
            <>
              <ChevronDown aria-hidden className="size-3.5" />
              <span className="num">+{descendantCount}</span>
            </>
          ) : (
            <ChevronUp aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  )
}

/**
 * The card wrapper: a link to the department page, or (for context-only ancestors the viewer
 * can't open) a plain, non-interactive card with a hint, so clicks never lead to a 403.
 */
function CardShell({ node, label, className, children }: { node: OrgNode; label: string; className: string; children: React.ReactNode }) {
  if (node.context) {
    return (
      <div data-oc-id={node.id} aria-label={label} title="Outside your team" className={cn(className, 'cursor-default hover:border-line-strong hover:shadow-xs')}>
        {children}
      </div>
    )
  }
  return (
    <Link to={departmentPath(node.id)} draggable={false} data-oc-id={node.id} aria-label={label} className={className}>
      {children}
    </Link>
  )
}
