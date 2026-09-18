# KitchenBooks mobile implementation ledger

This file is the continuity record for the iOS and Android build. Update it
after every material mobile change. Do not infer completed work from the plan;
only mark a slice complete when its code, tests, and deployment evidence exist.

## Product and architecture decisions

- Build both apps from one React Native + Expo codebase.
- Keep the existing Next.js server and PostgreSQL database authoritative.
- Mobile never connects directly to PostgreSQL, Supabase, or filesystem storage.
- Mobile uses versioned APIs under `/api/mobile/v1`.
- Server-side services remain the single implementation of business rules,
  tenant isolation, role checks, business-day rules, approvals, and audit trails.
- Use SecureStore for session secrets; use SQLite for offline cache and queued
  mutations.
- High-frequency field work comes first: attendance, receiving, stock, kitchen,
  sales/cash, and approvals. Complex accounting/print screens remain web-first
  until a mobile version proves useful.
- No fake production integration: demo data is clearly demo data; Petpooja and
  storage providers remain behind server-owned adapters.

## User instruction / ground rule

The user asked to finish the mobile apps end to end and specifically asked that
context not be lost. Continue from this ledger, the mobile plan, and the code;
do not restart the architecture or silently replace prior decisions.

The user further established: do not stop and report progress until every
pending mobile item is finished end to end. Continue through the recorded
sequence; only stop for a genuinely external blocker that cannot be resolved
within the workspace and authorized server.

## Completed

### Planning

- [x] Created `docs/mobile-app-plan.md`.
- [x] Chosen the first vertical slice order: auth/session → attendance →
  offline queue/sync → purchasing/stock → kitchen → sales/cash → approvals →
  owner/accountant companion → release hardening.

### Mobile workspace

- [x] Created `apps/mobile` with Expo SDK 57, React Native 0.86, and TypeScript.
- [x] Added `expo-secure-store` and `expo-sqlite`.
- [x] Replaced the starter screen with a KitchenBooks mobile shell:
  - sign-in form;
  - secure session restore/sign-out;
  - role-aware home actions;
  - business-day alert;
  - online status indicator;
  - touch feedback and responsive phone layout.
- [x] Mobile TypeScript passes.
- [x] Expo Doctor passes all 21 checks.

### Server mobile boundary

- [x] Added `POST /api/mobile/v1/auth/login`.
- [x] Login reuses the existing `verifyCredentials`/
  `verifyGlobalCredentials` logic and signed session format.
- [x] Added `GET /api/mobile/v1/me`.
- [x] Added bearer-token recognition for `/api/mobile/*` in the proxy and
  server current-user resolution.
- [x] Added only the mobile login endpoint to the public proxy allowlist.
- [x] Deployed the API additions to `https://kb.etdemo.in`.
- [x] Live invalid-credential probe returns generic HTTP 401.
- [x] Existing web service remains active and landing page returns HTTP 200.
- [x] Added `POST /api/mobile/v1/auth/refresh` for bearer-authenticated token
  renewal without changing the web cookie flow.

### Attendance vertical slice

- [x] Added `GET /api/mobile/v1/attendance`, defaulting to the server business
  day and returning the existing effective attendance sheet.
- [x] Added `POST /api/mobile/v1/attendance`, reusing `saveAttendance` so
  append-only corrections and validation remain server-owned.
- [x] Added the mobile attendance screen with explicit P / ½ / O / L / A
  controls and a server-confirmed save message.
- [x] Deployed the attendance API, proxy, and bearer-aware current-user code;
  the KitchenBooks service remains active.
- [x] Web TypeScript, ESLint, mobile TypeScript, Expo Doctor, and diff checks
  pass after this slice.

### Native retry foundation

- [x] Added `migrations/mobile_mutations.sql` for tenant-scoped idempotency
  records.
- [x] Added server reservation/replay/finalization helpers.
- [x] Attendance mutations now require a client mutation ID and replay the
  accepted result on duplicate delivery.
