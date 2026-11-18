import type { Branding } from '@/modules/tenancy/types'

/**
 * The branded layout of every email the system sends: a header with the company logo (the light
 * one: email clients render on white) or its monogram in the brand colour, then the message.
 * The server renders sent emails with `renderEmailHtml`; the previews (Settings › Templates, the lead
 * composer) draw the same header with `EmailBrandHeader`.
 */

export interface EmailBrand {
  displayName: string
  /** Light logo URL, or null for the monogram. */
  logoUrl: string | null
  monogram: string
  /** Brand 600: the monogram tile and the header rule. */
  color: string
}

export function emailBrandOf(branding: Pick<Branding, 'displayName' | 'logoUrl' | 'monogram' | 'palette'>): EmailBrand {
  return { displayName: branding.displayName, logoUrl: branding.logoUrl || null, monogram: branding.monogram, color: branding.palette['600'] }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Table-based HTML (works in every email client). `body` is the final plain text. */
export function renderEmailHtml(input: { brand: EmailBrand; subject: string; body: string }): string {
  const { brand, subject, body } = input
  const name = escapeHtml(brand.displayName)
  const mark = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="40" style="display:block;height:40px;max-width:200px;border:0">`
    : `<span style="display:inline-block;width:40px;height:40px;line-height:40px;border-radius:8px;background:${escapeHtml(brand.color)};color:#fff;font:700 14px Arial,sans-serif;text-align:center">${escapeHtml(brand.monogram.slice(0, 3))}</span>`
  const text = escapeHtml(body).replace(/\r?\n/g, '<br>')
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f4f4f5">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px">',
    `<tr><td data-email-brand-header style="padding:20px 28px;border-bottom:3px solid ${escapeHtml(brand.color)}">`,
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td>${mark}</td>`,
    brand.logoUrl ? '' : `<td style="padding-left:12px;font:600 16px Arial,sans-serif;color:#18181b">${name}</td>`,
    '</tr></table></td></tr>',
    `<tr><td style="padding:24px 28px;font:14px/1.6 Arial,sans-serif;color:#27272a">${text}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('')
}
