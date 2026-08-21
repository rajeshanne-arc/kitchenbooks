# Attachments: which storage, and what secret it costs

**Status: a decision for Rajesh. Nothing is built.** The `attachments` table
exists and no UI touches it.

## What the app is today, so the cost of each option is real

One process, one secret that matters. `DATABASE_URL` connects as `kb_app`, a
role with SELECT + INSERT, column-level UPDATE on a named handful, and DELETE
on exactly five tables. `KB_SESSION_SECRET` signs the session cookie. There is
**no Supabase client SDK, no service key, and no storage SDK of any kind** —
`package.json` is `bcryptjs, next, postgres, react, react-dom, recharts,
server-only, zod`.

That matters because the whole RLS phase exists to make the database the
backstop rather than the app's discipline. Any option that adds a key which can
read past those policies is not adding a secret; it is removing the backstop.

The table, as applied:

```
attachments(id, restaurant_id, entity_type, entity_id, kind, storage_key,
            filename, mime_type, byte_size, caption, uploaded_by, created_at)
  kb_app: INSERT, SELECT, UPDATE(caption).  NO DELETE.
  index:  (restaurant_id, entity_type, entity_id)
  kind:   photo | document | statement | other
  RLS:    NOT ENABLED — see migrations/meters_attachments_rls.sql
```

`storage_key` holds a key, never bytes. `entity_id` is nullable, polymorphic
like `queries`.

---

## The options

### A. Vercel Blob — **recommended**

`npm i @vercel/blob`. `put(key, file, { access: 'private' })`;
`get(pathname, { access: 'private' })` returns a stream the app serves after
its own auth; `issueSignedToken` + `presignUrl` mint short-lived URLs scoped to
one pathname and one operation (default 1 hour, maximum 7 days).

**The secret.** Either `BLOB_READ_WRITE_TOKEN` — one static token — or
`VERCEL_OIDC_TOKEN`, which the platform injects and **rotates automatically**.
The docs name OIDC as the preferred form when running on Vercel. With it there
is no long-lived storage secret in the project at all.

**Blast radius if it leaks:** read and write on the blob store. It cannot reach
Postgres. Every restaurant's books are untouched. That is the entire argument.

Provisioning is `vercel blob` or the dashboard on the project already linked
(`prj_vPherHFXBtH2SDyrgT3tnxIkYwq9`); the token lands in the project env.

**Against it:** private storage is in public beta. And the store's region is
chosen at creation — the functions are pinned to `bom1` and the database is
`ap-south-1`, so **check an ap-south region is offered before creating the
store**; I have not verified that, and a store in Europe would put every upload
and every read across an ocean, which this project has already paid for once.

### B. Supabase Storage — **not recommended, and the reason is not preference**

`npm i @supabase/supabase-js`. Server-side writes need a **secret key**
(`sb_secret_…`), which Supabase's own migration guide names as the replacement
for `service_role` in "servers, Edge Functions, workers, other backend code".

And `service_role`, in Supabase's words, is the role "used by the API
(PostgREST) to **bypass Row Level Security**."

> **That key is a master key to every restaurant's books.** It reads and writes
> all 65+ tenant tables past every policy this project spent a phase adding —
> including `app_users`, the table where a missing `and restaurant_id = …` once
> let one restaurant's owner change another's user's role. Adding it to the same
> process, in the same env, in order to store a photograph of a meter, is the
> largest single security change this app could make, and it buys a feature that
> does not need it.

Things that reduce but do not remove it: secret keys can be created per
component and rotated independently, and they return 401 if presented from a
browser. **I found no documented way to scope a secret key to Storage alone** —
the privilege is project-wide.

Storage's own RLS policies key off Supabase Auth JWTs (`auth.uid()`). This app
has its own `app_users` and an HMAC cookie and no Supabase Auth, so those
policies cannot be driven by our sessions without minting Supabase JWTs — and
the alternative is to bypass them with the secret key, which is the thing being
avoided.

