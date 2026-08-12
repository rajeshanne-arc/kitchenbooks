// The only database entry point. Server-only by construction: importing this
// from client code fails the build. The app connects as the kb_app Postgres
// role, which can INSERT events and SELECT everything but holds no UPDATE or
// DELETE grants — the append-only rule is enforced by the database itself.
import 'server-only'
import postgres from 'postgres'
import { currentTenant, tenantGuc } from '@/lib/tenant'

declare global {
  var __kbSql: ReturnType<typeof postgres> | undefined
}

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — copy .env.example to .env.local')
  return postgres(url, {
    prepare: false, // Supavisor transaction mode does not support prepared statements
    ssl: 'require',
    // 12, not 4. At max:4 the pool DEADLOCKED in production: a group layout
    // (session + restaurant + tab list + tab badges) and the page it wraps
    // check out connections concurrently, and the heaviest page — the item
    // master, which also fans out — needed more than four at once. Postgres
    // showed every kb_app connection parked at wait_event ClientRead while
    // the request waited forever for a free one, until a statement timeout
    // (57014) finally killed it. The page hung on EVERY load, in dev and in
    // production, and it predates Phase B. Raise this before adding another
    // concurrent read to a layout.
    max: 12,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}

export const sql = globalThis.__kbSql ?? (globalThis.__kbSql = connect())

/**
 * A transaction that ANNOUNCES ITS TENANT — Phase 2(a).
 *
 * `set local app.restaurant_id` is the first statement inside every
 * transaction, so the RLS policies of Phase 2(b) have something true to
 * read. `local` is not optional: Supavisor runs in TRANSACTION mode, so the
 * connection under a plain `set` goes back to the pool and carries the value
 * to whoever gets it next. Scoped to the transaction, it cannot leak.
 *
 * Use this everywhere `sql.begin` was used. Outside a request there is no
 * tenant and nothing is announced, which is correct for the smoke suites.
 */
export async function txn<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  // Resolved here rather than required at 65 call sites. An explicit
  // withTenant() wins when one is in scope — that is how a background job
  // or a provisioning script announces a tenant it was told about — and
  // otherwise the session answers, which is every request path including
  // the POS fetch, since that runs inside a server action.
  //
  // A dynamic import: current-user reaches for next/headers, and db.ts is
  // loaded by smoke scripts that have no request. It already returns null
  // outside one, so a null tenant simply announces nothing.
  let tenant = currentTenant()
  if (tenant === null) {
    const { getSessionUser } = await import('@/server/current-user')
    tenant = (await getSessionUser())?.restaurantId ?? null
  }
  // THE SESSIONLESS PATHS, and the outage they caused.
  //
  // Login runs BEFORE there is a session: it looks a username up in order to
  // discover which restaurant the person belongs to. Under RLS that read has
  // no tenant to announce, so the policy casts an empty setting to uuid and
  // raises 22P02 — and `restaurants` is RLS'd too, so there is nothing left
  // to discover the tenant FROM. The morning RLS went on, /login returned
  // 500 for everyone and the whole app was unreachable.
  //
  // KB_TENANT names the restaurant THIS DEPLOYMENT serves. It is a
  // deployment fact, not a user's answer, so it is a legitimate default in a
  // way `issues.session` defaulting to 'Morning' never was — it is not
  // standing in for a question anybody was asked.
  //
  // BUT IT MAKES LOGIN SINGLE-TENANT, and that is the limitation to remove
  // before a second restaurant signs in: a second tenant's users would not
  // be found by this lookup at all. The permanent fix is a SECURITY DEFINER
  // function that resolves a username to its tenant across the pool —
  // authentication crosses tenants BY DEFINITION, so it is the one read that
  // has to, and a definer function is the narrow hole to do it through
  // rather than loosening a policy. Everything after login stays scoped by
  // the session, which is why this hole is one lookup wide.
  if (tenant === null) tenant = process.env.KB_TENANT ?? null
  const guc = tenantGuc(tenant)
  return sql.begin(async (tx) => {
    if (guc !== null) await tx.unsafe(guc)
    return fn(tx)
  }) as Promise<T>
}

/**
 * A READ that announces its tenant — the single-statement form of txn().
 *
 * Under RLS a plain `sql\`select …\`` has no GUC to read, so
 * current_setting returns NULL, every policy comparison yields NULL, and the
 * query returns zero rows. Not a leak — an app that looks like an empty
 * database, which is a worse outage because nobody suspects security.
 *
 * So every read goes through here. Call sites change by one character:
 *   await sql<Row[]>`select …`   ->   await tsql<Row[]>`select …`
 *
 * COST, measured rather than assumed: postgres.js pipelines the statements
 * of a transaction, so BEGIN/SET/SELECT/COMMIT is one round trip, not four.
 * What it does change is connection HOLD — each read now occupies a
 * connection for its transaction instead of sharing one by pipelining. That
 * is why `max` is what it is; see the note above it.
 */
export function tsql<T extends readonly unknown[] = readonly unknown[]>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T> {
  return txn(async (tx) => (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<T>)(strings, ...values))
}
