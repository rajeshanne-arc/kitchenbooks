-- business_day_in_thirty_day_windows
--
-- Two views ask "what day is it?" with CURRENT_DATE. The session runs in UTC,
-- so CURRENT_DATE disagrees with business_date(now()) for thirty minutes every
-- day — 05:00 to 05:29 IST at the current cutover — and it disagrees by a whole
-- day for the five and a half hours before that in any timezone west of UTC.
--
-- Nothing period-scoped is affected: neither view takes a date range, and no
-- figure a period reports comes through them. What shifts is the 30-day window
-- each one uses to decide "slow moving" and "frequently taken", and
-- days_since_bought can be off by one.
--
-- WHY THIS IS SAFE TO REPLACE. business_date(timestamptz) takes no restaurant
-- argument by design: it reads `settings` under RLS, so it can only ever answer
-- for the tenant announced on the current transaction. Both views are already
-- security_invoker and every reader in the app goes through tsql/txn, which
-- announces the tenant as its first statement.
--
-- WHAT IT COSTS. Each of these queries gains one settings read. Neither view is
-- on a hot path — the reorder screen and the two suggestion pickers — and the
-- alternative is a figure that is wrong for half an hour a day with nothing on
-- screen to say so.
--
-- NOT CHANGED, and deliberately: pos_orders.business_date carries PETPOOJA's
-- cutover rather than ours, and no view can fix that. It is a settings problem
-- and the warning belongs where the cutover is set — Settings → the day, and
-- where you are — which is where it now is.

create or replace view slow_moving_stock as
 SELECT s.restaurant_id,
    s.item_id,
    s.code,
    s.name,
    s.category,
    s.on_hand_qty,
    s.purchase_unit,
    s.on_hand_value,
    lb.last_bought,
    business_date(now()) - lb.last_bought AS days_since_bought
   FROM stock_on_hand s
     LEFT JOIN ( SELECT pl.item_id,
            max(p.bill_date) AS last_bought
           FROM purchase_lines pl
             JOIN purchases p ON p.id = pl.purchase_id
          GROUP BY pl.item_id) lb ON lb.item_id = s.item_id
  WHERE s.on_hand_qty > 0::numeric
    AND (lb.last_bought IS NULL OR lb.last_bought < (business_date(now()) - '30 days'::interval));

create or replace view section_frequent_items as
 SELECT i.restaurant_id,
    i.section_id,
    s.code AS section_code,
    l.item_id,
    it.code AS item_code,
    it.name AS item_name,
    it.purchase_unit,
    count(*) AS times_issued,
    max(i.issue_date) AS last_issued,
    sum(l.qty) AS total_qty,
    avg(l.qty) AS typical_qty
   FROM issue_lines l
     JOIN issues i ON i.id = l.issue_id
     JOIN sections s ON s.id = i.section_id
     JOIN items it ON it.id = l.item_id
  WHERE i.reverses_id IS NULL
    AND i.issue_date >= (business_date(now()) - '30 days'::interval)
  GROUP BY i.restaurant_id, i.section_id, s.code, l.item_id, it.code, it.name, it.purchase_unit;
