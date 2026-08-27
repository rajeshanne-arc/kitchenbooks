// EXPIRY — and the limitation is the feature, not a footnote on it.
//
// KITCHENBOOKS HAS NO LOT TRACKING, and the card must say so in those terms.
// Stock is a RUNNING QUANTITY: `stock_on_hand` knows the restaurant holds 23.5
// kg of chicken and cannot know which 2 kg arrived on Monday. So the honest
// sentence is:
//
//   "A batch bought on the 5th expires tomorrow and you still hold 4 litres —
//    go and look."
//
// and never:
//
//   "You are holding 4 litres that expire tomorrow."
//
// The first is a PROMPT. The second is a claim about which physical goods are
// on the shelf, and this app has no basis for it — the batch may have been
// used on Tuesday and the 4 litres may be Friday's delivery. A prompt that
// sends somebody to look is useful and true; a claim that turns out to be
// wrong twice teaches people the card is noise.
//
// FULL LOT TRACKING IS WHAT PHARMA NEEDS. A restaurant turning fresh produce
// in days does not, and building it would put a date on every issue line —
// which is the cost the store manager pays, every issue, forever, for a
// precision nobody here is asking for.
//
// AND `expiring_stock` DELIBERATELY PUBLISHES NO "TODAY". business_date()
// reads settings and therefore only answers inside a tenant-announcing
// transaction; a view calling it would be correct only while RLS happened to
// be filtering it, which is a rule holding by accident. The app compares
// against its own business day instead — here.

export type ExpiryState = 'expired' | 'expiring' | 'ok'

/** How many days ahead counts as "expiring". Not a setting: it is a rendering
 *  choice about a prompt, not a claim about a number, and two restaurants
 *  differing on it changes nothing either of them could compare. */
export const EXPIRING_WITHIN_DAYS = 7

/** Whole days from `today` to `date`, both YYYY-MM-DD business dates.
 *  Computed on UTC midnights so a timezone can never move the answer by one —
 *  the dates are already business dates and carry no clock. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN
  return Math.round((a - b) / 86_400_000)
}

export function expiryState(date: string, today: string, within = EXPIRING_WITHIN_DAYS): ExpiryState {
  const d = daysUntil(date, today)
  if (Number.isNaN(d)) return 'ok'
  if (d < 0) return 'expired'
  return d <= within ? 'expiring' : 'ok'
}

/**
 * The sentence, in the prompt form.
 *
 * IT NAMES THE BATCH AND THE STOCK AS TWO SEPARATE FACTS, joined by "and",
 * never as one. "Bought on the 5th, expires tomorrow" is about a delivery we
 * recorded; "you still hold 4 litres" is about a running total. Putting them
 * in one clause would assert a link the data does not carry.
 */
export function expiryPrompt(input: {
  itemName: string
  billDate: string
  expiryDate: string
  onHand: string
  unit: string
  today: string
  fmtDate: (d: string) => string
}): string {
  const d = daysUntil(input.expiryDate, input.today)
  const when =
    d < 0
      ? `expired ${Math.abs(d)} ${Math.abs(d) === 1 ? 'day' : 'days'} ago`
      : d === 0
        ? 'expires today'
        : d === 1
          ? 'expires tomorrow'
          : `expires in ${d} days`
  return (
    `A batch of ${input.itemName} bought on ${input.fmtDate(input.billDate)} ${when}, ` +
    `and ${Number(input.onHand)} ${input.unit} of it is still on the book — go and look.`
  )
}

/** The limitation, in one sentence, for the card that carries these prompts.
 *  Kept here so every surface says the same thing rather than each inventing
 *  its own softening of it. */
export const NO_LOT_TRACKING =
  'Stock is a running quantity, so the app cannot tell which of what you hold came from which delivery. ' +
  'These are prompts to go and check a date, not statements about what is on the shelf.'
