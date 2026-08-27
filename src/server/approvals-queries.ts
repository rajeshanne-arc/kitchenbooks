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

export class ApprovalRefusal extends Error {}

/** kinds the app can actually apply today. `reopen_period` and `other` are in
 *  the CHECK constraint and have no mechanic yet; a request of that kind can be
 *  raised by a future phase but this app will not try to apply one. */
export const APPLIABLE_KINDS = ['discard', 'merge', 'reopen_period'] as const
export type ApprovalKind = (typeof APPLIABLE_KINDS)[number]
export type ApprovalEntity = 'item' | 'vendor' | 'period'

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

export const assertRequester = () =>
  actor(REQUESTERS, 'Raising this is the store’s job — ask them or a manager')
export const assertApprover = () =>
  actor(DECIDERS, 'Only an owner can approve this — it changes what the books already say')

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
export async function getReferenceCounts(table: 'items' | 'vendors', id: string): Promise<RefCount[]> {
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
  const table = entity === 'item' ? 'items' : 'vendors'
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

  const checks =
    entity === 'item'
      ? await itemChecks(restaurantId, fromId, toId)
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
  from_code: string | null
  from_name: string | null
  to_code: string | null
  to_name: string | null
}

/**
 * The queue. Pending first and oldest first within it — a request somebody is
 * waiting on outranks one already decided, and the oldest is the one that has
 * been waiting longest. Decided rows STAY on the list: a refusal and a failure
 * are both findings, and a queue that empties itself of everything except work
 * cannot answer "what happened to the request I raised on Tuesday".
 */
export async function listApprovals(restaurantId: string, pendingOnly: boolean): Promise<ApprovalRow[]> {
  return tsql<ApprovalRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           coalesce(fi.code, fv.code) as from_code, coalesce(fi.name, fv.name) as from_name,
           coalesce(ti.code, tv.code) as to_code,   coalesce(ti.name, tv.name) as to_name
    from approval_requests a
    left join items   fi on a.entity_type = 'item'   and fi.id = a.entity_id
    left join vendors fv on a.entity_type = 'vendor' and fv.id = a.entity_id
    left join items   ti on a.entity_type = 'item'   and ti.id = a.target_entity_id
    left join vendors tv on a.entity_type = 'vendor' and tv.id = a.target_entity_id
    where a.restaurant_id = ${restaurantId}
      and (${pendingOnly} = false or a.status = 'pending')
    order by (a.status = 'pending') desc, a.requested_at asc
    limit 200`
}

/** Anything still open against one row — so a form can say "already asked"
 *  rather than letting somebody raise the same request twice. */
export async function pendingFor(restaurantId: string, entityId: string): Promise<ApprovalRow[]> {
  return tsql<ApprovalRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
           null as from_code, null as from_name, null as to_code, null as to_name
    from approval_requests a
    where a.restaurant_id = ${restaurantId}
      and a.entity_id = ${entityId}
      and a.status in ('pending', 'approved')`
}

/** Silent at zero, like every other badge in the app. */
export async function countPendingApprovals(restaurantId: string): Promise<number> {
  const [row] = await tsql<{ n: number }[]>`
    select count(*)::int as n from approval_requests
    where restaurant_id = ${restaurantId} and status = 'pending'`
  return row?.n ?? 0
}

export async function getApproval(restaurantId: string, id: string): Promise<ApprovalRow | null> {
  const rows = await tsql<ApprovalRow[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.target_entity_id, a.reason,
           a.snapshot, a.status, a.requested_by, a.requested_at::text as requested_at,
           a.decided_by, a.decided_at::text as decided_at, a.decision_note,
           a.applied_at::text as applied_at, a.applied_result,
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
  const table = req.entity_type === 'item' ? 'items' : 'vendors'
  const [refs] = await tx<{ n: number }[]>`
    select coalesce(sum(n), 0)::int as n from reference_counts(${table}, ${req.entity_id}::uuid)`
  if ((refs?.n ?? 0) > 0) {
    throw new Error(
      `${refs.n} row(s) now point at it — something was entered against it after this was asked, so it is history and cannot be discarded`,
    )
  }
  const [row] =
    req.entity_type === 'item'
      ? await tx<{ code: string }[]>`
          update items set status = 'discarded'
          where id = ${req.entity_id} and restaurant_id = ${restaurantId}
            and status in ('active', 'inactive') returning code`
      : await tx<{ code: string }[]>`
          update vendors set status = 'discarded'
          where id = ${req.entity_id} and restaurant_id = ${restaurantId}
            and status in ('active', 'inactive') returning code`
  if (!row) throw new Error('it was already closed')
  return { discarded: row.code }
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
  approvals: ApprovalRow[]
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
  const [approvals, suggestions, payrollRuns] = await Promise.all([
    listApprovals(restaurantId, true),
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
    suggestions,
    payrollRuns,
    total: approvals.length + suggestions.length + payrollRuns.length,
  }
}

/**
 * The badge. Silent at zero, like every other one in the app.
 *
 * Takes an optional handle so a gate can count inside its own rolled-back
 * transaction — a tsql there would open a second connection that cannot see
 * the uncommitted fixture, find nothing, and report a tick.
 */
export async function countWaiting(restaurantId: string, tx?: postgres.TransactionSql): Promise<number> {
  const q = (tx ?? tsql) as typeof tsql
  const [row] = await q<{ n: number }[]>`
    select (select count(*) from approval_requests where restaurant_id = ${restaurantId} and status = 'pending')::int
         + (select count(*) from list_suggestions where restaurant_id = ${restaurantId} and status = 'pending')::int
         + (select count(*) from payroll_runs where restaurant_id = ${restaurantId} and status = 'draft')::int
      as n`
  return row?.n ?? 0
}
