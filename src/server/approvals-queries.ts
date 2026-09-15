// DISCARD AND MERGE — the reads, the preview, and the refusals in words.
//
// Deliberately NOT a 'use server' file: every export from one of those is a
// public endpoint, and `assertApprover` in particular must not be callable
// from a browser. Same reasoning as accounts-queries.ts.
//
// THE LINE THAT DECIDES WHAT COMES HERE AT ALL:
//
//   AN ACTION THAT LEAVES A TRACE NEEDS NO PERMISSION;
//   AN ACTION THAT LEAVES NONE NEEDS APPROVAL.
//
// A void writes a negative twin. A retirement leaves the row and its whole
// history. A corrected attendance mark keeps both marks and lets the view pick
// the winner. Every one of those is traceable by construction, so none of them
// goes through approvals — and none ever should. A correction that is
// inconvenient is a correction that does not happen, and the moment somebody
// has to ask permission to fix a number they will leave it wrong instead.
//
// Discarding and merging leave nothing behind unless something is written on
// purpose. That is the whole of why they are here and nothing else is.

import 'server-only'
import type postgres from 'postgres'
import { tsql } from '@/lib/db'
import { getSessionUser } from '@/server/current-user'
import type { Role } from '@/lib/roles'
import { overlaps, type DateRange } from '@/lib/bill-range'
import { fmtDateTime, fmtDayDate, fmtRange } from '@/lib/format'
import { decimalStringToPaise, formatPaise } from '@/lib/money'

export class ApprovalRefusal extends Error {}

/** kinds the app can actually apply today. `reopen_period` and `other` are in
 *  the CHECK constraint and have no mechanic yet; a request of that kind can be
 *  raised by a future phase but this app will not try to apply one. */
export const APPLIABLE_KINDS = ['discard', 'merge', 'reopen_period'] as const
export type ApprovalKind = (typeof APPLIABLE_KINDS)[number]
export type ApprovalEntity =
  | 'item'
  | 'vendor'
  | 'recipe'
  | 'account'
  | 'meter'
  | 'location'
  | 'list_value'
  | 'period'

/**
 * WHAT EACH KIND OF ROW IS CALLED, WHICH TABLE HOLDS IT, AND WHETHER IT CAN BE
 * MERGED AT ALL.
 *
 * `mergeable` is not a policy — it is a fact about the schema. Only items,
 * vendors and recipes carry `merged_into` and have a merge_* function, so only
 * they can point somewhere after they close. The other four can be DISCARDED,
 * which needs nothing but a status, and offering them a merge would be
 * offering a button whose action does not exist.
 */
export const ENTITIES: Record<ApprovalEntity, { table: string; noun: string; mergeable: boolean }> = {
  item: { table: 'items', noun: 'item', mergeable: true },
  vendor: { table: 'vendors', noun: 'vendor', mergeable: true },
  recipe: { table: 'recipes', noun: 'recipe', mergeable: true },
  account: { table: 'money_accounts', noun: 'money account', mergeable: false },
  meter: { table: 'meters', noun: 'meter', mergeable: false },
  location: { table: 'storage_locations', noun: 'storage location', mergeable: false },
  list_value: { table: 'list_options', noun: 'list value', mergeable: false },
  period: { table: 'period_closes', noun: 'period', mergeable: false },
}

/**
 * WHO ASKS, AND WHO DECIDES — and the rule generalises past this screen:
 *
 *   an action that changes what the FUTURE offers belongs to whoever runs the
 *   future; an action that changes what the PAST says belongs to the owner.
 *
 * Closing a duplicate code changes both — the picker stops offering it, and
 * thirteen tables of history start pointing somewhere else — so it is split:
 * the people at the shelf raise it, the owner decides it.
 *
 * The chef is on this list and cannot reach the item master today, so the
 * grant is inert. It is stated anyway because the rule is about ROLES, not
 * routes: the day a chef-side entity becomes mergeable, adding a role to a
 * permission list is a change nobody reviews, and this one has been argued.
 */
export const REQUESTERS: Role[] = ['store', 'chef', 'manager', 'owner']
export const DECIDERS: Role[] = ['owner']

async function actor(allowed: Role[], what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new ApprovalRefusal('Sign in again — the session has expired')
  if (!allowed.includes(user.role)) throw new ApprovalRefusal(what)
  return user.username
}

/**
 * The roles a payment can be handed to. NOT every role in the matrix: the chef
 * and the cashier have no reason to make a vendor transfer, and a queue
 * somebody cannot act on is a badge they learn to dismiss.
 */
export const PAYERS = ['owner', 'accountant', 'store'] as const

export const assertRequester = () =>
  actor(REQUESTERS, 'Raising this is the store’s job — ask them or a manager')
export const assertApprover = () =>
  actor(DECIDERS, 'Only an owner can approve this — it changes what the books already say')

/**
 * THE ROLE IS CHECKED BEFORE THE ROW IS READ.
 *
 * `assertAssignee` needs `assigned_to`, which needs the row — so on its own it
 * would have every one of these public endpoints answer "that request is
 * applied" to anybody signed in who guessed an id. This is the cheap gate that
 * runs first; the precise one runs after the read.
 */
export const assertPayer = async (): Promise<{ username: string; role: Role }> => {
  const username = await actor(
    [...PAYERS] as Role[],
    'Acting on a payment is the owner’s, the accountant’s or the store’s',
  )
  // THE ROLE COMES BACK TOO, because the guard that runs under the row lock
  // needs it and must not read the session itself. A guard that does its own
  // authentication cannot be exercised from a script — getSessionUser returns
  // null outside a request — so it would refuse for the wrong reason and any
  // gate over it would pass while proving nothing. Hand it the actor.
  const user = await getSessionUser()
  return { username, role: (user as { role: Role }).role }
}

// ───────────────────────────────────────────────────── what points at a row

export type RefCount = {
  referencing_table: string
  referencing_column: string
  n: number
  /**
   * A MERGE POINTER, NOT A ROW OF HISTORY.
   *
   * After a merge the survivor picks up a reference from the row that closed
   * into it — `items.merged_into`. On the preview that arrives as "items: 1",
   * which reads as a bill or a count unless somebody knows the schema. It is
   * the opposite: it is the thing that keeps the old code RESOLVABLE.
   *
   * The test is exact rather than "the table matches": `items.item_id` on a
   * self-join would be history, and a vendor is pointed at by
   * `items.default_vendor_id` from another table entirely, which is a real
   * reference. Only same-table `merged_into` is a pointer.
   */
  pointer: boolean
}

/**
 * Every table that points at this row, with its count — DERIVED FROM
 * pg_constraint by `reference_counts`, never from a list here.
 *
 * Items are referenced by THIRTEEN tables through FOUR differently-named
 * columns (`item_id`, `component_item_id`, `merged_into`, `default_vendor_id`
 * on the vendor side). A hand-written guard would have missed one, and this is
 * the hand-maintained-copy fault in the one place where it destroys rather
 * than merely misleads: a reference nobody counted is a row that survives a
 * discard pointing at something that is gone.
 *
 * `reference_counts` is SECURITY INVOKER, so RLS applies and it must be called
 * inside a tenant-announcing transaction — which tsql is.
 */
export async function getReferenceCounts(table: string, id: string): Promise<RefCount[]> {
  const rows = await tsql<Omit<RefCount, 'pointer'>[]>`
    select referencing_table, referencing_column, n::int as n
    from reference_counts(${table}, ${id}::uuid)
    order by n desc, referencing_table`
  return rows.map((r) => ({
    ...r,
    pointer: r.referencing_table === table && r.referencing_column === 'merged_into',
  }))
}

// ───────────────────────────────────────────────────────────── the preview

export type MergeCheck = { ok: boolean; label: string; detail: string }

export type MasterRef = {
  id: string
  code: string
  name: string
  status: string
  /** Absent on a period, which has no units and no unit rule. */
  purchase_unit?: string
  stock_unit?: string | null
}

export type Preview = {
  kind: ApprovalKind
  entity: ApprovalEntity
  from: MasterRef
  to: MasterRef | null
  refs: RefCount[]
  totalRefs: number
  /** what the surviving row's weighted average becomes. Null where it cannot
   *  be stated — see the comment on the query. */
  cost: { before: string | null; after: string | null } | null
  checks: MergeCheck[]
  /** every check passed, so the function would apply this today */
  wouldApply: boolean
}

/**
 * The row, in the two words every screen needs: a code and a name.
 *
 * EIGHT LITERAL QUERIES RATHER THAN ONE INTERPOLATED TABLE NAME. A dynamic
 * identifier would be shorter and would make every statement here invisible to
 * audit:schema and audit:tenancy, which read literal SQL. The repetition buys
 * two gates that can see what this does.
 */
