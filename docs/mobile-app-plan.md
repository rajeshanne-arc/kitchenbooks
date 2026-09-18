# KitchenBooks mobile apps — way forward

## 1. Outcome

Build one mobile codebase that ships as:

- KitchenBooks for iOS
- KitchenBooks for Android

The apps will use the existing KitchenBooks server at `https://kb.etdemo.in`.
The mobile clients will not connect directly to PostgreSQL, Supabase, or the
server filesystem. All business rules, role checks, tenant isolation, posting,
approvals, and audit trails remain server-owned.

## 2. Recommended stack

| Area | Decision | Reason |
|---|---|---|
| Mobile UI | React Native + Expo + Expo Router | One TypeScript implementation for iOS and Android, with native capabilities when needed |
| Builds and distribution | EAS Build and EAS Submit | Repeatable signed builds, TestFlight/internal Android testing, and store submission |
| Local persistence | SQLite, encrypted where secrets are stored | Required for kitchen/store work when connectivity is unreliable |
| Secure secrets | iOS Keychain / Android Keystore through a maintained Expo module | Session refresh tokens and device credentials must not be ordinary local storage |
| API contract | Versioned REST/JSON under `/api/mobile/v1` | Explicit, testable contract for a non-browser client; avoids coupling mobile to Next.js Server Actions |
| Server | Existing Next.js service initially | Lowest-risk path; business logic stays in the current application |
| Attachments | Upload through authenticated server endpoints, local retry queue now; R2 later | Matches the current local-file storage decision while keeping the client independent of storage provider |
| Push notifications | APNs/FCM through a server-owned notification boundary | Approvals, missing closes, stock alarms, and sync failures can reach the right role |

Expo documents EAS Build as producing store-ready iOS and Android binaries and
EAS Submit as the store-upload path. Apple’s review guidance should be treated
as a design constraint from the beginning, not as a final-day activity.

## 3. What the mobile product should contain

### Phase 1: the daily operating app

Prioritize the people who work away from a desk:

1. Sign in, sign out, session refresh, restaurant selection, and role-based navigation.
2. Kitchen dashboard and business-day context.
3. Store receiving: purchase bills, bill lines, supplier selection, bill-photo capture, and receive confirmation.
4. Stock: on-hand, negative stock alarms, reorder view, stock count, stock issue, wastage, and transfers.
5. Kitchen: recipes, production, expected output, measured waste, shift closing, and kitchen loss.
6. Sales: manual sales entry, cash handover, close-day workflow, dues, vouchers, and non-revenue entries.
7. Attendance: mark attendance, corrections, leave requests, and the current-day roster.
8. Approvals: purchase orders, payroll approvals, and decision notes where the signed-in role is allowed.

The first mobile release should not attempt to reproduce every accounting report
or every owner setup screen. It should make the high-frequency, time-sensitive
work excellent on a phone.

### Phase 2: owner and accountant companion

- Owner dashboard and alert cards.
- P&L, cash/bank reconciliation, vendor balances, expenses, and registers.
- Payroll runs, payslips, statutory values, and exports.
- Activity/audit history and approval history.
- Setup and master-data screens that are practical on mobile.

Complex wide tables and print layouts can remain web-first initially, with
mobile summary screens linking to the web version when a full document is more
useful than a compressed phone table.

## 4. Backend work required before mobile screens

The current web app contains the product rules, but many flows are exposed as
browser Server Actions. Mobile needs a stable contract in front of those rules.

### 4.1 Extract application services

Move the write-side logic into reusable server services such as:

- `purchaseService`
- `stockService`
- `kitchenProductionService`
- `salesService`
- `attendanceService`
- `approvalService`
- `attachmentService`

Web Server Actions and mobile API handlers should call these same services. No
business rule should be reimplemented in the mobile app.

### 4.2 Add `/api/mobile/v1`

Every endpoint must enforce:

- authenticated session
- current restaurant membership
- role/matrix permission
- business-day rules
- input validation
- append-only/correction rules
- idempotency for retries
- consistent error codes and user-readable messages

Initial endpoint families:

```text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /me
GET    /bootstrap
GET    /dashboard
GET    /items/search
GET    /vendors/search
POST   /purchases
POST   /purchases/{id}/attachments
POST   /stock/counts
POST   /stock/issues
POST   /stock/wastage
POST   /kitchen/production
POST   /sales/entries
POST   /sales/closes
POST   /attendance/marks
POST   /approvals/{id}/decision
GET    /sync/changes?cursor=...
POST   /sync/mutations
```

The exact endpoint list should be finalized from the mobile acceptance tests,
not guessed while building screens.

### 4.3 Make writes retry-safe

Every mobile mutation should carry a client-generated idempotency key and a
client mutation ID. The server stores the result of accepted mutations so a
retry after a timeout cannot create a duplicate bill, sale, stock issue, or
attendance mark.

