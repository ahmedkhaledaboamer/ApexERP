import { ASSET_KIND_LABEL, type AssetKind } from './types'
import { declaredType, formatBytes, LOGO_MAX_BYTES, MIME_OF, parseDataUrl, sniffImageType, svgProblem, toDataUrl } from '@/modules/settings/branding'

/**
 * Upload rules for brand assets and design-request attachments: THE check, run by the client before
 * uploading and by the API on save (the same functions). Files are metadata only in the mock (name,
 * mime_type, size_bytes); small images may carry a data URL preview, which is checked like a
 * Settings › Branding logo (real content type by magic bytes, safe SVG).
 */

const MB = 1024 * 1024

/** MIME types accepted per asset kind. */
export const ASSET_MIME: Record<AssetKind, readonly string[]> = {
  logo: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
  ],
  template: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/vnd.adobe.photoshop',
    'application/postscript',
    'application/zip',
  ],
  font: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2'],
  other: ['application/zip', 'application/pdf', 'text/plain'],
}

/** Size limit per file and kind. */
export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  logo: 5 * MB,
  image: 20 * MB,
  video: 200 * MB,
  document: 25 * MB,
  template: 50 * MB,
  font: 5 * MB,
  other: 25 * MB,
}

/** Design-request attachments: any of the asset types, up to 50 MB (videos 200 MB). */
export const ATTACHMENT_MAX_BYTES = 50 * MB
export const ATTACHMENT_VIDEO_MAX_BYTES = 200 * MB
const ALL_MIME = new Set(Object.values(ASSET_MIME).flat())

/** Previews (data URLs) are kept for images up to 1 MB. */
export const PREVIEW_MAX_BYTES = LOGO_MAX_BYTES
const PREVIEW_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  psd: 'image/vnd.adobe.photoshop',
  ai: 'application/postscript',
  eps: 'application/postscript',
  zip: 'application/zip',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

/** The MIME type of a picked file: the browser's, else from the extension. */
export function mimeOfFile(name: string, browserType: string | null | undefined): string {
  const t = (browserType ?? '').toLowerCase().split(';')[0].trim()
  if (t && t !== 'application/octet-stream') return t
  return EXT_MIME[name.toLowerCase().split('.').pop() ?? ''] ?? (t || 'application/octet-stream')
}

/** The best kind for a MIME type (upload form default). */
export function kindForMime(mime: string): AssetKind {
  if (mime.startsWith('image/') && mime !== 'image/vnd.adobe.photoshop') return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('font/')) return 'font'
  if (ASSET_MIME.document.includes(mime)) return 'document'
  if (ASSET_MIME.template.includes(mime)) return 'template'
  return 'other'
}

const NAME_MAX = 200

function checkName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give the file a name.'
  if (name.trim().length > NAME_MAX) return `Keep the file name under ${NAME_MAX} characters.`
  return null
}

function checkSize(size: unknown, max: number, what: string): string | null {
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return `The ${what} is empty or its size is unknown.`
  if (size > max) return `The ${what} is ${formatBytes(size)}; the limit is ${formatBytes(max)}.`
  return null
}

/** Why a brand asset file is refused, or null. */
export function assetFileProblem(kind: AssetKind, file: { name?: unknown; mimeType?: unknown; sizeBytes?: unknown }): string | null {
  const name = checkName(file.name)
  if (name) return name
  const mime = typeof file.mimeType === 'string' ? file.mimeType.toLowerCase() : ''
  if (!ASSET_MIME[kind].includes(mime)) return `${ASSET_KIND_LABEL[kind]} files must be one of: ${allowedText(kind)}.`
  return checkSize(file.sizeBytes, ASSET_MAX_BYTES[kind], 'file')
}

/** Why a design-request attachment is refused, or null. */
export function attachmentProblem(file: { name?: unknown; mimeType?: unknown; sizeBytes?: unknown }): string | null {
  const name = checkName(file.name)
  if (name) return name
  const mime = typeof file.mimeType === 'string' ? file.mimeType.toLowerCase() : ''
  if (!ALL_MIME.has(mime)) return 'That file type isn’t accepted. Use an image, video, PDF, Office document, font or ZIP.'
  return checkSize(file.sizeBytes, mime.startsWith('video/') ? ATTACHMENT_VIDEO_MAX_BYTES : ATTACHMENT_MAX_BYTES, 'attachment')
}

const EXT_LABEL: Record<string, string> = Object.fromEntries(Object.entries(EXT_MIME).map(([ext, m]) => [m, ext.toUpperCase()]))
export function allowedText(kind: AssetKind): string {
  return [...new Set(ASSET_MIME[kind].map((m) => (m === 'image/jpeg' ? 'JPG' : (EXT_LABEL[m] ?? m))))].join(', ')
}

/** `accept` attribute for a kind's file input. */
export function acceptFor(kind: AssetKind | 'any'): string {
  const mimes = kind === 'any' ? [...ALL_MIME] : [...ASSET_MIME[kind]]
  const exts = Object.entries(EXT_MIME)
    .filter(([, m]) => mimes.includes(m))
    .map(([e]) => `.${e}`)
  return [...mimes, ...exts].join(',')
}

/**
 * Checks an optional preview data URL against the declared file: an image up to 1 MB whose real
 * content (magic bytes) is the declared type and whose byte length equals size_bytes; SVGs must be
 * safe. Returns the normalised data URL, or an error message.
 */
export function checkPreview(dataUrl: unknown, mimeType: string, sizeBytes: number): { ok: true; dataUrl: string } | { ok: false; message: string } {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return { ok: false, message: 'The preview must be an image data URL.' }
  if (!PREVIEW_MIME.has(mimeType)) return { ok: false, message: 'Only images get a preview.' }
  if (dataUrl.length > Math.ceil((PREVIEW_MAX_BYTES * 4) / 3) + 256) return { ok: false, message: `Previews are kept for images up to ${formatBytes(PREVIEW_MAX_BYTES)}.` }
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) return { ok: false, message: 'The preview isn’t a valid data URL.' }
  if (parsed.bytes.length !== sizeBytes) return { ok: false, message: 'The preview doesn’t match the file size.' }
  if (mimeType === 'image/gif') {
    const sig = String.fromCharCode(...parsed.bytes.subarray(0, 4))
    if (sig !== 'GIF8') return { ok: false, message: 'The file says it is a GIF but its content isn’t.' }
    return { ok: true, dataUrl: toDataUrl('image/gif', parsed.bytes) }
  }
  const declared = declaredType(mimeType)
  const actual = sniffImageType(parsed.bytes)
  if (!declared || actual !== declared) return { ok: false, message: 'The file’s content doesn’t match its type. Export it again and retry.' }
  if (declared === 'svg') {
    const problem = svgProblem(new TextDecoder().decode(parsed.bytes))
    if (problem) return { ok: false, message: `This SVG ${problem}.` }
  }
  return { ok: true, dataUrl: toDataUrl(MIME_OF[declared], parsed.bytes) }
}

/** Tags: trimmed, lower-cased, unique, at most 12 of up to 32 characters. */
export function cleanTags(raw: unknown): string[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) return 'Tags must be a list of words.'
  const tags = [...new Set((raw as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))]
  if (tags.length > 12) return 'Use at most 12 tags.'
  if (tags.some((t) => t.length > 32)) return 'Keep each tag under 32 characters.'
  return tags
}