async function readMaster(
  restaurantId: string,
  entity: ApprovalEntity,
  id: string,
): Promise<MasterRef | null> {
  const rows =
    entity === 'item'
      ? await tsql<MasterRef[]>`
          select id, code, name, status, purchase_unit, stock_unit
          from items where restaurant_id = ${restaurantId} and id = ${id}`
      : entity === 'vendor'
        ? await tsql<MasterRef[]>`
            select id, code, name, status, '—' as purchase_unit, null as stock_unit
            from vendors where restaurant_id = ${restaurantId} and id = ${id}`
        : entity === 'recipe'
          ? await tsql<MasterRef[]>`
              select id, code, name, status,
                     kind as purchase_unit, output_unit as stock_unit
              from recipes where restaurant_id = ${restaurantId} and id = ${id}`
          : entity === 'account'
            ? await tsql<MasterRef[]>`
                select id, kind as code, name, status from money_accounts
                where restaurant_id = ${restaurantId} and id = ${id}`
            : entity === 'meter'
              ? await tsql<MasterRef[]>`
                  select id, kind as code, name, status from meters
                  where restaurant_id = ${restaurantId} and id = ${id}`
              : entity === 'location'
                ? await tsql<MasterRef[]>`
                    select id, kind as code, name, status from storage_locations
                    where restaurant_id = ${restaurantId} and id = ${id}`
                : entity === 'list_value'
                  ? await tsql<MasterRef[]>`
                      select id, list_key as code, value as name, status from list_options
                      where restaurant_id = ${restaurantId} and id = ${id}`
                  : await tsql<MasterRef[]>`
                      select id,
                             to_char(period_start, 'YYYY-MM') as code,
                             to_char(period_start, 'FMMonth YYYY') || ' — closed ' || to_char(closed_at, 'DD Mon') ||
                               coalesce(' by ' || closed_by, '') as name,
                             case when reopened_at is null then 'closed' else 'reopened' end as status
                      from period_closes where restaurant_id = ${restaurantId} and id = ${id}`
  return rows[0] ?? null
}

/**
 * THE RECIPE GUARDS, MIRRORED FROM merge_recipes — and they are NOT the item
 * ones renamed.
 *
 * `kind` is this table's units rule: productions freezes unit_cost from
 * dish_costs.cost_per_portion for a dish and recipe_costs.cost_per_output_unit
 * for a sub, and a sub's output IS its batch yield where a dish's output_qty
 * means portions made. Merging across kinds silently reinterprets every frozen
 * cost that moves.
 *
 * And the CYCLE, which has no item analogue at all — see the comment on it.
 */
async function recipeChecks(restaurantId: string, fromId: string, toId: string): Promise<MergeCheck[]> {
  const [row] = await tsql<{
    kinds_differ: boolean
    from_kind: string
    to_kind: string
    units_differ: boolean
    from_unit: string
    to_unit: string
    card_clash: number
    pos_clash: number
    cycle: boolean
    survivor_status: string
  }[]>`
    select f.kind <> t.kind as kinds_differ, f.kind as from_kind, t.kind as to_kind,
           (f.kind = 'sub' and f.output_unit <> t.output_unit) as units_differ,
           f.output_unit as from_unit, t.output_unit as to_unit,
           (select count(*)::int from recipe_lines ca
              join recipe_lines cb on cb.recipe_id = ca.recipe_id
             where ca.component_recipe_id = f.id and cb.component_recipe_id = t.id) as card_clash,
           (select count(*)::int from pos_item_map pa
              join pos_item_map pb on pb.pos_item_id = pa.pos_item_id
             where pa.recipe_id = f.id and pb.recipe_id = t.id) as pos_clash,
           exists (
             with recursive down as (
               select component_recipe_id as rid, 1 as depth
               from recipe_lines where recipe_id = t.id and component_recipe_id is not null
               union all
               select rl.component_recipe_id, d.depth + 1
               from recipe_lines rl join down d on rl.recipe_id = d.rid
               where rl.component_recipe_id is not null and d.depth < 12
             )
             select 1 from down where rid = f.id
           ) as cycle,
           t.status as survivor_status
    from recipes f, recipes t
    where f.restaurant_id = ${restaurantId} and f.id = ${fromId}
      and t.restaurant_id = ${restaurantId} and t.id = ${toId}`
  if (!row) return [{ ok: false, label: 'Both recipes exist', detail: 'one of them is not on this restaurant' }]
  return [
    {
      ok: row.survivor_status === 'active',
      label: 'The survivor is active',
      detail:
        row.survivor_status === 'active'
          ? 'it is the card everything will point at'
          : `it is ${row.survivor_status} — merging into a closed card would move history onto a dead end`,
    },
    {
      ok: !row.kinds_differ,
      label: 'Both are the same kind',
      detail: row.kinds_differ
        ? `one is a ${row.from_kind} and the other a ${row.to_kind} — they are costed on different scales, so every frozen cost that moved would quietly change meaning`
        : `both are ${row.to_kind}s`,
    },
    {
      ok: !row.units_differ,
      label: 'The batch units match',
      detail: row.units_differ
        ? `${row.from_unit} against ${row.to_unit} — a quantity written against one would mean something else against the other`
        : `both batches are measured in ${row.to_unit}`,
    },
    {
      ok: row.card_clash === 0,
      label: 'No card holds both',
      detail:
        row.card_clash === 0
          ? 'no recipe would end up with the same sub twice'
          : `${row.card_clash} card(s) list both — take one line out first`,
    },
    {
      ok: row.pos_clash === 0,
      label: 'No POS item maps to both',
      detail: row.pos_clash === 0 ? 'nothing sold points at both' : `${row.pos_clash} POS item(s) map to both`,
    },
    {
      // AN OPERATION THAT COMBINES TWO VALID STATES CAN PRODUCE AN INVALID ONE,
      // and a per-insert guard cannot see it. Every component line here is
      // legal on its own; merging is what closes the loop.
      ok: !row.cycle,
      label: 'It would not contain itself',
      detail: row.cycle
        ? 'the surviving recipe already uses this one — merging them would make it an ingredient of itself'
        : 'neither is inside the other',
    },
  ]
}

/**
 * THE THREE CHECKS, MIRRORED FROM merge_items — and mirrored is the right
 * word: the FUNCTION is the authority and runs them again under a row lock at
 * the moment of applying. This is a courtesy to the reader, so that a request
 * that cannot succeed is not raised at all.
 *
 * The two can disagree legitimately, and that is the point of running them
 * twice: a check that passed on Tuesday has not passed on Thursday, because a
 * bill can land against the closing item in between. Where they disagree the
 * Approvals screen says so rather than hiding it.
 *
 * A gate probes both against the same fixtures and asserts they agree at the
 * moment they are both run, so the mirror cannot drift silently.
 */
async function itemChecks(restaurantId: string, fromId: string, toId: string): Promise<MergeCheck[]> {
  const [row] = await tsql<{
    units_differ: boolean
    from_units: string
    to_units: string
    recipe_clash: number
    pos_clash: number
    survivor_status: string
  }[]>`
    select (f.purchase_unit <> t.purchase_unit or f.stock_unit is distinct from t.stock_unit) as units_differ,
           f.purchase_unit || '/' || coalesce(f.stock_unit, '—') as from_units,
           t.purchase_unit || '/' || coalesce(t.stock_unit, '—') as to_units,
           -- DISTINCT ALIASES ACROSS THE TWO SUBQUERIES. Reusing a and b in
           -- both is valid SQL — each subquery has its own scope — and
           -- audit:schema resolved the second binding and reported
           -- pos_item_map.component_item_id as missing. Renamed rather than
           -- the gate taught to ignore it: the same ruling as the a.total
           -- collision on attendance_current. A gate that cries wolf is a gate
           -- people start ignoring, and an alias bound twice is confusing to a
           -- reader as well as to a scanner.
           (select count(*)::int from recipe_lines rl_from
              join recipe_lines rl_to on rl_to.recipe_id = rl_from.recipe_id
             where rl_from.component_item_id = f.id and rl_to.component_item_id = t.id) as recipe_clash,
           (select count(*)::int from pos_item_map pm_from
              join pos_item_map pm_to on pm_to.pos_item_id = pm_from.pos_item_id
             where pm_from.item_id = f.id and pm_to.item_id = t.id) as pos_clash,
           t.status as survivor_status
    from items f, items t
    where f.restaurant_id = ${restaurantId} and f.id = ${fromId}
      and t.restaurant_id = ${restaurantId} and t.id = ${toId}`
  if (!row) return [{ ok: false, label: 'Both rows exist', detail: 'One of them is not on this restaurant' }]
  return [
    {
      ok: row.survivor_status === 'active',
      label: 'The survivor is active',
      detail:
        row.survivor_status === 'active'
          ? 'it is the row everything will point at'
          : `it is ${row.survivor_status} — merging into a closed code would move history onto a dead end`,
    },
    {
      // UNITS FIRST, because it is the one that corrupts rather than confuses.
      ok: !row.units_differ,
      label: 'The units match',
      detail: row.units_differ
        ? `${row.from_units} against ${row.to_units} — merging these would silently change every quantity that moves`
        : `both are ${row.to_units}`,
    },
    {
      // THE CASE RESTAURANT365 REFUSES OVER. Their support article says items
      // cannot be merged because they are tied to transactions and recipes,
      // and their advice is to rename one "DO NOT USE". Transactions are
      // exactly what a merge is for; a recipe holding BOTH is the real
      // problem, because it would end up with two lines of one ingredient and
      // no way to tell which quantity was meant.
      ok: row.recipe_clash === 0,
      label: 'No recipe holds both',
      detail:
        row.recipe_clash === 0
          ? 'no card would end up with the same ingredient twice'
          : `${row.recipe_clash} recipe card(s) list both — take one line out first`,
    },
    {
      ok: row.pos_clash === 0,
      label: 'No POS item maps to both',
      detail:
        row.pos_clash === 0
          ? 'nothing sold points at both'
          : `${row.pos_clash} POS item(s) map to both — the same failure one layer up`,
    },
  ]
}

/**
 * What the survivor's weighted average becomes.
 *
 * `item_costs.wtd_avg_cost` is total landed ÷ total qty over every purchase
 * line, so a merge simply adds the closing item's lines to the survivor's and
 * the new average is exact arithmetic rather than an estimate.
 *
 * NULL where it cannot be stated: if neither row has ever been bought there is
 * no average to move, and "₹0.00 → ₹0.00" would read as a fact about price
 * rather than an absence of bills. The screen says which.
 */
