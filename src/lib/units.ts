// RUPEES · PERCENT OF SALES — the restaurant lens.
//
// Food cost, labour and prime cost are quoted as percentages by universal
// convention, for a good reason: a P&L in rupees alone cannot be compared to a
// benchmark, or to last month at a different volume. ₹1,20,000 of food is
// excellent on ₹5,00,000 of sales and ruinous on ₹2,00,000.
//
// THE PRECONDITION IS THE WHOLE FEATURE. A percentage needs a denominator, and
// where sales are absent or unattributed there is no honest one — so this
// returns a REFUSAL rather than a number, and every screen renders it in the
// same words it already uses for anything it cannot assess. It must never
// print 0%, which is the difference between "labour was free" and "we do not
// know what we sold".
//
// Rajesh has 94% of revenue unmapped, so most department percentages are
// unanswerable today and say so. That is honest rather than broken, and it
// becomes answerable the moment the mapping queue is worked — with no change
// here.
//
// (Named units.ts, not share.ts: src/lib/share.ts is the WhatsApp day-close
// summary and has been since phase 11.)

import { formatPaise } from '@/lib/money'

export type Units = 'rupees' | 'percent'

export type Amount =
  | { kind: 'rupees'; text: string }
  | { kind: 'percent'; text: string; pct: number }
  | { kind: 'unassessable'; needs: string; why: string }

/**
 * One figure, rendered as money or as a share of sales.
 *
 * `salesPaise` is NULL when no sales figure exists at all and 0 when a real
 * zero was measured — and those are different refusals, because one is "no day
 * has been fetched" and the other is "nothing was sold". Neither yields a
 * percentage, and the sentence differs so the reader knows which.
 */
export function asUnits(
  amountPaise: number | null,
  salesPaise: number | null,
  units: Units,
  what = 'this figure',
): Amount {
  if (amountPaise === null) {
    return {
      kind: 'unassessable',
      needs: 'nothing recorded',
      why: `No ${what} has been entered for this period, so there is nothing to state — and that is not a zero.`,
    }
  }
  if (units === 'rupees') return { kind: 'rupees', text: formatPaise(amountPaise) }

  if (salesPaise === null) {
    return {
      kind: 'unassessable',
      needs: 'no sales to divide into',
      why:
        'A percentage needs a denominator, and no sales figure exists for this period. The cost is real; the ' +
        'ratio is not — switch to ₹ to see what was actually spent.',
    }
  }
  if (salesPaise === 0) {
    return {
      kind: 'unassessable',
      needs: 'sales are zero',
      why:
        'Sales for this period are zero, so every ratio would divide by nothing. The cost is real; the ' +
        'percentage cannot exist.',
    }
  }
  const pct = (amountPaise / salesPaise) * 100
  return { kind: 'percent', text: `${pct.toFixed(1)}%`, pct }
}

/** The two options, shared so every screen offers the same words. */
export const UNIT_OPTIONS = [
  { value: 'rupees' as const, label: '₹', hint: 'What was actually spent.' },
  {
    value: 'percent' as const,
    label: '% of sales',
    hint: 'The restaurant lens — comparable to a benchmark, and to last month at a different volume.',
  },
]
