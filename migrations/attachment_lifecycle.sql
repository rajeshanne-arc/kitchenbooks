-- Retention state is metadata, not deletion. Archived evidence remains
-- readable for audit and can be handled by an external retention process.
begin;

alter table public.attachments
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived')),
  add column if not exists retention_until date;

create index if not exists attachments_lifecycle
  on public.attachments (restaurant_id, status, retention_until);

grant update (status, retention_until) on public.attachments to kb_app;
commit;
