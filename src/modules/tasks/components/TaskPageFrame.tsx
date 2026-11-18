import type { ReactNode } from 'react'
import { ListTodo } from 'lucide-react'
import { SCOPE_LABELS } from '@/shared/lib/permissions'
import { EmptyState } from '@/shared/components/ui/Feedback'
import { IconTile, PageBody, PageHeader } from '@/shared/components/layout/PageHeader'
import { TaskViewSwitch } from './TaskViewSwitch'
import { useTaskPermissions } from './useTaskActions'

/** Header (title, scope, view switch) and the no-access state shared by the task views. */
export function TaskPageFrame({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const { user, scope, canView } = useTaskPermissions()
  if (!user) return null
  if (!canView) {
    return (
      <PageBody>
        <EmptyState title="Tasks aren’t part of your role" body={`${user.role} has no access to Tasks. Ask a Company Admin if you need it.`} />
      </PageBody>
    )
  }
  return (
    <>
      <PageHeader
        icon={<IconTile>{icon ?? <ListTodo />}</IconTile>}
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {description}
            {description && <span aria-hidden>·</span>}
            <span>{SCOPE_LABELS[scope]}</span>
          </span>
        }
        actions={
          <>
            {actions}
            <TaskViewSwitch />
          </>
        }
      />
      {children}
    </>
  )
}
