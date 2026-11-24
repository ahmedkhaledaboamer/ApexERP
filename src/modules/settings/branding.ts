import type { Branding } from '@/modules/tenancy/types'

/**
 * Settings › Branding rules, shared by the page (client checks before upload) and the mock API
 * (server checks on PATCH /settings/branding). Same function, same messages on both sides.
 * Contract: docs/API.md "Settings: branding".
 */

/** Largest accepted logo (light or dark), decoded bytes. */
export const LOGO_MAX_BYTES = 1024 * 1024
/** Largest accepted favicon, decoded bytes. */
export const FAVICON_MAX_BYTES = 256 * 1024
/** Workspace name length. */
export const DISPLAY_NAME_MAX = 60

/** Crop output: raster logos are scaled down to fit this box, favicons to this square. */
export const LOGO_OUTPUT_MAX = { width: 800, height: 400 } as const
export const FAVICON_OUTPUT_SIZE = 128
/** Logo crop frame aspect (width / height): from 1:2 up to 4:1. Favicons are square. */
export const LOGO_ASPECT_MIN = 0.5
export const LOGO_ASPECT_MAX = 4

export type BrandImageKind = 'logoLight' | 'logoDark' | 'favicon'
export const BRAND_IMAGE_KINDS: BrandImageKind[] = ['logoLight', 'logoDark', 'favicon']

export const IMAGE_LABEL: Record<BrandImageKind, string> = {
  logoLight: 'light logo',
  logoDark: 'dark logo',
  favicon: 'favicon',
}

export type ImageType = 'png' | 'jpeg' | 'webp' | 'svg'

export const MIME_OF: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}
const TYPE_LABEL: Record<ImageType, string> = { png: 'PNG', jpeg: 'JPG', webp: 'WebP', svg: 'SVG' }
const TYPE_OF_MIME: Record<string, ImageType> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/pjpeg': 'jpeg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}
const TYPE_OF_EXT: Record<string, ImageType> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', svg: 'svg' }

/** For `<input type="file" accept>`. */
export const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'
export const ALLOWED_TYPES_TEXT = 'PNG, JPG, SVG or WebP'

export function maxBytesFor(kind: BrandImageKind): number {
  return kind === 'favicon' ? FAVICON_MAX_BYTES : LOGO_MAX_BYTES
}

/** 1536 → "1.5 KB", 1048576 → "1 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  const mb = n / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

/** The type a file claims (MIME first, then the extension); null when it isn't one we take. */
export function declaredType(mime: string | null | undefined, fileName?: string): ImageType | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim()
  if (m && TYPE_OF_MIME[m]) return TYPE_OF_MIME[m]
  if (m && m !== 'application/octet-stream') return null
  const ext = fileName?.toLowerCase().split('.').pop() ?? ''
  return TYPE_OF_EXT[ext] ?? null
}

/* ---------------- Content checks ---------------- */

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len))

/** The real type of the bytes (magic numbers; SVG by its root element). */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  if (svgRootOk(decodeText(bytes.subarray(0, 4096)))) return 'svg'
  return null
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Text before the root element: BOM, whitespace, an XML declaration and comments only. */
function svgRootOk(text: string): boolean {
  const rest = text
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)+/, '')
    // A DOCTYPE (with an internal subset) is recognised here and refused by `svgProblem`.
    .replace(/^\s*<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)+/, '')
    .trimStart()
  return /^<svg[\s>]/i.test(rest)
}

/** `&#106;` / `&#x6A;` → "j" so encoded `javascript:` or `onload` can't slip past the checks. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d) % 0x110000))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
}

/**
 * Why an SVG is refused, or null when it is safe to show: no scripts, no event handler attributes,
 * no `javascript:` URLs, no `<foreignObject>` / embedded HTML, no DOCTYPE / entities, and no
 * external references (every href and url() must point inside the file, `#id`).
 */