- [x] The mobile client sends a unique mutation ID for each attendance save.
- [x] Applied the additive migration to the deployed `kitchenbooks` database.
- [x] Added a SQLite `pending_mutations` queue and cached attendance sheet.
- [x] Attendance network failures now persist locally with the original
  client mutation ID; the next successful attendance load flushes queued saves.
- [x] Successful queued saves are removed only after a server 2xx response;
  validation/conflict failures remain visible for later handling.

### Cross-domain mobile mutation gateway

- [x] Added `POST /api/mobile/v1/mutations` with an explicit allowlist for
  existing store, kitchen, sales/cash, and approval actions.
- [x] Each gateway mutation uses the same tenant-scoped idempotency reserve,
  replay, and finalization path as attendance.
- [x] Action-level validation and role checks remain in the existing server
  actions; the gateway does not accept arbitrary function names or SQL.
- [x] Deployed the gateway and verified unauthenticated access is rejected.

### Mobile bootstrap/read contract

- [x] Added `GET /api/mobile/v1/bootstrap` for the signed-in restaurant,
  server business date, role identity, and key alert counts.
- [x] Mobile home now reads its business-day label and missing-close alert from
  the server instead of hard-coded demo text.
- [x] Deployed the bootstrap route and rebuilt the live service.

### Store/stock slice

- [x] Added `GET /api/mobile/v1/stock`, backed by the existing stock-on-hand
  view, stock badge, and total-value query.
- [x] Added a mobile stock-on-hand screen with current value, item quantity,
  units, category, and item value.
- [x] Connected the home screen's role-appropriate `Review stock` action to
  the real stock screen.
- [x] Deployed the stock route and rebuilt the live service.
- [x] Mobile/web type checks, lint, and diff checks pass.

### Kitchen read slice

- [x] Added `GET /api/mobile/v1/kitchen`, backed by production and kitchen
  wastage query models.
- [x] Added a mobile kitchen production history screen.
- [x] Connected chef actions for production/recipes to the kitchen screen.
- [x] Deployed the route and verified the live service remains active.

### Sales/cash read and close slice

- [x] Added `GET /api/mobile/v1/sales`, backed by the existing close prefill,
  cash ladder, settlement, and due queries.
- [x] Added a mobile sales/cash screen that shows the server's business date
  and close prefill, then captures counted cash, handover, recipient, and a
  note.
- [x] Added `sales.day-close.save` to the explicit mutation gateway and routed
  it through the existing `closeDay` action, preserving server validation,
  business-day rules, and audit behavior.
- [x] Fixed failed mobile mutation records so a later retry can reserve and
  attempt the same client mutation again.
- [x] Deployed the sales route, mutation gateway, and retry fix; the live
  service is active and unauthenticated probes return HTTP 401.
- [x] Web/mobile TypeScript, ESLint, and diff checks pass for this slice.

### Owner approvals read slice

- [x] Added `GET /api/mobile/v1/approvals`, backed by the existing unified
  waiting queue so mobile sees pending approval requests from the same source
  as the web owner view.
- [x] Connected the owner's `Review approvals` home action to a mobile queue
  screen with loading, empty, error, status, reason, requester, and date
  states.
- [x] Deployed the route and verified unauthenticated access returns HTTP 401.
- [x] The queue includes pending purchase-order approval details from the
  existing purchase approval query.
- [x] Added mobile approve/refuse controls with required refusal notes; both
  route through the existing owner-only purchase approval action.
- [x] Successful decisions remove the item from the local queue and preserve
  the server's approval/audit rules through the idempotent mutation gateway.
- [x] Deployed the approval read/write slice and rebuilt the live service.

### Purchasing read slice

- [x] Added `GET /api/mobile/v1/purchasing`, returning open purchase orders and
  open kitchen indents from the existing tenant-scoped queries.
- [x] Connected store and manager home actions to a mobile purchasing screen
  showing order status, approval state, vendor, totals, and pending indents.
