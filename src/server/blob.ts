import 'server-only'

/**
 * THE STORAGE BOUNDARY — one file, so the backend is one decision in one place.
 *
 * VERCEL BLOB, and that is not a fresh choice: `docs/attachments-storage-
 * decision.md` argued it and AGENTS.md records it as APPROVED. The reason is
 * the credential, not convenience. Supabase Storage needs an `sb_secret_…`
 * key, which is the documented replacement for `service_role` — a role whose
 * whole purpose is to BYPASS row-level security. Adding it would give this
 * process a master key to all 65+ tenant tables, `app_users` included, in
 * order to store a photograph of a bill. A blob token that leaks costs the
 * photographs; that key costs every restaurant's books.
 *
 * It is also why "browser uploads straight to storage" was not taken: the
 * argument for it is keeping a 4MB body off the function, and §4 compresses to
 * ~200KB in the browser before it is sent, which removes the problem the
 * optimisation existed for. Server-side upload keeps the token off the client
 * entirely — no signed upload URL to mis-scope, no token in a bundle.
 *
 * THE STORE IS `kitchenbooks-blob`, region **bom1** — the same region the
 * functions are pinned to and the database lives in. The region is fixed at
 * creation and the CLI's default is `iad1`, so getting it wrong would have put
 * every upload and every read across an ocean permanently; this project has
 * paid for that once already.
 *
 * WITHOUT A CREDENTIAL IT REFUSES BY NAME rather than throwing something
 * unreadable, and the UI turns the refusal into a sentence — a photograph that
 * silently fails to upload is worse than a button that admits it cannot.
 *
 * NOT EXERCISABLE FROM A LAPTOP, and worth writing down so the next person
 * does not spend the afternoon on it: `BLOB_READ_WRITE_TOKEN` is marked
 * Sensitive, so `vercel env pull` writes `[SENSITIVE]` rather than the value,
 * and OIDC is not enabled for the `development` environment — so neither this
 * code nor the `vercel blob` CLI can reach the store from here. Both
 * credentials ARE injected in Production and Preview, so the round trip runs
 * there. Enabling OIDC for Development is the one setting that would make it
 * testable locally.
 */

export class BlobUnconfigured extends Error {}
/** the key is gone, or storage answered with something other than the object */
export class BlobNotFound extends Error {}

/**
 * OIDC FIRST, and read at CALL TIME rather than module load.
 *
 * `VERCEL_OIDC_TOKEN` is injected by the platform and ROTATES — the decision
 * doc preferred it for exactly that reason: with it there is no long-lived
 * storage secret in the project at all. A module-level read would pin the
 * first value a warm instance ever saw and start failing when it expired.
 *
 * `BLOB_READ_WRITE_TOKEN` is the fallback, and it is what the runtime actually
 * injects today. Worth knowing rather than rediscovering: it is marked
 * Sensitive, so `vercel env pull` writes the literal string `[SENSITIVE]`
 * instead of the value — a placeholder that is WORSE than absence, because it
 * makes a "configured" check say yes and then fails at the call with "Access
 * denied". Hence the shape check below.
 */
type BlobAuth = { oidcToken: string; storeId: string } | { token: string }

function auth(): BlobAuth | null {
  const oidc = process.env.VERCEL_OIDC_TOKEN ?? ''
  const store = process.env.BLOB_STORE_ID ?? ''
  if (oidc !== '' && store !== '') return { oidcToken: oidc, storeId: store }
  const rw = process.env.BLOB_READ_WRITE_TOKEN ?? ''
  // A redacted pull is not a credential. Anything that is not a real token
  // reads as unconfigured, which is a sentence the user can act on.
  if (rw !== '' && rw.startsWith('vercel_blob_')) return { token: rw }
  return null
}

export const blobConfigured = (): boolean => auth() !== null

function assertConfigured(): BlobAuth {
  const a = auth()
  if (a === null) {
    throw new BlobUnconfigured(
      'Photo storage is not set up yet — the bill is saved, but there is nowhere to put the picture. ' +
        'An owner connects the blob store to this deployment and the button starts working; nothing here needs changing.',
    )
  }
  return a
}

/**
 * WRITE. `access: 'private'` is the whole point — a public blob is readable by
 * anyone holding the URL, with no session and no matrix, which would make the
 * read route below decoration. The store is private at the store level too
 * (`vercel blob get-store` reports Access: Private) and this says it again per
 * object, because the one that is easy to forget is the one on the call.
 *
 * `addRandomSuffix: false` — THE KEY IS THE RECORD. `storage_key` goes into
 * `attachments`, and a suffix chosen by the SDK would leave the row pointing at
 * something that is not there.
 */
export async function putObject(key: string, body: ArrayBuffer, contentType: string): Promise<string> {
  const a = assertConfigured()
  const { put } = await import('@vercel/blob')
  const res = await put(key, Buffer.from(body), {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    ...a,
  })
  return res.pathname
}

/**
 * READ, as a stream, straight through our own route — never a storage URL
 * handed to the browser. `get` returns null for a key that is not there, and
 * a non-200 for a range or a redirect we did not ask for; both are refusals
 * rather than something to unwrap optimistically.
 */
export async function getObject(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
  const a = assertConfigured()
  const { get } = await import('@vercel/blob')
  const res = await get(key, { access: 'private', ...a })
  if (res === null) throw new BlobNotFound('That photograph is no longer in storage.')
  if (res.statusCode !== 200) throw new BlobNotFound('That photograph could not be read from storage.')
  return { body: res.stream, contentType: res.blob.contentType }
}
