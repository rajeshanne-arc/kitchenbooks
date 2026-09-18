-- Freeze decided/payroll/count records at the database boundary. The runtime
-- role may still insert them and update only the explicitly mutable fields.

begin;

revoke update on public.payroll_lines from kb_app;
grant update (account_id, note, paid_on, pay_mode) on public.payroll_lines to kb_app;

revoke update on public.purchase_invoice_matches from kb_app;
grant update (assessed_at, assessed_by, price_exception, quantity_exception, snapshot, status)
  on public.purchase_invoice_matches to kb_app;

revoke update on public.stock_counts from kb_app;
grant update (accepted_at, accepted_by) on public.stock_counts to kb_app;

revoke delete on public.pos_fetches from kb_app;

commit;
