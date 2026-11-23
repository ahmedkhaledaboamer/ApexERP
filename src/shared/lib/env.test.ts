import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from '@/shared/lib/env'

describe('parseEnv', () => {
  it('defaults: mock on, /api', () => {
    expect(parseEnv({ DEV: true, MODE: 'development' })).toEqual({ apiUrl: '/api', apiMock: true, dev: true, mode: 'development' })
    expect(parseEnv({ VITE_API_URL: '', VITE_API_MOCK: '' })).toMatchObject({ apiUrl: '/api', apiMock: true, dev: false, mode: 'production' })
  })

  it('real backend: absolute URL, trailing slash trimmed, mock off', () => {
    expect(parseEnv({ VITE_API_URL: 'https://api.apexcrm.app/api/', VITE_API_MOCK: 'false' })).toMatchObject({
      apiUrl: 'https://api.apexcrm.app/api',
      apiMock: false,
    })
    expect(parseEnv({ VITE_API_URL: '/backend', VITE_API_MOCK: 'FALSE' })).toMatchObject({ apiUrl: '/backend', apiMock: false })
    expect(parseEnv({ VITE_API_URL: 'http://127.0.0.1:8080', VITE_API_MOCK: 'true' })).toMatchObject({ apiUrl: 'http://127.0.0.1:8080', apiMock: true })
  })

  it('rejects bad values with every problem listed', () => {
    let error: unknown
    try {
      parseEnv({ VITE_API_URL: 'api.example.com', VITE_API_MOCK: 'no' })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(EnvError)
    expect((error as EnvError).problems).toHaveLength(2)
    expect(() => parseEnv({ VITE_API_URL: 'ftp://x.example/api' })).toThrow(EnvError)
  })
})
