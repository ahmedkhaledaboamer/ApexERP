import { defineMapper } from './mapping'
import type {
  AcknowledgeInput,
  DisciplinaryDetail,
  DisciplinaryInput,
  DisciplinaryRow,
  MyPolicy,
  PolicyDetail,
  PolicyExportRow,
  PolicyInput,
  PolicyRow,
  PolicyStatusReport,
  WarningLetter,
} from '@/modules/hr/compliance/types'

/**
 * Wire names of HR › Discipline and Policies: plain snake_case at any depth (case_no, employee_id, ack_status,
 * deduction_amount, audience.department_ids, stats.acknowledged, by_department …). docs/API.md › HR › Discipline,
 * Policies. Policy text and letter text are values, passed through untouched.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const disciplinaryRowMapper = deep<DisciplinaryRow>()
export const disciplinaryMapper = deep<DisciplinaryDetail>()
export const disciplinaryInputMapper = deep<DisciplinaryInput>()
export const acknowledgeInputMapper = deep<AcknowledgeInput>()
export const warningLetterMapper = deep<WarningLetter>()
export const policyRowMapper = deep<PolicyRow>()
export const policyMapper = deep<PolicyDetail>()
export const policyInputMapper = deep<PolicyInput>()
export const policyStatusMapper = deep<PolicyStatusReport>()
export const policyExportMapper = deep<PolicyExportRow>()
export const myPolicyMapper = deep<MyPolicy>()
/** Small bodies ({ reason }, { version }, { change_note }, { attachments }). */
export const compliancePlainMapper = deep<Record<string, unknown>>()
