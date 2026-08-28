/**
 * COMPRESS IN THE BROWSER, before a byte crosses the network.
 *
 * A phone photograph of a bill is 3–5 MB. Resized to a longest edge of 1600px
 * at JPEG 0.75 a bill stays legible at roughly 200 KB — twelve bills a day
 * becomes about 2 MB a month instead of 60. That is also what removes the
 * argument for uploading straight to storage from the browser: the 4 MB body
 * the optimisation existed to avoid is gone before it is sent.
 *
 * CANVAS, NOT A LIBRARY. Stage 1 stores and shows; it does not read. No image
 * dependency was added and none is needed for this — `createImageBitmap` and a
 * canvas are in every browser this app runs on.
 */

export const MAX_EDGE = 1600
export const QUALITY = 0.75

export type Compressed = { file: File; before: number; after: number }

export async function compressImage(file: File): Promise<Compressed> {
  const before = file.size
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx === null) return { file, before, after: before }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY))
  // A CANVAS THAT REFUSES IS NOT A REASON TO LOSE THE PHOTO. If the browser
  // will not encode it, send the original and let the server's size cap decide
  // — the refusal there names the size, which is something a person can act on.
  if (blob === null) return { file, before, after: before }

  const name = file.name.replace(/\.[^.]+$/, '') || 'bill'
  return {
    file: new File([blob], `${name}.jpg`, { type: 'image/jpeg' }),
    before,
    after: blob.size,
  }
}
