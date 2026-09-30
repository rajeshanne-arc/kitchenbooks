-- Freeze decided/payroll/count records at the database boundary. The runtime
-- role may still insert them and update only the explicitly mutable fields.

begin;

revoke update on public.payroll_lines from kb_app;
grant update (account_id, note, paid_on, pay_mode) on public.payroll_lines to kb_app;

revoke all privileges on public.purchase_invoice_matches from kb_app;
grant select, insert, delete on public.purchase_invoice_matches to kb_app;

revoke update on public.stock_counts from kb_app;
grant update (accepted_at, accepted_by) on public.stock_counts to kb_app;

revoke delete on public.pos_fetches from kb_app;

-- Deletes are reserved for rows that are intentions/caches or an explicit
-- judgement reversal. Event ledgers remain append-only at the grant boundary.
revoke delete on all tables in schema public from kb_app;
grant delete on public.indent_lines, public.pos_lines, public.pos_orders,
  public.purchase_order_lines, public.recipe_line_substitutions,
  public.recipe_lines, public.reconciliation_matches to kb_app;

revoke update on public.reconciliation_matches from kb_app;

commit;
