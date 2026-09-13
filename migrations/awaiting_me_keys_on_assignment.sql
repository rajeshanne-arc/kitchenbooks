-- awaiting_me: key on the ASSIGNMENT alone, not on a list of statuses.
--
-- WHY. The view answers one question — who must act next — and
-- `assigned_to` is the column that says so. The status list beside it was a
-- SECOND expression of the same idea, and the two have now disagreed twice:
--
--   'returned'  is in the list and the app never writes it. §3 settled that a
--               return cancels the ROUTING and not the APPROVAL, so a returned
--               request stays `approved`. A branch that can never match.
--
--   'refused'   is NOT in the list and now must be. A refusal is routed back
--               to whoever raised it and stays in their queue until they
--               acknowledge it — that is real work, waiting on a named role,
--               and the view cannot see it.
--
-- Keying on the assignment removes both faults at once and cannot drift
-- again, because it is no longer a copy of anything: every act that finishes
-- something sets assigned_to to null, and that is the only way work leaves a
-- queue.
--
-- WHAT ELSE THIS ADMITS, stated rather than discovered: a request that is
-- `failed` — approved, and the database refused to apply it — carries
-- assigned_to = 'owner' and starts being counted. That is correct. A yes that
-- did nothing is waiting on the owner to decide what to do about it, and it
-- was invisible before.
--
-- CREATE OR REPLACE VIEW SILENTLY DROPS reloptions, so security_invoker is set
-- again below. Tier 4 of audit:tenancy is what holds that rule; it has bitten
-- twice in this schema already, both times on the same day it was written down.

create or replace view public.awaiting_me as
select
    restaurant_id,
    assigned_to as role,
    kind,
    status,
    count(*) as n,
    min(requested_at) as oldest,
    sum(amount) as total_amount
  from approval_requests r
 where assigned_to is not null
 group by restaurant_id, assigned_to, kind, status;

alter view public.awaiting_me set (security_invoker = on);
