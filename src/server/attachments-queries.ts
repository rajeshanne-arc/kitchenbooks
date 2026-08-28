import 'server-only'
import type postgres from 'postgres'
import { tsql } from '@/lib/db'
import { keyBelongsTo, type AttachmentEntity } from '@/lib/attachment-entities'

/**
 * Reading attachments. DELIBERATELY NOT IN A `'use server'` FILE — every export
 * from one of those is a public HTTP endpoint, and `readAttachment` takes an id
 * and returns bytes. Same reasoning as `assertAccount` and `applyRequest`.
 */

export type AttachmentRow = {
  id: string
  storage_key: string
  filename: string | null
  mime_type: string | null
  byte_size: number | null
  uploaded_by: string | null
  created_at: string
}

/** The pages of one bill, oldest first — the order they were photographed. */
export async function listAttachments(
  restaurantId: string,
  entity: AttachmentEntity,
  entityId: string,
): Promise<AttachmentRow[]> {
  return tsql<AttachmentRow[]>`
    select id, storage_key, filename, mime_type, byte_size::int as byte_size,
           uploaded_by, created_at::text as created_at
    from attachments
    where restaurant_id = ${restaurantId}
      and entity_type = ${entity}
      and entity_id = ${entityId}
    order by created_at asc, id asc`
}

export class AttachmentRefusal extends Error {}

/**
 * One attachment, for streaming. TWO INDEPENDENT CHECKS, and the second is the
 * point: RLS scopes the read to the caller's tenant, and then the STORAGE KEY
 * is checked against that tenant before any byte is fetched.
 *
 * Belt and braces on purpose. `audit:tenancy` walks SQL and cannot see inside a
 * blob store; RLS cannot reach it either. If a row ever escaped its policy —
 * or if a key were written with the wrong prefix — this is the only thing left.
 */
export async function readAttachment(
  restaurantId: string,
  id: string,
  /** the caller may LEND its transaction — the gate writes a fixture and reads
   *  it back inside one rolled-back transaction, so it must exercise this
   *  function rather than a hand-written copy of it. Same shape as
   *  getClosePrefill. */
  handle?: postgres.TransactionSql,
): Promise<AttachmentRow> {
  const rows =
    handle === undefined
      ? await tsql<AttachmentRow[]>`
          select id, storage_key, filename, mime_type, byte_size::int as byte_size,
                 uploaded_by, created_at::text as created_at
          from attachments
          where restaurant_id = ${restaurantId} and id = ${id}`
      : await handle<AttachmentRow[]>`
          select id, storage_key, filename, mime_type, byte_size::int as byte_size,
                 uploaded_by, created_at::text as created_at
          from attachments
          where restaurant_id = ${restaurantId} and id = ${id}`
  const [row] = rows
  if (!row) throw new AttachmentRefusal('That file is not on this restaurant’s books.')
  if (!keyBelongsTo(row.storage_key, restaurantId)) {
    // Never leak the key or the other tenant's id — say what happened and stop.
    throw new AttachmentRefusal('That file is stored outside this restaurant’s space and was not read.')
  }
  return row
}
