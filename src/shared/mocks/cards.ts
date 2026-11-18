import type { PaymentMethod } from '@/modules/billing/types'
import { CodedApiError } from '@/shared/mocks/tenant'

/**
 * Mocked card payments, shared by sign-up checkout (POST /public/checkout) and billing
 * (POST /billing/payment-method). 4242 4242 4242 4242 (or any other Luhn-valid number) succeeds;
 * 4000 0000 0000 0002 is declined with 402 `card_declined`. Nothing is charged for real.
 */

export const DECLINED_CARD = '4000000000000002'

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

const err = (message: string, status: number, code: string) => new CodedApiError(message, status, code)

/**
 * Validates a card in a fixed order (holder, number, expiry, CVC, decline) and returns what is
 * stored: brand, last 4 digits, expiry and holder. Never the full number or the CVC.
 */
export function parseCard(input: { holder?: unknown; cardNumber?: unknown; expiry?: unknown; cvc?: unknown }, at: Date): PaymentMethod {
  const holder = String(input.holder ?? '').trim()
  if (holder.length < 2) throw err('Enter the name on the card.', 422, 'invalid_cardholder')
  const number = String(input.cardNumber ?? '').replace(/[\s-]/g, '')
  if (!/^\d{13,19}$/.test(number) || !luhn(number)) throw err('Enter a valid card number.', 422, 'invalid_card')
  const m = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(String(input.expiry ?? '').trim())
  const month = m ? Number(m[1]) : 0
  const year = m ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : 0
  if (!m || month < 1 || month > 12 || year * 12 + month < at.getFullYear() * 12 + at.getMonth() + 1) {
    throw err('Enter a valid expiry date (MM/YY).', 422, 'invalid_expiry')
  }
  if (!/^\d{3,4}$/.test(String(input.cvc ?? '').trim())) throw err('Enter the 3 or 4 digit security code.', 422, 'invalid_cvc')
  if (number === DECLINED_CARD) throw err('Your card was declined. Try another card.', 402, 'card_declined')
  return { brand: /^[25]/.test(number) ? 'mastercard' : 'visa', last4: number.slice(-4), expMonth: month, expYear: year, holder }
}
