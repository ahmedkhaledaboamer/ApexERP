import { type ReactNode } from 'react'
import type { ModuleKey, Scope } from '@/shared/types'
import { scopeOf } from '@/shared/lib/permissions'
import { useCurrentUser } from '@/store/hooks'

interface ScopeGateProps {
  module: ModuleKey
  /** Scopes allowed to see the children, e.g. ['full', 'team'] for manager-only views. */
  allow: Scope[]
  children: ReactNode
  fallback?: ReactNode
}

/** Renders children only when the current role's data scope on `module` is one of `allow`. */
export function ScopeGate({ module, allow, children, fallback = null }: ScopeGateProps) {
  const user = useCurrentUser()
  return <>{user && allow.includes(scopeOf(user.role, module)) ? children : fallback}</>
}
