import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, Columns3, Download, FileText, List, Plus, ShieldOff, Upload, Users, Zap } from 'lucide-react'
import type { Scope } from '@/shared/types'
import { PATHS } from '@/app/paths'
import { can, SCOPE_LABELS } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useAppDispatch, useCurrentUser } from '@/store/hooks'
import { quickAddLeadSet } from '@/store/uiSlice'
import { Badge } from '@/shared/components/ui/Badge'
import { Button } from '@/shared/components/ui/Button'
import { Tooltip } from '@/shared/components/ui/Kbd'
import { Menu, MenuItem } from '@/shared/components/ui/Menu'
import { IconTile, PageHeader } from '@/shared/components/layout/PageHeader'

/** Title, scope, List/Board tabs and actions; shared by the list and the board. */
export function LeadsHeader({ count, scope }: { count: number | undefined; scope: Scope }) {
  const user = useCurrentUser()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const canCreate = !!user && can(user.role, 'sales', 'create')

  return (
    <>
      <PageHeader
        icon={
          <IconTile>
            <Users />
          </IconTile>
        }
        title="Leads"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{count === undefined ? 'Loading…' : `${count} leads`}</span>
            <span aria-hidden>·</span>
            <span>{SCOPE_LABELS[scope]}</span>
            {scope === 'view' && (
              <Badge tone="amber" icon={<ShieldOff />}>
                Read only
              </Badge>
            )}
          </span>
        }
        actions={
          <>
            {canCreate && (
              <Link to={PATHS.leadImport}>
                <Button write variant="secondary" size="sm" tabIndex={-1}>
                  <Upload />
                  Import
                </Button>
              </Link>
            )}
            <Tooltip label="Export: coming next">
              <Button variant="secondary" size="sm" iconOnly aria-label="Export" disabled>
                <Download />
              </Button>
            </Tooltip>
            {canCreate && (
              <div className="flex items-center">
                <Button write size="sm" className="rounded-e-none" onClick={() => dispatch(quickAddLeadSet(true))}>
                  <Plus />
                  New lead
                </Button>
                <Menu
                  trigger={(props) => (
                    <Button write
                      size="sm"
                      iconOnly
                      aria-label="More ways to add a lead"
                      className="rounded-s-none border-s border-white/20"
                      {...props}
                    >
                      <ChevronDown />
                    </Button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<Zap />}
                        hint="Few fields"
                        onSelect={() => {
                          close()
                          dispatch(quickAddLeadSet(true))
                        }}
                      >
                        Quick add
                      </MenuItem>
                      <MenuItem
                        icon={<FileText />}
                        hint="All fields"
                        onSelect={() => {
                          close()
                          navigate(PATHS.leadNew)
                        }}
                      >
                        Full form
                      </MenuItem>
                      <MenuItem
                        icon={<Upload />}
                        hint=".xlsx / .csv"
                        onSelect={() => {
                          close()
                          navigate(PATHS.leadImport)
                        }}
                      >
                        Import from Excel
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            )}
          </>
        }
      >
        <nav aria-label="Leads view" className="-mb-px flex gap-5">
          <ViewTab to={PATHS.leads} label="All leads" icon={<List />} />
          <ViewTab to={PATHS.pipeline} label="Pipeline" icon={<Columns3 />} />
        </nav>
      </PageHeader>
    </>
  )
}

function ViewTab({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'inline-flex h-10 items-center gap-1.5 border-b-2 text-[0.8125rem] font-medium transition-colors [&_svg]:size-3.5',
          isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
