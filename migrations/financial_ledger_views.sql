-- Financial views and columns consumed by the current purchasing, payroll and
-- advances screens.  These are kept in a migration because the app role must
-- never create them during a request.

begin;

alter table public.staff_advances add column if not exists instalment numeric;
alter table public.staff_advances add column if not exists expected_end date;
alter table public.cash_vouchers add column if not exists staff_advance_id uuid;

create or replace view public.bills_outstanding
with (security_invoker = true)
as
with active_bills as (
  select p.id as purchase_id, p.restaurant_id, p.vendor_id, p.bill_no,
         p.bill_date, p.bill_total,
         case
           when p.bill_date is null then null::date
           when lower(coalesce(v.payment_terms, '')) ~ '^[0-9]+[[:space:]]*days?$'
             then p.bill_date + (regexp_replace(lower(v.payment_terms), '[^0-9]', '', 'g')::int)
           else null::date
         end as due_date,
         case
           when lower(coalesce(v.payment_terms, '')) ~ '^[0-9]+[[:space:]]*days?$'
             then regexp_replace(lower(v.payment_terms), '[^0-9]', '', 'g')::int
           else null::int
         end as net_days
  from public.purchases p
  join public.vendors v on v.restaurant_id = p.restaurant_id and v.id = p.vendor_id
  where p.reverses_id is null
    and not exists (select 1 from public.purchases x where x.restaurant_id = p.restaurant_id and x.reverses_id = p.id)
), payments as (
  select restaurant_id, vendor_id, coalesce(sum(amount), 0) as paid
  from public.payments
  where reverses_id is null
  group by restaurant_id, vendor_id
), ranked as (
  select b.*, coalesce(pay.paid, 0) as vendor_paid,
         coalesce(sum(b.bill_total) over (
           partition by b.restaurant_id, b.vendor_id
           order by b.bill_date, b.purchase_id
           rows between unbounded preceding and 1 preceding
         ), 0) as prior_bills
  from active_bills b
  left join payments pay on pay.restaurant_id = b.restaurant_id and pay.vendor_id = b.vendor_id
)
select purchase_id, restaurant_id, vendor_id, bill_no, bill_date, bill_total,
       greatest(bill_total - greatest(vendor_paid - prior_bills, 0), 0) as unpaid,
       due_date, net_days
from ranked;

create or replace view public.vendor_aging
with (security_invoker = true)
as
select v.restaurant_id, v.id as vendor_id, v.code as vendor_code, v.name as vendor_name,
       v.payment_terms,
       coalesce(sum(b.unpaid) filter (where b.unpaid > 0), 0) as outstanding,
       coalesce(sum(b.unpaid) filter (where b.unpaid > 0 and b.net_days is null), 0) as terms_not_set,
       min(b.due_date) filter (where b.unpaid > 0) as oldest_due,
       max(b.bill_date) filter (where b.unpaid > 0) as latest_unpaid_bill,
       count(*) filter (where b.unpaid > 0)::int as open_bills
from public.vendors v
left join public.bills_outstanding b on b.restaurant_id = v.restaurant_id and b.vendor_id = v.id
where v.status = 'active'
group by v.restaurant_id, v.id, v.code, v.name, v.payment_terms
having coalesce(sum(b.unpaid) filter (where b.unpaid > 0), 0) > 0;

create or replace view public.vendor_credit
with (security_invoker = true)
as
select v.restaurant_id, v.id as vendor_id, v.code, v.name,
       greatest(-d.balance, 0) as credit,
       (select max(p.bill_date) from public.purchases p where p.restaurant_id = v.restaurant_id and p.vendor_id = v.id and p.reverses_id is null) as last_bill,
       v.payment_terms
from public.vendors v
join public.vendor_dues d on d.restaurant_id = v.restaurant_id and d.vendor_id = v.id
where v.status = 'active' and d.balance < 0;

create or replace view public.staff_owes
with (security_invoker = true)
as
with advanced as (
  select a.restaurant_id, a.staff_id,
         sum(case when a.instalment is null then a.amount else 0 end) as advances_given,
         sum(case when a.instalment is not null then a.amount else 0 end) as loans_given,
         max(a.instalment) as instalment, max(a.expected_end) as expected_end,
         sum(a.amount) as total
  from public.staff_advances a
  where a.reverses_id is null
    and not exists (select 1 from public.staff_advances x where x.restaurant_id = a.restaurant_id and x.reverses_id = a.id)
  group by a.restaurant_id, a.staff_id
), recovered as (
  select r.restaurant_id, l.staff_id, sum(l.advance_recovered) as recovered
  from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id
  where r.status <> 'cancelled'
  group by r.restaurant_id, l.staff_id
)
select s.restaurant_id, s.id as staff_id, s.code, s.name, s.status as staff_status,
       s.base_salary, a.advances_given, a.loans_given, a.instalment, a.expected_end,
       coalesce(r.recovered, 0) as recovered,
       greatest(coalesce(a.total, 0) - coalesce(r.recovered, 0), 0) as outstanding,
       case when s.base_salary is null or s.base_salary <= 0 then null
            else greatest(coalesce(a.total, 0) - coalesce(r.recovered, 0), 0) / s.base_salary end as months_of_salary
from public.staff s
join advanced a on a.restaurant_id = s.restaurant_id and a.staff_id = s.id
left join recovered r on r.restaurant_id = s.restaurant_id and r.staff_id = s.id;

create or replace view public.advances_ledger
with (security_invoker = true)
as
select restaurant_id, 'salary advance'::text as kind, code as subject_code, name as subject,
       outstanding as amount, months_of_salary as exposure
from public.staff_owes where outstanding > 0 and instalment is null
union all
select restaurant_id, 'loan'::text, code, name, outstanding, months_of_salary
from public.staff_owes where outstanding > 0 and instalment is not null
union all
select restaurant_id, 'vendor credit'::text, code, name, credit, null::numeric
from public.vendor_credit where credit > 0;

grant select on public.bills_outstanding, public.vendor_aging, public.vendor_credit,
  public.staff_owes, public.advances_ledger to kb_app;

commit;
