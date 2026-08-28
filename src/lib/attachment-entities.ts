// WHAT AN ATTACHMENT CAN BE ABOUT — a KEY REGISTRY, like query-entities.ts and
// tabs.ts. Structural, in code, never a managed list: a settings row must not
// be able to point an attachment at a table that does not exist.
//
// `attachments.entity_type` has NO check constraint in the database (verified),
// so this file is the only thing standing between a typo and an orphan row.

export const ATTACHMENT_ENTITIES = ['purchase', 'meter_reading'] as const
export type AttachmentEntity = (typeof ATTACHMENT_ENTITIES)[number]

export const isAttachmentEntity = (v: string): v is AttachmentEntity =>
  (ATTACHMENT_ENTITIES as readonly string[]).includes(v)

/**
 * THE TENANT IS THE FIRST PATH SEGMENT, AND THE PREFIX IS A CHECK.
 *
 *     <restaurant_id>/<entity_type>/<entity_id>/<uuid>.<ext>
 *
 * No storage backend knows about our tenants. `audit:tenancy` walks SQL and
 * cannot see inside a blob store, and RLS cannot reach it either — so this is
 * the ONLY thing between two restaurants' documents, and it is a function with
 * a test rather than a convention.
 *
 * Restaurant FIRST so a prefix comparison is one string operation with no join.
 * Get the segment order wrong and the check silently matches nothing — or
 * everything.
 */
export function storageKey(
  restaurantId: string,
  entity: AttachmentEntity,
  entityId: string,
  uuid: string,
  ext: string,
): string {
  return `${restaurantId}/${entity}/${entityId}/${uuid}.${ext}`
}

/**
 * Does this key belong to this restaurant? Asserted BEFORE any fetch, on every
 * read, so a row that somehow escaped RLS still cannot be turned into bytes.
 *
 * The trailing slash is load-bearing: without it a restaurant whose id is a
 * PREFIX of another's would match its neighbour's objects. UUIDs make that
 * impossible in practice and the check does not rely on that being true.
 */
export function keyBelongsTo(key: string, restaurantId: string): boolean {
  if (restaurantId === '' || key === '') return false
  return key.startsWith(`${restaurantId}/`)
}
