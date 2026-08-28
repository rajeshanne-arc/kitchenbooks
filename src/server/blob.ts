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
 * NOT CONFIGURED YET, DELIBERATELY LOUD. No blob store exists on the project
 * and no token is set in any environment (checked). Every path here refuses by
 * name rather than throwing something unreadable, and the UI turns the refusal
 * into a sentence — because a photograph that silently fails to upload is
 * worse than a button that says it cannot yet.
 */

export class BlobUnconfigured extends Error {}

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? ''

export const blobConfigured = (): boolean => TOKEN !== ''

function assertConfigured(): void {
  if (!blobConfigured()) {
    throw new BlobUnconfigured(
      'Photo storage is not set up yet — the bill is saved, but there is nowhere to put the picture. ' +
        'An owner creates the blob store on the hosting project and the button starts working; nothing here needs changing.',
    )
  }
}

/**
 * NOT IMPLEMENTED, AND NOT GUESSED AT.
 *
 * Wiring these two is roughly twenty lines of `@vercel/blob` — but three
 * things have to be true first and none of them can be settled from here:
 *
 *   1. A BLOB STORE MUST EXIST. There is none on the project and no
 *      BLOB_READ_WRITE_TOKEN in any environment (checked with `vercel env ls`).
 *   2. IT MUST BE `access: 'private'`. A public blob is readable by anyone
 *      holding the URL, with no session and no matrix — which would make the
 *      read route below decoration. Private storage is in PUBLIC BETA, so the
 *      exact call shape wants verifying against the installed package rather
 *      than written from memory into code nobody can run.
 *   3. THE STORE'S REGION IS FIXED AT CREATION. Functions are pinned to `bom1`
 *      and the database is `ap-south-1`; a store in Europe would put every
 *      upload and every read across an ocean, which this project has already
 *      paid for once. `docs/attachments-storage-decision.md` flags this as
 *      unverified and it still is.
 *
 * Everything ABOVE this line — the key layout, the tenant prefix check, the
 * row, the route, the compression, the form — is backend-agnostic and is
 * built. This is the seam, and it is deliberately the only thing missing.
 */
export async function putObject(_key: string, _body: ArrayBuffer, _contentType: string): Promise<string> {
  assertConfigured()
  throw new BlobUnconfigured('Photo storage has no backend wired yet.')
}

export async function getObject(_key: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  assertConfigured()
  throw new BlobUnconfigured('Photo storage has no backend wired yet.')
}
