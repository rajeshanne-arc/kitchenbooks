# Petpooja Get Orders contract

This is the adapter contract KitchenBooks enforces for the Petpooja Get
Orders response. It is an integration boundary, not a claim that KitchenBooks
has verified a live provider account. Live credentials and a current provider
sample remain deployment-owner inputs.

## Request

The adapter sends a `POST` request to the Petpooja Get Orders endpoint with
the tenant's decrypted credentials held only on the server:

```json
{
  "app_key": "…",
  "app_secret": "…",
  "access_token": "…",
  "restID": "…",
  "order_date": "YYYY-MM-DD",
  "refId": ""
}
```

The request is bounded by a 30-second timeout and retries at most twice after
network, 429, or 5xx failures. A failed request writes no sales generation.

## Response envelope

The adapter requires a JSON object with an `order_json` array. The provider's
success indicator must be the string value `"1"`; any other value is a named
provider refusal. A JSON response without `order_json` is a contract failure,
not an empty sales day, and is rejected before normalization.

Each order is read from `Order` and may contain:

- `orderID`, `order_date`, `status`
- `order_type`, `payment_type`, `order_from`, `no_of_persons`
- `created_on` (with `order_time`/`created_at` accepted as fallbacks)
- `core_total`, `discount_total`, `tax_total`, `service_charge`,
  `container_charges`, `round_off`, `total`

Each line is read from `OrderItem` and may contain `itemid`, `name`,
`quantity`, `total`, `total_tax`, and `total_discount`.

Missing optional order or line fields remain missing facts. The normalizer
does not invent amounts, status, dates, or item mappings.

## Persistence rules

- Petpooja can return the requested date and the previous date together;
  KitchenBooks filters by the requested `order_date`.
- Duplicate `(business_date, orderID)` entries in one payload are skipped and
  counted in the fetch note.
- Status is classified explicitly; unknown statuses are visible and do not
  enter revenue.
- Every fetch is an immutable source generation. A retry creates a new fetch;
  readers use the latest generation and superseded journal entries are
  reversed atomically.
- Provider values are never returned with credentials, logged as secrets, or
  used to overwrite the source statement.

The executable boundary is [`src/server/petpooja.ts`](../src/server/petpooja.ts),
the generic normalization boundary is `src/server/sales-ingest.ts`, and the
fixture contract is exercised by `scripts/smoke-sales.ts` and the consolidated
Phase A gate.
