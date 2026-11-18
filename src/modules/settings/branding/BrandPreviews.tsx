import type { CSSProperties, ReactNode } from 'react'
import { LayoutDashboard, Users, X } from 'lucide-react'
import type { Branding } from '@/modules/tenancy/types'
import { DEFAULT_FAVICON, PRODUCT_NAME } from '@/modules/tenancy/branding'
import { scaleVars } from '@/modules/tenancy/palette'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'
import { cn } from '@/shared/lib/utils'

type Mode = 'light' | 'dark'
const MODES: Mode[] = ['light', 'dark']

/**
 * Live previews of the unsaved branding, each in light and dark: the app header (sidebar top with an
 * active item and a primary button), the workspace sign-in card and the browser tab with the
 * favicon. The draft palette is applied to the preview only (scoped CSS variables).
 */
export function BrandPreviews({ branding }: { branding: Branding }) {
  const vars = scaleVars(branding.palette) as CSSProperties
  return (
    <div className="space-y-5" style={vars}>
      <Group title="App header">
        {MODES.map((m) => (
          <Frame key={m} mode={m} id={`branding-preview-header-${m}`}>
            <div className="flex h-12 items-center gap-2.5 border-b border-line px-3">
              <TenantLogo size="sm" variant={m} branding={branding} />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[0.8125rem] font-bold tracking-tight text-ink">{branding.displayName}</p>
                <p className="truncate text-[0.5rem] font-medium tracking-[0.18em] text-muted uppercase">{PRODUCT_NAME}</p>
              </div>
            </div>
            <div className="space-y-1 p-2">
              <span
                className={cn(
                  'flex h-7 items-center gap-2 rounded-md px-2 text-[0.75rem] font-semibold text-ink ring-1 ring-inset',
                  m === 'dark' ? 'bg-brand-500/10 ring-brand-500/40' : 'bg-brand-50 ring-brand-300',
                )}
              >
                <LayoutDashboard className={cn('size-3.5', m === 'dark' ? 'text-brand-300' : 'text-brand-600')} aria-hidden />
                Dashboard
              </span>
              <span className="flex h-7 items-center gap-2 rounded-md px-2 text-[0.75rem] text-ink-2">
                <Users className="size-3.5 text-muted" aria-hidden />
                Leads
              </span>
              <span className={cn('mt-1 inline-flex h-7 items-center rounded-md px-2.5 text-[0.6875rem] font-medium text-white', m === 'dark' ? 'bg-brand-500' : 'bg-brand-600')}>
                New lead
              </span>
            </div>
          </Frame>
        ))}
      </Group>

      <Group title="Sign-in page">
        {MODES.map((m) => (
          <Frame key={m} mode={m} id={`branding-preview-signin-${m}`}>
            <div className="space-y-2.5 p-3">
              <div className="flex items-center gap-2">
                <TenantLogo size="sm" variant={m} branding={branding} />
                <span className="truncate text-[0.6875rem] font-semibold text-ink">{branding.displayName}</span>
              </div>
              <p className="text-[0.8125rem] font-semibold text-ink">Welcome back</p>
              <span className="block h-6 rounded-md border border-line-strong bg-surface" />
              <span className="block h-6 rounded-md border border-brand-500 bg-surface shadow-[0_0_0_2px_rgb(var(--brand-rgb)/0.18)]" />
              <span className={cn('flex h-7 items-center justify-center rounded-md text-[0.6875rem] font-medium text-white', m === 'dark' ? 'bg-brand-500' : 'bg-brand-600')}>
                Sign in
              </span>
            </div>
          </Frame>
        ))}
      </Group>

      <Group title="Browser tab">
        {MODES.map((m) => (
          <Frame key={m} mode={m} id={`branding-preview-favicon-${m}`} className={m === 'dark' ? 'bg-[#202124]' : 'bg-[#dee1e6]'}>
            <div className="px-2 pt-2">
              <div className={cn('flex h-8 items-center gap-2 rounded-t-lg px-2.5', m === 'dark' ? 'bg-[#35363a] text-zinc-100' : 'bg-white text-zinc-800')}>
                <img src={branding.faviconUrl || DEFAULT_FAVICON} alt="" className="size-4 shrink-0 object-contain" data-favicon-preview={branding.faviconUrl ? 'workspace' : 'default'} />
                <span className="min-w-0 flex-1 truncate text-[0.6875rem]">Dashboard · {branding.displayName}</span>
                <X className="size-3 shrink-0 opacity-60" aria-hidden />
              </div>
            </div>
          </Frame>
        ))}
      </Group>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted">{title}</h3>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  )
}

/** Light tokens set explicitly, so the light preview stays light while the app is in dark mode. */
const LIGHT_TOKENS = {
  '--color-surface': '#ffffff',
  '--color-sunken': '#f4f4f6',
  '--color-line': '#ebebef',
  '--color-line-strong': '#dcdce2',
  '--color-ink': '#18181d',
  '--color-ink-2': '#3f3f48',
  '--color-muted': '#6e6e7a',
} as CSSProperties

/** Previews use mode-conditional classes (not `dark:`), so the app theme never leaks into them. */
function Frame({ mode, id, className, children }: { mode: Mode; id: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn(mode === 'dark' && 'dark')} style={mode === 'light' ? LIGHT_TOKENS : undefined}>
      <div id={id} data-mode={mode} className={cn('overflow-hidden rounded-lg border border-line bg-surface text-ink', className)}>
        {children}
        <p className="sr-only">{mode === 'dark' ? 'Dark mode' : 'Light mode'}</p>
      </div>
    </div>
  )
}
