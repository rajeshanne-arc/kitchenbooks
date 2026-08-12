// WHICH TENANT THIS REQUEST IS FOR, carried out of band.
//
// Phase 2(a): the app announces the tenant to Postgres at the start of every
// transaction — `set local app.restaurant_id` — so that Phase 2(b) can turn
// on RLS and have the policies read something true. While RLS is off this is
// inert, which is the whole reason the order is this way round: the GUC can
// be wrong for a week and nothing breaks, whereas RLS reading a wrong GUC
// enforces the wrong tenant faithfully and looks secure while doing it.
//
// AsyncLocalStorage rather than a parameter on 253 call sites: the tenant is
// a property of the REQUEST, not of any one query, and threading it by hand
// means every new query is a chance to forget. A module-level variable would
// be the `restaurantCache` bug again — process-wide across concurrent
// requests on one instance — and ALS is precisely the fix for that: each
// async context gets its own value.

import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<string>()

/** Run `fn` with this tenant in scope. Everything it awaits sees it. */
export function withTenant<T>(restaurantId: string, fn: () => Promise<T>): Promise<T> {
  return store.run(restaurantId, fn)
}

/**
 * The tenant for the current async context, or null outside one — smoke
 * suites and build-time have no request. A null here is not an error; it is
 * how a transaction knows there is nothing to announce.
 */
export const currentTenant = (): string | null => store.getStore() ?? null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The GUC statement, or null when there is no tenant to announce.
 *
 * The value is validated as a UUID before it is interpolated, and it has to
 * be interpolated: `set local` takes no bind parameters in Postgres. That
 * makes this the one place in the app where a value is concatenated into
 * SQL, so the shape check is not defensive politeness — it is the only thing
 * standing between a session claim and the statement text.
 */
export function tenantGuc(restaurantId: string | null): string | null {
  if (restaurantId === null) return null
  if (!UUID.test(restaurantId)) throw new Error('Refusing to announce a malformed tenant id')
  return `set local app.restaurant_id = '${restaurantId}'`
}
