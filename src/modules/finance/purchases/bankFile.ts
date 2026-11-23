/**
 * Bank upload files of a supplier payment run (pure; shared by the mock API and the screens' pickers).
 *
 *   ae_enbd_bulk   UAE — Emirates NBD style bulk transfer CSV (local AED transfers, UAEFTS)
 *   ae_adcb_bulk   UAE — ADCB style bulk payment CSV
 *   sa_alrajhi_bulk KSA — Al Rajhi style bulk / SARIE CSV (local SAR transfers; bank code from the IBAN)
 *   swift_mt103    Any — SWIFT MT103-lite CSV for foreign-currency transfers (one row per transfer, fields named after
 *                  the MT103 tags: 32A value date / currency / amount, 50K ordering account, 57A beneficiary bank BIC,
 *                  59 beneficiary account + name, 70 remittance information, 71A charges SHA)
 *
 * Every file: a header row (the column labels), one row per payment (voucher), and a trailer row
 * `TOTAL,<count>,<amount>` so the bank (and the tests) can check the control total. Columns are configurable per bank
 * account (a subset / order of the template's columns). Values are CSV-quoted when they contain a comma, quote or
 * line break. Full IBANs only ever appear inside this file (an audited POST answer, accounting full only).
 */

export type PaymentFileTemplate = 'ae_enbd_bulk' | 'ae_adcb_bulk' | 'sa_alrajhi_bulk' | 'swift_mt103'
export const PAYMENT_FILE_TEMPLATES: PaymentFileTemplate[] = ['ae_enbd_bulk', 'ae_adcb_bulk', 'sa_alrajhi_bulk', 'swift_mt103']

export type PaymentFileColumn =
  | 'payment_type'
  | 'beneficiary_name'
  | 'iban'
  | 'bank_name'
  | 'bank_code'
  | 'swift_bic'
  | 'amount'
  | 'currency'
  | 'value_date'
  | 'reference'
  | 'purpose_code'
  | 'debit_account'
  | 'charges'
export const PAYMENT_FILE_COLUMNS: PaymentFileColumn[] = ['payment_type', 'beneficiary_name', 'iban', 'bank_name', 'bank_code', 'swift_bic', 'amount', 'currency', 'value_date', 'reference', 'purpose_code', 'debit_account', 'charges']

export const PAYMENT_FILE_COLUMN_LABEL: Record<PaymentFileColumn, string> = {
  payment_type: 'Payment type',
  beneficiary_name: 'Beneficiary name',
  iban: 'Beneficiary IBAN',
  bank_name: 'Beneficiary bank',
  bank_code: 'Bank code',
  swift_bic: 'SWIFT / BIC',
  amount: 'Amount',
  currency: 'Currency',
  value_date: 'Value date',
  reference: 'Payment reference',
  purpose_code: 'Purpose code',
  debit_account: 'Debit account IBAN',
  charges: 'Charges',
}

export interface TemplateDef {
  label: string
  country: 'AE' | 'SA' | null
  /** Foreign-currency transfers (SWIFT). */
  foreign: boolean
  columns: PaymentFileColumn[]
  /** Header labels the bank expects (default: PAYMENT_FILE_COLUMN_LABEL). */
  headers?: Partial<Record<PaymentFileColumn, string>>
}

