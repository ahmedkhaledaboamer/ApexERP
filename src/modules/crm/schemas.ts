import { z } from 'zod'
import { isUaeMobile } from '@/shared/lib/phone'

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address.')

const optionalMobile = z
  .string()
  .trim()
  .refine((v) => v === '' || isUaeMobile(v), 'Use the UAE format +971 5X XXX XXXX.')

export const contactSchema = z
  .object({
    /** "Customer:C-1004" or "Lead:L-1001"; empty while nothing is picked. */
    record: z.string().min(1, 'Pick the company this contact works for.'),
    name: z.string().trim().min(1, 'Name is required.').max(80, 'Keep it under 80 characters.'),
    title: z.string().trim().max(80, 'Keep it under 80 characters.'),
    mobile: optionalMobile,
    email: optionalEmail,
    isDecisionMaker: z.boolean(),
  })
  .refine((v) => v.mobile !== '' || v.email !== '', { message: 'Add a mobile or an email.', path: ['mobile'] })

export type ContactValues = z.infer<typeof contactSchema>

export const contractSchema = z
  .object({
    customerId: z.string().min(1, 'Pick a customer.'),
    title: z.string().trim().min(1, 'Give the contract a title.').max(120, 'Keep it under 120 characters.'),
    serviceIds: z.array(z.string()).min(1, 'Pick at least one service.'),
    value: z.coerce.number({ invalid_type_error: 'Enter an amount.' }).positive('Value must be more than AED 0.'),
    billing: z.enum(['One-off', 'Monthly', 'Annual']),
    startDate: z.string().min(1, 'Pick a start date.'),
    renewalDate: z.string().min(1, 'Pick a renewal date.'),
  })
  .refine((v) => !v.startDate || !v.renewalDate || v.renewalDate > v.startDate, {
    message: 'The renewal date must be after the start date.',
    path: ['renewalDate'],
  })

export type ContractValues = z.infer<typeof contractSchema>

export const customerSchema = z.object({
  status: z.enum(['Active', 'Paused', 'VIP']),
  website: z
    .string()
    .trim()
    .refine((v) => v === '' || /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(v), 'Enter a valid website, e.g. company.ae.'),
  address: z.string().trim().max(200, 'Keep it under 200 characters.'),
  emirate: z.enum(['', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah']),
  ownerId: z.string().min(1, 'Pick an owner.'),
})

export type CustomerValues = z.infer<typeof customerSchema>
