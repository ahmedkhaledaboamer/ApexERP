/** Marketing routes (plan module `marketing`; nav items in shared/components/layout/navigation.ts). */
export const MARKETING_PATHS = {
  campaigns: '/marketing/campaigns',
  campaignDetail: '/marketing/campaigns/:id',
  emails: '/marketing/email',
  emailDetail: '/marketing/email/:id',
  /** Old Marketing reports URL: redirects to analytics. */
  reports: '/marketing/reports',
  ads: '/marketing/ads',
  analytics: '/marketing/analytics',
  content: '/marketing/content',
  designRequests: '/marketing/design-requests',
  assets: '/marketing/assets',
  leadGeneration: '/marketing/lead-generation',
  leadForm: '/marketing/lead-generation/forms/:id',
  audiences: '/marketing/audiences',
  seo: '/marketing/seo',
  /** Public (no sign-in, no workspace screen): hosted lead capture form and landing pages. */
  publicForm: '/f/:key',
  publicLanding: '/p/:slug',
} as const

export const leadFormPath = (id: string) => `/marketing/lead-generation/forms/${encodeURIComponent(id)}`
export const publicFormPath = (key: string) => `/f/${encodeURIComponent(key)}`
export const publicLandingPath = (slug: string) => `/p/${encodeURIComponent(slug)}`

/** Deep links that open a drawer on the list page (also used by stored notifications). */
export const contentItemPath = (id: string) => `/marketing/content?item=${encodeURIComponent(id)}`
export const designRequestPath = (id: string) => `/marketing/design-requests?request=${encodeURIComponent(id)}`
export const brandAssetPath = (id: string) => `/marketing/assets?asset=${encodeURIComponent(id)}`

export const campaignPath = (id: string) => `/marketing/campaigns/${encodeURIComponent(id)}`
export const bulkEmailPath = (id: string) => `/marketing/email/${encodeURIComponent(id)}`
