# Product decisions

These decisions were approved by the product owner on 2026-09-13.

## Ground rule #1

The implementation continues end to end without stopping for routine
decisions or partial-analysis handoffs. Context belongs in the repository
documents; each completed workstream must have implementation evidence and
acceptance results. Only a genuinely external dependency may pause execution.

| Area | Decision |
| --- | --- |
| Tenancy | Multiple restaurants from day one |
| Membership | One person can belong to multiple restaurants, with a role per restaurant |
| Platform administration | Separate platform-admin control plane, outside restaurant roles |
| Restaurant roles | owner, manager, chef, store, cashier, accountant |
| Accounting | Build toward full double-entry accounting |
| Payroll | Complete enough statutory payroll for the launch market |
| Inventory | Valuation, locations, transfers, batches, expiry, reorder, adjustment approvals |
| Barcode | Deferred until after the first production rollout |
| Recipes | Versioning is mandatory |
| Purchasing | Configurable purchase approvals |
| POS | Petpooja first; manual and scheduled sync; adapter boundary for other POSs |
| Launch workflows | Bill photos, WhatsApp, SOPs, English, Telugu staff flows, CSV imports |
| Offline | Deferred |
| Imports | Vendors, items, opening stock, purchases, sales, staff, payroll, accounts, opening balances |
| Financial controls | Close locks financial records; corrections use reopen or reversal |
| Production output stock | Recipe production remains a separate kitchen value ledger. It is not silently converted into store item lots; produced dishes/sub-recipes are held and consumed through kitchen closings, while purchased store items use stock lots. |
| Review cadence | Configurable business day; cashier daily; kitchen nightly; store critical daily/full weekly; manager daily exceptions; accountant weekly; owner weekly |
| Rollout | Prove one restaurant end to end, then add multi-restaurant consolidation |