- [x] Deployed the route and verified unauthenticated access returns HTTP 401.
- [x] Purchase-order creation, bill receiving, and receipt/photo capture remain
  the next write step because they require their full line-level forms and
  expiry/lot validation rather than a partial mobile shortcut.

### Mobile session resilience

- [x] Restored native sessions now call the deployed bearer refresh endpoint
  before opening the app.
- [x] The refreshed session is written back to SecureStore.
- [x] An expired or invalid stored session is cleared and returns to sign-in;
  it no longer leaves the user inside a broken authenticated shell.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass after this change.

### Mobile receiving write slice

- [x] Expanded `GET /api/mobile/v1/purchasing` with active vendor and item
  choices for receiving.
- [x] Added a mobile receiving form for bill date, supplier bill number,
  existing vendor, existing item, quantity, rate, GST, and transport.
- [x] Added `purchasing.bill.save` to the idempotent mutation gateway and
  routed it through the existing `saveBill` transaction.
- [x] The server remains responsible for lot creation, expiry validation,
  cost snapshots, vendor dues, and accounting journal posting.
- [x] Deployed and rebuilt the live service; unauthenticated purchasing access
  remains rejected with HTTP 401.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass.

### Completion hardening

- [x] Added request-time 401 interception so an open mobile screen clears the
  stored session and returns to sign-in when the bearer session expires.
- [x] Added deep-link routing for app URLs and notification response routing to
  the corresponding mobile screen.
- [x] Added native app identifiers, camera privacy text, notification plugin,
  and EAS development/preview/production profiles.
- [x] iOS and Android JavaScript bundles export successfully.
- [x] Expo Doctor passes 21/21 checks.
- [x] Native iOS Debug simulator build succeeds and installs on `SkillActive
  Test` after targeted disposable-cache cleanup.
- [x] Native iOS Release simulator build succeeds with the JavaScript bundle
  embedded, installs, and launches to the KitchenBooks sign-in screen without
  Metro. This is the correct standalone path for avoiding “No script URL”.
- [ ] The Debug development client still requires Metro to be running when it
  is launched; opening it without Metro will intentionally show the red
  “No script URL provided” screen.
- [x] Android JavaScript export succeeds. Native Android verification was
  checked, but this Mac has no `adb` or configured Android emulator available.
- [x] Final project checks pass: mobile TypeScript, Expo Doctor 21/21, iOS and
  Android bundle export, web TypeScript, ESLint, and `git diff --check`.
- [x] The deployed web service is active and `https://kb.etdemo.in/login`
  returns HTTP 200.

### Mobile receiving multi-line slice

- [x] Receiving now supports multiple bill lines in one transaction.
- [x] Each line has its own existing-item selection, quantity, rate, and
  optional expiry date.
- [x] The client submits all lines through the same `saveBill` gateway path;
  server-side item expiry rules still decide whether an expiry is required.
- [x] Added an explicit “add another line” interaction rather than silently
  overwriting the previous item.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass.

### Mobile PO prefill read slice

- [x] `GET /api/mobile/v1/purchasing?poId=...` now returns the complete
  purchase-order header and line detail from the tenant-scoped query.
- [x] Receiving can load an eligible sent/received order and prefill its
  vendor, quantities, rates, and item lines for review.
- [x] The receiving form exposes eligible sent/received orders for prefilling.
- [x] Deployed the route and rebuilt the live service; local checks pass.

### Mobile PO fulfilment linkage

- [x] The selected purchase-order ID is now carried into the
  `purchasing.bill.save` payload.
- [x] A bill loaded from a PO therefore enters the existing `saveBill` path as
  a fulfilment, preserving the server's PO comparison and stock rules.
- [x] The mobile app, web app, and lint/diff checks pass after this change.

### Mobile attachment upload boundary

- [x] Added `POST /api/mobile/v1/attachments` with bearer-session
  authentication.
