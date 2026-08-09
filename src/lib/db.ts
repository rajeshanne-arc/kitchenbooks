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
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
  })
}

export const sql = globalThis.__kbSql ?? (globalThis.__kbSql = connect())
