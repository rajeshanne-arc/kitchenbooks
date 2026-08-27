// PRICE VARIANCE — the nudge that needs no new habit.
//
// It appears while somebody is ALREADY entering a bill: nothing to remember,
// nothing to open, no screen anybody has to be trained to visit. That is why
// it was built before the count filter and the expiry card — the amount of new
// habit a feature demands is the thing that decides whether it gets used.
//
// COMPARED AGAINST THE SAME VENDOR, NEVER AN ITEM-WIDE AVERAGE. Measured on
// live data: RR Chicken bills Chicken Boneless at ₹330 and Sneha at ₹300. An
// average would flag Sneha's perfectly normal price as a fall and RR's as a
// rise, and a warning that fires on correct entries is a warning people learn
// to dismiss. So the comparison is only ever made when the rate on the screen
// came from THIS vendor's own last bill — `rate_source === 'vendor'` — and is
// declined entirely otherwise.
//
// IT DOES NOT BLOCK. The price may genuinely have gone up; the receiver is
// holding the bill and we are not. The job is to make sure nobody types a
// number they would have questioned if they had noticed it.

import { decimalStringToPaise, formatPaise } from '@/lib/money'

/** Default when `settings.price_variance_threshold_pct` is missing or
 *  malformed. Ten per cent is loose enough that ordinary movement does not
 *  fire it — the live 6.5% rise on Chicken Boneless does NOT trip this, and
 *  appears in the report instead, which is the right split: the inline nudge
 *  is for the number in front of you, the report is for what changed. */
export const DEFAULT_PRICE_THRESHOLD_PCT = 10

export function parsePriceThreshold(raw: string | null): number {
  if (raw === null) return DEFAULT_PRICE_THRESHOLD_PCT
  const n = Number(raw.trim())
  // A ZERO OR NEGATIVE THRESHOLD WOULD FIRE ON EVERY LINE, which is the same
  // as firing on none. Malformed falls back rather than shouting.
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_PRICE_THRESHOLD_PCT
}

export type PriceMove = {
  pct: number
  direction: 'up' | 'down'
  previousPaise: number
  typedPaise: number
  /** what the change costs on THIS line, at the quantity typed — the figure
   *  that turns a percentage into a decision */
  costPaise: number | null
  sentence: string
}

/**
 * Is the rate on this line far enough from what this vendor last charged to
 * be worth saying? Null when there is nothing to compare, which is the common
 * case and must stay silent.
 *
 * `rateSource` is checked here rather than by the caller so the cross-vendor
 * comparison cannot be made by forgetting.
 */
export function priceMove(input: {
  typed: string
  previous: string | null
  previousDate: string | null
  rateSource: 'vendor' | 'any' | null
  qty: string
  thresholdPct: number
  fmtDate: (d: string) => string
}): PriceMove | null {
  if (input.rateSource !== 'vendor' || input.previous === null) return null
  const prev = decimalStringToPaise(input.previous)
  const typed = decimalStringToPaise(input.typed)
  if (prev <= 0 || typed <= 0) return null
  const pct = ((typed - prev) / prev) * 100
  if (Math.abs(pct) < input.thresholdPct) return null

  const qty = Number(input.qty)
  const costPaise = Number.isFinite(qty) && qty > 0 ? Math.round(qty * (typed - prev)) : null
  const up = typed > prev
  const when = input.previousDate === null ? null : input.fmtDate(input.previousDate)
  return {
    pct: Math.abs(pct),
    direction: up ? 'up' : 'down',
    previousPaise: prev,
    typedPaise: typed,
    costPaise,
    sentence:
      `${formatPaise(typed)} — ${up ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}% from ` +
      `${formatPaise(prev)}${when === null ? '' : ` on ${when}`}` +
      (costPaise === null || costPaise === 0
        ? ''
        : `, ${formatPaise(Math.abs(costPaise))} ${up ? 'more' : 'less'} on this line`),
  }
}
