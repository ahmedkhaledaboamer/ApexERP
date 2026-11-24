import { describe, expect, it } from 'vitest'
import type { User } from '@/shared/types'
import { users } from '@/shared/mocks/db'
import { APEX_ID, CREST_ID } from '@/shared/mocks/data/tenancy'
import { approvalChain, assertCanApprove, canApproveStep, departmentHeadOf, paymentAccountsOf } from './financeApprovals'

/** Finance phase 2 contract: amount bands, department-head steps, maker–checker, payment accounts. */

const u = (id: string) => users.find((x) => x.id === id)! as User

describe('approval chains by amount', () => {
  it('adds steps as the amount crosses each band', () => {
    expect(approvalChain(APEX_ID, 'purchase_order', 500).map((s) => s.approver)).toEqual(['department_head'])
    expect(approvalChain(APEX_ID, 'purchase_order', 10_000).map((s) => s.approver)).toEqual(['department_head', 'Accountant'])
    expect(approvalChain(APEX_ID, 'purchase_order', 75_000).map((s) => s.approver)).toEqual(['department_head', 'Accountant', 'Management'])
    expect(approvalChain(CREST_ID, 'expense_claim', 100).map((s) => s.approver)).toEqual(['department_head', 'Accountant'])
  })

  it('department head step: the requester’s head (walking up), never the requester', () => {
    const doc = { companyId: APEX_ID, requesterId: 'u4', departmentId: 'd-sales', approvedBy: [] as string[] }
    const step = approvalChain(APEX_ID, 'purchase_order', 100)[0]
    const head = departmentHeadOf(APEX_ID, 'd-sales')!
    expect(head).toBeTruthy()
    expect(canApproveStep(u(head), step, doc)).toBe(true)
    expect(canApproveStep(u('u8'), step, doc)).toBe(false) // Accountant isn't the head
    expect(() => assertCanApprove(u('u4'), step, doc)).toThrow(expect.objectContaining({ code: 'own_request' }))
    // Requester is the head: a Company Admin / Management stands in.
    const own = { ...doc, requesterId: head }
    expect(canApproveStep(u(head), step, own)).toBe(false)
    expect(canApproveStep(u('u1'), step, own)).toBe(true)
  })

  it('role steps, one step per user, and never across companies', () => {
    const [, acc] = approvalChain(APEX_ID, 'purchase_order', 20_000)
    const doc = { companyId: APEX_ID, requesterId: 'u4', departmentId: 'd-sales', approvedBy: ['u8'] }
    expect(canApproveStep(u('u8'), acc, doc)).toBe(false) // already approved a step
    expect(canApproveStep(u('u1'), acc, doc)).toBe(true)
    expect(canApproveStep(u('u101'), acc, doc)).toBe(false) // Crest admin
  })
})

describe('payment accounts', () => {
  it('cash and bank accounts only, without clearing accounts', () => {
    const codes = paymentAccountsOf(APEX_ID).map((a) => a.code).sort()
    expect(codes).toEqual(['1110', '1115', '1120'])
  })
})
