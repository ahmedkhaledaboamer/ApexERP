/**
 * KSA ZATCA (FATOORA) e-invoicing data, pure and synchronous so the mock API, the seed and the tests
 * share one implementation:
 *   - SHA-256 (FIPS 180-4) and base64 over UTF-8 bytes
 *   - the QR payload: base64 of TLV records (tag byte, length byte, UTF-8 value) for
 *     1 seller name, 2 VAT registration number, 3 timestamp (ISO 8601), 4 invoice total incl. VAT, 5 VAT total
 *   - the UBL 2.1 XML of a standard (0100000) / simplified (0200000) tax invoice (388) or credit note (381),
 *     with the ICV and PIH additional document references; the hash is base64(SHA-256) over the XML
 *     WITHOUT the QR reference (no UBL extensions / signature: cryptographic stamping needs the backend + CSID).
 * Not tax advice: the real phase-2 flow (CSID onboarding, XAdES signature, C14N 1.1 canonicalisation,
 * clearance / reporting API) is server-side work (docs/API.md › Finance › ZATCA).
 */

/* ---------------- bytes ---------------- */

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
export const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=')
  }
  return out
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out: number[] = []
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) | (B64.indexOf(clean[i + 3] ?? 'A') & 63)
    out.push((n >> 16) & 255)
    if (i + 2 < clean.length) out.push((n >> 8) & 255)
    if (i + 3 < clean.length) out.push(n & 255)
  }
  return new Uint8Array(out)
}

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/* ---------------- SHA-256 ---------------- */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

export function sha256(data: Uint8Array | string): Uint8Array {
  const msg = typeof data === 'string' ? utf8(data) : data
  const bitLen = msg.length * 8
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6)
  padded.set(msg)
  padded[msg.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32))
  view.setUint32(padded.length - 4, bitLen >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }
  const out = new Uint8Array(32)
  const ov = new DataView(out.buffer)
  h.forEach((v, i) => ov.setUint32(i * 4, v))
  return out
}

/**
 * PIH of a company's first document: the spec's seed, base64 of the hex SHA-256 of "0"
 * ("NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==").
 */
export const INITIAL_PIH = toBase64(utf8(toHex(sha256('0'))))