Genuinely in its favour, and worth stating: same vendor, same region as the
database, one bill, and `createSignedUrl(path, expiresIn)` is a good API. If
the answer changes later, this is the option that gets better — a Storage-only
credential would flip the decision.

### C. Bytes in Postgres (`bytea`) — rejected, but it is the only zero-secret option

No new secret. No new vendor. **Tenant isolation comes free**, by the same RLS
that protects everything else, and there is no path-scoping code to get wrong.
For a restaurant filing a dozen photos a month it would work.

Rejected because the schema's author already ruled on it — the column is
`storage_key`, "holds a key, never the bytes" — and because of three concrete
costs: a multi-megabyte upload holds a pooled connection for its whole transfer
(this app has already been taken down once by pool exhaustion at `max: 4`);
backups grow with every photo; and with **no DELETE grant on `attachments`** a
mistaken 8 MB upload is permanent weight inside the primary database.

### D. S3 / Cloudflare R2 direct — rejected

Most control, most work, and the worst secret story of the four: two static
long-lived credentials, our own signing, no platform rotation. Nothing here
needs it.

---

## The design that follows, whichever backend is chosen

**1. The tenant is the first path segment, and the prefix is a CHECK.**

```
<restaurant_id>/<entity_type>/<entity_id>/<uuid>.<ext>
```

No storage backend knows about our tenants, so the app enforces it — and not by
convention: every read asserts the stored key begins with the session's
restaurant id **before** fetching, and refuses otherwise. That check is cheap
and it is the only thing standing between two restaurants' documents.
`audit:tenancy` cannot see inside a blob store; a test has to hold this.

**2. Uploads are server-side only. The browser never holds a token.** The file
posts to a server action or route handler, which checks the session, checks the
role against the matrix, enforces a size cap and a MIME allowlist, writes the
blob, then writes the row — the row last, so a failed upload leaves no
attachment claiming a key that does not exist.

**3. Reads go through our own route, not a raw URL.** `session → role check →
attachment row (RLS-scoped) → prefix check → stream`. That way the role matrix
governs attachments exactly as it governs every other surface, and LAW 1 does
not acquire an exception. Signed expiring URLs are minted only where a direct
URL is genuinely needed (a PDF opened in a viewer, an `<img>` in a list) — with
the shortest expiry that works, scoped to the one pathname.

**4. `entity_type` is a KEY REGISTRY, like `src/lib/query-entities.ts`.**
Structural, in code, never a managed list — a settings row must not be able to
point an attachment at a table that does not exist.

## The open question that must be answered before any UI

**`kb_app` has no DELETE on `attachments`, and that is deliberate — but it means
a wrong attachment cannot be taken back, and a blob nobody references is a bill
nobody stops paying.**

By this project's own rule — *a record is editable only while it asserts an
INTENTION and nothing depends on it yet* — an attachment is two things at once.
The upload is an **event**: somebody photographed a meter at 11pm and that
happened. The *link* to a row is a **judgement**: "this document is evidence for
that bill", and a photo attached to the wrong bill was never true, exactly like
a reconciliation match.

**My recommendation: do not add a DELETE grant.** Add a `status` column and
retire, which is what every other master in this app does and keeps the upload
on the record. The blob stays; the link stops being asserted. If Rajesh wants
the blob genuinely gone — and for a photo of someone's ID document he might —
that is a separate, deliberate decision about *data*, not about bookkeeping, and
it should be a named admin action rather than a delete button.

That ruling is needed first, because it decides whether the UI has a remove
button at all.

## What it should be built for, first

Two readers, both real, both named by Rajesh:

- **a meter photo** — the reading has evidence behind it;
- **a bill photo** — "show me the bill" is the single most common thing an
  accountant asks.

Not a general uploader with no reader. A capability nobody reads is the
`issues.session` mistake wearing a new hat, and this project has paid for that
four times.
