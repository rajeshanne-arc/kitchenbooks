// WHERE THE MONEY RUNS OUT — which bills a payment clears, which one it
// clears partially, and which it does not touch.
//
// Payments here are ON ACCOUNT and tied to no bill, so FIFO is not a
// preference: it is what `bills_outstanding` does, and therefore what actually
// happens to the money. A total cannot show it. A part payment against eight
// bills either clears the oldest five and half of the sixth, or it does not,
// and that is the thing somebody reconciling against a vendor's statement
// needs to see before the transfer goes.

import { decimalStringToPaise, paiseToString } from '@/lib/money'

export type Settlement<T> = {
  bill: T
  /** 'clears' — this bill goes to zero. 'partial' — the money runs out inside
   *  it. 'untouched' — nothing reaches it. */
  fate: 'clears' | 'partial' | 'untouched'
  /** what this bill receives, as a decimal string. '0.00' when untouched. */
  applied: string
  /** what is left on it afterwards */
  leftOver: string
}

export function applyFifo<T extends { unpaid: string }>(
  bills: readonly T[],
  amountPaise: number,
): { rows: Settlement<T>[]; clears: number; leftUnapplied: number } {
  let left = Math.max(0, amountPaise)
  const rows: Settlement<T>[] = []
  let clears = 0
  for (const bill of bills) {
    const owed = decimalStringToPaise(bill.unpaid)
    if (left <= 0) {
      rows.push({ bill, fate: 'untouched', applied: '0.00', leftOver: bill.unpaid })
      continue
    }
    const take = Math.min(left, owed)
    left -= take
    const fate = take >= owed ? 'clears' : 'partial'
    if (fate === 'clears') clears++
    rows.push({
      bill,
      fate,
      applied: paiseToString(take),
      leftOver: paiseToString(owed - take),
    })
  }
  // MORE THAN IS OWED IS NOT AN ERROR HERE — it is an advance, and the caller
  // says so in its own words. This only reports that it happened.
  return { rows, clears, leftUnapplied: left }
}
