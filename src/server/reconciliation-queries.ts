// Bank reconciliation, read side.
//
// The books say what we THINK moved. A statement says what the provider
// says moved. Neither is automatically right, and this phase does not
// pretend otherwise: it puts the two lists side by side and records which
// row someone decided was which. Every figure here comes out of a named
// view — reconciliation_status, unmatched_statement_lines,
// unmatched_movements — and nothing on this side recomputes a balance.
//
// The counts are the whole point of the screen, so they come from the view
// that owns them rather than from a length() over a list this file happened
// to fetch: a matched line vanishes from unmatched_statement_lines and the
// count moves with it, in one place.
import 'server-only'
import { tsql } from '@/lib/db'
import type { StatementLineRow, StatementRow, UnmatchedMovementRow } from '@/lib/types'

/** A line someone has already decided about, with what they decided it was.
 *  Local to this file — a match is a record, not an input, so it has no
 *  shared type of its own. */
export type MatchedLineRow = {
  statement_line_id: string
  stmt_date: string
  description: string | null
  reference: string | null
  amount: string
  entity_type: string
  entity_id: string
  kind: string | null
  doc_no: string | null
  party: string | null
  move_date: string | null
  movement_amount: string | null
  matched_by: string | null
  matched_at: string
  note: string | null
}

/** reconciliation_status carries the counts and the self-check; statements
 *  carries who imported it, when, and the note. Newest period first — the
 *  one just pasted is the one being worked. */
export async function listStatements(restaurantId: string, limit = 60): Promise<StatementRow[]> {
  return tsql<StatementRow[]>`
    select rs.statement_id as id,
           rs.account_id, rs.account_name,
           rs.period_start::text as period_start,
           rs.period_end::text as period_end,
           rs.opening_balance::text as opening_balance,
           rs.closing_balance::text as closing_balance,
           s.note, s.imported_by, s.imported_at::text as imported_at,
           rs.statement_lines::int as statement_lines,
           rs.statement_total::text as statement_total,
           rs.matched_lines::int as matched_lines,
           rs.unmatched_lines::int as unmatched_lines,
           rs.statement_self_check::text as statement_self_check
    from reconciliation_status rs
    join statements s on s.id = rs.statement_id
    where rs.restaurant_id = ${restaurantId}
    order by rs.period_end desc, s.imported_at desc
    limit ${limit}`
}

export async function getStatement(restaurantId: string, id: string): Promise<StatementRow | null> {
  const rows = await tsql<StatementRow[]>`
    select rs.statement_id as id,
           rs.account_id, rs.account_name,
           rs.period_start::text as period_start,
           rs.period_end::text as period_end,
           rs.opening_balance::text as opening_balance,
           rs.closing_balance::text as closing_balance,
           s.note, s.imported_by, s.imported_at::text as imported_at,
           rs.statement_lines::int as statement_lines,
           rs.statement_total::text as statement_total,
           rs.matched_lines::int as matched_lines,
           rs.unmatched_lines::int as unmatched_lines,
           rs.statement_self_check::text as statement_self_check
    from reconciliation_status rs
    join statements s on s.id = rs.statement_id
    where rs.restaurant_id = ${restaurantId} and rs.statement_id = ${id}`
  return rows[0] ?? null
}

/** The left-hand column: what the provider says, that nobody has placed yet. */
export async function listUnmatchedStatementLines(
  restaurantId: string,
  statementId: string,
): Promise<StatementLineRow[]> {
  return tsql<StatementLineRow[]>`
    select u.statement_line_id,
           u.stmt_date::text as stmt_date,
           u.description, u.reference,
           u.amount::text as amount
    from unmatched_statement_lines u
    where u.restaurant_id = ${restaurantId} and u.statement_id = ${statementId}
    order by u.stmt_date asc, u.amount asc`
}

/**
 * The right-hand column: what the books say moved through this account and
 * that nobody has placed against a statement line yet.
 *
 * NOT DATE-FILTERED, deliberately. The obvious move is to fetch only the
 * statement's own period, and it is wrong: a payment keyed a month late is
 * exactly the movement an accountant is hunting for, and a window that hides
 * it turns an unexplained line into an unexplainable one. The list is capped
 * instead, and the caller is told the true total so it can say when the cap
 * has bitten rather than quietly showing a shorter list.
 */
