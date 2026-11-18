import { useState } from 'react'
import type { Branding } from '@/modules/tenancy/types'
import { useBranding } from '@/modules/tenancy/hooks'
import { logoFor } from '@/modules/tenancy/branding'
import { useAppSelector } from '@/store/hooks'
import { cn } from '@/shared/lib/utils'

const SIZES = {
  sm: { box: 'size-7 rounded-md text-[0.625rem]', img: 'h-7 w-10', fit: 'h-7 max-w-[7rem]' },
  md: { box: 'size-9 rounded-lg text-[0.75rem]', img: 'h-9 w-14', fit: 'h-9 max-w-[9rem]' },
  lg: { box: 'size-11 rounded-xl text-[0.875rem]', img: 'h-11 w-16', fit: 'h-11 max-w-[11rem]' },
} as const

export type TenantLogoSize = keyof typeof SIZES

interface TenantLogoProps {
  size?: TenantLogoSize
  className?: string
  /** Defaults to the active tenant's branding (useBranding). */
  branding?: Pick<Branding, 'logoUrl' | 'logoDarkUrl' | 'monogram' | 'displayName'>
  /**
   * Which logo: `auto` follows the app theme (dark logo in dark mode, falling back to the light one);
   * `light` for white paper (quotations, emails); `dark` for dark previews.
   */
  variant?: 'auto' | 'light' | 'dark'
  id?: string
}

/**
 * The tenant's logo: its image when set, else a monogram tile on the brand gradient. Purely
 * decorative (the display name is always shown or announced next to it). `data-tenant-logo` tells
 * which one rendered (light / dark / monogram) for tests and debugging.
 */
export function TenantLogo({ size = 'md', className, branding, variant = 'auto', id }: TenantLogoProps) {
  const active = useBranding()
  const theme = useAppSelector((s) => s.ui.theme)
  const b = branding ?? active
  const [broken, setBroken] = useState<string | null>(null)
  const s = SIZES[size]
  const mode = variant === 'auto' ? theme : variant
  const url = logoFor(b, mode)

  if (url && broken !== url) {
    const which = mode === 'dark' && b.logoDarkUrl && url === b.logoDarkUrl ? 'dark' : 'light'
    // Uploaded logos (data URLs, any aspect up to 4:1) keep their shape; the seeded hosted image
    // was laid out for a fixed crop.
    const uploaded = url.startsWith('data:')
    return (
      <img
        id={id}
        src={url}
        alt=""
        aria-hidden
        data-tenant-logo={which}
        onError={() => setBroken(url)}
        className={cn(uploaded ? `${s.fit} w-auto object-contain` : `${s.img} object-cover object-top`, 'shrink-0', className)}
      />
    )
  }
  return (
    <span
      id={id}
      aria-hidden
      data-tenant-logo="monogram"
      className={cn(
        s.box,
        'bg-brand-gradient inline-flex shrink-0 items-center justify-center font-bold tracking-wide text-white uppercase select-none',
        className,
      )}
    >
      {b.monogram.slice(0, 3) || b.displayName.slice(0, 1)}
    </span>
  )
}
