'use server'

// Write side of the cashier group — all INSERT-only, corrections are
// negative twins (reverses_id), and LAW 2 is enforced here, not just in
// the pickers: partner, payment mode and non-revenue reason must be ACTIVE
// list_options values. Free text survives only in descriptions and notes.
//
// Non-revenue is where giveaways finally cost something: picking a dish
// FREEZES cost_value from dish_costs at save — the cashier never types a
// cost. Off-book CASH lands on the day's ladder through the view; nothing
// here re-adds it.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getList } from '@/server/settings'
import { noteListSuggestion } from '@/server/settings-actions'
import {
  getDue,
  getDuesOutstanding,
  getNonRevenue,
  getOffBook,
  getPartner,
  getSettlement,
  listPartners,
} from '@/server/cashier-queries'
import { parseMoney, parseQty } from '@/lib/money'
import type { ListKey } from '@/lib/lists'
import type {
  SaveDueInput,
  SaveDueResult,
  SaveNonRevenueInput,
  SaveNonRevenueResult,
  SaveOffBookInput,
  SaveOffBookResult,
  SavePartnerInput,
  SavePartnerResult,
  SaveSettlementInput,
  SaveSettlementResult,
  VoidDueResult,
  VoidNonRevenueResult,
  VoidOffBookResult,
  VoidSettlementResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const moneyStr = z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')
const optionalMoney = z.union([z.literal(''), moneyStr])

class CashierError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof CashierError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('cashier action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new CashierError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new CashierError(`${label} is out of range`)
}

/** LAW 2 at the write path: the value must be on the ACTIVE list. */
/** Accept a list value, recording it as a suggestion when it is new.
 *  The entry is never blocked — see noteListSuggestion for why. */
async function acceptListValue(restaurantId: string, key: ListKey, value: string, label: string) {
  const clean = value.trim()
  if (clean === '') throw new CashierError(`${label} is required`)
  const approved = await getList(restaurantId, key)
  if (!approved.some((v) => v.toLowerCase() === clean.toLowerCase())) {
    await noteListSuggestion(restaurantId, key, clean, await enteredBy())
  }
  return clean
}


const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ')

// ------------------------------------------------------------ settlements

const SettlementSchema = z.object({
  partner: z.string().trim().min(1, 'Pick the partner').max(60),
  periodStart: z.string().regex(DATE_RE),
  periodEnd: z.string().regex(DATE_RE),
  grossSales: moneyStr,
  commission: optionalMoney,
  otherDeductions: optionalMoney,
  amountReceived: optionalMoney,
  receivedDate: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  note: z.string().trim().max(300),
  // The two sides of the gap. Both optional: a settlement filed before the
  // statement arrives has our figure and not theirs, and `gap` (a GENERATED
  // column) must not pretend otherwise — the dashboard counts those as
  // `uncompared` rather than treating a missing side as zero.
  billedByUs: optionalMoney,
  claimedByThem: optionalMoney,
  /** their statement or UTR number — what you quote when disputing */
  reference: z.string().trim().max(80),
  deductions: z
    .array(
      z.object({
        type: z.string().trim().min(1).max(60),
        amount: moneyStr,
        note: z.string().trim().max(200),
      }),
    )
    .max(20),
})

export async function saveSettlement(raw: SaveSettlementInput): Promise<SaveSettlementResult> {
  try {
    const input = SettlementSchema.parse(raw)
    assertRealDate(input.periodStart, 'Period start')
    assertRealDate(input.periodEnd, 'Period end')
    if (input.periodStart > input.periodEnd) throw new CashierError('The period ends before it starts')
    if (input.receivedDate !== '') assertRealDate(input.receivedDate, 'Received date')
    if (input.receivedDate !== '' && input.amountReceived === '') {
      throw new CashierError('A received date needs its amount')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // The partner comes from the partners MASTER, not from list_options. The
    // master is what carries agreed_commission_pct, and matching on the name
    // is what lets the gap card say "took 26.4% against 24% agreed".
    const partners = await listPartners(rid)
    const match = partners.find((p) => p.name.trim().toLowerCase() === input.partner.trim().toLowerCase())
    if (!match) {
      throw new CashierError(
        `“${input.partner}” is not a partner on file — add it under Sales → Partners, with the commission you agreed`,
      )
    }

    for (const d of input.deductions) {
      await acceptListValue(rid, 'settlement_deduction', d.type, 'Deduction type')
    }
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ id: string }[]>`
        insert into partner_settlements (restaurant_id, partner, period_start, period_end,
                                         gross_sales, commission, other_deductions,
                                         amount_received, received_date, note, entered_by,
                                         billed_by_us, claimed_by_them)
        values (${rid}, ${match.name}, ${input.periodStart}, ${input.periodEnd},
                ${input.grossSales},
                ${input.commission === '' ? null : input.commission},
                ${input.otherDeductions === '' ? null : input.otherDeductions},
                ${input.amountReceived === '' ? null : input.amountReceived},
                ${input.receivedDate === '' ? null : input.receivedDate},
                ${input.note === '' ? null : input.note}, ${by},
                ${input.billedByUs === '' ? null : input.billedByUs},
                ${input.claimedByThem === '' ? null : input.claimedByThem},
                ${input.reference === '' ? null : input.reference})
        returning id`
      if (input.deductions.length > 0) {
        const rows = input.deductions.map((d) => ({
          settlement_id: row.id,
          deduction_type: d.type,
          amount: d.amount,
          note: d.note === '' ? null : d.note,
        }))
        await tx`insert into settlement_deductions ${tx(rows, 'settlement_id', 'deduction_type', 'amount', 'note')}`
      }
      return { id: row.id }
    })

    const settlement = await getSettlement(rid, saved.id)
    if (!settlement) throw new CashierError('Could not verify the save — settlement missing after commit')
    return { ok: true, settlement }
  } catch (e) {
    return fail(e)
  }
}