async function costMove(
  restaurantId: string,
  fromId: string,
  toId: string,
): Promise<{ before: string | null; after: string | null } | null> {
  const [row] = await tsql<{ before: string | null; after: string | null }[]>`
    with agg as (
      select pl.item_id, sum(pl.qty) as qty, sum(pl.landed) as landed
      from purchase_lines pl
      where pl.restaurant_id = ${restaurantId} and pl.item_id in (${fromId}, ${toId})
      group by pl.item_id
    ),
    f as (select coalesce(qty, 0) q, coalesce(landed, 0) l from agg where item_id = ${toId}
          union all select 0, 0 where not exists (select 1 from agg where item_id = ${toId})),
    a as (select coalesce(sum(qty), 0) q, coalesce(sum(landed), 0) l from agg)
    select case when f.q <> 0 then round(f.l / f.q, 2)::text end as before,
           case when a.q <> 0 then round(a.l / a.q, 2)::text end as after
    from f, a`
  if (!row || (row.before === null && row.after === null)) return null
  return { before: row.before, after: row.after }
}

/**
 * THE PREVIEW IS THE FEATURE.
 *
 * The owner is being asked to approve something INVISIBLE: after a discard or
 * a merge there is no negative twin to read and no reversal to find, only a
 * status and a pointer. So the request has to carry, in advance, exactly what
 * moves and exactly what changes — every referencing table with its count, and
 * the figure that shifts — or the approval is a signature on a blank page.
 */
export async function getPreview(
  restaurantId: string,
  kind: ApprovalKind,
  entity: ApprovalEntity,
  fromId: string,
  toId: string | null,
): Promise<Preview> {
  const from = await readMaster(restaurantId, entity, fromId)
  if (!from) throw new ApprovalRefusal('That row is not on this restaurant')
  const table = ENTITIES[entity].table
  const refs = await getReferenceCounts(table, fromId)
  const totalRefs = refs.reduce((a, r) => a + r.n, 0)

  // ── reopening a closed month ─────────────────────────────────────────
  //
  // NO REFERENCE COUNTS HERE, because nothing points at a close — the close
  // is a STATEMENT that a period is finished, and reopening retracts the
  // statement. It leaves a trace of a sort (reopened_at / reopened_by /
  // reopen_reason are all recorded), which is why it took an argument to put
  // it behind approval at all: what it does NOT leave is any record that the
  // month was ever treated as final by whoever received it. The accountant
  // may already have handed it to a CA, and nothing in this database knows
  // that. That is the leaves-no-trace half.
  if (kind === 'reopen_period') {
    const alreadyOpen = from.status === 'reopened'
    return {
      kind,
      entity,
      from,
      to: null,
      refs: [],
      totalRefs: 0,
      cost: null,
      checks: [
        {
          ok: !alreadyOpen,
          label: 'It is closed',
          detail: alreadyOpen ? 'this period has already been reopened' : 'reopening retracts that',
        },
      ],
      wouldApply: !alreadyOpen,
    }
  }

  if (kind === 'discard') {
    // A POINTER IS A DIFFERENT REFUSAL FROM HISTORY, and it needs its own
    // sentence: "26 bills mention it" and "another code resolves here" are two
    // unrelated reasons not to discard, and the remedy differs. Both still
    // block — discarding a row something resolves to would leave that pointer
    // aimed at a code marked never-real.
    const pointers = refs.filter((r) => r.pointer).reduce((a, r) => a + r.n, 0)
    const history = totalRefs - pointers
    return {
      kind,
      entity,
      from,
      to: null,
      refs,
      totalRefs,
      cost: null,
      checks: [
        {
          // A DISCARD IS FOR SOMETHING THAT WAS NEVER REAL, and the test is
          // arithmetic rather than judgement: nothing may point at it. One
          // bill and it is not a mistake, it is history — retire it, or merge
          // it into whatever it should have been.
          ok: totalRefs === 0,
          label: 'Nothing points at it',
          detail:
            totalRefs === 0
              ? 'no bill, count, recipe, issue or correction mentions it'
              : history > 0
                ? `${history} row(s) in ${refs.filter((r) => !r.pointer).length} table(s) mention it — that is history, not a mistake. Retire it, or merge it into the code it should have been.`
                : `${pointers} closed code(s) resolve here — discarding this would leave them pointing at a row marked never-real. Merge it instead, and they follow.`,
        },
        {
          ok: from.status === 'active' || from.status === 'inactive',
          label: 'It is still open',
          detail:
            from.status === 'merged' || from.status === 'discarded'
              ? `it is already ${from.status}`
              : 'it has not been closed already',
        },
      ],
      wouldApply: totalRefs === 0 && (from.status === 'active' || from.status === 'inactive'),
    }
  }

  if (toId === null) throw new ApprovalRefusal('A merge needs the code that survives')
  if (toId === fromId) throw new ApprovalRefusal('A row cannot be merged into itself')
  const to = await readMaster(restaurantId, entity, toId)
  if (!to) throw new ApprovalRefusal('The surviving row is not on this restaurant')

  if (!ENTITIES[entity].mergeable) {
    // NOT A POLICY, A FACT ABOUT THE SCHEMA: no merged_into column and no
    // merge_* function, so there is nowhere for a closed row to point and
    // nothing to move the references with.
    throw new ApprovalRefusal(
      `A ${ENTITIES[entity].noun} cannot be merged — it carries no pointer to a survivor. Discard it, or retire it.`,
    )
  }

  const checks =
    entity === 'item'
      ? await itemChecks(restaurantId, fromId, toId)
      : entity === 'recipe'
        ? await recipeChecks(restaurantId, fromId, toId)
        : [
          {
            ok: to.status === 'active',
            label: 'The survivor is active',
            detail:
              to.status === 'active'
                ? 'it is the row everything will point at'
                : `it is ${to.status} — merging into a closed code would move history onto a dead end`,
          },
          {
            // A vendor has no units and no composition, only transactions —
            // which is exactly why Restaurant365 merges vendors while refusing
            // items. Opening balances ADD, because an opening balance is a
            // fact about a party and one party's debt does not vanish because
            // it was recorded under two names.
            ok: true,
            label: 'Opening balances add',
            detail: 'a debt recorded under two names is one debt',
          },
        ]
  const openAlready = from.status === 'merged' || from.status === 'discarded'
  checks.push({
    ok: !openAlready,
    label: 'It is still open',
    detail: openAlready ? `it is already ${from.status}` : 'it has not been closed already',
  })

  return {
    kind,
    entity,
    from,
    to,
    refs,
    totalRefs,
    cost: entity === 'item' ? await costMove(restaurantId, fromId, toId) : null,
    checks,
    wouldApply: checks.every((c) => c.ok),
  }
}

// ────────────────────────────────────────────────────────────── the queue

export type ApprovalRow = {
  id: string
  kind: string
  entity_type: string
  entity_id: string
  target_entity_id: string | null
  reason: string
  snapshot: unknown
  status: string
  requested_by: string | null
  requested_at: string
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  applied_at: string | null
  applied_result: unknown
  /** payment requests only — null on every other kind, because the CHECK on
   *  the column has to permit a null for them. */
  amount: string | null
  /**
   * WHICH BILLS THIS REQUEST IS ABOUT, and null on three kinds of row: every
   * non-payment request, and the payment requests raised before the range
   * existed.
   *
   * A NULL PAIR IS NOT A MISSING FIELD — it is a claim on the WHOLE BALANCE,
   * which is what a payment request meant before it could name a range. Every
   * screen reads it that way, through one component, so "whole balance" and
   * "bills 1–14 Aug" are the two things this can say and neither is a blank.
   */
  bills_from: string | null
  bills_to: string | null
  suggested_mode: string | null
  routed_mode: string | null
  routed_account_id: string | null
  /** the role this is waiting on. `awaiting_me` keys on it, so a request that
   *  never sets it is a request no badge can ever see. */
  assigned_to: string | null
  from_code: string | null
  from_name: string | null
  to_code: string | null
  to_name: string | null
}

/**
 * `awaiting_me` IS THE PREDICATE, WRITTEN ONCE, IN THE DATABASE.
 *
 * It is an aggregate — one row per (role, kind, status) with a count, the
 * oldest ask and the total amount — so the badge sums it directly. The LIST
 * cannot select from it (it holds no ids), and restating its WHERE here would
 * be a second copy of the rule that decides what "waiting" means, which is how
 * a badge and the page it opens come to disagree about the same word.
 *
 * So the list JOINS THROUGH THE VIEW on (restaurant, role, kind, status). A
 * request appears in the join exactly when a group exists for its own three
 * values — which is exactly when it satisfies the view's WHERE. Not an
 * approximation of the predicate: the predicate itself, inherited.
 *
 * WHAT THE VIEW SAYS IS WAITING: status pending, approved, returned or
 * challenged, AND a role named in `assigned_to`. `applied`, `refused`,
 * `cancelled` and `failed` are finished or stuck, and nothing is stopping the
 * person named on them — a request nobody is waiting on has to leave the queue
 * or the badge stops meaning anything.
 *
 * `returned` IS A STATUS THE APP NEVER WRITES, and that is worth knowing
 * rather than discovering. §3 settled that a return cancels the ROUTING and
 * not the APPROVAL, so `returnRequest` leaves the status at `approved` and
 * clears the route; the view's `returned` branch anticipated a design that was
 * not taken. It is an OR arm that never matches — harmless, and one of four,
 * so the view is not vacuous — but it is the same shape as the column nothing
 * wrote, and it should be dropped the next time this view is replaced.
 */
