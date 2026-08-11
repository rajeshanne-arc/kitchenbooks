// The only database entry point. Server-only by construction: importing this
// from client code fails the build. The app connects as the kb_app Postgres
// role, which can INSERT events and SELECT everything but holds no UPDATE or
// DELETE grants — the append-only rule is enforced by the database itself.
import 'server-only'
import postgres from 'postgres'

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