export async function listUnmatchedMovements(
  restaurantId: string,
  accountId: string,
  limit = 400,
): Promise<UnmatchedMovementRow[]> {
  return tsql<UnmatchedMovementRow[]>`
    select m.entity_type, m.entity_id, m.kind, m.doc_no,
           m.move_date::text as move_date,
           m.amount::text as amount,
           m.party, m.narration
    from unmatched_movements m
    where m.restaurant_id = ${restaurantId} and m.account_id = ${accountId}
    order by m.move_date desc, m.kind asc
    limit ${limit}`
}

/**
 * How much the books hold for this account, in total and still unplaced.
 *
 * BOTH, because an empty right-hand column has two causes and they are
 * opposite findings: every entry on the account is already placed, or
 * NOTHING IN THE BOOKS NAMES THIS ACCOUNT at all — which is the live state
 * until entries carry one, `account_id` being nullable so that history
 * predating accounts is not rewritten. "Everything is matched" said over the
 * second is a confident wrong sentence, so the screen gets both figures and
 * says whichever is true.
 *
 * One round trip and the unmatched half still comes from the view that owns
 * it: this page already fans out four reads beside a layout that takes its
 * own, and the pool is the scarce thing here (see the max:12 note in db.ts).
 */
export async function countMovements(
  restaurantId: string,
  accountId: string,
): Promise<{ total: number; unmatched: number }> {
  const [row] = await tsql<{ total: number; unmatched: number }[]>`
    select (select count(*)::int from money_movements mm
             where mm.restaurant_id = ${restaurantId} and mm.account_id = ${accountId}) as total,
           (select count(*)::int from unmatched_movements u
             where u.restaurant_id = ${restaurantId} and u.account_id = ${accountId}) as unmatched`
  return { total: row?.total ?? 0, unmatched: row?.unmatched ?? 0 }
}

/** What has already been decided on this statement. Shown because a match
 *  is permanent: the record of who decided it is the only thing that
 *  explains the figure later. */
export async function listMatchedStatementLines(
  restaurantId: string,
  statementId: string,
): Promise<MatchedLineRow[]> {
  return tsql<MatchedLineRow[]>`
    select l.id as statement_line_id,
           l.stmt_date::text as stmt_date,
           l.description, l.reference,
           l.amount::text as amount,
           m.entity_type, m.entity_id,
           m.matched_by, m.matched_at::text as matched_at, m.note,
           mm.kind, mm.doc_no, mm.party,
           mm.move_date::text as move_date,
           mm.amount::text as movement_amount
    from statement_lines l
    join statements s on s.id = l.statement_id
    join reconciliation_matches m on m.statement_line_id = l.id
    left join money_movements mm on mm.entity_type = m.entity_type and mm.entity_id = m.entity_id
    where s.restaurant_id = ${restaurantId} and s.id = ${statementId}
    order by l.stmt_date asc, m.matched_at asc`
}

/** One statement line, for the action to check before it writes. Returns the
 *  owning statement's account so a match cannot cross accounts. */
export async function getStatementLineForMatch(
  restaurantId: string,
  statementLineId: string,
): Promise<{ id: string; statement_id: string; account_id: string; amount: string; matched: boolean } | null> {
  const rows = await tsql<
    { id: string; statement_id: string; account_id: string; amount: string; matched: boolean }[]
  >`
    select l.id, l.statement_id, s.account_id, l.amount::text as amount,
           exists (select 1 from reconciliation_matches m where m.statement_line_id = l.id) as matched
    from statement_lines l
    join statements s on s.id = l.statement_id
    where s.restaurant_id = ${restaurantId} and l.id = ${statementLineId}`
  return rows[0] ?? null
}

/** Whether a movement is real, unmatched, and on this account — checked
 *  against the view rather than a hardcoded list of entity types, so a new
 *  money table joining money_movements is matchable the day it lands. */
export async function findUnmatchedMovement(
  restaurantId: string,
  accountId: string,
  entityType: string,
  entityId: string,
): Promise<UnmatchedMovementRow | null> {
  const rows = await tsql<UnmatchedMovementRow[]>`
    select m.entity_type, m.entity_id, m.kind, m.doc_no,
           m.move_date::text as move_date,
           m.amount::text as amount,
           m.party, m.narration
    from unmatched_movements m
    where m.restaurant_id = ${restaurantId}
      and m.account_id = ${accountId}
      and m.entity_type = ${entityType}
      and m.entity_id = ${entityId}`
  return rows[0] ?? null
}
