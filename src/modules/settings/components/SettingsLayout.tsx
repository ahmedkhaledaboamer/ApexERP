import { NavLink, Outlet } from 'react-router-dom'
import { Bot, Building2, CreditCard, FileText, History, ListChecks, Lock, Palette, ShieldCheck, Target, Users, type LucideIcon } from 'lucide-react'
import { can } from '@/shared/lib/permissions'
import { cn } from '@/shared/lib/utils'
import { useCurrentUser } from '@/store/hooks'
import { Badge } from '@/shared/components/ui/Badge'
import { PageBody, PageHeader } from '@/shared/components/layout/PageHeader'

export const SETTINGS_PATHS = {
  root: '/settings',
  users: '/settings/users',
  companyProfile: '/settings/company-profile',
  branding: '/settings/branding',
  lists: '/settings/lists',
  templates: '/settings/templates',
  targets: '/settings/targets',
  automation: '/settings/automation',
  security: '/settings/security',
  audit: '/settings/audit-log',
  billing: '/settings/billing',
} as const

const SECTIONS: { to: string; label: string; icon: LucideIcon; hint: string }[] = [
  { to: SETTINGS_PATHS.companyProfile, label: 'Company profile', icon: Building2, hint: 'Legal name, address, tax number, bank' },
  { to: SETTINGS_PATHS.branding, label: 'Branding', icon: Palette, hint: 'Logo, favicon and brand colour' },
  { to: SETTINGS_PATHS.users, label: 'Users & roles', icon: Users, hint: 'Who can sign in and what they see' },
  { to: SETTINGS_PATHS.lists, label: 'Fixed lists', icon: ListChecks, hint: 'Statuses, sources, industries, reasons, tags' },
  { to: SETTINGS_PATHS.templates, label: 'Templates', icon: FileText, hint: 'Emails, quotations, WhatsApp' },
  { to: SETTINGS_PATHS.targets, label: 'Targets', icon: Target, hint: 'Monthly activity targets per agent' },
  { to: SETTINGS_PATHS.automation, label: 'Automation', icon: Bot, hint: 'Reminders, Cold, alerts, reopen' },
  { to: SETTINGS_PATHS.security, label: 'Security', icon: ShieldCheck, hint: '2FA, sessions, backups' },
  { to: SETTINGS_PATHS.audit, label: 'Audit log', icon: History, hint: 'Who changed what, and when' },
  { to: SETTINGS_PATHS.billing, label: 'Plan & billing', icon: CreditCard, hint: 'Subscription, trial and limits' },
]

/** Settings shell: section nav on the left, the section on the right. Admin edits; Management views. */
export function SettingsLayout() {
  const user = useCurrentUser()
  const readOnly = !!user && !can(user.role, 'settings', 'edit')

  return (
    <>
      <PageHeader
        title="Settings"
        description="Controls the system: who can sign in and what they see, plus every fixed list."
        actions={
          readOnly && (
            <Badge tone="amber" icon={<Lock />}>
              View only
            </Badge>
          )
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="lg:sticky lg:top-4 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {SECTIONS.map((s) => (
                <li key={s.to} className="shrink-0">
                  <NavLink
                    to={s.to}
                    className={({ isActive }) =>
                      cn(
                        'group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors',
                        isActive
                          ? 'bg-surface shadow-xs ring-1 ring-line'
                          : 'text-ink-2 hover:bg-hover hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <s.icon
                          aria-hidden
                          className={cn('mt-0.5 size-4 shrink-0', isActive ? 'text-brand-600 dark:text-brand-300' : 'text-muted')}
                        />
                        <span className="min-w-0">
                          <span className={cn('block text-[0.875rem] whitespace-nowrap', isActive && 'font-semibold text-ink')}>
                            {s.label}
                          </span>
                          <span className="hidden text-xs text-muted lg:block">{s.hint}</span>
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <section className="min-w-0">
            <Outlet />
          </section>
        </div>
      </PageBody>
    </>
  )
}
