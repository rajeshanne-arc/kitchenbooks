-- pos_prune_superseded_fetch_bodies
--
-- WHY THIS IS NOT THE ATTENDANCE CASE.
--
-- Every other event table in this schema holds something only WE hold: money
-- moved, goods arrived, somebody worked a day. It cannot be reconstructed, so
-- it is append-only and a correction is a reversal.
--
-- pos_orders and pos_lines are a CACHED COPY OF SOMEBODY ELSE'S SYSTEM.
-- Petpooja holds the truth; a fetch is a photocopy, and a re-fetch takes
-- another one. Deleting a superseded photocopy loses nothing that cannot be
-- fetched again, which is what makes the DELETE grant here legitimate and the
-- one on `attendance` not.
--
-- WHAT IT COSTS, stated so nobody discovers it later:
--
--   The DIFF between two generations of one date is a bill-modification
--   signal — an order whose total changed between fetches is an order
--   somebody edited after printing, which is exactly what Petpooja's own
--   Leakage panel reports. Pruning discards that signal.
--
--   Accepted, because if Petpooja reports modifications DIRECTLY then a diff
--   is a poor substitute for the real field, and the payload census settles
--   which within one fetch. IF THE CENSUS COMES BACK WITH NO MODIFICATION
--   FIELDS, REOPEN THIS — the diff is then the only signal available and
--   pruning is throwing away the only copy.
--
-- EVERY pos_fetches ROW IS KEPT. That is the audit trail — when we fetched,
-- how many orders, and the note that records skipped dates, duplicate ids and
-- status disagreements. Only the bodies of superseded fetches go.

begin;

grant delete on pos_orders to kb_app;
grant delete on pos_lines to kb_app;

-- pos_lines is deleted via its order, so the FK must not block the parent
-- delete. Confirm the constraint cascades; if it does not, this is the line
-- that matters and the app deletes lines first.
--
--   select confdeltype from pg_constraint
--   where conname like 'pos_lines%order_id%';   -- 'c' = cascade

commit;