- [x] The route delegates to the existing private attachment action, including
  role checks, MIME/size validation, storage-key isolation, and attachment-row
  creation.
- [x] Added Expo image-picker dependency and client upload plumbing after a
  bill is saved, preserving the rule that a failed photo never rolls back a
  correct bill.
- [x] Deployed the upload boundary and rebuilt the live service.
- [x] Exposed the visible “Take bill photo” control in the mobile receiving
  form, requesting camera permission before capture.
- [x] The captured image is uploaded after the bill save to the private mobile
  attachment endpoint; a failed upload leaves the bill intact and reports the
  issue.
- [x] Unauthenticated live attachment probe returns HTTP 401; mobile/web
  TypeScript, ESLint, and diff checks pass.

### Mobile purchase-order write slice

- [x] Added explicit gateway operations for purchase-order create, draft update,
  and send.
- [x] Added the mobile purchase-order form for vendor, item, quantity, rate,
  order date, expected date, and note.
- [x] Draft saves use `createPurchaseOrder`/`updatePurchaseOrder`; sending uses
  `sendPurchaseOrder`, preserving draft freeze, immutable numbering, role
  checks, and approval-threshold enforcement.
- [x] Deployed the gateway and rebuilt the live service.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass.

### Purchase-order handoff slice

- [x] Purchase-order send is available through the mobile mutation gateway and
  still records `sent` only through the existing server action.
- [x] After a successful send, the mobile app opens the native share sheet for
  a human vendor handoff; the app does not claim that WhatsApp or another
  channel delivered the document.
- [x] Deployed the gateway and rebuilt the live service.
- [x] Expanded the mobile order form to multiple order lines.
- [x] Added a visible owner-approval request action with a required reason.
- [x] Deployed the gateway and rebuilt the live service.

### Offline conflict and mutation history slice

- [x] SQLite mutation rows retain `pending`/`failed` status, attempt count,
  and the latest server error.
- [x] Generic queued mutations flush through the mobile mutation gateway;
  successful rows are removed and failed rows remain inspectable.
- [x] Added a mobile sync-history screen with retry, remove, and sync-now
  controls.
- [x] Attendance queue failures now retain their server error instead of being
  indistinguishable from a normal offline save.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass.

### Owner/accountant review slice

- [x] Added `GET /api/mobile/v1/review` with role-aware owner and accountant
  read models.
- [x] Owner mobile review shows current vendor dues from the dashboard model.
- [x] Accountant mobile review shows books-completeness findings, open
  queries, and unaccounted movements.
- [x] Connected owner “See dashboard” and accountant “Review books” actions.
- [x] Deployed the route and rebuilt the live service.
- [x] Mobile/web TypeScript, ESLint, and diff checks pass.

## Current known gap

Purchasing receiving, stock, kitchen, attendance, sales/cash, purchase
approvals, purchase-order creation, private attachments, offline mutation
history, owner/accountant review, session expiry, deep links, notification
responses, and release configuration now have connected project-side workflows.
Only native simulator/device builds and signed store distribution remain.

## Next exact work sequence

1. Keep the verified iOS Debug/Release simulator build paths available for
   local testing.
2. Run native Android build/device verification when an Android SDK/emulator or
   physical device is available.
3. Run signed TestFlight/Play internal builds with the required store accounts.

## Files already involved

- `apps/mobile/App.tsx`
- `apps/mobile/package.json`
- `apps/mobile/package-lock.json`
- `src/app/api/mobile/v1/auth/login/route.ts`
- `src/app/api/mobile/v1/me/route.ts`
- `src/proxy.ts`
- `src/server/current-user.ts`
- `docs/mobile-app-plan.md`
- `docs/mobile-implementation-status.md`

## Verification rule

After each slice, run:

```text
npx tsc --noEmit
npm run lint
npx tsc --noEmit -p apps/mobile/tsconfig.json
cd apps/mobile && npx expo-doctor
git diff --check
```

For server changes, also build and probe the deployed service before calling
the slice complete.
