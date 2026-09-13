# KitchenBooks demo environment

The hosted demo restaurant is intentionally separate from real restaurant
tenants. It exists so every major KitchenBooks workflow can be explored with
realistic records already present.

## Hosted demo

- URL: `https://kb.etdemo.in`
- Restaurant: `KitchenBooks Demo Kitchen`
- Reset schedule: every day at `00:00` Asia/Kolkata
- Reset mechanism: systemd timer calling the authenticated demo-reset route
- Demo tenant id: stored only in the server environment

## Demo logins

The existing owner account remains the owner login. Additional role accounts
are seeded for navigation and permission testing:

| Username | Role | Password |
|---|---|---|
| `demo_manager` | Manager | `Demo@1234` |
| `demo_chef` | Chef | `Demo@1234` |
| `demo_store` | Store | `Demo@1234` |
| `demo_cashier` | Cashier | `Demo@1234` |
| `demo_accounts` | Accountant | `Demo@1234` |

These credentials are demo-only and must never be used for a real restaurant.

## Seeded functional areas

The reset creates representative data for:

- Restaurant settings, business-day rules, POS stock policy, approval settings,
  departments, sections, and storage locations.
- Vendors, ingredients, units, categories, reorder levels, expiry tracking,
  and vendor contacts.
- Staff, roles, salary structures, attendance, holidays, leave policies,
  leave requests, payroll statutory configuration, and an approved payroll run.
- Recipes, sub-recipes, recipe lines, recipe versions, substitutions,
  selling prices, POS mappings, expected production, waste, and variance review.
- Purchase bills, purchase lines, purchase orders, pending approval, vendor
  quotes, invoice-match evidence, and payable context.
- Stock issues, stock lots, FEFO-ready inventory, receiving locations, and
  stock-on-hand context.
- Petpooja-shaped POS fetches, revenue/cancelled orders, payment modes,
  item mappings, sync-run history, and reconciliation context.
- Chart of accounts, posting mappings, cash/bank accounts, expenses, cash
  vouchers, other income, recurring-accounting context, accruals, and fixed
  assets.
- Meter readings and operational evidence context.

## Reset behavior

At midnight, the reset:

1. Deletes tenant-scoped demo data using a database-owned reset function.
2. Preserves the existing demo owner identity so the owner can still sign in.
3. Removes demo-created users, memberships, records, approvals, imports,
   accounting evidence, and operational changes.
4. Recreates the complete seed dataset with dates relative to the reset day.
5. Does not target the live restaurant or the separate acceptance-probe tenant.

The reset function refuses to operate unless the target tenant has the explicit
`demo_reset_enabled=true` marker. The route also requires a separate server-only
reset secret. No reset secret is exposed to the browser.

## Files and deployment units

- `migrations/demo_environment.sql` — reset and seed database functions.
- `src/app/api/cron/demo-reset/route.ts` — authenticated reset endpoint.
- `scripts/reset-demo.ts` — manual reset command.
- `deploy/kitchenbooks-demo-reset.service` — one reset execution.
- `deploy/kitchenbooks-demo-reset.timer` — midnight Asia/Kolkata schedule.
