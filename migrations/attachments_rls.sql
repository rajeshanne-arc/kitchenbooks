-- Tenant protection for attachment metadata. The blob itself is private and
-- is only reached through the authenticated application route.

begin;

alter table public.attachments enable row level security;
alter table public.attachments force row level security;
drop policy if exists tenant_isolation on public.attachments;
create policy tenant_isolation on public.attachments
  using (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid)
  with check (restaurant_id = nullif(current_setting('app.restaurant_id', true), '')::uuid);

revoke delete on public.attachments from kb_app;
grant select, insert on public.attachments to kb_app;
grant update (caption) on public.attachments to kb_app;

commit;
