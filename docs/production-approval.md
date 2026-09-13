# KitchenBooks production approval record

This record is intentionally blank until the named owner verifies the live
evidence. A local green gate is not a production approval.

## Release identity

- Release/commit:
- Application deployment URL:
- Vercel deployment ID:
- Target restaurant:
- Separate probe restaurant:
- Approval date and timezone:

## Required evidence

- [ ] Owner export/backup completed and restore or export verification recorded.
- [ ] Every migration in [`migration-runbook.md`](migration-runbook.md) was
      applied once, in order, and returned `Success`.
- [ ] Existing users and restaurant memberships were reviewed before enabling
      membership mode.
- [ ] Live stock opening/receipt lots were reconciled and `audit:stock-lots`
      passed for the target restaurant.
- [ ] The target restaurant chart of accounts and posting mappings were
      reviewed by the accountant.
- [ ] Vercel uses a dedicated TLS-enabled `kb_app` database URL and separate
      server-only session, POS-encryption, cron, and private-storage secrets.
- [ ] Production preflight passed in the deployed environment.
- [ ] Petpooja credentials and provider limits were verified; one fetch and one
      retry/re-fetch were accepted.
- [ ] POS reconciliation review and correction path were accepted without
      overwriting source history.
- [ ] One real business day passed through purchasing, stock, kitchen, POS,
      cash, and accounting.
- [ ] Bill-photo read/archive and the WhatsApp close-link path were accepted,
      if enabled for this rollout.

## Explicit approval

I confirm that the evidence above was reviewed, the target restaurant is the
intended live tenant, the separate probe tenant was not used as production,
and I authorize the irreversible production deployment.

- Database migration owner:
- Deployment owner:
- Product owner:
- Accountant/reconciliation reviewer:
- Final approval signature or ticket:
- Final approval timestamp:

Until all required evidence and the final approval fields are completed, the
release status is **NOT APPROVED**.