export type AwaitingGroup = {
  role: string
  kind: string
  status: string
  n: number
  oldest: string | null
  total_amount: string | null
}

/**
 * THE HEAD OF THE TRAIL, on every row the owner reads.
 *
 * Status alone cannot tell "approved a minute ago and not yet routed" from
 * "the accountant sent it back" — §3 leaves both at `approved`, deliberately,
 * because a return cancels the ROUTING and not the APPROVAL. The last EVENT is
 * what separates them, and separating them is the whole reason the trail
 * exists.
 *
 * ORDERED `acted_at desc, seq desc`, and the second key is not decoration.
 * `acted_at` defaults to now(), which is the TRANSACTION timestamp — and
 * `routePayment` writes `routed` and `forwarded` in ONE transaction, so those
 * two carry the identical instant and TIE. `seq` is a bigserial and resolves
 * it. Time leads because it is the truth across transactions; seq only decides
 * inside one. An `order by seq desc` alone would agree here and disagree the
 * day a row is inserted later than one stamped later.
 */
export type TrailHead = {
  last_action: string | null
  last_note: string | null
  last_by: string | null
  last_at: string | null
}
export type AwaitingRow = ApprovalRow & TrailHead

/**
 * WHOSE QUEUE A GROUP'S PAYMENT SCREEN SHOWS — named once, read by the badge
 * and by the panel it opens.
 *
 * They disagreed. The Payments badge counted `countAwaiting(rid,
 * 'accountant')` — the GROUP's role — while `AwaitingPanel` listed
 * `user.role`, the signed-in READER's. An owner can open /accounts, so he saw
 * a badge of 2 over a screen showing nothing: two forwarded payments waiting
 * on the accountant, and `listAwaiting(rid, 'owner')` returning none of them.
 *
 * A badge is a claim about a SCREEN, not about the person reading it. Both
 * sides take the role from here now, so the count and the list cannot answer
 * about different queues.
 */
export const GROUP_QUEUE_ROLE = { accounts: 'accountant', store: 'store' } as const

export async function getAwaiting(
  restaurantId: string,
  role: Role,
  tx?: postgres.TransactionSql,
): Promise<AwaitingGroup[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<AwaitingGroup[]>`
    select role, kind, status, n::int as n,
           oldest::text as oldest, total_amount::text as total_amount
    from awaiting_me
    where restaurant_id = ${restaurantId} and role = ${role}
    order by kind, status`
}

/**
 * The badge. Silent at zero, like every other one in the app.
 *
 * The handle is optional so a gate can count inside its own rolled-back
 * transaction — a `tsql` there opens a second connection that cannot see the
 * uncommitted fixture, finds nothing, and reports a tick.
 */
export async function countAwaiting(
  restaurantId: string,
  role: Role,
  tx?: postgres.TransactionSql,
): Promise<number> {
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<{ n: number }[]>`
    select coalesce(sum(n), 0)::int as n from awaiting_me
    where restaurant_id = ${restaurantId} and role = ${role}`
  return row?.n ?? 0
}

/**
 * The rows behind that number, for the page the badge opens.
 *
 * PAYMENTS FIRST, and not because they are more urgent in the abstract:
 * a payment request is the only kind where somebody OUTSIDE the building is
 * waiting on the answer, and the only kind carrying an amount and a due date
 * that keep moving while it sits. A discard waits perfectly well.
 *
 * Oldest first within a kind — the one that has been waiting longest is the
 * one to answer — which is the same order the queue has always used.
 */
export async function listAwaiting(
  restaurantId: string,
  role: Role,
  tx?: postgres.TransactionSql,
): Promise<AwaitingRow[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<AwaitingRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name,
           ev.action as last_action, ev.note as last_note,
           ev.acted_by as last_by, ev.acted_at::text as last_at
    from approval_requests a
    join awaiting_me w
      on w.restaurant_id = a.restaurant_id and w.role = a.assigned_to
     and w.kind = a.kind and w.status = a.status
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    left join lateral (
      select e.action, e.note, e.acted_by, e.acted_at
      from approval_events e
      where e.restaurant_id = a.restaurant_id and e.request_id = a.id
      order by e.acted_at desc, e.seq desc
      limit 1
    ) ev on true
    where a.restaurant_id = ${restaurantId} and w.role = ${role}
    order by (a.kind = 'payment') desc, a.requested_at asc
    limit 200`
}

/**
 * OPEN, AND WITH SOMEBODY ELSE.
 *
 * The instant the owner forwards a payment to the accountant it leaves their
 * queue — which is right, and would otherwise mean it VANISHES from the only
 * screen they ever saw it on. "Where did my approval go" is the first question
 * that produces, so the page says where: with whom, how long, and for how
 * much. It is not work; it is the answer to a question the badge's own
 * correctness creates.
 */
export async function listElsewhere(
  restaurantId: string,
  role: Role,
  tx?: postgres.TransactionSql,
): Promise<AwaitingRow[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<AwaitingRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name,
           ev.action as last_action, ev.note as last_note,
           ev.acted_by as last_by, ev.acted_at::text as last_at
    from approval_requests a
    join awaiting_me w
      on w.restaurant_id = a.restaurant_id and w.role = a.assigned_to
     and w.kind = a.kind and w.status = a.status
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    left join lateral (
      select e.action, e.note, e.acted_by, e.acted_at
      from approval_events e
      where e.restaurant_id = a.restaurant_id and e.request_id = a.id
      order by e.acted_at desc, e.seq desc
      limit 1
    ) ev on true
    where a.restaurant_id = ${restaurantId} and w.role <> ${role}
    order by a.requested_at asc
    limit 50`
}

/**
 * RECENTLY CLOSED, and they stay on the page.
 *
 * A queue that empties itself of everything except work cannot answer "what
 * happened to the request I raised on Tuesday". A refusal and a failure are
 * both findings — the refusal carries the only sentence the requester will
 * ever get, and the failure carries the database's own words about a yes that
 * did nothing.
 *
 * NOT counted by any badge: nothing here is waiting on anybody.
 */
export async function listDecided(restaurantId: string, limit = 20): Promise<AwaitingRow[]> {
  return tsql<AwaitingRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name,
           ev.action as last_action, ev.note as last_note,
           ev.acted_by as last_by, ev.acted_at::text as last_at
    from approval_requests a
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    left join lateral (
      select e.action, e.note, e.acted_by, e.acted_at
      from approval_events e
      where e.restaurant_id = a.restaurant_id and e.request_id = a.id
      order by e.acted_at desc, e.seq desc
      limit 1
    ) ev on true
    where a.restaurant_id = ${restaurantId}
      and a.status in ('applied', 'refused', 'failed', 'cancelled')
    order by coalesce(a.applied_at, a.decided_at, a.requested_at) desc
    limit ${limit}`
}

/** Anything still open against one row — so a form can say "already asked"
 *  rather than letting somebody raise the same request twice. */
export async function pendingFor(restaurantId: string, entityId: string): Promise<ApprovalRow[]> {
  return tsql<ApprovalRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           null as from_code, null as from_name, null as to_code, null as to_name
    from approval_requests a
    where a.restaurant_id = ${restaurantId}
      and a.entity_id = ${entityId}
      and a.status in ('pending', 'approved')`
}