export async function voidSettlement(id: string): Promise<VoidSettlementResult> {
  try {
    if (!UUID.test(id)) throw new CashierError('Malformed settlement id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from partner_settlements where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new CashierError('Settlement not found')
      if (orig.reverses_id !== null) throw new CashierError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from partner_settlements where reverses_id = ${id} limit 1`
      if (already[0]) throw new CashierError('This settlement is already voided')
      const [rev] = await tx<{ id: string }[]>`
        insert into partner_settlements (restaurant_id, partner, period_start, period_end,
                                         gross_sales, commission, other_deductions,
                                         amount_received, received_date, note, reverses_id, entered_by)
        select restaurant_id, partner, period_start, period_end,
               -gross_sales, -commission, -other_deductions, -amount_received,
               received_date, 'void', id, ${by}
        from partner_settlements where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select (coalesce((select gross_sales + coalesce(commission,0) + coalesce(other_deductions,0) + coalesce(amount_received,0)
                          from partner_settlements where id = ${id}), 0)
              + coalesce((select gross_sales + coalesce(commission,0) + coalesce(other_deductions,0) + coalesce(amount_received,0)
                          from partner_settlements where id = ${rev.id}), 0) = 0) as zeroed`
      if (!check?.zeroed) throw new CashierError('Verification failed: settlement values do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getSettlement(rid, id), getSettlement(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new CashierError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

// -------------------------------------------------------- off-book orders

const OffBookSchema = z.object({
  date: z.string().regex(DATE_RE),
  description: z.string().trim().max(200),
  amount: moneyStr,
  paymentMode: z.string().trim().min(1, 'Pick how it was paid').max(30),
  note: z.string().trim().max(300),
  customer: z.string().trim().max(120),
  receivedInto: z.string().trim().max(60),
})

export async function saveOffBook(raw: SaveOffBookInput): Promise<SaveOffBookResult> {
  try {
    const input = OffBookSchema.parse(raw)
    assertRealDate(input.date, 'Order date')
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new CashierError('Amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await acceptListValue(rid, 'payment_mode', input.paymentMode, 'Payment mode')
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [row] = await tx<{ id: string }[]>`
        insert into off_book_orders (restaurant_id, order_date, description, amount, payment_mode, note, entered_by,
                                     customer, received_into)
        values (${rid}, ${input.date}, ${input.description === '' ? null : input.description},
                ${input.amount}, ${input.paymentMode}, ${input.note === '' ? null : input.note}, ${by},
                ${input.customer === '' ? null : input.customer},
                ${input.receivedInto === '' ? null : input.receivedInto})
        returning id`
      return { id: row.id }
    })

    const order = await getOffBook(rid, saved.id)
    if (!order) throw new CashierError('Could not verify the save — off-book order missing after commit')
    return { ok: true, order }
  } catch (e) {
    return fail(e)
  }
}

export async function voidOffBook(id: string): Promise<VoidOffBookResult> {
  try {
    if (!UUID.test(id)) throw new CashierError('Malformed order id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from off_book_orders where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new CashierError('Off-book order not found')
      if (orig.reverses_id !== null) throw new CashierError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from off_book_orders where reverses_id = ${id} limit 1`
      if (already[0]) throw new CashierError('This order is already voided')
      const [rev] = await tx<{ id: string }[]>`
        insert into off_book_orders (restaurant_id, order_date, description, amount, payment_mode, note, reverses_id, entered_by)
        select restaurant_id, order_date, description, -amount, payment_mode, 'void', id, ${by}
        from off_book_orders where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select ((select amount from off_book_orders where id = ${id})
              + (select amount from off_book_orders where id = ${rev.id}) = 0) as zeroed`
      if (!check?.zeroed) throw new CashierError('Verification failed: amounts do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getOffBook(rid, id), getOffBook(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new CashierError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------ non-revenue

const NonRevenueSchema = z.object({
  date: z.string().regex(DATE_RE),
  reason: z.string().trim().min(1, 'Pick the reason').max(60),
  recipeId: z.union([z.literal(''), z.string().regex(UUID)]),
  description: z.string().trim().max(200),
  qty: z.string().trim().max(12),
  menuValue: optionalMoney,
  givenTo: z.string().trim().max(120),
  note: z.string().trim().max(300),
})

export async function saveNonRevenue(raw: SaveNonRevenueInput): Promise<SaveNonRevenueResult> {
  try {
    const input = NonRevenueSchema.parse(raw)
    assertRealDate(input.date, 'Date')
    if (input.recipeId === '' && input.description === '') {
      throw new CashierError('Pick the dish or describe what went out')
    }
    let qty: string | null = null
    if (input.recipeId !== '') {
      qty = input.qty === '' ? '1' : input.qty
      const q = parseQty(qty)
      if (q === null || q <= 0) throw new CashierError('Quantity must be a plain number more than zero')
    } else if (input.qty !== '') {
      throw new CashierError('A quantity needs its dish — use the description for the rest')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await acceptListValue(rid, 'non_revenue_reason', input.reason, 'Reason')
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      let costValue = '0'
      if (input.recipeId !== '') {
        const [dish] = await tx<{ name: string; kind: string; cost: string | null }[]>`
          select r.name, r.kind, dc.dish_cost::text as cost
          from recipes r
          left join dish_costs dc on dc.recipe_id = r.id
          where r.id = ${input.recipeId} and r.restaurant_id = ${rid} and r.status = 'active'`
        if (!dish) throw new CashierError('Dish not found')
        if (dish.kind !== 'dish') throw new CashierError(`“${dish.name}” is not a dish — giveaways go out as dishes`)
        if (dish.cost === null) throw new CashierError(`“${dish.name}” cannot be costed yet — its recipe has no lines`)
        // FROZEN at save: the giveaway finally costs something.
        const [v] = await tx<{ v: string }[]>`select (${qty}::numeric * ${dish.cost}::numeric)::text as v`
        costValue = v.v
      }
      const [row] = await tx<{ id: string }[]>`
        insert into non_revenue (restaurant_id, nr_date, reason, recipe_id, description, qty,
                                 menu_value, cost_value, given_to, note, entered_by)
        values (${rid}, ${input.date}, ${input.reason},
                ${input.recipeId === '' ? null : input.recipeId},
                ${input.description === '' ? null : input.description},
                ${qty},
                ${input.menuValue === '' ? null : input.menuValue},
                ${costValue},
                ${input.givenTo === '' ? null : cleanName(input.givenTo)},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      return { id: row.id }
    })

    const entry = await getNonRevenue(rid, saved.id)
    if (!entry) throw new CashierError('Could not verify the save — entry missing after commit')
    return { ok: true, entry }
  } catch (e) {
    return fail(e)
  }
}

export async function voidNonRevenue(id: string): Promise<VoidNonRevenueResult> {
  try {
    if (!UUID.test(id)) throw new CashierError('Malformed entry id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from non_revenue where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new CashierError('Entry not found')
      if (orig.reverses_id !== null) throw new CashierError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from non_revenue where reverses_id = ${id} limit 1`
      if (already[0]) throw new CashierError('This entry is already voided')
      // Negative twin: cost_value copied EXACTLY (negated) — never re-frozen.
      const [rev] = await tx<{ id: string }[]>`
        insert into non_revenue (restaurant_id, nr_date, reason, recipe_id, description, qty,
                                 menu_value, cost_value, given_to, note, reverses_id, entered_by)
        select restaurant_id, nr_date, reason, recipe_id, description, -qty,
               -menu_value, -cost_value, given_to, 'void', id, ${by}
        from non_revenue where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select ((select cost_value from non_revenue where id = ${id})
              + (select cost_value from non_revenue where id = ${rev.id}) = 0) as zeroed`
      if (!check?.zeroed) throw new CashierError('Verification failed: cost values do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getNonRevenue(rid, id), getNonRevenue(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new CashierError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------------- dues

const DueSchema = z.object({
  date: z.string().regex(DATE_RE),
  party: z.string().trim().min(1, 'Whose account is this?').max(120),
  amount: moneyStr,
  direction: z.enum(['given', 'received']),
  againstWhat: z.string().trim().max(200),
  ref: z.string().trim().max(60),
  note: z.string().trim().max(300),
})

export async function saveDue(raw: SaveDueInput): Promise<SaveDueResult> {
  try {
    const input = DueSchema.parse(raw)
    assertRealDate(input.date, 'Date')
    const amount = parseMoney(input.amount)
    if (amount === null || amount <= 0) throw new CashierError('Amount must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // positive = credit given, negative = received back — sign carries direction
      const [row] = await tx<{ id: string }[]>`
        insert into due_payments (restaurant_id, due_date, party, amount, against_what, ref, note, entered_by)
        values (${rid}, ${input.date}, ${cleanName(input.party)},
                ${input.direction === 'given' ? input.amount : '-' + input.amount},
                ${input.againstWhat === '' ? null : input.againstWhat},
                ${input.ref === '' ? null : input.ref},
                ${input.note === '' ? null : input.note}, ${by})
        returning id`
      return { id: row.id }
    })

    const due = await getDue(rid, saved.id)
    if (!due) throw new CashierError('Could not verify the save — due entry missing after commit')
    return { ok: true, due, outstanding: await getDuesOutstanding(rid) }
  } catch (e) {
    return fail(e)
  }
}

export async function voidDue(id: string): Promise<VoidDueResult> {
  try {
    if (!UUID.test(id)) throw new CashierError('Malformed due id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [orig] = await tx<{ id: string; reverses_id: string | null }[]>`
        select id, reverses_id from due_payments where id = ${id} and restaurant_id = ${rid}`
      if (!orig) throw new CashierError('Due entry not found')
      if (orig.reverses_id !== null) throw new CashierError('This is a reversal — reversals cannot be voided')
      const already = await tx<{ id: string }[]>`select id from due_payments where reverses_id = ${id} limit 1`
      if (already[0]) throw new CashierError('This entry is already voided')
      const [rev] = await tx<{ id: string }[]>`
        insert into due_payments (restaurant_id, due_date, party, amount, against_what, ref, note, reverses_id, entered_by)
        select restaurant_id, due_date, party, -amount, against_what, ref, 'void', id, ${by}
        from due_payments where id = ${id}
        returning id`
      const [check] = await tx<{ zeroed: boolean }[]>`
        select ((select amount from due_payments where id = ${id})
              + (select amount from due_payments where id = ${rev.id}) = 0) as zeroed`
      if (!check?.zeroed) throw new CashierError('Verification failed: amounts do not cancel to zero')
      return { revId: rev.id }
    })

    const [original, reversal] = await Promise.all([getDue(rid, id), getDue(rid, saved.revId)])
    if (!original || !reversal || !original.is_voided) {
      throw new CashierError('Verification failed: could not read the voided pair back')
    }
    return { ok: true, original, reversal }
  } catch (e) {
    return fail(e)
  }
}

// ───────────────────────────── the partners master ────────────────────────
// A master, so: born here, retired never deleted, and column-granted edits
// only (name, kind, agreed_commission_pct, status).

const PartnerSchema = z.object({
  name: z.string().trim().min(1, 'Name the partner').max(80),
  kind: z.string().trim().min(1, 'Say what kind').max(40),
  agreedCommissionPct: z.union([z.literal(''), z.string().regex(/^\d{1,3}(\.\d{1,2})?$/)]),
  status: z.enum(['active', 'inactive']),
})

export async function createPartner(raw: SavePartnerInput): Promise<SavePartnerResult> {
  try {
    const input = PartnerSchema.parse(raw)
    if (input.agreedCommissionPct !== '' && Number(input.agreedCommissionPct) > 100) {
      throw new CashierError('A commission is a percentage — 100 max')
    }
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const saved = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const dup = await tx<{ id: string }[]>`
        select id from partners
        where restaurant_id = ${rid} and lower(trim(name)) = ${input.name.toLowerCase()}`
      if (dup[0]) throw new CashierError(`“${input.name}” is already a partner`)
      const [row] = await tx<{ id: string }[]>`
        insert into partners (restaurant_id, name, kind, agreed_commission_pct, status)
        values (${rid}, ${input.name}, ${input.kind},
                ${input.agreedCommissionPct === '' ? null : input.agreedCommissionPct}::numeric,
                ${input.status})
        returning id`
      return { id: row.id }
    })

    const partner = await getPartner(rid, saved.id)
    if (!partner) throw new CashierError('Could not verify the save — partner missing after commit')
    return { ok: true, partner }
  } catch (e) {
    return fail(e)
  }
}

export async function updatePartner(id: string, raw: SavePartnerInput): Promise<SavePartnerResult> {
  try {
    if (!UUID.test(id)) throw new CashierError('Malformed partner id')
    const input = PartnerSchema.parse(raw)
    if (input.agreedCommissionPct !== '' && Number(input.agreedCommissionPct) > 100) {
      throw new CashierError('A commission is a percentage — 100 max')
    }
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // Only the column-granted fields ever appear in this SET.
    const updated = await sql<{ id: string }[]>`
      update partners set
        name = ${input.name},
        kind = ${input.kind},
        agreed_commission_pct = ${input.agreedCommissionPct === '' ? null : input.agreedCommissionPct}::numeric,
        status = ${input.status}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new CashierError('Partner not found — nothing was changed')

    const partner = await getPartner(rid, id)
    if (!partner) throw new CashierError('Could not read the partner back after saving')
    return { ok: true, partner }
  } catch (e) {
    return fail(e)
  }
}
