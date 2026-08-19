-- attendance_extra_hours_and_labour_hours
--
-- NO SHIFT MODEL. P / Half / Off / Leave / Absent is understood by every
-- restaurant on earth; two shifts is Thrayam's arrangement — a QSR rotates,
-- a cafe runs one, a hotel runs three. Shifts would cost a master, a
-- per-person assignment, 130 rows a day instead of 65 and a heavier sheet,
-- in exchange for precision nobody reads: for pay, half is half, and which
-- half changes no number.
--
-- What the five statuses genuinely cannot say is that somebody stayed late.
-- So: one nullable column, self-describing, no shift model needed — and the
-- one thing it unlocks is SALES PER LABOUR HOUR, which Rajesh's Owner sheet
-- has always computed and this app could not.
--
-- NO OVERTIME PAY IS COMPUTED ANYWHERE. Recording what happened and pricing
-- it are different jobs: overtime multipliers are set by statute, differ by
-- state and differ entirely outside this country. payroll_lines.overtime
-- stays a TYPED amount — the same rule as withholding.

begin;

-- ── 1. the column ────────────────────────────────────────────────────────
--
-- Hours worked BEYOND the normal day, so it is never 0 (a normal day is the
-- absence of a value, not a zero) and never a whole second day.

alter table attendance
  add column extra_hours numeric(5,2);

alter table attendance
  add constraint attendance_extra_hours_range
  check (extra_hours is null or (extra_hours > 0 and extra_hours <= 16));

grant insert (extra_hours), select (extra_hours) on attendance to kb_app;

-- attendance stays INSERT-only: an extra hour typed wrongly is corrected by
-- filing the day again, exactly as a wrong status is. No UPDATE grant.


-- ── 2. the normal day, as a setting ──────────────────────────────────────
--
-- Eight is the ILO standard normal working day and the near-universal
-- default, but it IS configurable, because a place that runs nine-hour days
-- would otherwise have every productivity figure out by an eighth.
--
-- It takes NO restaurant argument, and that is the security property, not an
-- omission: `settings` is RLS'd, so the function can only read the tenant
-- announced on the current transaction. Passing an id would let one tenant
-- ask about another's day. It therefore MUST be called through tsql/txn —
-- on the bare pool there is no GUC and the settings read finds nothing.
-- Same shape as business_date(), deliberately.

create or replace function public.standard_hours_per_day()
returns numeric
language sql
stable
as $$
  select coalesce(
    nullif((select value from settings where key = 'standard_hours_per_day'), '')::numeric,
    8
  )
$$;

grant execute on function public.standard_hours_per_day() to kb_app;


-- ── 3. attendance_current carries the hours ──────────────────────────────
--
-- Appended at the END of the select list: create-or-replace permits adding
-- columns there and nothing else, so every existing reader is untouched.

create or replace view public.attendance_current as
  select distinct on (staff_id, att_date)
    restaurant_id, staff_id, att_date, status, note, entered_by, created_at,
    extra_hours
  from attendance
  order by staff_id, att_date, created_at desc;


-- ── 4. hours, per department, per month ──────────────────────────────────
--
-- WORKED IS NOT PAID, AND THIS VIEW PUBLISHES BOTH RATHER THAN CHOOSING.
--
-- The pay law says off = 1: an off day is PAID, a stated assumption since
-- phase 5, and labour_cost_by_section applies it. But nobody WORKS an off
-- day, so counting it as eight hours would understate sales-per-hour by
-- about a seventh and quietly flatter or damn a department for its rota.
--
--   paid_days   — the pay law verbatim (present 1, half 0.5, off 1)
--   worked_days — hours actually on the floor (off, leave, absent all 0)
--
-- labour_hours is built from WORKED days plus the extra hours. Both columns
-- are here so the difference is readable rather than assumed.
--
-- Contract staff are excluded exactly as they are from labour cost — they
-- are billed by their vendor, and their hours are their vendor's business.

create view public.labour_hours_by_section as
  select
    st.restaurant_id,
    coalesce(s.code, '—') as section_code,
    coalesce(s.name, 'Unassigned') as section_name,
    date_trunc('month', a.att_date::timestamptz)::date as month,
    sum(case a.status
          when 'present' then 1::numeric
          when 'half' then 0.5
          when 'off' then 1::numeric
          else 0::numeric
        end) as paid_days,
    sum(case a.status
          when 'present' then 1::numeric
          when 'half' then 0.5
          else 0::numeric
        end) as worked_days,
    coalesce(sum(a.extra_hours), 0) as extra_hours,
    sum(case a.status
          when 'present' then 1::numeric
          when 'half' then 0.5
          else 0::numeric
        end) * standard_hours_per_day()
      + coalesce(sum(a.extra_hours), 0) as labour_hours,
    -- honesty columns, same law as unassigned_marks / unsalaried_marks:
    -- surface them whenever non-zero.
    count(*) filter (where st.section_id is null) as unassigned_marks,
    count(*) filter (where a.extra_hours is not null) as extra_marks
  from attendance_current a
  join staff st on st.id = a.staff_id
  left join sections s on s.id = st.section_id
  where st.employment_type <> 'contract'
  group by st.restaurant_id, coalesce(s.code, '—'), coalesce(s.name, 'Unassigned'),
           date_trunc('month', a.att_date::timestamptz)::date;

alter view public.labour_hours_by_section set (security_invoker = true);
grant select on public.labour_hours_by_section to kb_app;


-- ── 5. sales per labour hour ─────────────────────────────────────────────
--
-- A FULL JOIN, so a department with hours and no mapped sales still appears —
-- "we do not know what Chinese earns" is a finding and an absent row cannot
-- say it.
--
-- sales_per_hour IS NULL UNLESS BOTH SIDES ARE REAL, and the second half of
-- that was found by moving data through this view rather than by reading it.
-- The first draft divided coalesce(sales, 0) by real hours and published
-- ₹0.00 per labour hour for a department that has hours and no mapped sales
-- at all — a confident accusation built out of an absence, which is the one
-- thing this product refuses to do.
--
-- Note there is no honest zero available here: sales_by_section is grouped
-- from POS lines, so a department that sold nothing has NO ROW rather than a
-- zero row, and the two cases are indistinguishable from this side. So the
-- rate is stated only where a sales row exists, and `no_mapped_sales` says
-- which case a blank is.
--
-- Zero hours is the mirror: nobody worked, so there is no productivity to
-- report. Same rule as cogs staying NULL until closings exist.

create view public.sales_per_labour_hour as
  select
    coalesce(h.restaurant_id, s.restaurant_id) as restaurant_id,
    coalesce(h.section_code, s.section_code) as section_code,
    coalesce(h.section_name, s.section_name) as section_name,
    coalesce(h.month, s.month) as month,
    s.sales_value as sales,
    coalesce(h.labour_hours, 0) as labour_hours,
    case when coalesce(h.labour_hours, 0) > 0 and s.sales_value is not null
         then round(s.sales_value / h.labour_hours, 2)
    end as sales_per_hour,
    -- what the figure above cannot see, each said in its own column
    (s.section_code is null) as no_mapped_sales,
    (coalesce(h.labour_hours, 0) = 0) as no_hours,
    coalesce(h.extra_marks, 0) as extra_marks
  from labour_hours_by_section h
  full join sales_by_section s
    on s.restaurant_id = h.restaurant_id
   and s.section_code = h.section_code
   and s.month = h.month;

alter view public.sales_per_labour_hour set (security_invoker = true);
grant select on public.sales_per_labour_hour to kb_app;

commit;