export async function getApproval(restaurantId: string, id: string): Promise<ApprovalRow | null> {
  const rows = await tsql<ApprovalRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name
    from approval_requests a
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    where a.restaurant_id = ${restaurantId} and a.id = ${id}`
  return rows[0] ?? null
}


// ───────────────────────────────────────────────────────────── the act

/**
 * Whatever merge_items / merge_vendors returned, or what a discard did.
 *
 * `moved` IS PER-TABLE COUNTS AND MUST STAY THAT WAY — never flattened into a
 * summary string, however much nicer "31 rows moved" reads in a log.
 *
 * MERGES GET REGRETTED. MarketMan built a "split" for exactly that, and this
 * app is NOT building unmerge — but `applied_result` is the only record of
 * where the rows went, and a per-table breakdown is the one shape from which
 * an unmerge could ever be reconstructed. A summary string would close that
 * door permanently and nothing on any screen would look different.
 *
 * The screens format it for reading; the column keeps the counts.
 */
export type ApplyResult = {
  from?: string
  to?: string
  moved?: Record<string, number>
  discarded?: string
  reopened?: string
}

/**
 * APPLY A DECIDED REQUEST — on a handle the caller lends, never on the pool.
 *
 * It lives here rather than in the 'use server' file for two reasons. It must
 * not be a public endpoint: it does the destructive half and takes `by` as a
 * parameter, so exported from an action file it would be a way to apply a
 * request without being the owner. And a gate can call it directly on a
 * rolled-back transaction, which is the only way to prove the APP's path
 * rather than the function's — a probe that writes its own SQL cannot test
 * the column list the app uses, a lesson this project has paid for twice.
 *
 * THE GUARDS ARE NOT REPEATED HERE. merge_items re-runs every one of them
 * itself, under a row lock, which is the whole reason they live in the
 * function: a check this file ran a line earlier is a check that passed
 * before the lock was taken.
 */
export async function applyRequest(
  tx: postgres.TransactionSql,
  restaurantId: string,
  req: { kind: string; entity_type: string; entity_id: string; target_entity_id: string | null },
  /** who is applying, and why — both land on the period row for a reopen,
   *  which is the only kind that records them outside approval_requests. */
  by = 'owner',
  reason = '',
): Promise<ApplyResult> {
  // A PAYMENT IS NOT APPLIED HERE, AND THE REFUSAL IS STRUCTURAL RATHER THAN
  // A COMMENT. Without it a payment request falls past the reopen and merge
  // branches into the DISCARD one, where `entity_type` is 'vendor' — so
  // approving a request to pay somebody would try to close their code. Today
  // that is caught by the reference guard, because every vendor carrying an
  // outstanding balance has at least one bill pointing at it. That is a rule
  // holding by accident: the guard is about data, not about kind, and one
  // bill-less balance would make approving a payment discard a live vendor.
  //
  // A payment is applied by `payApproval`, which writes the payments row and
  // the `paid` event in one transaction. Nothing here can do that.
  if (req.kind === 'payment') {
    throw new Error('a payment request is settled by recording the payment, not by applying it')
  }

  if (req.kind === 'reopen_period') {
    // The ONLY update period_closes takes, granted on exactly three columns.
    const [row] = await tx<{ code: string }[]>`
      update period_closes
      set reopened_at = now(), reopened_by = ${by}, reopen_reason = ${reason.slice(0, 500)}
      where id = ${req.entity_id} and restaurant_id = ${restaurantId} and reopened_at is null
      returning to_char(period_start, 'FMMonth YYYY') as code`
    if (!row) throw new Error('that period is no longer closed')
    return { reopened: row.code }
  }

  if (req.kind === 'merge') {
    if (req.target_entity_id === null) throw new Error('a merge with no survivor cannot be applied')
    const [out] =
      req.entity_type === 'item'
        ? await tx<{ r: ApplyResult }[]>`select merge_items(${req.entity_id}::uuid, ${req.target_entity_id}::uuid) as r`
        : req.entity_type === 'recipe'
          ? await tx<{ r: ApplyResult }[]>`select merge_recipes(${req.entity_id}::uuid, ${req.target_entity_id}::uuid) as r`
          : await tx<{ r: ApplyResult }[]>`select merge_vendors(${req.entity_id}::uuid, ${req.target_entity_id}::uuid) as r`
    return out.r
  }

  // A DISCARD IS A STATUS AND NOTHING ELSE — there is no discard_item()
  // function because there is nothing to move, and that is exactly what makes
  // a discard safe where a merge needs one.
  //
  // The reference count is re-read HERE, at the moment of writing, not trusted
  // from the request: a bill landing against the row between the ask and the
  // approval turns a mistake into history, and history is not discardable.
  const table = ENTITIES[req.entity_type as ApprovalEntity]?.table ?? 'items'
  const [refs] = await tx<{ n: number }[]>`
    select coalesce(sum(n), 0)::int as n from reference_counts(${table}, ${req.entity_id}::uuid)`
  if ((refs?.n ?? 0) > 0) {
    throw new Error(
      `${refs.n} row(s) now point at it — something was entered against it after this was asked, so it is history and cannot be discarded`,
    )
  }
  // ONE LITERAL UPDATE PER TABLE, for the same reason readMaster has eight
  // literal selects: audit:tenancy reads these statements, and an interpolated
  // table name is a statement it cannot see.
  const [row] =
    req.entity_type === 'item'
      ? await tx<{ code: string }[]>`
          update items set status = 'discarded'
          where id = ${req.entity_id} and restaurant_id = ${restaurantId}
            and status in ('active', 'inactive') returning code`
      : req.entity_type === 'vendor'
        ? await tx<{ code: string }[]>`
            update vendors set status = 'discarded'
            where id = ${req.entity_id} and restaurant_id = ${restaurantId}
              and status in ('active', 'inactive') returning code`
        : req.entity_type === 'recipe'
          ? await tx<{ code: string }[]>`
              update recipes set status = 'discarded'
              where id = ${req.entity_id} and restaurant_id = ${restaurantId}
                and status in ('active', 'inactive') returning code`
          : req.entity_type === 'account'
            ? await tx<{ code: string }[]>`
                update money_accounts set status = 'discarded'
                where id = ${req.entity_id} and restaurant_id = ${restaurantId}
                  and status in ('active', 'inactive') returning name as code`
            : req.entity_type === 'meter'
              ? await tx<{ code: string }[]>`
                  update meters set status = 'discarded'
                  where id = ${req.entity_id} and restaurant_id = ${restaurantId}
                    and status in ('active', 'inactive') returning name as code`
              : req.entity_type === 'location'
                ? await tx<{ code: string }[]>`
                    update storage_locations set status = 'discarded'
                    where id = ${req.entity_id} and restaurant_id = ${restaurantId}
                      and status in ('active', 'inactive') returning name as code`
                : await tx<{ code: string }[]>`
                    update list_options set status = 'discarded'
                    where id = ${req.entity_id} and restaurant_id = ${restaurantId}
                      and status in ('active', 'inactive') returning value as code`
  if (!row) throw new Error('it was already closed')
  return { discarded: row.code }
}



// ═══════════════════════════════════════════════ an act, and its one record

/**
 * The ten things that can happen to a request — the CHECK on
 * `approval_events.action`, mirrored so a typo is a type error rather than a
 * constraint violation the user reads.
 */
export const APPROVAL_ACTIONS = [
  'raised',
  'approved',
  'routed',
  'forwarded',
  'returned',
  'challenged',
  'refused',
  'paid',
  'cancelled',
  'reopened',
  // "NOTED." The raiser has been told. It moves no status and decides
  // nothing — it clears the obligation and leaves the outcome where it is.
  'acknowledged',
] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]

export type Act = {
  id: string
  action: ApprovalAction
  /** The statuses this act may act on, re-read INSIDE the transaction. A
   *  decision taken while another tab had the form open must not land twice. */
  from: readonly string[]
  /** What the status becomes. Often the same status it was in: a return
   *  cancels the ROUTING, not the approval. */
  status: string
  by: string
  /** REQUIRED by the caller on returned / challenged / refused. After one of
   *  those there is nothing else to explain why the route changed. */
  note?: string | null
  mode?: string | null
  accountId?: string | null
  /** Whose queue it lands in next. `null` CLEARS it — nobody is waiting.
   *  Omit to leave it where it is. */
  assignTo?: string | null
  /** True only where this act CHOOSES the route — the owner saying how it
   *  will be paid. `mode` and `accountId` always land on the EVENT; they move
   *  `routed_mode` / `routed_account_id` only when this is set.
   *
   *  The `paid` act names an account and must NOT set it: those columns hold
   *  the owner's routing decision, and overwriting them with the payer's
   *  choice would delete one person's act with another's, exactly as reusing
   *  `decided_by` would. */
  route?: boolean
  /** A return cancels the routing and keeps the approval, so the mode and the
   *  account chosen for the old route must go with it. */
  clearRouting?: boolean
  /** Only `approved` and `refused` are decisions.
   *
   *  A COLUMN THAT RECORDS WHO DID SOMETHING CANNOT BE REUSED BY THE NEXT
   *  PERSON WHO DOES SOMETHING. `decided_by` is the current position — who
   *  said yes — and a later act overwriting it would delete one person's act
   *  with another's: the owner approved on Tuesday, the accountant returned it
   *  on Thursday, and afterwards nothing anywhere says the owner ever
   *  approved anything. So routing, returning, challenging and paying leave it
   *  alone and APPEND instead. */
  decision?: boolean
}

/**
 * ONE ACT, ONE TRANSACTION: the state change and the event that describes it.
 *
 * THE EVENT AND THE STATE CHANGE ARE ONE WRITE OR THEY ARE A LIE WAITING FOR A
 * CRASH. Two statements outside a transaction leave, on a failure between
 * them, a request that is approved with nothing saying who approved it — the
 * exact hole the trail exists to close, arriving by another door, and worse
 * than the overwriting fault it replaced because an overwrite at least leaves
 * somebody's name.
 *
 * Both writes go on the LENT handle and this function never opens one of its
 * own. A `tsql` for either half would commit independently of the caller and
 * survive a rollback, which is the failure mode rather than a style point —
 * and this very file already writes a failure record in a second transaction
 * on purpose, so the shape is in the neighbourhood.
 *
 * It lives here rather than in the action file for the `applyRequest` reason:
 * it moves a request's state while taking the actor as a parameter, so
 * exported from a 'use server' file it would be a way to approve, route or pay
 * without being anybody in particular. Living here is also what lets a gate
 * call it on a rolled-back transaction and force a failure between its two
 * writes, which is the only way to observe that they are one.
 */
/**
 * §3 IN ONE PLACE — what each send-back does to the row.
 *
 * The two look alike and mean opposite things, and the whole difference is
 * what the owner has to do next. Declared here rather than spelled out inside
 * the two actions, so the RULING is a value a gate can assert rather than a
 * pair of literals somebody could change in one place and not the other.
 *
 *   returned   the approval STANDS — status stays `approved` — and only the
 *              route comes off. Sending it to `pending` would erase the
 *              approval before it ever left, and afterwards nobody could
 *              explain why the route changed. It clears the route: whatever
 *              the owner decides next, the old one is not still live.
 *
 * THERE IS ONLY ONE SEND-BACK NOW. `challenged` was the second — "I do not
 * think this should be paid" against "I cannot pay it this way" — and it was a
 * real distinction drawn by the WRONG PERSON. The accountant had to classify
 * WHY before he could act, and the paragraph explaining the difference is a
 * paragraph nobody reads at four in the afternoon. He STATES THE FACT; the
 * owner, who has the information to tell them apart, CLASSIFIES IT.
 *
 * THE STATUS STAYS IN THE SCHEMA and `decideApproval` still accepts it: a
 * status nothing writes costs nothing, and one dropped from a CHECK that
 * history might reference costs a migration and a row nobody can read. The app
 * CONSTANT does not stay, because a constant with no reader is dead vocabulary
 * that the next person wires up without the argument.
 */
/**
 * WHY `status` AND `assigned_to` BOTH EXIST — asked here because a later
 * reader will ask it, and the answer is only obvious once one case forces it.
 *
 *   status       WHAT HAPPENED TO THE REQUEST. It is refused, or applied, or
 *                still waiting to be decided.
 *   assigned_to  WHO MUST ACT NEXT. Null means nobody: the thing is finished
 *                as far as any person is concerned.
 *
 * For most of this machine's life they moved together and either could have
 * been derived from the other. Acknowledgement is what pulls them apart: a
 * refused request is `refused` whether or not the person who raised it has
 * been told, and being told is an ACT with a name, a time and a person on it.
 * One column carries the outcome, the other carries the obligation, and
 * collapsing them would mean either losing the outcome when he acknowledges
 * or losing the obligation the moment it was decided.
 *
 * It is also what makes the badge honest, because clearing `assigned_to` — and
 * nothing else — is how work leaves a queue.
 */
/**
 * THE DIVISION IS LOAD-BEARING, SO IT IS DECLARED RATHER THAN REMEMBERED.
 *
 * `awaiting_me` asks ONE question — who is holding this — and keys on
 * `assigned_to` alone. It no longer carries a list of statuses, because a list
 * is a COPY of the rule deciding what "waiting" means, and that copy drifted
 * in both directions within two commits: `returned` was on it and is never
 * written, `refused` was absent and is now required.
 *
 * The consequence is that the APP is now solely responsible for saying when
 * nobody is holding a request. **A request left assigned after its last act
 * sits in somebody's badge forever**, and nothing in the database will object.
 *
 * BOTH SETS ARE STATED AS THE EXCEPTION, NEVER AS THE MEMBERSHIP, because a
 * list of members shrinks silently and takes the gate down with it — which is
 * exactly what happened when this was first written as
 * `TERMINAL_STATUSES = ['applied','cancelled']`: dropping a member made the
 * check examine less and stay green.
 *
 *   ASSIGNABLE_STATUSES  the ones where somebody may legitimately still be
 *                        holding it. EVERY OTHER STATUS in the CHECK is
 *                        terminal by construction, so a status added later is
 *                        covered the day it exists rather than the day
 *                        somebody remembers.
 *   TERMINAL_ACTS        after one of these nobody is holding it. Asserted
 *                        against the acts DERIVED from the source — the set
 *                        that always passes `assignTo: null` — so it can
 *                        neither shrink nor miss a new one.
 *
 * `refused` is assignable on purpose, and it is the interesting member: a
 * refusal is the outcome and the obligation at once, and stays with whoever
 * raised it until they acknowledge it. `failed` too — an approval that could
 * not be applied genuinely is waiting on the owner.
 */
export const ASSIGNABLE_STATUSES = [
  'pending',
  'approved',
  'returned',
  'challenged',
  'refused',
  'failed',
] as const
export const TERMINAL_ACTS = ['paid', 'cancelled', 'acknowledged'] as const

export const SEND_BACK = {
  returned: { status: 'approved', clearRouting: true, assignTo: 'owner' },
} as const

/**
 * WHO RAISED IT, AS A ROLE.
 *
 * `requested_by` is a USERNAME and `assigned_to` is a ROLE, so a refusal
 * cannot find its way home without this one lookup. Deliberately not a column
 * frozen at raise time: a person's role can change between asking and being
 * answered, and the queue belongs to whoever holds that job now — the same
 * reasoning that makes `getSessionUser` re-read the row on every action rather
 * than trusting the cookie's claim.
 *
 * Null where the username no longer resolves. A refusal nobody can be told
 * about is still a refusal; it simply has nobody waiting on it.
 */
export async function roleOfRequester(
  restaurantId: string,
  username: string | null,
  tx?: postgres.TransactionSql,
): Promise<Role | null> {
  if (username === null || username === '') return null
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<{ role: Role }[]>`
    select role from app_users
    where restaurant_id = ${restaurantId} and username = ${username} and status = 'active'`
  return row?.role ?? null
}

export async function recordAct(
  tx: postgres.TransactionSql,
  restaurantId: string,
  act: Act,
): Promise<void> {
  const note = act.note === undefined || act.note === '' ? null : act.note
  const mode = act.mode === undefined || act.mode === '' ? null : act.mode
  const accountId = act.accountId === undefined || act.accountId === '' ? null : act.accountId
  const decision = act.decision === true
  const assignTouched = act.assignTo !== undefined
  const routeTouched = act.route === true
  const clearRouting = act.clearRouting === true

  // ONE SET LIST, every branch visible in it. Two acts writing this row
  // through two hand-written SET lists is exactly how they drift — the staff
  // identity lesson — and the CASE form keeps the whole grant in one
  // statement audit:schema and audit:tenancy can both read.
  const [row] = await tx<{ id: string }[]>`
    update approval_requests
    set status = ${act.status},
        decided_by    = case when ${decision}::boolean then ${act.by}::text else decided_by end,
        decided_at    = case when ${decision}::boolean then now() else decided_at end,
        decision_note = case when ${decision}::boolean then ${note}::text else decision_note end,
        assigned_to   = case when ${assignTouched}::boolean then ${act.assignTo ?? null}::text else assigned_to end,
        routed_mode   = case when ${clearRouting}::boolean then null
                             when ${routeTouched}::boolean then ${mode}::text
                             else routed_mode end,
        routed_account_id = case when ${clearRouting}::boolean then null
                                 when ${routeTouched}::boolean then ${accountId}::uuid
                                 else routed_account_id end
    where id = ${act.id} and restaurant_id = ${restaurantId}
      and status = any(${[...act.from]})
    returning id`
  if (!row) {
    throw new ApprovalRefusal(
      `That request is no longer ${act.from.join(' or ')} — somebody has moved it since this screen loaded`,
    )
  }

  await tx`
    insert into approval_events (restaurant_id, request_id, action, note, mode, account_id, acted_by)
    values (${restaurantId}, ${act.id}, ${act.action}, ${note}, ${mode}, ${accountId}, ${act.by})`
}

/**
 * The person this request is currently waiting on.
 *
 * The assigned ROLE, or an owner — who may act on anything, because a loop
 * that stalls on one person's day off is a loop nobody uses. That is the query
 * loop's rule; the manager is deliberately NOT on it here, because this one
 * moves money and the escape hatch for money is the owner.
 */
export async function assertAssignee(assignedTo: string | null, what: string): Promise<string> {
  const user = await getSessionUser()
  if (!user) throw new ApprovalRefusal('Sign in again — the session has expired')
  if (user.role !== 'owner' && user.role !== assignedTo) throw new ApprovalRefusal(what)
  return user.username
}



/**
 * WHAT HAPPENED TO THE ONES HE RAISED — a different question from "what is
 * waiting on me", and deliberately a different query.
 *
 * TWO OUTCOMES, ONE OF WHICH ASKS SOMETHING OF HIM:
 *
 *   REFUSED    changes what he has to say to a vendor he had already promised
 *              something to. It sits in his queue — `assigned_to` still set —
 *              until he notes it, and the badge counts exactly these.
 *   PAID       is news he needs so he stops chasing, and nothing more. It
 *              appears here with no badge and no button: badging good news
 *              trains somebody to clear badges rather than read them.
 *
 * A CHALLENGE IS NOT HIS AND NEVER REACHES THIS LIST. That argument runs
 * accountant → owner; he sees the eventual refusal or payment, not the
 * disagreement on the way to it.
 */
export type OutcomeRow = AwaitingRow & { needs_noting: boolean; decided_it_himself: boolean }

export async function listMyOutcomes(
  restaurantId: string,
  username: string,
  tx?: postgres.TransactionSql,
): Promise<OutcomeRow[]> {
  const q = (tx ?? tsql) as typeof tsql
  return q<OutcomeRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           a.amount::text as amount, a.suggested_mode, a.routed_mode,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.routed_account_id::text as routed_account_id, a.assigned_to,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name,
           ev.action as last_action, ev.note as last_note,
           ev.acted_by as last_by, ev.acted_at::text as last_at,
           -- THE OBLIGATION, NOT THE OUTCOME. A refusal he has noted is still
           -- refused; what changes is that nobody is holding it any more.
           (a.assigned_to is not null) as needs_noting,
           -- WHETHER HE IS DOWNSTREAM OF THE DECISION AT ALL. An owner raises
           -- a discard, approves it and applies it; telling him to stop
           -- chasing it is telling him about his own act. When the raiser and
           -- the decider are the same person the panel is a RECEIPT, not news.
           (a.decided_by is not distinct from a.requested_by) as decided_it_himself
    from approval_requests a
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    left join lateral (
      select e.action, e.note, e.acted_by, e.acted_at
      from approval_events e
      where e.restaurant_id = a.restaurant_id and e.request_id = a.id
      order by e.acted_at desc, e.seq desc
      limit 1
    ) ev on true
    where a.restaurant_id = ${restaurantId}
      and a.requested_by = ${username}
      and a.status in ('refused', 'applied')
    order by (a.assigned_to is not null) desc,
             coalesce(a.applied_at, a.decided_at, a.requested_at) desc
    limit 20`
}


