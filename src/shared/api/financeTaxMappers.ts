import { defineMapper } from './mapping'
import type { CorporateTaxEstimate, TaxSettings, VatBoxItems, VatReturnDetail, VatReturnRow, ZakatEstimate, ProvisionResult } from '@/modules/finance/tax/types'

/** Wire names of Accounts & finance › Tax: plain snake_case at any depth (filing_reference, credit_brought_forward…). */
const deep = <T>() => defineMapper<T>({ deep: true })

export const vatReturnRowMapper = deep<VatReturnRow>()
export const vatReturnMapper = deep<VatReturnDetail>()
export const vatBoxItemsMapper = deep<VatBoxItems>()
export const taxSettingsMapper = deep<TaxSettings>()
export const corporateTaxMapper = deep<CorporateTaxEstimate>()
export const zakatMapper = deep<ZakatEstimate>()
export const taxEstimateMapper = deep<CorporateTaxEstimate | ZakatEstimate>()
export const provisionResultMapper = deep<ProvisionResult>()
export const taxPlainMapper = deep<Record<string, unknown>>()
