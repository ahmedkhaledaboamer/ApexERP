import { z } from 'zod'
import { DELIVERY_ROLES, PRICING_TYPES, type DeliveryRole, type PricingType } from '@/modules/services/types'

/** Empty inputs become `undefined` so "required" fires instead of coercing '' to 0. */
const num = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : Number(v)), schema)

const money = num(
  z
    .number({ required_error: 'Enter a price.', invalid_type_error: 'Enter a number.' })
    .min(0, 'Price must be 0 or more.')
    .max(100_000_000, 'That price looks too large.'),
)

/** New / edit service form. Mirrors the server's checks (it validates again). */
export const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120, 'Keep the name under 120 characters.'),
  category: z.string().min(1, 'Pick a category.'),
  description: z.string().trim().max(2000, 'Keep the description under 2000 characters.'),
  industries: z.array(z.string()),
  pricingType: z.enum(PRICING_TYPES as [PricingType, ...PricingType[]]),
  price: money,
  currency: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter code, e.g. AED or SAR.')),
  deliveryDays: num(
    z
      .number({ required_error: 'Enter the delivery time.', invalid_type_error: 'Enter a number.' })
      .int('Use whole working days.')
      .min(0, 'Use 0–730 working days.')
      .max(730, 'Use 0–730 working days.'),
  ),
  active: z.boolean(),
})

export type ServiceValues = z.infer<typeof serviceSchema>

/** One delivery task row in the project template editor. */
export const templateTaskSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(120, 'Keep it under 120 characters.'),
  role: z.enum(DELIVERY_ROLES as [DeliveryRole, ...DeliveryRole[]], { errorMap: () => ({ message: 'Pick a role.' }) }),
  dayOffset: num(
    z
      .number({ required_error: 'Enter a day.', invalid_type_error: 'Enter a number.' })
      .int('Whole days only.')
      .min(0, '0–365')
      .max(365, '0–365'),
  ),
  hours: num(
    z
      .number({ required_error: 'Enter hours.', invalid_type_error: 'Enter a number.' })
      .min(0, '0–1000')
      .max(1000, '0–1000'),
  ),
})

export const templateSchema = z.array(templateTaskSchema).max(60, 'Keep templates to 60 tasks or fewer.')

/** New / edit package form. */
export const packageSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120, 'Keep the name under 120 characters.'),
    description: z.string().trim().max(2000, 'Keep the description under 2000 characters.'),
    items: z
      .array(
        z.object({
          serviceId: z.string().min(1),
          quantity: num(
            z
              .number({ required_error: 'Qty', invalid_type_error: 'Qty' })
              .int('Whole numbers.')
              .min(1, '1–999')
              .max(999, '1–999'),
          ),
        }),
      )
      .min(2, 'A package needs at least 2 services.'),
    packagePrice: money,
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine((v) => new Set(v.items.map((i) => i.serviceId)).size === v.items.length, {
    message: 'Each service can only appear once.',
    path: ['items'],
  })

export type PackageValues = z.infer<typeof packageSchema>