// ══════════════════════════════════════ what the owner needs to route by

/**
 * THE VENDOR'S SIDE OF A PAYMENT: where the money would actually go, and what
 * is owed right now.
 *
 * BOTH HALVES ARE READ AT ROUTING TIME, not taken from the snapshot. The
 * snapshot is the ageing AS IT STOOD AT ASKING and exists to be COMPARED — a
 * bill can land, or a payment can clear, between the ask and the decision. The
 * bank details were never in the snapshot at all, and must not be: an account
 * number copied into a jsonb blob in June is what somebody would transfer
 * money to in September.
 *
 * A LEFT JOIN TO vendor_aging, deliberately. That view filters `unpaid > 0`,
 * so a vendor who has been paid in the meantime has NO ROW — and an inner join
 * would drop the request from the owner's screen entirely rather than telling
 * him the debt is gone. Absent is a finding; missing is a bug.
 */
export type VendorRouting = {
  vendor_id: string
  code: string
  name: string
  phone: string | null
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  upi_id: string | null
  /** null where nothing is outstanding today — the view drops a settled vendor */
  outstanding: string | null
  open_bills: number | null
  oldest_due: string | null
}

export async function getVendorRouting(
  restaurantId: string,
  vendorIds: string[],
): Promise<Map<string, VendorRouting>> {
  if (vendorIds.length === 0) return new Map()
  const rows = await tsql<VendorRouting[]>`
    select v.id as vendor_id, v.code, v.name, v.phone,
           v.bank_name, v.account_no, v.ifsc, v.upi_id,
           va.outstanding::text as outstanding,
           va.open_bills::int as open_bills,
           va.oldest_due::text as oldest_due
    from vendors v
    left join vendor_aging va
      on va.restaurant_id = v.restaurant_id and va.vendor_id = v.id
    where v.restaurant_id = ${restaurantId} and v.id = any(${vendorIds})`
  return new Map(rows.map((r) => [r.vendor_id, r]))
}

