/** Marketing routes (plan module `marketing`; nav items in shared/components/layout/navigation.ts). */
export const MARKETING_PATHS = {
  campaigns: '/marketing/campaigns',
  campaignDetail: '/marketing/campaigns/:id',
  emails: '/marketing/email',
  emailDetail: '/marketing/email/:id',
  reports: '/marketing/reports',
} as const

export const campaignPath = (id: string) => `/marketing/campaigns/${encodeURIComponent(id)}`
export const bulkEmailPath = (id: string) => `/marketing/email/${encodeURIComponent(id)}`
