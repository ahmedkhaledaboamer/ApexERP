import { defineMapper } from './mapping'
import type {
  CreditNote,
  CreditNoteInput,
  InvoiceDetail,
  InvoiceFromSourceInput,
  InvoiceInput,
  InvoiceMeta,
  InvoiceRow,
  InvoiceSources,
  RecurringInput,
  RecurringSchedule,
  RecurringUpdate,
  SendInput,
  XmlFile,
} from '@/modules/finance/invoices/types'

/**
 * Wire names of Accounts & finance › Invoices, credit notes, recurring invoices (docs/API.md › Finance):
 * plain snake_case at any depth (customer_id, exchange_rate, tax_code_id, amount_credited, journal_entry_id,
 * zatca.icv / pih / type_code…). Maps keyed by data pass through untouched: `creditable` (invoice line id →
 * amount) and `rates` (currency code → rate).
 */
const deep = <T>(opaque: string[] = []) => defineMapper<T>({ deep: true, opaque })

export const invoiceRowMapper = deep<InvoiceRow>()
export const invoiceDetailMapper = deep<InvoiceDetail>(['creditable'])
export const invoiceInputMapper = deep<InvoiceInput>()
export const invoiceFromSourceMapper = deep<InvoiceFromSourceInput>()
export const invoiceMetaMapper = deep<InvoiceMeta>(['rates'])
export const invoiceSourcesMapper = deep<InvoiceSources>()
export const invoiceSendMapper = deep<SendInput>()
export const xmlFileMapper = deep<XmlFile>()
export const creditNoteMapper = deep<CreditNote>()
export const creditNoteInputMapper = deep<CreditNoteInput>()
export const recurringMapper = deep<RecurringSchedule>()
export const recurringInputMapper = deep<RecurringInput>()
export const recurringUpdateMapper = deep<RecurringUpdate>()
/** Small bodies / answers ({ reason }, { ok }). */
export const financePlainMapper = deep<Record<string, unknown>>()
