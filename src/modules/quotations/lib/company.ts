/**
 * Issuer details printed on quotations. Placeholder until Settings > Company profile and
 * quotation templates exist; then these come from the API.
 */
export const COMPANY = {
  name: 'Apex Aora Innovations',
  addressLines: ['Business Bay, Dubai', 'United Arab Emirates'],
  email: 'sales@apexaorainnovations.com',
  website: 'apexaorainnovations.com',
  /** VAT registration number; printed only when set. */
  trn: '',
}

/**
 * Standard Notes / Terms for a new quotation when Settings > Templates has no default
 * "Quotation cover" / "Quotation terms" template (the editor prefers those), and the
 * "Standard text" choice in the editor's Insert template menu.
 */
export const DEFAULT_TERMS = [
  '50% advance on acceptance, 50% on delivery.',
  'Invoices are payable within 15 days by bank transfer.',
  'Prices are in AED. VAT is charged at 5% under UAE law.',
  'Monthly services are billed in advance and can be cancelled with 30 days’ notice.',
].join('\n')

export const DEFAULT_NOTES = 'Thank you for considering Apex Aora. We look forward to working with you.'