export const PAYMENT_FILE_TEMPLATE_DEF: Record<PaymentFileTemplate, TemplateDef> = {
  ae_enbd_bulk: {
    label: 'Emirates NBD — bulk transfer CSV (UAE)',
    country: 'AE',
    foreign: false,
    columns: ['payment_type', 'debit_account', 'beneficiary_name', 'iban', 'bank_name', 'amount', 'currency', 'value_date', 'reference', 'purpose_code'],
  },
  ae_adcb_bulk: {
    label: 'ADCB — bulk payment CSV (UAE)',
    country: 'AE',
    foreign: false,
    columns: ['beneficiary_name', 'iban', 'amount', 'currency', 'value_date', 'reference', 'purpose_code'],
  },
  sa_alrajhi_bulk: {
    label: 'Al Rajhi — bulk / SARIE CSV (KSA)',
    country: 'SA',
    foreign: false,
    columns: ['beneficiary_name', 'iban', 'bank_code', 'amount', 'currency', 'value_date', 'reference', 'purpose_code'],
  },
  swift_mt103: {
    label: 'SWIFT MT103-lite CSV (foreign currency)',
    country: null,
    foreign: true,
    columns: ['value_date', 'currency', 'amount', 'debit_account', 'swift_bic', 'iban', 'beneficiary_name', 'reference', 'charges'],
    headers: { value_date: '32A Value date', currency: '32A Currency', amount: '32A Amount', debit_account: '50K Ordering account', swift_bic: '57A Beneficiary bank BIC', iban: '59 Beneficiary account', beneficiary_name: '59 Beneficiary name', reference: '70 Remittance information', charges: '71A Charges' },
  },
}

/** The local template a company uses by default (its country). */
export const defaultLocalTemplate = (country: string): PaymentFileTemplate => (country === 'SA' ? 'sa_alrajhi_bulk' : 'ae_enbd_bulk')

/** Columns of a template, filtered / ordered by the bank account's configuration (unknown or empty = the template's). */
export function columnsFor(template: PaymentFileTemplate, configured: readonly string[] | null | undefined): PaymentFileColumn[] {
  const allowed = PAYMENT_FILE_COLUMNS as readonly string[]
  const cols = (configured ?? []).filter((c): c is PaymentFileColumn => allowed.includes(c))
  return cols.length ? [...new Set(cols)] : PAYMENT_FILE_TEMPLATE_DEF[template].columns
}

/** KSA bank code: IBAN characters 5–6 (SA + 2 check digits + 2-digit bank id). */
export const bankCodeOf = (iban: string): string => (/^SA\d{4}/.test(iban) ? iban.slice(4, 6) : '')

export interface PaymentFileRow {
  beneficiaryName: string
  iban: string
  bankName: string
  swiftBic: string
  amount: number
  currency: string
  valueDate: string
  reference: string
}

export interface PaymentFileMeta {
  debitAccount: string
  /** Default purpose code (UAE: SUP supplier payment; KSA: the same family). */
  purposeCode: string
}

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

function cell(c: PaymentFileColumn, r: PaymentFileRow, meta: PaymentFileMeta, foreign: boolean): string {
  switch (c) {
    case 'payment_type':
      return foreign ? 'TT' : 'LOCAL'
    case 'beneficiary_name':
      return r.beneficiaryName.slice(0, 70)
    case 'iban':
      return r.iban
    case 'bank_name':
      return r.bankName
    case 'bank_code':
      return bankCodeOf(r.iban)
    case 'swift_bic':
      return r.swiftBic
    case 'amount':
      return money(r.amount)
    case 'currency':
      return r.currency
    case 'value_date':
      return r.valueDate
    case 'reference':
      return r.reference.slice(0, foreign ? 140 : 35)
    case 'purpose_code':
      return meta.purposeCode
    case 'debit_account':
      return meta.debitAccount
    case 'charges':
      return 'SHA'
  }
}

/** Builds the CSV: header, rows, `TOTAL,<count>,<amount>` trailer. Returns the content and the control totals. */
export function buildPaymentFile(template: PaymentFileTemplate, columns: readonly PaymentFileColumn[], rows: readonly PaymentFileRow[], meta: PaymentFileMeta): { content: string; count: number; total: number } {
  const def = PAYMENT_FILE_TEMPLATE_DEF[template]
  const header = columns.map((c) => csvCell(def.headers?.[c] ?? PAYMENT_FILE_COLUMN_LABEL[c]))
  const body = rows.map((r) => columns.map((c) => csvCell(cell(c, r, meta, def.foreign))).join(','))
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  const lines = [header.join(','), ...body, `TOTAL,${rows.length},${money(total)}`]
  return { content: lines.join('\r\n') + '\r\n', count: rows.length, total }
}