/** A stable RFC 4122 v4-shaped UUID derived from a seed (deterministic in the mock; the backend uses a random one). */
export function uuidFrom(seed: string): string {
  const b = sha256(seed).slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = toHex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/* ---------------- QR (TLV) ---------------- */

export interface QrFields {
  sellerName: string
  vatNumber: string
  timestamp: string
  total: string
  vatTotal: string
}

export function encodeTlv(records: [tag: number, value: string][]): Uint8Array {
  const parts: number[] = []
  for (const [tag, value] of records) {
    const v = utf8(value)
    if (v.length > 255) throw new Error(`TLV value of tag ${tag} is longer than 255 bytes.`)
    parts.push(tag, v.length, ...v)
  }
  return new Uint8Array(parts)
}

export function decodeTlv(bytes: Uint8Array): Record<number, string> {
  const out: Record<number, string> = {}
  let i = 0
  while (i + 1 < bytes.length) {
    const tag = bytes[i]
    const len = bytes[i + 1]
    out[tag] = fromUtf8(bytes.slice(i + 2, i + 2 + len))
    i += 2 + len
  }
  return out
}

export const money = (n: number): string => n.toFixed(2)

export function qrPayload(f: QrFields): string {
  return toBase64(encodeTlv([[1, f.sellerName], [2, f.vatNumber], [3, f.timestamp], [4, f.total], [5, f.vatTotal]]))
}

export function decodeQr(base64: string): QrFields {
  const t = decodeTlv(fromBase64(base64))
  return { sellerName: t[1] ?? '', vatNumber: t[2] ?? '', timestamp: t[3] ?? '', total: t[4] ?? '', vatTotal: t[5] ?? '' }
}

/* ---------------- UBL 2.1 XML ---------------- */

export interface UblParty {
  name: string
  vatNumber: string
  /** Commercial registration (seller, schemeID CRN). */
  crn?: string
  street: string
  buildingNumber: string
  district: string
  city: string
  postalZone: string
  region: string
  country: string // ISO 3166 alpha-2
}

export interface UblLine {
  id: string
  name: string
  quantity: number
  unitPrice: number
  discount: number
  net: number
  taxAmount: number
  /** S standard, Z zero-rated, E exempt, O out of scope. */
  taxCategory: 'S' | 'Z' | 'E' | 'O'
  taxPercent: number
}

export interface UblDocument {
  number: string
  uuid: string
  issueDate: string // yyyy-MM-dd
  issueTime: string // HH:mm:ss
  typeCode: '388' | '381'
  subtype: '0100000' | '0200000'
  currency: string
  /** ZATCA: VAT total also in SAR. */
  taxCurrency: string
  taxTotalInTaxCurrency: number
  icv: number
  pih: string
  seller: UblParty
  buyer: UblParty | null
  /** Supply date (KSA-5); the issue date by default. */
  deliveryDate: string
  /** Credit note: the original invoice number (BillingReference) and the reason (KSA-10). */
  billingReference?: string
  reason?: string
  /** 10 cash, 30 credit transfer, 42 bank account, 48 card, 1 not defined. */
  paymentMeansCode: string
  lines: UblLine[]
  lineExtension: number
  allowanceTotal: number
  taxExclusive: number
  taxTotal: number
  taxInclusive: number
  payable: number
  /** Present only in the downloadable file (not in the hashed form). */
  qr?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const amt = (n: number, cur: string) => `currencyID="${cur}">${money(n)}`

function partyXml(tag: 'AccountingSupplierParty' | 'AccountingCustomerParty', p: UblParty): string {
  const ids = p.crn ? `\n      <cac:PartyIdentification><cbc:ID schemeID="CRN">${esc(p.crn)}</cbc:ID></cac:PartyIdentification>` : ''
  const tax = p.vatNumber
    ? `\n      <cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`
    : ''
  return `  <cac:${tag}>
    <cac:Party>${ids}
      <cac:PostalAddress>
        <cbc:StreetName>${esc(p.street)}</cbc:StreetName>
        <cbc:BuildingNumber>${esc(p.buildingNumber)}</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${esc(p.district)}</cbc:CitySubdivisionName>
        <cbc:CityName>${esc(p.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(p.postalZone)}</cbc:PostalZone>
        <cbc:CountrySubentity>${esc(p.region)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(p.country)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>${tax}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:${tag}>`
}

/** UBL 2.1 Invoice (388) / credit note as Invoice 381, the ZATCA shape. */
export function buildUblXml(doc: UblDocument): string {
  const c = doc.currency
  const groups = new Map<string, { cat: string; pct: number; net: number; tax: number }>()
  for (const l of doc.lines) {
    const k = `${l.taxCategory}:${l.taxPercent}`
    const g = groups.get(k) ?? { cat: l.taxCategory, pct: l.taxPercent, net: 0, tax: 0 }
    g.net += l.net
    g.tax += l.taxAmount
    groups.set(k, g)
  }
  const exemption = (cat: string) =>
    cat === 'E' ? '<cbc:TaxExemptionReasonCode>VATEX-SA-29</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Financial services mentioned in Article 29 of the VAT Regulations</cbc:TaxExemptionReason>'
    : cat === 'Z' ? '<cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Export of goods</cbc:TaxExemptionReason>'
    : cat === 'O' ? '<cbc:TaxExemptionReasonCode>VATEX-SA-OOS</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Not subject to VAT</cbc:TaxExemptionReason>'
    : ''
  const subtotals = [...groups.values()]
    .map(
      (g) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount ${amt(g.net, c)}</cbc:TaxableAmount>
      <cbc:TaxAmount ${amt(g.tax, c)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>${g.cat}</cbc:ID><cbc:Percent>${money(g.pct)}</cbc:Percent>${exemption(g.cat)}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>`,
    )
    .join('\n')
  const lines = doc.lines
    .map(
      (l) => `  <cac:InvoiceLine>
    <cbc:ID>${esc(l.id)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="PCE">${l.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${amt(l.net, c)}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount ${amt(l.taxAmount, c)}</cbc:TaxAmount>
      <cbc:RoundingAmount ${amt(l.net + l.taxAmount, c)}</cbc:RoundingAmount>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${esc(l.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>${l.taxCategory}</cbc:ID><cbc:Percent>${money(l.taxPercent)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount ${amt(l.quantity ? (l.net / l.quantity) : l.unitPrice, c)}</cbc:PriceAmount>${
        l.discount > 0
          ? `\n      <cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason><cbc:Amount ${amt(l.quantity ? l.discount / l.quantity : l.discount, c)}</cbc:Amount><cbc:BaseAmount ${amt(l.unitPrice, c)}</cbc:BaseAmount></cac:AllowanceCharge>`
          : ''
      }
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n')
  const billingRef = doc.billingReference
    ? `\n  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(doc.billingReference)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>`
    : ''
  const qr = doc.qr
    ? `\n  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${doc.qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>`
    : ''
  const reason = doc.reason ? `<cbc:InstructionNote>${esc(doc.reason)}</cbc:InstructionNote>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <!-- UBLExtensions (XAdES signature) and cac:Signature are added by the backend after CSID onboarding (not stamped in this mock). -->
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${esc(doc.number)}</cbc:ID>
  <cbc:UUID>${doc.uuid}</cbc:UUID>
  <cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${doc.issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${doc.subtype}">${doc.typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${c}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>${doc.taxCurrency}</cbc:TaxCurrencyCode>${billingRef}
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${doc.icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${doc.pih}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>${qr}
${partyXml('AccountingSupplierParty', doc.seller)}
${doc.buyer ? partyXml('AccountingCustomerParty', doc.buyer) : '  <cac:AccountingCustomerParty><cac:Party/></cac:AccountingCustomerParty>'}
  <cac:Delivery><cbc:ActualDeliveryDate>${doc.deliveryDate}</cbc:ActualDeliveryDate></cac:Delivery>
  <cac:PaymentMeans><cbc:PaymentMeansCode>${doc.paymentMeansCode}</cbc:PaymentMeansCode>${reason}</cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(doc.taxTotalInTaxCurrency, doc.taxCurrency)}</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount ${amt(doc.taxTotal, c)}</cbc:TaxAmount>
${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${amt(doc.lineExtension, c)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount ${amt(doc.taxExclusive, c)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount ${amt(doc.taxInclusive, c)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount ${amt(doc.allowanceTotal, c)}</cbc:AllowanceTotalAmount>
    <cbc:PrepaidAmount ${amt(0, c)}</cbc:PrepaidAmount>
    <cbc:PayableAmount ${amt(doc.payable, c)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`
}

/** base64(SHA-256) of the hashed form (the XML without the QR reference). */
export function invoiceHash(doc: UblDocument): string {
  return toBase64(sha256(buildUblXml({ ...doc, qr: undefined })))
}