/**
 * Vendors nobody can pay by any route — no account number AND no UPI id.
 *
 * Surfaced on the vendor list, the same shape as the phone-number blocker
 * already there: a purchase order with nowhere to send it is a PDF, and a
 * vendor with no bank details is a payment somebody has to chase by phone.
 * Computed, never asserted, so it clears itself as the details arrive.
 */
export async function countVendorsUnpayable(
  restaurantId: string,
): Promise<{ total: number; unpayable: number; withUpi: number }> {
  const [row] = await tsql<{ total: number; unpayable: number; with_upi: number }[]>`
    select count(*)::int as total,
           count(*) filter (
             where coalesce(account_no, '') = '' and coalesce(upi_id, '') = ''
           )::int as unpayable,
           count(*) filter (where coalesce(upi_id, '') <> '')::int as with_upi
    from vendors
    where restaurant_id = ${restaurantId} and status = 'active'`
  return { total: row?.total ?? 0, unpayable: row?.unpayable ?? 0, withUpi: row?.with_upi ?? 0 }
}


// ══════════════════════════════════════════════ what is waiting on the owner

export type WaitingPayrollRun = {
  id: string
  doc_no: string | null
  period_start: string
  period_end: string
  prepared_by: string | null
  lines: number
  total: string
}

export type Waiting = {
  approvals: AwaitingRow[]
  /** open, and with somebody else — context, never work. Not counted. */
  elsewhere: AwaitingRow[]
  /** closed, kept so the page can answer "what happened to mine". Not counted. */
  decided: AwaitingRow[]
  suggestions: { id: string; list_key: string; value: string; suggested_by: string | null; seen_count: number }[]
  payrollRuns: WaitingPayrollRun[]
  total: number
}

/**
 * FOUR THINGS WAIT ON RAJESH IN FOUR PLACES HE WOULD HAVE TO REMEMBER TO
 * VISIT. This is the one page that says what is waiting — including for the
 * things it does not itself execute.
 *
 * A payroll run is a POINTER and never a copy. Approving payroll means seeing
 * the whole run — the people, the days, the withholdings — and a row rendered
 * inline here would invite a decision made on a total. So this carries enough
 * to recognise it and a link, and nothing you could approve from.
 */
export async function getWaiting(restaurantId: string): Promise<Waiting> {
  // THE PAGE READS WHAT THE BADGE COUNTS. It used to read `status = 'pending'`
  // while the badge counted the same thing separately; now both go through
  // awaiting_me, so a payment sitting approved-and-unrouted — which IS work,
  // and which the old filter dropped — appears on the page that claims to
  // list everything waiting.
  const [approvals, elsewhere, decided, suggestions, payrollRuns] = await Promise.all([
    listAwaiting(restaurantId, 'owner'),
    listElsewhere(restaurantId, 'owner'),
    listDecided(restaurantId),
    tsql<{ id: string; list_key: string; value: string; suggested_by: string | null; seen_count: number }[]>`
      select id, list_key, value, suggested_by, seen_count
      from list_suggestions
      where restaurant_id = ${restaurantId} and status = 'pending'
      -- SEEN_COUNT IS THE SIGNAL: a word typed nine times is real, once is a
      -- typo. Most-seen first so the owner meets the vocabulary before the
      -- slips.
      order by seen_count desc, created_at asc`,
    tsql<WaitingPayrollRun[]>`
      select r.id, r.doc_no, r.period_start::text as period_start, r.period_end::text as period_end,
             r.prepared_by,
             (select count(*)::int from payroll_lines l where l.run_id = r.id) as lines,
             (select coalesce(sum(l.net_payable), 0)::text from payroll_lines l where l.run_id = r.id) as total
      from payroll_runs r
      where r.restaurant_id = ${restaurantId} and r.status = 'draft'
      order by r.period_start`,
  ])
  return {
    approvals,
    elsewhere,
    decided,
    suggestions,
    payrollRuns,
    total: approvals.length + suggestions.length + payrollRuns.length,
  }
}

/**
 * The OWNER's badge: everything awaiting them, plus the two queues that live
 * outside approval_requests entirely — words somebody typed, and a payroll run
 * prepared and unapproved.
 *
 * The approvals leg is `awaiting_me`, not a second `status = 'pending'` count
 * of its own. It used to be the latter, and the two disagreed the moment a
 * payment could sit approved-and-unrouted: real work, waiting on the owner,
 * invisible to the badge. ONE SOURCE means the number and the page cannot
 * drift, because there is nothing to drift from.
 *
 * Takes an optional handle so a gate can count inside its own rolled-back
 * transaction — a tsql there would open a second connection that cannot see
 * the uncommitted fixture, find nothing, and report a tick.
 */
export async function countWaiting(restaurantId: string, tx?: postgres.TransactionSql): Promise<number> {
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<{ n: number }[]>`
    select (select coalesce(sum(n), 0) from awaiting_me
             where restaurant_id = ${restaurantId} and role = 'owner')::int
         + (select count(*) from list_suggestions where restaurant_id = ${restaurantId} and status = 'pending')::int
         + (select count(*) from payroll_runs where restaurant_id = ${restaurantId} and status = 'draft')::int
      as n`
  return row?.n ?? 0
}

// ─────────────────────────────── the range a payment request is about ─────

/**
 * IS THIS RANGE ASKABLE, AND WHAT DOES IT COME TO — every rule that decides a
 * payment request, on the caller's handle, under the caller's lock.
 *
 * IT LIVES HERE RATHER THAN IN THE ACTION for the reason `assertOneRowPerItem`
 * does: every export from a `'use server'` file is a public HTTP endpoint, and
 * a guard is not something to publish. The other half of that is what makes it
 * worth the move — a gate can call this on a lent transaction and exercise the
 * app's own rules against real vendors, where a probe writing its own SQL
 * would test the database and not the app.
 *
 * ON THE CALLER'S HANDLE, and not optionally. Every figure here describes a
 * state another save can move, so a check that passed before the lock has not
 * passed inside it — the purchase-order freeze and `closePeriod` both reached
 * the same conclusion from different directions.
 *
 * Returns the scope it validated, so the caller writes the figure that was
 * checked rather than reading it a second time and hoping.
 */
