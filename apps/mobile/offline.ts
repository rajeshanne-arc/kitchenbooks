import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'

export type PendingMutation = { id: number; clientMutationId: string; operation: string; payload: string; createdAt: string; status: 'pending' | 'failed'; lastError: string | null; attempts: number }

let databasePromise: Promise<SQLiteDatabase> | null = null

async function database() {
  if (databasePromise === null) databasePromise = openDatabaseAsync('kitchenbooks-mobile.db')
  const db = await databasePromise
  await db.execAsync(`
    create table if not exists pending_mutations (
      id integer primary key autoincrement,
      client_mutation_id text not null unique,
      operation text not null,
      payload text not null,
      created_at text not null,
      status text not null default 'pending',
      last_error text,
      attempts integer not null default 0
    );
    create table if not exists cached_attendance (
      date text primary key,
      payload text not null,
      cached_at text not null
    );
  `)
  await db.execAsync('alter table pending_mutations add column status text not null default \'pending\'').catch(() => undefined)
  await db.execAsync('alter table pending_mutations add column last_error text').catch(() => undefined)
  await db.execAsync('alter table pending_mutations add column attempts integer not null default 0').catch(() => undefined)
  return db
}

export async function queueMutation(input: { clientMutationId: string; operation: string; payload: unknown }) {
  const db = await database()
  await db.runAsync(
    'insert or ignore into pending_mutations (client_mutation_id, operation, payload, created_at) values (?, ?, ?, ?)',
    input.clientMutationId, input.operation, JSON.stringify(input.payload), new Date().toISOString(),
  )
}

export async function pendingMutations() {
  const db = await database()
  return db.getAllAsync<PendingMutation>('select id, client_mutation_id as clientMutationId, operation, payload, created_at as createdAt, status, last_error as lastError, attempts from pending_mutations order by id asc')
}

export async function markMutationFailed(id: number, error: string) {
  const db = await database()
  await db.runAsync('update pending_mutations set status = ?, last_error = ?, attempts = attempts + 1 where id = ?', 'failed', error.slice(0, 300), id)
}

export async function retryMutation(id: number) {
  const db = await database()
  await db.runAsync('update pending_mutations set status = ?, last_error = null where id = ?', 'pending', id)
}

export async function removeMutation(id: number) {
  const db = await database()
  await db.runAsync('delete from pending_mutations where id = ?', id)
}

export async function cacheAttendance(date: string, payload: unknown) {
  const db = await database()
  await db.runAsync('insert or replace into cached_attendance (date, payload, cached_at) values (?, ?, ?)', date, JSON.stringify(payload), new Date().toISOString())
}

export async function cachedAttendance(date: string) {
  const db = await database()
  const row = await db.getFirstAsync<{ payload: string }>('select payload from cached_attendance where date = ?', date)
  return row === null ? null : JSON.parse(row.payload) as { date: string; sheet: unknown[] }
}

export async function flushAttendance(apiBaseUrl: string, accessToken: string) {
  const queued = await pendingMutations()
  let flushed = 0
  for (const mutation of queued) {
    if (mutation.operation !== 'attendance.save') continue
    try {
      const response = await fetch(`${apiBaseUrl}/api/mobile/v1/attendance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: mutation.payload,
      })
      if (response.ok) { await removeMutation(mutation.id); flushed += 1 }
      else { const body = await response.json().catch(() => ({})) as { error?: string }; await markMutationFailed(mutation.id, body.error ?? `HTTP ${response.status}`) }
    } catch {
      break
    }
  }
  return flushed
}

export async function flushMutations(apiBaseUrl: string, accessToken: string) {
  const queued = await pendingMutations()
  let flushed = 0
  for (const mutation of queued.filter((item) => item.status === 'pending')) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/mobile/v1/mutations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ clientMutationId: mutation.clientMutationId, operation: mutation.operation, payload: JSON.parse(mutation.payload) }) })
      if (response.ok) { await removeMutation(mutation.id); flushed += 1 }
      else { const body = await response.json().catch(() => ({})) as { error?: string }; await markMutationFailed(mutation.id, body.error ?? `HTTP ${response.status}`) }
    } catch { break }
  }
  return flushed
}
