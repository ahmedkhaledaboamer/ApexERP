import { http } from 'msw'
import { getBranding, resetBranding, updateBranding } from '@/shared/mocks/services/branding'
import { API, respond, userFrom } from './utils'

/** Settings › Branding: logo (light/dark), favicon, primary colour, workspace name. */
export const brandingHandlers = [
  http.get(`${API}/settings/branding`, ({ request }) => respond(() => getBranding(userFrom(request)))),
  http.patch(`${API}/settings/branding`, async ({ request }) => {
    const body = (await request.json().catch(() => null)) as unknown
    return respond(() => updateBranding(userFrom(request), body))
  }),
  http.post(`${API}/settings/branding/reset`, ({ request }) => respond(() => resetBranding(userFrom(request)))),
]
