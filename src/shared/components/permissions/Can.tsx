import { type ReactNode } from 'react'
import type { Action, ModuleKey } from '@/shared/types'
import { can } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

interface CanProps {
  module: ModuleKey
  action: Action
  children: ReactNode
  fallback?: ReactNode
}

/** Renders children only if the current role may perform `action` on `module`. */
export function Can({ module, action, children, fallback = null }: CanProps) {
  const user = useCurrentUser()
  return <>{user && can(user.role, module, action) ? children : fallback}</>
}
