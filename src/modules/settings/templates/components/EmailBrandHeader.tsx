import type { CSSProperties } from 'react'
import type { Branding } from '@/modules/tenancy/types'
import { useBranding } from '@/modules/tenancy/hooks'
import { TenantLogo } from '@/modules/tenancy/components/TenantLogo'
import { scaleVars } from '@/modules/tenancy/palette'

/**
 * The branded header every sent email starts with (same layout as `renderEmailHtml`): the light
 * logo on white, or the monogram + name, over a rule in the brand colour. Always light: email
 * clients show it on white whatever the app theme.
 */
export function EmailBrandHeader({ branding: override }: { branding?: Branding }) {
  const active = useBranding()
  const b = override ?? active
  return (
    <div
      id="email-brand-header"
      data-logo={b.logoUrl ? 'image' : 'monogram'}
      className="flex items-center gap-3 border-b-[3px] bg-white px-4 py-3"
      style={{ ...(scaleVars(b.palette) as CSSProperties), borderBottomColor: b.palette['600'] }}
    >
      <TenantLogo size="md" variant="light" branding={b} />
      {!b.logoUrl && <span className="text-[0.875rem] font-semibold text-zinc-900">{b.displayName}</span>}
    </div>
  )
}