export async function assertPayableRange(
  tx: postgres.TransactionSql,
  restaurantId: string,
  input: {
    vendorId: string
    vendorName: string
    range: DateRange
    paise: number
    advanceIntent: boolean
  },
): Promise<{ bills: number; total: string }> {
  const { range, vendorName } = input

  // The CHECK says this too, and says it as a constraint name.
  if (range.from > range.to) {
    throw new ApprovalRefusal(
      `That range starts after it ends — ${fmtRange(range.from, range.from)} is later than ${fmtRange(range.to, range.to)}. Swap the two dates.`,
    )
  }

  // THE AUTHORITATIVE FIGURE, IN SQL. The screen computed the same number from
  // the same rows to prefill the field; this is the one a refusal names,
  // because it is the one that was true at the instant of writing.
  const [scope] = await tx<{ bills: number; total: string }[]>`
    select count(*)::int as bills, coalesce(sum(unpaid), 0)::text as total
    from bills_outstanding
    where restaurant_id = ${restaurantId} and vendor_id = ${input.vendorId} and unpaid > 0
      and bill_date >= ${range.from}::date and bill_date <= ${range.to}::date`
  const inRangePaise = decimalStringToPaise(scope.total)

  // A RANGE WITH NOTHING IN IT IS NOT A REQUEST. It is almost always a
  // mistyped month, and approving one would hand the owner a figure with no
  // bills behind it at all.
  if (scope.bills === 0) {
    throw new ApprovalRefusal(
      `No unpaid bills for ${vendorName} between ${fmtRange(range.from, range.to)} — there is nothing in that range to settle.`,
    )
  }

  // THE BOUND IS THE RANGE, NOT THE BALANCE. Asking for more than the bills
  // named can support is what a typo looks like — and an ADVANCE is the one
  // thing it legitimately looks like too, so the tick stays the deliberate
  // override it already was rather than becoming impossible the day a range
  // was added.
  if (input.paise > inRangePaise && !input.advanceIntent) {
    throw new ApprovalRefusal(
      `The bills in this range total ${formatPaise(inRangePaise)} and this asks for ${formatPaise(input.paise)}. An advance is legitimate and a typo is not — tick the advance box to say you meant it, or lower the amount.`,
    )
  }

  // OVERLAP, NOT ONE-PER-VENDOR. Two disjoint fortnights for one vendor are
  // two honest asks and the old rule refused the second; the exclusion
  // constraint is what made relaxing it safe. Checked HERE so the refusal
  // names the other request, its range, who holds it and since when — the
  // constraint is the backstop for a race and says only an index name.
  const open = await tx<
    {
      id: string
      kind: string
      assigned_to: string | null
      bills_from: string | null
      bills_to: string | null
      since: string
    }[]
  >`
    select a.id, a.kind, a.assigned_to,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           coalesce(e.acted_at, a.requested_at)::text as since
    from approval_requests a
    left join lateral (
      select acted_at from approval_events e
      where e.restaurant_id = a.restaurant_id and e.request_id = a.id
      -- acted_at leads because it is the truth across transactions; seq only
      -- decides a tie inside one, and routed/forwarded are written together so
      -- they DO tie.
      order by e.acted_at desc, e.seq desc
      limit 1
    ) e on true
    where a.restaurant_id = ${restaurantId} and a.entity_id = ${input.vendorId}
      -- The same set the exclusion constraint's WHERE names, so the app and the
      -- database cannot come to disagree about what "open" means.
      and a.status not in ('applied', 'refused', 'cancelled')`

  for (const other of open) {
    const held = `with the ${other.assigned_to ?? 'owner'} since ${fmtDayDate(other.since)}`
    if (other.kind !== 'payment') {
      throw new ApprovalRefusal(
        `There is already a ${other.kind} request open on ${vendorName} — it is ${held}.`,
      )
    }
    // A PRE-RANGE REQUEST IS A CLAIM ON THE WHOLE BALANCE, so it overlaps every
    // range there is. The exclusion constraint cannot see it — its WHERE
    // requires bills_from IS NOT NULL — which is exactly why this check is
    // here and not left to the database.
    if (other.bills_from === null || other.bills_to === null) {
      throw new ApprovalRefusal(
        `The whole balance for ${vendorName} is already asked for — that request names no range, so it covers every unpaid bill and overlaps this one. It is ${held}.`,
      )
    }
    if (overlaps(range, { from: other.bills_from, to: other.bills_to })) {
      throw new ApprovalRefusal(
        `Bills ${fmtRange(other.bills_from, other.bills_to)} for ${vendorName} are already asked for — ${held}. Pick a range that does not overlap it, or wait for that one to be settled.`,
      )
    }
  }

  return scope
}

// ───────────────────────────────── what is still true at the moment of pay ──

/** What a range covers RIGHT NOW — the live figure, beside the asked one. */
export type RangeScope = { bills: number; total: string }

/**
 * THE LIVE TOTAL OF THE BILLS EACH REQUEST NAMES, for every request on a page.
 *
 * The label under the name is AS AT ASKING and never moves — it describes the
 * request. This is the other half: what those bills come to today. The two are
 * shown side by side and only when they DIFFER, because a drift line that is
 * always there is one people stop reading, and because the difference is the
 * finding rather than either number.
 *
 * A PRE-RANGE REQUEST COMPARES AGAINST THE WHOLE BALANCE. `bills_from is null`
 * drops the date predicate entirely, so the same query answers for both kinds
 * of row — a request that named no range claimed everything, and everything is
 * what it must still be measured against.
 *
 * @scope now
 */
export async function getRangeScope(
  restaurantId: string,
  requestIds: string[],
  tx?: postgres.TransactionSql,
): Promise<Record<string, RangeScope>> {
  if (requestIds.length === 0) return {}
  const q = (tx ?? tsql) as typeof tsql
  const rows = await q<{ request_id: string; bills: number; total: string }[]>`
    select a.id as request_id, coalesce(s.n, 0)::int as bills, coalesce(s.total, 0)::text as total
    from approval_requests a
    left join lateral (
      select count(*)::int as n, sum(b.unpaid) as total
      from bills_outstanding b
      where b.restaurant_id = a.restaurant_id and b.vendor_id = a.entity_id and b.unpaid > 0
        and (a.bills_from is null or (b.bill_date >= a.bills_from and b.bill_date <= a.bills_to))
    ) s on true
    where a.restaurant_id = ${restaurantId} and a.id = any(${requestIds}) and a.kind = 'payment'`
  const out: Record<string, RangeScope> = {}
  for (const r of rows) out[r.request_id] = { bills: r.bills, total: r.total }
  return out
}

/** The locked row, as it is at the instant money is about to move. */
export type LockedRequest = {
  id: string
  status: string
  assigned_to: string | null
  amount: string | null
  bills_from: string | null
  bills_to: string | null
  entity_id: string
  vendor_name: string | null
}

/**
 * IS THIS STILL MINE TO PAY — re-read FOR UPDATE, inside the paying
 * transaction, immediately before the money moves.
 *
 * THE CHECK OUTSIDE THE TRANSACTION IS NOT THE CHECK. `payApproval` reads the
 * request and tests status and assignee before it opens a transaction, and
 * that is a courtesy: it makes the common refusal fast and readable. Between
 * that read and the write, somebody else can pay it, return it or re-route it.
 *
 * AND `recordAct` ALONE WAS NOT ENOUGH, which is the part worth writing down.
 * It refuses when the status has moved — `from: ['approved']` matches zero
 * rows and it throws — so no money has ever been able to move twice. But a
 * RETURN leaves the status at `approved` and only moves `assigned_to`: that is
 * §3's ruling, deliberately, because a return cancels the ROUTING and not the
 * APPROVAL. So a request sent back to the owner is still `approved`, and a
 * stale accountant screen would satisfy `from: ['approved']` and pay something
 * that had been taken off them.
 *
 * STATUS AND ASSIGNMENT ARE TWO QUESTIONS and this asks both, under the lock.
 *
 * The refusal NAMES WHAT HAPPENED, from the trail rather than from the row: a
 * person who just lost a race needs to know who took it and when, or they will
 * try again.
 */
export async function assertStillPayable(
  tx: postgres.TransactionSql,
  restaurantId: string,
  id: string,
  actorRole: Role,
): Promise<LockedRequest> {
  // FOR UPDATE, so a second payer waits here rather than racing past.
  const [row] = await tx<LockedRequest[]>`
    select a.id, a.status, a.assigned_to, a.amount::text as amount,
           a.bills_from::text as bills_from, a.bills_to::text as bills_to,
           a.entity_id, v.name as vendor_name
    from approval_requests a
    left join vendors v on v.restaurant_id = a.restaurant_id and v.id = a.entity_id
    where a.id = ${id} and a.restaurant_id = ${restaurantId}
    for update of a`
  if (!row) throw new ApprovalRefusal('That request no longer exists')

  const [ev] = await tx<{ action: string; acted_by: string | null; acted_at: string }[]>`
    select action, acted_by, acted_at::text as acted_at
    from approval_events
    where restaurant_id = ${restaurantId} and request_id = ${id}
    order by acted_at desc, seq desc
    limit 1`
  const when = ev === undefined ? 'a moment ago' : `on ${fmtDateTime(ev.acted_at)}`
  const who = ev?.acted_by ?? 'somebody'

  if (row.status !== 'approved') {
    throw new ApprovalRefusal(
      `This request is no longer waiting to be paid — it was ${ev?.action ?? 'changed'} by ${who} ${when}. Reload before acting on it.`,
    )
  }
  // An owner may act on anything: a loop that stalls on one person's day off
  // is a loop nobody uses, and for money the escape hatch is the owner.
  if (actorRole !== 'owner' && row.assigned_to !== actorRole) {
    throw new ApprovalRefusal(
      row.assigned_to === null
        ? `This request is with nobody — it was ${ev?.action ?? 'changed'} by ${who} ${when}, and the owner has to route it again.`
        : `This request is no longer with you — it went to the ${row.assigned_to} ${when}. Reload before acting on it.`,
    )
  }
  return row
}

/**
 * IS THE FIGURE STILL COVERED BY THE BILLS IT NAMED — recomputed under the
 * same lock, because a bill can be voided or paid between approval and
 * payment and nothing about the request changes when it is.
 *
 * REFUSED RATHER THAN SILENTLY REDUCED. Paying the lower figure would be the
 * app deciding what somebody meant; the amount that was APPROVED is what may
 * be paid, and a different figure is a different request. So it names both
 * numbers and both routes out.
 *
 * A PRE-RANGE REQUEST IS MEASURED AGAINST THE WHOLE OUTSTANDING, which is what
 * it claimed. `getRangeScope` drops the date predicate for exactly that.
 */
export async function assertAmountStillCovered(
  tx: postgres.TransactionSql,
  restaurantId: string,
  req: LockedRequest,
): Promise<RangeScope> {
  const scope = (await getRangeScope(restaurantId, [req.id], tx))[req.id] ?? { bills: 0, total: '0' }
  const askPaise = req.amount === null ? 0 : decimalStringToPaise(req.amount)
  const nowPaise = decimalStringToPaise(scope.total)
  const who = req.vendor_name ?? 'this vendor'
  const what =
    req.bills_from === null || req.bills_to === null
      ? `The whole balance for ${who}`
      : `Bills ${fmtRange(req.bills_from, req.bills_to)} for ${who}`

  if (askPaise > nowPaise) {
    throw new ApprovalRefusal(
      `${what} now total ${formatPaise(nowPaise)}; this request is for ${formatPaise(askPaise)}. Pay the lower figure by raising it again, or send this one back.`,
    )
  }
  return scope
}
