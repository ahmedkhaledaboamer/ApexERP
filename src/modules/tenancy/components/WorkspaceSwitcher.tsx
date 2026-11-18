import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftRight, Check, ChevronDown } from 'lucide-react'
import type { Branding } from '@/modules/tenancy/types'
import { PATHS } from '@/app/paths'
import { devSignInAs, getDevAccounts } from '@/modules/tenancy/api'
import { DEV_MOCK_PERSISTENCE, DEV_TENANT_TOOLS } from '@/modules/tenancy/dev'
import { DevDataSection, ResetDemoDataModal } from '@/modules/tenancy/components/DevDataTools'
import { useTenant } from '@/modules/tenancy/hooks'
import { logoFor } from '@/modules/tenancy/branding'
import { setWorkspace } from '@/shared/lib/tenantContext'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useAppSelector, useCurrentUser } from '@/store/hooks'
import { signedIn } from '@/store/authSlice'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/shared/components/ui/Menu'
import { useToast } from '@/shared/components/ui/Toast'

type TriggerProps = Parameters<Parameters<typeof Menu>[0]['trigger']>[0]

/**
 * The company's mark: its logo for the current theme (Settings › Branding) on a small tile, else the
 * monogram in its brand colour (600 step).
 */
export function CompanyMark({
  branding,
  size = 'sm',
}: {
  branding: Pick<Branding, 'monogram' | 'palette' | 'logoUrl' | 'logoDarkUrl'>
  size?: 'xs' | 'sm'
}) {
  const theme = useAppSelector((s) => s.ui.theme)
  const logo = logoFor(branding, theme)
  const box = size === 'xs' ? 'size-5' : 'size-6'
  if (logo) {
    return (
      <span aria-hidden className={cn(box, 'inline-grid shrink-0 place-items-center overflow-hidden rounded-md')}>
        <img src={logo} alt="" data-company-mark="logo" className="max-h-full max-w-full object-contain" />
      </span>
    )
  }
  return (
    <span
      aria-hidden
      data-company-mark="monogram"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-md font-semibold text-white',
        box,
        size === 'xs' ? 'text-[0.5625rem]' : 'text-[0.625rem]',
      )}
      style={{ backgroundColor: branding.palette['600'] }}
    >
      {branding.monogram.slice(0, 2)}
    </span>
  )
}

/**
 * Header chip naming the current workspace. In dev (mock API) it opens the tenant switcher:
 * every seeded account grouped by company; picking one signs in as that user in their workspace.
 */
export function WorkspaceSwitcher() {
  const tenant = useTenant()
  const user = useCurrentUser()
  const signIn = useDevSignIn()
  const [resetOpen, setResetOpen] = useState(false)
  if (!tenant) return null

  const chip = (props?: TriggerProps) => (
    <button
      type="button"
      {...props}
      disabled={!props}
      title={DEV_TENANT_TOOLS ? 'Switch workspace (dev)' : tenant.branding.displayName}
      id="workspace-switcher"
      className="flex h-9 max-w-[14rem] items-center gap-2 rounded-lg border border-line bg-surface ps-1.5 pe-2.5 text-[0.8125rem] font-medium text-ink-2 shadow-xs transition-colors enabled:hover:border-line-strong enabled:hover:bg-hover disabled:cursor-default"
    >
      <CompanyMark branding={tenant.branding} />
      <span className="hidden truncate sm:inline">{tenant.branding.displayName}</span>
      {DEV_TENANT_TOOLS && <ChevronDown className="size-3.5 shrink-0 text-subtle" aria-hidden />}
    </button>
  )

  if (!DEV_TENANT_TOOLS) return chip()
  return (
    <>
      <Menu className="w-80" align="end" trigger={(props) => chip(props)}>
        {(close) => (
          <>
            <DevAccounts
              currentUserId={user?.id}
              onPick={(id) => {
                close()
                if (id !== user?.id) signIn.mutate(id)
              }}
            />
            {DEV_MOCK_PERSISTENCE && (
              <>
                <MenuSeparator />
                <DevDataSection
                  onReset={() => {
                    close()
                    setResetOpen(true)
                  }}
                />
              </>
            )}
          </>
        )}
      </Menu>
      {DEV_MOCK_PERSISTENCE && <ResetDemoDataModal open={resetOpen} onClose={() => setResetOpen(false)} />}
    </>
  )
}

/** Dev sign-in as any seeded account: the workspace address follows the account. */
export function useDevSignIn() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const toast = useToast()
  return useMutation({
    mutationFn: devSignInAs,
    onSuccess: (session) => {
      // sessionTransitions clears the query cache, tenant storage and tenant state.
      setWorkspace(session.tenant.subdomain)
      dispatch(signedIn(session))
      navigate(PATHS.dashboard, { replace: true })
      toast.info(`Signed in to ${session.tenant.branding.displayName}`, `${session.user.name} · ${session.user.role}`)
    },
    onError: (e: Error) => toast.error('Couldn’t switch workspace', e.message),
  })
}

function DevAccounts({ currentUserId, onPick }: { currentUserId?: string; onPick: (userId: string) => void }) {
  const accounts = useQuery({ queryKey: ['dev-accounts'], queryFn: getDevAccounts, staleTime: 60_000 })

  return (
    <>
      <MenuLabel>Dev: switch workspace and user</MenuLabel>
      <div className="max-h-[26rem] overflow-y-auto">
        {accounts.isPending && <p className="px-2 py-3 text-[0.8125rem] text-muted">Loading accounts…</p>}
        {accounts.isError && <p className="px-2 py-3 text-[0.8125rem] text-danger-600">{accounts.error.message}</p>}
        {accounts.data?.map((group, gi) => (
          <div key={group.company.id}>
            {gi > 0 && <MenuSeparator />}
            <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
              <CompanyMark branding={group.company.branding} size="xs" />
              <span className="truncate text-[0.8125rem] font-semibold text-ink">{group.company.branding.displayName}</span>
              <span className="ms-auto font-mono text-[0.6875rem] text-subtle">{group.company.subdomain}</span>
            </div>
            {group.users.map((u) => {
              const current = u.id === currentUserId
              return (
                <MenuItem
                  key={u.id}
                  active={current}
                  icon={current ? <Check /> : <ArrowLeftRight className="opacity-40" />}
                  hint={u.role}
                  onSelect={() => onPick(u.id)}
                >
                  {u.name}
                </MenuItem>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
