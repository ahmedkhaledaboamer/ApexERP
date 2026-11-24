import { defineMapper } from './mapping'
import type {
  LetterRequestDetail,
  LetterRequestInput,
  LetterRequestRow,
  LetterType,
  LetterTypeInput,
  LetterVerification,
  MyHr,
  ProfileChangeInput,
  PublicLetterVerification,
  ProfileChangeRequest,
  SelfServiceInbox,
} from '@/modules/hr/selfservice/types'
import type { Payslip } from '@/modules/hr/payroll/types'

/**
 * Wire names of HR › Self-service and HR letters: plain snake_case at any depth (emergency_contact, iban_masked,
 * letter_type_id, reference_no, verification_code, letterhead.address_lines …). docs/API.md › HR › Self-service,
 * HR letters. Template text is a value, so its {{employee.fullName}} placeholders pass through untouched.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const myHrMapper = deep<MyHr>()
export const myPayslipMapper = deep<Payslip>()
export const profileChangeMapper = deep<ProfileChangeRequest>()
export const profileChangeInputMapper = deep<ProfileChangeInput>()
export const letterTypeMapper = deep<LetterType>()
export const letterTypeInputMapper = deep<LetterTypeInput>()
export const letterRequestRowMapper = deep<LetterRequestRow>()
export const letterRequestMapper = deep<LetterRequestDetail>()
export const letterRequestInputMapper = deep<LetterRequestInput>()
export const letterVerificationMapper = deep<LetterVerification>()
export const publicLetterVerificationMapper = deep<PublicLetterVerification>()
export const selfServiceInboxMapper = deep<SelfServiceInbox>()
/** Small bodies / answers ({ reason }, { override_reason }, { comment }, { id, iban }). */
export const selfServicePlainMapper = deep<Record<string, unknown>>()