### 4.4 Define sync and conflict rules

The mobile app needs a clear state model:

```text
draft → queued → uploading/sending → accepted
                         ├────────→ needs review
                         └────────→ failed, retryable
```

Rules:

- Reference data is cached and refreshed from the server.
- Append-only entries are queued offline and submitted with idempotency keys.
- A closed business day cannot be silently changed offline.
- Conflicts become visible review items; the client never overwrites server history.
- Attachments upload independently and show their actual upload state.

## 5. Mobile UX rules

- One primary action per screen.
- Large touch targets and numeric keyboards for quantities and money.
- Camera-first bill and meter evidence capture.
- Clear online/offline indicator and a visible pending-sync queue.
- Never make a user wonder whether a tap succeeded.
- Show business date explicitly; do not use the phone’s calendar date blindly.
- Preserve the product’s existing honesty states: assessed, warning, and cannot assess.
- Use bottom tabs for high-frequency areas and stacked drill-down navigation for detail.
- Keep dense reports and long tables horizontally scrollable or provide a mobile summary; do not shrink text until it is unreadable.

## 6. Repository structure

Recommended evolution:

```text
kitchenbooks/
  apps/
    web/                 # current Next.js app, moved only if useful
    mobile/              # Expo app
  packages/
    api-contracts/       # shared Zod schemas, DTOs, error codes
    design-tokens/       # colours, spacing, typography, status vocabulary
    domain-types/        # shared TypeScript types without server-only imports
  src/                   # current server until a later extraction
```

Do not force a large monorepo migration before the API boundary exists. The
lowest-risk first step is to add `apps/mobile` beside the current app and share
only contracts/tokens that are genuinely platform-neutral.

## 7. Delivery sequence

### Milestone 0 — product and platform foundation

- Create Apple Developer and Google Play Console ownership under the business account.
- Register bundle/package identifiers, app names, icons, privacy policy URL, and support contact.
- Decide the production API hostname, staging hostname, and allowed origins.
- Create a separate mobile staging tenant and test credentials.
- Write mobile acceptance tests for the Phase 1 flows.

### Milestone 1 — mobile shell and authentication

- Create Expo app with iOS/Android identifiers.
- Implement navigation, role gates, restaurant switching, session refresh, logout, and account recovery.
- Add secure token storage and an authenticated API client.
- Add error, loading, empty, offline, and pending-sync states.

### Milestone 2 — daily workflows

Implement in this order:

1. Attendance and shift start/close.
2. Store receiving and bill-photo capture.
3. Stock count, issue, wastage, and reorder.
4. Kitchen production and closing.
5. Sales entry, cash handover, and day close.
6. Approvals and owner alerts.

This order follows the physical day: people arrive, goods enter, stock moves,
food is produced, sales are recorded, cash is closed, and exceptions are
approved.

### Milestone 3 — offline and notifications

- Add SQLite cache and mutation queue.
- Add attachment retry/resume behavior.
- Test airplane-mode entry and reconnection for every write flow.
- Add APNs/FCM device registration and server-side notification routing.

### Milestone 4 — owner/accountant companion

- Add dashboard summaries, P&L, cash, payroll, registers, exports, and activity.
- Keep print-grade documents web-first until phone acceptance proves a mobile version is useful.

### Milestone 5 — release hardening

- Automated unit, API contract, sync, and end-to-end tests.
- Physical-device testing across supported iPhone and Android screen sizes.
- Accessibility pass, permission explanations, privacy disclosures, crash/error monitoring, and release checklist.
- Internal distribution, then TestFlight and closed Android testing, then staged production release.

## 8. Definition of production-ready

The apps are ready only when:

- the same user and role rules work on web and mobile;
- no mobile write can duplicate after timeout/retry;
- a restaurant cannot read another restaurant’s data;
- offline entries are visible, recoverable, and reconciled;
- bill photos never become public or orphaned;
- business-day and timezone behavior is tested around midnight;
- every Phase 1 acceptance test passes on iOS and Android physical devices;
- store metadata, privacy disclosures, support links, and review/demo credentials are complete;
- staged rollout and rollback procedures are documented.

## 9. Immediate next actions

1. Freeze the Phase 1 mobile scope above.
2. Add the mobile API contract and service-boundary work to the repository.
3. Create the Expo mobile app shell and staging configuration.
4. Implement authentication and bootstrap data before any feature screen.
5. Build one vertical slice end to end: attendance → API → offline queue → sync → audit trail.
6. Use that slice to establish the patterns for all remaining modules.

The first vertical slice is intentionally small. It proves the hard parts—
identity, role access, business date, offline retry, and server auditability—
before the project multiplies those decisions across every feature.
