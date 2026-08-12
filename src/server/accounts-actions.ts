'use server'

// The money-account master. Owner and accountant only — this is the list
// every money form points at, so a careless edit here mislabels the books.
//
// SEED NOTHING. Rajesh names his own accounts: "Petty cash drawer", "ICICI
// current", "Paytm". A shipped list of guesses would be wrong in every
// restaurant and wrong in a different way in every country.

import { z } from 'zod'
import { sql, tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getMoneyAccount } from '@/server/accounts-queries'
import type { SaveMoneyAccountInput, SaveMoneyAccountResult } from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class AccountError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof AccountError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('account action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}


/** ONE TILL, and the refusal is not fussiness. `account_balances` resolves a
 *  till's balance by joining `day_close_current` for the RESTAURANT — not for
 *  the account — so a second till would silently wear the same counted cash as
 *  the first, and two accounts would each claim to hold the whole drawer.
 *
 *  Checked at both call sites rather than through a shared helper: the pool
 *  and a transaction are different types in this driver, and one readable
 *  query each beats a generic that has to be argued with. */
const tillTaken = (name: string) =>
  new AccountError(
    `“${name}” is already the till. Only one account can be, because a till's balance is the counted cash from the day close and two of them would each claim the whole drawer.`,
  )

const AccountSchema = z.object({
  name: z.string().trim().min(1, 'Name the account').max(80),
  kind: z.enum(['cash', 'bank', 'wallet', 'card_settlement', 'owner', 'other']),
  identifier: z.string().trim().max(80),
  openingBalance: z.union([z.literal(''), z.string().regex(/^-?\d{1,11}(\.\d{1,2})?$/)]),
  openingDate: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  sortOrder: z.union([z.literal(''), z.string().regex(/^\d{1,4}$/)]),
  status: z.enum(['active', 'inactive']),
  isTill: z.boolean(),
})

export async function createMoneyAccount(raw: SaveMoneyAccountInput): Promise<SaveMoneyAccountResult> {
  try {
    const input = AccountSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [dup] = await tx<{ id: string }[]>`
        select id from money_accounts
        where restaurant_id = ${rid} and lower(trim(name)) = ${input.name.toLowerCase()}`
      if (dup) throw new AccountError(`“${input.name}” is already an account`)
      if (input.isTill) {
        const [taken] = await tx<{ name: string }[]>`
          select name from money_accounts
          where restaurant_id = ${rid} and is_till and status = 'active'`
        if (taken) throw tillTaken(taken.name)
      }
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(sort_order), 0) + 1 as next from money_accounts where restaurant_id = ${rid}`
      const [row] = await tx<{ id: string }[]>`
        insert into money_accounts (restaurant_id, name, kind, identifier,
                                    opening_balance, opening_date, sort_order, status, is_till)
        values (${rid}, ${input.name}, ${input.kind},
                ${input.identifier === '' ? null : input.identifier},
                ${input.openingBalance === '' ? '0' : input.openingBalance}::numeric,
                ${input.openingDate === '' ? null : input.openingDate}::date,
                ${input.sortOrder === '' ? next : Number(input.sortOrder)}, ${input.status},
                ${input.isTill})
        returning id`
      return { id: row.id }
    })

    const account = await getMoneyAccount(rid, saved.id)
    if (!account) throw new AccountError('Could not verify the save — account missing after commit')
    return { ok: true, account }
  } catch (e) {
    return fail(e)
  }
}

export async function updateMoneyAccount(
  id: string,
  raw: SaveMoneyAccountInput,
): Promise<SaveMoneyAccountResult> {
  try {
    if (!UUID.test(id)) throw new AccountError('Malformed account id')
    const input = AccountSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    if (input.isTill) {
      const [taken] = await tsql<{ name: string }[]>`
        select name from money_accounts
        where restaurant_id = ${rid} and is_till and status = 'active' and id <> ${id}`
      if (taken) throw tillTaken(taken.name)
    }

    // kind is absent: an account's TYPE is what every register groups by,
    // and re-typing a bank as cash retroactively rewrites which column its
    // history sits in. Retire it and open a new one instead.
    const updated = await tsql<{ id: string }[]>`
      update money_accounts set
        name = ${input.name},
        identifier = ${input.identifier === '' ? null : input.identifier},
        opening_balance = ${input.openingBalance === '' ? '0' : input.openingBalance}::numeric,
        opening_date = ${input.openingDate === '' ? null : input.openingDate}::date,
        sort_order = ${input.sortOrder === '' ? sql`sort_order` : Number(input.sortOrder)},
        status = ${input.status},
        is_till = ${input.isTill}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new AccountError('Account not found — nothing was changed')

    const account = await getMoneyAccount(rid, id)
    if (!account) throw new AccountError('Could not read the account back after saving')
    return { ok: true, account }
  } catch (e) {
    return fail(e)
  }
}
