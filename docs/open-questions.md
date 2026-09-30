# Open questions

There are no product decisions blocking implementation. The product owner
approved the current specification and release sequence on 2026-09-13.

Ground rule #1 applies: unresolved implementation details are resolved using
the approved defaults and recorded here; they are not a reason to stop. Only a
missing external dependency or an irreversible live-data approval can pause
the work.

The membership migration is prepared but intentionally not applied to the
shared database yet. It must be run by the database migration owner (the
`kb_app` runtime role cannot safely own schema changes), then verified against
the existing live users before the application starts reading extra
memberships.

The leave carry-forward migration is also prepared and must be applied after
`leave_requests.sql`. Until then, the new attendance balance screen cannot use
the formal ledger; no carry-forward data has been written to the shared
database.

After verification, set `KB_MEMBERSHIPS=true` in the application environment.
Leaving it unset keeps the compatibility login path; enabling it before the
migration exists will fail closed rather than silently selecting the wrong
restaurant.

Set `KB_PLATFORM_ADMIN_KEY` only in the server environment. The protected
`POST /api/platform/provision` endpoint uses it to create a restaurant and its
first owner atomically; it is not a restaurant-role credential and must never
be sent to a browser.

Approved implementation defaults (not product blockers) are: India payroll and
GST/TDS workflows, Asia/Kolkata timezone, one primary stock location with the
schema able to support more, manual Petpooja sync plus scheduled polling, and
English copy with Telugu translations added per staff workflow. Statutory rates
and filing formats remain accountant-configured inputs; the application must
not invent a tax rule.

WhatsApp provider credentials/template approval and Petpooja production
credentials/webhook access/rate limits remain deployment dependencies. They can
pause a live integration rollout, but they do not pause local feature work or
the demo adapter. Telugu terminology receives a final staff review before the
first rollout.

The current Supabase connection still has no restaurant seed row, and the
feature schema audit reports the pending migration-backed columns as absent
(including purchase approvals, production variance, payroll policy fields, and
accounting mappings). A read-only recheck on 2026-09-13 still fails the schema
gate with those missing columns; no live write was attempted. The strict
tenancy baseline itself is healthy: the live connection currently reports
forced/policied RLS on 72 tenant tables and security-invoker execution on 82
views. Dashboard and group smoke suites therefore stop at `getRestaurant()`
before exercising any workflow. Do not seed the shared database from a smoke
test; the database owner must apply the base seed/migrations or provide a
dedicated probe tenant first.
