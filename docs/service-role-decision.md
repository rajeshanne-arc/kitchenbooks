# service_role: what a leaked secret key would cost, and what revoking it might

**Status: a decision for Rajesh.** Nothing has been changed.

`anon` and `authenticated` now hold nothing in `public`, and the default
privileges that would hand it back are revoked for `postgres` — the role that
owns all 72 app tables and creates everything a migration creates. That half is
done and frozen by two gates.

`service_role` is untouched, and it is the larger of the two.

## Its exact standing, measured

```
service_role   rolbypassrls = true   rolcanlogin = false   rolsuper = false
               SELECT on 147/147 relations in public
               DELETE on 147/147 relations in public
```

It cannot log in, so it is reachable only through PostgREST — which is exactly
what an `sb_secret_…` key is for.

**Two things make this worse than it first reads.**

`rolbypassrls` means every policy on all 68 tenant tables is skipped. Not
"could be misconfigured" — skipped, by the role's own attribute in `pg_roles`.
So the wall that holds `anon` back does not exist for this key.

And it holds **DELETE on all 147 relations.** `kb_app` holds DELETE on exactly
five, each of which cost an argument written down in AGENTS.md. **The
append-only guarantee that the whole ledger rests on does not apply to this
key.** A leak is not only "somebody reads every restaurant's books"; it is
"somebody can erase them, and the reversal-row discipline never sees it."

## What actually uses it here — enumerated, not assumed

| Possible consumer | Present? |
|---|---|
| Edge Functions | **none** (checked via the Supabase API) |
| Database webhooks | **none** |
| HTTP-calling triggers (`pg_net`, `http`) | **none** — those extensions are not installed |
| `pg_cron` jobs | **none** — extension not installed |
| Any non-internal trigger in `public` | **zero** |
| This app | **no** — one secret, `DATABASE_URL`, connecting as `kb_app`. No Supabase SDK. |

So **nothing in the project consumes it.** The unknown is one thing and one
thing only: **Supabase's own Dashboard.** Neither of us can test that from
here.

## The asymmetry, which is the actual argument

- **If the Dashboard breaks**, you find out within seconds, on your own screen,
  the first time you open the Table Editor — and one `grant` statement puts it
  back exactly as it was.
- **If the key leaks, you never find out.** There is no log that says a valid
  key read every restaurant's books, because a valid key reading data is what
  the key is for.

One failure is loud, immediate and reversible in a minute. The other is silent
and permanent. That asymmetry is what decides it, not a guess about the
Dashboard.

## Two tests you can actually run

**1. Does the SQL Editor even use it?** In the Supabase SQL editor:

```sql
select current_user;
```

If that answers `postgres` — which is what I expect — then migrations and all
ad-hoc SQL are on a different path entirely and are unaffected by anything
below. That is worth knowing before you touch it, and it costs one query.

**2. The Table Editor question is revoke-and-look.** There is no introspection
that answers it, and because the failure is loud and instantly reversible, the
cheapest way to answer an untestable question here is to run the experiment at
a quiet hour.

## Recommendation

**Revoke the table grants. Leave `rolbypassrls` alone.**

Revoking the privileges is sufficient — bypassing RLS on a table you have no
privilege to touch grants nothing, so there is no need to alter a role
attribute, which is the riskier and less reversible change.

```sql
-- and the default privileges too, or the next table hands it straight back:
--   alter default privileges for role postgres in schema public
--     revoke all on tables, sequences, functions from service_role;
```

If the Table Editor stops working, restore with the matching `grant` and we
have lost ten minutes and learned the answer. If it keeps working, a published
secret key stops being a master key to every restaurant's books.

**What you lose in the bad case:** a convenient grid view of tables you can
already reach through the SQL editor, and through this app.
**What you gain:** the one credential that could silently read *and delete*
every tenant's ledger stops being able to.
