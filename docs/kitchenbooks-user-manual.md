# KitchenBooks User Manual

This is the operating manual for the hosted KitchenBooks demo and for a local
development copy. It explains what each role does, where to find it, and how
to run the project.

## Open the application

Hosted demo: <https://kb.etdemo.in>

The demo resets at midnight Asia/Kolkata. It is safe to experiment there, but
it is not a real restaurant account.

Demo accounts:

| User | Role | Password |
|---|---|---|
| `demo_manager` | Manager | `Demo@1234` |
| `demo_chef` | Chef | `Demo@1234` |
| `demo_store` | Store | `Demo@1234` |
| `demo_cashier` | Cashier | `Demo@1234` |
| `demo_accounts` | Accountant | `Demo@1234` |

The owner account is the existing owner account. Do not use demo credentials
for a real restaurant.

## How access works

KitchenBooks has six restaurant roles: owner, manager, chef, store, cashier,
and accountant. Navigation is filtered by role. A hidden menu item means the
role is not allowed to open that area; direct URLs are checked on the server.

Operational and financial events are append-only. A correction creates a
reversal or newer filing; it does not silently rewrite history. Derived totals
are read from database views after saving.

## Daily workflows

### Store

1. Enter a purchase at `/store/purchasing/import` or use the purchasing pages.
2. Select or create a vendor and items inline; the system assigns codes.
3. Save the bill and use the returned database-calculated totals.
4. Receive approved purchase orders and record stock issues or wastage.
5. Use counts when physical stock must be compared with book stock.

Bills, payments, issues, wastage, and counts are never edited in place. Use
the available void or correction action.

### Kitchen

1. Review or create an indent: this records what the kitchen asked for.
2. The store issues what was actually given; the app shows the gap.
3. Maintain recipes using gross quantities, including trimming and loss.
4. Record sub-recipe production; production records do not move stock.
5. Record itemized kitchen closing value for kitchen and bar sections.
6. Record kitchen wastage as a component or a value-only event.

### Cashier

1. Fetch or enter the business day’s sales.
2. Record vouchers, other income, settlements, off-book orders, and
   non-revenue events using the provided lists.
3. Close the day with counted cash, handed-over cash, and the bank block.
4. If the previous business day is not closed, the next close is refused until
   that missing day is filed.

Owner-funded vouchers do not change drawer cash. The day-close view handles
the owner debt and reimbursement treatment.

### Staff

Managers and owners maintain employees and attendance. Attendance corrections
are new marks; the latest mark for a person and day is displayed while history
remains available.

### Owner and manager

Use the dashboard to follow the operational questions and open the source
record behind each number. Use `/owner/approvals` for purchase orders waiting
for approval. Refusals require a decision note. Use P&L, activity, setup, and
snapshot pages for review and month-end control.

### Accountant

The accountant reviews sales, cash, dues, settlements, expenses, and the
accounting context exposed to that role. Provider statement reconciliation and
a final payroll/payment handoff remain separate controlled workstreams.

## Honest warnings

Red or hatched warnings are intentional. They identify missing closing data,
unknown POS statuses, unmapped items, negative stock, uncosted recipe lines,
unassigned staff, or other incomplete evidence. Do not treat pending as zero.

## Petpooja demo mode

The hosted demo uses seeded Petpooja-shaped data. Real provider credentials are
deployment secrets and are not stored in the repository or entered into chat.
Local development refuses a live Petpooja call when credentials are absent;
use the seeded/demo adapter for local exploration.

## Run KitchenBooks in VS Code

### Web application

1. In VS Code choose **File → Open Folder…** and open
   `/Users/sunny/Desktop/kitchenbooks`.
2. Open **Terminal → New Terminal**.
3. Install dependencies once:

   ```bash
   npm install
   ```

4. Create local configuration:

   ```bash
   cp .env.example .env.local
   ```

   Fill the server-only values in `.env.local`. This app uses `DATABASE_URL`
   on the server; do not add database credentials or Supabase keys to browser
   variables. Use a disposable/local database for development.

5. Start Next.js:

   ```bash
   npm run dev
   ```

6. Open <http://localhost:3000>. The terminal shows the actual port if 3000 is
   already in use.

### Mobile application

Open a second VS Code terminal:

```bash
cd apps/mobile
npm install
npx expo start
```

For a native simulator build:

```bash
npx expo run:ios
# or
npx expo run:android
```

On iOS, open `apps/mobile/ios/KitchenBooks.xcworkspace` in Xcode after
`pod install`; do not open the `.xcodeproj` directly. A Debug development
client needs Metro running. A Release build embeds the JavaScript bundle and
does not need Metro.

The mobile app talks to the Next.js API, never directly to PostgreSQL. Set the
mobile API base URL in mobile configuration when testing a non-hosted server.

## Verification commands

From the repository root:

```bash
npx tsc --noEmit
npm run lint
npx tsc --noEmit -p apps/mobile/tsconfig.json
cd apps/mobile && npx expo-doctor
```

Database-backed smoke tests require an explicitly selected disposable tenant;
read `docs/acceptance-tests.md` before running them.

## Troubleshooting

- **Server error after login:** inspect the server log and confirm current
  database migrations are applied. Do not reset the database password.
- **Wrong username or password:** use a demo account above, or ask the owner
  to reset the restaurant user through user management.
- **No script URL provided on iOS:** start Metro for Debug, or build/install a
  Release configuration with the embedded JavaScript bundle.
- **Approvals page fails:** confirm the financial ledger views migration is
  applied in the same database used by the running service.
- **Demo records changed:** wait for the midnight reset or run the guarded
  demo-reset procedure on the staging host.

## Related engineering documents

- [Product specification](product-spec.md)
- [Demo environment](demo-environment.md)
- [Acceptance tests](acceptance-tests.md)
- [Mobile implementation ledger](mobile-implementation-status.md)
- [Migration runbook](migration-runbook.md)
- [Production release checklist](production-release-checklist.md)
- [Role SOP proposal](role-sops-proposal.md)
