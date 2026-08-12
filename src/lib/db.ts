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
  const guc = tenantGuc(tenant)
  return sql.begin(async (tx) => {
    if (guc !== null) await tx.unsafe(guc)
    return fn(tx)
  }) as Promise<T>
}
