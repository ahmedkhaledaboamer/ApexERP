import { defineMapper } from './mapping'
import type {
  AssetDetail,
  AssetInput,
  AssetRow,
  AssignInput,
  ContractInput,
  DocumentInput,
  EmployeeContract,
  EmployeeDetail,
  EmployeeDocument,
  EmployeeExportRow,
  EmployeeInput,
  EmployeeRow,
  RenewInput,
  ReturnInput,
  UnlinkedUser,
} from '@/modules/hr/peopleTypes'

/**
 * Wire names of HR › Employees, Employee contracts and Company assets: plain snake_case at any depth
 * (employee_no, department_id, manager_id, hire_date, exit_date, number_masked, expiry_date, issuing_country,
 * iban_masked, basic_salary, housing_allowance, probation_end_date, renewed_from_id, warranty_end,
 * assigned_to_id…). docs/API.md › HR.
 */
const deep = <T>() => defineMapper<T>({ deep: true })

export const hrEmployeeRowMapper = deep<EmployeeRow>()
export const hrEmployeeDetailMapper = deep<EmployeeDetail>()
export const hrEmployeeInputMapper = deep<EmployeeInput>()
export const hrEmployeeExportMapper = deep<EmployeeExportRow>()
export const hrUnlinkedUserMapper = deep<UnlinkedUser>()
export const hrDocumentMapper = deep<EmployeeDocument>()
export const hrDocumentInputMapper = deep<DocumentInput>()
export const hrContractMapper = deep<EmployeeContract>()
export const hrContractInputMapper = deep<ContractInput>()
export const hrRenewInputMapper = deep<RenewInput>()
export const hrAssetRowMapper = deep<AssetRow>()
export const hrAssetDetailMapper = deep<AssetDetail>()
export const hrAssetInputMapper = deep<AssetInput>()
export const hrAssignInputMapper = deep<AssignInput>()
export const hrReturnInputMapper = deep<ReturnInput>()
/** Small bodies / answers ({ field }, { user_id }, { note }, { value }, { number }). */
export const hrPlainMapper = deep<Record<string, unknown>>()
