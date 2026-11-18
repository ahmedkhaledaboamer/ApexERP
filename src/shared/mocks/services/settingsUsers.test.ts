import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/lib/apiError'
import { users } from '@/shared/mocks/db'
import { memberships } from '@/shared/mocks/data/tenancy'
import { createUser, updateUser } from '@/shared/mocks/services/settingsUsers'

const u = (id: string) => users.find((x) => x.id === id)!
const apexAdmin = u('u1')
const crestAdmin = u('u101')

async function apiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('Expected the call to fail')
}

const newCrestUser = (email: string) => ({
  name: 'Sara Al Qahtani',
  email,
  mobile: '0551234567',
  role: 'Sales Agent' as const,
  departmentId: 'c2-it',
  title: '',
  managerId: null,
})

describe('one email = one company (platform-wide)', () => {
  it('adding a user with an email from another company is rejected without naming that company', async () => {
    const before = users.length
    const err = await apiError(createUser(crestAdmin, newCrestUser('  OMAR@apexaora.ae ')))
    expect(err.status).toBe(409)
    expect(err.code).toBe('email_taken')
    expect(err.message).not.toMatch(/Apex Aora|apexaora|co_apex/i)
    expect(users.length).toBe(before)
  })

  it('changing an existing userâ€™s email to one used in another company is rejected', async () => {
    const target = users.find((x) => x.companyId === 'co_crest' && x.id !== crestAdmin.id)!
    const original = target.email
    const err = await apiError(updateUser(crestAdmin, target.id, { email: 'layla@apexaora.ae' }))
    expect(err.status).toBe(409)
    expect(err.message).not.toMatch(/Apex Aora|apexaora|co_apex/i)
    expect(target.email).toBe(original)
  })

  it('a duplicate inside the same company keeps the specific message (422)', async () => {
    const err = await apiError(createUser(apexAdmin, { ...newCrestUser('karim@apexaora.ae'), departmentId: 'd-sales' }))
    expect(err.status).toBe(422)
  })

  it('a fresh email works, and the membership is created as a separate record', async () => {
    const created = await createUser(crestAdmin, newCrestUser('sara.q@crestlogistics.sa'))
    expect(created.companyId).toBe('co_crest')
    expect(memberships.some((m) => m.userId === created.id && m.companyId === 'co_crest')).toBe(true)
    // Keeping the same email on update is fine.
    expect((await updateUser(crestAdmin, created.id, { email: 'sara.q@crestlogistics.sa' })).email).toBe('sara.q@crestlogistics.sa')
  })
})
