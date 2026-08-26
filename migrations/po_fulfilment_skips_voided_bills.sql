-- po_fulfilment counts a VOIDED delivery as delivered.
--
-- THE FOURTH INSTANCE OF A FAULT THIS PROJECT HAS ALREADY RECORDED THREE
-- TIMES. A bill is voided by a negative twin — a reversal row carrying the
-- same figures with the sign flipped — so every view over purchase_lines must
-- filter on the PARENT's reversal state in BOTH directions:
--
--   pu.reverses_id is null                     -- not the reversal row itself
--   and not exists (... x.reverses_id = pu.id) -- and not the bill it reversed
--
-- po_fulfilment has the first and is missing the second. `bills.is_voided` and
-- `vendor_supplied_items` both have both.
--
-- MEASURED on the probe tenant, rolled back: an order for 16, billed 14, then
-- that bill voided, still reports delivered 14 and a gap of −2. The goods came
-- back and the order still says they arrived — so a SHORT IS HIDDEN, which is
-- the direction that matters here: nobody chases a delivery the books say
-- turned up.
--
-- CREATE OR REPLACE VIEW SILENTLY DROPS reloptions, so security_invoker is set
-- again below. That has bitten twice in one day before now.

create or replace view po_fulfilment as
 select p.restaurant_id,
    p.id as po_id,
    p.doc_no,
    p.po_date,
    p.expected_date,
    p.status,
    v.code as vendor_code,
    v.name as vendor_name,
    it.code as item_code,
    it.name as item_name,
    it.purchase_unit,
    l.qty as qty_ordered,
    l.rate,
    coalesce(d.qty_delivered, 0::numeric) as qty_delivered,
    coalesce(d.qty_delivered, 0::numeric) - l.qty as gap
   from purchase_orders p
     join purchase_order_lines l on l.purchase_order_id = p.id
     join vendors v on v.id = p.vendor_id
     join items it on it.id = l.item_id
     left join ( select pu.purchase_order_id,
            pl.item_id,
            sum(pl.qty) as qty_delivered
           from purchase_lines pl
             join purchases pu on pu.id = pl.purchase_id
          where pu.purchase_order_id is not null
            and pu.reverses_id is null
            -- THE MISSING HALF: a bill that was voided is not a delivery.
            and not exists (select 1 from purchases x where x.reverses_id = pu.id)
          group by pu.purchase_order_id, pl.item_id) d
       on d.purchase_order_id = p.id and d.item_id = l.item_id
  where p.status <> 'cancelled'::text;

alter view po_fulfilment set (security_invoker = on);
