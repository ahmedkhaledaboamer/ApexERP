import { mimeOfFile, PREVIEW_MAX_BYTES } from './assetRules'

/** A picked file as the API takes it: metadata, plus a data-URL preview for small images. */
export interface PickedFile {
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl: string | null
}

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'])

export async function readPickedFile(file: File): Promise<PickedFile> {
  const mimeType = mimeOfFile(file.name, file.type)
  let dataUrl: string | null = null
  if (PREVIEWABLE.has(mimeType) && file.size > 0 && file.size <= PREVIEW_MAX_BYTES) {
    dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result.replace(/^data:[^;,]*/, `data:${mimeType}`) : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  }
  return { name: file.name, mimeType, sizeBytes: file.size, dataUrl }
}
