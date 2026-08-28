'use server'

// BILL PHOTOS — the first thing in this app that can be checked against
// something OUTSIDE it.
//
// Every reconciliation built so far compares one query with another: internally
// consistent, and completely blind to a rate typed wrong. A photograph of the
// paper is the only check on that, which is why it is worth having before
// anything reads it.
//
// STAGE 1 STORES AND SHOWS. It does not read. No OCR, no extraction, no
// prefill, no thumbnails — a thumbnail means server-side image processing, and
// no image dependency was added.

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { txn } from '@/lib/db'
import { putObject, BlobUnconfigured } from '@/server/blob'
import { storageKey, isAttachmentEntity } from '@/lib/attachment-entities'

class PhotoError extends Error {}

export type PhotoResult = { ok: true; id: string } | { ok: false; error: string }

/** ~2MB AFTER browser compression, which lands a legible bill near 200KB. The
 *  ceiling is here as well as in the browser because a form is never the
 *  check — and the refusal SAYS THE SIZE, or "too big" is unactionable. */
const MAX_BYTES = 2_000_000
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

const Input = z.object({
  entity: z.string(),
  entityId: z.string().uuid(),
  contentType: z.string(),
  filename: z.string().max(200),
})

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof PhotoError) return { ok: false, error: e.message }
  // The unconfigured case speaks in its own words — it is not a failure the
  // user caused and there is nothing for them to retry until a store exists.
  if (e instanceof BlobUnconfigured) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'That file could not be read — nothing was saved.' }
  console.error('bill photo failed', e)
  return { ok: false, error: 'The photo did not upload. The bill itself is saved and correct.' }
}

/**
 * THE BILL IS ALREADY SAVED WHEN THIS RUNS, and that ordering is the whole
 * design: a storeman at the delivery door on bad wifi must be able to walk away
 * with the bill recorded. Losing a photo is an inconvenience; losing six typed
 * lines is why people stop using an app.
 *
 * THE BLOB IS WRITTEN BEFORE THE ROW. A failed upload then leaves no row
 * claiming a key that does not exist — the opposite order leaves a page in the
 * list that opens to nothing.
 */
export async function attachPhoto(form: FormData): Promise<PhotoResult> {
  try {
    const input = Input.parse({
      entity: form.get('entity'),
      entityId: form.get('entityId'),
      contentType: form.get('contentType'),
      filename: form.get('filename') ?? '',
    })
    if (!isAttachmentEntity(input.entity)) throw new PhotoError('That is not something a photo can belong to.')

    const user = await getSessionUser()
    if (!user) throw new PhotoError('Sign in again — the session has expired.')
    // NO NEW ROLE RULE. A photo is visible to whoever can already open the bill,
    // so this asks the matrix the same question that route asks.
    if (!canAccess(user.role, '/api/attachments')) {
      throw new PhotoError('Bill photos belong to the store — ask them, or a manager.')
    }

    const file = form.get('file')
    if (!(file instanceof File)) throw new PhotoError('No picture arrived with that request.')
    if (!ALLOWED.includes(input.contentType)) {
      throw new PhotoError('Only a photograph can be attached — a JPEG, PNG or WebP.')
    }
    const bytes = await file.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) {
      throw new PhotoError(
        `That picture is ${Math.round(bytes.byteLength / 1024)} KB after compression, over the ${Math.round(
          MAX_BYTES / 1024,
        )} KB limit. Photograph one page at a time rather than the whole stack.`,
      )
    }

    const restaurant = await getRestaurant()
    const ext = input.contentType === 'image/png' ? 'png' : input.contentType === 'image/webp' ? 'webp' : 'jpg'
    const key = storageKey(restaurant.id, input.entity, input.entityId, randomUUID(), ext)

    await putObject(key, bytes, input.contentType)

    return await txn(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into attachments
          (restaurant_id, entity_type, entity_id, kind, storage_key, filename, mime_type, byte_size, uploaded_by)
        values (${restaurant.id}, ${input.entity}, ${input.entityId}, 'photo', ${key},
                ${input.filename === '' ? null : input.filename}, ${input.contentType},
                ${bytes.byteLength}, ${user.username})
        returning id`
      return { ok: true as const, id: row.id }
    })
  } catch (e) {
    return fail(e)
  }
}
