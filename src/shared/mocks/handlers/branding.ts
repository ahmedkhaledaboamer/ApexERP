import { http } from 'msw'
import { getBranding, resetBranding, updateBranding } from '@/shared/mocks/services/branding'
import { brandingPatchMapper, brandingSettingsMapper, companyMapper } from '@/shared/api/mappers'
import { API, respondAs, userFrom } from './utils'

/** Settings › Branding: logo (light/dark), favicon, primary colour, workspace name. */
export const brandingHandlers = [
  http.get(`${API}/settings/branding`, ({ request }) => respondAs(brandingSettingsMapper, () => getBranding(userFrom(request)))),
  http.patch(`${API}/settings/branding`, async ({ request }) => {
    const raw = (await request.json().catch(() => null)) as unknown
    // Arrays and non-objects reach the service as they are (it answers 400).
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? brandingPatchMapper.fromApi(raw) : raw
    return respondAs(companyMapper, () => updateBranding(userFrom(request), body))
  }),
  http.post(`${API}/settings/branding/reset`, ({ request }) => respondAs(companyMapper, () => resetBranding(userFrom(request)))),
]