export function svgProblem(text: string): string | null {
  const t = decodeEntities(text)
  if (!svgRootOk(t)) return 'isn’t a valid SVG image (no <svg> root element)'
  if (/<!DOCTYPE|<!ENTITY/i.test(t)) return 'contains a DOCTYPE or entity declarations'
  if (/<\s*script/i.test(t)) return 'contains a script'
  if (/[\s"'/]on[a-z]+\s*=/i.test(t)) return 'contains an event handler attribute (onload, onclick…)'
  if (/j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i.test(t)) return 'contains a javascript: link'
  if (/<\s*foreignObject/i.test(t)) return 'contains a <foreignObject> (embedded HTML)'
  if (/<\s*(iframe|embed|object|audio|video|image\s[^>]*href\s*=\s*["']\s*(?!#))/i.test(t)) return 'embeds external content'
  if (/(?:^|[\s"'])(?:xlink:)?href\s*=\s*["']\s*(?!#)/i.test(t)) return 'contains an external reference (href)'
  if (/url\(\s*["']?\s*(?!#)/i.test(t)) return 'contains an external reference (url())'
  if (/@import/i.test(t)) return 'contains an external reference (@import)'
  return null
}

export interface ImageInfo {
  type: ImageType
  bytes: number
  width: number | null
  height: number | null
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

/** Pixel size read from the header; null when it can't be read (damaged file, SVG without a size). */
export function imageDimensions(type: ImageType, b: Uint8Array): { width: number; height: number } | null {
  if (type === 'png') {
    if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null
    return { width: be32(b, 16), height: be32(b, 20) }
  }
  if (type === 'jpeg') {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        i += marker === 0xff ? 1 : 2
        continue
      }
      // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: be16(b, i + 5), width: be16(b, i + 7) }
      }
      i += 2 + be16(b, i + 2)
    }
    return null
  }
  if (type === 'webp') {
    if (b.length < 30) return null
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ') return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
    if (chunk === 'VP8L') {
      return {
        width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      }
    }
    if (chunk === 'VP8X') return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) }
    return null
  }
  // SVG: width/height of the root element, else the viewBox.
  const root = /<svg\b[^>]*>/i.exec(decodeText(b.subarray(0, 8192)))?.[0] ?? ''
  const num = (name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(root)
    return m ? Math.round(Number(m[1])) : null
  }
  const w = num('width')
  const h = num('height')
  if (w && h) return { width: w, height: h }
  const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(root)
  return vb ? { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) } : null
}

/** "PNG 34 KB, 320×80" (the audit log never shows the image itself). */
export function summarizeImage(info: ImageInfo): string {
  const size = info.width && info.height ? `, ${info.width}×${info.height}` : ''
  return `${TYPE_LABEL[info.type]} ${formatBytes(info.bytes)}${size}`
}

export type CheckResult = { ok: true; info: ImageInfo } | { ok: false; message: string }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * THE image check (client before upload, server on save): allowed type, size limit for the kind,
 * the content really is the declared type (magic bytes), SVG safety, readable size for rasters.
 */
export function checkImageBytes(kind: BrandImageKind, declared: ImageType | null, bytes: Uint8Array): CheckResult {
  const what = IMAGE_LABEL[kind]
  if (!declared) return { ok: false, message: `The ${what} must be a ${ALLOWED_TYPES_TEXT} image.` }
  const max = maxBytesFor(kind)
  if (bytes.length > max) {
    return { ok: false, message: `The ${what} is ${formatBytes(bytes.length)}; the limit is ${formatBytes(max)}.` }
  }
  if (bytes.length === 0) return { ok: false, message: `The ${what} file is empty.` }
  const actual = sniffImageType(bytes)
  if (actual !== declared) {
    return {
      ok: false,
      message: actual
        ? `The ${what} says it is ${TYPE_LABEL[declared]} but its content is ${TYPE_LABEL[actual]}. Export it again as ${TYPE_LABEL[declared]}.`
        : `The ${what} isn’t a real ${TYPE_LABEL[declared]} image (its content doesn’t match the file type).`,
    }
  }
  if (declared === 'svg') {
    const problem = svgProblem(decodeText(bytes))
    if (problem) return { ok: false, message: `${cap(`the ${what}`)} SVG ${problem}. Upload an SVG without scripts, links or embedded content, or a PNG.` }
  }
  const dims = imageDimensions(declared, bytes)
  if (!dims && declared !== 'svg') return { ok: false, message: `The ${what} looks damaged: its size can’t be read.` }
  if (dims && (dims.width < 1 || dims.height < 1 || dims.width > 10000 || dims.height > 10000)) {
    return { ok: false, message: `The ${what} must be between 1 and 10,000 pixels on each side.` }
  }
  return { ok: true, info: { type: declared, bytes: bytes.length, width: dims?.width ?? null, height: dims?.height ?? null } }
}

/* ---------------- Data URLs ---------------- */

const DATA_URL = /^data:([a-z0-9.+/-]+)((?:;[a-z0-9-]+=[^;,]*)*)(;base64)?,([\s\S]*)$/i

/** `data:<mime>[;params][;base64],<data>` → its MIME type and decoded bytes; null when malformed. */
export function parseDataUrl(value: string): { mime: string; bytes: Uint8Array } | null {
  const m = DATA_URL.exec(value)
  if (!m) return null
  const mime = m[1].toLowerCase()
  try {
    if (m[3]) {
      const clean = m[4].replace(/\s+/g, '')
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null
      const bin = atob(clean)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { mime, bytes }
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[4])) }
  } catch {
    return null
  }
}

/** Base64 data URL for bytes (the client after cropping; the server stores what it checked). */
export function toDataUrl(mime: string, bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(bin)}`
}

/** Server: checks an image data URL of the PATCH body. */
export function checkImageDataUrl(kind: BrandImageKind, value: unknown): ({ ok: true; info: ImageInfo; dataUrl: string }) | { ok: false; message: string } {
  const what = IMAGE_LABEL[kind]
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    return { ok: false, message: `Send the ${what} as an image data URL (data:image/png;base64,…), or null to remove it.` }
  }
  // Rough guard before decoding: base64 is 4/3 of the bytes.
  if (value.length > Math.ceil((maxBytesFor(kind) * 4) / 3) + 256) {
    return { ok: false, message: `The ${what} is larger than ${formatBytes(maxBytesFor(kind))}, the limit.` }
  }
  const parsed = parseDataUrl(value)
  if (!parsed) return { ok: false, message: `The ${what} isn’t a valid data URL.` }
  const res = checkImageBytes(kind, declaredType(parsed.mime), parsed.bytes)
  if (!res.ok) return res
  // Stored normalised: base64 with the canonical MIME type of the checked content.
  return { ok: true, info: res.info, dataUrl: toDataUrl(MIME_OF[res.info.type], parsed.bytes) }
}

/** Audit / UI summary of a stored image URL: "PNG 34 KB, 320×80", a hosted URL as such, or "—". */
export function describeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!url.startsWith('data:')) return `Hosted image (${url.replace(/^https?:\/\//, '').split('/')[0]})`
  const parsed = parseDataUrl(url)
  const type = parsed ? sniffImageType(parsed.bytes) : null
  if (!parsed || !type) return 'Image'
  const dims = imageDimensions(type, parsed.bytes)
  return summarizeImage({ type, bytes: parsed.bytes.length, width: dims?.width ?? null, height: dims?.height ?? null })
}

/* ---------------- API shapes ---------------- */

/** PATCH /settings/branding body. Images: a data URL to set, null to remove, absent to keep. */
export interface BrandingPatch {
  displayName?: string
  /** `#rrggbb`; the 50–900 palette is derived from it. */
  primaryColor?: string
  logoLight?: string | null
  logoDark?: string | null
  favicon?: string | null
}

/** GET /settings/branding. */
export interface BrandingSettings {
  branding: Branding
  /** The primary in use: `branding.primaryColor`, else the palette's 600 step. */
  primaryColor: string
  limits: { logoMaxBytes: number; faviconMaxBytes: number; types: string[]; displayNameMax: number }
}

/** Display name check (shared). */
export function displayNameProblem(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Enter the workspace name.'
  if (value.trim().length > DISPLAY_NAME_MAX) return `Keep the workspace name under ${DISPLAY_NAME_MAX} characters.`
  return null
}
