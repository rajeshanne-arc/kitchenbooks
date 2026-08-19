'use server'

// The two settings that change what a DATE MEANS.
//
// Both have existed in the database since the business-day migration and
// neither had a UI, so a restaurant that closes at 2am had no way to say so
// and one outside India had no way to say where it is.
//
// THESE ARE NOT APPEARANCE SETTINGS. `business_date(timestamptz)` reads both,
// so changing either changes which day an order, an issue or a close is filed
// under FROM NOW ON — and changes what `business_day_disagreements` computes
// for orders already stored. Stored dates do not move; their interpretation
// does. The screen says that before the save, not after.

import { txn, tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

// NOT exported: a 'use server' file may only export async functions, and an
// exported class here fails the build. Nothing outside needs it.
class BusinessDayError extends Error {}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof BusinessDayError) return { ok: false, error: e.message }
  console.error('business day setting failed', e)
  return { ok: false, error: 'Failed — nothing was changed.' }
}

/** Owner only. A server action is a public endpoint and the route gate is not
 *  the check — and this one decides what every date in the books means. */
async function ownerOnly(): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new BusinessDayError('Sign in again — the session has expired')
  if (user.role !== 'owner') {
    throw new BusinessDayError('Only an owner can change the timezone or the business day — ask them')
  }
  return user.username
}

export async function saveBusinessDay(
  timezone: string,
  businessDayStart: string,
): Promise<{ ok: true; timezone: string; businessDayStart: string } | { ok: false; error: string }> {
  try {
    await ownerOnly()
    const tz = timezone.trim()
    const start = businessDayStart.trim()

    if (!TIME_RE.test(start)) {
      throw new BusinessDayError('The business day start must be a 24-hour time like 05:00')
    }

    // VALIDATED AGAINST POSTGRES, not against a list in this file. The function
    // that uses it runs `at time zone <value>` in SQL, so the only authority on
    // whether a name works is the database's own catalogue — a zone Node
    // accepts and Postgres does not would raise on every read afterwards.
    const known = await tsql<{ name: string }[]>`
      select name from pg_timezone_names where name = ${tz}`
    if (!known[0]) {
      throw new BusinessDayError(
        `“${tz}” is not a timezone this database knows. Use an IANA name such as Asia/Kolkata.`,
      )
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      for (const [key, value] of [
        ['timezone', tz],
        ['business_day_start', start],
      ] as const) {
        await tx`
          insert into settings (restaurant_id, key, value)
          values (${rid}, ${key}, ${value})
          on conflict (restaurant_id, key) do update set value = excluded.value`
      }
    })

    // Read back, because this decides what every date means and an unverified
    // save here is a silent change of meaning.
    const [check] = await tsql<{ tz: string | null; start: string | null }[]>`
      select (select value from settings where restaurant_id = ${rid} and key = 'timezone') as tz,
             (select value from settings where restaurant_id = ${rid} and key = 'business_day_start') as start`
    if (check?.tz !== tz || check?.start !== start) {
      throw new BusinessDayError('Could not verify the change — reload and check before relying on it')
    }
    return { ok: true, timezone: tz, businessDayStart: start }
  } catch (e) {
    return fail(e)
  }
}
