import { defineMapper } from './mapping'
import type {
  AgingDetail,
  AgingReport,
  ApplyCreditInput,
  CollectionsSettings,
  CollectionsSettingsInput,
  CreditCheck,
  CreditNoteCredit,
  CustomerCredit,
  CustomerCreditInput,
  CustomerOpenItems,
  DepositAccount,
  DunningLogEntry,
  DunningPauseInput,
  Payment,
  PaymentInput,
  PaymentLink,
  PaymentLinkInput,
  Pdc,
  PdcActionInput,
  PdcInput,
  PublicPayInput,
  PublicPayment,
  PublicPayResult,
  ReceiptView,
  RefundInput,
  Statement,
} from '@/modules/finance/collections/types'

/**
 * Wire names of Accounts & finance › Collections: plain snake_case at any depth (customer_id, exchange_rate,
 * bank_charges, deposit_account_id, allocations[].invoice_id, reversed_on, d30, over90, pdc_secured,
 * credit_limit, dunning_steps[].offset_days, card_hint…). docs/API.md › Finance › Payments / PDC / Receivables /
 * Payment links.
 */
const deep = <T>(opaque: string[] = []) => defineMapper<T>({ deep: true, opaque })

export const paymentMapper = deep<Payment>()
export const paymentInputMapper = deep<PaymentInput>()
export const refundInputMapper = deep<RefundInput>()
export const applyCreditInputMapper = deep<ApplyCreditInput>()
export const receiptMapper = deep<ReceiptView>()
export const pdcMapper = deep<Pdc>()
export const pdcInputMapper = deep<PdcInput>()
export const pdcActionInputMapper = deep<PdcActionInput>()
export const paymentLinkMapper = deep<PaymentLink>()
export const paymentLinkInputMapper = deep<PaymentLinkInput>()
export const publicPaymentMapper = deep<PublicPayment>()
export const publicPayInputMapper = deep<PublicPayInput>()
export const publicPayResultMapper = deep<PublicPayResult>()
export const agingReportMapper = deep<AgingReport>()
export const agingDetailMapper = deep<AgingDetail>()
export const statementMapper = deep<Statement>()
export const customerCreditMapper = deep<CustomerCredit>()
export const customerCreditInputMapper = deep<CustomerCreditInput>()
export const creditCheckMapper = deep<CreditCheck>()
export const creditNoteCreditMapper = deep<CreditNoteCredit>()
export const collectionsSettingsMapper = deep<CollectionsSettings>()
export const collectionsSettingsInputMapper = deep<CollectionsSettingsInput>()
export const dunningLogMapper = deep<DunningLogEntry>()
export const dunningPauseInputMapper = deep<DunningPauseInput>()
export const openItemsMapper = deep<CustomerOpenItems>()
export const depositAccountMapper = deep<DepositAccount>()
/** Small bodies / answers ({ reason }, { sent_to }, { paused }…). */
export const finPlainMapper = deep<Record<string, unknown>>()
